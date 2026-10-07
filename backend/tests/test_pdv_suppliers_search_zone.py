"""search-zone: la deduplicación no debe cortar la lista antes de tiempo."""
from app.models.pdv_supplier import PdvSupplier


def test_search_zone_returns_suppliers_beyond_first_100_rows(client, _db_session):
    # 120 filas del mismo proveedor (mismo teléfono, distintos PDVs) + uno alfabéticamente último
    _db_session.add_all(
        PdvSupplier(Name="Aaa Kiosco", Phone="3810000000", IsActive=True) for _ in range(120)
    )
    _db_session.add(PdvSupplier(Name="Zzz Distribuciones", Phone="3819999999", IsActive=True))
    _db_session.commit()

    res = client.get("/pdvs/1/suppliers/search-zone")
    assert res.status_code == 200
    names = [s["Name"] for s in res.json()]
    assert names.count("Aaa Kiosco") == 1
    assert "Zzz Distribuciones" in names
