"""Cadenas / banderas: ABM, reglas de PDV (canal, obligatoriedad, tamaño → subcanal,
subcanal ∈ canal), fusión, filtros de Gestión y auditoría.

El fixture `client` es admin. La DB es compartida entre archivos: cada test crea
su propio canal/zona.
"""
import json
import uuid
from datetime import datetime, timezone

import bcrypt
import pytest
from fastapi.testclient import TestClient

from app.auth import create_access_token
from app.database import SessionLocal
from app.main import app
from app.models import Role as RoleModel, User as UserModel, UserRole as UserRoleModel
from app.models.audit import AuditEvent
from app.services import chains as svc


def _uid():
    return uuid.uuid4().hex[:8]


@pytest.fixture()
def db():
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


def _user_token(db, role_name):
    role = db.query(RoleModel).filter(RoleModel.Name == role_name).first()
    if not role:
        role = RoleModel(Name=role_name)
        db.add(role)
        db.flush()
    u = UserModel(
        Email=f"{role_name}_{_uid()}@chain.test", DisplayName=f"U {role_name}",
        PasswordHash=bcrypt.hashpw(b"x", bcrypt.gensalt()).decode(), IsActive=True,
    )
    db.add(u)
    db.flush()
    db.add(UserRoleModel(UserId=u.UserId, RoleId=role.RoleId))
    db.commit()
    return u, {"Authorization": f"Bearer {create_access_token(subject=u.UserId, role=role_name)}"}


def _channel(client, with_buckets=True):
    ch = client.post("/channels", json={"Name": f"Cadenas_{_uid()}"}).json()
    subs = {}
    if with_buckets:
        for n in ("Chica (menos de 10 PDVs)", "Mediana (11 a 30 PDVs)", "Grande (más de 30 PDVs)"):
            r = client.post("/subchannels", json={"ChannelId": ch["ChannelId"], "Name": n})
            assert r.status_code == 201, r.text
            subs[n.split()[0].lower()] = r.json()["SubChannelId"]
    return ch["ChannelId"], subs


def _chain(client, channel_id, name=None, **kw):
    r = client.post("/chains", json={"Name": name or f"Cad_{_uid()}", "ChannelId": channel_id, **kw})
    assert r.status_code == 201, r.text
    return r.json()


def _pdv(client, channel_id, expect=201, **kw):
    r = client.post("/pdvs", json={"Name": f"PDV_{_uid()}", "ChannelId": channel_id, **kw})
    assert r.status_code == expect, r.text
    return r.json()


def _audits(db, entity, entity_id, action=None):
    q = db.query(AuditEvent).filter(AuditEvent.Entity == entity, AuditEvent.EntityId == str(entity_id))
    if action:
        q = q.filter(AuditEvent.Action == action)
    return q.order_by(AuditEvent.AuditEventId).all()


# ── funciones puras ──────────────────────────────────────────────────

@pytest.mark.parametrize("n,expected", [
    (0, "chica"), (1, "chica"), (10, "chica"), (11, "mediana"), (30, "mediana"), (31, "grande"), (282, "grande"),
])
def test_size_bucket_thresholds(n, expected):
    assert svc.size_bucket(n) == expected


def test_add_alias_dedupes_normalized():
    assert svc.add_alias("Tommy's shop", "TOMMYS SHOP", "Tomyshop") == "Tommy's shop, Tomyshop"
    assert svc.add_alias(None, "") is None


# ── ABM ──────────────────────────────────────────────────────────────

def test_chain_crud_and_audit(client, db, admin_user):
    ch_id, _ = _channel(client)
    c = _chain(client, ch_id, "Open 25", StoreCount=282, Aliases=" open25 , Open25,  OPEN 25 hs ")
    assert c["Kind"] == "cadena" and c["IsKeyAccount"] is False and c["IsActive"] is True
    assert c["Aliases"] == "open25, OPEN 25 hs"
    assert c["PdvCount"] == 0 and c["EffectiveStoreCount"] == 282 and c["SizeBucket"] == "Grande"

    # nombre único por canal (insensible a mayúsculas / espacios)
    r = client.post("/chains", json={"Name": "open 25", "ChannelId": ch_id})
    assert r.status_code == 409, r.text
    # …pero el mismo nombre en otro canal sí
    other_ch, _ = _channel(client, with_buckets=False)
    assert client.post("/chains", json={"Name": "Open 25", "ChannelId": other_ch}).status_code == 201

    mgr, _h = _user_token(db, "territory_manager")
    r = client.patch(f"/chains/{c['ChainId']}", json={"IsKeyAccount": True, "AccountManagerUserId": mgr.UserId})
    assert r.status_code == 200, r.text
    assert r.json()["IsKeyAccount"] is True and r.json()["AccountManagerName"] == mgr.DisplayName
    # null explícito limpia el responsable y el StoreCount
    r = client.patch(f"/chains/{c['ChainId']}", json={"AccountManagerUserId": None, "StoreCount": None})
    assert r.json()["AccountManagerUserId"] is None and r.json()["StoreCount"] is None
    assert r.json()["SizeBucket"] == "Chica"  # cae al conteo de PDVs de la app (0)

    assert client.patch(f"/chains/{c['ChainId']}", json={"AccountManagerUserId": 99999999}).status_code == 422
    assert client.post("/chains", json={"Name": "x", "ChannelId": 99999999}).status_code == 422
    assert client.post("/chains", json={"Name": "  ", "ChannelId": ch_id}).status_code == 422
    assert client.post("/chains", json={"Name": "y", "ChannelId": ch_id, "Kind": "otra"}).status_code == 422

    # lista activa (campo) vs /all (admin)
    assert c["ChainId"] in [x["ChainId"] for x in client.get("/chains", params={"channel_id": ch_id}).json()]
    assert client.delete(f"/chains/{c['ChainId']}").status_code == 204
    assert c["ChainId"] not in [x["ChainId"] for x in client.get("/chains", params={"channel_id": ch_id}).json()]
    row = next(x for x in client.get("/chains/all", params={"channel_id": ch_id}).json() if x["ChainId"] == c["ChainId"])
    assert row["IsActive"] is False

    actions = [a.Action for a in _audits(db, "Chain", c["ChainId"])]
    assert actions == ["CHAIN_CREATE", "CHAIN_UPDATE", "CHAIN_UPDATE", "CHAIN_DEACTIVATE"]
    first = _audits(db, "Chain", c["ChainId"], "CHAIN_UPDATE")[0]
    payload = json.loads(first.PayloadJson)
    assert payload["before"]["IsKeyAccount"] is False and payload["after"]["IsKeyAccount"] is True
    assert first.UserId == admin_user.UserId
    assert all(a.EntityId.isdigit() for a in _audits(db, "Chain", c["ChainId"]))  # prod: EntityId INT


def test_chain_write_permissions(client, db):
    ch_id, _ = _channel(client)
    c = _chain(client, ch_id)
    other = _chain(client, ch_id)
    _v, vend = _user_token(db, "vendedor")
    _t, tm = _user_token(db, "territory_manager")
    with TestClient(app) as anon:
        # el vendedor solo elige de la lista
        r = anon.get("/chains", headers=vend, params={"channel_id": ch_id})
        assert r.status_code == 200 and r.json()
        # …sin responsable de cuenta ni cantidades (L1)
        assert set(r.json()[0]) == {"ChainId", "Name", "ChannelId", "Kind", "IsKeyAccount", "Aliases", "IsActive"}
        assert anon.get("/chains/all", headers=vend).status_code == 403
        assert anon.get(f"/chains/{c['ChainId']}", headers=vend).status_code == 403
        assert anon.get("/chains/all", headers=tm).status_code == 200
        assert anon.get(f"/chains/{c['ChainId']}", headers=tm).status_code == 200
        assert anon.post("/chains", headers=vend, json={"Name": "Libre", "ChannelId": ch_id}).status_code == 403
        assert anon.patch(f"/chains/{c['ChainId']}", headers=vend, json={"Name": "Z"}).status_code == 403
        assert anon.delete(f"/chains/{c['ChainId']}", headers=vend).status_code == 403
        # territory_manager administra, pero la fusión es solo admin
        assert anon.post("/chains", headers=tm, json={"Name": f"TM_{_uid()}", "ChannelId": ch_id}).status_code == 201
        r = anon.post(f"/chains/{c['ChainId']}/merge", headers=tm, json={"TargetChainId": other["ChainId"]})
        assert r.status_code == 403


# ── Reglas de PDV ────────────────────────────────────────────────────

def test_pdv_chain_required_on_create_and_bucket_derivation(client, db):
    ch_id, subs = _channel(client)
    small = _chain(client, ch_id, StoreCount=4)
    mid = _chain(client, ch_id, StoreCount=24)
    big = _chain(client, ch_id, StoreCount=109, IsKeyAccount=True)

    # ChainId: null explícito en canal con cadenas: el ALTA no se rechaza (cola offline),
    # entra sin cadena, pendiente y auditada
    r = client.post("/pdvs", json={"Name": f"Sin cadena {_uid()}", "ChannelId": ch_id, "ChainId": None})
    assert r.status_code == 201, r.text
    assert r.json()["ChainId"] is None and r.json()["_chainPending"] is True
    ev = _audits(db, "PDV", r.json()["PdvId"], "PDV_CHAIN_PENDING")
    assert len(ev) == 1 and json.loads(ev[0].PayloadJson)["chainSent"] is True

    for chain, bucket in ((small, "chica"), (mid, "mediana"), (big, "grande")):
        # el subcanal enviado se ignora: se deriva del tamaño
        p = _pdv(client, ch_id, ChainId=chain["ChainId"], SubChannelId=subs["chica"])
        assert p["ChainId"] == chain["ChainId"] and p["ChainName"] == chain["Name"]
        assert p["ChainKind"] == "cadena"
        assert p["SubChannelId"] == subs[bucket], bucket
        assert p["IsKeyAccount"] is (chain is big)
        a = _audits(db, "PDV", p["PdvId"], "PDV_CHAIN_CHANGE")
        assert len(a) == 1 and json.loads(a[0].PayloadJson)["after"]["ChainId"] == chain["ChainId"]

    # detalle y lista exponen lo mismo
    d = client.get(f"/pdvs/{p['PdvId']}").json()
    assert (d["ChainName"], d["ChainKind"], d["IsKeyAccount"]) == (big["Name"], "cadena", True)


def test_bucket_falls_back_to_app_pdv_count_and_rebuckets(client, db):
    ch_id, subs = _channel(client)
    chain = _chain(client, ch_id)  # StoreCount NULL → cuenta PDVs de la app
    pdvs = [_pdv(client, ch_id, ChainId=chain["ChainId"]) for _ in range(10)]
    assert all(p["SubChannelId"] == subs["chica"] for p in pdvs)
    # el PDV 11 cruza a Mediana y arrastra a los 10 anteriores
    p11 = _pdv(client, ch_id, ChainId=chain["ChainId"])
    assert p11["SubChannelId"] == subs["mediana"]
    assert client.get(f"/pdvs/{pdvs[0]['PdvId']}").json()["SubChannelId"] == subs["mediana"]
    assert len(_audits(db, "Chain", chain["ChainId"], "CHAIN_REBUCKET")) == 1
    # cargar el StoreCount real re-deriva todos
    r = client.patch(f"/chains/{chain['ChainId']}", json={"StoreCount": 80})
    assert r.json()["SizeBucket"] == "Grande"
    assert client.get(f"/pdvs/{pdvs[3]['PdvId']}").json()["SubChannelId"] == subs["grande"]


def test_channel_without_bucket_subchannels_keeps_sent_subchannel(client):
    ch_id, _ = _channel(client, with_buckets=False)
    sc = client.post("/subchannels", json={"ChannelId": ch_id, "Name": "Formato X"}).json()
    chain = _chain(client, ch_id)
    p = _pdv(client, ch_id, ChainId=chain["ChainId"], SubChannelId=sc["SubChannelId"])
    assert p["SubChannelId"] == sc["SubChannelId"]


def test_pdv_chain_channel_mismatch_and_inactive(client):
    ch_a, _ = _channel(client)
    ch_b, _ = _channel(client)
    chain_a = _chain(client, ch_a)
    chain_b = _chain(client, ch_b)
    # ALTA: cadena de otro canal / inexistente → se descarta la cadena, el PDV entra pendiente
    for bad in (chain_b["ChainId"], 99999999):
        r = client.post("/pdvs", json={"Name": f"X {_uid()}", "ChannelId": ch_a, "ChainId": bad})
        assert r.status_code == 201, r.text
        assert r.json()["ChainId"] is None and r.json()["ChannelId"] == ch_a and r.json()["_chainPending"] is True

    p = _pdv(client, ch_a, ChainId=chain_a["ChainId"])
    assert client.patch(f"/pdvs/{p['PdvId']}", json={"ChainId": chain_b["ChainId"]}).status_code == 422

    # edición (interactiva): no se puede ELEGIR una cadena inactiva
    dead = _chain(client, ch_a)
    client.delete(f"/chains/{dead['ChainId']}")
    r = client.patch(f"/pdvs/{p['PdvId']}", json={"ChainId": dead["ChainId"]})
    assert r.status_code == 422 and "inactiva" in r.json()["detail"]


def test_offline_create_with_chain_deactivated_or_merged_meanwhile(client, db):
    """Alta capturada offline con una cadena que después se desactivó/fusionó: entra igual."""
    ch_id, subs = _channel(client)
    src = _chain(client, ch_id, "Tomyshop")
    dst = _chain(client, ch_id, "Tommy Shop", StoreCount=17)
    assert client.post(f"/chains/{src['ChainId']}/merge", json={"TargetChainId": dst["ChainId"]}).status_code == 200
    p = _pdv(client, ch_id, ChainId=src["ChainId"])  # el teléfono todavía tenía la cadena vieja
    assert p["ChainId"] == dst["ChainId"] and p["SubChannelId"] == subs["mediana"]
    payload = json.loads(_audits(db, "PDV", p["PdvId"], "PDV_CHAIN_CHANGE")[0].PayloadJson)
    assert payload["source"] == "alta-cadena-fusionada" and payload["sentChainId"] == src["ChainId"]

    lonely = _chain(client, ch_id)
    client.delete(f"/chains/{lonely['ChainId']}")  # desactivada sin fusión
    q = _pdv(client, ch_id, ChainId=lonely["ChainId"])
    assert q["ChainId"] == lonely["ChainId"] and q["ChainName"] == lonely["Name"]


def test_subchannel_must_belong_to_channel(client):
    ch_a, _ = _channel(client, with_buckets=False)
    ch_b, _ = _channel(client, with_buckets=False)
    sc_b = client.post("/subchannels", json={"ChannelId": ch_b, "Name": "De B"}).json()["SubChannelId"]
    sc_a = client.post("/subchannels", json={"ChannelId": ch_a, "Name": "De A"}).json()["SubChannelId"]

    # ALTA: nunca 4xx por clasificación — el subcanal ajeno/inexistente se descarta
    for bad in (sc_b, 99999999):
        r = client.post("/pdvs", json={"Name": f"X {_uid()}", "ChannelId": ch_a, "SubChannelId": bad})
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["SubChannelId"] is None and body["ChannelId"] == ch_a and body["_chainPending"] is True
        s0 = SessionLocal()
        ev = _audits(s0, "PDV", body["PdvId"], "PDV_CHAIN_PENDING")
        assert len(ev) == 1 and "descartado" in json.loads(ev[0].PayloadJson)["discarded"][0]
        s0.close()
    # EDICIÓN (interactiva): la validación estricta se mantiene

    p = _pdv(client, ch_a, SubChannelId=sc_a)
    assert client.patch(f"/pdvs/{p['PdvId']}", json={"SubChannelId": sc_b}).status_code == 422
    # cambiar de canal sin mandar subcanal: el viejo se limpia (no queda cruzado)
    r = client.patch(f"/pdvs/{p['PdvId']}", json={"ChannelId": ch_b})
    assert r.status_code == 200 and r.json()["SubChannelId"] is None
    # editar otro campo de una fila legacy inconsistente NO se bloquea
    from app.models import PDV
    s = SessionLocal()
    s.query(PDV).filter(PDV.PdvId == p["PdvId"]).update({PDV.SubChannelId: sc_a})  # canal B + subcanal de A
    s.commit()
    s.close()
    r = client.patch(f"/pdvs/{p['PdvId']}", json={"Name": "Renombrado", "ChannelId": ch_b, "SubChannelId": sc_a})
    assert r.status_code == 200 and r.json()["Name"] == "Renombrado"


def test_pdv_update_chain_rules(client, db):
    ch_id, subs = _channel(client)
    plain_ch, _ = _channel(client, with_buckets=False)
    a = _chain(client, ch_id, StoreCount=5)
    b = _chain(client, ch_id, StoreCount=50)

    # fila legacy del canal sin cadena (creada antes de que existieran cadenas… o por cliente viejo)
    legacy = _pdv(client, ch_id)  # sin clave ChainId → tolerante
    assert legacy["ChainId"] is None
    # editarla sin tocar la cadena no exige nada
    assert client.patch(f"/pdvs/{legacy['PdvId']}", json={"Name": "Legacy 2", "ChainId": None}).status_code == 200

    p = _pdv(client, ch_id, ChainId=a["ChainId"])
    r = client.patch(f"/pdvs/{p['PdvId']}", json={"ChainId": b["ChainId"]})
    assert r.status_code == 200 and r.json()["ChainId"] == b["ChainId"] and r.json()["SubChannelId"] == subs["grande"]
    ev = _audits(db, "PDV", p["PdvId"], "PDV_CHAIN_CHANGE")
    assert len(ev) == 2
    payload = json.loads(ev[-1].PayloadJson)
    assert payload["before"]["ChainId"] == a["ChainId"] and payload["after"]["ChainName"] == b["Name"]

    # no se puede quitar la cadena quedándose en el canal
    assert client.patch(f"/pdvs/{p['PdvId']}", json={"ChainId": None}).status_code == 422
    # un subcanal "a mano" se pisa por el derivado
    r = client.patch(f"/pdvs/{p['PdvId']}", json={"SubChannelId": subs["chica"]})
    assert r.status_code == 200 and r.json()["SubChannelId"] == subs["grande"]

    # mover un PDV común a un canal con cadenas exige cadena (front nuevo)
    q = _pdv(client, plain_ch)
    assert client.patch(f"/pdvs/{q['PdvId']}", json={"ChannelId": ch_id, "ChainId": None}).status_code == 422
    r = client.patch(f"/pdvs/{q['PdvId']}", json={"ChannelId": ch_id, "ChainId": a["ChainId"]})
    assert r.status_code == 200 and r.json()["SubChannelId"] == subs["chica"]
    # sacarlo del canal de cadenas limpia cadena y subcanal
    r = client.patch(f"/pdvs/{q['PdvId']}", json={"ChannelId": plain_ch, "ChainId": None})
    assert r.status_code == 200 and r.json()["ChainId"] is None and r.json()["SubChannelId"] is None


def test_bandera_is_optional_and_keeps_subchannel(client):
    ch_id, _ = _channel(client, with_buckets=False)
    sc = client.post("/subchannels", json={"ChannelId": ch_id, "Name": "De bandera"}).json()["SubChannelId"]
    ypf = _chain(client, ch_id, "YPF", Kind="bandera")
    # sin bandera: OK aunque el front nuevo mande null
    p0 = _pdv(client, ch_id, ChainId=None, SubChannelId=sc)
    assert p0["ChainId"] is None
    p = _pdv(client, ch_id, ChainId=ypf["ChainId"], SubChannelId=sc)
    assert p["ChainKind"] == "bandera" and p["SubChannelId"] == sc
    # la bandera sí se puede quitar
    r = client.patch(f"/pdvs/{p['PdvId']}", json={"ChainId": None})
    assert r.status_code == 200 and r.json()["ChainId"] is None


def test_old_clients_are_never_rejected(client, db):
    """PWA vieja / cola offline: no manda la clave ChainId. El alta entra igual."""
    ch_id, subs = _channel(client)
    chain = _chain(client, ch_id, "Tommy Shop", StoreCount=17, Aliases="Tomyshop, Tommy's shop")
    # (a) subcanal legacy = nombre de la cadena (así cargaba el front viejo) → se deduce
    legacy_sc = client.post("/subchannels", json={"ChannelId": ch_id, "Name": "Tommy's shop"}).json()["SubChannelId"]
    client.delete(f"/subchannels/{legacy_sc}")  # ya desactivado por la migración; el cache viejo lo sigue mandando
    p = _pdv(client, ch_id, SubChannelId=legacy_sc)
    assert p["ChainId"] == chain["ChainId"] and p["SubChannelId"] == subs["mediana"]
    assert json.loads(_audits(db, "PDV", p["PdvId"], "PDV_CHAIN_CHANGE")[0].PayloadJson)["source"] == "alta-subcanal-legacy"
    # (b) sin pista: entra sin cadena, marcado pendiente y auditado
    q = _pdv(client, ch_id)
    assert q["ChainId"] is None and q["_chainPending"] is True
    assert len(_audits(db, "PDV", q["PdvId"], "PDV_CHAIN_PENDING")) == 1
    # …y aparece en el filtro de pendientes de Gestión
    ids = [i["PdvId"] for i in client.get("/pdvs/admin-list", params={"missing_chain": True, "channel_id": ch_id}).json()["items"]]
    assert ids == [q["PdvId"]]


# ── Fusión ───────────────────────────────────────────────────────────

def test_merge_chains(client, db):
    ch_id, subs = _channel(client)
    src = _chain(client, ch_id, "Tomyshop", Aliases="Tomy")
    dst = _chain(client, ch_id, "Tommy Shop", StoreCount=17, IsKeyAccount=True)
    src_pdvs = [_pdv(client, ch_id, ChainId=src["ChainId"]) for _ in range(3)]
    assert src_pdvs[0]["SubChannelId"] == subs["chica"]

    assert client.post(f"/chains/{src['ChainId']}/merge", json={"TargetChainId": src["ChainId"]}).status_code == 422
    assert client.post(f"/chains/{src['ChainId']}/merge", json={"TargetChainId": 99999999}).status_code == 404
    other_ch, _ = _channel(client, with_buckets=False)
    foreign = _chain(client, other_ch)
    assert client.post(f"/chains/{src['ChainId']}/merge", json={"TargetChainId": foreign["ChainId"]}).status_code == 422

    r = client.post(f"/chains/{src['ChainId']}/merge", json={"TargetChainId": dst["ChainId"]})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["ChainId"] == dst["ChainId"] and out["PdvCount"] == 3
    assert out["Aliases"] == "Tomyshop, Tomy"
    for p in src_pdvs:
        d = client.get(f"/pdvs/{p['PdvId']}").json()
        assert d["ChainId"] == dst["ChainId"] and d["IsKeyAccount"] is True
        assert d["SubChannelId"] == subs["mediana"]  # tamaño del destino (17)
    gone = client.get(f"/chains/{src['ChainId']}").json()
    assert gone["IsActive"] is False and gone["PdvCount"] == 0

    for cid in (src["ChainId"], dst["ChainId"]):
        ev = _audits(db, "Chain", cid, "CHAIN_MERGE")
        assert len(ev) == 1
        payload = json.loads(ev[0].PayloadJson)
        assert payload["pdvCount"] == 3 and sorted(payload["pdvIds"]) == sorted(p["PdvId"] for p in src_pdvs)
    # el nombre fusionado sigue matcheando para clientes viejos
    s = SessionLocal()
    assert svc.find_chain_by_text(s, ch_id, "TOMYSHOP").ChainId == dst["ChainId"]
    s.close()


# ── Filtros de Gestión ───────────────────────────────────────────────

def test_admin_list_chain_filters(client):
    ch_id, _ = _channel(client)
    zone = client.post("/zones", json={"Name": f"Z_{_uid()}"}).json()["ZoneId"]
    ka = _chain(client, ch_id, IsKeyAccount=True)
    plain = _chain(client, ch_id)
    other_ch, _ = _channel(client, with_buckets=False)
    p_ka = _pdv(client, ch_id, ChainId=ka["ChainId"], ZoneId=zone)
    p_plain = _pdv(client, ch_id, ChainId=plain["ChainId"], ZoneId=zone)
    p_none = _pdv(client, other_ch, ZoneId=zone)

    def ids(**params):
        r = client.get("/pdvs/admin-list", params={"zone_id": zone, **params})
        assert r.status_code == 200, r.text
        return sorted(i["PdvId"] for i in r.json()["items"])

    assert ids() == sorted([p_ka["PdvId"], p_plain["PdvId"], p_none["PdvId"]])
    assert ids(chain_id=ka["ChainId"]) == [p_ka["PdvId"]]
    assert ids(key_account=True) == [p_ka["PdvId"]]
    assert ids(key_account=False) == sorted([p_plain["PdvId"], p_none["PdvId"]])
    item = client.get("/pdvs/admin-list", params={"zone_id": zone, "chain_id": ka["ChainId"]}).json()["items"][0]
    assert item["ChainName"] == ka["Name"] and item["IsKeyAccount"] is True and item["ChainKind"] == "cadena"
    # /pdvs (lista de campo) también trae la cadena
    lst = client.get("/pdvs", params={"zone_id": zone, "limit": 50}).json()["items"]
    assert {i["PdvId"]: i["ChainName"] for i in lst}[p_plain["PdvId"]] == plain["Name"]
    # admin-ids respeta los mismos filtros
    assert client.get("/pdvs/admin-ids", params={"zone_id": zone, "key_account": True}).json()["ids"] == [p_ka["PdvId"]]


# ── Regresiones de la revisión 2026-11-19 ────────────────────────────

def test_stale_client_edit_does_not_undo_chain_classification(client, db):
    """H1: form viejo/desactualizado (sin clave ChainId) que manda el canal y subcanal
    de ANTES de la migración junto con otro campo: se guarda el campo, la clasificación
    no se toca y queda auditado."""
    ch_id, subs = _channel(client)
    old_ch, _ = _channel(client, with_buckets=False)
    old_sc = client.post("/subchannels", json={"ChannelId": old_ch, "Name": "Key Accounts"}).json()["SubChannelId"]
    chain = _chain(client, ch_id, StoreCount=50)
    p = _pdv(client, ch_id, ChainId=chain["ChainId"])

    r = client.patch(f"/pdvs/{p['PdvId']}", json={"ChannelId": old_ch, "SubChannelId": old_sc, "Address": "Nueva 123"})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["Address"] == "Nueva 123"
    assert (b["ChannelId"], b["SubChannelId"], b["ChainId"]) == (ch_id, subs["grande"], chain["ChainId"])
    ev = _audits(db, "PDV", p["PdvId"], "PDV_CLASS_IGNORED")
    assert len(ev) == 1
    ign = json.loads(ev[0].PayloadJson)["ignored"]
    assert ign["ChannelId"] == {"sent": old_ch, "kept": ch_id} and ign["SubChannelId"]["sent"] == old_sc
    # no hubo cambio de cadena
    assert len(_audits(db, "PDV", p["PdvId"], "PDV_CHAIN_CHANGE")) == 1

    # mandar los valores ACTUALES sin la clave no audita nada (no hay nada que ignorar)
    r = client.patch(f"/pdvs/{p['PdvId']}", json={"ChannelId": ch_id, "SubChannelId": subs["grande"], "City": "X"})
    assert r.status_code == 200 and len(_audits(db, "PDV", p["PdvId"], "PDV_CLASS_IGNORED")) == 1

    # cambio deliberado: cliente que manda la clave ChainId explícita → sí sale de la cadena
    r = client.patch(f"/pdvs/{p['PdvId']}", json={"ChannelId": old_ch, "SubChannelId": old_sc, "ChainId": None})
    assert r.status_code == 200 and r.json()["ChainId"] is None and r.json()["ChannelId"] == old_ch


@pytest.mark.parametrize("name,expected", [
    ("Chica", "chica"), ("Chica (menos de 10 PDVs)", "chica"), ("Mediana(11 a 30)", "mediana"),
    ("  GRANDE  (más de 30 PDVs)", "grande"), ("Chicago Kiosco", None), ("Grande Almacen", None),
    ("Medianas", None), ("Cadena Chica", None), ("", None), (None, None),
])
def test_bucket_key_matches_only_the_designed_names(name, expected):
    assert svc.bucket_key(name) == expected


def test_bucket_subchannel_ignores_lookalike_names(client):
    """M2: "Chicago Kiosco" / "Grande Almacen" no son escalones de tamaño."""
    ch_id, _ = _channel(client, with_buckets=False)
    for n in ("Chicago Kiosco", "Grande Almacen"):  # creados ANTES: ganarían por id
        assert client.post("/subchannels", json={"ChannelId": ch_id, "Name": n}).status_code == 201
    real = {}
    for n in ("Chica (menos de 10 PDVs)", "Grande"):
        real[n.split()[0].lower()] = client.post("/subchannels", json={"ChannelId": ch_id, "Name": n}).json()["SubChannelId"]
    small = _chain(client, ch_id, StoreCount=3)
    big = _chain(client, ch_id, StoreCount=90)
    assert _pdv(client, ch_id, ChainId=small["ChainId"])["SubChannelId"] == real["chica"]
    assert _pdv(client, ch_id, ChainId=big["ChainId"])["SubChannelId"] == real["grande"]


def test_duplicates_consider_aliases_and_reactivation(client):
    """L3: alias cuenta como nombre ocupado; reactivar una fusionada → 409."""
    ch_id, _ = _channel(client)
    dst = _chain(client, ch_id, "Tommy Shop", Aliases="Tommys")
    src = _chain(client, ch_id, "Tomyshop")
    other = _chain(client, ch_id, "Otra")
    # crear / renombrar a un alias de otra cadena activa
    r = client.post("/chains", json={"Name": "tommys", "ChannelId": ch_id})
    assert r.status_code == 409 and "alias" in r.json()["detail"]
    r = client.patch(f"/chains/{other['ChainId']}", json={"Name": "TOMMYS"})
    assert r.status_code == 409 and "alias" in r.json()["detail"]
    # re-guardar la propia cadena con su mismo nombre no choca con sus propios alias
    assert client.patch(f"/chains/{dst['ChainId']}", json={"Name": "Tommy Shop", "StoreCount": 3}).status_code == 200

    assert client.post(f"/chains/{src['ChainId']}/merge", json={"TargetChainId": dst["ChainId"]}).status_code == 200
    r = client.patch(f"/chains/{src['ChainId']}", json={"IsActive": True})
    assert r.status_code == 409 and "Tommy Shop" in r.json()["detail"]
    assert client.get(f"/chains/{src['ChainId']}").json()["IsActive"] is False
    # sacado el alias, sí se reactiva
    assert client.patch(f"/chains/{dst['ChainId']}", json={"Aliases": "Tommys"}).status_code == 200
    assert client.patch(f"/chains/{src['ChainId']}", json={"IsActive": True}).status_code == 200
    # una desactivada sin fusión se reactiva normal
    client.delete(f"/chains/{other['ChainId']}")
    assert client.patch(f"/chains/{other['ChainId']}", json={"IsActive": True}).status_code == 200


def test_unique_violation_maps_to_409(client, monkeypatch):
    """L3: carrera entre dos altas (el chequeo previo no la ve) → 409, no 500."""
    ch_id, _ = _channel(client)
    _chain(client, ch_id, "Carrera")
    monkeypatch.setattr(svc, "find_duplicate", lambda *a, **k: None)
    r = client.post("/chains", json={"Name": "Carrera", "ChannelId": ch_id})
    assert r.status_code == 409, r.text
    other = _chain(client, ch_id, "Otra carrera")
    r = client.patch(f"/chains/{other['ChainId']}", json={"Name": "Carrera"})
    assert r.status_code == 409, r.text


def test_schema_guard_detects_missing_ddl(tmp_path):
    """H4: sin el DDL, schema_problems lista qué falta (lo usan el arranque y /health)."""
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import sessionmaker
    eng = create_engine(f"sqlite:///{tmp_path / 'viejo.db'}")
    with eng.begin() as c:
        c.execute(text('CREATE TABLE "PDV" ("PdvId" INTEGER PRIMARY KEY, "Name" TEXT)'))
    s = sessionmaker(bind=eng)()
    assert svc.schema_problems(s) == ["tabla Chain", "columna PDV.ChainId"]
    with eng.begin() as c:
        c.execute(text('CREATE TABLE "Chain" ("ChainId" INTEGER PRIMARY KEY)'))
        c.execute(text('ALTER TABLE "PDV" ADD COLUMN "ChainId" INTEGER'))
    assert svc.schema_problems(s) == []
    s.close()


def test_health_fails_loudly_when_chain_schema_missing(client, monkeypatch):
    import app.main as main
    assert client.get("/health").json()["checks"]["schema_chains"] == "ok"
    monkeypatch.setattr(main, "_chain_schema_ok", False)
    monkeypatch.setattr(svc, "schema_problems", lambda db: ["columna PDV.ChainId"])
    r = client.get("/health")
    assert r.status_code == 503
    assert "ddl_chains_20261119.py" in r.json()["checks"]["schema_chains"]
