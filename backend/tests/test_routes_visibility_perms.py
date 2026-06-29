"""Regresión de los bugs reportados 2026-06-29 (admin Martin/Rodri):

1. Un manager (territory/regional) crea una ruta SIN asignar y debe poder verla
   (antes: las rutas sin asignar sólo las veía admin → el creador no veía la suya).
2. territory_manager / regional_manager pueden ELIMINAR un PDV (antes: sólo admin).
"""
from datetime import datetime, timezone

import bcrypt
import pytest
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.models import User as UserModel, Role as RoleModel, UserRole as UserRoleModel, PDV as PDVModel
from app.auth import create_access_token


@pytest.fixture()
def db():
    s = sessionmaker(bind=engine)()
    try:
        yield s
    finally:
        s.close()


def _manager(db, role_name):
    """Crea un usuario con el rol dado (sin subordinados) y devuelve (user, token)."""
    role = db.query(RoleModel).filter(RoleModel.Name == role_name).first()
    if not role:
        role = RoleModel(Name=role_name); db.add(role); db.flush()
    u = UserModel(
        Email=f"{role_name}_{datetime.now(timezone.utc).timestamp()}@perm.test",
        DisplayName=f"Mgr {role_name}", PasswordHash=bcrypt.hashpw(b"x", bcrypt.gensalt()).decode(),
        IsActive=True,
    )
    db.add(u); db.flush()
    db.add(UserRoleModel(UserId=u.UserId, RoleId=role.RoleId))
    db.commit(); db.refresh(u)
    return u, create_access_token(subject=u.UserId, role=role_name)


def test_manager_sees_own_unassigned_route(client, db):
    u, token = _manager(db, "territory_manager")
    hdr = {"Authorization": f"Bearer {token}"}
    # Crea ruta SIN AssignedUserId (como el alta admin del front, que no lo manda)
    resp = client.post("/routes", json={"Name": "Palermo TEST", "IsActive": True}, headers=hdr)
    assert resp.status_code == 201, resp.text
    route_id = resp.json()["RouteId"]
    # El creador debe verla en su listado (aunque no la haya asignado)
    listed = client.get("/routes", headers=hdr).json()
    assert any(r["RouteId"] == route_id for r in listed), "el creador debe ver su ruta sin asignar"


def test_territory_manager_can_delete_pdv(client, db):
    u, token = _manager(db, "territory_manager")
    hdr = {"Authorization": f"Bearer {token}"}
    pdv = PDVModel(Name="PDV a borrar", IsActive=True)
    db.add(pdv); db.commit(); db.refresh(pdv)
    resp = client.delete(f"/pdvs/{pdv.PdvId}", headers=hdr)
    assert resp.status_code == 204, f"territory_manager debe poder borrar PDV, got {resp.status_code}: {resp.text}"


def test_regional_manager_can_delete_pdv(client, db):
    u, token = _manager(db, "regional_manager")
    hdr = {"Authorization": f"Bearer {token}"}
    pdv = PDVModel(Name="PDV a borrar 2", IsActive=True)
    db.add(pdv); db.commit(); db.refresh(pdv)
    resp = client.delete(f"/pdvs/{pdv.PdvId}", headers=hdr)
    assert resp.status_code == 204, f"regional_manager debe poder borrar PDV, got {resp.status_code}: {resp.text}"


def test_vendedor_cannot_delete_pdv(client, db):
    """Guardrail: un vendedor (TM rep) NO debe poder borrar PDVs."""
    u, token = _manager(db, "vendedor")
    hdr = {"Authorization": f"Bearer {token}"}
    pdv = PDVModel(Name="PDV protegido", IsActive=True)
    db.add(pdv); db.commit(); db.refresh(pdv)
    resp = client.delete(f"/pdvs/{pdv.PdvId}", headers=hdr)
    assert resp.status_code == 403, f"vendedor NO debe poder borrar PDV, got {resp.status_code}"
