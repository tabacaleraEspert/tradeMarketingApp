"""Material POP real: catálogo (sync + GET), censo con MaterialCode, colocación
(VisitPOPPlacement), KPI "solo Espert" desde oct-2026 y reporte de colocaciones."""
import uuid
from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.auth import create_access_token
from app.config import settings
from app.database import engine
from app.main import app
from app.models import (
    PDV as PDVModel,
    PopMaterial,
    Role as RoleModel,
    Route as RouteModel,
    RoutePdv as RoutePdvModel,
    ScoringCommunicationRule as ScoringCommunicationRuleModel,
    User as UserModel,
    UserRole as UserRoleModel,
    Visit as VisitModel,
    VisitPOPItem,
    VisitPOPPlacement,
    Zone as ZoneModel,
)
from app.models.audit import AuditEvent
from app.services import pop_materials as svc
from app.services.kpi_engine import pdv_communication_scores
from app.services.tmr_dashboard import load_context

SessionLocal = sessionmaker(bind=engine)


def _uid():
    return uuid.uuid4().hex[:8]


@pytest.fixture()
def db():
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


def _role(db, name):
    r = db.query(RoleModel).filter(RoleModel.Name == name).first()
    if not r:
        r = RoleModel(Name=name)
        db.add(r)
        db.flush()
    return r


def _user(db, role_name="vendedor", manager_id=None, zone_id=None):
    u = UserModel(Email=f"{role_name}_{_uid()}@pop.test", DisplayName=f"{role_name} {_uid()}",
                  PasswordHash="x", IsActive=True, ManagerUserId=manager_id, ZoneId=zone_id)
    db.add(u)
    db.flush()
    db.add(UserRoleModel(UserId=u.UserId, RoleId=_role(db, role_name).RoleId))
    db.commit()
    return u


def _client_for(user_id):
    return TestClient(app, headers={"Authorization": f"Bearer {create_access_token(subject=user_id, role='x')}"})


def _pdv(db, zone_id=None, assigned=None):
    p = PDVModel(Name=f"PDV_{_uid()}", IsActive=True, ZoneId=zone_id, AssignedUserId=assigned)
    db.add(p)
    db.commit()
    return p


def _visit(db, pdv_id, user_id, opened_at=None, status="OPEN"):
    v = VisitModel(PdvId=pdv_id, UserId=user_id, OpenedAt=opened_at or datetime(2026, 10, 5, 12), Status=status)
    db.add(v)
    db.commit()
    return v


def _material(db, code=None, desc="ESPERT - CIGARRERA - 2026", active=True, line="ESPERT", type_="CIGARRERA"):
    code = code or f"MKT-{_uid()}"
    db.add(PopMaterial(Code=code, Description=desc, Line=line, Type=type_, Year=2026, IsActive=active))
    db.commit()
    return code


def _payload(*arts):
    return {"generadoEn": "2026-10-08T09:00:00", "articulos": list(arts)}


def _art(code, desc="ESPERT - STOPPER - 2026", **kw):
    return {"codigo": code, "descripcion": desc, "linea": kw.get("linea", "ESPERT"),
            "tipo": kw.get("tipo", "STOPPER"), "anio": kw.get("anio", "2026"),
            "fotoUrl": kw.get("fotoUrl", f"https://x/imagenes/{code}.jpg"), "stock": kw.get("stock", 10)}


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------

@pytest.fixture()
def empty_catalog(db):
    db.query(PopMaterial).delete()
    db.commit()


class TestSync:
    def test_upsert_y_desactiva(self, client, db, empty_catalog, monkeypatch):
        monkeypatch.setattr(svc, "fetch_catalog", lambda: _payload(_art("MKT-000001"), _art("MKT-000002")))
        r = client.post("/pop-materials/sync")
        assert r.status_code == 200, r.text
        assert r.json() == {"Created": 2, "Updated": 0, "Deactivated": 0, "Total": 2}

        # 000001 cambia, 000002 desaparece, 000003 nuevo
        monkeypatch.setattr(svc, "fetch_catalog", lambda: _payload(
            _art("MKT-000001", desc="ESPERT - STOPPER - 2027", anio=2027, stock=3), _art("MKT-000003")))
        r = client.post("/pop-materials/sync")
        assert r.json() == {"Created": 1, "Updated": 1, "Deactivated": 1, "Total": 2}

        db.expire_all()
        m1 = db.get(PopMaterial, "MKT-000001")
        assert (m1.Description, m1.Year, m1.Stock, m1.IsActive) == ("ESPERT - STOPPER - 2027", 2027, 3.0, True)
        assert db.get(PopMaterial, "MKT-000002").IsActive is False  # no se borra

        # Mismo payload otra vez: nada cambia; reaparece 000002 -> reactivado (Updated)
        monkeypatch.setattr(svc, "fetch_catalog", lambda: _payload(
            _art("MKT-000001", desc="ESPERT - STOPPER - 2027", anio=2027, stock=3), _art("MKT-000003"), _art("MKT-000002")))
        r = client.post("/pop-materials/sync")
        assert r.json() == {"Created": 0, "Updated": 1, "Deactivated": 0, "Total": 3}
        db.expire_all()
        assert db.get(PopMaterial, "MKT-000002").IsActive is True

        ev = db.query(AuditEvent).filter(AuditEvent.Entity == "PopMaterial").order_by(AuditEvent.AuditEventId.desc()).first()
        assert ev is not None and ev.Action == "sync"

    def test_respuesta_vacia_no_desactiva(self, client, db, empty_catalog, monkeypatch):
        _material(db, "MKT-000010")
        monkeypatch.setattr(svc, "fetch_catalog", lambda: _payload())
        r = client.post("/pop-materials/sync")
        assert r.status_code == 502
        db.expire_all()
        assert db.get(PopMaterial, "MKT-000010").IsActive is True

    def test_respuesta_malformada(self, client, empty_catalog, monkeypatch):
        monkeypatch.setattr(svc, "fetch_catalog", lambda: {"foo": 1})
        assert client.post("/pop-materials/sync").status_code == 502

    def test_sin_config_503(self, client, monkeypatch):
        monkeypatch.setattr(settings, "comercial_api_url", "")
        monkeypatch.setattr(settings, "comercial_material_api_key", "")
        assert client.post("/pop-materials/sync").status_code == 503

    def test_sync_manual_solo_admin(self, db):
        vend = _user(db, "vendedor")
        assert _client_for(vend.UserId).post("/pop-materials/sync").status_code == 403

    def test_cron_key(self, db, empty_catalog, monkeypatch):
        anon = TestClient(app)
        monkeypatch.setattr(svc, "fetch_catalog", lambda: _payload(_art("MKT-000020")))
        monkeypatch.setattr(settings, "cron_secret", "")
        assert anon.post("/internal/pop-materials/sync", headers={"X-Cron-Key": "x"}).status_code == 503
        monkeypatch.setattr(settings, "cron_secret", "s3cr3t")
        assert anon.post("/internal/pop-materials/sync", headers={"X-Cron-Key": "mal"}).status_code == 401
        assert anon.post("/internal/pop-materials/sync").status_code == 401
        r = anon.post("/internal/pop-materials/sync", headers={"X-Cron-Key": "s3cr3t"})
        assert r.status_code == 200, r.text
        assert r.json()["Created"] == 1
        # El router JWT sigue protegido
        assert anon.post("/pop-materials/sync").status_code == 401

    def test_fetch_catalog_arma_request(self, monkeypatch):
        monkeypatch.setattr(settings, "comercial_api_url", "https://mobiliza.test/")
        monkeypatch.setattr(settings, "comercial_material_api_key", "k3y")
        seen = {}

        class _Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return b'{"generadoEn": "x", "articulos": []}'

        def fake_urlopen(req, timeout):
            seen["url"] = req.full_url
            seen["key"] = req.get_header("X-api-key")
            return _Resp()

        monkeypatch.setattr(svc.urllib.request, "urlopen", fake_urlopen)
        assert svc.fetch_catalog() == {"generadoEn": "x", "articulos": []}
        assert seen == {"url": "https://mobiliza.test/api/public/material", "key": "k3y"}


# ---------------------------------------------------------------------------
# GET /pop-materials
# ---------------------------------------------------------------------------

def test_list_pop_materials_activos_orden_desc(db, empty_catalog):
    _material(db, "MKT-000101")
    _material(db, "MKT-000103")
    _material(db, "MKT-000102", active=False)
    vend = _user(db, "vendedor")
    r = _client_for(vend.UserId).get("/pop-materials")
    assert r.status_code == 200
    data = r.json()
    assert [m["Code"] for m in data] == ["MKT-000103", "MKT-000101"]
    assert set(data[0]) == {"Code", "Description", "Line", "Type", "Year", "PhotoUrl", "Stock", "IsActive"}


def test_list_pop_materials_requiere_auth():
    assert TestClient(app).get("/pop-materials").status_code == 401


# ---------------------------------------------------------------------------
# Censo con MaterialCode
# ---------------------------------------------------------------------------

class TestCensoMaterialCode:
    def test_codigo_valido_completa_nombre(self, client, db):
        code = _material(db, desc="ESPERT - PANTALLA - 2026")
        u = _user(db)
        v = _visit(db, _pdv(db).PdvId, u.UserId)
        r = client.put(f"/visits/{v.VisitId}/pop", json={"items": [
            {"MaterialType": "primario", "MaterialCode": code, "Company": "Espert", "Present": True},
        ]})
        assert r.status_code == 200, r.text
        item = r.json()[0]
        assert item["MaterialCode"] == code
        assert item["MaterialName"] == "ESPERT - PANTALLA - 2026"
        assert client.get(f"/visits/{v.VisitId}/pop").json()[0]["MaterialCode"] == code

    def test_codigo_con_nombre_explicito_respeta_nombre(self, client, db):
        code = _material(db)
        v = _visit(db, _pdv(db).PdvId, _user(db).UserId)
        r = client.put(f"/visits/{v.VisitId}/pop", json={"items": [
            {"MaterialType": "primario", "MaterialCode": code, "MaterialName": "Cigarrera", "Present": True},
        ]})
        assert r.json()[0]["MaterialName"] == "Cigarrera"

    def test_codigo_inexistente_422(self, client, db):
        v = _visit(db, _pdv(db).PdvId, _user(db).UserId)
        r = client.put(f"/visits/{v.VisitId}/pop", json={"items": [
            {"MaterialType": "primario", "MaterialCode": "MKT-NOPE", "Present": True},
        ]})
        assert r.status_code == 422

    def test_sin_codigo_ni_nombre_422(self, client, db):
        v = _visit(db, _pdv(db).PdvId, _user(db).UserId)
        r = client.put(f"/visits/{v.VisitId}/pop", json={"items": [{"MaterialType": "primario", "Present": True}]})
        assert r.status_code == 422

    def test_payload_viejo_sin_codigo(self, client, db):
        v = _visit(db, _pdv(db).PdvId, _user(db).UserId)
        r = client.put(f"/visits/{v.VisitId}/pop", json={"items": [
            {"MaterialType": "secundario", "MaterialName": "Stopper", "Company": "Massalin", "Present": True},
        ]})
        assert r.status_code == 200
        assert r.json()[0]["MaterialCode"] is None


# ---------------------------------------------------------------------------
# Colocación
# ---------------------------------------------------------------------------

class TestPlacements:
    def test_crud_bulk_replace(self, client, db):
        code = _material(db, desc="ESPERT - STOPPER - 2026")
        v = _visit(db, _pdv(db).PdvId, _user(db).UserId)
        url = f"/visits/{v.VisitId}/pop-placements"
        r = client.put(url, json={"items": [
            {"MaterialCode": code, "Quantity": 3, "Location": "Mostrador"},
            {"MaterialName": "Afiche viejo", "Quantity": 1},
        ]})
        assert r.status_code == 200, r.text
        rows = r.json()
        assert [(x["MaterialCode"], x["MaterialName"], x["Quantity"], x["Location"]) for x in rows] == [
            (code, "ESPERT - STOPPER - 2026", 3, "Mostrador"), (None, "Afiche viejo", 1, None)]
        assert set(rows[0]) == {"VisitPOPPlacementId", "VisitId", "MaterialCode", "MaterialName", "Quantity", "Location", "CreatedAt"}

        r = client.put(url, json={"items": [{"MaterialCode": code, "Quantity": 5}]})
        assert len(r.json()) == 1 and r.json()[0]["Quantity"] == 5
        assert len(client.get(url).json()) == 1

        full = client.get(f"/visits/{v.VisitId}/full").json()
        assert full["popPlacements"][0]["MaterialCode"] == code
        assert full["popPlacements"][0]["Line"] == "ESPERT"

        assert client.put(url, json={"items": []}).json() == []

    def test_validaciones(self, client, db):
        v = _visit(db, _pdv(db).PdvId, _user(db).UserId)
        url = f"/visits/{v.VisitId}/pop-placements"
        assert client.put(url, json={"items": [{"MaterialName": "X", "Quantity": 0}]}).status_code == 422
        assert client.put(url, json={"items": [{"MaterialCode": "MKT-NOPE", "Quantity": 1}]}).status_code == 422
        assert client.put(url, json={"items": [{"Quantity": 1}]}).status_code == 422
        too_many = [{"MaterialName": "X", "Quantity": 1}] * 51
        assert client.put(url, json={"items": too_many}).status_code == 422

    def test_visita_cerrada_400(self, client, db):
        v = _visit(db, _pdv(db).PdvId, _user(db).UserId, status="CLOSED")
        r = client.put(f"/visits/{v.VisitId}/pop-placements", json={"items": [{"MaterialName": "X", "Quantity": 1}]})
        assert r.status_code == 400

    def test_visita_inexistente_404(self, client):
        assert client.get("/visits/99999999/pop-placements").status_code == 404

    def test_otro_vendedor_403(self, db):
        owner, other = _user(db), _user(db)
        v = _visit(db, _pdv(db).PdvId, owner.UserId)
        c = _client_for(other.UserId)
        assert c.get(f"/visits/{v.VisitId}/pop-placements").status_code == 403
        assert c.put(f"/visits/{v.VisitId}/pop-placements",
                     json={"items": [{"MaterialName": "X", "Quantity": 1}]}).status_code == 403
        # el dueño sí
        assert _client_for(owner.UserId).put(
            f"/visits/{v.VisitId}/pop-placements", json={"items": [{"MaterialName": "X", "Quantity": 1}]}
        ).status_code == 200

    def test_borrar_visita_borra_colocaciones(self, client, db):
        vid = _visit(db, _pdv(db).PdvId, _user(db).UserId).VisitId
        client.put(f"/visits/{vid}/pop-placements", json={"items": [{"MaterialName": "X", "Quantity": 1}]})
        assert db.query(VisitPOPPlacement).filter(VisitPOPPlacement.VisitId == vid).count() == 1
        assert client.delete(f"/visits/{vid}").status_code == 204
        db.expire_all()
        assert db.query(VisitPOPPlacement).filter(VisitPOPPlacement.VisitId == vid).count() == 0

    def test_borrar_pdv_borra_colocaciones(self, client, db):
        pid = _pdv(db).PdvId
        vid = _visit(db, pid, _user(db).UserId).VisitId
        client.put(f"/visits/{vid}/pop-placements", json={"items": [{"MaterialName": "X", "Quantity": 1}]})
        assert client.delete(f"/pdvs/{pid}").status_code == 204
        db.expire_all()
        assert db.query(VisitPOPPlacement).filter(VisitPOPPlacement.VisitId == vid).count() == 0


# ---------------------------------------------------------------------------
# KPI solo Espert (desde oct-2026)
# ---------------------------------------------------------------------------

def test_is_espert_pop():
    assert svc.is_espert_pop("Espert", None)
    assert svc.is_espert_pop("Massalin, ESPERT", None)
    assert svc.is_espert_pop(None, "MKT-1")
    assert not svc.is_espert_pop("Massalin, BAT", None)
    assert not svc.is_espert_pop(None, None)
    assert not svc.is_espert_pop("Espertino", None)
    assert svc.espert_only_applies(2026, 10) and svc.espert_only_applies(2027, 1)
    assert not svc.espert_only_applies(2026, 9)


def _comm_setup(db):
    user = _user(db)
    pdv = _pdv(db)
    route = RouteModel(Name=f"R_{_uid()}", IsActive=True, AssignedUserId=user.UserId, IsFocus=True)
    db.add(route)
    db.flush()
    db.add(RoutePdvModel(RouteId=route.RouteId, PdvId=pdv.PdvId, SortOrder=1))
    db.add(ScoringCommunicationRuleModel(MaterialType="total", Level="excelente", MinElements=2,
                                         ScopeType="user", ScopeId=user.UserId, ValidFrom=date(2020, 1, 1)))
    db.add(ScoringCommunicationRuleModel(MaterialType="total", Level="regular", MinElements=1,
                                         ScopeType="user", ScopeId=user.UserId, ValidFrom=date(2020, 1, 1)))
    db.commit()
    return user, pdv


def _pop(db, visit_id, name, company=None, code=None, present=True):
    db.add(VisitPOPItem(VisitId=visit_id, MaterialType="primario", MaterialName=name,
                        Company=company, MaterialCode=code, Present=present))
    db.commit()


class TestKpiSoloEspert:
    def test_octubre_cuenta_solo_espert(self, db):
        user, pdv = _comm_setup(db)
        v = _visit(db, pdv.PdvId, user.UserId, datetime(2026, 10, 5, 12), status="CLOSED")
        _pop(db, v.VisitId, "Cigarrera", company="Massalin")
        _pop(db, v.VisitId, "Stopper", company="BAT")
        _pop(db, v.VisitId, "Pantalla", company="Massalin, Espert")
        assert pdv_communication_scores(db, user.UserId, 2026, 10)[pdv.PdvId] == "regular"  # 1 Espert

    def test_octubre_codigo_cuenta_aunque_company_vacia(self, db):
        user, pdv = _comm_setup(db)
        code = _material(db)
        v = _visit(db, pdv.PdvId, user.UserId, datetime(2026, 10, 5, 12), status="CLOSED")
        _pop(db, v.VisitId, "X", code=code)
        _pop(db, v.VisitId, "Afiche", company="Espert")
        assert pdv_communication_scores(db, user.UserId, 2026, 10)[pdv.PdvId] == "excelente"

    def test_octubre_solo_competencia_relevado_pero_no_cuenta(self, db):
        user, pdv = _comm_setup(db)
        v = _visit(db, pdv.PdvId, user.UserId, datetime(2026, 10, 5, 12), status="CLOSED")
        _pop(db, v.VisitId, "Cigarrera", company="Massalin")
        assert pdv_communication_scores(db, user.UserId, 2026, 10)[pdv.PdvId] == "no_cuenta"

    def test_septiembre_sigue_contando_todo(self, db):
        user, pdv = _comm_setup(db)
        v = _visit(db, pdv.PdvId, user.UserId, datetime(2026, 9, 5, 12), status="CLOSED")
        _pop(db, v.VisitId, "Cigarrera", company="Massalin")
        _pop(db, v.VisitId, "Stopper", company="BAT")
        assert pdv_communication_scores(db, user.UserId, 2026, 9)[pdv.PdvId] == "excelente"

    def test_tmr_con_material(self, db):
        user = _user(db)
        p_comp, p_esp = _pdv(db), _pdv(db)
        v1 = _visit(db, p_comp.PdvId, user.UserId, datetime(2026, 10, 6, 12), status="CLOSED")
        _pop(db, v1.VisitId, "Cigarrera", company="Massalin")
        v2 = _visit(db, p_esp.PdvId, user.UserId, datetime(2026, 10, 6, 13), status="CLOSED")
        _pop(db, v2.VisitId, "Stopper", company="Espert")
        ctx = load_context(db, [user.UserId], 2026, 10, with_coverage=False)
        assert (user.UserId, p_esp.PdvId) in ctx.pdvs_with_material
        assert (user.UserId, p_comp.PdvId) not in ctx.pdvs_with_material

        v3 = _visit(db, p_comp.PdvId, user.UserId, datetime(2026, 9, 6, 12), status="CLOSED")
        _pop(db, v3.VisitId, "Cigarrera", company="Massalin")
        ctx_sep = load_context(db, [user.UserId], 2026, 9, with_coverage=False)
        assert (user.UserId, p_comp.PdvId) in ctx_sep.pdvs_with_material


# ---------------------------------------------------------------------------
# Reporte de colocaciones
# ---------------------------------------------------------------------------

class TestReport:
    def _seed(self, client, db):
        zone = ZoneModel(Name=f"Z_{_uid()}")
        db.add(zone)
        db.commit()
        manager = _user(db, "territory_manager")
        sub = _user(db, "vendedor", manager_id=manager.UserId)
        outsider = _user(db, "vendedor")
        code = _material(db, desc="ESPERT - STOPPER - 2026", line="ESPERT", type_="STOPPER")
        p1 = _pdv(db, zone_id=zone.ZoneId, assigned=sub.UserId)
        p2 = _pdv(db, assigned=outsider.UserId)
        v1 = _visit(db, p1.PdvId, sub.UserId, datetime(2026, 10, 5, 12))
        v2 = _visit(db, p2.PdvId, outsider.UserId, datetime(2026, 10, 6, 12))
        client.put(f"/visits/{v1.VisitId}/pop-placements", json={"items": [{"MaterialCode": code, "Quantity": 2, "Location": "Vidriera"}]})
        client.put(f"/visits/{v2.VisitId}/pop-placements", json={"items": [{"MaterialName": "Afiche", "Quantity": 1}]})
        return zone, manager, sub, outsider, code, p1, v1, v2

    def test_admin_filtros_y_campos(self, client, db):
        zone, manager, sub, outsider, code, p1, v1, v2 = self._seed(client, db)
        r = client.get("/reports/pop-placements", params={"zone_id": zone.ZoneId})
        assert r.status_code == 200, r.text
        rows = r.json()
        assert len(rows) == 1
        row = rows[0]
        assert row == {
            "VisitId": v1.VisitId, "Date": row["Date"], "UserId": sub.UserId, "UserName": sub.DisplayName,
            "PdvId": p1.PdvId, "PdvName": p1.Name, "ZoneName": zone.Name, "MaterialCode": code,
            "MaterialName": "ESPERT - STOPPER - 2026", "Line": "ESPERT", "Type": "STOPPER",
            "Quantity": 2, "Location": "Vidriera",
        }
        ids = {x["VisitId"] for x in client.get("/reports/pop-placements", params={"user_id": outsider.UserId}).json()}
        assert ids == {v2.VisitId}
        ids = {x["VisitId"] for x in client.get(
            "/reports/pop-placements", params={"date_from": "2026-10-06", "date_to": "2026-10-06"}).json()}
        assert v2.VisitId in ids and v1.VisitId not in ids
        assert client.get("/reports/pop-placements", params={"date_from": "nope"}).status_code == 422

    def test_manager_ve_solo_su_subarbol(self, client, db):
        zone, manager, sub, outsider, code, p1, v1, v2 = self._seed(client, db)
        ids = {x["VisitId"] for x in _client_for(manager.UserId).get("/reports/pop-placements").json()}
        assert v1.VisitId in ids and v2.VisitId not in ids

    def test_vendedor_403(self, db):
        assert _client_for(_user(db).UserId).get("/reports/pop-placements").status_code == 403


def test_auditoria_timeline_incluye_colocacion(client, db):
    u = _user(db)
    vid = _visit(db, _pdv(db).PdvId, u.UserId).VisitId
    client.put(f"/visits/{vid}/pop-placements", json={"items": [{"MaterialName": "Stopper", "Quantity": 4, "Location": "Caja"}]})
    events = client.get("/audit/user-timeline", params={"user_id": u.UserId}).json()["events"]
    ev = [e for e in events if e["type"] == "pop_placement"]
    assert len(ev) == 1 and ev[0]["visitId"] == vid and "4 × Stopper" in ev[0]["detail"]


# ---------------------------------------------------------------------------
# Fixes de la revisión (2026-10-08)
# ---------------------------------------------------------------------------

def test_censo_descripcion_larga_se_recorta_a_80(client, db):
    desc = "ESPERT - " + "X" * 120 + " - 2026"
    code = _material(db, desc=desc)
    u = _user(db)
    v = _visit(db, _pdv(db).PdvId, u.UserId)
    r = client.put(f"/visits/{v.VisitId}/pop", json={"items": [
        {"MaterialType": "secundario", "MaterialCode": code, "MaterialName": desc, "Company": "Espert", "Present": True},
    ]})
    assert r.status_code == 200, r.text
    assert r.json()[0]["MaterialName"] == desc[:80]


def test_sync_respuesta_parcial_no_desactiva_masivo(client, db, empty_catalog, monkeypatch):
    arts = [_art(f"MKT-{n:06d}") for n in range(1, 31)]
    monkeypatch.setattr(svc, "fetch_catalog", lambda: _payload(*arts))
    assert client.post("/pop-materials/sync").status_code == 200
    monkeypatch.setattr(svc, "fetch_catalog", lambda: _payload(*arts[:5]))
    r = client.post("/pop-materials/sync")
    assert r.status_code == 502, r.text
    db.expire_all()
    assert db.query(PopMaterial).filter(PopMaterial.IsActive == True).count() == 30  # noqa: E712


@pytest.mark.parametrize("month,photo_type,expected", [
    (10, "pop_Cigarrera aérea_Massalin", 0),   # oct: foto de competencia no cuenta
    (10, "pop_MKT-000211_Espert", 1),         # oct: foto Espert cuenta
    (9, "pop_Cigarrera aérea_Massalin", 1),   # sep: regla vieja (cualquier pop%)
])
def test_kpi4_foto_solo_espert_desde_octubre(db, month, photo_type, expected):
    from app.models import File, VisitPhoto
    from app.services.kpi_engine import _kpi4_pop
    user, pdv = _comm_setup(db)
    v = _visit(db, pdv.PdvId, user.UserId, datetime(2026, month, 5, 12), status="CLOSED")
    f = File(BlobKey=f"t/{_uid()}.jpg")
    db.add(f); db.flush()
    db.add(VisitPhoto(VisitId=v.VisitId, FileId=f.FileId, PhotoType=photo_type))
    db.commit()
    num, _ = _kpi4_pop(db, user.UserId, {pdv.PdvId: "bueno"}, {pdv.PdvId},
                       datetime(2026, month, 1), datetime(2026, month + 1, 1))
    assert num == expected
