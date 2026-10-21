#!/usr/bin/env python3
"""
Activación La Plata ("Lo de Pucho", 2026-10-19 → 2026-12-23): carga masiva vía API.

Lee el Excel "Puntos de venta por zona - La Plata" (hoja `Todos` + header de cada
hoja de zona con el activador) y deja TODO listo en la app de trade:

  1. Zona  `La Plata` (una sola; las "zonas" del Excel son rutas).
  2. Distribuidor `Lo de Pucho`.
  3. Usuarios activadores (rol vendedor, zona La Plata, VisitFlow=short, manager
     = --manager-email), uno por nombre de activador del Excel según --users.
  4. Formulario "Activación La Plata" (11 preguntas; cigarrillos Espert desde
     /products IsOwn+Cigarrillos; Van Kiff / Lebonn sí/no) — solo si no existe.
  5. Una ruta de CAMPAÑA por zona del Excel (+ "Fuera de ruta" para los 43 sin
     zona), EndDate = --end-date, asignada al activador, con el formulario.
  6. PDVs: Code `LP-<zona>-<nnn>`, dedup por Code; PATCH ZoneId después del POST
     (create_pdv re-zonifica por coordenadas → "AMBA"); alta en su ruta.

Idempotente / resumable: todo se busca por nombre/Code antes de crear. Sin
--commit es dry-run (solo lee). Log JSON de lo creado en --log.

Uso (desde backend/):
    python scripts/import_laplata_api.py "<xlsx>" --api http://localhost:8000 \
        --email admin@test.com --password 'Admin123!' \
        --users "CHRISTIAN=activadoru@espert.com.ar:Activador U,PABLO=activadord@espert.com.ar:Activador D" \
        --manager-email juampi@espert.com.ar --channel Quiosco [--commit]

Token alternativo: --token (sale del localStorage: JSON.parse(localStorage.getItem('espert.tokens')).accessToken).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import unicodedata
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import openpyxl

ZONE_NAME = "La Plata"
DISTRIBUTOR_NAME = "Lo de Pucho"
FORM_NAME = "Activación La Plata"
OUT_OF_ROUTE = "Fuera de ruta"
INITIAL_PASSWORD = "Espert2026!"
JUNK_NAMES = {"ESTE NOOOO"}


# ----------------------------------------------------------------- HTTP ---
class Api:
    def __init__(self, base: str, token: str, throttle_ms: int = 60):
        self.base = base.rstrip("/")
        self.token = token
        self.delay = throttle_ms / 1000.0

    def _req(self, method: str, path: str, body: dict | None = None, params: dict | None = None):
        url = f"{self.base}{path}"
        if params:
            url += "?" + urlencode(params)
        data = json.dumps(body).encode() if body is not None else None
        req = Request(url, data=data, method=method, headers={
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        })
        try:
            with urlopen(req, timeout=60) as resp:
                raw = resp.read().decode()
                return resp.status, (json.loads(raw) if raw else None)
        except HTTPError as e:
            txt = e.read().decode(errors="replace")
            try:
                return e.code, json.loads(txt)
            except Exception:
                return e.code, {"raw": txt}
        except URLError as e:
            return 0, {"network_error": str(e)}

    def get(self, path: str, params: dict | None = None):
        status, body = self._req("GET", path, params=params)
        if status != 200:
            raise RuntimeError(f"GET {path} → {status}: {body}")
        return body

    def post(self, path: str, body: dict, ok=(200, 201)):
        if self.delay:
            time.sleep(self.delay)
        status, resp = self._req("POST", path, body)
        if status not in ok:
            raise RuntimeError(f"POST {path} → {status}: {resp} | body={body}")
        return resp

    def patch(self, path: str, body: dict):
        status, resp = self._req("PATCH", path, body)
        if status != 200:
            raise RuntimeError(f"PATCH {path} → {status}: {resp}")
        return resp

    def put(self, path: str, body: dict):
        status, resp = self._req("PUT", path, body)
        if status != 200:
            raise RuntimeError(f"PUT {path} → {status}: {resp}")
        return resp


def login(api_base: str, email: str, password: str) -> str:
    req = Request(f"{api_base.rstrip('/')}/auth/login", data=json.dumps({"email": email, "password": password}).encode(),
                  method="POST", headers={"Content-Type": "application/json"})
    with urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())["access_token"]


# ---------------------------------------------------------------- Excel ---
def norm(s: str | None) -> str:
    s = unicodedata.normalize("NFKD", (s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().lower()


def zone_slug(zone_title: str) -> str:
    """'Zona 07 - Lateral Norte' → '07'; 'Fuera de ruta' → 'FR'."""
    m = re.match(r"Zona\s+(\d+)", zone_title)
    return f"{int(m.group(1)):02d}" if m else "FR"


def parse_excel(path: Path) -> tuple[dict[str, str], list[dict]]:
    """Devuelve (activador_por_zona, filas). Zona de cada fila = título del Excel
    o OUT_OF_ROUTE para 'Sin zona'."""
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    activators: dict[str, str] = {}
    for ws in wb.worksheets:
        if not ws.title.lower().startswith("zona"):
            continue
        hdr = next(ws.iter_rows(min_row=1, max_row=1, values_only=True))
        cells = [c for c in hdr if c]
        if len(cells) >= 2:
            activators[str(cells[0]).strip()] = str(cells[1]).strip().upper()

    ws = wb["Todos"]
    rows_iter = ws.iter_rows(min_row=4, values_only=True)
    header = [str(c).strip() if c else "" for c in next(rows_iter)]
    col = {name: i for i, name in enumerate(header)}
    need = ["Zona", "Punto de venta", "Dirección (mapa)", "Dirección original", "Localidad", "Lat", "Lng"]
    missing = [n for n in need if n not in col]
    if missing:
        raise SystemExit(f"Faltan columnas en hoja Todos: {missing}. Header: {header}")

    rows: list[dict] = []
    for r in rows_iter:
        name = (r[col["Punto de venta"]] or "").strip() if r[col["Punto de venta"]] else ""
        if not name or name.upper() in JUNK_NAMES:
            continue
        zone = (r[col["Zona"]] or "").strip()
        if not zone or zone.lower().startswith("sin zona"):
            zone = OUT_OF_ROUTE
        lat, lng = r[col["Lat"]], r[col["Lng"]]
        rows.append({
            "zone": zone,
            "name": name[:160],
            "address": ((r[col["Dirección original"]] or r[col["Dirección (mapa)"]] or "") or "").strip()[:200] or None,
            "address_map": (r[col["Dirección (mapa)"]] or "").strip()[:200] or None,
            "city": ((r[col["Localidad"]] or "") or "").strip()[:80] or None,
            "lat": float(lat) if lat is not None else None,
            "lon": float(lng) if lng is not None else None,
            "obs": ((r[col.get("Observación", -1)] if "Observación" in col else None) or None),
        })
    return activators, rows


# ------------------------------------------------------------ Formulario ---
def build_product_options(products: list[dict]) -> list[tuple[str, str]]:
    """Cigarrillos Espert, todas las versiones (el foco del relevo). Van Kiff y
    Lebonn van aparte como sí/no, sin variantes."""
    opts: list[tuple[str, str]] = []
    seen = set()
    for p in products:
        if not p.get("IsOwn") or not p.get("IsActive", True):
            continue
        if not norm(p.get("Category")).startswith("cigarr"):
            continue
        name = (p.get("Name") or "").strip()
        key = norm(name).replace(" ", "_")
        if key and key not in seen:
            seen.add(key)
            opts.append((key, name))
    return opts


def ensure_form(api: Api, products: list[dict], commit: bool, log: dict) -> int | None:
    forms = api.get("/forms", {"limit": 500})
    f = next((x for x in forms if norm(x["Name"]) == norm(FORM_NAME)), None)
    if f:
        existing_q = api.get(f"/forms/{f['FormId']}/questions")
        print(f"Formulario: existe '{f['Name']}' (FormId={f['FormId']}, {len(existing_q)} preguntas)")
        if existing_q:
            return f["FormId"]
        print("  → sin preguntas: se cargan ahora")
    product_opts = build_product_options(products)
    print(f"Formulario: a crear '{FORM_NAME}' con {len(product_opts)} productos Espert: "
          + ", ".join(l for _, l in product_opts))
    if not commit:
        return None
    if not f:
        f = api.post("/forms", {"Name": FORM_NAME, "Version": 1, "IsActive": True, "Frequency": "always"})
    fid = f["FormId"]
    log["form"] = {"FormId": fid, "Name": FORM_NAME}

    def q(order, key, label, qtype, required=False, rules=None, options=None):
        body = {"SortOrder": order, "KeyName": key, "Label": label, "QType": qtype, "IsRequired": required}
        if rules:
            body["RulesJson"] = json.dumps(rules)
        created = api.post(f"/forms/{fid}/questions", body)
        qid = created["QuestionId"]
        for i, (val, lab) in enumerate(options or [], 1):
            api.post(f"/forms/questions/{qid}/options", {"QuestionId": qid, "Value": val, "Label": lab, "SortOrder": i})
        return qid

    si_no = [("si", "Sí"), ("no", "No")]
    if_yes = lambda qid: {"showIf": {"questionId": qid, "operator": "equals", "value": "si"}}  # noqa: E731
    q1 = q(1, "tiene_espert", "¿Tiene productos Espert?", "radio", True, options=si_no)
    q(2, "cigarrillos_espert", "¿Qué cigarrillos Espert tiene?", "checkbox", rules=if_yes(q1), options=product_opts)
    q(3, "tiene_van_kiff", "¿Tiene Van Kiff (tabaco)?", "radio", rules=if_yes(q1), options=si_no)
    q(4, "tiene_lebonn", "¿Tiene Lebonn (tabaco)?", "radio", rules=if_yes(q1), options=si_no)
    q5 = q(5, "compro", "¿Le pudieron vender (compró a través de la distribuidora)?", "radio", True, options=si_no)
    q(6, "promo", "¿Qué promo compró?", "checkbox", rules=if_yes(q5),
      options=[("promo_bold", "Promo Bold"), ("promo_milenio", "Promo Milenio")])
    q(7, "precio_acordado", "Precio de venta acordado", "checkbox_price", rules=if_yes(q5),
      options=[("bold", "Bold"), ("milenio", "Milenio")])
    q(8, "foto_comunicacion", "Foto de la comunicación colocada", "photo")
    q(9, "encargado_nombre", "Nombre del encargado", "text")
    q(10, "encargado_horario", "Horario en que está el encargado", "text")
    q(11, "observacion", "Observación / qué se habló y acordó (ayuda memoria para la próxima visita)", "textarea")
    print(f"  → FormId={fid} creado con 11 preguntas")
    return fid


# ------------------------------------------------------------------ main ---
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx")
    ap.add_argument("--api", required=True)
    ap.add_argument("--token")
    ap.add_argument("--email")
    ap.add_argument("--password")
    ap.add_argument("--users", required=True,
                    help='ACTIVADOR=email:Nombre,... (ACTIVADOR = como figura en el header de las hojas de zona)')
    ap.add_argument("--manager-email", required=True, help="Supervisor (ManagerUserId de los activadores)")
    ap.add_argument("--channel", default="Quiosco", help="Canal para los PDVs (nombre exacto)")
    ap.add_argument("--subchannel", default=None, help="Subcanal del canal elegido (nombre exacto, opcional; ej. Kiosco)")
    ap.add_argument("--end-date", default="2026-12-23")
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--throttle-ms", type=int, default=40)
    ap.add_argument("--log", default=None)
    args = ap.parse_args()

    xlsx = Path(args.xlsx)
    if not xlsx.exists():
        print(f"No existe: {xlsx}")
        return 1
    token = args.token or (login(args.api, args.email, args.password) if args.email and args.password else None)
    if not token:
        print("Falta --token o --email/--password")
        return 1
    api = Api(args.api, token, args.throttle_ms)
    commit = args.commit
    log_path = Path(args.log or f"laplata_import_{date.today():%Y%m%d}.json")
    log: dict = {"started": datetime.now(timezone.utc).isoformat(), "api": api.base, "commit": commit,
                 "users": [], "routes": [], "pdvs": [], "errors": []}

    def save_log():
        log["updated"] = datetime.now(timezone.utc).isoformat()
        log_path.write_text(json.dumps(log, indent=2, ensure_ascii=False))

    # --- Excel
    activators_by_zone, rows = parse_excel(xlsx)
    zones_in_excel = sorted({r["zone"] for r in rows}, key=lambda z: (z == OUT_OF_ROUTE, z))
    print(f"Excel: {len(rows)} PDVs · {len(zones_in_excel)} rutas (incl. '{OUT_OF_ROUTE}')")
    users_arg: dict[str, tuple[str, str]] = {}
    for part in args.users.split(","):
        act, rest = part.split("=", 1)
        email, name = rest.split(":", 1)
        users_arg[act.strip().upper()] = (email.strip().lower(), name.strip())
    unknown = {a for a in activators_by_zone.values() if a not in users_arg}
    if unknown:
        print(f"Activadores del Excel sin usuario en --users: {unknown}")
        return 1

    # --- Catálogos
    channels = api.get("/channels")
    ch = next((c for c in channels if norm(c["Name"]) == norm(args.channel)), None)
    if not ch:
        print(f"No existe el canal '{args.channel}'. Canales: " + ", ".join(c["Name"] for c in channels))
        return 1
    roles = api.get("/roles")
    vendedor_role = next((r for r in roles if r["Name"].lower() == "vendedor"), None)
    if not vendedor_role:
        print("No existe el rol 'vendedor'")
        return 1
    users_all = api.get("/users", {"limit": 500})
    manager = next((u for u in users_all if u["Email"].lower() == args.manager_email.lower()), None)
    if not manager:
        print(f"No existe el usuario manager {args.manager_email}")
        return 1
    sub_id = None
    if args.subchannel:
        subs = api.get("/subchannels?limit=500")
        subs = subs.get("items", subs) if isinstance(subs, dict) else subs
        sub = next((x for x in subs if x["ChannelId"] == ch["ChannelId"] and norm(x["Name"]) == norm(args.subchannel)), None)
        if not sub:
            print(f"No existe el subcanal '{args.subchannel}' en {ch['Name']}. Subcanales: "
                  + ", ".join(x["Name"] for x in subs if x["ChannelId"] == ch["ChannelId"]))
            return 1
        sub_id = sub["SubChannelId"]
    print(f"Canal: {ch['Name']} ({ch['ChannelId']}) · Subcanal: {args.subchannel or '-'} ({sub_id}) · Manager: {manager['DisplayName']} ({manager['UserId']})")

    # --- 1. Zona
    zones = api.get("/zones")
    zone = next((z for z in zones if norm(z["Name"]) == norm(ZONE_NAME)), None)
    if zone:
        print(f"Zona: existe '{zone['Name']}' (ZoneId={zone['ZoneId']})")
    else:
        print(f"Zona: a crear '{ZONE_NAME}'")
        if commit:
            zone = api.post("/zones", {"Name": ZONE_NAME})
            log["zone"] = zone
    zone_id = zone["ZoneId"] if zone else None

    # --- 2. Distribuidor
    dists = api.get("/distributors", {"limit": 500})
    dist = next((d for d in dists if norm(d["Name"]) == norm(DISTRIBUTOR_NAME)), None)
    if dist:
        print(f"Distribuidor: existe '{dist['Name']}' (DistributorId={dist['DistributorId']})")
    else:
        print(f"Distribuidor: a crear '{DISTRIBUTOR_NAME}'")
        if commit:
            dist = api.post("/distributors", {"Name": DISTRIBUTOR_NAME, "DistributorType": "Distribuidor"})
            log["distributor"] = dist
    dist_id = dist["DistributorId"] if dist else None

    # --- 3. Usuarios activadores
    user_id_by_act: dict[str, int | None] = {}
    for act, (email, name) in users_arg.items():
        u = next((x for x in users_all if x["Email"].lower() == email), None)
        if u:
            print(f"Usuario {act}: existe {email} (UserId={u['UserId']}, VisitFlow={u.get('VisitFlow')})")
            if commit:
                patch = {}
                if u.get("VisitFlow") != "short":
                    patch["VisitFlow"] = "short"
                if zone_id and u.get("ZoneId") != zone_id:
                    patch["ZoneId"] = zone_id
                if patch:
                    api.patch(f"/users/{u['UserId']}", patch)
                    print(f"  → PATCH {patch}")
        else:
            print(f"Usuario {act}: a crear {email} '{name}' (vendedor, short, pass inicial, manager {manager['Email']})")
            if commit:
                u = api.post("/users", {
                    "Email": email, "DisplayName": name, "ZoneId": zone_id, "ManagerUserId": manager["UserId"],
                    "Password": INITIAL_PASSWORD, "RoleName": "vendedor", "MustChangePassword": True,
                    "VisitFlow": "short", "IsActive": True,
                })
                api.put(f"/users/{u['UserId']}/role", {"roleId": vendedor_role["RoleId"]})
                log["users"].append({"UserId": u["UserId"], "Email": email, "activador": act})
        user_id_by_act[act] = u["UserId"] if u else None

    # --- 4. Formulario
    products = api.get("/products", {"active_only": True, "limit": 1000})
    form_id = ensure_form(api, products, commit, log)

    # --- 5. Rutas de campaña
    routes = api.get("/routes", {"limit": 500})
    route_id_by_zone: dict[str, int | None] = {}
    for z in zones_in_excel:
        act = activators_by_zone.get(z)
        assigned = user_id_by_act.get(act) if act else None
        r = next((x for x in routes if norm(x["Name"]) == norm(z)), None)
        n = sum(1 for row in rows if row["zone"] == z)
        if r:
            print(f"Ruta: existe '{z}' (RouteId={r['RouteId']}, {r.get('PdvCount')} PDVs) · {n} en Excel")
        else:
            print(f"Ruta: a crear '{z}' campaña hasta {args.end_date} → {act or 'sin asignar'} · {n} PDVs")
            if commit:
                r = api.post("/routes", {
                    "Name": z, "ZoneId": zone_id, "RouteType": "campaign", "EndDate": args.end_date,
                    "AssignedUserId": assigned, "IsFocus": False, "IsActive": True,
                })
                log["routes"].append({"RouteId": r["RouteId"], "Name": z, "AssignedUserId": assigned})
        if r and commit and form_id:
            linked = api.get(f"/routes/{r['RouteId']}/forms")
            if not any(x["FormId"] == form_id for x in linked):
                api.post(f"/routes/{r['RouteId']}/forms", {"FormId": form_id, "SortOrder": 0})
        route_id_by_zone[z] = r["RouteId"] if r else None
    save_log()

    # --- 6. PDVs
    existing_by_code: dict[str, dict] = {}
    if zone_id:
        skip = 0
        while True:
            resp = api.get("/pdvs", {"zone_id": zone_id, "skip": skip, "limit": 500})
            page = resp["items"] if isinstance(resp, dict) else resp
            for p in page:
                if p.get("Code"):
                    existing_by_code[p["Code"]] = p
            if len(page) < 500:
                break
            skip += 500
    # también los que hayan quedado en otra zona por la re-zonificación (busca por Code en todas)
    print(f"PDVs existentes en zona {ZONE_NAME}: {len(existing_by_code)}")

    counters = {z: 0 for z in zones_in_excel}
    to_create = 0
    members_cache: dict[int, set[int]] = {}
    for row in rows:
        z = row["zone"]
        counters[z] += 1
        code = f"LP-{zone_slug(z)}-{counters[z]:03d}"
        row["code"] = code
        row["order"] = counters[z]
        if code in existing_by_code:
            continue
        to_create += 1
    print(f"PDVs a crear: {to_create} · ya existentes: {len(rows) - to_create}")
    if not commit:
        print("\n[DRY-RUN] Nada creado. Agregá --commit para ejecutar.")
        return 0

    created = 0
    for i, row in enumerate(rows, 1):
        code = row["code"]
        rid = route_id_by_zone.get(row["zone"])
        try:
            p = existing_by_code.get(code)
            if not p:
                p = api.post("/pdvs", {
                    "Code": code, "Name": row["name"], "ChannelId": ch["ChannelId"], "SubChannelId": sub_id,
                    "Address": row["address"], "City": row["city"], "ZoneId": zone_id,
                    "DistributorId": dist_id, "Lat": row["lat"], "Lon": row["lon"], "IsActive": True,
                })
                created += 1
                log["pdvs"].append({"PdvId": p["PdvId"], "Code": code, "Name": row["name"]})
            if p.get("ZoneId") != zone_id:
                api.patch(f"/pdvs/{p['PdvId']}", {"ZoneId": zone_id})
                p["ZoneId"] = zone_id
            if rid:
                if rid not in members_cache:
                    members_cache[rid] = {m["PdvId"] for m in api.get(f"/routes/{rid}/pdvs")}
                if p["PdvId"] not in members_cache[rid]:
                    api.post(f"/routes/{rid}/pdvs", {"PdvId": p["PdvId"], "SortOrder": row["order"], "Priority": 3})
                    members_cache[rid].add(p["PdvId"])
        except Exception as e:  # noqa: BLE001
            log["errors"].append({"code": code, "name": row["name"], "error": str(e)[:500]})
            print(f"  ERR {code} {row['name']}: {str(e)[:200]}")
        if i % 50 == 0:
            save_log()
            print(f"  [{i}/{len(rows)}] creados {created} · errores {len(log['errors'])}")
    save_log()
    print(f"\nListo: {created} PDVs creados, {len(log['errors'])} errores. Log: {log_path}")
    return 0 if not log["errors"] else 2


if __name__ == "__main__":
    sys.exit(main())
