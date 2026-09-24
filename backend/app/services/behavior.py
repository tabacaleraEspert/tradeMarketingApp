"""Comportamiento en campo de UN vendedor en un rango de fechas (auditoría).

Alimenta la pestaña "Comportamiento" del drill de Inteligencia (TM REP). Por
día hábil argentino: ON/OFF, visitas, planificado vs visitado, km en línea
recta sobre los puntos GPS válidos, batería y alertas. El frontend reemplaza
`kmLinea` por km de ruta real (Google Directions) usando `puntos`.

Fuentes: `Visit` (+ `PDV`), `VisitCheck` (GPS de IN/OUT), `File` vía
`VisitPhoto` (GPS de fotos, densifican la traza) y `RouteDay`/`RouteDayPdv`
(plan del día). Cuatro queries acotadas por usuario y rango; nada por visita.

Fechas: el rango es inclusivo en hora argentina (`BUSINESS_TZ`) y se convierte
a UTC para filtrar `Visit.OpenedAt` (criterio B2 del motor de KPIs). Checks y
fotos se agrupan por la fecha AR de SU visita, no por su propio timestamp.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from ..models import PDV, File, RouteDay, RouteDayPdv, User, Visit, VisitCheck, VisitPhoto
from ..utils.geo import haversine_km
from .kpi_engine import BUSINESS_TZ
from .tmr_dashboard import resolve_periodo

# ---------------------------------------------------------------------------
# Umbrales (decisión 2026-09-24, ver tasks/todo.md › Comportamiento)
# ---------------------------------------------------------------------------
PERIMETER_M = 200          # distancia IN → PDV tolerada
SHORT_VISIT_MIN = 3        # visita cerrada en menos de esto = sospechosa
LATE_ON = "10:00"          # primer check-in después de esta hora = ON tarde
EARLY_OFF = "16:00"        # último check-out antes de esta hora = OFF temprano
LOW_BATTERY = 15           # % de batería
MAX_RANGE_DAYS = 92        # tope de días por request
MAX_ACCURACY_M = 500       # puntos GPS con peor precisión se descartan
MAX_JUMP_KM = 80           # salto entre puntos consecutivos = outlier

_DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]

_SEVERIDAD = {
    "sin_gps": "media",
    "fuera_perimetro": "alta",
    "visita_corta": "media",
    "visita_abierta": "baja",
    "plan_sin_visitas": "alta",
    "plan_no_visitado": "media",
    "orden_distinto": "baja",
    "on_tarde": "media",
    "off_temprano": "media",
    "bateria_baja": "baja",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_ar(dt: datetime) -> datetime:
    """Naive UTC (como se guarda `Visit.OpenedAt`) → aware en hora argentina."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(BUSINESS_TZ)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return _to_ar(dt).isoformat() if dt is not None else None


def _f(x) -> Optional[float]:
    """Decimal/None de columnas Numeric → float/None."""
    return None if x is None else float(x)


def _hhmm(t: str) -> time:
    h, m = t.split(":")
    return time(int(h), int(m))


def _minutes(a: datetime, b: datetime) -> int:
    return int((b - a).total_seconds() // 60)


def _avg_hhmm(times: list[datetime]) -> Optional[str]:
    """Promedio de horas del día (en AR) como "HH:MM"."""
    if not times:
        return None
    mins = [t.hour * 60 + t.minute for t in (_to_ar(x) for x in times)]
    m = round(sum(mins) / len(mins))
    return f"{m // 60:02d}:{m % 60:02d}"


def _alerta(tipo: str, fecha: date, detalle: str, visit_id=None, pdv_id=None, pdv_name=None) -> dict:
    return {
        "tipo": tipo,
        "severidad": _SEVERIDAD[tipo],
        "fecha": fecha.isoformat(),
        "visitId": visit_id,
        "pdvId": pdv_id,
        "pdvName": pdv_name,
        "detalle": detalle,
    }


@dataclass
class _VisitRow:
    visit: Visit
    pdv_name: str
    pdv_lat: Optional[float]
    pdv_lon: Optional[float]
    checks: list[VisitCheck] = field(default_factory=list)
    photos: list[tuple[datetime, float, float]] = field(default_factory=list)  # (TakenAt, lat, lon)

    @property
    def fecha(self) -> date:
        return _to_ar(self.visit.OpenedAt).date()


# ---------------------------------------------------------------------------
# Carga
# ---------------------------------------------------------------------------

def _load(db: Session, user_id: int, date_from: date, date_to: date):
    per = resolve_periodo(date_to.year, date_to.month, date_from, date_to)
    in_range = (
        Visit.UserId == user_id,
        Visit.OpenedAt >= per.dt_start,
        Visit.OpenedAt < per.dt_end,
    )

    visits: dict[int, _VisitRow] = {}
    rows = (
        db.query(Visit, PDV.Name, PDV.Lat, PDV.Lon)
        .join(PDV, PDV.PdvId == Visit.PdvId)
        .filter(*in_range)
        .order_by(Visit.OpenedAt, Visit.VisitId)
        .all()
    )
    for v, name, lat, lon in rows:
        visits[v.VisitId] = _VisitRow(v, name, _f(lat), _f(lon))

    # Join por Visit (no `IN (ids)`): Azure SQL tope de 2100 parámetros.
    checks = (
        db.query(VisitCheck)
        .join(Visit, Visit.VisitId == VisitCheck.VisitId)
        .filter(*in_range)
        .order_by(VisitCheck.Ts, VisitCheck.VisitCheckId)
        .all()
    )
    for c in checks:
        visits[c.VisitId].checks.append(c)

    photos = (
        db.query(VisitPhoto.VisitId, File.TakenAt, File.Lat, File.Lon)
        .join(File, File.FileId == VisitPhoto.FileId)
        .join(Visit, Visit.VisitId == VisitPhoto.VisitId)
        .filter(*in_range, File.Lat.isnot(None), File.Lon.isnot(None), File.TakenAt.isnot(None))
        .all()
    )
    for vid, taken, lat, lon in photos:
        visits[vid].photos.append((taken, float(lat), float(lon)))

    # Plan: {fecha: {pdvId: (order, name, lat, lon)}} — si un PDV aparece en dos
    # RouteDay del mismo día se queda con el menor PlannedOrder.
    plan: dict[date, dict[int, tuple[int, str, Optional[float], Optional[float]]]] = defaultdict(dict)
    plan_rows = (
        db.query(RouteDay.WorkDate, RouteDayPdv.PdvId, RouteDayPdv.PlannedOrder, PDV.Name, PDV.Lat, PDV.Lon)
        .join(RouteDayPdv, RouteDayPdv.RouteDayId == RouteDay.RouteDayId)
        .join(PDV, PDV.PdvId == RouteDayPdv.PdvId)
        .filter(RouteDay.AssignedUserId == user_id, RouteDay.WorkDate >= date_from, RouteDay.WorkDate <= date_to)
        .all()
    )
    for wd, pdv_id, order, name, lat, lon in plan_rows:
        prev = plan[wd].get(pdv_id)
        if prev is None or order < prev[0]:
            plan[wd][pdv_id] = (order, name, _f(lat), _f(lon))

    return visits, plan


# ---------------------------------------------------------------------------
# Un día
# ---------------------------------------------------------------------------

def _gps_points(day_visits: list[_VisitRow]) -> list[dict]:
    """Checks IN/OUT + fotos con coordenadas, cronológicos. Se descartan los de
    precisión > MAX_ACCURACY_M y los que saltan > MAX_JUMP_KM del anterior."""
    raw: list[tuple[datetime, dict]] = []
    for vr in day_visits:
        base = {"visitId": vr.visit.VisitId, "pdvId": vr.visit.PdvId, "pdvName": vr.pdv_name}
        for c in vr.checks:
            if c.Lat is None or c.Lon is None:
                continue
            acc = _f(c.AccuracyMeters)
            if acc is not None and acc > MAX_ACCURACY_M:
                continue
            raw.append((c.Ts, {
                "ts": _iso(c.Ts), "tipo": "in" if (c.CheckType or "").upper() == "IN" else "out",
                "lat": float(c.Lat), "lon": float(c.Lon), "acc": acc,
                "distPdv": _f(c.DistanceToPdvM), "bateria": c.BatteryPct, **base,
            }))
        for taken, lat, lon in vr.photos:
            raw.append((taken, {
                "ts": _iso(taken), "tipo": "foto", "lat": lat, "lon": lon,
                "acc": None, "distPdv": None, "bateria": None, **base,
            }))
    raw.sort(key=lambda r: r[0])

    kept: list[dict] = []
    for _, p in raw:
        if kept:
            prev = kept[-1]
            if haversine_km(prev["lat"], prev["lon"], p["lat"], p["lon"]) > MAX_JUMP_KM:
                continue
        p["seq"] = len(kept) + 1
        kept.append(p)
    return kept


def _visit_position(vr: _VisitRow) -> Optional[tuple[float, float]]:
    """Coordenada de la visita: check IN con GPS, si no cualquier check, si no el PDV."""
    ins = [c for c in vr.checks if c.Lat is not None and c.Lon is not None]
    ins.sort(key=lambda c: 0 if (c.CheckType or "").upper() == "IN" else 1)
    if ins:
        return float(ins[0].Lat), float(ins[0].Lon)
    if vr.pdv_lat is not None and vr.pdv_lon is not None:
        return vr.pdv_lat, vr.pdv_lon
    return None


def _dist_pdv(vr: _VisitRow) -> Optional[float]:
    """Distancia IN → PDV en metros: la que guardó el check, o calculada si el
    check trae coordenadas pero no distancia."""
    checks = sorted(
        (c for c in vr.checks if c.Lat is not None and c.Lon is not None),
        key=lambda c: 0 if (c.CheckType or "").upper() == "IN" else 1,
    )
    for c in checks:
        if c.DistanceToPdvM is not None:
            return round(float(c.DistanceToPdvM), 1)
        if vr.pdv_lat is not None and vr.pdv_lon is not None:
            return round(haversine_km(float(c.Lat), float(c.Lon), vr.pdv_lat, vr.pdv_lon) * 1000, 1)
    return None


def _build_day(fecha: date, day_visits: list[_VisitRow], plan_day: dict) -> dict:
    alertas: list[dict] = []
    puntos = _gps_points(day_visits)
    km = sum(
        haversine_km(a["lat"], a["lon"], b["lat"], b["lon"]) for a, b in zip(puntos, puntos[1:])
    )

    # ON / OFF
    ins = [c.Ts for vr in day_visits for c in vr.checks if (c.CheckType or "").upper() == "IN"]
    outs = [c.Ts for vr in day_visits for c in vr.checks if (c.CheckType or "").upper() == "OUT"]
    # ON = lo MÁS TEMPRANO entre primer check-in y primera apertura; OFF = lo
    # MÁS TARDÍO entre último check-out y último cierre. Una visita sin GPS
    # abierta antes que la primera con check-in también marca el inicio del día.
    on = on_src = off = off_src = None
    if day_visits:
        first_open = min(vr.visit.OpenedAt for vr in day_visits)
        if ins and min(ins) <= first_open:
            on, on_src = min(ins), "gps"
        else:
            on, on_src = first_open, "visit"
        closed = [vr.visit.ClosedAt for vr in day_visits if vr.visit.ClosedAt is not None]
        last_close = max(closed) if closed else None
        if outs and (last_close is None or max(outs) >= last_close):
            off, off_src = max(outs), "gps"
        elif last_close is not None:
            off, off_src = last_close, "visit"
    activo = _minutes(on, off) if on is not None and off is not None else None
    if on is not None and _to_ar(on).time() > _hhmm(LATE_ON):
        alertas.append(_alerta("on_tarde", fecha, f"Primer check-in a las {_to_ar(on):%H:%M} (después de {LATE_ON})"))
    if off is not None and _to_ar(off).time() < _hhmm(EARLY_OFF):
        alertas.append(_alerta("off_temprano", fecha, f"Último check-out a las {_to_ar(off):%H:%M} (antes de {EARLY_OFF})"))

    # Secuencia de visitas
    secuencia: list[dict] = []
    prev_pos: Optional[tuple[float, float]] = None
    visited_orders: list[int] = []
    seen_pdvs: set[int] = set()
    sin_gps = fuera = cortas = abiertas = 0
    for i, vr in enumerate(day_visits, start=1):
        v = vr.visit
        v_alerts: list[str] = []
        has_gps = any(c.Lat is not None and c.Lon is not None for c in vr.checks)
        dist = _dist_pdv(vr)
        dur = _minutes(v.OpenedAt, v.ClosedAt) if v.ClosedAt is not None else None
        planned = plan_day.get(v.PdvId)
        planned_order = planned[0] if planned else None
        if planned and v.PdvId not in seen_pdvs:
            visited_orders.append(planned_order)
        seen_pdvs.add(v.PdvId)

        if not has_gps:
            sin_gps += 1
            v_alerts.append("sin_gps")
            alertas.append(_alerta("sin_gps", fecha, "Visita sin coordenadas GPS", v.VisitId, v.PdvId, vr.pdv_name))
        if dist is not None and dist > PERIMETER_M:
            fuera += 1
            v_alerts.append("fuera_perimetro")
            alertas.append(_alerta("fuera_perimetro", fecha, f"Check-in a {dist:.0f} m del PDV (perímetro {PERIMETER_M} m)", v.VisitId, v.PdvId, vr.pdv_name))
        if dur is not None and dur < SHORT_VISIT_MIN:
            cortas += 1
            v_alerts.append("visita_corta")
            alertas.append(_alerta("visita_corta", fecha, f"Visita de {dur} min (menos de {SHORT_VISIT_MIN})", v.VisitId, v.PdvId, vr.pdv_name))
        if v.ClosedAt is None:
            abiertas += 1
            v_alerts.append("visita_abierta")
            alertas.append(_alerta("visita_abierta", fecha, "Visita sin cerrar", v.VisitId, v.PdvId, vr.pdv_name))
        for c in vr.checks:
            if c.BatteryPct is not None and c.BatteryPct < LOW_BATTERY:
                alertas.append(_alerta("bateria_baja", fecha, f"Batería {c.BatteryPct}% en check-{(c.CheckType or '').lower()}", v.VisitId, v.PdvId, vr.pdv_name))

        pos = _visit_position(vr)
        km_prev = None
        if pos is not None and prev_pos is not None:
            km_prev = round(haversine_km(prev_pos[0], prev_pos[1], pos[0], pos[1]), 2)
        if pos is not None:
            prev_pos = pos

        secuencia.append({
            "seq": i, "visitId": v.VisitId, "pdvId": v.PdvId, "pdvName": vr.pdv_name,
            "lat": vr.pdv_lat, "lon": vr.pdv_lon,
            "openedAt": _iso(v.OpenedAt), "closedAt": _iso(v.ClosedAt), "durMin": dur,
            "plannedOrder": planned_order, "hasGps": has_gps, "distPdv": dist,
            "kmDesdeAnterior": km_prev, "alertas": v_alerts,
        })

    # Plan del día
    planificados = len(plan_day)
    plan_visitados = len(seen_pdvs & set(plan_day))
    orden_respetado = None
    if len(visited_orders) >= 2:
        orden_respetado = all(a <= b for a, b in zip(visited_orders, visited_orders[1:]))
        if not orden_respetado:
            alertas.append(_alerta("orden_distinto", fecha, "Orden de visita distinto al planificado: " + " → ".join(str(o) for o in visited_orders)))
    plan_no_visitados = [
        {"pdvId": pid, "pdvName": name, "lat": lat, "lon": lon, "plannedOrder": order}
        for pid, (order, name, lat, lon) in sorted(plan_day.items(), key=lambda kv: kv[1][0])
        if pid not in seen_pdvs
    ]
    if planificados and not day_visits:
        alertas.append(_alerta("plan_sin_visitas", fecha, f"Día con {planificados} PDVs planificados y ninguna visita"))
    else:
        for p in plan_no_visitados:
            alertas.append(_alerta("plan_no_visitado", fecha, f"PDV planificado (orden {p['plannedOrder']}) sin visitar", None, p["pdvId"], p["pdvName"]))

    checks_all = sorted((c for vr in day_visits for c in vr.checks if c.BatteryPct is not None), key=lambda c: c.Ts)
    baterias = [c.BatteryPct for c in checks_all]

    n_vis = len(day_visits)
    return {
        "fecha": fecha.isoformat(),
        "diaLabel": f"{_DIAS[fecha.weekday()]} {fecha:%d/%m}",
        "on": _iso(on), "onSource": on_src, "off": _iso(off), "offSource": off_src, "activoMin": activo,
        "visitas": n_vis, "pdvs": len(seen_pdvs),
        "planificados": planificados, "planVisitados": plan_visitados, "ordenRespetado": orden_respetado,
        "kmLinea": round(km, 2),
        "gpsPct": round(100 * (n_vis - sin_gps) / n_vis) if n_vis else None,
        "sinGps": sin_gps, "fueraPerimetro": fuera, "cortas": cortas, "abiertas": abiertas,
        "bateriaInicio": baterias[0] if baterias else None,
        "bateriaFin": baterias[-1] if baterias else None,
        "alertas": alertas,
        "puntos": puntos,
        "secuencia": secuencia,
        "planNoVisitados": plan_no_visitados,
        # internos para el resumen (se quitan antes de devolver)
        "_on": on, "_off": off,
        "_durs": [s["durMin"] for s in secuencia if s["durMin"] is not None],
    }


# ---------------------------------------------------------------------------
# Entrada
# ---------------------------------------------------------------------------

def build_behavior(db: Session, user_id: int, date_from: date, date_to: date) -> dict[str, Any]:
    """Comportamiento de `user_id` en [date_from, date_to] (fechas AR, inclusivo).
    Levanta `ValueError` si el rango es inválido o supera `MAX_RANGE_DAYS`."""
    if date_to < date_from:
        raise ValueError("date_to debe ser >= date_from")
    if (date_to - date_from).days + 1 > MAX_RANGE_DAYS:
        raise ValueError(f"El rango no puede superar {MAX_RANGE_DAYS} días")

    user = db.query(User.DisplayName).filter(User.UserId == user_id).first()
    visits, plan = _load(db, user_id, date_from, date_to)

    by_day: dict[date, list[_VisitRow]] = defaultdict(list)
    for vr in visits.values():
        by_day[vr.fecha].append(vr)
    fechas = sorted(set(by_day) | set(plan), reverse=True)
    dias = [_build_day(f, by_day.get(f, []), plan.get(f, {})) for f in fechas]

    con_visitas = [d for d in dias if d["visitas"]]
    n = len(con_visitas)
    ons = [d["_on"] for d in con_visitas if d["_on"] is not None]
    offs = [d["_off"] for d in con_visitas if d["_off"] is not None]
    activos = [d["activoMin"] for d in con_visitas if d["activoMin"] is not None]
    durs = [x for d in con_visitas for x in d["_durs"]]
    ordenes = [d["ordenRespetado"] for d in dias if d["ordenRespetado"] is not None]
    planificados = sum(d["planificados"] for d in dias)
    plan_visitados = sum(d["planVisitados"] for d in dias)
    km_total = sum(d["kmLinea"] for d in dias)
    all_alerts = [a for d in dias for a in d["alertas"]]

    def _avg(xs, nd=1):
        return round(sum(xs) / n, nd) if n else 0.0

    resumen = {
        "dias": n,
        "diasConPlan": sum(1 for d in dias if d["planificados"]),
        "diasConPlanSinVisitas": sum(1 for d in dias if d["planificados"] and not d["visitas"]),
        "visitas": len(visits),
        "pdvs": len({vr.visit.PdvId for vr in visits.values()}),
        "pdvsPorDia": _avg([d["pdvs"] for d in con_visitas]),
        "visitasPorDia": _avg([d["visitas"] for d in con_visitas]),
        "visitasSinGps": sum(d["sinGps"] for d in dias),
        "fueraPerimetro": sum(d["fueraPerimetro"] for d in dias),
        "visitasCortas": sum(d["cortas"] for d in dias),
        "visitasAbiertas": sum(d["abiertas"] for d in dias),
        "kmLinea": round(km_total, 1),
        "kmLineaPorDia": _avg([km_total]),
        "onProm": _avg_hhmm(ons),
        "offProm": _avg_hhmm(offs),
        "activoPromMin": round(sum(activos) / len(activos)) if activos else None,
        "durPromMin": round(sum(durs) / len(durs)) if durs else None,
        "planificados": planificados,
        "planVisitados": plan_visitados,
        "planPct": round(100 * plan_visitados / planificados) if planificados else None,
        "ordenRespetadoPct": round(100 * sum(ordenes) / len(ordenes)) if ordenes else None,
        "onTarde": sum(1 for a in all_alerts if a["tipo"] == "on_tarde"),
        "offTemprano": sum(1 for a in all_alerts if a["tipo"] == "off_temprano"),
        "bateriaBaja": sum(1 for a in all_alerts if a["tipo"] == "bateria_baja"),
    }

    for d in dias:
        for k in ("_on", "_off", "_durs"):
            d.pop(k, None)

    return {
        "userId": user_id,
        "userName": user[0] if user else "",
        "from": date_from.isoformat(),
        "to": date_to.isoformat(),
        "perimeterM": PERIMETER_M,
        "resumen": resumen,
        "alertas": all_alerts,
        "dias": dias,
    }
