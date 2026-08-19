"""Tests de GET /pdvs/admin-list (lista paginada de Gestión de PDV).

Estrategia: el fixture `client` es admin. La DB es compartida entre archivos de
test, así que cada test aísla sus PDVs con una zona propia (zone_id) y valida
contra ese subconjunto.
"""
import uuid


def _uid():
    return uuid.uuid4().hex[:8]


def _make_channel(client, name=None):
    resp = client.post("/channels", json={"Name": name or f"Ch_{_uid()}"})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_zone(client, name=None):
    resp = client.post("/zones", json={"Name": name or f"Zone_{_uid()}"})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_pdv(client, channel_id, zone_id, name=None, **kwargs):
    payload = {
        "Name": name or f"PDV_{_uid()}",
        "ChannelId": channel_id,
        "ZoneId": zone_id,
        "IsActive": True,
        **kwargs,
    }
    resp = client.post("/pdvs", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_user(client):
    email = f"al_u_{_uid()}@test.com"
    resp = client.post("/users", json={"Email": email, "DisplayName": email, "Password": "Pass123!"})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _admin_list(client, **params):
    resp = client.get("/pdvs/admin-list", params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_envelope_and_enriched_fields(client):
    ch = _make_channel(client)
    z = _make_zone(client)
    pdv = _make_pdv(client, ch["ChannelId"], z["ZoneId"], Lat=-34.6, Lon=-58.4)

    data = _admin_list(client, zone_id=z["ZoneId"])
    assert set(data.keys()) == {"items", "total", "page", "page_size", "has_more"}
    assert data["total"] == 1
    assert data["page"] == 1
    assert data["has_more"] is False

    item = data["items"][0]
    assert item["PdvId"] == pdv["PdvId"]
    # Campos enriquecidos del admin-list
    assert item["VisitCount"] == 0
    assert item["LastVisit"] is None
    assert item["HasRoute"] is False
    assert item["HasCoords"] is True
    # create_pdv auto-asigna al creador (admin) como TM
    assert item["TradeMarketerName"] == "Test Admin"
    # Campos del Pdv normal que usa el card/modal
    assert "Contacts" in item and "Distributors" in item


def test_pagination_and_order_by_name(client):
    ch = _make_channel(client)
    z = _make_zone(client)
    for name in ["C_tercero", "A_primero", "B_segundo"]:
        _make_pdv(client, ch["ChannelId"], z["ZoneId"], name=f"{name}_{_uid()}")

    page1 = _admin_list(client, zone_id=z["ZoneId"], page=1, page_size=2)
    assert page1["total"] == 3
    assert page1["has_more"] is True
    assert len(page1["items"]) == 2
    assert page1["items"][0]["Name"].startswith("A_")
    assert page1["items"][1]["Name"].startswith("B_")

    page2 = _admin_list(client, zone_id=z["ZoneId"], page=2, page_size=2)
    assert len(page2["items"]) == 1
    assert page2["items"][0]["Name"].startswith("C_")
    assert page2["has_more"] is False


def test_q_searches_name_address_beyond_page(client):
    ch = _make_channel(client)
    z = _make_zone(client)
    needle = f"Aguja{_uid()}"
    # El que matchea queda último por orden alfabético → q lo tiene que encontrar igual
    _make_pdv(client, ch["ChannelId"], z["ZoneId"], name=f"ZZZ_{needle}")
    for _ in range(3):
        _make_pdv(client, ch["ChannelId"], z["ZoneId"], name=f"AAA_{_uid()}")

    data = _admin_list(client, zone_id=z["ZoneId"], q=needle, page_size=2)
    assert data["total"] == 1
    assert needle in data["items"][0]["Name"]

    # También por dirección
    _make_pdv(client, ch["ChannelId"], z["ZoneId"], Address=f"Calle {needle} 123")
    data = _admin_list(client, zone_id=z["ZoneId"], q=needle)
    assert data["total"] == 2


def test_filter_is_active(client):
    ch = _make_channel(client)
    z = _make_zone(client)
    _make_pdv(client, ch["ChannelId"], z["ZoneId"])
    inactive = _make_pdv(client, ch["ChannelId"], z["ZoneId"], IsActive=False)

    assert _admin_list(client, zone_id=z["ZoneId"])["total"] == 2
    actives = _admin_list(client, zone_id=z["ZoneId"], is_active=True)
    assert actives["total"] == 1
    inactives = _admin_list(client, zone_id=z["ZoneId"], is_active=False)
    assert inactives["total"] == 1
    assert inactives["items"][0]["PdvId"] == inactive["PdvId"]


def test_filter_channel(client):
    ch1 = _make_channel(client)
    ch2 = _make_channel(client)
    z = _make_zone(client)
    _make_pdv(client, ch1["ChannelId"], z["ZoneId"])
    pdv2 = _make_pdv(client, ch2["ChannelId"], z["ZoneId"])

    data = _admin_list(client, zone_id=z["ZoneId"], channel_id=ch2["ChannelId"])
    assert data["total"] == 1
    assert data["items"][0]["PdvId"] == pdv2["PdvId"]


def test_filter_assigned_and_unassigned(client):
    ch = _make_channel(client)
    z = _make_zone(client)
    user = _make_user(client)
    # create_pdv auto-asigna al creador → reasignar/desasignar vía PATCH
    assigned = _make_pdv(client, ch["ChannelId"], z["ZoneId"])
    client.patch(f"/pdvs/{assigned['PdvId']}", json={"AssignedUserId": user["UserId"]})
    other = _make_pdv(client, ch["ChannelId"], z["ZoneId"])
    client.patch(f"/pdvs/{other['PdvId']}", json={"AssignedUserId": None})

    by_user = _admin_list(client, zone_id=z["ZoneId"], assigned_user_id=user["UserId"])
    assert by_user["total"] == 1
    assert by_user["items"][0]["PdvId"] == assigned["PdvId"]
    assert by_user["items"][0]["TradeMarketerName"] == user["DisplayName"]

    without = _admin_list(client, zone_id=z["ZoneId"], unassigned=True)
    assert without["total"] == 1
    assert without["items"][0]["TradeMarketerName"] is None


def test_filter_distributor(client):
    ch = _make_channel(client)
    z = _make_zone(client)
    resp = client.post("/distributors", json={"Name": f"Dist_{_uid()}"})
    assert resp.status_code == 201, resp.text
    dist = resp.json()
    with_dist = _make_pdv(client, ch["ChannelId"], z["ZoneId"], DistributorIds=[dist["DistributorId"]])
    _make_pdv(client, ch["ChannelId"], z["ZoneId"])

    data = _admin_list(client, zone_id=z["ZoneId"], distributor_id=dist["DistributorId"])
    assert data["total"] == 1
    assert data["items"][0]["PdvId"] == with_dist["PdvId"]

    none = _admin_list(client, zone_id=z["ZoneId"], no_distributor=True)
    assert none["total"] == 1
    assert none["items"][0]["PdvId"] != with_dist["PdvId"]


def test_filter_has_coords(client):
    ch = _make_channel(client)
    z = _make_zone(client)
    located = _make_pdv(client, ch["ChannelId"], z["ZoneId"], Lat=-34.6, Lon=-58.4)
    _make_pdv(client, ch["ChannelId"], z["ZoneId"])

    with_c = _admin_list(client, zone_id=z["ZoneId"], has_coords=True)
    assert with_c["total"] == 1
    assert with_c["items"][0]["PdvId"] == located["PdvId"]
    without_c = _admin_list(client, zone_id=z["ZoneId"], has_coords=False)
    assert without_c["total"] == 1


def test_filter_tri_state_works_espert(client):
    ch = _make_channel(client)
    z = _make_zone(client)
    si = _make_pdv(client, ch["ChannelId"], z["ZoneId"], WorksEspertProducts=True)
    no = _make_pdv(client, ch["ChannelId"], z["ZoneId"], WorksEspertProducts=False)
    nd = _make_pdv(client, ch["ChannelId"], z["ZoneId"])

    assert _admin_list(client, zone_id=z["ZoneId"], works_espert="si")["items"][0]["PdvId"] == si["PdvId"]
    assert _admin_list(client, zone_id=z["ZoneId"], works_espert="no")["items"][0]["PdvId"] == no["PdvId"]
    assert _admin_list(client, zone_id=z["ZoneId"], works_espert="nd")["items"][0]["PdvId"] == nd["PdvId"]
    resp = client.get("/pdvs/admin-list", params={"works_espert": "invalido"})
    assert resp.status_code == 422


def test_visit_buckets(client):
    ch = _make_channel(client)
    z = _make_zone(client)
    user = _make_user(client)
    visited = _make_pdv(client, ch["ChannelId"], z["ZoneId"])
    never = _make_pdv(client, ch["ChannelId"], z["ZoneId"])

    resp = client.post("/visits", json={"PdvId": visited["PdvId"], "UserId": user["UserId"], "Status": "OPEN"})
    assert resp.status_code == 201, resp.text

    recent = _admin_list(client, zone_id=z["ZoneId"], days_since_visit="7")
    assert recent["total"] == 1
    assert recent["items"][0]["PdvId"] == visited["PdvId"]
    assert recent["items"][0]["VisitCount"] == 1
    assert recent["items"][0]["LastVisit"] is not None

    nunca = _admin_list(client, zone_id=z["ZoneId"], days_since_visit="never")
    assert nunca["total"] == 1
    assert nunca["items"][0]["PdvId"] == never["PdvId"]

    freq0 = _admin_list(client, zone_id=z["ZoneId"], visit_freq="0")
    assert freq0["total"] == 1
    assert freq0["items"][0]["PdvId"] == never["PdvId"]
    freq15 = _admin_list(client, zone_id=z["ZoneId"], visit_freq="1-5")
    assert freq15["total"] == 1
    assert freq15["items"][0]["PdvId"] == visited["PdvId"]


def test_hierarchy_visibility(client, admin_user):
    """Un vendedor solo ve sus PDVs asignados (sub-árbol), no los del resto."""
    from app.auth import create_access_token

    ch = _make_channel(client)
    z = _make_zone(client)
    vend = _make_user(client)
    mine = _make_pdv(client, ch["ChannelId"], z["ZoneId"])
    client.patch(f"/pdvs/{mine['PdvId']}", json={"AssignedUserId": vend["UserId"]})
    _make_pdv(client, ch["ChannelId"], z["ZoneId"])  # queda asignado al admin

    token = create_access_token(subject=vend["UserId"], role="vendedor")
    resp = client.get(
        "/pdvs/admin-list",
        params={"zone_id": z["ZoneId"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total"] == 1
    assert data["items"][0]["PdvId"] == mine["PdvId"]
