"""Herramientas del asistente: consultas tipadas de SOLO LECTURA.

Cada herramienta reusa la misma función que alimenta la pantalla
correspondiente (handlers de Inteligencia, Tablero TMR y Gestión de PDV, con
sus caches y su recorte jerárquico), así los números del chat coinciden con los
de la app. Los handlers se llaman con TODOS los argumentos explícitos: los
defaults `Query(...)` de FastAPI no se resuelven fuera de un request.

Contrato con el loop: `ToolRegistry.execute` NUNCA lanza. Un argumento inválido
o una falla vuelve como texto `ERROR: …` para que el modelo corrija o lo cuente.
Un enum desconocido es error, nunca un default silencioso.
"""
from __future__ import annotations

import json
import logging
import unicodedata
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Callable, Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...hierarchy import visible_user_ids
from ...models import PDV, Channel, Role, User, UserRole, Visit, Zone
from . import compact
from .provider import ToolDef

log = logging.getLogger(__name__)


MAX_RANGE_DAYS = 92  # mismo tope que comportamiento: un rango de años es una consulta pesada en S0


class ToolError(ValueError):
    """Error contable al modelo (argumento inválido, recurso inexistente)."""


@dataclass
class ToolCtx:
    db: Session
    user: User


@dataclass(frozen=True)
class Tool:
    name: str
    description: str  # qué hace y CUÁNDO usarla
    label: str        # texto de progreso en la UI ("revisando …")
    schema: dict
    run: Callable[[ToolCtx, dict], str]

    @property
    def definition(self) -> ToolDef:
        return ToolDef(self.name, self.description, self.schema)


# ---------------------------------------------------------------------------
# Argumentos
# ---------------------------------------------------------------------------

def _norm(s: Any) -> str:
    """minúsculas sin acentos, para comparar nombres."""
    s = unicodedata.normalize("NFD", str(s or ""))
    return "".join(ch for ch in s if unicodedata.category(ch) != "Mn").lower().strip()


def _text(args: dict, key: str, required: bool = False) -> Optional[str]:
    v = args.get(key)
    if v is None or (isinstance(v, str) and not v.strip()):
        if required:
            raise ToolError(f"falta el argumento '{key}'.")
        return None
    if not isinstance(v, str):
        raise ToolError(f"'{key}' tiene que ser texto.")
    return v.strip()


def _int(args: dict, key: str, required: bool = False, lo: Optional[int] = None, hi: Optional[int] = None) -> Optional[int]:
    v = args.get(key)
    if v is None:
        if required:
            raise ToolError(f"falta el argumento '{key}'.")
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or int(v) != v:
        raise ToolError(f"'{key}' tiene que ser un número entero.")
    v = int(v)
    if (lo is not None and v < lo) or (hi is not None and v > hi):
        raise ToolError(f"'{key}' tiene que estar entre {lo} y {hi}.")
    return v


def _bool(args: dict, key: str) -> Optional[bool]:
    v = args.get(key)
    if v is None:
        return None
    if not isinstance(v, bool):
        raise ToolError(f"'{key}' tiene que ser true o false.")
    return v


def _date(args: dict, key: str, required: bool = False) -> Optional[date]:
    v = _text(args, key, required)
    if v is None:
        return None
    try:
        return datetime.strptime(v, "%Y-%m-%d").date()
    except ValueError:
        raise ToolError(f"'{key}' tiene que ser una fecha yyyy-MM-dd (llegó '{v}').")


def _enum(args: dict, key: str, allowed: tuple[str, ...], required: bool = False) -> Optional[str]:
    v = _text(args, key, required)
    if v is None:
        return None
    for a in allowed:
        if _norm(a) == _norm(v):
            return a
    raise ToolError(f"'{key}' = '{v}' no es válido. Opciones: {', '.join(allowed)}.")


def _resolve_name(rows: list[tuple[int, str]], wanted: str, what: str) -> tuple[int, str]:
    """(id, nombre canónico) por nombre sin acentos/mayúsculas: exacto, o
    'contiene' si es único. Si no, error con la lista de válidos."""
    w = _norm(wanted)
    exact = [(i, n) for i, n in rows if _norm(n) == w]
    if len(exact) == 1:
        return exact[0]
    partial = [(i, n) for i, n in rows if w and w in _norm(n)]
    if len(partial) == 1:
        return partial[0]
    names = ", ".join(sorted(n for _, n in rows))
    raise ToolError(f"no existe {what} '{wanted}'. Opciones: {names}.")


def _zone(ctx: ToolCtx, args: dict, key: str = "zona") -> Optional[tuple[int, str]]:
    name = _text(args, key)
    if name is None:
        return None
    return _resolve_name([(z.ZoneId, z.Name) for z in ctx.db.query(Zone).all()], name, "la zona")


def _period(args: dict) -> tuple[int, int, Optional[date], Optional[date]]:
    """(anio, mes, desde, hasta) para el Tablero TMR: mes calendario, o rango
    arbitrario con desde+hasta (ahí anio/mes salen de `desde`)."""
    desde, hasta = _date(args, "desde"), _date(args, "hasta")
    if (desde is None) != (hasta is None):
        raise ToolError("'desde' y 'hasta' van juntos.")
    if desde is not None:
        if hasta < desde:
            raise ToolError("'hasta' tiene que ser igual o posterior a 'desde'.")
        if (hasta - desde).days + 1 > MAX_RANGE_DAYS:
            raise ToolError(f"el rango no puede superar {MAX_RANGE_DAYS} días.")
        return desde.year, desde.month, desde, hasta
    anio = _int(args, "anio", required=True, lo=2024, hi=2100)
    mes = _int(args, "mes", required=True, lo=1, hi=12)
    return anio, mes, None, None


_PERIOD_PROPS = {
    "anio": {"type": "integer", "description": "Año (ej. 2026). Obligatorio salvo que pases desde y hasta."},
    "mes": {"type": "integer", "description": "Mes 1-12. Obligatorio salvo que pases desde y hasta."},
    "desde": {"type": "string", "description": "Opcional: inicio de un rango de hasta 92 días, yyyy-MM-dd (va con hasta)."},
    "hasta": {"type": "string", "description": "Opcional: fin del rango, yyyy-MM-dd, inclusive."},
}


def _schema(props: dict, required: tuple[str, ...] = ()) -> dict:
    return {"type": "object", "properties": props, "required": list(required), "additionalProperties": False}


# ---------------------------------------------------------------------------
# Acceso a los handlers existentes (import lazy: los routers importan servicios)
# ---------------------------------------------------------------------------

def _overview(ctx: ToolCtx) -> dict:
    from ...routers import intelligence as R
    return R.get_overview(db=ctx.db, current_user=ctx.user)


def _pdv_filters(**kw):
    """AdminPdvFilters con todos los campos explícitos (sus defaults son `Query`)."""
    from ...routers.pdvs import AdminPdvFilters
    base = dict(
        zone_id=None, channel_id=None, is_active=None, assigned_user_id=None, unassigned=False,
        distributor_id=None, no_distributor=False, has_coords=None, has_route=None,
        days_since_visit=None, visit_freq=None, works_espert=None, sells_loose=None,
    )
    base.update(kw)
    return AdminPdvFilters(**base)


def _pdv_rows(ctx: ToolCtx, pdvs: list[PDV], with_visits: bool = False) -> list[dict]:
    db = ctx.db
    zones = {z.ZoneId: z.Name for z in db.query(Zone).all()}
    channels = {c.ChannelId: c.Name for c in db.query(Channel).all()}
    uids = {p.AssignedUserId for p in pdvs if p.AssignedUserId}
    users = dict(db.query(User.UserId, User.DisplayName).filter(User.UserId.in_(uids)).all()) if uids else {}
    visits: dict[int, tuple] = {}
    if with_visits and pdvs:
        visits = {
            pid: (n, last)
            for pid, n, last in db.query(Visit.PdvId, func.count(Visit.VisitId), func.max(Visit.OpenedAt))
            .filter(Visit.PdvId.in_([p.PdvId for p in pdvs]))
            .group_by(Visit.PdvId)
            .all()
        }
    rows = []
    for p in pdvs:
        row = {
            "pdvId": p.PdvId,
            "nombre": p.Name,
            "codigo": p.Code,
            "direccion": p.Address,
            "ciudad": p.City,
            "zona": zones.get(p.ZoneId, "Sin zona"),
            "canal": channels.get(p.ChannelId) or p.Channel,
            "trade": users.get(p.AssignedUserId, "Sin asignar"),
            "activo": bool(p.IsActive),
        }
        if with_visits:
            n, last = visits.get(p.PdvId, (0, None))
            row["visitas"] = n
            row["ultimaVisita"] = last.strftime("%Y-%m-%d") if last else None
        rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# Herramientas
# ---------------------------------------------------------------------------

def _buscar_usuario(ctx: ToolCtx, args: dict) -> str:
    tokens = _norm(_text(args, "texto", required=True)).split()
    db = ctx.db
    visible = visible_user_ids(db, ctx.user)
    zones = {z.ZoneId: z.Name for z in db.query(Zone).all()}
    roles = dict(
        db.query(UserRole.UserId, Role.Name).join(Role, Role.RoleId == UserRole.RoleId).all()
    )
    users = db.query(User).all()
    names = {u.UserId: u.DisplayName for u in users}
    rows = []
    for u in users:
        if visible is not None and u.UserId not in visible:
            continue
        hay = f"{_norm(u.DisplayName)} {_norm(u.Email)} {u.DNI or ''}"
        if all(t in hay for t in tokens):
            rows.append({
                "userId": u.UserId,
                "nombre": u.DisplayName,
                "rol": roles.get(u.UserId, "vendedor"),
                "zona": zones.get(u.ZoneId, ""),
                "reportaA": names.get(u.ManagerUserId, ""),
                "activo": bool(u.IsActive),
            })
    rows.sort(key=lambda r: (not r["activo"], r["nombre"]))
    return compact.lista(
        rows, max_rows=10,
        empty_note="SIN_RESULTADOS: ningún usuario coincide con ese texto. Probá con el apellido solo.",
    )


def _buscar_pdv(ctx: ToolCtx, args: dict) -> str:
    from ...routers.pdvs import _admin_pdv_query
    texto = _text(args, "texto", required=True)
    zona = _zone(ctx, args)
    q = _admin_pdv_query(ctx.db, ctx.user, _pdv_filters(zone_id=zona[0] if zona else None), texto)
    total = q.count()
    pdvs = q.order_by(PDV.IsActive.desc(), PDV.Name, PDV.PdvId).limit(10).all()
    return compact.lista(
        _pdv_rows(ctx, pdvs), extra={"coincidencias": total}, total=total,
        empty_note="SIN_RESULTADOS: ningún PDV coincide (se busca en nombre, dirección y código). Probá con menos palabras.",
    )


_DIAS_SIN_VISITA = {
    "hasta_7": "7", "8_a_14": "14", "15_a_30": "30", "31_a_60": "60", "mas_de_60": "60plus", "nunca": "never",
}
_TRI = ("si", "no", "sin_dato")
_AGRUPAR = ("ninguno", "zona", "trade", "canal")


def _listar_pdvs(ctx: ToolCtx, args: dict) -> str:
    from ...routers.pdvs import _admin_pdv_query
    db = ctx.db
    zona = _zone(ctx, args)
    canal_name = _text(args, "canal")
    canal = (
        _resolve_name([(c.ChannelId, c.Name) for c in db.query(Channel).all()], canal_name, "el canal")
        if canal_name else None
    )
    dias = _enum(args, "dias_sin_visita", tuple(_DIAS_SIN_VISITA))
    trabaja = _enum(args, "trabaja_espert", _TRI)
    sueltos = _enum(args, "vende_sueltos", _TRI)
    activo = _bool(args, "activo")
    agrupar = _enum(args, "agrupar_por", _AGRUPAR) or "ninguno"
    limite = _int(args, "limite", lo=1, hi=100) or 30
    tri = {"si": "si", "no": "no", "sin_dato": "nd", None: None}

    f = _pdv_filters(
        zone_id=zona[0] if zona else None,
        channel_id=canal[0] if canal else None,
        is_active=True if activo is None else activo,
        assigned_user_id=_int(args, "trade_id"),
        unassigned=bool(_bool(args, "sin_asignar")),
        has_route=_bool(args, "con_ruta"),
        days_since_visit=_DIAS_SIN_VISITA[dias] if dias else None,
        works_espert=tri[trabaja],
        sells_loose=tri[sueltos],
    )
    q = _admin_pdv_query(db, ctx.user, f, _text(args, "texto"))
    total = q.count()

    if agrupar != "ninguno":
        col = {"zona": PDV.ZoneId, "trade": PDV.AssignedUserId, "canal": PDV.ChannelId}[agrupar]
        groups = q.with_entities(col, func.count(PDV.PdvId)).group_by(col).all()
        if agrupar == "zona":
            names = {z.ZoneId: z.Name for z in db.query(Zone).all()}
            none_label = "Sin zona"
        elif agrupar == "canal":
            names = {c.ChannelId: c.Name for c in db.query(Channel).all()}
            none_label = "Sin canal"
        else:
            names = dict(db.query(User.UserId, User.DisplayName).all())
            none_label = "Sin asignar"
        rows = sorted(
            ({agrupar: names.get(k, none_label) if k is not None else none_label, "pdvs": n} for k, n in groups),
            key=lambda r: -r["pdvs"],
        )
        return compact.lista(rows, extra={"total": total})

    if _bool(args, "solo_contar"):
        return compact.objeto({"total": total})
    pdvs = q.order_by(PDV.Name, PDV.PdvId).limit(limite).all()
    return compact.lista(_pdv_rows(ctx, pdvs, with_visits=True), extra={"total": total}, total=total)


def _resumen_inteligencia(ctx: ToolCtx, args: dict) -> str:
    ov = _overview(ctx)
    return compact.objeto({
        "corte": "censo histórico consolidado (última respuesta por PDV y producto)",
        "generadoEl": ov["generadoEl"],
        "datosDesde": ov["datosDesde"],
        "mesesDeDatos": ov["mesesDeDatos"],
        "resumen": ov["resumen"],
        "visitasPorMes": ov["visitasPorMes"],
        "alertas": ov["alertas"],
    })


def _zonas(ctx: ToolCtx, args: dict) -> str:
    ov = _overview(ctx)
    zona = _zone(ctx, args)
    if zona is None:
        return compact.lista(ov["zonas"], extra={"corte": "censo histórico; visitas30d = últimos 30 días"})
    row = next((z for z in ov["zonas"] if z["zonaId"] == zona[0]), None)
    if row is None:
        return f"SIN_RESULTADOS: la zona {zona[1]} no tiene PDVs activos."
    return compact.objeto({
        "zona": row,
        # % de PDVs con cigarrillos relevados que trabajan cada fabricante.
        "presenciaFabricantes": ov["competencia"].get(row["zona"]),
        "presenciaNacional": ov["competencia"].get("Nacional"),
    })


def _trades(ctx: ToolCtx, args: dict) -> str:
    ov = _overview(ctx)
    rows = ov["trades"]
    zona = _zone(ctx, args)
    if zona is not None:
        rows = [t for t in rows if _norm(t["zona"]) == _norm(zona[1])]
    return compact.lista(
        rows, extra={"corte": "cartera y censo históricos; visitas30d/gps/foto = últimos 30 días"}
    )


def _productos(ctx: ToolCtx, args: dict) -> str:
    ov = _overview(ctx)
    return compact.objeto({
        "corte": "censo histórico; pct = % de PDVs censados que lo trabajan; precios relevados y validados",
        "pdvsCensados": ov["resumen"]["censados"],
        "productosEspert": compact.tabla(
            ov["portfolio"], ["producto", "categoria", "pdvs", "pct", "precioProm"], max_rows=60
        ),
        "marcasEspert": compact.tabla(ov["gondola"]["familias"]),
        "presenciaFabricantesNacional": ov["competencia"].get("Nacional"),
        "precioPromedioPorFabricante": ov["precioFab"],
    })


_OPP_TIPOS = ("primera_colocacion", "categoria", "capsulados", "extension_milenio", "franja_precio")
_OPP_PRIORIDADES = ("Crítica", "Alta", "Media")


def _oportunidades(ctx: ToolCtx, args: dict) -> str:
    from ...routers import intelligence as R
    zona = _zone(ctx, args)
    prioridad = _enum(args, "prioridad", _OPP_PRIORIDADES)
    tipo = _enum(args, "tipo", _OPP_TIPOS)
    modo = _enum(args, "modo", ("resumen", "detalle")) or "resumen"
    limite = _int(args, "limite", lo=1, hi=100) or 30
    trade_id = _int(args, "trade_id")
    # El motor completo cacheado (misma entrada que usa GET /intelligence/opportunities),
    # filtrado acá: el handler pagina con tope 5000 y los conteos tienen que ser del total.
    census, pdv_scope = R._census_cached(ctx.db, ctx.user)
    full = R._INTEL_CACHE.get_or_build(
        ("opportunities", R._scope_key(pdv_scope, ctx.user)), lambda: R.I.build_opportunities(census)
    )
    items = [
        r for r in full["items"]
        if (zona is None or r["zona"] == zona[1])
        and (trade_id is None or r["tradeId"] == trade_id)
        and (prioridad is None or r["prioridad"] == prioridad)
        and (tipo is None or r["tipo"] == tipo)
    ]
    header = {
        "oportunidades": len(items),
        "pdvsDistintos": len({r["pdvId"] for r in items}),
        "totalSinFiltros": full["total"],
        "pdvsACompletar": full["aCompletar"]["count"],
    }
    if modo == "resumen":
        header.update({
            "porTipo": dict(Counter(r["tipoLabel"] for r in items)),
            "porPrioridad": dict(Counter(r["prioridad"] for r in items)),
            "porZona": dict(Counter(r["zona"] for r in items).most_common()),
            "porTrade": dict(Counter(r["trade"] for r in items).most_common(20)),
        })
        return compact.objeto(header)
    order = {p: i for i, p in enumerate(_OPP_PRIORIDADES)}
    items = sorted(items, key=lambda r: order.get(r["prioridad"], 9))
    return compact.lista(
        items, ["pdvId", "pdv", "zona", "canal", "trade", "tipoLabel", "prioridad", "detalle", "sugerencia"],
        extra=header, max_rows=limite,
    )


def _ficha_pdv(ctx: ToolCtx, args: dict) -> str:
    from ...routers import intelligence as R
    d = R.get_pdv_detail(pdv_id=_int(args, "pdv_id", required=True), db=ctx.db, current_user=ctx.user)
    censo = d["censo"]
    # Teléfonos, fotos y notas de contacto NO viajan al proveedor del modelo.
    return compact.objeto({
        "info": d["info"],
        "contactos": [{"nombre": c["nombre"], "rol": c["rol"], "decision": c["decision"]} for c in d["contactos"]],
        "proveedores": [
            {"nombre": s["nombre"], "tipo": s["tipo"], "productos": s["productos"], "vendedor": s["vendedor"]}
            for s in d["proveedores"]
        ],
        "skusEspertHoy": d["skusEspertHoy"],
        "completitudPct": d["completitud"],
        "completitudEspertPct": d["completitudEspert"],
        "productosSinDato": len(d["sinDato"]),
        "censoTrabaja": compact.tabla(
            [r for r in censo if r["trabaja"]],
            ["producto", "fabricante", "esEspert", "categoria", "precio", "disponibilidad", "fecha"], max_rows=80,
        ),
        "espertRelevadoQueNoTrabaja": [r["producto"] for r in censo if r["esEspert"] and not r["trabaja"]],
        "evolucionMensual": compact.tabla(d["evolucion"]),
        "ultimasVisitas": compact.tabla(
            d["visitas"], ["fecha", "trade", "duracionMin", "fotos", "gps", "estado"], max_rows=10
        ),
        "totalVisitas": d["totalVisitas"],
    })


_TMR_TEAM_COLS = {
    "id": "userId", "n": "trade", "zona": "zona", "tot": "visitas", "vis": "pdvsVisitados",
    "pdvs": "universoPdvs", "plan": "planificados", "vis_plan": "planVisitados", "ef_pct": "efectividadPct",
    "gps": "gpsPct", "foto": "fotoPct", "dur": "duracionMin", "accion_pct": "accionPct",
    "tot_ent": "entregas", "completitud": "completitudPct", "completitud_esp": "completitudEspertPct",
}
_TMR_ROUTE_COLS = {
    "route_id": "routeId", "nombre": "ruta", "trade": "trade", "zona": "zona", "pdvs": "pdvs",
    "vis_pdvs_jul": "pdvsVisitados", "planned_mes": "planificados", "vis_plan": "planVisitados",
    "ef_jul": "efectividadPct", "relevados": "relevados", "buenos": "buenos",
    "cob_score_pct": "coberturaScorePct", "vende_sueltos": "vendeSueltos", "con_canje": "conCanje",
    "con_promo": "conPromo", "con_material": "conMaterial", "completitud": "completitudPct",
    "completitud_esp": "completitudEspertPct", "freq": "frecuencia",
}


def _rename(rows: list[dict], mapping: dict[str, str]) -> list[dict]:
    return [{new: r.get(old) for old, new in mapping.items()} for r in rows]


def _tablero_tmr(ctx: ToolCtx, args: dict) -> str:
    from ...routers import kpi as K
    anio, mes, desde, hasta = _period(args)
    user_id = _int(args, "user_id")
    res = K.get_tmr_team(year=anio, month=mes, date_from=desde, date_to=hasta, db=ctx.db, current_user=ctx.user)
    rows = _rename(res["trades"], _TMR_TEAM_COLS)
    extra = {"periodo": res["periodo_label"], "datosAl": res["fecha_datos"], "universo": "rutas foco vigentes"}
    if user_id is not None:
        rows = [r for r in rows if r["userId"] == user_id]
        if not rows:
            return ("SIN_RESULTADOS: ese usuario no figura en el Tablero TMR del período. "
                    "Solo aparecen trades con al menos una ruta foco vigente.")
    else:
        t = res["res"]
        extra["equipo"] = {
            "visitas": t["vis"], "entregas": t["ent"], "fotoPct": t["foto"],
            "efectividadPromPct": t["ef"], "accionPromPct": t["acc"],
        }
    return compact.lista(rows, extra=extra)


def _rutas_tmr(ctx: ToolCtx, args: dict) -> str:
    from ...routers import kpi as K
    anio, mes, desde, hasta = _period(args)
    res = K.get_tmr_routes(
        year=anio, month=mes, user_id=_int(args, "user_id", required=True), with_products=False,
        date_from=desde, date_to=hasta, db=ctx.db, current_user=ctx.user,
    )
    return compact.lista(
        _rename(res["rutas"], _TMR_ROUTE_COLS),
        empty_note="SIN_RESULTADOS: ese usuario no tiene rutas foco vigentes.",
    )


def _comportamiento(ctx: ToolCtx, args: dict) -> str:
    from ...routers import intelligence as R
    res = R.get_behavior(
        user_id=_int(args, "user_id", required=True),
        date_from=_date(args, "desde", required=True), date_to=_date(args, "hasta", required=True),
        db=ctx.db, current_user=ctx.user,
    )
    alertas = res["alertas"]
    return compact.objeto({
        "usuario": res["userName"], "desde": res["from"], "hasta": res["to"],
        "perimetroMetros": res["perimeterM"],
        "resumen": res["resumen"],
        "alertasPorTipo": dict(Counter(a["tipo"] for a in alertas)),
        "alertas": compact.tabla(alertas, ["tipo", "severidad", "fecha", "pdvName", "detalle"], max_rows=30),
        "dias": compact.tabla(
            res["dias"],
            ["fecha", "on", "off", "activoMin", "visitas", "pdvs", "planificados", "planVisitados",
             "ordenRespetado", "kmLinea", "sinGps", "fueraPerimetro", "cortas"],
            max_rows=45,
        ),
    })


def _cobertura_datos(ctx: ToolCtx, args: dict) -> str:
    from ..coverage_semantics import get_coverage_cutoff
    db = ctx.db
    ov = _overview(ctx)
    first, last, n = db.query(func.min(Visit.OpenedAt), func.max(Visit.OpenedAt), func.count(Visit.VisitId)).one()
    cutoff = get_coverage_cutoff(db)
    r = ov["resumen"]
    return compact.objeto({
        "primeraVisitaUtc": first.strftime("%Y-%m-%d") if first else None,
        "ultimaVisitaUtc": last.strftime("%Y-%m-%d %H:%M") if last else None,
        "visitasTotales": n,
        "censoDatosDesde": ov["datosDesde"],
        "censoMesesDeDatos": ov["mesesDeDatos"],
        "censoGeneradoEl": ov["generadoEl"],
        "corteNoExplicito": cutoff.strftime("%Y-%m-%d") if cutoff else None,
        "pdvsActivos": r["pdvsActivos"],
        "pdvsCensados": r["censados"],
        "pdvsSinCensar": r["pdvsActivos"] - r["censados"],
        "pdvsACompletar": r["aCompletar"],
        "nota": ("Los 'No' del censo anteriores a corteNoExplicito no cuentan como dato. "
                 "Un PDV sin censar o un producto sin respuesta es 'sin dato', no 'no trabaja'. "
                 "Inteligencia se recalcula cada 30 min y el Tablero TMR cada 10."),
    })


# ---------------------------------------------------------------------------
# Catálogo
# ---------------------------------------------------------------------------

_ZONA_PROP = {"type": "string", "description": "Nombre de la zona (ej. AMBA). Opcional."}

TOOLS: tuple[Tool, ...] = (
    Tool(
        "buscar_usuario",
        "Busca personas del equipo (trades, managers) por nombre, apellido, mail o DNI y devuelve su userId, rol, "
        "zona y a quién reporta. Usala SIEMPRE antes de cualquier herramienta que pida user_id o trade_id.",
        "buscando a la persona…",
        _schema({"texto": {"type": "string", "description": "Nombre o parte del nombre"}}, ("texto",)),
        _buscar_usuario,
    ),
    Tool(
        "buscar_pdv",
        "Busca puntos de venta por nombre, dirección o código (hasta 10) y devuelve su pdvId, zona, canal y trade. "
        "Usala antes de get_ficha_pdv.",
        "buscando el punto de venta…",
        _schema({"texto": {"type": "string", "description": "Nombre, dirección o código"}, "zona": _ZONA_PROP}, ("texto",)),
        _buscar_pdv,
    ),
    Tool(
        "listar_pdvs",
        "Cuenta o lista PDVs con los filtros de Gestión de PDV: zona, canal, trade, sin asignar, con o sin ruta, "
        "días desde la última visita, si trabaja Espert, si vende sueltos. Con agrupar_por devuelve el conteo por "
        "zona, trade o canal. Usala para preguntas de cartera y de PDVs sin visitar. Por defecto solo PDVs activos.",
        "revisando los puntos de venta…",
        _schema({
            "zona": _ZONA_PROP,
            "canal": {"type": "string", "description": "Nombre del canal. Opcional."},
            "trade_id": {"type": "integer", "description": "userId del trade asignado. Opcional."},
            "sin_asignar": {"type": "boolean", "description": "true = solo PDVs sin trade asignado."},
            "con_ruta": {"type": "boolean", "description": "true = en alguna ruta; false = en ninguna."},
            "dias_sin_visita": {
                "type": "string", "enum": list(_DIAS_SIN_VISITA),
                "description": "Tramo de días desde la última visita. Los tramos NO se acumulan: "
                               "'mas_de_60' no incluye 'nunca'.",
            },
            "trabaja_espert": {"type": "string", "enum": list(_TRI), "description": "Dato del PDV: trabaja Espert."},
            "vende_sueltos": {"type": "string", "enum": list(_TRI), "description": "Dato del PDV: vende sueltos."},
            "activo": {"type": "boolean", "description": "Default true. false = PDVs dados de baja."},
            "texto": {"type": "string", "description": "Filtro por nombre, dirección o código. Opcional."},
            "agrupar_por": {"type": "string", "enum": list(_AGRUPAR), "description": "Conteo agrupado. Default ninguno."},
            "solo_contar": {"type": "boolean", "description": "true = devuelve solo el total."},
            "limite": {"type": "integer", "description": "Filas a listar (1-100, default 30)."},
        }),
        _listar_pdvs,
    ),
    Tool(
        "get_resumen_inteligencia",
        "Panorama nacional del censo histórico: PDVs activos, censados, con Espert, cobertura, completitud, visitas "
        "por mes y alertas. Usala para preguntas generales de cómo está el país.",
        "mirando el panorama general…",
        _schema({}),
        _resumen_inteligencia,
    ),
    Tool(
        "get_zonas",
        "Indicadores del censo por zona (PDVs, censados, con Espert, cobertura, completitud, visitas de 30 días). "
        "Con una zona devuelve además la presencia de cada fabricante de cigarrillos en esa zona.",
        "comparando las zonas…",
        _schema({"zona": _ZONA_PROP}),
        _zonas,
    ),
    Tool(
        "get_trades",
        "Una fila por trade con su cartera, % censado, completitud, PDVs con Espert y actividad de los últimos 30 "
        "días (visitas, GPS, foto, última visita). Para actividad de un mes o rango concreto usá get_tablero_tmr.",
        "revisando al equipo…",
        _schema({"zona": _ZONA_PROP}),
        _trades,
    ),
    Tool(
        "get_productos",
        "Presencia de cada producto y marca Espert en los PDVs censados, con precio promedio relevado, más la "
        "presencia nacional y el precio promedio por fabricante de cigarrillos. Usala para preguntas de portfolio, "
        "góndola, competencia y precios.",
        "revisando el portfolio…",
        _schema({}),
        _productos,
    ),
    Tool(
        "get_oportunidades",
        "Oportunidades comerciales detectadas sobre el censo. modo 'resumen' (default) devuelve conteos por tipo, "
        "prioridad, zona y trade; modo 'detalle' lista los PDVs con la sugerencia. Un PDV puede tener varias.",
        "revisando oportunidades…",
        _schema({
            "zona": _ZONA_PROP,
            "trade_id": {"type": "integer", "description": "userId del trade dueño del PDV. Opcional."},
            "prioridad": {"type": "string", "enum": list(_OPP_PRIORIDADES)},
            "tipo": {"type": "string", "enum": list(_OPP_TIPOS)},
            "modo": {"type": "string", "enum": ["resumen", "detalle"]},
            "limite": {"type": "integer", "description": "Filas en modo detalle (1-100, default 30)."},
        }),
        _oportunidades,
    ),
    Tool(
        "get_ficha_pdv",
        "Ficha de UN punto de venta: datos, contactos, proveedores, qué productos trabaja con precio y fecha, "
        "evolución mensual y últimas visitas. Requiere pdv_id (conseguilo con buscar_pdv).",
        "abriendo la ficha del punto de venta…",
        _schema({"pdv_id": {"type": "integer"}}, ("pdv_id",)),
        _ficha_pdv,
    ),
    Tool(
        "get_tablero_tmr",
        "Actividad del equipo en un mes o rango sobre sus rutas foco: visitas, PDVs visitados, efectividad del "
        "plan, GPS, foto, acciones, entregas, duración. Una fila por trade. Usala para rankings y para 'cómo "
        "viene X este mes'.",
        "revisando el tablero del período…",
        _schema({**_PERIOD_PROPS, "user_id": {"type": "integer", "description": "Opcional: un solo trade."}}),
        _tablero_tmr,
    ),
    Tool(
        "get_rutas_tmr",
        "Rutas foco de UN trade en un mes o rango: PDVs, visitados, plan, efectividad, relevados, cobertura, "
        "sueltos, canjes, promos y material. Requiere user_id.",
        "revisando las rutas…",
        _schema({**_PERIOD_PROPS, "user_id": {"type": "integer"}}, ("user_id",)),
        _rutas_tmr,
    ),
    Tool(
        "get_comportamiento",
        "Auditoría de comportamiento en campo de UN trade en un rango de hasta 92 días: horarios de inicio y fin, "
        "visitas por día, plan, GPS, fuera de perímetro, visitas cortas, km y alertas día por día.",
        "revisando el comportamiento en campo…",
        _schema({
            "user_id": {"type": "integer"},
            "desde": {"type": "string", "description": "yyyy-MM-dd"},
            "hasta": {"type": "string", "description": "yyyy-MM-dd, inclusive"},
        }, ("user_id", "desde", "hasta")),
        _comportamiento,
    ),
    Tool(
        "get_cobertura_datos",
        "Desde y hasta cuándo hay datos, cuántos PDVs están sin censar y cuál es el corte del censo. Usala ANTES "
        "de afirmar 'no hay', 'ninguno' o un total histórico.",
        "verificando la cobertura de los datos…",
        _schema({}),
        _cobertura_datos,
    ),
)


class ToolRegistry:
    def __init__(self, tools: tuple[Tool, ...] = TOOLS):
        self._tools = {t.name: t for t in tools}

    def definitions(self) -> list[ToolDef]:
        return [t.definition for t in self._tools.values()]

    def label(self, name: str) -> str:
        t = self._tools.get(name)
        return t.label if t else "consultando…"

    def execute(self, name: str, args_json: str, ctx: ToolCtx) -> str:
        """Nunca lanza: todo error vuelve como texto `ERROR: …`."""
        tool = self._tools.get(name)
        if tool is None:
            return f"ERROR: no existe la herramienta '{name}'."
        try:
            args = json.loads(args_json) if (args_json or "").strip() else {}
        except json.JSONDecodeError:
            return "ERROR: los argumentos no son JSON válido."
        if not isinstance(args, dict):
            return "ERROR: los argumentos tienen que ser un objeto JSON."
        try:
            return tool.run(ctx, args)
        except ToolError as e:
            return f"ERROR: {e}"
        except HTTPException as e:  # 403/404/400 de los handlers reusados
            return f"ERROR: {e.detail}"
        except Exception as e:
            log.exception("assistant: la herramienta %s falló", name)
            ctx.db.rollback()  # no dejar la sesión rota para la herramienta siguiente
            return f"ERROR: la herramienta falló ({type(e).__name__}). No la repitas con los mismos argumentos."
