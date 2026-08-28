"""Tests de `app/services/intelligence.py` — censo consolidado y motor de oportunidades.

Cubren lo que puede fallar en silencio: la consolidación última-visita-gana
(una visita vieja no debe pisar a una nueva), el corte por scope (un manager no
debe ver PDVs ajenos), y cada una de las 5 reglas del motor — en particular que
R5 (primera colocación) subsuma al resto y que R3 use `Product.IsCapsule` y no
el nombre.
"""
import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.models import (
    PDV as PDVModel,
    Product as ProductModel,
    User as UserModel,
    Visit as VisitModel,
    VisitCoverage as VisitCoverageModel,
    Zone as ZoneModel,
)
from app.services.intelligence import build_map, build_opportunities, build_overview, load_census

DAY = datetime(2026, 8, 10, 12, 0, 0)


@pytest.fixture()
def db():
    SessionLocal = sessionmaker(bind=engine)
    s = SessionLocal()
    try:
        yield s
    finally:
        s.rollback()
        s.close()


def _uid():
    return uuid.uuid4().hex[:8]


def _product(db, name, category="cigarrillos", manufacturer="Espert", own=True, capsule=False):
    p = ProductModel(
        Name=name, Category=category, Manufacturer=manufacturer,
        IsOwn=own, IsCapsule=capsule, IsActive=True,
    )
    db.add(p)
    db.flush()
    return p


def _pdv(db, zone_id=None, lat=None, lon=None, assigned=None):
    p = PDVModel(
        Name=f"PDV_{_uid()}", IsActive=True, ZoneId=zone_id,
        Lat=lat, Lon=lon, AssignedUserId=assigned,
    )
    db.add(p)
    db.flush()
    return p


def _user(db, zone_id=None):
    u = UserModel(
        Email=f"u_{_uid()}@intel.test", DisplayName=f"Trade {_uid()}",
        PasswordHash="x", IsActive=True, ZoneId=zone_id,
    )
    db.add(u)
    db.flush()
    return u


def _censo(db, pdv, product, works, price=None, opened=DAY, availability=None, user=None):
    if user is None:
        user = _user(db)
    v = VisitModel(PdvId=pdv.PdvId, UserId=user.UserId, OpenedAt=opened, Status="CLOSED")
    db.add(v)
    db.flush()
    db.add(VisitCoverageModel(
        VisitId=v.VisitId, ProductId=product.ProductId,
        Works=works, Price=price, Availability=availability,
    ))
    db.flush()
    return v


def _opps_for(census, pdv, tipo=None):
    rows = [r for r in build_opportunities(census)["items"] if r["pdvId"] == pdv.PdvId]
    return [r for r in rows if r["tipo"] == tipo] if tipo else rows


# ---------------------------------------------------------------------------
# Censo consolidado
# ---------------------------------------------------------------------------

def test_consolidacion_gana_la_visita_mas_reciente(db):
    prod = _product(db, f"Milenio Red {_uid()}")
    pdv = _pdv(db)
    _censo(db, pdv, prod, works=True, opened=DAY - timedelta(days=10))
    _censo(db, pdv, prod, works=False, opened=DAY)  # el último censo dice que ya no

    c = load_census(db, {pdv.PdvId})
    assert prod.ProductId not in c.works.get(pdv.PdvId, set())
    assert prod.ProductId in c.surveyed[pdv.PdvId]
    assert pdv.PdvId in c.censados


def test_scope_excluye_pdvs_ajenos(db):
    prod = _product(db, f"Milenio Red {_uid()}")
    mio, ajeno = _pdv(db), _pdv(db)
    _censo(db, mio, prod, works=True)
    _censo(db, ajeno, prod, works=True)

    c = load_census(db, {mio.PdvId})
    assert mio.PdvId in c.pdvs and ajeno.PdvId not in c.pdvs
    assert ajeno.PdvId not in c.censados


def test_productos_test_excluidos(db):
    prod = _product(db, f"TEST_{_uid()}")
    pdv = _pdv(db)
    _censo(db, pdv, prod, works=True)

    c = load_census(db, {pdv.PdvId})
    assert prod.ProductId not in c.products
    assert pdv.PdvId not in c.censados


# ---------------------------------------------------------------------------
# Motor de oportunidades
# ---------------------------------------------------------------------------

def test_r5_primera_colocacion_subsume_al_resto(db):
    comp_caps = _product(db, f"Marlboro X {_uid()}", manufacturer="Massalin", own=False, capsule=True)
    comp_tabaco = _product(db, f"Tabaco Comp {_uid()}", category="tabacos", manufacturer="CyT", own=False)
    pdv = _pdv(db)
    u = _user(db)
    _censo(db, pdv, comp_caps, works=True, user=u)
    _censo(db, pdv, comp_tabaco, works=True, user=u)

    rows = _opps_for(load_census(db, {pdv.PdvId}), pdv)
    assert len(rows) == 1
    assert rows[0]["tipo"] == "primera_colocacion"
    assert rows[0]["prioridad"] == "Crítica"


def test_r1_extension_milenio_una_por_variante_faltante(db):
    red = _product(db, "Milenio Red")
    icergy = _product(db, "Milenio Icergy", capsule=True)
    vid = _product(db, "Milenio Vid", capsule=True)
    _product(db, "Milenio Pink", capsule=True)
    pdv = _pdv(db)
    u = _user(db)
    _censo(db, pdv, red, works=True, user=u)
    _censo(db, pdv, icergy, works=True, user=u)   # Icergy ya lo trabaja
    _censo(db, pdv, vid, works=False, user=u)     # Vid relevado, no lo trabaja

    rows = _opps_for(load_census(db, {pdv.PdvId}), pdv, tipo="extension_milenio")
    faltantes = {r["sugerencia"] for r in rows}
    assert faltantes == {"Ofrecer Milenio Vid", "Ofrecer Milenio Pink"}


def test_r2_categoria_solo_competencia(db):
    own_cig = _product(db, f"Milenio Red {_uid()}")
    comp_papel = _product(db, f"OCB {_uid()}", category="papelillos", manufacturer="Otros", own=False)
    pdv = _pdv(db)
    u = _user(db)
    _censo(db, pdv, own_cig, works=True, user=u)
    _censo(db, pdv, comp_papel, works=True, user=u)

    rows = _opps_for(load_census(db, {pdv.PdvId}), pdv, tipo="categoria")
    assert len(rows) == 1
    assert "Blank" in rows[0]["sugerencia"]


def test_r2_no_dispara_si_espert_ya_esta_en_la_categoria(db):
    own_cig = _product(db, f"Milenio Red {_uid()}")
    own_tabaco = _product(db, f"Van Kiff {_uid()}", category="tabacos")
    comp_tabaco = _product(db, f"Tabaco Comp {_uid()}", category="tabacos", manufacturer="CyT", own=False)
    pdv = _pdv(db)
    u = _user(db)
    _censo(db, pdv, own_cig, works=True, user=u)
    _censo(db, pdv, own_tabaco, works=True, user=u)
    _censo(db, pdv, comp_tabaco, works=True, user=u)

    assert _opps_for(load_census(db, {pdv.PdvId}), pdv, tipo="categoria") == []


def test_r3_capsulados_usa_la_columna_no_el_nombre(db):
    own_plain = _product(db, f"Milenio Red {_uid()}")
    # Capsulado de competencia sin "Caps" en el nombre: solo la columna lo sabe.
    comp_caps = _product(db, f"Red Point ON {_uid()}", manufacturer="Sarandí", own=False, capsule=True)
    pdv = _pdv(db)
    u = _user(db)
    _censo(db, pdv, own_plain, works=True, user=u)
    _censo(db, pdv, comp_caps, works=True, user=u)

    rows = _opps_for(load_census(db, {pdv.PdvId}), pdv, tipo="capsulados")
    assert len(rows) == 1 and rows[0]["prioridad"] == "Alta"


def test_r3_no_dispara_con_capsulado_espert_colocado(db):
    own_caps = _product(db, f"Milenio Icergy {_uid()}", capsule=True)
    comp_caps = _product(db, f"Red Point ON {_uid()}", manufacturer="Sarandí", own=False, capsule=True)
    pdv = _pdv(db)
    u = _user(db)
    _censo(db, pdv, own_caps, works=True, user=u)
    _censo(db, pdv, comp_caps, works=True, user=u)

    assert _opps_for(load_census(db, {pdv.PdvId}), pdv, tipo="capsulados") == []


def test_r4_franja_descubierta(db):
    # Espert en franja media (2400), competencia en económica (1800): el PDV
    # trabaja ambos → la franja económica queda cubierta solo por competencia.
    own_media = _product(db, f"Milenio Icergy {_uid()}")
    comp_eco = _product(db, f"Kiel {_uid()}", manufacturer="Sarandí", own=False)
    pdv = _pdv(db)
    u = _user(db)
    _censo(db, pdv, own_media, works=True, price=2400, user=u)
    _censo(db, pdv, comp_eco, works=True, price=1800, user=u)

    rows = _opps_for(load_census(db, {pdv.PdvId}), pdv, tipo="franja_precio")
    assert len(rows) == 1
    assert "económica" in rows[0]["detalle"].lower()


def test_r4_no_dispara_si_espert_cubre_la_franja(db):
    own_eco = _product(db, f"Melbourne Red {_uid()}")
    comp_eco = _product(db, f"Kiel {_uid()}", manufacturer="Sarandí", own=False)
    pdv = _pdv(db)
    u = _user(db)
    _censo(db, pdv, own_eco, works=True, price=1800, user=u)
    _censo(db, pdv, comp_eco, works=True, price=1900, user=u)

    assert _opps_for(load_census(db, {pdv.PdvId}), pdv, tipo="franja_precio") == []


def test_agregados_del_motor(db):
    comp = _product(db, f"Master KS {_uid()}", manufacturer="Sarandí", own=False)
    zone = ZoneModel(Name=f"Zona {_uid()}")
    db.add(zone)
    db.flush()
    pdv = _pdv(db, zone_id=zone.ZoneId)
    _censo(db, pdv, comp, works=True)

    result = build_opportunities(load_census(db, {pdv.PdvId}))
    assert result["total"] == 1
    assert result["porPrioridad"] == {"Crítica": 1}
    assert result["porZona"][zone.Name]["Crítica"] == 1


# ---------------------------------------------------------------------------
# Mapa y overview
# ---------------------------------------------------------------------------

def test_map_estados_y_puntos(db):
    own = _product(db, f"Milenio Red {_uid()}")
    comp = _product(db, f"Master KS {_uid()}", manufacturer="Sarandí", own=False)
    con_espert = _pdv(db, lat=-38.0, lon=-57.5)
    sin_espert = _pdv(db, lat=-38.1, lon=-57.6)
    sin_censo = _pdv(db, lat=-38.2, lon=-57.7)
    sin_coords = _pdv(db)
    u = _user(db)
    _censo(db, con_espert, own, works=True, user=u)
    _censo(db, sin_espert, comp, works=True, user=u)

    scope = {con_espert.PdvId, sin_espert.PdvId, sin_censo.PdvId, sin_coords.PdvId}
    result = build_map(db, load_census(db, scope))
    status_by_pdv = {p[0]: p[4] for p in result["puntos"]}
    assert status_by_pdv[con_espert.PdvId] == 2
    assert status_by_pdv[sin_espert.PdvId] == 1
    assert status_by_pdv[sin_censo.PdvId] == 0
    assert sin_coords.PdvId not in status_by_pdv
    assert result["counts"] == {"espert": 1, "censadoSin": 1, "sinCenso": 1}


def test_endpoints_responden_como_admin(client):
    ov = client.get("/intelligence/overview")
    assert ov.status_code == 200
    assert {"resumen", "zonas", "competencia", "portfolio", "trades", "alertas"} <= set(ov.json())

    opps = client.get("/intelligence/opportunities?page=1&page_size=10")
    assert opps.status_code == 200
    body = opps.json()
    assert {"items", "total", "porTipo", "porZona", "porPrioridad"} <= set(body)
    assert len(body["items"]) <= 10

    mp = client.get("/intelligence/map")
    assert mp.status_code == 200
    assert {"zonas", "puntos", "counts"} <= set(mp.json())


def test_overview_resumen_y_zonas(db):
    own = _product(db, f"Milenio Red {_uid()}")
    comp = _product(db, f"Master KS {_uid()}", manufacturer="Sarandí", own=False)
    zone = ZoneModel(Name=f"Zona {_uid()}")
    db.add(zone)
    db.flush()
    con = _pdv(db, zone_id=zone.ZoneId)
    sin = _pdv(db, zone_id=zone.ZoneId)
    u = _user(db, zone_id=zone.ZoneId)
    _censo(db, con, own, works=True, user=u)
    _censo(db, sin, comp, works=True, user=u)

    scope = {con.PdvId, sin.PdvId}
    census = load_census(db, scope)
    ov = build_overview(db, census, user_scope={u.UserId})
    assert ov["resumen"]["pdvsActivos"] == 2
    assert ov["resumen"]["censados"] == 2
    assert ov["resumen"]["conEspert"] == 1
    assert ov["resumen"]["cobertura"] == 50.0
    z = next(r for r in ov["zonas"] if r["zonaId"] == zone.ZoneId)
    assert z["censados"] == 2 and z["conEspert"] == 1
    # El fabricante de la competencia aparece en la presencia de la zona.
    assert "Sarandí" in ov["competencia"][zone.Name]["presencia"]
