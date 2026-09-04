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

import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from statistics import mean
from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import PDV, Channel, Product, Route, RoutePdv, User, Visit, VisitCheck, VisitCoverage, VisitPhoto, Zone
from ..models.pdv_contact import PdvContact
from ..models.pdv_supplier import PdvSupplier
from ..models.supplier_type import SupplierType
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
    users_by_month: dict[str, set[int]] = defaultdict(set)
    visits_30d_by_zone: dict[int, int] = defaultdict(int)
    users_30d_by_zone: dict[int, set[int]] = defaultdict(set)
    for v in visits:
        opened = v.OpenedAt if v.OpenedAt.tzinfo else v.OpenedAt.replace(tzinfo=timezone.utc)
        mes = opened.strftime("%Y-%m")
        by_month[mes] += 1
        users_by_month[mes].add(v.UserId)
        if opened >= since_30d:
            zid = c.pdvs[v.PdvId].ZoneId
            visits_30d_by_zone[zid] += 1
            users_30d_by_zone[zid].add(v.UserId)
    visitas_por_mes = [
        {
            "mes": m,
            "visitas": n,
            "trades": len(users_by_month[m]),
            "promPorTrade": round(n / len(users_by_month[m])) if users_by_month[m] else 0,
        }
        for m, n in sorted(by_month.items())[-6:]
    ]
    # Desde cuándo hay datos de verdad: meses distintos con al menos una visita.
    datos_desde = min(by_month) if by_month else None
    meses_de_datos = len(by_month)

    # ── Zonas ──────────────────────────────────────────────────────────────
    pdvs_by_zone: dict[int, list[int]] = defaultdict(list)
    for pid, p in c.pdvs.items():
        pdvs_by_zone[p.ZoneId].append(pid)

    zonas = []
    for zid, pdv_list in pdvs_by_zone.items():
        censados = [p for p in pdv_list if p in c.censados]
        con = [p for p in censados if p in con_espert]
        depths = [len(c.own_works(p)) for p in con]
        # Venta de sueltos: el flag es nullable — solo cuentan los PDVs con dato.
        sueltos_con_dato = [p for p in pdv_list if c.pdvs[p].SellsLooseCigarettes is not None]
        sueltos_si = sum(1 for p in sueltos_con_dato if c.pdvs[p].SellsLooseCigarettes)
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
            "sueltosPct": _pct(sueltos_si, len(sueltos_con_dato), 0),
            "sueltosConDato": len(sueltos_con_dato),
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

    # ── Análisis de góndola: familias propias + rivales por SKU ────────────
    OWN_BRANDS = ("Milenio", "Melbourne", "Mill", "Bold", "Van Kiff", "Lebonn", "Blank", "Dito", "Fleek")

    def _brand_of(name: str) -> Optional[str]:
        return next((b for b in OWN_BRANDS if name.startswith(b)), None)

    # Conteo de PDVs que trabajan cada producto (censo consolidado).
    works_count: dict[int, int] = defaultdict(int)
    for pid in c.censados:
        for prod_id in c.works.get(pid, ()):
            works_count[prod_id] += 1

    familias = []
    for brand in OWN_BRANDS:
        brand_ids = {pid for pid, info in c.products.items() if info.is_own and info.name.startswith(brand)}
        if not brand_ids:
            continue
        pdvs_con = [p for p in c.censados if c.works.get(p, set()) & brand_ids]
        if not pdvs_con:
            continue
        depths = [len(c.works[p] & brand_ids) for p in pdvs_con]
        precios = [v for pid in brand_ids for v in c.valid_prices.get(pid, [])]
        familias.append({
            "marca": brand,
            "pdvs": len(pdvs_con),
            "pct": _pct(len(pdvs_con), len(c.censados)),
            "skusActivos": sum(1 for pid in brand_ids if works_count.get(pid, 0) > 0),
            "skusPromPorPdv": round(mean(depths), 1),
            "precioProm": round(mean(precios)) if precios else None,
        })
    familias.sort(key=lambda f: -f["pdvs"])

    # Rivales directos: para cada SKU propio de cigarrillos, los 3 productos de
    # competencia con mediana de precio más cercana (la pelea real de góndola).
    rivales = []
    comp_cigs = [
        pid for pid in cig_ids
        if not c.products[pid].is_own and pid in c.median_by_product and works_count.get(pid, 0) > 0
    ]
    for pid in own_ids:
        info = c.products[pid]
        if pid not in cig_ids or pid not in c.median_by_product or works_count.get(pid, 0) == 0:
            continue
        med = c.median_by_product[pid]
        cercanos = sorted(comp_cigs, key=lambda cp: abs(c.median_by_product[cp] - med))[:3]
        rivales.append({
            "sku": info.name,
            "precio": round(med),
            "pct": _pct(works_count[pid], len(c.censados)),
            "rivales": [
                {
                    "producto": c.products[cp].name,
                    "fabricante": c.products[cp].manufacturer,
                    "precio": round(c.median_by_product[cp]),
                    "pct": _pct(works_count[cp], len(c.censados)),
                }
                for cp in cercanos
            ],
        })
    rivales.sort(key=lambda r: -r["pct"])

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
        "datosDesde": datos_desde,
        "mesesDeDatos": meses_de_datos,
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
        "gondola": {"familias": familias, "rivales": rivales},
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

def build_map(db: Session, census: Census) -> dict[str, Any]:
    """Puntos para el canvas: [pdvId, lat, lon, zoneId, status, rutaId, nombre].

    status: 2 = trabaja Espert · 1 = censado sin Espert · 0 = sin censo.
    rutaId: primera ruta activa que contiene al PDV (0 = sin ruta) — para
    colorear por ruta en la vista de zona."""
    c = census
    ruta_of: dict[int, int] = {}
    ruta_names: dict[int, str] = {}
    for pdv_id, rid, rname in (
        db.query(RoutePdv.PdvId, Route.RouteId, Route.Name)
        .join(Route, Route.RouteId == RoutePdv.RouteId)
        .filter(Route.IsActive == True)  # noqa: E712
        .all()
    ):
        if pdv_id in c.pdvs and pdv_id not in ruta_of:
            ruta_of[pdv_id] = rid
            ruta_names[rid] = rname

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
        points.append([
            pid, float(p.Lat), float(p.Lon), p.ZoneId or 0, status,
            ruta_of.get(pid, 0), p.Name,
        ])
    return {
        "zonas": {zid: name for zid, name in c.zone_names.items()},
        "rutas": ruta_names,
        "puntos": points,
        "counts": counts,
    }


# ---------------------------------------------------------------------------
# Ficha de PDV (último nivel de drill)
# ---------------------------------------------------------------------------

def build_pdv_detail(db: Session, census: Census, pdv_id: int) -> Optional[dict[str, Any]]:
    """Ficha completa de UN punto de venta: contacto, censo consolidado con
    precio y fecha por producto, evolución mensual, visitas y fotos."""
    c = census
    p = c.pdvs.get(pdv_id)
    if p is None:
        return None  # fuera del scope del solicitante (o inactivo)

    contacts = [
        {
            "nombre": ct.ContactName,
            "telefono": ct.ContactPhone,
            "rol": ct.ContactRole,
            "decision": ct.DecisionPower,
            "notas": ct.Notes,
        }
        for ct in db.query(PdvContact).filter(PdvContact.PdvId == pdv_id).all()
    ]
    if not contacts and (p.ContactName or p.ContactPhone):
        contacts = [{"nombre": p.ContactName or "—", "telefono": p.ContactPhone,
                     "rol": None, "decision": None, "notas": None}]

    visits = (
        db.query(Visit)
        .filter(Visit.PdvId == pdv_id)
        .order_by(Visit.OpenedAt.desc())
        .all()
    )
    visit_ids = [v.VisitId for v in visits]
    user_of = {v.VisitId: v.UserId for v in visits}

    # Las Url guardadas en VisitPhoto son SAS firmadas al momento de subir y
    # EXPIRAN — siempre regenerar desde File.BlobKey (mismo criterio que
    # routers/files.py), y solo para las que efectivamente se muestran.
    from ..models import File as FileModel
    from ..storage import storage

    fotos_por_visita: dict[int, int] = defaultdict(int)
    fotos_raw: list[dict] = []
    gps_visits: set[int] = set()
    if visit_ids:
        for i in range(0, len(visit_ids), 1000):
            chunk = visit_ids[i:i + 1000]
            for vid, stored_url, ptype, blob_key in (
                db.query(VisitPhoto.VisitId, VisitPhoto.Url, VisitPhoto.PhotoType, FileModel.BlobKey)
                .join(FileModel, FileModel.FileId == VisitPhoto.FileId)
                .filter(VisitPhoto.VisitId.in_(chunk))
                .all()
            ):
                fotos_por_visita[vid] += 1
                fotos_raw.append({"visitId": vid, "tipo": ptype, "blobKey": blob_key, "storedUrl": stored_url})
            gps_visits.update(
                v for (v,) in db.query(VisitCheck.VisitId)
                .filter(VisitCheck.VisitId.in_(chunk), VisitCheck.Lat.isnot(None))
                .distinct().all()
            )

    fecha_de_visita = {v.VisitId: v.OpenedAt for v in visits}
    fotos_raw.sort(key=lambda f: fecha_de_visita.get(f["visitId"], datetime.min), reverse=True)
    fotos = []
    for f in fotos_raw[:12]:
        try:
            url = storage.get_url(f["blobKey"]) if f["blobKey"] else (f["storedUrl"] or "")
        except Exception:
            url = f["storedUrl"] or ""
        if not url:
            continue
        opened = fecha_de_visita.get(f["visitId"])
        fotos.append({
            "visitId": f["visitId"],
            "url": url,
            "tipo": f["tipo"],
            "fecha": opened.strftime("%Y-%m-%d") if opened else None,
        })

    # Censo consolidado del PDV: última observación por producto, con precio.
    cov_rows = (
        db.query(Visit.OpenedAt, VisitCoverage.ProductId, VisitCoverage.Works,
                 VisitCoverage.Price, VisitCoverage.Availability)
        .join(Visit, Visit.VisitId == VisitCoverage.VisitId)
        .filter(Visit.PdvId == pdv_id, VisitCoverage.ProductId.isnot(None))
        .all()
    )
    latest: dict[int, tuple] = {}
    by_month_skus: dict[str, set[int]] = defaultdict(set)
    for opened_at, prod_id, works, price, avail in cov_rows:
        if prod_id not in c.products:
            continue
        mes = opened_at.strftime("%Y-%m")
        if works and c.products[prod_id].is_own:
            by_month_skus[mes].add(prod_id)
        prev = latest.get(prod_id)
        if prev is None or opened_at > prev[0]:
            latest[prod_id] = (opened_at, bool(works), float(price) if price else None, avail)

    censo = [
        {
            "producto": c.products[pid].name,
            "fabricante": c.products[pid].manufacturer,
            "esEspert": c.products[pid].is_own,
            "categoria": c.products[pid].category,
            "trabaja": works,
            "precio": price,
            "disponibilidad": avail,
            "fecha": opened_at.strftime("%Y-%m-%d"),
        }
        for pid, (opened_at, works, price, avail) in latest.items()
    ]
    censo.sort(key=lambda r: (not r["esEspert"], not r["trabaja"], r["producto"]))

    visitas_por_mes: dict[str, int] = defaultdict(int)
    for v in visits:
        visitas_por_mes[v.OpenedAt.strftime("%Y-%m")] += 1
    evolucion = [
        {"mes": m, "visitas": visitas_por_mes.get(m, 0), "skusEspert": len(by_month_skus.get(m, ()))}
        for m in sorted(set(visitas_por_mes) | set(by_month_skus))[-8:]
    ]

    def _dur(v) -> Optional[int]:
        if not v.ClosedAt or not v.OpenedAt:
            return None
        return round((v.ClosedAt - v.OpenedAt).total_seconds() / 60)

    visitas = [
        {
            "visitId": v.VisitId,
            "fecha": v.OpenedAt.strftime("%Y-%m-%d %H:%M"),
            "trade": c.user_names.get(user_of.get(v.VisitId), "—"),
            "duracionMin": _dur(v),
            "fotos": fotos_por_visita.get(v.VisitId, 0),
            "gps": v.VisitId in gps_visits,
            "estado": v.Status,
        }
        for v in visits[:20]
    ]

    own_hoy = sorted(
        c.products[pid].name for pid in c.own_works(pdv_id)
    )

    # Proveedores cargados en el PDV (censo de proveedores; dato del PDV, no de la visita)
    proveedores = [
        {
            "nombre": s.Name,
            "telefono": s.Phone or None,
            "tipo": tipo,
            "productos": _supplier_products(s.Products),
        }
        for s, tipo in (
            db.query(PdvSupplier, SupplierType.Name)
            .outerjoin(SupplierType, SupplierType.SupplierTypeId == PdvSupplier.SupplierTypeId)
            .filter(PdvSupplier.PdvId == pdv_id, PdvSupplier.IsActive == True)
            .order_by(PdvSupplier.Name)
            .all()
        )
    ]

    return {
        "info": {
            "pdvId": pdv_id,
            "nombre": p.Name,
            "codigo": p.Code,
            "direccion": ", ".join(x for x in [p.Address, p.City] if x),
            "canal": c.pdv_channel(p),
            "zona": c.pdv_zone(p),
            "trade": c.user_names.get(p.AssignedUserId, "Sin asignar"),
            "tradeId": p.AssignedUserId,
            "sueltos": p.SellsLooseCigarettes,
            "volumenMensual": p.MonthlyVolume,
            "categoria": p.Category,
            "horario": f"{p.OpeningTime or '—'} a {p.ClosingTime or '—'}" if (p.OpeningTime or p.ClosingTime) else None,
        },
        "contactos": contacts,
        "proveedores": proveedores,
        "skusEspertHoy": own_hoy,
        "censo": censo,
        "evolucion": evolucion,
        "visitas": visitas,
        "totalVisitas": len(visits),
        "fotos": fotos,
    }


def _supplier_products(raw: Optional[str]) -> list[str]:
    """Products es un JSON array serializado ('["Cigarrillos","Golosinas"]') o NULL."""
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        return [str(x) for x in parsed] if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def build_suppliers(db: Session, trade_user_id: int, ruta_nombre: Optional[str] = None) -> dict[str, Any]:
    """Proveedores cargados en los PDVs de las rutas foco de un trade (o de UNA
    ruta si se pasa `ruta_nombre`), agregados por proveedor.

    El mismo proveedor aparece en varios PDVs (el teléfono es la clave lógica;
    sin teléfono, el nombre): se devuelve una fila por proveedor con la cantidad
    de PDVs donde está cargado. Set-logic en SQL (joins), agregado liviano acá.
    """
    q = (
        db.query(
            PdvSupplier.Name,
            PdvSupplier.Phone,
            PdvSupplier.Products,
            SupplierType.Name.label("tipo"),
            PDV.PdvId,
            PDV.Name.label("pdv_nombre"),
        )
        .join(RoutePdv, RoutePdv.PdvId == PdvSupplier.PdvId)
        .join(Route, Route.RouteId == RoutePdv.RouteId)
        .join(PDV, PDV.PdvId == PdvSupplier.PdvId)
        .outerjoin(SupplierType, SupplierType.SupplierTypeId == PdvSupplier.SupplierTypeId)
        .filter(
            Route.IsActive == True,  # noqa: E712
            Route.AssignedUserId == trade_user_id,
            PdvSupplier.IsActive == True,  # noqa: E712
        )
    )
    if ruta_nombre:
        q = q.filter(Route.Name == ruta_nombre)

    agg: dict[str, dict[str, Any]] = {}
    for nombre, phone, products_raw, tipo, pdv_id, pdv_nombre in q.all():
        key = phone.strip() if phone and phone.strip() else f"n:{nombre.strip().lower()}"
        row = agg.get(key)
        if row is None:
            row = agg[key] = {
                "nombre": nombre,
                "telefono": phone.strip() if phone and phone.strip() else None,
                "tipo": tipo,
                "productos": set(),
                "_pdv_ids": set(),
                "pdvNombres": [],
            }
        row["tipo"] = row["tipo"] or tipo
        row["productos"].update(_supplier_products(products_raw))
        if pdv_id not in row["_pdv_ids"]:
            row["_pdv_ids"].add(pdv_id)
            row["pdvNombres"].append(pdv_nombre)

    items = []
    for row in agg.values():
        items.append({
            "nombre": row["nombre"],
            "telefono": row["telefono"],
            "tipo": row["tipo"],
            "productos": sorted(row["productos"]),
            "pdvs": len(row["_pdv_ids"]),
            "pdvNombres": sorted(row["pdvNombres"])[:30],
        })
    items.sort(key=lambda r: (-r["pdvs"], r["nombre"].lower()))
    return {"items": items, "total": len(items)}
