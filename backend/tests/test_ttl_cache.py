"""TTLCache: coalescing de builds concurrentes (app/utils/ttl_cache.py).

Sin el lock por clave, N requests simultáneos con cache miss (p.ej. las
secciones de Inteligencia al abrir la página) construían el censo N veces
en paralelo contra la DB.
"""
import threading
import time

from app.utils.ttl_cache import TTLCache


def test_concurrent_misses_build_once():
    cache = TTLCache(ttl_seconds=60)
    calls = []

    def slow_build():
        calls.append(1)
        time.sleep(0.05)  # ventana para que los demás threads lleguen al miss
        return "valor"

    results = []
    threads = [
        threading.Thread(target=lambda: results.append(cache.get_or_build(("k",), slow_build)))
        for _ in range(8)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(calls) == 1, f"build corrió {len(calls)} veces, esperaba 1"
    assert results == ["valor"] * 8


def test_distinct_keys_build_independently():
    cache = TTLCache(ttl_seconds=60)
    assert cache.get_or_build(("a",), lambda: 1) == 1
    assert cache.get_or_build(("b",), lambda: 2) == 2
    # Hit: no reconstruye
    assert cache.get_or_build(("a",), lambda: 99) == 1


def test_expired_entry_rebuilds():
    cache = TTLCache(ttl_seconds=100)
    now = [1000.0]
    cache._clock = lambda: now[0]  # type: ignore[method-assign]
    assert cache.get_or_build(("k",), lambda: "v1") == "v1"
    now[0] += 101
    assert cache.get_or_build(("k",), lambda: "v2") == "v2"


def test_build_exception_not_cached():
    cache = TTLCache(ttl_seconds=60)

    def boom():
        raise RuntimeError("x")

    try:
        cache.get_or_build(("k",), boom)
    except RuntimeError:
        pass
    assert cache.get_or_build(("k",), lambda: "ok") == "ok"
