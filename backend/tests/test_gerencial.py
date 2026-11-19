"""Tests de `app/services/gerencial.py` — vista gerencial de Inteligencia.

Lo que protegen:

1. **El embudo** Rastrillado → En ruta foco → Visitados → Efectivos, con la
   definición del negocio: efectivo = visita cerrada + cobertura Regular o más +
   comunicación Regular o más, SIN exigir acciones.
2. **El universo foco**: rutas de campaña, vencidas o no foco no cuentan.
3. **El período**: meses no contiguos se resuelven juntos y un PDV visitado en
   dos meses cuenta una sola vez.

La base de tests es compartida entre archivos, así que todos los asserts filtran
por `user_id` (la cartera del vendedor creado en el test) y las reglas de
scoring se crean con alcance `user`, que le gana a cualquier regla global.
"""
import uuid
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.models import (
    AppSetting as AppSettingModel,
    PDV as PDVModel,
    Holiday as HolidayModel,
    Product as ProductModel,
    Role as RoleModel,
    Route as RouteModel,
    RouteDay as RouteDayModel,
    RouteDayPdv as RouteDayPdvModel,
    RoutePdv as RoutePdvModel,
    ScoringCommunicationRule as CommRuleModel,
    ScoringCoverageRule as CovRuleModel,
    User as UserModel,
    UserRole as UserRoleModel,
    Visit as VisitModel,
    VisitAction as VisitActionModel,
    VisitCoverage as VisitCoverageModel,
    VisitPOPItem as VisitPOPItemModel,
    Zone as ZoneModel,
)
from app.services import gerencial as G
from app.services.coverage_semantics import COVERAGE_CUTOFF_SETTING

# Meses pasados y no contiguos: no dependen del día en que corre el test.
APR = (2026, 4)
FEB = (2026, 2)
DAY_APR = datetime(2026, 4, 15, 15, 0, 0)
DAY_FEB = datetime(2026, 2, 10, 15, 0, 0)


@pytest.fixture()
def db():
    s = sessionmaker(bind=engine)()
    try:
        yield s
    finally:
        s.rollback()
        s.close()


def _uid():
    return uuid.uuid4().hex[:8]


def _zone(db):
    z = ZoneModel(Name=f"Zona_{_uid()}")
    db.add(z)
    db.flush()
    return z


def _rep(db, zone_id=None):
    """Vendedor con reglas propias: Regular = 1 SKU de cigarrillos y 1 material."""
    u = UserModel(
        Email=f"g_{_uid()}@ger.test", DisplayName=f"Rep {_uid()}",
        PasswordHash="x", IsActive=True, ZoneId=zone_id,
    )
    db.add(u)
    db.flush()
    role = db.query(RoleModel).filter(RoleModel.Name == "vendedor").first()
    if role is None:
        role = RoleModel(Name="vendedor")
        db.add(role)
        db.flush()
    db.add(UserRoleModel(UserId=u.UserId, RoleId=role.RoleId))
    # La rúbrica real define los cuatro niveles; con uno solo, `_coverage_level`
    # daría "excelente" a un PDV sin productos (no encuentra reglas que incumplir).
    for n, level in enumerate(("regular", "bueno", "muy_bueno", "excelente"), start=1):
        for brand in ("Milenio", "Total cigs"):
            db.add(CovRuleModel(
                Brand=brand, Level=level, MinSkus=n, ScopeType="user", ScopeId=u.UserId,
                ValidFrom=date(2020, 1, 1), ValidTo=None,
            ))
        db.add(CommRuleModel(
            MaterialType="total", Level=level, MinElements=n, ScopeType="user", ScopeId=u.UserId,
            ValidFrom=date(2020, 1, 1), ValidTo=None,
        ))
    db.flush()
    return u


def _pdv(db, user=None, zone_id=None):
    p = PDVModel(
        Name=f"PDV_{_uid()}", IsActive=True, ZoneId=zone_id,
        AssignedUserId=user.UserId if user else None,
    )
    db.add(p)
    db.flush()
    return p


def _route(db, user, pdvs, **kwargs):
    kwargs.setdefault("IsFocus", True)
    r = RouteModel(Name=f"R_{_uid()}", IsActive=True, AssignedUserId=user.UserId, **kwargs)
    db.add(r)
    db.flush()
    for i, p in enumerate(pdvs):
        db.add(RoutePdvModel(RouteId=r.RouteId, PdvId=p.PdvId, SortOrder=i))
    db.flush()
    return r


def _visit(db, pdv, user, opened=DAY_APR, status="CLOSED", minutes=10):
    v = VisitModel(
        PdvId=pdv.PdvId, UserId=user.UserId, OpenedAt=opened, Status=status,
        ClosedAt=opened + timedelta(minutes=minutes) if status == "CLOSED" else None,
    )
    db.add(v)
    db.flush()
    return v


@pytest.fixture()
def milenio(db):
    pr = ProductModel(Name=f"Milenio Test {_uid()}", Category="Cigarrillos", IsOwn=True, IsActive=True)
    db.add(pr)
    db.flush()
    return pr


def _cov(db, visit, product, works=True):
    db.add(VisitCoverageModel(
        VisitId=visit.VisitId, ProductId=product.ProductId, Works=works, CreatedAt=visit.OpenedAt,
    ))
    db.flush()


def _pop(db, visit, present=True, company="Espert"):
    db.add(VisitPOPItemModel(
        VisitId=visit.VisitId, MaterialType="afiche", MaterialName=f"Afiche {_uid()}",
        Company=company, Present=present,
    ))
    db.flush()


def _embudo(db, rep, months=(APR,)):
    return G.build_universo(db, list(months), user_id=rep.UserId)["embudo"]


# ---------------------------------------------------------------------------
# Período
# ---------------------------------------------------------------------------

def test_parse_months_ordena_y_deduplica():
    assert G.parse_months("2026-04, 2026-02,2026-04") == [FEB, APR]


@pytest.mark.parametrize("raw", ["2026-13", "abril", "2026", "2026-04;2026-05", "9999-12", "1700-01"])
def test_parse_months_rechaza_formato_invalido(raw):
    with pytest.raises(ValueError):
        G.parse_months(raw)


def test_parse_months_tope():
    with pytest.raises(ValueError):
        G.parse_months(",".join(f"2025-{m:02d}" for m in range(1, 8)))


def test_parse_months_vacio_usa_ultimos_tres():
    assert len(G.parse_months(None)) == 3


def test_business_days_descuenta_fines_de_semana_y_feriados(db):
    # Abril 2026: 22 días de lunes a viernes.
    base = G.business_days(db, [APR])
    assert base <= 22
    if db.query(HolidayModel).filter(HolidayModel.Date == date(2026, 4, 15)).first() is None:
        db.add(HolidayModel(Date=date(2026, 4, 15), Name="Feriado test", IsActive=True))
        db.flush()
        assert G.business_days(db, [APR]) == base - 1


# ---------------------------------------------------------------------------
# Embudo
# ---------------------------------------------------------------------------

def test_embudo_cada_escalon(db, milenio):
    rep = _rep(db)
    fuera = _pdv(db, rep)            # cartera, sin ruta foco
    sin_visita = _pdv(db, rep)       # en ruta, sin visita
    sin_censo = _pdv(db, rep)        # visitado, sin cobertura ni POP
    sin_pop = _pdv(db, rep)          # visitado, cobertura ok, sin POP
    sin_cob = _pdv(db, rep)          # visitado, POP ok, producto relevado como "no trabaja"
    efectivo = _pdv(db, rep)
    _route(db, rep, [sin_visita, sin_censo, sin_pop, sin_cob, efectivo])

    _visit(db, sin_censo, rep)
    _cov(db, _visit(db, sin_pop, rep), milenio)
    v = _visit(db, sin_cob, rep)
    _cov(db, v, milenio, works=False)
    _pop(db, v)
    v = _visit(db, efectivo, rep)
    _cov(db, v, milenio)
    _pop(db, v)

    assert _embudo(db, rep) == {"rastrillado": 6, "enRutaFoco": 5, "visitados": 4, "efectivos": 1}
    assert fuera.PdvId  # el PDV fuera de ruta solo suma a rastrillado


def test_efectivo_no_exige_accion(db, milenio):
    """La "visita efectiva" del variable pide acción ejecutada; el embudo no."""
    rep = _rep(db)
    pdv = _pdv(db, rep)
    _route(db, rep, [pdv])
    v = _visit(db, pdv, rep)
    _cov(db, v, milenio)
    _pop(db, v)
    assert db.query(VisitActionModel).filter(VisitActionModel.VisitId == v.VisitId).count() == 0
    assert _embudo(db, rep)["efectivos"] == 1


def test_visita_abierta_no_cuenta(db, milenio):
    rep = _rep(db)
    pdv = _pdv(db, rep)
    _route(db, rep, [pdv])
    v = _visit(db, pdv, rep, status="OPEN")
    _cov(db, v, milenio)
    _pop(db, v)
    e = _embudo(db, rep)
    assert (e["visitados"], e["efectivos"]) == (0, 0)


def test_pop_ausente_o_de_competencia_no_alcanza(db, milenio):
    rep = _rep(db)
    ausente, competencia = _pdv(db, rep), _pdv(db, rep)
    _route(db, rep, [ausente, competencia])
    # Noviembre 2026: ya rige "solo material Espert".
    nov = datetime(2026, 11, 3, 15, 0, 0)
    v = _visit(db, ausente, rep, opened=nov)
    _cov(db, v, milenio)
    _pop(db, v, present=False)
    v = _visit(db, competencia, rep, opened=nov)
    _cov(db, v, milenio)
    _pop(db, v, company="Massalin")
    e = _embudo(db, rep, months=[(2026, 11)])
    assert (e["visitados"], e["efectivos"]) == (2, 0)


def test_cobertura_y_pop_deben_coincidir_en_el_mismo_mes(db, milenio):
    rep = _rep(db)
    pdv = _pdv(db, rep)
    _route(db, rep, [pdv])
    _cov(db, _visit(db, pdv, rep, opened=DAY_FEB), milenio)
    _pop(db, _visit(db, pdv, rep, opened=DAY_APR))
    assert _embudo(db, rep, months=[FEB, APR]) == {
        "rastrillado": 1, "enRutaFoco": 1, "visitados": 1, "efectivos": 0,
    }


def test_solo_rutas_foco_vigentes(db):
    rep = _rep(db)
    campana, vencida, no_foco, foco = (_pdv(db, rep) for _ in range(4))
    _route(db, rep, [campana], IsFocus=False, RouteType="campaign")
    _route(db, rep, [vencida], EndDate=date(2026, 1, 1))
    _route(db, rep, [no_foco], IsFocus=False)
    _route(db, rep, [foco])
    data = G.build_universo(db, [APR], user_id=rep.UserId)
    assert data["embudo"]["rastrillado"] == 4
    assert data["embudo"]["enRutaFoco"] == 1
    assert data["rutasFoco"] == 1


def test_meses_no_contiguos_no_duplican_pdvs(db, milenio):
    rep = _rep(db)
    pdv = _pdv(db, rep)
    _route(db, rep, [pdv])
    for opened in (DAY_FEB, DAY_APR):
        v = _visit(db, pdv, rep, opened=opened)
        _cov(db, v, milenio)
        _pop(db, v)
    # Marzo queda afuera del período elegido.
    _visit(db, pdv, rep, opened=datetime(2026, 3, 10, 15, 0, 0))
    e = _embudo(db, rep, months=[FEB, APR])
    assert (e["visitados"], e["efectivos"]) == (1, 1)

    equipo = G.build_equipo(db, [FEB, APR], user_id=rep.UserId)
    assert equipo["cards"]["realizadas"] == 2


def test_universo_por_area_y_filtro_de_zona(db):
    zona_a, zona_b = _zone(db), _zone(db)
    rep = _rep(db, zone_id=zona_a.ZoneId)
    en_a = _pdv(db, rep, zone_id=zona_a.ZoneId)
    en_b = _pdv(db, rep, zone_id=zona_b.ZoneId)
    _route(db, rep, [en_a, en_b])
    _visit(db, en_a, rep)

    data = G.build_universo(db, [APR], user_id=rep.UserId)
    by_zone = {a["zoneId"]: a for a in data["areas"]}
    assert by_zone[zona_a.ZoneId]["rastrillado"] == 1
    assert by_zone[zona_a.ZoneId]["visitados"] == 1
    assert by_zone[zona_a.ZoneId]["repsActivos"] == 1
    assert by_zone[zona_b.ZoneId]["enRutaFoco"] == 1
    assert by_zone[zona_b.ZoneId]["visitados"] == 0
    assert data["repsActivos"] == data["repsNomina"] == 1

    # Solo zona (las zonas son nuevas: no hay datos de otros tests adentro).
    solo_b = G.build_universo(db, [APR], zone_id=zona_b.ZoneId)
    assert solo_b["embudo"]["rastrillado"] == 1
    assert [a["zoneId"] for a in solo_b["areas"]] == [zona_b.ZoneId]


def test_cobertura_manda_la_visita_mas_reciente_del_mes(db, milenio):
    rep = _rep(db)
    dejo, empezo = _pdv(db, rep), _pdv(db, rep)
    _route(db, rep, [dejo, empezo])
    antes, despues = DAY_APR, DAY_APR + timedelta(days=5)
    # `dejo`: lo trabajaba y dejó de trabajarlo. `empezo`: al revés.
    for pdv, primero, segundo in ((dejo, True, False), (empezo, False, True)):
        v = _visit(db, pdv, rep, opened=antes)
        _cov(db, v, milenio, works=primero)
        _pop(db, v)
        _cov(db, _visit(db, pdv, rep, opened=despues), milenio, works=segundo)
    st = G.load_pdv_status(db, G.Base(db), [APR])
    assert not st.is_effective(dejo.PdvId)
    assert st.is_effective(empezo.PdvId)


def test_no_ambiguo_anterior_al_corte_no_pisa_un_si(db, milenio):
    """Censo de 3 estados: un "No" previo al corte es "sin dato" y no borra el "Sí"."""
    rep = _rep(db)
    pdv = _pdv(db, rep)
    _route(db, rep, [pdv])
    v = _visit(db, pdv, rep, opened=DAY_APR)
    _cov(db, v, milenio, works=True)
    _pop(db, v)
    _cov(db, _visit(db, pdv, rep, opened=DAY_APR + timedelta(days=3)), milenio, works=False)

    row = db.query(AppSettingModel).filter(AppSettingModel.Key == COVERAGE_CUTOFF_SETTING).first()
    corte = "2026-06-01T00:00:00+00:00"  # posterior a las dos visitas
    if row is None:
        db.add(AppSettingModel(Key=COVERAGE_CUTOFF_SETTING, Value=corte))
    else:
        row.Value = corte
    db.flush()
    assert G.load_pdv_status(db, G.Base(db), [APR]).is_effective(pdv.PdvId)


def test_ruta_foco_sin_pdvs_no_cuenta_como_ruta(db):
    rep = _rep(db)
    _route(db, rep, [])
    _route(db, rep, [_pdv(db, rep)])
    assert G.build_universo(db, [APR], user_id=rep.UserId)["rutasFoco"] == 1
    assert G.build_equipo(db, [APR], user_id=rep.UserId)["reps"][0]["rutasFoco"] == 1


def test_pdv_en_rutas_foco_de_dos_reps_cuenta_para_ambos(db, milenio):
    rep_a, rep_b = _rep(db), _rep(db)
    pdv = _pdv(db, rep_a)
    _route(db, rep_a, [pdv])
    _route(db, rep_b, [pdv])
    v = _visit(db, pdv, rep_a)
    _cov(db, v, milenio)
    _pop(db, v)
    for rep in (rep_a, rep_b):
        e = _embudo(db, rep)
        assert (e["enRutaFoco"], e["visitados"], e["efectivos"]) == (1, 1, 1)
        assert G.build_equipo(db, [APR], user_id=rep.UserId)["reps"][0]["efectividadPct"] == 100.0


def test_con_rep_elegido_la_zona_no_recorta(db, milenio):
    """Un rep de la zona A con PDVs en la zona B: las dos solapas muestran lo mismo."""
    zona_a, zona_b = _zone(db), _zone(db)
    rep = _rep(db, zone_id=zona_a.ZoneId)
    pdv = _pdv(db, rep, zone_id=zona_b.ZoneId)
    _route(db, rep, [pdv])
    v = _visit(db, pdv, rep)
    _cov(db, v, milenio)
    _pop(db, v)
    for zone in (zona_a.ZoneId, zona_b.ZoneId, None):
        u = G.build_universo(db, [APR], zone_id=zone, user_id=rep.UserId)
        e = G.build_equipo(db, [APR], zone_id=zone, user_id=rep.UserId)
        assert u["embudo"]["efectivos"] == 1
        assert (e["cards"]["visitados"], e["cards"]["efectivos"]) == (1, 1)


def test_censo_sin_marcas_de_la_rubrica_no_es_efectivo(db):
    """Diferencia deliberada con el motor, que a ese PDV lo califica "excelente"."""
    rep = _rep(db)
    pdv = _pdv(db, rep)
    _route(db, rep, [pdv])
    otro = ProductModel(Name=f"Competencia {_uid()}", Category="Cigarrillos", IsOwn=False, IsActive=True)
    db.add(otro)
    db.flush()
    v = _visit(db, pdv, rep)
    _cov(db, v, otro)
    _pop(db, v)
    e = _embudo(db, rep)
    assert (e["visitados"], e["efectivos"]) == (1, 0)


def test_shared_precalculado_da_lo_mismo(db, milenio):
    rep = _rep(db)
    pdv = _pdv(db, rep)
    _route(db, rep, [pdv])
    v = _visit(db, pdv, rep)
    _cov(db, v, milenio)
    _pop(db, v)
    shared = G.load_shared(db, [APR])
    assert G.build_universo(db, [APR], user_id=rep.UserId, shared=shared) == G.build_universo(
        db, [APR], user_id=rep.UserId
    )
    assert G.build_equipo(db, [APR], user_id=rep.UserId, shared=shared) == G.build_equipo(
        db, [APR], user_id=rep.UserId
    )


# ---------------------------------------------------------------------------
# Performance de equipo
# ---------------------------------------------------------------------------

def test_equipo_actividad(db, milenio):
    rep = _rep(db)
    a, b, c = (_pdv(db, rep) for _ in range(3))
    route = _route(db, rep, [a, b, c])
    rd = RouteDayModel(
        RouteId=route.RouteId, WorkDate=DAY_APR.date(), AssignedUserId=rep.UserId, Status="PLANNED",
    )
    db.add(rd)
    db.flush()
    for i, p in enumerate((a, b, c, a)):
        if i == 3:
            rd = RouteDayModel(
                RouteId=route.RouteId, WorkDate=DAY_APR.date() + timedelta(days=1),
                AssignedUserId=rep.UserId, Status="PLANNED",
            )
            db.add(rd)
            db.flush()
        db.add(RouteDayPdvModel(RouteDayId=rd.RouteDayId, PdvId=p.PdvId, PlannedOrder=i))
    db.flush()

    v = _visit(db, a, rep, minutes=10)
    _cov(db, v, milenio)
    _pop(db, v)
    _visit(db, b, rep, minutes=20)
    _visit(db, c, rep, status="OPEN")

    data = G.build_equipo(db, [APR], user_id=rep.UserId)
    row = data["reps"][0]
    assert row["id"] == rep.UserId
    assert row["clientes"] == 3
    assert row["rutasFoco"] == 1
    assert row["planificadas"] == 4          # visitas programadas, no PDVs distintos
    assert row["realizadas"] == 2            # la abierta no cuenta
    assert row["cumplimientoPct"] == 50.0
    assert row["duracionMin"] == 15
    assert row["efectividadPct"] == 50.0     # 1 efectivo de 2 visitados
    assert row["visitasPorDia"] == round(2 / data["diasHabiles"], 1)
    assert row["movimientos"] >= 3           # las 3 visitas abiertas en el mes
    assert data["cards"]["efectivos"] == 1 and data["cards"]["visitados"] == 2


def test_equipo_ejecucion_es_promedio_mensual_sobre_cartera(db):
    rep = _rep(db)
    a, b = _pdv(db, rep), _pdv(db, rep)
    _route(db, rep, [a, b])

    def _action(visit, action_type, status="DONE", mandatory=None):
        db.add(VisitActionModel(
            VisitId=visit.VisitId, ActionType=action_type, Status=status,
            MandatoryActivityId=mandatory,
        ))
        db.flush()

    v = _visit(db, a, rep, opened=DAY_APR)
    _action(v, "canje_sueltos")
    _action(v, "promo", status="BACKLOG")   # pospuesta: no cuenta
    _pop(db, v)
    _action(_visit(db, b, rep, opened=DAY_APR), "canje_sueltos")

    row = G.build_equipo(db, [FEB, APR], user_id=rep.UserId)["reps"][0]
    # Abril: 2 de 2 con sueltos; febrero: 0 de 2 -> promedio 50%.
    assert row["sueltosPct"] == 50.0
    assert row["comunicacionPct"] == 25.0    # abril 1 de 2, febrero 0
    assert row["activacionesPct"] == 0.0


def test_equipo_rep_sin_cartera_ni_visitas(db):
    rep = _rep(db)
    row = G.build_equipo(db, [APR], user_id=rep.UserId)["reps"][0]
    assert row["realizadas"] == 0
    for key in ("cumplimientoPct", "visitasPorDia", "duracionMin", "efectividadPct",
                "gpsPct", "fotoPct", "comunicacionPct", "sueltosPct", "activacionesPct"):
        assert row[key] is None, key


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

def test_endpoints_responden_y_validan(client):
    assert client.get("/intelligence/gerencial/filters").status_code == 200
    r = client.get("/intelligence/gerencial/universo", params={"months": "2026-04"})
    assert r.status_code == 200
    assert set(r.json()["embudo"]) == {"rastrillado", "enRutaFoco", "visitados", "efectivos"}
    assert client.get("/intelligence/gerencial/equipo", params={"months": "2026-04"}).status_code == 200
    assert client.get("/intelligence/gerencial/universo", params={"months": "abril"}).status_code == 400


# ---------------------------------------------------------------------------
# Tiempo de carga: un solo pedido, cache por mes y compartido entre workers
# ---------------------------------------------------------------------------

def test_resumen_trae_universo_y_equipo_iguales_a_los_endpoints_sueltos(client, db, milenio):
    rep = _rep(db)
    pdv = _pdv(db, rep)
    _route(db, rep, [pdv])
    v = _visit(db, pdv, rep)
    _cov(db, v, milenio)
    _pop(db, v)
    # Los handlers directos, con la sesión del test (sus datos no se commitean).
    from app.routers import intelligence as router

    args = dict(months="2026-04", zone_id=None, user_id=rep.UserId, db=db)
    resumen = router.get_gerencial_resumen(**args)
    assert resumen["universo"]["embudo"]["efectivos"] == 1
    assert resumen["equipo"]["cards"]["realizadas"] == 1
    assert resumen["universo"] == router.get_gerencial_universo(**args)
    assert resumen["equipo"] == router.get_gerencial_equipo(**args)
    assert client.get("/intelligence/gerencial/resumen", params={"months": "abril"}).status_code == 400


def test_solo_se_calculan_los_meses_que_faltan(client, monkeypatch):
    calls = []
    real = G.load_month_data
    monkeypatch.setattr(G, "load_month_data", lambda db, base, months: calls.append(list(months)) or real(db, base, months))

    client.get("/intelligence/gerencial/resumen", params={"months": "2026-03,2026-04"})
    client.get("/intelligence/gerencial/resumen", params={"months": "2026-04", "zone_id": 1})  # filtro: en memoria
    client.get("/intelligence/gerencial/universo", params={"months": "2026-04,2026-05"})  # solo falta mayo
    client.get("/intelligence/gerencial/equipo", params={"months": "2026-03,2026-05"})
    assert calls == [[(2026, 3), (2026, 4)], [(2026, 5)]]


def test_otro_worker_reusa_lo_calculado(client, monkeypatch):
    from app.routers import intelligence as router

    params = {"months": "2026-04"}
    first = client.get("/intelligence/gerencial/resumen", params=params).json()
    # Otro worker: misma carpeta de cache, memoria vacía.
    router._GERENCIAL_CACHE._memory.clear()
    monkeypatch.setattr(G, "load_month_data", lambda *a, **k: pytest.fail("no debía recalcular"))
    monkeypatch.setattr(G.Base, "__init__", lambda *a, **k: pytest.fail("no debía recargar la base"))
    assert client.get("/intelligence/gerencial/resumen", params=params).json() == first
    assert client.get("/intelligence/gerencial/filters").status_code == 200


def test_pieza_por_mes_equivale_a_calcular_el_periodo_junto(db, milenio):
    rep = _rep(db)
    pdv = _pdv(db, rep)
    _route(db, rep, [pdv])
    for day in (DAY_FEB, DAY_APR):
        v = _visit(db, pdv, rep, opened=day)
        _cov(db, v, milenio)
        _pop(db, v)
    base = G.Base(db)
    juntos = G.Shared(base, G.load_month_data(db, base, [FEB, APR]))
    por_mes = G.Shared(base, {m: G.load_month_data(db, base, [m])[m] for m in (FEB, APR)})
    assert juntos.effective == {pdv.PdvId}
    for build in (G.build_universo, G.build_equipo):
        assert build(db, [FEB, APR], shared=juntos) == build(db, [FEB, APR], shared=por_mes)
