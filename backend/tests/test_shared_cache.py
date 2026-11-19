"""Cache compartido entre workers (`utils/shared_cache.py`)."""
import pytest

from app.utils.shared_cache import SharedTTLCache


@pytest.fixture
def cache(tmp_path, monkeypatch):
    monkeypatch.setattr("tempfile.gettempdir", lambda: str(tmp_path))
    return SharedTTLCache("test", ttl_seconds=60.0, namespace="a")


def _other_worker(cache: SharedTTLCache) -> SharedTTLCache:
    other = SharedTTLCache("test", ttl_seconds=cache.ttl_seconds, namespace="a")
    assert other._dir == cache._dir
    return other


def test_set_y_get(cache):
    assert cache.get(("k", 1)) is None
    cache.set(("k", 1), {"a": {1, 2}})
    assert cache.get(("k", 1)) == {"a": {1, 2}}


def test_otro_proceso_lee_lo_escrito(cache):
    cache.set(("k",), [1, 2, 3])
    assert _other_worker(cache).get(("k",)) == [1, 2, 3]


def test_vence_en_todos_los_workers_a_la_misma_hora(cache, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(SharedTTLCache, "_clock", lambda self: now[0])
    cache.set(("k",), "v")
    other = _other_worker(cache)
    now[0] += 50
    assert other.get(("k",)) == "v"  # lo levanta de disco a los 50 s
    now[0] += 11  # 61 s desde que se escribió: vence aunque el otro lo leyó después
    assert other.get(("k",)) is None
    assert cache.get(("k",)) is None


def test_archivo_corrupto_se_ignora(cache):
    cache.set(("k",), "v")
    with open(cache._path(("k",)), "wb") as fh:
        fh.write(b"basura")
    assert _other_worker(cache).get(("k",)) is None


def test_namespace_separa_instalaciones(cache):
    cache.set(("k",), "v")
    assert SharedTTLCache("test", ttl_seconds=60.0, namespace="b").get(("k",)) is None


def test_clear_borra_memoria_y_disco(cache):
    cache.set(("k",), "v")
    cache.clear()
    assert cache.get(("k",)) is None
    assert _other_worker(cache).get(("k",)) is None


def test_sin_disco_sigue_andando_en_memoria(cache, monkeypatch):
    monkeypatch.setattr("os.makedirs", lambda *a, **k: (_ for _ in ()).throw(OSError("sin disco")))
    cache.set(("k",), "v")
    with cache.lock():
        assert cache.get(("k",)) == "v"
    assert cache._disk_off


def test_lock_excluye_entre_threads_y_entre_instancias(cache):
    import threading
    import time

    inside, overlaps = [0], [0]

    def work(c):
        with c.lock():
            inside[0] += 1
            overlaps[0] += inside[0] > 1
            time.sleep(0.05)
            inside[0] -= 1

    # Dos instancias = dos "workers" (flock); la misma dos veces = dos threads.
    threads = [threading.Thread(target=work, args=(c,)) for c in (cache, cache, _other_worker(cache))]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert overlaps[0] == 0


def test_lock_se_libera_si_el_calculo_falla(cache):
    with pytest.raises(RuntimeError):
        with cache.lock():
            raise RuntimeError("la base no respondió")
    with _other_worker(cache).lock(timeout=0.2):
        pass
    assert cache._thread_lock.acquire(blocking=False)
    cache._thread_lock.release()


def test_lock_no_espera_para_siempre(cache):
    import time

    other = _other_worker(cache)
    with cache.lock():
        t = time.monotonic()
        with other.lock(timeout=0.2):  # el que calcula está colgado: se sigue igual
            pass
        assert time.monotonic() - t < 2


def test_la_memoria_no_acumula_vencidos(cache, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(SharedTTLCache, "_clock", lambda self: now[0])
    cache.set(("ayer",), "v")
    now[0] += 61
    assert cache.get(("ayer",)) is None
    cache.set(("hoy",), "v")
    assert list(cache._memory) == [("hoy",)]
