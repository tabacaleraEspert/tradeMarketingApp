"""Migración de datos 2026-11-19: cadenas y key accounts como entidad (tabla Chain).

Requiere el DDL aplicado (local: `alembic upgrade head`; prod:
scripts/ddl_chains_20261119.py) y el backend nuevo deployado. Conexión =
app.database (env-driven: DATABASE_URL / DATABASE_USER+PASSWORD → Azure SQL; sin
ellas → SQLite local). Imprime a qué base apunta antes de hacer nada.

Qué hace (todo en UNA transacción; sin --commit no escribe nada):
  (i)   Crea una Chain (Kind 'cadena', canal "Cadenas de Proximidad") por cada subcanal
        ACTIVO de ese canal que no sea Chica/Mediana/Grande. Los duplicados obvios se
        fusionan con SUBCHANNEL_TO_CHAIN (abajo, revisable). Los dudosos quedan
        SEPARADOS y se listan como "posibles duplicados" para fusionar a mano desde
        Canales › Cadenas. NOT_A_CHAIN = subcanales que no son cadenas (no se tocan).
  (ii)  Asegura las cadenas de KEY_ACCOUNT_CHAINS (import de Santiago, 2026-11-11):
        IsKeyAccount=1, AccountManagerUserId=149, StoreCount del Excel. Y OTHER_CHAINS
        (Open 25: 282 locales, NO key account).
  (iii) PDV.ChainId: PDVs del canal de cadenas → por su subcanal actual; PDVs `CAD-*`
        → por el prefijo del nombre (`<Cadena> - <Dirección>`); los 82 PDVs "reusados"
        del log del import → por CHAIN_PATTERNS sobre su nombre.
  (iv)  Todo PDV que recibió cadena pasa a ChannelId = Cadenas de Proximidad (+ texto
        legacy PDV.Channel) y SubChannelId = escalón de tamaño de la cadena
        (≤10 Chica, 11–30 Mediana, >30 Grande; crea los 3 subcanales si faltan).
  (v)   Desactiva los subcanales con nombre de cadena y el subcanal "Key Accounts/
        Cuentas Claves" cuando ningún PDV los referencia.
  (vi)  Siembra banderas (Kind 'bandera', canal "Estación de Servicio"): BANDERAS.
        No asigna PDVs.

  (vii) ACTIVIDADES OBLIGATORIAS (decisión de Davor 2026-11-19): los PDVs que cambian de
        canal tienen que SEGUIR recibiendo las actividades obligatorias que reciben hoy.
        La plantilla (MandatoryActivity) solo se puede acotar por canal y/o por ruta —
        no hay alcance por PDV ni por cadena, y app/routers/visits.py siembra con
        IsActive + ChannelId + RouteId (NO mira ValidFrom/ValidTo) — así que no existe
        un mecanismo más fino sin cambiar el esquema. Entonces: por cada actividad
        ACTIVA acotada al canal de origen (hoy: Convenience) se asegura una equivalente
        acotada al canal de cadenas: se CLONA con todos sus campos (mismo formulario,
        misma ruta si la tenía, mismas fechas, mismo creador). Idempotente: si ya hay
        una equivalente activa (mismo nombre + tipo + ruta + formulario) no hace nada;
        si hay una equivalente INACTIVA la reactiva. Queda en el backup y el rollback
        desactiva los clones.
        EFECTO COLATERAL (el dry-run lo detalla): los PDVs que YA estaban en el canal
        de cadenas también empiezan a recibir esas actividades, y los PDVs movidos
        empiezan a recibir las que el canal de cadenas ya tenía.
        Opt-out: --no-clone-mandatory-activities (los PDVs movidos PIERDEN las del
        canal viejo). El flag forma parte del plan: usar el mismo en dry-run y commit.

Seguridad:
  - Imprime servidor y base destino y corta si el entorno es ambiguo (misma resolución
    que la app y que ddl_chains; ver chains_ops_20261119.py).
  - Ids buscados por NOMBRE y verificados contra EXPECTED_IDS (aborta si no coinciden;
    --skip-id-check solo para ensayo local).
  - --commit EXIGE --plan-json con el plan del dry-run que se revisó: se vuelve a armar
    el plan y, si difiere (hash) del revisado o es de otra base, aborta sin escribir.
  - Confirmación tipeada (nombre de la base) antes de escribir; --yes la saltea.
  - Actividades obligatorias (MandatoryActivity): ver "(vii)" abajo.
  - build_plan verifica que toda cadena asignada exista o se cree (si no, el DRY-RUN falla).
  - Backup JSON de TODA fila que cambia, escrito ANTES de aplicar. Idempotente: una
    segunda pasada no cambia nada. Rollback: scripts/rollback_chains_20261119.py <backup.json>.

CORRER FUERA DE HORARIO: actualiza ~900 PDVs en una transacción (pocos UPDATE por
grupo cadena/subcanal, no fila por fila) y toma locks sobre PDV. Con SET LOCK_TIMEOUT
(15 s, solo SQL Server) falla y revierte en vez de quedarse esperando detrás de la app.

Uso (desde backend/):
    python scripts/migrate_chains_20261119.py --plan-json plan_cadenas.json      # dry-run (default): escribe el plan
    # …revisar el resumen y plan_cadenas.json…
    python scripts/migrate_chains_20261119.py --commit --plan-json plan_cadenas.json
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import chains_ops_20261119 as ops  # noqa: E402

PDV_BATCH = 500  # ids por UPDATE (SQL Server admite 2100 parámetros por sentencia)

# ═══════════════════════ CONFIG REVISABLE ═══════════════════════════

CHAIN_CHANNEL = "Cadenas de Proximidad"
STATION_CHANNEL = "Estación de Servicio"
LEGACY_KA_CHANNEL = "Convenience"
LEGACY_KA_SUBCHANNEL = "Key Accounts/Cuentas Claves"
ACCOUNT_MANAGER_NAME = "Gallastegui"  # Santiago Gallastegui

# Ids de prod: se buscan por nombre y se VERIFICAN contra esto (aborta si difieren).
EXPECTED_IDS = {
    "chain_channel": 22,       # Channel "Cadenas de Proximidad"
    "legacy_ka_channel": 9,    # Channel "Convenience"
    "legacy_ka_subchannel": 62,  # SubChannel "Key Accounts/Cuentas Claves"
    "account_manager": 149,    # User Santiago Gallastegui
}

# Subcanales de tamaño (se crean si faltan). Se reconocen SOLO por estos tres nombres
# (se tolera el paréntesis): misma regla que app/services/chains.py bucket_key().
BUCKET_SUBCHANNELS = {
    "chica": "Chica (menos de 10 PDVs)",
    "mediana": "Mediana (11 a 30 PDVs)",
    "grande": "Grande (más de 30 PDVs)",
}

# (i) Fusión de duplicados OBVIOS: subcanal existente → nombre canónico de la cadena.
# Lo que no está acá se convierte en cadena con su propio nombre. Comparación
# normalizada (sin tildes / mayúsculas / signos), así "Tommy's shop" == "tommys shop".
SUBCHANNEL_TO_CHAIN = {
    "Tomyshop": "Tommy Shop",
    "Tommy's shop": "Tommy Shop",
    "Tommy Shop": "Tommy Shop",
    "Open25": "Open 25",
    "Open 25": "Open 25",
    "New Era": "SAM - New Era",
    "Oeste drugstore": "Oeste Drugstore",
    "Deli Moon": "Deli moon",
    "K 24": "K24",
}
# A PROPÓSITO sin fusionar (no es obvio que sean lo mismo; se listan en el dry-run):
#   "24/7"  vs  "24.7 El Point"  vs  "DIGUO - Drugstores 24"  vs  "K24"  vs  "MD Market 24hs"
#   "Drugstore Argentina"  vs  "Oeste Drugstore"

# Subcanales del canal de cadenas que NO son una cadena (formato genérico): no se
# convierten ni se desactivan; sus PDVs quedan sin cadena y van al Excel de revisión.
NOT_A_CHAIN = {"Maxikiosco", "Kiosco", "Otro", "Otros", "Independiente"}

# (ii) Cadenas key account del import de Santiago. patterns = regex sobre el nombre
# normalizado del PDV (mismas de scripts/import_cadenas_api.py CHAIN_PATTERNS).
KEY_ACCOUNT_CHAINS = [
    # (nombre canónico, locales reales [Ruteo.xlsx], regex, alias)
    ("365", 109, r"\b365\b", ""),
    ("K24", 86, r"m(ar)?(k|qu)et ?24|\bm ?24\b|\bk ?24\b", "Market 24"),
    ("El Jevi", 69, r"jevi", ""),
    ("Cartu7-24", 53, r"cartu", "Cartu"),
    ("The Best", 40, r"the ?best", ""),
    ("SAM - New Era", 24, r"new ?era|\bsam\b", "New Era, SAM"),
    ("Oeste Drugstore", 23, r"oeste ?drug", ""),
    ("Deli moon", 19, r"deli ?moon", ""),
    ("Tommy Shop", 17, r"tommy", "Tomyshop, Tommy's shop"),
    ("DIGUO - Drugstores 24", 13, r"drug ?stores? ?24|diguo", "DIGUO, Drugstores 24, DIGUO - Drusgstores 24"),  # sic: así vino en el Excel
    ("La Piñata", 4, r"pinata", ""),
]
# Cadenas con StoreCount conocido que NO son key account.
OTHER_CHAINS = [
    ("Open 25", 282, "Open25"),  # la cadena está cerrando, pero los PDVs existen
]

# (vi) Banderas de estaciones de servicio.
BANDERAS = ["YPF", "Shell", "Axion", "Puma", "Gulf", "Refinor", "Dapsa", "Voy"]

IMPORT_LOG = HERE / "import_cadenas_prod_20261111.json"
CAD_CODE_PREFIX = "CAD-"
AUDIT_SOURCE = "migrate_chains_20261119"

# ═══════════════════════ FUNCIONES PURAS ════════════════════════════


def norm(s) -> str:
    """Clave de comparación: sin tildes, minúsculas, solo alfanumérico."""
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", s)


def norm_spaces(s) -> str:
    """Para los regex de CHAIN_PATTERNS: sin tildes, minúsculas, conserva espacios."""
    return unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()


def size_bucket(n: int) -> str:
    return "chica" if n <= 10 else "mediana" if n <= 30 else "grande"


_BUCKET_RE = re.compile(r"^(chica|mediana|grande)(\s*\(|$)")


def is_bucket_subchannel(name: str) -> str | None:
    """'chica'|'mediana'|'grande' si el subcanal ES un escalón de tamaño ("Chica",
    "Mediana (11 a 30 PDVs)"); None para "Chicago Kiosco", "Grande Almacen", etc."""
    m = _BUCKET_RE.match(" ".join(norm_spaces(name).split()))
    return m.group(1) if m else None


def plan_fingerprint(plan: dict, target: dict | None = None) -> str:
    """Hash estable del plan (+ base destino). El --commit lo compara contra el del
    dry-run revisado: si la base cambió en el medio, o es otra base, no coincide."""
    body = {k: v for k, v in plan.items() if k not in ("assign", "plan_hash", "target")}
    tgt = {k: (target or {}).get(k) for k in ("kind", "server", "database")}
    blob = json.dumps({"plan": body, "target": tgt}, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def canonical_for_subchannel(name: str) -> str | None:
    """Nombre de cadena para un subcanal del canal de cadenas; None = no es cadena."""
    if is_bucket_subchannel(name):
        return None
    key = norm(name)
    if key in {norm(x) for x in NOT_A_CHAIN}:
        return None
    for src, dst in SUBCHANNEL_TO_CHAIN.items():
        if norm(src) == key:
            return dst
    # ¿coincide con el nombre canónico de una cadena conocida? (ej. "the best" → "The Best")
    for known in [c[0] for c in KEY_ACCOUNT_CHAINS] + [c[0] for c in OTHER_CHAINS]:
        if norm(known) == key:
            return known
    return " ".join(str(name).split())


def chain_from_cad_name(pdv_name: str, known: dict[str, str]) -> str | None:
    """`<Cadena> - <Dirección>` → cadena. known = {norm(nombre o alias): canónico}.
    Prueba el prefijo más largo primero ("SAM - New Era - ESMERALDA 899")."""
    parts = str(pdv_name or "").split(" - ")
    for i in range(len(parts) - 1, 0, -1):
        hit = known.get(norm(" - ".join(parts[:i])))
        if hit:
            return hit
    return None


def chain_from_patterns(pdv_name: str) -> str | None:
    """CHAIN_PATTERNS del import. None si no matchea o matchea más de una cadena."""
    n = norm_spaces(pdv_name)
    hits = [name for name, _cnt, pat, _al in KEY_ACCOUNT_CHAINS if re.search(pat, n)]
    return hits[0] if len(hits) == 1 else None


def merge_aliases(*values: str | None, exclude: str = "") -> str | None:
    out: list[str] = []
    seen = {norm(exclude)}
    for v in values:
        for part in str(v or "").split(","):
            p = " ".join(part.split())
            if p and norm(p) not in seen:
                out.append(p)
                seen.add(norm(p))
    joined = ", ".join(out)
    while len(joined) > 500 and out:
        out.pop()
        joined = ", ".join(out)
    return joined or None


def possible_duplicates(names: list[str]) -> list[tuple[str, str]]:
    """Pares de cadenas que PODRÍAN ser la misma (para revisión humana, no se fusionan)."""
    out = []
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            na, nb = norm(a), norm(b)
            if not na or not nb:
                continue
            contained = min(len(na), len(nb)) >= 4 and (na in nb or nb in na)
            digits = lambda s: re.sub(r"\D", "", s)  # noqa: E731
            same_247 = digits(na) in ("247", "724") and digits(nb) in ("247", "724")
            if contained or same_247 or difflib.SequenceMatcher(None, na, nb).ratio() >= 0.8:
                out.append((a, b))
    return out


class PlanError(Exception):
    """El plan armado no es aplicable (se detecta en el dry-run)."""


def check_assignments(pdv_changes: list[dict], resolvable: set[str]) -> None:
    """resolvable = claves norm() de las cadenas del canal que existen o se crean en el plan."""
    orphans = sorted({c["chain"] for c in pdv_changes if norm(c["chain"]) not in resolvable})
    if orphans:
        n = sum(1 for c in pdv_changes if c["chain"] in orphans)
        raise PlanError(f"PLAN INCONSISTENTE: {n} PDVs asignados a cadenas que no existen ni se crean: {orphans}")


MA_FIELDS = ("Name", "ActionType", "Description", "DetailsJson", "PhotoRequired", "RouteId", "FormId",
             "ValidFrom", "ValidTo", "CreatedByUserId")


def ma_key(a: dict) -> tuple:
    """Dos actividades son "equivalentes" si coinciden nombre, tipo, ruta y formulario."""
    return (norm(a["Name"]), a["ActionType"], a.get("RouteId"), a.get("FormId"))


def plan_mandatory_activities(activities: list[dict], moved_from: dict, ch22: int,
                              pdvs_already_in_22: int, clone: bool = True) -> dict:
    """(vii) Qué hacer con las actividades obligatorias por canal. Puro.

    activities: TODAS las MandatoryActivity con ChannelId (activas e inactivas).
    moved_from: {ChannelId origen: cantidad de PDVs que pasan al canal de cadenas}.
    """
    in22 = [a for a in activities if a["ChannelId"] == ch22]
    active22 = {ma_key(a): a for a in in22 if a["IsActive"]}
    inactive22 = {}
    for a in in22:
        if not a["IsActive"]:
            inactive22.setdefault(ma_key(a), a)
    sources = [a for a in activities if a["IsActive"] and a["ChannelId"] != ch22 and moved_from.get(a["ChannelId"])]
    to_clone, to_reactivate, already = [], [], []
    seen: set[tuple] = set()
    for a in sorted(sources, key=lambda a: a["MandatoryActivityId"]):
        k = ma_key(a)
        ref = {"source_id": a["MandatoryActivityId"], "source_channel": a["ChannelId"], "Name": a["Name"],
               "ActionType": a["ActionType"], "pdvs_movidos": moved_from[a["ChannelId"]]}
        if k in active22:
            already.append({**ref, "existing_id": active22[k]["MandatoryActivityId"]})
        elif k in seen:
            already.append({**ref, "existing_id": None})   # otra del mismo plan ya la cubre
        elif not clone:
            continue
        elif k in inactive22:
            to_reactivate.append({**ref, "MandatoryActivityId": inactive22[k]["MandatoryActivityId"]})
            seen.add(k)
        else:
            to_clone.append({**ref, **{f: a.get(f) for f in MA_FIELDS}, "ChannelId": ch22})
            seen.add(k)
    lost = [] if clone else [
        {"source_id": a["MandatoryActivityId"], "source_channel": a["ChannelId"], "Name": a["Name"],
         "ActionType": a["ActionType"], "pdvs_movidos": moved_from[a["ChannelId"]]}
        for a in sources if ma_key(a) not in active22]
    return {
        "clone_enabled": clone, "clone": to_clone, "reactivate": to_reactivate, "already_equivalent": already,
        "lost_by_moved": lost,
        # las que el canal de cadenas YA tenía: los PDVs movidos las empiezan a recibir
        "gained_by_moved": [{"MandatoryActivityId": a["MandatoryActivityId"], "Name": a["Name"],
                             "ActionType": a["ActionType"], "RouteId": a.get("RouteId")}
                            for a in sorted(active22.values(), key=lambda a: a["MandatoryActivityId"])],
        "pdvs_moved": sum(moved_from.values()), "pdvs_already_in_chain_channel": pdvs_already_in_22,
    }


def build_plan(state: dict, import_log: dict, clone_mandatory: bool = True) -> dict:
    """Plan completo a partir de un snapshot de la base (dicts planos). No toca la DB.

    state = {
      ids: {chain_channel, station_channel, legacy_ka_subchannel, account_manager},
      subchannels: [{SubChannelId, ChannelId, Name, IsActive}],          # de los canales involucrados
      chains: [{ChainId, Name, ChannelId, Kind, IsKeyAccount, AccountManagerUserId, StoreCount, Aliases, IsActive}],
      pdvs: [{PdvId, Code, Name, Channel, ChannelId, SubChannelId, ChainId, IsActive}],
      channel_names: {ChannelId: Name},
    }
    """
    ids = state["ids"]
    ch22 = ids["chain_channel"]
    notes: list[str] = []

    subs_22 = [s for s in state["subchannels"] if s["ChannelId"] == ch22]
    sub_by_id = {s["SubChannelId"]: s for s in state["subchannels"]}

    # ── (i)+(ii) cadenas deseadas ──
    desired: dict[tuple[int, str], dict] = {}  # (ChannelId, norm(canónico)) → spec

    def want(name: str, kind="cadena", channel=ch22) -> dict:
        return desired.setdefault((channel, norm(name)), {
            "Name": name, "ChannelId": channel, "Kind": kind, "IsKeyAccount": None,
            "AccountManagerUserId": None, "StoreCount": None, "aliases": [], "from_subchannels": [],
        })

    sub_to_chain: dict[int, str] = {}  # SubChannelId → nombre canónico
    not_chain_subs: list[dict] = []
    # PDVs (sin cadena) del canal que referencian cada subcanal: un subcanal INACTIVO con
    # nombre de cadena que todavía tiene PDVs también genera su cadena (si no, esos PDVs
    # quedarían asignados a una cadena que nadie crea → KeyError recién en el --commit).
    refs_22 = Counter(p["SubChannelId"] for p in state["pdvs"]
                      if p["ChannelId"] == ch22 and not p["ChainId"] and p["SubChannelId"] is not None)
    inactive_subs_with_pdvs: list[dict] = []
    for s in subs_22:
        if is_bucket_subchannel(s["Name"]):
            continue
        canon = canonical_for_subchannel(s["Name"])
        if canon is None:
            not_chain_subs.append(s)
            continue
        referenced = refs_22.get(s["SubChannelId"], 0)
        if not s["IsActive"] and not referenced:
            continue  # inactivo y sin PDVs: no crea cadena ni asigna nada
        if not s["IsActive"]:
            inactive_subs_with_pdvs.append({**s, "pdvs": referenced, "chain": canon})
        spec = want(canon)
        spec["from_subchannels"].append(s["Name"] if s["IsActive"] else f"{s['Name']} (inactivo, {referenced} PDVs)")
        if norm(s["Name"]) != norm(canon):
            spec["aliases"].append(s["Name"])
        sub_to_chain[s["SubChannelId"]] = canon

    for name, count, _pat, aliases in KEY_ACCOUNT_CHAINS:
        spec = want(name)
        spec.update(IsKeyAccount=True, AccountManagerUserId=ids["account_manager"], StoreCount=count)
        spec["aliases"].append(aliases)
    for name, count, aliases in OTHER_CHAINS:
        spec = want(name)
        spec.update(IsKeyAccount=False, StoreCount=count)
        spec["aliases"].append(aliases)
    if ids.get("station_channel") is not None:
        for name in BANDERAS:
            want(name, kind="bandera", channel=ids["station_channel"])

    existing = {(c["ChannelId"], norm(c["Name"])): c for c in state["chains"]}
    chains_create, chains_update = [], []
    for key, spec in desired.items():
        cur = existing.get(key)
        if cur is None:
            chains_create.append({
                "Name": spec["Name"], "ChannelId": spec["ChannelId"], "Kind": spec["Kind"],
                "IsKeyAccount": bool(spec["IsKeyAccount"]), "AccountManagerUserId": spec["AccountManagerUserId"],
                "StoreCount": spec["StoreCount"], "Aliases": merge_aliases(*spec["aliases"], exclude=spec["Name"]),
                "from_subchannels": spec["from_subchannels"],
            })
            continue
        changes = {}
        # Solo se pisan los atributos que este script DEFINE (key accounts / StoreCount);
        # lo que el admin haya editado en cadenas que el script no define no se toca.
        for f in ("IsKeyAccount", "AccountManagerUserId", "StoreCount"):
            if spec[f] is not None and cur[f] != spec[f]:
                changes[f] = spec[f]
        al = merge_aliases(cur["Aliases"], *spec["aliases"], exclude=cur["Name"])
        if al != (cur["Aliases"] or None):
            changes["Aliases"] = al
        if not cur["IsActive"]:
            changes["IsActive"] = True
        if changes:
            chains_update.append({"ChainId": cur["ChainId"], "Name": cur["Name"], "before": {k: cur[k] for k in changes}, "after": changes})

    # ── (iii) cadena de cada PDV ──
    known = {}
    for (channel, _k), spec in desired.items():
        if channel != ch22:
            continue
        known[norm(spec["Name"])] = spec["Name"]
        for a in (merge_aliases(*spec["aliases"]) or "").split(","):
            if norm(a):
                known.setdefault(norm(a), spec["Name"])
    for c in state["chains"]:  # cadenas ya existentes (re-ejecución / creadas a mano)
        # Las inactivas no reciben PDVs: si se fusionó, su nombre es alias de la que la absorbió.
        if c["ChannelId"] == ch22 and c["Kind"] == "cadena" and c["IsActive"]:
            known.setdefault(norm(c["Name"]), c["Name"])
            for a in str(c["Aliases"] or "").split(","):
                if norm(a):
                    known.setdefault(norm(a), c["Name"])

    reused = {int(r["PdvId"]): r for r in import_log.get("reused", [])}
    log_cad_ids = {int(p["PdvId"]) for p in import_log.get("pdvs", [])}

    assign: dict[int, tuple[str, str]] = {}  # PdvId → (cadena, origen)
    unmatched: list[dict] = []
    conflicts: list[dict] = []
    chain_name_by_id = {c["ChainId"]: c["Name"] for c in state["chains"]}
    for p in state["pdvs"]:
        if p["ChainId"]:
            continue  # ya vinculado (re-ejecución o editado a mano): no se pisa
        by_sub = sub_to_chain.get(p["SubChannelId"]) if p["ChannelId"] == ch22 else None
        by_import = None
        origin = None
        is_cad = str(p["Code"] or "").startswith(CAD_CODE_PREFIX)
        if is_cad:
            by_import = chain_from_cad_name(p["Name"], known) or chain_from_patterns(p["Name"])
            origin = "CAD-*"
        elif p["PdvId"] in reused:
            by_import = chain_from_patterns(p["Name"]) or chain_from_patterns(reused[p["PdvId"]].get("Name"))
            origin = "reusado"
        chosen, chosen_origin = (by_import, origin) if by_import else (by_sub, "subcanal")
        if by_import and by_sub and norm(by_import) != norm(by_sub):
            # Reusados (PDVs que ya existían): su subcanal actual lo cargó una persona en
            # campo; el regex sobre el nombre es una heurística → GANA EL SUBCANAL.
            # CAD-*: el nombre lo generó el import (`<Cadena> - <Dirección>`) → gana el import.
            if origin == "reusado":
                chosen, chosen_origin = by_sub, "subcanal"
            sub_name = (sub_by_id.get(p["SubChannelId"]) or {}).get("Name")
            conflicts.append({"PdvId": p["PdvId"], "Code": p["Code"], "Name": p["Name"], "origen": origin,
                              "subcanal_actual": sub_name, "por_subcanal": by_sub, "por_import": by_import,
                              "gana": chosen, "criterio": "subcanal" if chosen_origin == "subcanal" else "import"})
        if chosen:
            assign[p["PdvId"]] = (chosen, chosen_origin)
        elif is_cad or p["PdvId"] in reused:
            unmatched.append({"PdvId": p["PdvId"], "Code": p["Code"], "Name": p["Name"], "origen": origin})

    pdv_ids_db = {p["PdvId"] for p in state["pdvs"]}
    cad_db = {p["PdvId"] for p in state["pdvs"] if str(p["Code"] or "").startswith(CAD_CODE_PREFIX)}
    if log_cad_ids - cad_db:
        notes.append(f"{len(log_cad_ids - cad_db)} PDVs CAD-* del log ya no están (o cambiaron de Code): {sorted(log_cad_ids - cad_db)[:15]}")
    if cad_db - log_cad_ids:
        notes.append(f"{len(cad_db - log_cad_ids)} PDVs CAD-* en la base que no figuran en el log (se migran igual por nombre)")
    if set(reused) - pdv_ids_db:
        notes.append(f"{len(set(reused) - pdv_ids_db)} PDVs 'reusados' del log ya no existen: {sorted(set(reused) - pdv_ids_db)[:15]}")

    # ── (iv) tamaño → subcanal ──
    per_chain = Counter()  # PDVs activos por cadena: los que se asignan ahora + los ya vinculados
    for p in state["pdvs"]:
        if not p["IsActive"]:
            continue
        if p["PdvId"] in assign:
            per_chain[norm(assign[p["PdvId"]][0])] += 1
        elif p["ChainId"] and p["ChannelId"] == ch22:
            per_chain[norm(chain_name_by_id.get(p["ChainId"]))] += 1
    store_count = {}
    for (channel, key), spec in desired.items():
        if channel == ch22:
            store_count[key] = spec["StoreCount"]
    for c in state["chains"]:
        if c["ChannelId"] == ch22:
            if store_count.get(norm(c["Name"])) is None:
                store_count[norm(c["Name"])] = c["StoreCount"]
    chain_bucket = {}
    for key in {norm(v[0]) for v in assign.values()} | {k for (ch, k) in desired if ch == ch22}:
        n = store_count.get(key)
        chain_bucket[key] = size_bucket(n if n is not None else per_chain.get(key, 0))

    bucket_sub: dict[str, int | None] = {}
    bucket_info: dict[str, dict] = {}
    subs_create, subs_activate = [], []
    for bkey, bname in BUCKET_SUBCHANNELS.items():
        found = sorted([s for s in subs_22 if is_bucket_subchannel(s["Name"]) == bkey],
                       key=lambda s: (not s["IsActive"], s["SubChannelId"]))
        if found:
            bucket_sub[bkey] = found[0]["SubChannelId"]
            bucket_info[bkey] = {"SubChannelId": found[0]["SubChannelId"], "Name": found[0]["Name"],
                                 "estado": "existe" if found[0]["IsActive"] else "se reactiva",
                                 "otros_ignorados": [f"{s['SubChannelId']}:{s['Name']}" for s in found[1:]]}
            if not found[0]["IsActive"]:
                subs_activate.append(found[0])
        else:
            bucket_sub[bkey] = None  # se crea en apply
            bucket_info[bkey] = {"SubChannelId": None, "Name": bname, "estado": "SE CREA", "otros_ignorados": []}
            subs_create.append({"key": bkey, "Name": bname, "ChannelId": ch22})

    chain_channel_name = state["channel_names"][ch22]
    pdv_changes = []
    for p in state["pdvs"]:
        if p["PdvId"] not in assign:
            continue
        chain_name, origin = assign[p["PdvId"]]
        bkey = chain_bucket[norm(chain_name)]
        target_chain = existing.get((ch22, norm(chain_name)))
        after = {
            "ChannelId": ch22, "Channel": chain_channel_name[:40],
            "SubChannelId": bucket_sub[bkey],  # None = subcanal a crear
            "ChainId": target_chain["ChainId"] if target_chain else None,  # None = cadena a crear
        }
        before = {k: p[k] for k in ("ChannelId", "Channel", "SubChannelId", "ChainId")}
        pending_new = (after["SubChannelId"] is None) or (after["ChainId"] is None)
        if pending_new or any(before[k] != after[k] for k in after):
            pdv_changes.append({
                "PdvId": p["PdvId"], "Name": p["Name"], "Code": p["Code"], "IsActive": p["IsActive"],
                "chain": chain_name, "bucket": bkey, "origin": origin, "before": before, "after": after,
            })

    # ── (v) subcanales a desactivar ──
    final_sub = {p["PdvId"]: p["SubChannelId"] for p in state["pdvs"]}
    for ch in pdv_changes:
        final_sub[ch["PdvId"]] = ("bucket", ch["bucket"])
    still_used = Counter(v for v in final_sub.values() if isinstance(v, int))
    candidates = [s for s in subs_22 if s["SubChannelId"] in sub_to_chain]
    ka_sub = sub_by_id.get(ids.get("legacy_ka_subchannel"))
    if ka_sub:
        candidates.append(ka_sub)
    subs_deactivate, subs_blocked = [], []
    for s in candidates:
        if not s["IsActive"]:
            continue
        n = still_used.get(s["SubChannelId"], 0)
        (subs_blocked if n else subs_deactivate).append({**s, "pdvs_restantes": n})

    # PDVs del canal de cadenas que quedan sin cadena (→ Excel de revisión)
    no_chain_22 = [p for p in state["pdvs"] if p["ChannelId"] == ch22 and p["PdvId"] not in assign and not p["ChainId"]]

    cadena_names = sorted({spec["Name"] for (ch, _k), spec in desired.items() if ch == ch22}
                          | {c["Name"] for c in state["chains"] if c["ChannelId"] == ch22 and c["Kind"] == "cadena"})

    # Invariante: toda cadena asignada existe o se crea en este mismo plan. Si no, el
    # plan está roto y hay que enterarse en el DRY-RUN, no a mitad del --commit.
    check_assignments(pdv_changes, {k for (ch, k) in desired if ch == ch22} | {k for (ch, k) in existing if ch == ch22})

    moved_from = Counter(c["before"]["ChannelId"] for c in pdv_changes
                         if c["before"]["ChannelId"] not in (ch22, None) and c["IsActive"])
    already_22 = sum(1 for p in state["pdvs"] if p["ChannelId"] == ch22 and p["IsActive"])
    return {
        "mandatory": plan_mandatory_activities(state.get("mandatory_activities", []), dict(moved_from), ch22,
                                               already_22, clone_mandatory),
        "moved_from_channel": {str(k): v for k, v in sorted(moved_from.items(), key=lambda kv: str(kv[0]))},
        "bucket_subchannels": bucket_info, "inactive_subs_with_pdvs": inactive_subs_with_pdvs,
        "chains_create": chains_create, "chains_update": chains_update,
        "subs_create": subs_create, "subs_activate": subs_activate,
        "pdv_changes": pdv_changes, "subs_deactivate": subs_deactivate, "subs_blocked": subs_blocked,
        "not_chain_subs": not_chain_subs, "unmatched": unmatched, "conflicts": conflicts,
        "no_chain_22": no_chain_22, "possible_duplicates": possible_duplicates(cadena_names),
        "chain_bucket": chain_bucket, "per_chain_active": dict(per_chain), "assign": assign, "notes": notes,
    }


# ═══════════════════════ DB ═════════════════════════════════════════


def _one_by_name(rows, name: str, what: str):
    hits = [r for r in rows if norm(r.Name) == norm(name)]
    active = [r for r in hits if getattr(r, "IsActive", True)]
    if len(active) == 1:
        return active[0]
    if len(hits) == 1:
        return hits[0]
    raise SystemExit(f"ABORTO: esperaba exactamente 1 {what} llamado '{name}', hay {len(hits)}")


def load_state(db, skip_id_check: bool) -> dict:
    from app.models import PDV, Channel, SubChannel, User
    from app.models.chain import Chain

    channels = db.query(Channel).all()
    ch_chain = _one_by_name(channels, CHAIN_CHANNEL, "canal")
    ch_station = _one_by_name(channels, STATION_CHANNEL, "canal")
    ch_ka = _one_by_name(channels, LEGACY_KA_CHANNEL, "canal")
    ka_subs = [s for s in db.query(SubChannel).filter(SubChannel.ChannelId == ch_ka.ChannelId).all()
               if norm(s.Name) == norm(LEGACY_KA_SUBCHANNEL)]
    if len(ka_subs) > 1:
        raise SystemExit(f"ABORTO: hay {len(ka_subs)} subcanales '{LEGACY_KA_SUBCHANNEL}' en {LEGACY_KA_CHANNEL}")
    managers = [u for u in db.query(User).all() if norm(ACCOUNT_MANAGER_NAME) in norm(u.DisplayName)]
    if len(managers) != 1:
        raise SystemExit(f"ABORTO: esperaba 1 usuario '*{ACCOUNT_MANAGER_NAME}*', hay {len(managers)}: "
                         f"{[(u.UserId, u.DisplayName) for u in managers]}")
    found = {
        "chain_channel": ch_chain.ChannelId,
        "legacy_ka_channel": ch_ka.ChannelId,
        "legacy_ka_subchannel": ka_subs[0].SubChannelId if ka_subs else None,
        "account_manager": managers[0].UserId,
    }
    mismatches = {k: (found[k], v) for k, v in EXPECTED_IDS.items() if found[k] != v}
    # el subcanal de key accounts puede ya no existir en una re-ejecución… pero entonces no hay id que comparar
    if mismatches:
        msg = "; ".join(f"{k}: encontrado {a}, esperado {b}" for k, (a, b) in mismatches.items())
        if not skip_id_check:
            raise SystemExit(f"ABORTO: ids distintos a los esperados de prod → {msg}\n"
                             "(¿base equivocada? --skip-id-check solo para ensayo local)")
        print(f"⚠ --skip-id-check: {msg}")

    subs = db.query(SubChannel).filter(SubChannel.ChannelId.in_([ch_chain.ChannelId, ch_ka.ChannelId])).all()
    from app.models.mandatory_activity import MandatoryActivity
    acts = (db.query(MandatoryActivity).filter(MandatoryActivity.ChannelId.isnot(None))
            .order_by(MandatoryActivity.MandatoryActivityId).all())
    return {
        "mandatory_activities": [
            {"MandatoryActivityId": a.MandatoryActivityId, "Name": a.Name, "ActionType": a.ActionType,
             "Description": a.Description, "DetailsJson": a.DetailsJson, "PhotoRequired": bool(a.PhotoRequired),
             "ChannelId": a.ChannelId, "RouteId": a.RouteId, "FormId": a.FormId,
             "ValidFrom": str(a.ValidFrom) if a.ValidFrom else None, "ValidTo": str(a.ValidTo) if a.ValidTo else None,
             "CreatedByUserId": a.CreatedByUserId, "IsActive": bool(a.IsActive)}
            for a in acts],
        "ids": {**found, "station_channel": ch_station.ChannelId},
        "channel_names": {c.ChannelId: c.Name for c in channels},
        "manager_name": managers[0].DisplayName,
        "subchannels": [{"SubChannelId": s.SubChannelId, "ChannelId": s.ChannelId, "Name": s.Name,
                         "IsActive": bool(s.IsActive)} for s in subs],
        "chains": [{"ChainId": c.ChainId, "Name": c.Name, "ChannelId": c.ChannelId, "Kind": c.Kind,
                    "IsKeyAccount": bool(c.IsKeyAccount), "AccountManagerUserId": c.AccountManagerUserId,
                    "StoreCount": c.StoreCount, "Aliases": c.Aliases, "IsActive": bool(c.IsActive)}
                   for c in db.query(Chain).all()],
        "pdvs": [{"PdvId": r.PdvId, "Code": r.Code, "Name": r.Name, "Channel": r.Channel, "ChannelId": r.ChannelId,
                  "SubChannelId": r.SubChannelId, "ChainId": r.ChainId, "IsActive": bool(r.IsActive)}
                 for r in db.query(PDV.PdvId, PDV.Code, PDV.Name, PDV.Channel, PDV.ChannelId,
                                   PDV.SubChannelId, PDV.ChainId, PDV.IsActive).all()],
    }


def print_summary(state: dict, plan: dict) -> None:
    ids = state["ids"]
    P = print
    P("\n══════════ RESUMEN ══════════")
    P(f"Canal cadenas: {state['channel_names'][ids['chain_channel']]} (id {ids['chain_channel']}) · "
      f"Estaciones: id {ids['station_channel']} · Subcanal key accounts: id {ids['legacy_ka_subchannel']} · "
      f"Responsable: {state['manager_name']} (id {ids['account_manager']})")

    cad = [c for c in plan["chains_create"] if c["Kind"] == "cadena"]
    ban = [c for c in plan["chains_create"] if c["Kind"] == "bandera"]
    P(f"\n(i)+(ii) Cadenas a CREAR: {len(cad)}")
    for c in sorted(cad, key=lambda c: norm(c["Name"])):
        extra = []
        if c["IsKeyAccount"]:
            extra.append("KEY ACCOUNT")
        if c["StoreCount"] is not None:
            extra.append(f"{c['StoreCount']} locales")
        if c["from_subchannels"]:
            extra.append("de subcanal: " + " + ".join(c["from_subchannels"]))
        if c["Aliases"]:
            extra.append(f"alias: {c['Aliases']}")
        P(f"   + {c['Name']:<28} {' · '.join(extra)}")
    P(f"         Cadenas a ACTUALIZAR: {len(plan['chains_update'])}")
    for c in plan["chains_update"]:
        P(f"   ~ {c['Name']:<28} {c['before']} → {c['after']}")

    P(f"\n(iii)+(iv) PDVs a modificar: {len(plan['pdv_changes'])}")
    by_origin = Counter(c["origin"] for c in plan["pdv_changes"])
    P("   por origen: " + (", ".join(f"{k}={v}" for k, v in sorted(by_origin.items())) or "—"))
    moved = Counter(state["channel_names"].get(c["before"]["ChannelId"], c["before"]["ChannelId"])
                    for c in plan["pdv_changes"] if c["before"]["ChannelId"] != c["after"]["ChannelId"])
    P("   cambian de canal desde: " + (", ".join(f"{k}={v}" for k, v in moved.items()) or "ninguno"))
    by_chain = defaultdict(Counter)
    for c in plan["pdv_changes"]:
        by_chain[c["chain"]][c["origin"]] += 1
    P(f"   {'Cadena':<28} {'PDVs':>5}  {'activos tot.':>12}  {'tamaño':<8} detalle")
    for name in sorted(by_chain, key=lambda n: -sum(by_chain[n].values())):
        o = by_chain[name]
        P(f"   {name:<28} {sum(o.values()):>5}  {plan['per_chain_active'].get(norm(name), 0):>12}  "
          f"{plan['chain_bucket'][norm(name)]:<8} {dict(o)}")

    P("\n(iv) Subcanales de tamaño que se van a usar (canal de cadenas):")
    for key in BUCKET_SUBCHANNELS:
        b = plan["bucket_subchannels"][key]
        extra = f"  ⚠ hay otros que también matchean y NO se usan: {b['otros_ignorados']}" if b["otros_ignorados"] else ""
        P(f"   {key:<8} → id {b['SubChannelId'] if b['SubChannelId'] is not None else '(nuevo)'} "
          f"'{b['Name']}' [{b['estado']}]{extra}")
    P(f"(v)  Subcanales a DESACTIVAR: {len(plan['subs_deactivate'])} → {[s['Name'] for s in plan['subs_deactivate']]}")
    if plan["subs_blocked"]:
        P("     NO se desactivan (todavía los usan PDVs): "
          + ", ".join(f"{s['Name']} ({s['pdvs_restantes']})" for s in plan["subs_blocked"]))
    P(f"(vi) Banderas a crear: {[c['Name'] for c in ban] or 'ninguna (ya están)'}")

    P("\n── PARA REVISAR (no bloquea) ──")
    if plan["possible_duplicates"]:
        P("Posibles duplicados que quedan SEPARADOS (fusionar a mano en Canales › Cadenas si corresponde):")
        for a, b in plan["possible_duplicates"]:
            P(f"   ? {a}  ↔  {b}")
    if plan["not_chain_subs"]:
        P("Subcanales del canal de cadenas tratados como NO-cadena (NOT_A_CHAIN): "
          + ", ".join(s["Name"] for s in plan["not_chain_subs"]))
    P(f"PDVs del canal de cadenas que quedan SIN cadena: {len(plan['no_chain_22'])} (salen en el Excel de revisión)")
    if plan["unmatched"]:
        P(f"PDVs CAD-*/reusados sin cadena deducible ({len(plan['unmatched'])}) — NO se tocan:")
        for u in plan["unmatched"][:40]:
            P(f"   ! {u['PdvId']} [{u['Code']}] {u['Name']}")
    if plan["conflicts"]:
        P(f"Conflictos subcanal vs nombre ({len(plan['conflicts'])}, TODOS) — en los reusados gana el SUBCANAL, "
          "en los CAD-* el import. También van al plan JSON y al Excel de revisión:")
        for c in plan["conflicts"]:
            P(f"   ! {c['PdvId']} [{c['origen']}] {c['Name']!r}: subcanal '{c['subcanal_actual']}'→{c['por_subcanal']} "
              f"· nombre→{c['por_import']}  ⇒ queda en {c['gana']} (por {c['criterio']})")
    if plan["inactive_subs_with_pdvs"]:
        P("Subcanales INACTIVOS con nombre de cadena que todavía tienen PDVs (se crea/usa su cadena):")
        for s_ in plan["inactive_subs_with_pdvs"]:
            P(f"   ! {s_['SubChannelId']} '{s_['Name']}' — {s_['pdvs']} PDVs → cadena {s_['chain']}")
    for n in plan["notes"]:
        P(f"Nota: {n}")

    ma = plan["mandatory"]
    chn = lambda cid: f"{state['channel_names'].get(cid, cid)} (id {cid})"  # noqa: E731
    ch22_name = state["channel_names"][ids["chain_channel"]]
    P("\n── (vii) ACTIVIDADES OBLIGATORIAS ──")
    P("   (la app las siembra por IsActive + canal + ruta; no mira fechas de vigencia)")
    if not (ma["clone"] or ma["reactivate"] or ma["already_equivalent"] or ma["lost_by_moved"]
            or (ma["gained_by_moved"] and ma["pdvs_moved"])):
        P("   Ninguna actividad por canal involucrada: el cambio de canal no altera nada.")
    if ma["clone"]:
        P(f"   SE CLONAN al canal '{ch22_name}' para que los {ma['pdvs_moved']} PDVs movidos las CONSERVEN: {len(ma['clone'])}")
        for a in ma["clone"]:
            extra = "".join([f" · ruta {a['RouteId']}" if a["RouteId"] else "", f" · form {a['FormId']}" if a["FormId"] else "",
                             f" · vigencia {a['ValidFrom'] or '…'}→{a['ValidTo'] or '…'}" if a["ValidFrom"] or a["ValidTo"] else ""])
            P(f"   + '{a['Name']}' [{a['ActionType']}] ← id {a['source_id']} de {chn(a['source_channel'])}, "
              f"{a['pdvs_movidos']} PDVs movidos{extra}")
    if ma["reactivate"]:
        P("   SE REACTIVAN (ya existía una equivalente INACTIVA en el canal de cadenas — revisar que no la hayan apagado a propósito):")
        for a in ma["reactivate"]:
            P(f"   ~ id {a['MandatoryActivityId']} '{a['Name']}' [{a['ActionType']}] (equivale a id {a['source_id']} de {chn(a['source_channel'])})")
    if ma["already_equivalent"]:
        P("   Ya cubiertas (hay una equivalente activa en el canal de cadenas): "
          + ", ".join(f"'{a['Name']}' (id {a['source_id']})" for a in ma["already_equivalent"]))
    if ma["clone"] or ma["reactivate"]:
        P(f"   ⚠ EFECTO COLATERAL: los {ma['pdvs_already_in_chain_channel']} PDVs activos que YA estaban en '{ch22_name}' "
          "también EMPIEZAN a recibir\n     esas actividades en su próxima visita (la plantilla solo se acota por canal/ruta, "
          "no por PDV ni por cadena).")
        if len({a["source_channel"] for a in ma["clone"] + ma["reactivate"]}) > 1:
            P("   ⚠ Hay más de un canal de origen: los PDVs movidos desde uno reciben también las clonadas del otro.")
    if ma["gained_by_moved"] and ma["pdvs_moved"]:
        P(f"   Actividades que '{ch22_name}' YA tenía y los {ma['pdvs_moved']} PDVs movidos EMPIEZAN a recibir: {len(ma['gained_by_moved'])}")
        for a in ma["gained_by_moved"]:
            P(f"   → id {a['MandatoryActivityId']} '{a['Name']}' [{a['ActionType']}]" + (f" · solo ruta {a['RouteId']}" if a["RouteId"] else ""))
    if ma["lost_by_moved"]:
        P("   ⚠ --no-clone-mandatory-activities: los PDVs movidos DEJAN de recibir:")
        for a in ma["lost_by_moved"]:
            P(f"   ✗ id {a['source_id']} '{a['Name']}' [{a['ActionType']}] de {chn(a['source_channel'])} — {a['pdvs_movidos']} PDVs")
    if ma["clone"] or ma["reactivate"]:
        P("   Nota: un pendiente (BACKLOG) que un PDV movido arrastre de la plantilla original puede aparecer una vez\n"
          "     junto al de la plantilla clonada en su primera visita posterior (son plantillas distintas).")

    if not has_changes(plan):
        P("\n✔ Nada para hacer: la base ya está migrada (idempotente).")


def has_changes(plan: dict) -> bool:
    return any(plan[k] for k in ("chains_create", "chains_update", "subs_create", "subs_activate",
                                 "pdv_changes", "subs_deactivate")) or bool(
        plan["mandatory"]["clone"] or plan["mandatory"]["reactivate"])


def apply_plan(db, state: dict, plan: dict, backup_path: Path) -> dict:
    from app.models import PDV, SubChannel
    from app.models.audit import AuditEvent
    from app.models.chain import Chain

    ch22 = state["ids"]["chain_channel"]
    if ops.set_lock_timeout(db):
        print(f"SET LOCK_TIMEOUT {ops.LOCK_TIMEOUT_MS} ms")
    backup = {
        "script": AUDIT_SOURCE, "created": datetime.now(timezone.utc).isoformat(),
        "ids": state["ids"],
        "pdvs": [{"PdvId": c["PdvId"], **c["before"]} for c in plan["pdv_changes"]],
        "chains_updated": [{"ChainId": c["ChainId"], "before": c["before"]} for c in plan["chains_update"]],
        "subchannels_deactivated": [s["SubChannelId"] for s in plan["subs_deactivate"]],
        "subchannels_activated": [s["SubChannelId"] for s in plan["subs_activate"]],
        "chains_created": [], "subchannels_created": [],  # se completan al final (ids nuevos)
        "mandatory_created": [], "mandatory_reactivated": [a["MandatoryActivityId"] for a in plan["mandatory"]["reactivate"]],
        "pdvs_after": {},  # PdvId → {ChainId, SubChannelId} que dejó la migración (el rollback detecta ediciones posteriores)
    }
    with open(backup_path, "x") as fh:  # "x": jamás pisa un backup anterior
        fh.write(json.dumps(backup, ensure_ascii=False, indent=1))
    print(f"Backup previo: {backup_path}")

    def audit(entity, entity_id, action, payload):
        db.add(AuditEvent(UserId=None, Entity=entity, EntityId=str(int(entity_id)), Action=action,
                          PayloadJson=json.dumps({**payload, "source": AUDIT_SOURCE}, default=str, ensure_ascii=False)))

    chain_id: dict[tuple[int, str], int] = {(c["ChannelId"], norm(c["Name"])): c["ChainId"] for c in state["chains"]}
    for c in plan["chains_create"]:
        row = Chain(Name=c["Name"], ChannelId=c["ChannelId"], Kind=c["Kind"], IsKeyAccount=c["IsKeyAccount"],
                    AccountManagerUserId=c["AccountManagerUserId"], StoreCount=c["StoreCount"],
                    Aliases=c["Aliases"], IsActive=True)
        db.add(row)
        db.flush()
        chain_id[(c["ChannelId"], norm(c["Name"]))] = row.ChainId
        backup["chains_created"].append(row.ChainId)
        audit("Chain", row.ChainId, "CHAIN_CREATE", {"after": {k: c[k] for k in (
            "Name", "ChannelId", "Kind", "IsKeyAccount", "AccountManagerUserId", "StoreCount", "Aliases")}})
    for c in plan["chains_update"]:
        row = db.query(Chain).filter(Chain.ChainId == c["ChainId"]).one()
        for k, v in c["after"].items():
            setattr(row, k, v)
        audit("Chain", c["ChainId"], "CHAIN_UPDATE", {"before": c["before"], "after": c["after"]})

    bucket_sub = {}
    for s in plan["subs_create"]:
        row = SubChannel(ChannelId=s["ChannelId"], Name=s["Name"], IsActive=True,
                         Description="Tamaño de la cadena (se asigna solo según la cantidad de locales)")
        db.add(row)
        db.flush()
        bucket_sub[s["key"]] = row.SubChannelId
        backup["subchannels_created"].append(row.SubChannelId)
    for s in plan["subs_activate"]:
        db.query(SubChannel).filter(SubChannel.SubChannelId == s["SubChannelId"]).update({SubChannel.IsActive: True})

    # (vii) actividades obligatorias: clones en el canal de cadenas (ANTES de mover los PDVs)
    from datetime import date as _date

    from app.models.mandatory_activity import MandatoryActivity
    for a in plan["mandatory"]["clone"]:
        row = MandatoryActivity(
            Name=a["Name"], ActionType=a["ActionType"], Description=a["Description"], DetailsJson=a["DetailsJson"],
            PhotoRequired=a["PhotoRequired"], ChannelId=a["ChannelId"], RouteId=a["RouteId"], FormId=a["FormId"],
            ValidFrom=_date.fromisoformat(a["ValidFrom"]) if a["ValidFrom"] else None,
            ValidTo=_date.fromisoformat(a["ValidTo"]) if a["ValidTo"] else None,
            CreatedByUserId=a["CreatedByUserId"], IsActive=True)
        db.add(row)
        db.flush()
        backup["mandatory_created"].append(row.MandatoryActivityId)
        audit("MandatoryActivity", row.MandatoryActivityId, "MA_CLONE", {
            "clonedFrom": a["source_id"], "fromChannelId": a["source_channel"], "toChannelId": a["ChannelId"],
            "Name": a["Name"], "ActionType": a["ActionType"]})
    for a in plan["mandatory"]["reactivate"]:
        db.query(MandatoryActivity).filter(MandatoryActivity.MandatoryActivityId == a["MandatoryActivityId"]).update(
            {MandatoryActivity.IsActive: True})
        audit("MandatoryActivity", a["MandatoryActivityId"], "MA_REACTIVATE", {"equivalentTo": a["source_id"]})

    # PDVs: set-based. Un UPDATE por grupo (canal, subcanal, cadena) en tandas de
    # PDV_BATCH ids, en vez de ~900 viajes fila por fila. La auditoría sigue siendo
    # una fila por PDV (bulk insert).
    groups: dict[tuple, list[dict]] = defaultdict(list)
    audit_rows = []
    for c in plan["pdv_changes"]:
        after = dict(c["after"])
        if after["ChainId"] is None:
            after["ChainId"] = chain_id[(ch22, norm(c["chain"]))]
        if after["SubChannelId"] is None:
            after["SubChannelId"] = bucket_sub[c["bucket"]]
        groups[(after["ChannelId"], after["Channel"], after["SubChannelId"], after["ChainId"])].append(c)
        backup["pdvs_after"][str(c["PdvId"])] = {"ChainId": after["ChainId"], "SubChannelId": after["SubChannelId"]}
        audit_rows.append({
            "UserId": None, "Entity": "PDV", "EntityId": str(int(c["PdvId"])), "Action": "PDV_CHAIN_CHANGE",
            "PayloadJson": json.dumps({"before": c["before"], "after": {**after, "ChainName": c["chain"]},
                                       "origin": c["origin"], "source": AUDIT_SOURCE}, default=str, ensure_ascii=False)})
    touched = 0
    for (channel_id_, channel_txt, sub_id, ch_id), items in groups.items():
        ids_ = [c["PdvId"] for c in items]
        for k in range(0, len(ids_), PDV_BATCH):
            chunk = ids_[k:k + PDV_BATCH]
            # ChainId IS NULL: el plan solo asigna PDVs sin cadena. Si alguien le puso una
            # entre el armado del plan y este UPDATE, la cuenta no cierra y se revierte todo.
            n = (db.query(PDV).filter(PDV.PdvId.in_(chunk), PDV.ChainId.is_(None))
                 .update({PDV.ChannelId: channel_id_, PDV.Channel: channel_txt,
                          PDV.SubChannelId: sub_id, PDV.ChainId: ch_id}, synchronize_session=False))
            if n != len(chunk):
                raise PlanError(f"La base cambió durante la migración: se esperaban {len(chunk)} PDVs sin cadena "
                                f"en el grupo cadena {ch_id} y se actualizaron {n}. Se revierte todo; "
                                "volver a correr el dry-run.")
            touched += n
    if audit_rows:
        db.bulk_insert_mappings(AuditEvent, audit_rows)
    print(f"PDVs actualizados: {touched} en {len(groups)} grupos (cadena/subcanal)")

    db.flush()
    for s in plan["subs_deactivate"]:
        # re-chequeo contra la base real, dentro de la transacción
        left = db.query(PDV.PdvId).filter(PDV.SubChannelId == s["SubChannelId"]).count()
        if left:
            print(f"   (subcanal {s['Name']} sigue con {left} PDVs: no se desactiva)")
            backup["subchannels_deactivated"].remove(s["SubChannelId"])
            continue
        db.query(SubChannel).filter(SubChannel.SubChannelId == s["SubChannelId"]).update({SubChannel.IsActive: False})

    backup_path.write_text(json.dumps(backup, ensure_ascii=False, indent=1))
    db.commit()
    return backup


def verify(db, state_ids: dict) -> None:
    """Chequeos post-commit: reglas de app/services/chains.py sobre la base real."""
    from app.models import PDV, SubChannel
    from app.models.chain import Chain

    bad_channel = (db.query(PDV.PdvId).join(Chain, Chain.ChainId == PDV.ChainId)
                   .filter(PDV.ChannelId != Chain.ChannelId).count())
    bad_sub = (db.query(PDV.PdvId).join(SubChannel, SubChannel.SubChannelId == PDV.SubChannelId)
               .filter(PDV.ChainId.isnot(None), SubChannel.ChannelId != PDV.ChannelId).count())
    linked = db.query(PDV.PdvId).filter(PDV.ChainId.isnot(None)).count()
    print(f"\nVerificación: {linked} PDVs con cadena · canal≠canal de la cadena: {bad_channel} · "
          f"subcanal de otro canal: {bad_sub}")
    if bad_channel or bad_sub:
        print("⚠ HAY INCONSISTENCIAS — revisar (rollback disponible con el backup)")


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--commit", action="store_true", help="Aplica los cambios (default: dry-run)")
    ap.add_argument("--dry-run", action="store_true", help="No escribe nada (default)")
    ap.add_argument("--plan-json", help="Dry-run: escribe acá el plan. --commit: OBLIGATORIO, el plan del dry-run revisado")
    ap.add_argument("--no-clone-mandatory-activities", action="store_true",
                    help="NO clonar al canal de cadenas las actividades obligatorias del canal de origen "
                         "(los PDVs movidos las pierden). Usar el mismo flag en el dry-run y en el --commit")
    ap.add_argument("--yes", action="store_true", help="No pide la confirmación tipeada (uso no interactivo)")
    ap.add_argument("--skip-id-check", action="store_true", help="SOLO ensayo local: no exige los ids de prod")
    ap.add_argument("--import-log", default=str(IMPORT_LOG))
    ap.add_argument("--backup-dir", default=str(HERE))
    args = ap.parse_args(argv)
    if args.commit and args.dry_run:
        ap.error("--commit y --dry-run son excluyentes")
    if args.commit and not args.plan_json:
        ap.error("--commit exige --plan-json <archivo generado por el dry-run que revisaste>")
    return args


def commit_blockers(args, plan: dict, target: dict) -> list[str]:
    """Motivos por los que NO se puede aplicar (lista vacía = se puede)."""
    out = []
    path = Path(args.plan_json)
    if not path.exists():
        return [f"no existe {path}: corré primero el dry-run con --plan-json {path}"]
    try:
        reviewed = json.loads(path.read_text())
    except ValueError:
        return [f"{path} no es un JSON de plan válido"]
    if reviewed.get("plan_hash") != plan_fingerprint(plan, target):
        was = (reviewed.get("target") or {}).get("label", "?")
        out.append(f"el plan de hoy NO es el que se revisó en {path} (revisado sobre: {was}; ahora: {target['label']}). "
                   "La base cambió desde el dry-run, es otra base, o cambió --no-clone-mandatory-activities: "
                   "volver a correr el dry-run y revisar de nuevo")
    return out


def main(argv=None) -> int:
    args = parse_args(argv)
    target = ops.resolve_target_or_exit("COMMIT (escribe)" if args.commit else "DRY-RUN (no escribe nada)")

    from app.database import SessionLocal

    import_log = json.loads(Path(args.import_log).read_text())

    db = SessionLocal()
    try:
        state = load_state(db, args.skip_id_check)
        try:
            plan = build_plan(state, import_log, clone_mandatory=not args.no_clone_mandatory_activities)
        except PlanError as e:
            print(f"\nABORTO: {e}")
            return 3
        print_summary(state, plan)
        fingerprint = plan_fingerprint(plan, target)
        print(f"\nHuella del plan: {fingerprint[:16]}…")
        if not args.commit:
            if args.plan_json:
                Path(args.plan_json).write_text(json.dumps(
                    {"plan_hash": fingerprint, "target": target, **{k: v for k, v in plan.items() if k != "assign"}},
                    ensure_ascii=False, indent=1, default=str))
                print(f"Plan completo (para revisar y para el --commit): {args.plan_json}")
            print("\nDRY-RUN: no se escribió nada. Revisá el resumen y corré con --commit --plan-json <ese archivo>.")
            return 0
        if not has_changes(plan):
            print("\nNada para aplicar: no se escribe ni se genera backup.")
            return 0
        blockers = commit_blockers(args, plan, target)
        if blockers:
            print("\nABORTO (no se escribió nada):")
            for b in blockers:
                print(f"   - {b}")
            return 3
        ops.confirm_or_exit(target, args.yes, f"migrar {len(plan['pdv_changes'])} PDVs a cadenas")
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = Path(args.backup_dir) / f"backup_migrate_chains_{stamp}.json"
        try:
            backup = apply_plan(db, state, plan, backup_path)
        except Exception:
            db.rollback()
            print("ERROR: transacción revertida, la base quedó como estaba. "
                  f"(El archivo {backup_path} quedó escrito pero no corresponde a ningún cambio.)")
            raise
        print(f"\nCOMMIT OK · cadenas creadas {len(backup['chains_created'])} · PDVs {len(backup['pdvs'])} · "
              f"subcanales desactivados {len(backup['subchannels_deactivated'])} · actividades obligatorias clonadas "
              f"{len(backup['mandatory_created'])} / reactivadas {len(backup['mandatory_reactivated'])}")
        print(f"Rollback: python scripts/rollback_chains_20261119.py {backup_path} [--commit]")
        verify(db, state["ids"])
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
