"""Visibilidad por jerarquía en las vistas admin.

Verifica que un manager solo ve los datos de su sub-árbol (él + descendientes)
y que admin ve todo. Cubre el bug donde Dashboard/Auditoría/Rutas/PDV no
filtraban y cualquiera veía los datos de todos.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import engine
from app.models import User as UserModel, Role as RoleModel, UserRole as UserRoleModel, PDV as PDVModel
from app.models.visit import Visit as VisitModel
from app.auth import create_access_token
from sqlalchemy.orm import sessionmaker

SessionLocal = sessionmaker(bind=engine)


def _uid():
    return uuid.uuid4().hex[:8]


def _role(db, name):
    r = db.query(RoleModel).filter(RoleModel.Name == name).first()
    if not r:
        r = RoleModel(Name=name)
        db.add(r)
        db.flush()
    return r


def _make_user(db, role_name, manager_id=None, zone_id=None):
    u = UserModel(
        Email=f"{role_name}_{_uid()}@test.com",
        DisplayName=f"{role_name} {_uid()}",
        PasswordHash="x",
        IsActive=True,
        ManagerUserId=manager_id,
        ZoneId=zone_id,
    )
    db.add(u)
    db.flush()
    db.add(UserRoleModel(UserId=u.UserId, RoleId=_role(db, role_name).RoleId))
    db.flush()
    return u


def _client_for(user_id):
    token = create_access_token(subject=user_id, role="x")
    return TestClient(app, headers={"Authorization": f"Bearer {token}"})


@pytest.fixture()
def hierarchy(client):
    """Crea: manager(TM) → sub(vendedor); y un outsider(vendedor) ajeno.
    Cada uno con un PDV asignado y una visita. Devuelve ids."""
    db = SessionLocal()
    try:
        ch = client.post("/channels", json={"Name": f"Ch_{_uid()}"}).json()
        manager = _make_user(db, "territory_manager")
        sub = _make_user(db, "vendedor", manager_id=manager.UserId)
        outsider = _make_user(db, "vendedor")  # sin relación con el manager
        db.commit()

        def _pdv_and_visit(owner):
            pdv = PDVModel(Code=f"P-{_uid()}", Name=f"PDV {_uid()}",
                           ChannelId=ch["ChannelId"], AssignedUserId=owner.UserId, IsActive=True)
            db.add(pdv)
            db.flush()
            v = VisitModel(PdvId=pdv.PdvId, UserId=owner.UserId, Status="CLOSED")
            db.add(v)
            db.flush()
            return pdv.PdvId, v.VisitId

        sub_pdv, sub_visit = _pdv_and_visit(sub)
        out_pdv, out_visit = _pdv_and_visit(outsider)
        mgr_pdv, mgr_visit = _pdv_and_visit(manager)
        db.commit()

        # Extraer ids como ints ANTES de cerrar la sesión (evita DetachedInstanceError)
        return {
            "manager": manager.UserId, "sub": sub.UserId, "outsider": outsider.UserId,
            "sub_pdv": sub_pdv, "out_pdv": out_pdv, "mgr_pdv": mgr_pdv,
            "sub_visit": sub_visit, "out_visit": out_visit, "mgr_visit": mgr_visit,
        }
    finally:
        db.close()


class TestHierarchyVisibility:
    def test_manager_pdvs_exclude_outsider(self, hierarchy):
        """El manager ve sus PDVs y los de su subordinado, NO los del outsider."""
        mc = _client_for(hierarchy["manager"])
        resp = mc.get("/pdvs", params={"limit": 200})
        assert resp.status_code == 200
        ids = {p["PdvId"] for p in resp.json()["items"]}
        assert hierarchy["sub_pdv"] in ids
        assert hierarchy["mgr_pdv"] in ids
        assert hierarchy["out_pdv"] not in ids  # ajeno: NO visible

    def test_admin_sees_outsider_pdv_but_manager_403(self, client, hierarchy):
        """Admin abre el PDV del outsider (200); el manager recibe 403.
        (GET por id, robusto ante la paginación del listado.)"""
        out_pdv = hierarchy["out_pdv"]
        assert client.get(f"/pdvs/{out_pdv}").status_code == 200  # admin
        mc = _client_for(hierarchy["manager"])
        assert mc.get(f"/pdvs/{out_pdv}").status_code == 403  # ajeno → bloqueado
        assert mc.get(f"/pdvs/{hierarchy['sub_pdv']}").status_code == 200  # subordinado → OK

    def test_active_users_scoped_to_subtree(self, hierarchy):
        """active-users del manager incluye a él y su sub, no al outsider."""
        mc = _client_for(hierarchy["manager"])
        resp = mc.get("/audit/active-users")
        assert resp.status_code == 200
        uids = {u["UserId"] for u in resp.json()["users"]}
        assert hierarchy["sub"] in uids
        assert hierarchy["outsider"] not in uids

    def test_user_timeline_idor_blocked(self, hierarchy):
        """El manager NO puede ver el timeline de un usuario fuera de su sub-árbol."""
        mc = _client_for(hierarchy["manager"])
        # Su subordinado: OK
        ok = mc.get("/audit/user-timeline", params={"user_id": hierarchy["sub"]})
        assert ok.status_code == 200
        # El outsider: 403
        blocked = mc.get("/audit/user-timeline", params={"user_id": hierarchy["outsider"]})
        assert blocked.status_code == 403

    def test_visit_full_idor_blocked(self, hierarchy):
        """El detalle de una visita ajena devuelve 403 para el manager."""
        mc = _client_for(hierarchy["manager"])
        ok = mc.get(f"/visits/{hierarchy['sub_visit']}/full")
        assert ok.status_code == 200
        blocked = mc.get(f"/visits/{hierarchy['out_visit']}/full")
        assert blocked.status_code == 403

    def test_visits_list_scoped(self, hierarchy):
        """El listado de visitas del manager no incluye la visita del outsider."""
        mc = _client_for(hierarchy["manager"])
        resp = mc.get("/visits", params={"limit": 500})
        assert resp.status_code == 200
        visit_ids = {v["VisitId"] for v in resp.json()}
        assert hierarchy["sub_visit"] in visit_ids
        assert hierarchy["out_visit"] not in visit_ids
