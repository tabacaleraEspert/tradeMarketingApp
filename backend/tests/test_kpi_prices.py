"""Tests de los endpoints de higiene de precios del router `/kpi`
(`/kpi/price-matrix`, `/kpi/suspicious-prices`).

Reusan el motor `filter_price_outliers` (kpi_engine.py) — estos tests no
reimplementan la regla de outliers, solo verifican que el router la aplique y
enriquezca la salida correctamente. Patrón de fixtures igual a
test_kpi_router.py / test_kpi_engine.py: sesión directa de DB + tokens ad-hoc.
"""
import uuid
from datetime import datetime, timezone

import bcrypt
import pytest
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.models import (
    User as UserModel,
    Role as RoleModel,
    UserRole as UserRoleModel,
    PDV as PDVModel,
    Product as ProductModel,
    Route as RouteModel,
    RoutePdv as RoutePdvModel,
    Visit as VisitModel,
    VisitCoverage as VisitCoverageModel,
)
from app.auth import create_access_token

YEAR, MONTH = 2026, 3  # mes cerrado en el pasado respecto de "hoy" -> cálculo en vivo


@pytest.fixture()
def db():
    s = sessionmaker(bind=engine)()
    try:
        yield s
    finally:
        s.close()


def _uid():
    return uuid.uuid4().hex[:8]


def _user_with_role(db, role_name, manager_id=None):
    role = db.query(RoleModel).filter(RoleModel.Name == role_name).first()
    if not role:
        role = RoleModel(Name=role_name)
        db.add(role)
        db.flush()
    u = UserModel(
        Email=f"{role_name}_{_uid()}@kpiprices.test",
        DisplayName=f"KpiPrices {role_name}_{_uid()}",
        PasswordHash=bcrypt.hashpw(b"x", bcrypt.gensalt()).decode(),
        IsActive=True,
        ManagerUserId=manager_id,
    )
    db.add(u)
    db.flush()
    db.add(UserRoleModel(UserId=u.UserId, RoleId=role.RoleId))
    db.commit()
    db.refresh(u)
    return u, create_access_token(subject=u.UserId, role=role_name)


def _pdv(db):
    p = PDVModel(Name=f"PDV_{_uid()}", IsActive=True)
    db.add(p)
    db.flush()
    return p


def _product(db, name):
    p = ProductModel(Name=name, Category="Cigarrillos", IsOwn=True, IsActive=True)
    db.add(p)
    db.flush()
    return p


def _focus_route(db, assigned_user_id, pdv_id):
    r = RouteModel(Name=f"R_{_uid()}", IsActive=True, AssignedUserId=assigned_user_id, IsFocus=True)
    db.add(r)
    db.flush()
    db.add(RoutePdvModel(RouteId=r.RouteId, PdvId=pdv_id, SortOrder=1))
    db.flush()
    return r


def _visit_with_price(db, pdv_id, user_id, product_id, price, day=5):
    v = VisitModel(
        PdvId=pdv_id, UserId=user_id, Status="CLOSED",
        OpenedAt=datetime(YEAR, MONTH, day, 10, 0, tzinfo=timezone.utc),
    )
    db.add(v)
    db.flush()
    db.add(VisitCoverageModel(VisitId=v.VisitId, ProductId=product_id, Works=True, Price=price))
    db.flush()
    return v


# ---------------------------------------------------------------------------
# price-matrix
# ---------------------------------------------------------------------------

def test_price_matrix_excluye_outlier_del_promedio(client, db):
    user, token = _user_with_role(db, "vendedor")
    pdv = _pdv(db)
    _focus_route(db, user.UserId, pdv.PdvId)
    product = _product(db, f"Milenio_{_uid()}")

    _visit_with_price(db, pdv.PdvId, user.UserId, product.ProductId, 150, day=1)
    _visit_with_price(db, pdv.PdvId, user.UserId, product.ProductId, 155, day=2)
    _visit_with_price(db, pdv.PdvId, user.UserId, product.ProductId, 145, day=3)
    _visit_with_price(db, pdv.PdvId, user.UserId, product.ProductId, 1500, day=4)  # ~10x mediana
    db.commit()

    hdr = {"Authorization": f"Bearer {token}"}
    resp = client.get(
        "/kpi/price-matrix",
        params={"year": YEAR, "month": MONTH, "group_by": "user", "user_id": user.UserId},
        headers=hdr,
    )
    assert resp.status_code == 200, resp.text
    rows = [r for r in resp.json() if r["productId"] == product.ProductId]
    assert len(rows) == 1
    row = rows[0]
    assert row["n"] == 3
    assert row["max"] == 155
    assert row["avg"] == 150.0


def test_suspicious_prices_incluye_outlier_con_mediana(client, db):
    user, token = _user_with_role(db, "vendedor")
    pdv = _pdv(db)
    _focus_route(db, user.UserId, pdv.PdvId)
    product = _product(db, f"Milenio_{_uid()}")

    _visit_with_price(db, pdv.PdvId, user.UserId, product.ProductId, 150, day=1)
    _visit_with_price(db, pdv.PdvId, user.UserId, product.ProductId, 155, day=2)
    _visit_with_price(db, pdv.PdvId, user.UserId, product.ProductId, 145, day=3)
    _visit_with_price(db, pdv.PdvId, user.UserId, product.ProductId, 1500, day=4)  # ~10x mediana
    db.commit()

    hdr = {"Authorization": f"Bearer {token}"}
    resp = client.get(
        "/kpi/suspicious-prices",
        params={"year": YEAR, "month": MONTH, "user_id": user.UserId},
        headers=hdr,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["price"] == 1500
    assert body[0]["medianPrice"] == 152.5  # mediana de [150,155,145,1500]
    assert body[0]["pdvId"] == pdv.PdvId
    assert body[0]["userId"] == user.UserId


def test_suspicious_prices_user_id_usa_mediana_del_universo_visible(client, db):
    # A2: el baseline de `filter_price_outliers` es el universo visible de quien
    # consulta, no el subconjunto de `user_id` — con solo la muestra de B (n=1,
    # menor a MIN_PRICE_SAMPLES=3) la regla de mediana ni se aplicaría y su outlier
    # nunca se marcaría; comparado contra la mediana del universo (A + B) sí.
    manager, mgr_token = _user_with_role(db, "territory_manager")
    user_a, _ = _user_with_role(db, "vendedor", manager_id=manager.UserId)
    user_b, _ = _user_with_role(db, "vendedor", manager_id=manager.UserId)
    pdv_a = _pdv(db)
    pdv_b = _pdv(db)
    _focus_route(db, user_a.UserId, pdv_a.PdvId)
    _focus_route(db, user_b.UserId, pdv_b.PdvId)
    product = _product(db, f"Milenio_{_uid()}")

    _visit_with_price(db, pdv_a.PdvId, user_a.UserId, product.ProductId, 150, day=1)
    _visit_with_price(db, pdv_a.PdvId, user_a.UserId, product.ProductId, 155, day=2)
    _visit_with_price(db, pdv_a.PdvId, user_a.UserId, product.ProductId, 145, day=3)
    _visit_with_price(db, pdv_b.PdvId, user_b.UserId, product.ProductId, 1500, day=4)  # outlier de B
    db.commit()

    hdr = {"Authorization": f"Bearer {mgr_token}"}
    resp = client.get(
        "/kpi/suspicious-prices",
        params={"year": YEAR, "month": MONTH, "user_id": user_b.UserId},
        headers=hdr,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["userId"] == user_b.UserId
    assert body[0]["price"] == 1500
    assert body[0]["medianPrice"] == 152.5  # mediana del universo visible [150,155,145,1500]


def test_producto_test_excluido_de_matrix_y_suspicious(client, db):
    user, token = _user_with_role(db, "vendedor")
    pdv = _pdv(db)
    _focus_route(db, user.UserId, pdv.PdvId)
    test_product = _product(db, f"TEST_{_uid()}")
    db.commit()

    _visit_with_price(db, pdv.PdvId, user.UserId, test_product.ProductId, 100, day=1)
    db.commit()

    hdr = {"Authorization": f"Bearer {token}"}
    matrix = client.get(
        "/kpi/price-matrix",
        params={"year": YEAR, "month": MONTH, "group_by": "user", "user_id": user.UserId},
        headers=hdr,
    ).json()
    assert all(r["productId"] != test_product.ProductId for r in matrix)

    suspicious = client.get(
        "/kpi/suspicious-prices",
        params={"year": YEAR, "month": MONTH, "user_id": user.UserId},
        headers=hdr,
    ).json()
    assert any(r["productName"] == test_product.Name for r in suspicious)


def test_price_matrix_group_by_route_vs_user(client, db):
    user, token = _user_with_role(db, "vendedor")
    pdv = _pdv(db)
    route = _focus_route(db, user.UserId, pdv.PdvId)
    product = _product(db, f"Milenio_{_uid()}")
    _visit_with_price(db, pdv.PdvId, user.UserId, product.ProductId, 150, day=1)
    db.commit()

    hdr = {"Authorization": f"Bearer {token}"}
    by_user = client.get(
        "/kpi/price-matrix",
        params={"year": YEAR, "month": MONTH, "group_by": "user", "user_id": user.UserId},
        headers=hdr,
    ).json()
    row_user = next(r for r in by_user if r["productId"] == product.ProductId)
    assert row_user["groupId"] == user.UserId

    by_route = client.get(
        "/kpi/price-matrix",
        params={"year": YEAR, "month": MONTH, "group_by": "route", "user_id": user.UserId},
        headers=hdr,
    ).json()
    row_route = next(r for r in by_route if r["productId"] == product.ProductId)
    assert row_route["groupId"] == route.RouteId
    assert row_route["groupName"] == route.Name


def test_price_matrix_vendedor_user_id_ajeno_403(client, db):
    _, token = _user_with_role(db, "vendedor")
    other, _ = _user_with_role(db, "vendedor")
    hdr = {"Authorization": f"Bearer {token}"}
    resp = client.get(
        "/kpi/price-matrix",
        params={"year": YEAR, "month": MONTH, "group_by": "user", "user_id": other.UserId},
        headers=hdr,
    )
    assert resp.status_code == 403


def test_suspicious_prices_vendedor_user_id_ajeno_403(client, db):
    _, token = _user_with_role(db, "vendedor")
    other, _ = _user_with_role(db, "vendedor")
    hdr = {"Authorization": f"Bearer {token}"}
    resp = client.get(
        "/kpi/suspicious-prices",
        params={"year": YEAR, "month": MONTH, "user_id": other.UserId},
        headers=hdr,
    )
    assert resp.status_code == 403


def test_mes_sin_datos_devuelve_listas_vacias(client, db):
    user, token = _user_with_role(db, "vendedor")
    hdr = {"Authorization": f"Bearer {token}"}
    matrix = client.get(
        "/kpi/price-matrix",
        params={"year": YEAR, "month": MONTH, "group_by": "user", "user_id": user.UserId},
        headers=hdr,
    )
    assert matrix.status_code == 200
    assert matrix.json() == []

    suspicious = client.get(
        "/kpi/suspicious-prices",
        params={"year": YEAR, "month": MONTH, "user_id": user.UserId},
        headers=hdr,
    )
    assert suspicious.status_code == 200
    assert suspicious.json() == []
