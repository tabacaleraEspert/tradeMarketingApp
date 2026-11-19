"""Cache TTL compartido entre los workers de gunicorn del mismo contenedor.

`TTLCache` vive en la memoria de cada worker: con 4 workers, un cálculo caro se
repite hasta 4 veces dentro del TTL, y dos pedidos simultáneos que caen en
workers distintos lo corren en paralelo. Contra una base chica (S0) eso satura
la CPU y multiplica el tiempo de todos.

Acá el valor se guarda además en un archivo del directorio temporal, que todos
los workers ven, y `lock()` serializa el cálculo entre procesos: lo hace uno y
el resto lo lee. Si el disco o el lock fallan, degrada a cache en memoria.

Solo para valores planos (sets, dicts, dataclasses) armados por esta app: se
serializan con pickle. El contenedor se recrea en cada deploy, así que no hay
archivos de una versión anterior del código.
"""
import hashlib
import logging
import os
import pickle
import tempfile
import threading
import time
from contextlib import contextmanager
from typing import Any, Optional

try:  # no existe en Windows (dev): ahí queda solo el lock entre threads
    import fcntl
except ImportError:  # pragma: no cover
    fcntl = None

logger = logging.getLogger(__name__)


class SharedTTLCache:
    def __init__(self, name: str, ttl_seconds: float, namespace: str = "", max_entries: int = 200):
        """`namespace` separa instalaciones que comparten máquina (p.ej. un
        backend local contra SQLite y otro contra otra base)."""
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        digest = hashlib.sha1(namespace.encode()).hexdigest()[:10]
        self._dir = os.path.join(tempfile.gettempdir(), f"espert-trade-cache-{name}-{digest}")
        self._memory: dict[tuple, tuple[float, Any]] = {}
        self._thread_lock = threading.Lock()
        self._disk_off = False  # el disco falló una vez: se sigue solo en memoria

    def _clock(self) -> float:
        """Reloj de pared (no monotónico): tiene que valer entre procesos."""
        return time.time()

    def _fresh(self, written_at: float) -> bool:
        return 0 <= self._clock() - written_at <= self.ttl_seconds

    def _path(self, key: tuple) -> str:
        return os.path.join(self._dir, hashlib.sha1(repr(key).encode()).hexdigest() + ".pkl")

    def _disable_disk(self, why: str) -> None:
        if not self._disk_off:  # se avisa una sola vez, no en cada request
            self._disk_off = True
            logger.warning("shared_cache: sin disco, queda en memoria por worker (%s)", why, exc_info=True)

    def _disk_ready(self) -> bool:
        if self._disk_off:
            return False
        try:
            os.makedirs(self._dir, mode=0o700, exist_ok=True)
            # Solo se confía en una carpeta propia: de ahí se leen pickles.
            if hasattr(os, "getuid") and os.stat(self._dir).st_uid != os.getuid():
                raise PermissionError(f"{self._dir} es de otro usuario")
            return True
        except Exception:
            self._disable_disk("no se pudo preparar la carpeta")
            return False

    def get(self, key: tuple) -> Optional[Any]:
        """No toma locks: se puede llamar antes de `lock()` como camino rápido."""
        entry = self._memory.get(key)
        if entry is not None:
            if self._fresh(entry[0]):
                return entry[1]
            self._memory.pop(key, None)
        if self._disk_off:
            return None
        try:
            with open(self._path(key), "rb") as fh:
                written_at, stored_key, value = pickle.load(fh)
        except FileNotFoundError:
            return None
        except Exception:  # archivo a medio escribir o ilegible: se recalcula
            logger.warning("shared_cache: no se pudo leer %s", key, exc_info=True)
            return None
        if stored_key != key or not self._fresh(written_at):
            return None
        self._remember(key, written_at, value)
        return value

    def _remember(self, key: tuple, written_at: float, value: Any) -> None:
        now = self._clock()
        for old in [k for k, (at, _v) in list(self._memory.items()) if not 0 <= now - at <= self.ttl_seconds]:
            self._memory.pop(old, None)
        if len(self._memory) >= self.max_entries:
            self._memory.clear()  # límite defensivo, como TTLCache
        self._memory[key] = (written_at, value)

    def set(self, key: tuple, value: Any) -> None:
        written_at = self._clock()
        self._remember(key, written_at, value)
        if not self._disk_ready():
            return
        try:
            self._purge_files(written_at)
            path = self._path(key)
            tmp = f"{path}.{os.getpid()}.tmp"
            with open(tmp, "wb") as fh:
                pickle.dump((written_at, key, value), fh, protocol=pickle.HIGHEST_PROTOCOL)
            os.replace(tmp, path)  # atómico: nadie lee un archivo a medias
        except Exception:
            self._disable_disk("no se pudo escribir")

    def _purge_files(self, now: float) -> None:
        for name in os.listdir(self._dir):
            path = os.path.join(self._dir, name)
            try:
                if name != ".lock" and now - os.path.getmtime(path) > self.ttl_seconds:
                    os.remove(path)
            except OSError:
                pass

    @contextmanager
    def lock(self, timeout: float = 45.0):
        """Exclusión entre threads y entre procesos para calcular una sola vez.
        Quien entra debe volver a consultar `get()`: otro pudo haber calculado
        mientras esperaba.

        La espera tiene tope: si quien calcula está colgado (p.ej. la base no
        responde), pasado `timeout` se sigue sin exclusión en vez de encolar
        requests hasta agotar los threads del worker."""
        deadline = time.monotonic() + timeout
        got_thread = self._thread_lock.acquire(timeout=max(timeout, 0))
        fh = None
        try:
            if got_thread and fcntl is not None and self._disk_ready():
                try:
                    fh = open(os.path.join(self._dir, ".lock"), "w")
                    while True:
                        try:
                            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
                            break
                        except BlockingIOError:
                            if time.monotonic() >= deadline:
                                fh.close()
                                fh = None
                                break
                            time.sleep(0.05)
                except Exception:
                    if fh is not None:
                        fh.close()
                        fh = None
                    self._disable_disk("no se pudo tomar el lock entre procesos")
            yield
        finally:
            if fh is not None:
                try:
                    fcntl.flock(fh, fcntl.LOCK_UN)
                except OSError:
                    pass
                fh.close()
            if got_thread:
                self._thread_lock.release()

    def clear(self) -> None:
        self._memory.clear()
        try:
            for name in os.listdir(self._dir):
                if name != ".lock":
                    os.remove(os.path.join(self._dir, name))
        except OSError:
            pass
