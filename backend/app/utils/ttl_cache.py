"""Cache TTL in-process para responses de endpoints de solo lectura.

Mismo esquema que el cache de `/kpi/variable` (ver nota en app/routers/kpi.py):
un dict por proceso — en producción corren varios workers de gunicorn, cada uno
con su copia (peor caso: un recálculo por worker dentro del TTL). Aceptable
para dashboards de lectura; NO usar para datos que deban reflejarse al
instante tras una escritura, salvo que quien escribe llame a `clear()`.
"""
import threading
import time


class TTLCache:
    def __init__(self, ttl_seconds: float, max_entries: int = 2000):
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self._data: dict[tuple, tuple[float, object]] = {}
        self._locks: dict[tuple, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    def _clock(self) -> float:
        """En método aparte para poder mockearlo en tests (patrón
        _kpi_cache_clock)."""
        return time.monotonic()

    def get_or_build(self, key: tuple, build):
        """Devuelve el valor cacheado para `key` o lo construye con `build()`.
        Si `build()` levanta, no se cachea nada.

        Coalescing por clave: N requests concurrentes con el mismo cache miss
        construyen UNA vez (el resto espera y reusa). Sin esto, abrir una
        página que dispara varias secciones en paralelo (p.ej. Inteligencia:
        overview + mapa + oportunidades) armaba el censo completo una vez POR
        SECCIÓN contra la DB. Claves distintas construyen en paralelo."""
        entry = self._data.get(key)
        if entry is not None and self._clock() - entry[0] <= self.ttl_seconds:
            return entry[1]
        with self._locks_guard:
            lock = self._locks.setdefault(key, threading.Lock())
        with lock:
            # Re-chequeo: otro thread pudo haberlo construido mientras esperábamos.
            entry = self._data.get(key)
            if entry is not None and self._clock() - entry[0] <= self.ttl_seconds:
                return entry[1]
            value = build()
            if len(self._data) >= self.max_entries:
                # Límite defensivo: vaciar todo en vez de un esquema de eviction.
                self._data.clear()
            self._data[key] = (self._clock(), value)
            return value

    def clear(self) -> None:
        self._data.clear()
        with self._locks_guard:
            self._locks.clear()
