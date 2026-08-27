"""Inteligencia Comercial: censo consolidado, competencia y motor de oportunidades.

Versión viva del informe "Inteligencia Comercial Espert" (2026-08-27, sobre el
export del 19-08): en vez de un export manual + análisis descartable, los mismos
cortes calculados contra la DB y servidos por `app/routers/intelligence.py`.

A diferencia del Tablero TMR (que trabaja el mes en curso), acá el censo es
**histórico completo**: por cada (PDV, producto) manda la observación de la
visita más reciente, sin ventana mensual — la foto de "qué trabaja hoy cada
punto de venta". La consolidación es el mismo criterio que
`kpi_engine.pdv_coverage_scores` / `tmr_dashboard._load_coverage`.

Motor de oportunidades — 5 reglas sobre el censo consolidado de cada PDV:

    R5  PDV sin Espert (Crítica): trabaja competencia y ningún SKU nuestro →
        primera colocación. Si aplica, las demás reglas se omiten para ese PDV
        (la primera colocación las subsume).
    R2  Categoría sin Espert (Alta): tabacos/papelillos/vapes/pouches solo con
        competencia → introducir Van Kiff/Lebonn, Blank, Dito, Fleek.
    R3  Capsulados (Alta): capsulado de la competencia sin capsulado Espert.
        Usa `Product.IsCapsule` (migración 0022) — no se infiere del nombre.
    R1  Extensión Milenio (Media): tiene Milenio Red, le falta alguna variante
        capsulada (Icergy/Vid/Pink) — una oportunidad por variante faltante.
    R4  Franja de precio descubierta (Media): la competencia le cubre una franja
        donde Espert tiene oferta y no está. La franja de un SKU sale de la
        mediana nacional de sus precios validados (regla 0,25x-4x del tablero).

Los precios usan `kpi_engine.filter_price_outliers` sobre el último precio
relevado por (PDV, producto) — el export tenía precios de $4 y de $26M.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from statistics import mean
from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import PDV, Channel, Product, User, Visit, VisitCheck, VisitCoverage, VisitPhoto, Zone
from ..models.user import Role as RoleModel, UserRole as UserRoleModel
from .kpi_engine import filter_price_outliers

# ---------------------------------------------------------------------------
# Definiciones del motor
# ---------------------------------------------------------------------------

# Capsulados por nombre exacto de catálogo. Fuente del backfill de la migración
# 0022 y de scripts/hotfix_product_iscapsule_prod.py; en runtime manda la
# columna Product.IsCapsule (esta lista es solo el seed).
CAPSULE_PRODUCT_NAMES: tuple[str, ...] = (
    # Espert (el marcador es el sabor)
    "Milenio Icergy", "Milenio Vid", "Milenio Pink", "Milenio Mint",
    "Melbourne Mint", "Melbourne Aura", "Mill Explosion", "Bold Mint",
    # Competencia ("Caps" explícito o nombre de fantasía)
    "Golden King Caps", "Lucky LS Origen Caps",
    "Marlboro Craft Coral", "Marlboro Craft Forward", "Marlboro Craft Purple",
    "Red Point ON", "Red Point Sixt",
)

MILENIO_BASE = "Milenio Red"
MILENIO_EXTENSIONS = ("Milenio Icergy", "Milenio Vid", "Milenio Pink")

# Categorías donde la regla 2 busca "solo competencia" (cigarrillos se cubre
# con R1/R3/R4/R5). En datos las categorías van en minúsculas.
OPPORTUNITY_CATEGORIES = ("tabacos", "papelillos", "vapes", "pouches")
CATEGORY_SUGGESTION = {
    "tabacos": "Van Kiff / Lebonn",
    "papelillos": "Blank",
    "vapes": "Dito",
    "pouches": "Fleek",
}

# Franjas de precio (R4): solo las que Espert puede cubrir hoy — no hay
# portfolio premium (≥3.500), ahí la acción es la franja media. Constantes
# documentadas en tasks/todo.md; ABM por DB queda para fase 2.
PRICE_BANDS = (
    ("economica", "Económica", 1500, 2200),
    ("media", "Media", 2200, 3500),
)

PRIORITY_ORDER = {"Crítica": 0, "Alta": 1, "Media": 2}

TYPE_LABELS = {
    "primera_colocacion": "PDV sin Espert",
    "categoria": "Categoría sin Espert",
    "capsulados": "Capsulados",
    "extension_milenio": "Extensión Milenio",
    "franja_precio": "Franja descubierta",
}


def _pct(num: int, den: int, digits: int = 1) -> float:
    return round(num / den * 100, digits) if den else 0.0


# ---------------------------------------------------------------------------
# Censo consolidado
# ---------------------------------------------------------------------------

@dataclass
class ProductInfo:
    product_id: int
    name: str
    category: str  # normalizada a minúsculas
    manufacturer: str
    is_own: bool
    is_capsule: bool


@dataclass
class Census:
    """El censo histórico consolidado del scope, cargado una sola vez."""

    products: dict[int, ProductInfo] = field(default_factory=dict)
    pdvs: dict[int, Any] = field(default_factory=dict)  # PdvId -> fila PDV
    zone_names: dict[int, str] = field(default_factory=dict)
    channel_names: dict[int, str] = field(default_factory=dict)
    user_names: dict[int, str] = field(default_factory=dict)
    works: dict[int, set[int]] = field(default_factory=dict)      # PdvId -> ProductIds
    surveyed: dict[int, set[int]] = field(default_factory=dict)
    quiebre: dict[int, set[int]] = field(default_factory=dict)    # solo productos propios
    censados: set[int] = field(default_factory=set)
    valid_prices: dict[int, list[float]] = field(default_factory=dict)  # ProductId -> precios validados
    median_by_product: dict[int, float] = field(default_factory=dict)
    total_relevamientos: int = 0

    def own_works(self, pdv_id: int) -> set[int]:
        return {p for p in self.works.get(pdv_id, ()) if self.products[p].is_own}

    def comp_works(self, pdv_id: int) -> set[int]:
        return {p for p in self.works.get(pdv_id, ()) if not self.products[p].is_own}

    def pdv_zone(self, p) -> str:
        return self.zone_names.get(p.ZoneId, "Sin zona")

    def pdv_channel(self, p) -> str:
        return self.channel_names.get(p.ChannelId) or p.Channel or "—"


def load_census(db: Session, pdv_scope: Optional[set[int]]) -> Census:
    """Carga y consolida el censo del scope (`pdv_scope=None` = todos los PDVs).

    El filtro de scope se aplica en Python, no con `IN (...)`: el sub-árbol de
    un manager puede superar el límite de parámetros de SQL Server (~2100)."""
    c = Census()

    for p in db.query(Product).all():
        if p.Name.startswith("TEST_"):
            continue
        c.products[p.ProductId] = ProductInfo(
            product_id=p.ProductId,
            name=p.Name,
            category=(p.Category or "").strip().lower(),
            manufacturer=p.Manufacturer or "Sin fabricante",
            is_own=bool(p.IsOwn),
            is_capsule=bool(getattr(p, "IsCapsule", False)),
        )

    for p in db.query(PDV).filter(PDV.IsActive == True).all():  # noqa: E712
        if pdv_scope is None or p.PdvId in pdv_scope:
            c.pdvs[p.PdvId] = p

    c.zone_names = {z.ZoneId: z.Name for z in db.query(Zone).all()}
    c.channel_names = {ch.ChannelId: ch.Name for ch in db.query(Channel).all()}
    c.user_names = {u.UserId: u.DisplayName for u in db.query(User.UserId, User.DisplayName).all()}

    # El escaneo caro: todo el histórico de VisitCoverage (productos de catálogo;
    # los "Otros" a mano no traen fabricante y no sirven para competencia).
    rows = (
        db.query(
            Visit.PdvId, Visit.OpenedAt,
            VisitCoverage.ProductId, VisitCoverage.Works,
            VisitCoverage.Price, VisitCoverage.Availability,
        )
        .join(Visit, Visit.VisitId == VisitCoverage.VisitId)
        .filter(VisitCoverage.ProductId.isnot(None))
        .all()
    )

    latest: dict[tuple[int, int], tuple[datetime, bool, Optional[float], Optional[str]]] = {}
    total = 0
    for pdv_id, opened_at, prod_id, works, price, avail in rows:
        if pdv_id not in c.pdvs or prod_id not in c.products:
            continue
        total += 1
        key = (pdv_id, prod_id)
        prev = latest.get(key)
        if prev is None or opened_at > prev[0]:
            latest[key] = (opened_at, bool(works), float(price) if price else None, avail)
    c.total_relevamientos = total

    c.works = defaultdict(set)
    c.surveyed = defaultdict(set)
    c.quiebre = defaultdict(set)
    price_rows = []
    for (pdv_id, prod_id), (_at, works, price, avail) in latest.items():
        c.censados.add(pdv_id)
        c.surveyed[pdv_id].add(prod_id)
        if works:
            c.works[pdv_id].add(prod_id)
            if price and price > 0:
                price_rows.append({
                    "price": price, "product": c.products[prod_id].name,
                    "pdv": pdv_id, "user": None, "date": None,
                })
            if c.products[prod_id].is_own and (avail or "").strip().lower() == "quiebre":
                c.quiebre[pdv_id].add(prod_id)

    valid, _discarded = filter_price_outliers(price_rows)
    name_to_id = {info.name: pid for pid, info in c.products.items()}
    c.valid_prices = defaultdict(list)
    for row in valid:
        pid = name_to_id.get(row["product"])
        if pid is not None:
            c.valid_prices[pid].append(row["price"])
    from statistics import median as _median
    c.median_by_product = {pid: _median(vals) for pid, vals in c.valid_prices.items() if vals}
    return c


def _band_of(price: float) -> Optional[str]:
    for key, _label, lo, hi in PRICE_BANDS:
        if lo <= price < hi:
            return key
    return None


# ---------------------------------------------------------------------------
# Overview: resumen, zonas, competencia, portfolio, trades, alertas
# ---------------------------------------------------------------------------

def build_overview(db: Session, census: Census, user_scope: Optional[set[int]]) -> dict[str, Any]:
    c = census
    now = datetime.now(timezone.utc)
    since_30d = now - timedelta(days=30)

    con_espert = {p for p in c.censados if c.own_works(p)}

    # ── Visitas (histórico liviano: 4 columnas) ────────────────────────────
    visits = db.query(Visit.VisitId, Visit.PdvId, Visit.UserId, Visit.OpenedAt).all()
    visits = [v for v in visits if v.PdvId in c.pdvs]

    by_month: dict[str, int] = defaultdict(int)
    visits_30d_by_zone: dict[int, int] = defaultdict(int)
    users_30d_by_zone: dict[int, set[int]] = defaultdict(set)
    for v in visits:
        opened = v.OpenedAt if v.OpenedAt.tzinfo else v.OpenedAt.replace(tzinfo=timezone.utc)
        by_month[opened.strftime("%Y-%m")] += 1
        if opened >= since_30d:
            zid = c.pdvs[v.PdvId].ZoneId
            visits_30d_by_zone[zid] += 1
            users_30d_by_zone[zid].add(v.UserId)
    visitas_por_mes = [
        {"mes": m, "visitas": n} for m, n in sorted(by_month.items())[-6:]
    ]

    # ── Zonas ──────────────────────────────────────────────────────────────
    pdvs_by_zone: dict[int, list[int]] = defaultdict(list)
    for pid, p in c.pdvs.items():
        pdvs_by_zone[p.ZoneId].append(pid)

    zonas = []
    for zid, pdv_list in pdvs_by_zone.items():
        censados = [p for p in pdv_list if p in c.censados]
        con = [p for p in censados if p in con_espert]
        depths = [len(c.own_works(p)) for p in con]
        zonas.append({
            "zonaId": zid,
            "zona": c.zone_names.get(zid, "Sin zona"),
            "pdvs": len(pdv_list),
            "censados": len(censados),
            "conEspert": len(con),
            "cobertura": _pct(len(con), len(censados)),
            "skusPromEspert": round(mean(depths), 1) if depths else 0,
            "visitas30d": visits_30d_by_zone.get(zid, 0),
            "trades30d": len(users_30d_by_zone.get(zid, ())),
        })
    zonas.sort(key=lambda z: -z["pdvs"])

    # ── Competencia: presencia por fabricante (cigarrillos) por zona ───────
    cig_ids = {pid for pid, info in c.products.items() if info.category == "cigarrillos"}
    manufacturers = sorted({
        info.manufacturer for pid, info in c.products.items() if pid in cig_ids
    })
    zone_of_pdv = {pid: p.ZoneId for pid, p in c.pdvs.items()}

    def _presence(pdv_ids: list[int]) -> dict[str, Any]:
        base = [p for p in pdv_ids if c.surveyed.get(p, set()) & cig_ids]
        pres: dict[str, float] = {}
        for fab in manufacturers:
            fab_ids = {pid for pid in cig_ids if c.products[pid].manufacturer == fab}
            n = sum(1 for p in base if c.works.get(p, set()) & fab_ids)
            if n:
                pres[fab] = _pct(n, len(base))
        return {"pdvsCig": len(base), "presencia": pres}

    competencia = {"Nacional": _presence(list(c.pdvs.keys()))}
    for z in zonas:
        competencia[z["zona"]] = _presence(pdvs_by_zone[z["zonaId"]])

    # ── Precio promedio por fabricante (validado) ──────────────────────────
    precio_fab: dict[str, dict[str, Any]] = {}
    by_fab: dict[str, list[float]] = defaultdict(list)
    for pid, vals in c.valid_prices.items():
        if pid in cig_ids:
            by_fab[c.products[pid].manufacturer].extend(vals)
    for fab, vals in by_fab.items():
        precio_fab[fab] = {"prom": round(mean(vals)), "n": len(vals)}

    # ── Portfolio Espert ───────────────────────────────────────────────────
    portfolio = []
    own_ids = [pid for pid, info in c.products.items() if info.is_own]
    for pid in own_ids:
        info = c.products[pid]
        pdvs_con = [p for p in c.censados if pid in c.works.get(p, ())]
        if not pdvs_con:
            continue
        por_zona = defaultdict(int)
        for p in pdvs_con:
            por_zona[zone_of_pdv.get(p)] += 1
        vals = c.valid_prices.get(pid, [])
        portfolio.append({
            "producto": info.name,
            "categoria": info.category,
            "pdvs": len(pdvs_con),
            "pct": _pct(len(pdvs_con), len(c.censados)),
            "precioProm": round(mean(vals)) if vals else None,
            "porZona": {
                c.zone_names.get(zid, "Sin zona"): _pct(
                    n, sum(1 for p in pdvs_by_zone.get(zid, ()) if p in c.censados)
                )
                for zid, n in por_zona.items()
            },
        })
    portfolio.sort(key=lambda r: -r["pdvs"])

    # ── Trades (vendedores activos del scope, últimos 30 días) ─────────────
    vendedor_ids = {
        uid for (uid,) in (
            db.query(UserRoleModel.UserId)
            .join(RoleModel, RoleModel.RoleId == UserRoleModel.RoleId)
            .join(User, User.UserId == UserRoleModel.UserId)
            .filter(RoleModel.Name == "vendedor", User.IsActive == True)  # noqa: E712
            .all()
        )
    }
    if user_scope is not None:
        vendedor_ids &= user_scope
    users_by_id = {
        u.UserId: u for u in db.query(User).filter(User.UserId.in_(vendedor_ids)).all()
    } if vendedor_ids else {}

    cartera_by_user: dict[int, list[int]] = defaultdict(list)
    for pid, p in c.pdvs.items():
        if p.AssignedUserId in vendedor_ids:
            cartera_by_user[p.AssignedUserId].append(pid)

    visits_30d_by_user: dict[int, list] = defaultdict(list)
    last_visit_by_user: dict[int, datetime] = {}
    for v in visits:
        opened = v.OpenedAt if v.OpenedAt.tzinfo else v.OpenedAt.replace(tzinfo=timezone.utc)
        if v.UserId in vendedor_ids:
            prev = last_visit_by_user.get(v.UserId)
            if prev is None or opened > prev:
                last_visit_by_user[v.UserId] = opened
            if opened >= since_30d:
                visits_30d_by_user[v.UserId].append(v.VisitId)

    recent_ids = [vid for vids in visits_30d_by_user.values() for vid in vids]
    gps_visits: set[int] = set()
    photo_visits: set[int] = set()
    if recent_ids:
        # Lote de a 1000 para no pisar el límite de parámetros de SQL Server.
        for i in range(0, len(recent_ids), 1000):
            chunk = recent_ids[i:i + 1000]
            gps_visits.update(
                vid for (vid,) in db.query(VisitCheck.VisitId)
                .filter(VisitCheck.VisitId.in_(chunk), VisitCheck.Lat.isnot(None))
                .distinct().all()
            )
            photo_visits.update(
                vid for (vid,) in db.query(VisitPhoto.VisitId)
                .filter(VisitPhoto.VisitId.in_(chunk)).distinct().all()
            )

    trades = []
    for uid in vendedor_ids:
        u = users_by_id.get(uid)
        if u is None:
            continue
        cartera = cartera_by_user.get(uid, [])
        censados = [p for p in cartera if p in c.censados]
        con = [p for p in censados if p in con_espert]
        depths = [len(c.own_works(p)) for p in con]
        vids = visits_30d_by_user.get(uid, [])
        last = last_visit_by_user.get(uid)
        trades.append({
            "userId": uid,
            "nombre": u.DisplayName,
            "zona": c.zone_names.get(u.ZoneId, ""),
            "reportaA": c.user_names.get(u.ManagerUserId, ""),
            "cartera": len(cartera),
            "censados": len(censados),
            "pctCensado": _pct(len(censados), len(cartera), 0),
            "conEspert": len(con),
            "skusProm": round(mean(depths), 1) if depths else 0,
            "visitas30d": len(vids),
            "gps": _pct(sum(1 for v in vids if v in gps_visits), len(vids), 0),
            "foto": _pct(sum(1 for v in vids if v in photo_visits), len(vids), 0),
            "ultimaVisita": last.strftime("%Y-%m-%d") if last else None,
        })
    trades.sort(key=lambda t: -t["visitas30d"])

    # ── Alertas ────────────────────────────────────────────────────────────
    alertas = []
    for z in zonas:
        if z["censados"] >= 20 and z["cobertura"] < 60:
            alertas.append({
                "tipo": "cobertura_zona", "severidad": "critica",
                "titulo": f"{z['zona']}: cobertura {z['cobertura']}%",
                "detalle": f"{z['conEspert']} de {z['censados']} PDVs censados trabajan Espert.",
            })
    sin_espert = len(c.censados) - len(con_espert)
    if sin_espert:
        alertas.append({
            "tipo": "sin_espert", "severidad": "critica",
            "titulo": f"{sin_espert} PDVs censados sin Espert",
            "detalle": "Primera colocación lista para ejecutar (ver Oportunidades).",
        })
    quiebres = sum(1 for p in c.quiebre if c.quiebre[p])
    if quiebres:
        alertas.append({
            "tipo": "quiebre", "severidad": "alta",
            "titulo": f"{quiebres} PDVs con quiebre de un SKU Espert",
            "detalle": "Último censo marca quiebre en al menos un producto propio.",
        })
    frios = [t for t in trades if t["cartera"] > 0 and t["visitas30d"] == 0]
    if frios:
        alertas.append({
            "tipo": "trade_sin_visitas", "severidad": "alta",
            "titulo": f"{len(frios)} trades sin visitas en 30 días",
            "detalle": ", ".join(t["nombre"] for t in frios[:6]) + ("…" if len(frios) > 6 else ""),
        })
    sin_censo = len(c.pdvs) - len(c.censados)
    if sin_censo:
        alertas.append({
            "tipo": "sin_censo", "severidad": "media",
            "titulo": f"{sin_censo} PDVs activos sin censar",
            "detalle": "La frontera de expansión del censo (gris en el mapa).",
        })

    return {
        "generadoEl": now.strftime("%Y-%m-%d %H:%M UTC"),
        "resumen": {
            "pdvsActivos": len(c.pdvs),
            "censados": len(c.censados),
            "conEspert": len(con_espert),
            "cobertura": _pct(len(con_espert), len(c.censados)),
            "pctCensado": _pct(len(c.censados), len(c.pdvs)),
            "relevamientos": c.total_relevamientos,
            "visitas": len(visits),
        },
        "visitasPorMes": visitas_por_mes,
        "zonas": zonas,
        "competencia": competencia,
        "precioFab": precio_fab,
        "portfolio": portfolio,
        "trades": trades,
        "alertas": alertas,
    }


# ---------------------------------------------------------------------------
# Motor de oportunidades
# ---------------------------------------------------------------------------

def build_opportunities(census: Census) -> dict[str, Any]:
    c = census

    # Franja de cada producto según su mediana nacional validada.
    band_of_prod = {
        pid: _band_of(med) for pid, med in c.median_by_product.items()
        if c.products[pid].category == "cigarrillos"
    }
    band_labels = {key: label for key, label, _lo, _hi in PRICE_BANDS}

    items = []

    def add(pdv_id, tipo, prioridad, detalle, sugerencia):
        p = c.pdvs[pdv_id]
        items.append({
            "pdvId": pdv_id,
            "pdv": p.Name,
            "zona": c.pdv_zone(p),
            "canal": c.pdv_channel(p),
            "tradeId": p.AssignedUserId,
            "trade": c.user_names.get(p.AssignedUserId, "Sin asignar"),
            "tipo": tipo,
            "tipoLabel": TYPE_LABELS[tipo],
            "prioridad": prioridad,
            "detalle": detalle,
            "sugerencia": sugerencia,
        })

    for pdv_id in c.censados:
        if pdv_id not in c.pdvs:
            continue
        works = c.works.get(pdv_id, set())
        own = {p for p in works if c.products[p].is_own}
        comp = works - own

        # R5 — primera colocación: subsume al resto.
        if comp and not own:
            ejemplos = sorted(c.products[p].name for p in comp)[:3]
            add(
                pdv_id, "primera_colocacion", "Crítica",
                f"Trabaja solo competencia: {', '.join(ejemplos)}"
                + ("…" if len(comp) > 3 else ""),
                "Primera colocación Espert (arrancar por Milenio Red)",
            )
            continue
        if not comp and not own:
            continue  # censado sin nada trabajado: caso aparte, no es oportunidad

        # R1 — extensión Milenio. Por nombre (no por id): "Milenio Red" es una
        # identidad de negocio, no una fila puntual del catálogo.
        own_names = {c.products[p].name for p in own}
        if any(n.startswith(MILENIO_BASE) for n in own_names):
            works_names = {c.products[p].name for p in works}
            surveyed_names = {c.products[p].name for p in c.surveyed.get(pdv_id, ())}
            for ext_name in MILENIO_EXTENSIONS:
                if not any(n.startswith(ext_name) for n in works_names):
                    relevado = any(n.startswith(ext_name) for n in surveyed_names)
                    add(
                        pdv_id, "extension_milenio", "Media",
                        f"Tiene Milenio Red pero no {ext_name}"
                        + ("" if relevado else " (variante sin relevar)"),
                        f"Ofrecer {ext_name}",
                    )

        # R2 — categoría solo con competencia.
        for cat in OPPORTUNITY_CATEGORIES:
            comp_cat = [p for p in comp if c.products[p].category == cat]
            own_cat = [p for p in own if c.products[p].category == cat]
            if comp_cat and not own_cat:
                ejemplos = sorted(c.products[p].name for p in comp_cat)[:2]
                add(
                    pdv_id, "categoria", "Alta",
                    f"Vende {cat} solo de competencia ({', '.join(ejemplos)})",
                    f"Introducir {CATEGORY_SUGGESTION[cat]}",
                )

        # R3 — capsulados de la competencia sin capsulado Espert.
        comp_caps = [p for p in comp if c.products[p].is_capsule]
        own_caps = [p for p in own if c.products[p].is_capsule]
        if comp_caps and not own_caps:
            ejemplos = sorted(c.products[p].name for p in comp_caps)[:2]
            add(
                pdv_id, "capsulados", "Alta",
                f"Trabaja capsulados de competencia ({', '.join(ejemplos)}) sin capsulado Espert",
                "Ofrecer Milenio Icergy / Vid / Pink",
            )

        # R4 — franja de precio cubierta por competencia donde Espert no está.
        comp_bands = {band_of_prod.get(p) for p in comp} - {None}
        own_bands = {band_of_prod.get(p) for p in own} - {None}
        for band in comp_bands - own_bands:
            ejemplo = next(
                c.products[p].name for p in sorted(comp)
                if band_of_prod.get(p) == band
            )
            add(
                pdv_id, "franja_precio", "Media",
                f"Franja {band_labels[band].lower()} cubierta solo por competencia (ej: {ejemplo})",
                f"Colocar el Espert de franja {band_labels[band].lower()}",
            )

    items.sort(key=lambda r: (PRIORITY_ORDER[r["prioridad"]], r["zona"], r["pdv"]))

    por_tipo: dict[str, int] = defaultdict(int)
    por_zona: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    por_trade: dict[str, int] = defaultdict(int)
    por_prioridad: dict[str, int] = defaultdict(int)
    for r in items:
        por_tipo[r["tipoLabel"]] += 1
        por_zona[r["zona"]][r["prioridad"]] += 1
        por_trade[r["trade"]] += 1
        por_prioridad[r["prioridad"]] += 1

    return {
        "items": items,
        "total": len(items),
        "porTipo": dict(por_tipo),
        "porZona": {z: dict(d) for z, d in por_zona.items()},
        "porTrade": dict(sorted(por_trade.items(), key=lambda kv: -kv[1])),
        "porPrioridad": dict(por_prioridad),
    }


# ---------------------------------------------------------------------------
# Mapa
# ---------------------------------------------------------------------------

def build_map(census: Census) -> dict[str, Any]:
    """Puntos livianos para el canvas: [pdvId, lat, lon, zoneId, status].

    status: 2 = trabaja Espert · 1 = censado sin Espert · 0 = sin censo."""
    c = census
    points = []
    counts = {"espert": 0, "censadoSin": 0, "sinCenso": 0}
    for pid, p in c.pdvs.items():
        if p.Lat is None or p.Lon is None:
            continue
        if pid in c.censados:
            status = 2 if c.own_works(pid) else 1
        else:
            status = 0
        counts["espert" if status == 2 else "censadoSin" if status == 1 else "sinCenso"] += 1
        points.append([pid, float(p.Lat), float(p.Lon), p.ZoneId or 0, status])
    return {
        "zonas": {zid: name for zid, name in c.zone_names.items()},
        "puntos": points,
        "counts": counts,
    }
