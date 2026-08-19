"""Cache TTL de los reportes del panel admin (`_REPORTS_CACHE` en reports.py):
segunda llamada con la misma key no recalcula; params distintos sí."""


def test_summary_segunda_llamada_cacheada(client, monkeypatch):
    calls = []
    from app.routers import reports as r
    original = r._REPORTS_CACHE.get_or_build

    def _spy(key, build):
        def counted():
            calls.append(key[0])
            return build()
        return original(key, counted)

    monkeypatch.setattr(r._REPORTS_CACHE, "get_or_build", _spy)

    assert client.get("/reports/summary", params={"year": 2026, "month": 7}).status_code == 200
    assert client.get("/reports/summary", params={"year": 2026, "month": 7}).status_code == 200
    assert calls.count("report_summary") == 1  # segunda fue cache-hit

    assert client.get("/reports/summary", params={"year": 2026, "month": 6}).status_code == 200
    assert calls.count("report_summary") == 2  # otro mes = otra key


def test_perfect_store_cacheado(client):
    from app.routers import reports as r
    r._REPORTS_CACHE.clear()
    first = client.get("/reports/perfect-store")
    assert first.status_code == 200
    assert len(r._REPORTS_CACHE._data) == 1
    second = client.get("/reports/perfect-store")
    assert second.status_code == 200
    assert second.json() == first.json()
