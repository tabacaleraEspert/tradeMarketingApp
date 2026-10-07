"""Proveedor con vendedores (fase 1, tasks/spec-proveedores-vendedores.md).

Proveedor por zona; vendedor = nombre + teléfono opcional; PDV se vincula a
proveedor + vendedor opcional; ABM/unificar = solo admin.
"""
import json
import uuid

from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.models import AuditEvent, PdvSupplier
from app.services.intelligence import build_suppliers
from app.services.supplier_names import normalize_name


def _uid():
    return uuid.uuid4().hex[:8]


def _db():
    return sessionmaker(bind=engine)()


def _zone(client):
    r = client.post("/zones", json={"Name": f"ZSup_{_uid()}"})
    assert r.status_code == 201, r.text
    return r.json()["ZoneId"]


def _user(client, role, zone_id=None):
    email = f"sup_{role}_{_uid()}@test.com"
    payload = {"Email": email, "DisplayName": email, "Password": "Pass123!", "RoleName": role}
    if zone_id is not None:
        payload["ZoneId"] = zone_id
    r = client.post("/users", json=payload)
    assert r.status_code == 201, r.text
    login = client.post("/auth/login", json={"email": email, "password": "Pass123!"})
    assert login.status_code == 200, login.text
    return r.json(), {"Authorization": f"Bearer {login.json()['access_token']}"}


def _pdv(client, zone_id):
    ch = client.post("/channels", json={"Name": f"SupCh_{_uid()}"}).json()
    r = client.post("/pdvs", json={
        "Name": f"SupPDV_{_uid()}", "ChannelId": ch["ChannelId"], "IsActive": True, "ZoneId": zone_id,
    })
    assert r.status_code == 201, r.text
    return r.json()


def _supplier(client, zone_id, name=None, **extra):
    r = client.post("/suppliers", json={"ZoneId": zone_id, "Name": name or f"Prov {_uid()}", **extra})
    assert r.status_code == 201, r.text
    return r.json()


def test_normalize_name():
    assert normalize_name("  Distribuidora   GÓMEZ ") == "distribuidora gomez"
    assert normalize_name(None) == ""


def test_list_non_admin_filtered_to_own_zone(client):
    z1, z2 = _zone(client), _zone(client)
    s1 = _supplier(client, z1, "Alfa Distribuciones")
    s2 = _supplier(client, z2, "Beta Distribuciones")
    inactive = _supplier(client, z1, "Gamma Inactivo")
    assert client.patch(f"/suppliers/{inactive['SupplierId']}", json={"IsActive": False}).status_code == 200

    _, h = _user(client, "vendedor", z1)
    # zone_id de otra zona se ignora: no-admin siempre ve la suya
    ids = {s["SupplierId"] for s in client.get(f"/suppliers?zone_id={z2}&include_inactive=true", headers=h).json()}
    assert s1["SupplierId"] in ids
    assert s2["SupplierId"] not in ids
    assert inactive["SupplierId"] not in ids

    _, h_nozone = _user(client, "vendedor")
    assert client.get("/suppliers", headers=h_nozone).json() == []

    # admin: filtro opcional por zona
    admin_ids = {s["SupplierId"] for s in client.get(f"/suppliers?zone_id={z2}").json()}
    assert admin_ids == {s2["SupplierId"]}


def test_list_q_matches_supplier_seller_name_and_phone(client):
    z = _zone(client)
    s = _supplier(client, z, "Kiosquera Norte")
    client.post(f"/suppliers/{s['SupplierId']}/sellers", json={"Name": "Juancito Pérez", "Phone": "3815551234"})
    other = _supplier(client, z, "Otra Cosa")
    for q in ("kiosquera", "JUANCITO", "555123"):
        ids = {x["SupplierId"] for x in client.get(f"/suppliers?zone_id={z}&q={q}").json()}
        assert ids == {s["SupplierId"]}, q
    assert other["SupplierId"] not in {x["SupplierId"] for x in client.get(f"/suppliers?zone_id={z}&q=juancito").json()}


def test_admin_only_create_patch_merge(client):
    z = _zone(client)
    s = _supplier(client, z)
    _, h = _user(client, "vendedor", z)
    assert client.post("/suppliers", json={"ZoneId": z, "Name": "X"}, headers=h).status_code == 403
    assert client.patch(f"/suppliers/{s['SupplierId']}", json={"Name": "Y"}, headers=h).status_code == 403
    assert client.post(f"/suppliers/{s['SupplierId']}/merge", json={"SourceSupplierIds": [1]}, headers=h).status_code == 403
    r = client.post(f"/suppliers/{s['SupplierId']}/sellers", json={"Name": "Pepe"}, headers=h)
    assert r.status_code == 200, r.text
    seller_id = r.json()["Sellers"][0]["SupplierSellerId"]
    assert client.patch(f"/suppliers/{s['SupplierId']}/sellers/{seller_id}", json={"Name": "Z"}, headers=h).status_code == 403
    # territory_manager tampoco (solo admin)
    _, h_tm = _user(client, "territory_manager", z)
    assert client.post("/suppliers", json={"ZoneId": z, "Name": "X"}, headers=h_tm).status_code == 403


def test_create_duplicate_normalized_name_409(client):
    z = _zone(client)
    _supplier(client, z, "Distribuidora Gómez")
    r = client.post("/suppliers", json={"ZoneId": z, "Name": "  distribuidora   GOMEZ"})
    assert r.status_code == 409
    # otra zona sí puede
    _supplier(client, _zone(client), "Distribuidora Gómez")


def test_add_seller_other_zone_forbidden(client):
    z1, z2 = _zone(client), _zone(client)
    s = _supplier(client, z2)
    _, h = _user(client, "vendedor", z1)
    assert client.post(f"/suppliers/{s['SupplierId']}/sellers", json={"Name": "Pepe"}, headers=h).status_code == 403


def test_patch_propagates_to_links(client):
    z = _zone(client)
    pdv = _pdv(client, z)
    r = client.post(f"/pdvs/{pdv['PdvId']}/suppliers/link", json={"NewSupplier": {"Name": "Viejo Nombre"}})
    sid = r.json()["SupplierId"]
    r = client.patch(f"/suppliers/{sid}", json={"Name": "Nuevo Nombre", "Products": ["Cigarrillos"]})
    assert r.status_code == 200, r.text
    db = _db()
    try:
        row = db.query(PdvSupplier).filter(PdvSupplier.SupplierId == sid).one()
        assert row.Name == "Nuevo Nombre"
        assert json.loads(row.Products) == ["Cigarrillos"]
        ev = db.query(AuditEvent).filter(AuditEvent.Action == "SUPPLIER_UPDATE", AuditEvent.EntityId == str(sid)).one()
        payload = json.loads(ev.PayloadJson)
        assert payload["antes"]["Name"] == "Viejo Nombre" and payload["despues"]["Name"] == "Nuevo Nombre"
    finally:
        db.close()


def test_link_new_supplier_created_in_pdv_zone(client):
    z_pdv, z_user = _zone(client), _zone(client)
    pdv = _pdv(client, z_pdv)
    _, h = _user(client, "vendedor", z_user)
    r = client.post(f"/pdvs/{pdv['PdvId']}/suppliers/link", headers=h, json={
        "NewSupplier": {"Name": "Distri Sur", "Products": ["Golosinas"]},
        "NewSeller": {"Name": "Carlos"},
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ZoneId"] == z_pdv
    assert body["Name"] == "Distri Sur"
    assert body["SellerName"] == "Carlos"
    assert body["SellerPhone"] is None  # teléfono opcional
    assert body["Phone"] == ""
    assert body["Products"] == ["Golosinas"]
    sup = [s for s in client.get(f"/suppliers?zone_id={z_pdv}").json() if s["SupplierId"] == body["SupplierId"]][0]
    assert sup["PdvCount"] == 1
    assert [s["Name"] for s in sup["Sellers"]] == ["Carlos"]


def test_link_idempotent(client):
    z = _zone(client)
    pdv = _pdv(client, z)
    body = {"NewSupplier": {"Name": "Mayorista Centro"}, "NewSeller": {"Name": "Ana", "Phone": "3811234567"}}
    r1 = client.post(f"/pdvs/{pdv['PdvId']}/suppliers/link", json=body)
    r2 = client.post(f"/pdvs/{pdv['PdvId']}/suppliers/link", json={
        "NewSupplier": {"Name": "  mayorista  CENTRO "}, "NewSeller": {"Name": "ANA"},
    })
    assert r1.status_code == r2.status_code == 200
    assert r1.json()["SupplierId"] == r2.json()["SupplierId"]
    assert r1.json()["PdvSupplierId"] == r2.json()["PdvSupplierId"]
    assert r2.json()["SupplierSellerId"] == r1.json()["SupplierSellerId"]
    assert r2.json()["SellerPhone"] == "3811234567"

    sups = [s for s in client.get(f"/suppliers?zone_id={z}").json()]
    assert len(sups) == 1 and len(sups[0]["Sellers"]) == 1
    rows = client.get(f"/pdvs/{pdv['PdvId']}/suppliers").json()
    assert len(rows) == 1
    assert rows[0]["SellerName"] == "Ana" and rows[0]["Phone"] == "3811234567"

    # mismo proveedor por id, otro vendedor → actualiza la fila, no duplica
    r3 = client.post(f"/pdvs/{pdv['PdvId']}/suppliers/link", json={
        "SupplierId": r1.json()["SupplierId"], "NewSeller": {"Name": "Beto"},
    })
    assert r3.json()["PdvSupplierId"] == r1.json()["PdvSupplierId"]
    assert r3.json()["SellerName"] == "Beto"
    assert len(client.get(f"/pdvs/{pdv['PdvId']}/suppliers").json()) == 1

    db = _db()
    try:
        assert db.query(AuditEvent).filter(
            AuditEvent.Action == "PDV_SUPPLIER_LINK", AuditEvent.EntityId == str(r1.json()["PdvSupplierId"]),
        ).count() == 3
    finally:
        db.close()


def test_link_adopts_legacy_row_same_name(client):
    z = _zone(client)
    pdv = _pdv(client, z)
    legacy = client.post(f"/pdvs/{pdv['PdvId']}/suppliers", json={"Name": "Distri Legacy", "Phone": "3810000001"}).json()
    r = client.post(f"/pdvs/{pdv['PdvId']}/suppliers/link", json={"NewSupplier": {"Name": "distri legacy"}})
    assert r.json()["PdvSupplierId"] == legacy["PdvSupplierId"]
    assert r.json()["SupplierId"] is not None


def test_link_validation(client):
    z = _zone(client)
    pdv = _pdv(client, z)
    s = _supplier(client, z)
    url = f"/pdvs/{pdv['PdvId']}/suppliers/link"
    assert client.post(url, json={}).status_code == 422
    assert client.post(url, json={"SupplierId": s["SupplierId"], "NewSupplier": {"Name": "x"}}).status_code == 422
    assert client.post(url, json={
        "SupplierId": s["SupplierId"], "SupplierSellerId": 1, "NewSeller": {"Name": "x"},
    }).status_code == 422
    other = _supplier(client, z)
    seller_other = client.post(f"/suppliers/{other['SupplierId']}/sellers", json={"Name": "Z"}).json()["Sellers"][0]
    assert client.post(url, json={
        "SupplierId": s["SupplierId"], "SupplierSellerId": seller_other["SupplierSellerId"],
    }).status_code == 409
    assert client.post("/pdvs/99999999/suppliers/link", json={"SupplierId": s["SupplierId"]}).status_code == 404


def test_link_inactive_seller_409(client):
    z = _zone(client)
    pdv = _pdv(client, z)
    s = _supplier(client, z)
    se = client.post(f"/suppliers/{s['SupplierId']}/sellers", json={"Name": "Inactivo"}).json()["Sellers"][0]
    assert client.patch(
        f"/suppliers/{s['SupplierId']}/sellers/{se['SupplierSellerId']}", json={"IsActive": False},
    ).status_code == 200
    r = client.post(f"/pdvs/{pdv['PdvId']}/suppliers/link", json={
        "SupplierId": s["SupplierId"], "SupplierSellerId": se["SupplierSellerId"],
    })
    assert r.status_code == 409
    assert "inactivo" in r.json()["detail"]
    assert client.get(f"/pdvs/{pdv['PdvId']}/suppliers").json() == []


def test_rep_sees_link_on_other_zone_pdv(client):
    z_user, z_pdv = _zone(client), _zone(client)
    pdv = _pdv(client, z_pdv)
    _, h = _user(client, "vendedor", z_user)
    r = client.post(f"/pdvs/{pdv['PdvId']}/suppliers/link", headers=h, json={"NewSupplier": {"Name": "Cruzado SA"}})
    assert r.status_code == 200, r.text
    sid = r.json()["SupplierId"]
    rows = client.get(f"/pdvs/{pdv['PdvId']}/suppliers", headers=h).json()
    assert [x["SupplierId"] for x in rows] == [sid]

    # GET /suppliers: sin pdv_id solo su zona; con pdv_id suma la zona del PDV
    own = _supplier(client, z_user)
    ids = {x["SupplierId"] for x in client.get("/suppliers", headers=h).json()}
    assert own["SupplierId"] in ids and sid not in ids
    ids = {x["SupplierId"] for x in client.get(f"/suppliers?pdv_id={pdv['PdvId']}", headers=h).json()}
    assert own["SupplierId"] in ids and sid in ids
    # otra zona ajena sigue oculta
    other = _supplier(client, _zone(client))
    assert other["SupplierId"] not in ids


def test_new_seller_dedupe_and_phone_fill(client):
    z = _zone(client)
    s = _supplier(client, z)
    r1 = client.post(f"/suppliers/{s['SupplierId']}/sellers", json={"Name": "José Luis"})
    assert r1.json()["Sellers"][0]["Phone"] is None
    r2 = client.post(f"/suppliers/{s['SupplierId']}/sellers", json={"Name": "jose  luis", "Phone": "3814445566"})
    sellers = r2.json()["Sellers"]
    assert len(sellers) == 1
    assert sellers[0]["Phone"] == "3814445566"
    assert sellers[0]["Name"] == "José Luis"


def test_patch_seller_propagates_phone_and_409(client):
    z = _zone(client)
    pdv = _pdv(client, z)
    link = client.post(f"/pdvs/{pdv['PdvId']}/suppliers/link", json={
        "NewSupplier": {"Name": f"P {_uid()}"}, "NewSeller": {"Name": "Uno"},
    }).json()
    sid, se_id = link["SupplierId"], link["SupplierSellerId"]
    client.post(f"/suppliers/{sid}/sellers", json={"Name": "Dos"})
    assert client.patch(f"/suppliers/{sid}/sellers/{se_id}", json={"Name": "dos"}).status_code == 409
    r = client.patch(f"/suppliers/{sid}/sellers/{se_id}", json={"Phone": "3817778899"})
    assert r.status_code == 200
    rows = client.get(f"/pdvs/{pdv['PdvId']}/suppliers").json()
    assert rows[0]["Phone"] == "3817778899" and rows[0]["SellerPhone"] == "3817778899"


def test_merge_relinks_and_deactivates_sources(client):
    z = _zone(client)
    p1, p2, p3 = _pdv(client, z), _pdv(client, z), _pdv(client, z)
    target = _supplier(client, z, f"Destino {_uid()}", Products=["Cigarrillos"])
    src = _supplier(client, z, f"Origen {_uid()}", Products=["Golosinas"])
    tid, sid = target["SupplierId"], src["SupplierId"]

    # p1: solo destino (vendedor Ana); p2: solo origen (vendedor ana + Beto); p3: ambos
    client.post(f"/pdvs/{p1['PdvId']}/suppliers/link", json={"SupplierId": tid, "NewSeller": {"Name": "Ana"}})
    l2 = client.post(f"/pdvs/{p2['PdvId']}/suppliers/link", json={
        "SupplierId": sid, "NewSeller": {"Name": "ANA", "Phone": "3811112222"},
    }).json()
    client.post(f"/suppliers/{sid}/sellers", json={"Name": "Beto"})
    client.post(f"/pdvs/{p3['PdvId']}/suppliers/link", json={"SupplierId": tid})
    l3s = client.post(f"/pdvs/{p3['PdvId']}/suppliers/link", json={"SupplierId": sid, "NewSeller": {"Name": "Beto"}}).json()

    r = client.post(f"/suppliers/{tid}/merge", json={"SourceSupplierIds": [sid, tid]})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["SupplierId"] == tid
    assert sorted(out["Products"]) == ["Cigarrillos", "Golosinas"]
    names = sorted(s["Name"] for s in out["Sellers"])
    assert names == ["Ana", "Beto"]
    ana = [s for s in out["Sellers"] if s["Name"] == "Ana"][0]
    assert ana["Phone"] == "3811112222"  # completado desde el vendedor colisionado
    assert out["PdvCount"] == 3

    # origen desactivado (no aparece en lista por defecto)
    assert sid not in {s["SupplierId"] for s in client.get(f"/suppliers?zone_id={z}").json()}
    all_ids = {s["SupplierId"]: s for s in client.get(f"/suppliers?zone_id={z}&include_inactive=true").json()}
    assert all_ids[sid]["IsActive"] is False

    # p2 re-apuntado al destino con el vendedor del destino
    r2 = client.get(f"/pdvs/{p2['PdvId']}/suppliers").json()
    assert len(r2) == 1 and r2[0]["PdvSupplierId"] == l2["PdvSupplierId"]
    assert r2[0]["SupplierId"] == tid and r2[0]["SupplierSellerId"] == ana["SupplierSellerId"]
    assert r2[0]["Name"] == target["Name"]

    # p3: la fila duplicada del origen se desactiva; el vendedor pasa a la del destino
    r3 = client.get(f"/pdvs/{p3['PdvId']}/suppliers").json()
    assert len(r3) == 1 and r3[0]["SupplierId"] == tid
    assert r3[0]["SellerName"] == "Beto"
    assert r3[0]["PdvSupplierId"] != l3s["PdvSupplierId"]

    db = _db()
    try:
        assert db.query(AuditEvent).filter(AuditEvent.Action == "SUPPLIER_MERGE", AuditEvent.EntityId == str(tid)).count() == 1
    finally:
        db.close()

    # merge con origen inexistente → 404 sin cambios
    assert client.post(f"/suppliers/{tid}/merge", json={"SourceSupplierIds": [99999999]}).status_code == 404


def test_intelligence_and_report_group_by_supplier_id(client):
    z = _zone(client)
    p1, p2 = _pdv(client, z), _pdv(client, z)
    name = f"Agrupado {_uid()}"
    # mismo proveedor en 2 PDVs, con vendedores de teléfonos distintos:
    # la clave vieja (teléfono) lo partiría en dos filas
    client.post(f"/pdvs/{p1['PdvId']}/suppliers/link", json={
        "NewSupplier": {"Name": name}, "NewSeller": {"Name": "V1", "Phone": "3810001111"},
    })
    client.post(f"/pdvs/{p2['PdvId']}/suppliers/link", json={
        "NewSupplier": {"Name": name}, "NewSeller": {"Name": "V2", "Phone": "3810002222"},
    })
    # fila legacy (sin SupplierId) sigue agrupando por teléfono
    client.post(f"/pdvs/{p2['PdvId']}/suppliers", json={"Name": "Legacy X", "Phone": "3819990000", "ZoneId": z})

    db = _db()
    try:
        items = build_suppliers(db, zone_id=z)["items"]
    finally:
        db.close()
    grouped = [i for i in items if i["nombre"] == name]
    assert len(grouped) == 1
    assert grouped[0]["pdvs"] == 2
    assert grouped[0]["supplierId"] is not None
    assert sorted(v["nombre"] for v in grouped[0]["vendedores"]) == ["V1", "V2"]
    legacy = [i for i in items if i["nombre"] == "Legacy X"]
    assert len(legacy) == 1 and legacy[0]["telefono"] == "3819990000" and legacy[0]["supplierId"] is None

    top = client.get("/reports/supplier-analytics").json()["topSuppliers"]
    mine = [t for t in top if t["name"] == name]
    assert len(mine) == 1
    assert mine[0]["pdvCount"] == 2
    assert sorted(mine[0]["sellers"]) == ["V1", "V2"]


def test_migrate_script_propose_and_apply(client, tmp_path):
    """scripts/migrate_suppliers_sellers.py: agrupa por zona con fuzzy, descarta
    teléfonos cortos, crea Supplier/SupplierSeller y es idempotente."""
    import importlib.util
    from pathlib import Path

    spec = importlib.util.spec_from_file_location(
        "migrate_suppliers_sellers", Path(__file__).resolve().parents[1] / "scripts" / "migrate_suppliers_sellers.py",
    )
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)

    z = _zone(client)
    p1, p2, p3 = _pdv(client, z), _pdv(client, z), _pdv(client, z)
    for pdv, name, phone in [
        (p1, "Distribuidora Kosiuko", "3811111111"),
        (p2, "distribuidora  cosiuko", "3812222222"),
        (p3, "Distribuidora Kosiuka", "123"),  # fuzzy + teléfono inválido
    ]:
        assert client.post(f"/pdvs/{pdv['PdvId']}/suppliers", json={"Name": name, "Phone": phone, "ZoneId": z}).status_code == 201

    db = _db()
    try:
        lines = [line for line in m.build_proposal(db) if line["ZoneId"] == z]
        assert len(lines) == 3
        assert {line["ProposedSupplier"] for line in lines} == {"Distribuidora Kosiuko"}
        bad = [line for line in lines if line["Phone"] == "123"][0]
        assert "inválido" in bad["Notes"] and "similitud" in bad["Notes"]

        path = m.write_mapping(lines, tmp_path / "prop.xlsx")
        mapping = m.read_mapping(path)
        for row in mapping:
            if row["Phone"] == "3811111111":
                row["SellerName"] = "Juan"

        dry = m.apply_mapping(db, mapping, dry_run=True)
        assert dry["proveedoresCreados"] == 1
        assert db.query(PdvSupplier).filter(PdvSupplier.ZoneId == z, PdvSupplier.SupplierId.isnot(None)).count() == 0

        res = m.apply_mapping(db, mapping, backup_dir=tmp_path)
        assert res["proveedoresCreados"] == 1 and res["vendedoresCreados"] == 2 and res["vinculadas"] == 3
        assert Path(res["backup"]).exists()
        again = m.apply_mapping(db, mapping, backup_dir=tmp_path)
        assert again["filasAfectadas"] == 0
    finally:
        db.close()

    sups = client.get(f"/suppliers?zone_id={z}").json()
    assert len(sups) == 1 and sups[0]["PdvCount"] == 3
    assert sorted((s["Name"], s["Phone"]) for s in sups[0]["Sellers"]) == [
        ("Juan", "3811111111"), ("Vendedor 3812222222", "3812222222"),
    ]
