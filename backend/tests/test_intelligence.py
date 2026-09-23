"""Tests de `app/services/intelligence.py` — censo consolidado y motor de oportunidades.

Cubren lo que puede fallar en silencio: la consolidación última-visita-gana
(una visita vieja no debe pisar a una nueva), el corte por scope (un manager no
debe ver PDVs ajenos), y cada una de las 5 reglas del motor — en particular que
R5 (primera colocación) subsuma al resto y que R3 use `Product.IsCapsule` y no
el nombre.

Censo en 3 estados: ausencia de fila = sin dato (NO "no trabaja"). Cada regla
exige el lado Espert relevado explícitamente, los "No" anteriores al corte
histórico (`AppSetting coverage_explicit_no_since`) se descartan antes de
consolidar, y los PDVs con competencia sin dato Espert van a `aCompletar`.
"""
import uuid
from datetime import datetime, timedelta
from statistics import mean

import pytest
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.models import (
    AppSetting as AppSettingModel,
    PDV as PDVModel,
    Product as ProductModel,
    Role as RoleModel,
    User as UserModel,
    UserRole as UserRoleModel,
    Visit as VisitModel,
    VisitCoverage as VisitCoverageModel,
    Zone as ZoneModel,
)
from app.services.coverage_semantics import COVERAGE_CUTOFF_SETTING
from app.services.intelligence import (
    build_map, build_opportunities, build_overview, build_pdv_detail, load_census,
)

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


def _vendedor(db, user):
    """Le da el rol vendedor (lo crea si no existe) para que aparezca en `trades`."""
    role = db.query(RoleModel).filter(RoleModel.Name == "vendedor").first()
    if role is None:
        role = RoleModel(Name="vendedor")
        db.add(role)
        db.flush()
    db.add(UserRoleModel(UserId=user.UserId, RoleId=role.RoleId))
    db.flush()


def _censo(db, pdv, product, works, price=None, opened=DAY, availability=None, user=None,
           created_at=None):
    """`created_at`: fuerza VisitCoverage.CreatedAt (simula filas pre-corte);
    sin él, el server_default now() → siempre posterior al corte de los tests."""
    if user is None:
        user = _user(db)
    v = VisitModel(PdvId=pdv.PdvId, UserId=user.UserId, OpenedAt=opened, Status="CLOSED")
    db.add(v)
    db.flush()
    row = VisitCoverageModel(
        VisitId=v.VisitId, ProductId=product.ProductId,
        Works=works, Price=price, Availability=availability,
    )
    if created_at is not None:
        row.CreatedAt = created_at
    db.add(row)
    db.flush()
    return v


@pytest.fixture()
def cutoff(db):
    """Corte histórico: los "No" anteriores al 2026-09-01 no son dato."""
    value = "2026-09-01T00:00:00+00:00"
    db.add(AppSettingModel(Key=COVERAGE_CUTOFF_SETTING, Value=value))
    db.flush()
    try:
        yield datetime(2026, 9, 1)
    finally:
        db.query(AppSettingModel).filter(AppSettingModel.Key == COVERAGE_CUTOFF_SETTING).delete()
        db.flush()


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
    own = _product(db, f"Milenio Red {_uid()}")
    _censo(db, pdv, comp_caps, works=True, user=u)
    _censo(db, pdv, comp_tabaco, works=True, user=u)
    _censo(db, pdv, own, works=False, user=u)  # Espert relevado: explícitamente no

    rows = _opps_for(load_census(db, {pdv.PdvId}), pdv)
    assert len(rows) == 1
    assert rows[0]["tipo"] == "primera_colocacion"
    assert rows[0]["prioridad"] == "Crítica"


def test_r5_no_dispara_sin_dato_espert_va_a_completar(db):
    comp = _product(db, f"Marlboro X {_uid()}", manufacturer="Massalin", own=False)
    own_a = _product(db, f"Milenio Red {_uid()}")
    own_b = _product(db, f"Milenio Vid {_uid()}", capsule=True)
    pdv = _pdv(db)
    _censo(db, pdv, comp, works=True)  # nada relevado del lado Espert

    result = build_opportunities(load_census(db, {pdv.PdvId}))
    assert [r for r in result["items"] if r["pdvId"] == pdv.PdvId] == []
    assert result["aCompletar"]["count"] == 1
    item = result["aCompletar"]["items"][0]
    assert item["pdvId"] == pdv.PdvId and item["nombre"] == pdv.Name
    assert {"zona", "canal", "trade", "faltan"} <= set(item)
    census = load_census(db, {pdv.PdvId})
    assert item["faltan"] == len(census.catalog_own) >= 2
    assert result["aCompletar"]["porZona"] == {"Sin zona": 1}


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
    # Pink sin relevar: sin dato, no es oportunidad.

    rows = _opps_for(load_census(db, {pdv.PdvId}), pdv, tipo="extension_milenio")
    assert [r["sugerencia"] for r in rows] == ["Ofrecer Milenio Vid"]
    assert "sin relevar" not in rows[0]["detalle"]


def test_r1_no_dispara_sin_variante_relevada(db):
    red = _product(db, "Milenio Red")
    _product(db, "Milenio Icergy", capsule=True)
    pdv = _pdv(db)
    _censo(db, pdv, red, works=True)

    assert _opps_for(load_census(db, {pdv.PdvId}), pdv, tipo="extension_milenio") == []


def test_r2_categoria_solo_competencia(db):
    own_cig = _product(db, f"Milenio Red {_uid()}")
    own_papel = _product(db, f"Blank {_uid()}", category="papelillos")
    comp_papel = _product(db, f"OCB {_uid()}", category="papelillos", manufacturer="Otros", own=False)
    pdv = _pdv(db)
    u = _user(db)
    _censo(db, pdv, own_cig, works=True, user=u)
    _censo(db, pdv, comp_papel, works=True, user=u)
    _censo(db, pdv, own_papel, works=False, user=u)  # Blank relevado: no lo tiene

    rows = _opps_for(load_census(db, {pdv.PdvId}), pdv, tipo="categoria")
    assert len(rows) == 1
    assert "Blank" in rows[0]["sugerencia"]


def test_r2_no_dispara_sin_espert_de_la_categoria_relevado(db):
    own_cig = _product(db, f"Milenio Red {_uid()}")
    _product(db, f"Blank {_uid()}", category="papelillos")
    comp_papel = _product(db, f"OCB {_uid()}", category="papelillos", manufacturer="Otros", own=False)
    pdv = _pdv(db)
    u = _user(db)
    _censo(db, pdv, own_cig, works=True, user=u)
    _censo(db, pdv, comp_papel, works=True, user=u)

    assert _opps_for(load_census(db, {pdv.PdvId}), pdv, tipo="categoria") == []


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
    own_caps = _product(db, f"Milenio Icergy {_uid()}", capsule=True)
    # Capsulado de competencia sin "Caps" en el nombre: solo la columna lo sabe.
    comp_caps = _product(db, f"Red Point ON {_uid()}", manufacturer="Sarandí", own=False, capsule=True)
    pdv = _pdv(db)
    u = _user(db)
    _censo(db, pdv, own_plain, works=True, user=u)
    _censo(db, pdv, comp_caps, works=True, user=u)
    _censo(db, pdv, own_caps, works=False, user=u)  # capsulado Espert relevado: no

    rows = _opps_for(load_census(db, {pdv.PdvId}), pdv, tipo="capsulados")
    assert len(rows) == 1 and rows[0]["prioridad"] == "Alta"


def test_r3_no_dispara_sin_capsulado_espert_relevado(db):
    own_plain = _product(db, f"Milenio Red {_uid()}")
    _product(db, f"Milenio Icergy {_uid()}", capsule=True)
    comp_caps = _product(db, f"Red Point ON {_uid()}", manufacturer="Sarandí", own=False, capsule=True)
    pdv = _pdv(db)
    u = _user(db)
    _censo(db, pdv, own_plain, works=True, user=u)
    _censo(db, pdv, comp_caps, works=True, user=u)

    assert _opps_for(load_census(db, {pdv.PdvId}), pdv, tipo="capsulados") == []


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
    own = _product(db, f"Milenio Red {_uid()}")
    pdv = _pdv(db, zone_id=zone.ZoneId)
    u = _user(db)
    _censo(db, pdv, comp, works=True, user=u)
    _censo(db, pdv, own, works=False, user=u)

    result = build_opportunities(load_census(db, {pdv.PdvId}))
    assert result["total"] == 1
    assert result["porPrioridad"] == {"Crítica": 1}
    assert result["porZona"][zone.Name]["Crítica"] == 1
    assert result["aCompletar"] == {"count": 0, "items": [], "porZona": {}}


# ---------------------------------------------------------------------------
# Corte histórico y completitud
# ---------------------------------------------------------------------------

def test_no_pre_corte_se_ignora(db, cutoff):
    prod = _product(db, f"Milenio Red {_uid()}")
    pdv = _pdv(db)
    _censo(db, pdv, prod, works=False, created_at=cutoff - timedelta(days=30))

    c = load_census(db, {pdv.PdvId})
    assert pdv.PdvId not in c.censados
    assert prod.ProductId not in c.surveyed.get(pdv.PdvId, set())
    assert c.total_relevamientos == 0


def test_no_post_corte_es_dato(db, cutoff):
    prod = _product(db, f"Milenio Red {_uid()}")
    pdv = _pdv(db)
    _censo(db, pdv, prod, works=False, created_at=cutoff + timedelta(days=1))

    c = load_census(db, {pdv.PdvId})
    assert prod.ProductId in c.surveyed[pdv.PdvId]
    assert prod.ProductId not in c.works.get(pdv.PdvId, set())


def test_si_viejo_sobrevive_a_no_pre_corte_mas_nuevo(db, cutoff):
    prod = _product(db, f"Milenio Red {_uid()}")
    pdv = _pdv(db)
    pre = cutoff - timedelta(days=30)
    _censo(db, pdv, prod, works=True, opened=DAY - timedelta(days=10), created_at=pre)
    _censo(db, pdv, prod, works=False, opened=DAY, created_at=pre)  # ambiguo: se descarta

    c = load_census(db, {pdv.PdvId})
    assert prod.ProductId in c.works[pdv.PdvId]


def test_sin_corte_toda_fila_cuenta(db):
    prod = _product(db, f"Milenio Red {_uid()}")
    pdv = _pdv(db)
    _censo(db, pdv, prod, works=False, created_at=datetime(2025, 1, 1))

    c = load_census(db, {pdv.PdvId})
    assert c.cutoff is None
    assert prod.ProductId in c.surveyed[pdv.PdvId]


def test_completitud_por_pdv(db):
    own_a = _product(db, f"Milenio Red {_uid()}")
    _product(db, f"Milenio Vid {_uid()}", capsule=True)
    comp = _product(db, f"Master KS {_uid()}", manufacturer="Sarandí", own=False)
    inactivo = _product(db, f"Viejo {_uid()}")
    inactivo.IsActive = False
    db.flush()
    pdv = _pdv(db)
    u = _user(db)
    _censo(db, pdv, own_a, works=True, user=u)
    _censo(db, pdv, comp, works=False, user=u)
    _censo(db, pdv, inactivo, works=True, user=u)  # fuera del catálogo activo: no suma

    c = load_census(db, {pdv.PdvId})
    assert inactivo.ProductId not in c.catalog_active
    assert c.catalog_own <= c.catalog_active
    assert c.completitud(pdv.PdvId) == round(2 / len(c.catalog_active) * 100, 1)
    assert c.completitud_espert(pdv.PdvId) == round(1 / len(c.catalog_own) * 100, 1)
    # own_known = respondido explícitamente, incluso si el SKU ya no está activo.
    assert c.own_known(pdv.PdvId) == {own_a.ProductId, inactivo.ProductId}
    assert c.completitud(-1) == 0.0  # PDV sin censo


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
    assert {"items", "total", "porTipo", "porZona", "porPrioridad", "aCompletar"} <= set(body)
    assert {"count", "items", "porZona"} <= set(body["aCompletar"])
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
    # Completitud: promedio sobre TODOS los PDVs; `sin` no tiene dato Espert → aCompletar.
    esperado = round(mean(census.completitud(p) for p in scope), 1)
    assert z["completitud"] == ov["resumen"]["completitud"] == esperado
    assert z["completitudEspert"] == round(mean(census.completitud_espert(p) for p in scope), 1)
    assert z["aCompletar"] == ov["resumen"]["aCompletar"] == 1
    assert any(a["tipo"] == "a_completar" for a in ov["alertas"])


def test_overview_completitud_por_trade(db):
    own = _product(db, f"Milenio Red {_uid()}")
    zone = ZoneModel(Name=f"Zona {_uid()}")
    db.add(zone)
    db.flush()
    u = _user(db, zone_id=zone.ZoneId)
    _vendedor(db, u)
    censado = _pdv(db, zone_id=zone.ZoneId, assigned=u.UserId)
    _pdv(db, zone_id=zone.ZoneId, assigned=u.UserId)  # sin censo → pesa 0
    _censo(db, censado, own, works=True, user=u)

    census = load_census(db, {p.PdvId for p in db.query(PDVModel).filter(PDVModel.AssignedUserId == u.UserId)})
    ov = build_overview(db, census, user_scope={u.UserId})
    t = next(r for r in ov["trades"] if r["userId"] == u.UserId)
    assert t["cartera"] == 2
    assert t["completitud"] == round(census.completitud(censado.PdvId) / 2, 1)
    assert t["completitudEspert"] == round(census.completitud_espert(censado.PdvId) / 2, 1)
    assert t["aCompletar"] == 0


# ---------------------------------------------------------------------------
# Ficha de PDV
# ---------------------------------------------------------------------------

def test_pdv_detail_sin_dato_marca_y_corte(db, cutoff):
    own = _product(db, f"Milenio Red {_uid()}")
    own_sin = _product(db, f"Melbourne Mint {_uid()}", capsule=True)
    comp = _product(db, f"Marlboro Box {_uid()}", manufacturer="Massalin", own=False)
    comp_sin = _product(db, f"Kiel {_uid()}", manufacturer="Sarandí", own=False)
    pdv = _pdv(db)
    u = _user(db)
    pre = cutoff - timedelta(days=30)
    _censo(db, pdv, own, works=True, opened=DAY - timedelta(days=10), user=u, created_at=pre)
    _censo(db, pdv, own, works=False, opened=DAY, user=u, created_at=pre)  # No ambiguo: ignorado
    _censo(db, pdv, comp, works=False, user=u)  # No explícito post-corte

    census = load_census(db, {pdv.PdvId})
    d = build_pdv_detail(db, census, pdv.PdvId)
    by_name = {r["producto"]: r for r in d["censo"]}
    assert by_name[own.Name]["trabaja"] is True  # el Sí viejo sobrevive
    assert by_name[own.Name]["marca"] == "Milenio"
    assert by_name[comp.Name]["marca"] == "Marlboro" and by_name[comp.Name]["trabaja"] is False
    assert own_sin.Name in d["sinDato"] and comp_sin.Name in d["sinDato"]
    assert own.Name not in d["sinDato"]
    # Espert primero en sinDato.
    espert_idx = d["sinDato"].index(own_sin.Name)
    comp_idx = d["sinDato"].index(comp_sin.Name)
    assert espert_idx < comp_idx
    assert d["completitud"] == census.completitud(pdv.PdvId)
    assert d["completitudEspert"] == census.completitud_espert(pdv.PdvId)
