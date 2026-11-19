"""Excel de revisión 2026-11-19: PDVs que PARECEN de cadena y todavía no están vinculados.

SOLO LECTURA: no escribe nada en la base. Genera un Excel para que Santiago
(key accounts) confirme a qué cadena pertenece cada PDV. Correr DESPUÉS de
scripts/migrate_chains_20261119.py --commit (necesita las cadenas creadas).

Candidatos (PDVs ACTIVOS con ChainId NULL):
  a. Nombre o razón social nombra una cadena existente (nombre o alias) o matchea
     los regex del import de cadenas → CadenaSugerida + Confianza alta/media.
  b. Nombre o razón social dice "cadena" sin que se reconozca cuál → Confianza baja.
  c. Están en el canal de cadenas sin cadena (subcanal vacío / genérico, o altas
     hechas con la app vieja después de la migración).
Hoja aparte "Banderas": estaciones de servicio sin bandera cuyo nombre la nombra.

Santiago completa "Confirmar (S/N)" y, si la sugerencia está mal, "CadenaCorrecta".
La carga posterior se hace desde Gestión PDV (editar → Cadena) o con un script de
aplicación a partir de este mismo Excel.

Conexión = app.database (env-driven, igual que la migración).
Uso (desde backend/): python scripts/review_chain_candidates_20261119.py [--out revision_cadenas_20261119.xlsx]
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

from migrate_chains_20261119 import (  # noqa: E402
    CHAIN_CHANNEL, KEY_ACCOUNT_CHAINS, STATION_CHANNEL, norm, norm_spaces,
)

COLUMNS = [
    "PdvId", "Codigo", "Nombre", "RazonSocial", "Canal", "SubCanal", "Zona", "Direccion", "Ciudad",
    "TradeAsignado", "Motivo", "CadenaSugerida", "Confianza", "Confirmar (S/N)", "CadenaCorrecta",
]
CADENA_WORD = re.compile(r"\bcadenas?\b")


def name_regex(name: str) -> re.Pattern | None:
    """Regex de palabra completa para un nombre/alias de cadena, tolerante a signos:
    "Tommy's shop" matchea "tommys shop" y "tommy s shop"; "24/7" matchea "24 7"."""
    tokens = re.findall(r"[a-z0-9]+", norm_spaces(name).replace("'", ""))
    if not tokens:
        return None
    return re.compile(r"(?<![a-z0-9])" + r"[^a-z0-9]*".join(map(re.escape, tokens)) + r"(?![a-z0-9])")


def build_matchers(chains: list[dict]) -> list[tuple[re.Pattern, str, str]]:
    """[(regex, cadena, confianza)] — nombres largos primero (el más específico gana)."""
    out = []
    for c in chains:
        for label in [c["Name"]] + [a for a in str(c["Aliases"] or "").split(",") if a.strip()]:
            rx = name_regex(label)
            if rx is None:
                continue
            # nombres muy cortos o puramente numéricos ("365", "24/7", "YES") dan falsos positivos
            key = norm(label)
            weak = len(key) < 5 or key.isdigit()
            out.append((rx, c["Name"], "media" if weak else "alta", len(key)))
    out.sort(key=lambda t: -t[3])
    return [(rx, name, conf) for rx, name, conf, _ in out]


def suggest(text: str, matchers, import_patterns) -> tuple[str | None, str | None, str]:
    """→ (cadena sugerida, confianza, motivo) para un nombre/razón social."""
    n = norm_spaces(text).replace("'", "")
    for rx, name, conf in matchers:
        if rx.search(n):
            return name, conf, "nombra la cadena"
    hits = [name for name, pat in import_patterns if re.search(pat, n)]
    if len(hits) == 1:
        return hits[0], "media", "regex del import de cadenas"
    if CADENA_WORD.search(n):
        return None, "baja", 'dice "cadena"'
    return None, None, ""


CONFLICT_COLUMNS = ["PdvId", "Codigo", "Nombre", "Origen", "SubcanalQueTenia", "CadenaPorSubcanal",
                    "CadenaPorNombre", "QuedoEn", "Criterio", "Confirmar (S/N)", "CadenaCorrecta"]


def conflict_rows(conflicts: list[dict]) -> list[list]:
    """Filas de la hoja Conflictos a partir de plan["conflicts"] de la migración."""
    return [[c.get("PdvId"), c.get("Code"), c.get("Name"), c.get("origen"), c.get("subcanal_actual"),
             c.get("por_subcanal"), c.get("por_import"), c.get("gana"), c.get("criterio"), None, None]
            for c in sorted(conflicts, key=lambda c: (norm(c.get("gana")), c.get("PdvId") or 0))]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default=str(HERE / "revision_cadenas_20261119.xlsx"))
    ap.add_argument("--plan-json", help="Plan del dry-run de la migración: agrega la hoja 'Conflictos' "
                                        "(PDVs donde el subcanal y el nombre apuntaban a cadenas distintas)")
    args = ap.parse_args()
    conflicts = []
    if args.plan_json:
        import json
        conflicts = json.loads(Path(args.plan_json).read_text()).get("conflicts", [])

    import openpyxl
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter

    from sqlalchemy import func

    from app.database import SessionLocal, engine
    from app.models import PDV, Channel, SubChannel, User, Zone
    from app.models.chain import Chain

    print(f"Base: {engine.url.render_as_string(hide_password=True)}  (solo lectura)")
    db = SessionLocal()
    try:
        channels = {c.ChannelId: c.Name for c in db.query(Channel).all()}
        subs = {s.SubChannelId: s.Name for s in db.query(SubChannel).all()}
        zones = {z.ZoneId: z.Name for z in db.query(Zone).all()}
        users = dict(db.query(User.UserId, User.DisplayName).all())
        chain_ch = next((i for i, n in channels.items() if norm(n) == norm(CHAIN_CHANNEL)), None)
        station_ch = next((i for i, n in channels.items() if norm(n) == norm(STATION_CHANNEL)), None)
        all_chains = [{"ChainId": c.ChainId, "Name": c.Name, "Aliases": c.Aliases, "Kind": c.Kind,
                       "ChannelId": c.ChannelId, "IsKeyAccount": bool(c.IsKeyAccount), "StoreCount": c.StoreCount}
                      for c in db.query(Chain).filter(Chain.IsActive == True).all()]  # noqa: E712
        cadenas = [c for c in all_chains if c["Kind"] == "cadena"]
        banderas = [c for c in all_chains if c["Kind"] == "bandera"]
        if not cadenas:
            print("⚠ No hay cadenas cargadas: ¿corriste migrate_chains_20261119.py --commit? "
                  "Se usan solo los regex del import y la palabra 'cadena'.")
        m_cad, m_ban = build_matchers(cadenas), build_matchers(banderas)
        known = {norm(c["Name"]) for c in cadenas}
        import_patterns = [(name, pat) for name, _n, pat, _a in KEY_ACCOUNT_CHAINS if not known or norm(name) in known]

        pdvs = (db.query(PDV).filter(PDV.IsActive == True, PDV.ChainId.is_(None))  # noqa: E712
                .order_by(PDV.Name, PDV.PdvId).all())
        linked = dict(db.query(PDV.ChainId, func.count(PDV.PdvId))
                      .filter(PDV.ChainId.isnot(None), PDV.IsActive == True).group_by(PDV.ChainId).all())  # noqa: E712

        def row(p, motivo, sug, conf):
            return [p.PdvId, p.Code, p.Name, p.BusinessName, channels.get(p.ChannelId) or p.Channel,
                    subs.get(p.SubChannelId), zones.get(p.ZoneId), p.Address, p.City,
                    users.get(p.AssignedUserId), motivo, sug, conf, None, None]

        cand, band = [], []
        for p in pdvs:
            if p.ChannelId == station_ch and station_ch is not None:
                for text in (p.Name, p.BusinessName):
                    sug, conf, _m = suggest(text or "", m_ban, [])
                    if sug:
                        band.append(row(p, "nombra la bandera", sug, conf))
                        break
                continue
            best = (None, None, "")
            for text in (p.Name, p.BusinessName):
                s = suggest(text or "", m_cad, import_patterns)
                if s[0] or (s[1] and not best[1]):
                    best = s
                if s[0]:
                    break
            sug, conf, motivo = best
            in_chain_channel = chain_ch is not None and p.ChannelId == chain_ch
            if in_chain_channel:
                motivo = (motivo + " + " if motivo else "") + "está en el canal de cadenas sin cadena"
                conf = conf or "baja"
            if motivo:
                cand.append(row(p, motivo, sug, conf))
        order = {"alta": 0, "media": 1, "baja": 2}
        cand.sort(key=lambda r: (order.get(r[12], 3), norm(r[11]), norm(r[2])))
        band.sort(key=lambda r: (norm(r[11]), norm(r[2])))
    finally:
        db.close()

    wb = openpyxl.Workbook()
    head_fill, edit_fill = PatternFill("solid", fgColor="1F2937"), PatternFill("solid", fgColor="FEF3C7")

    def sheet(ws, title, columns, rows, editable=()):
        ws.title = title
        ws.append(columns)
        for c in ws[1]:
            c.font, c.fill = Font(bold=True, color="FFFFFF"), head_fill
        for r in rows:
            ws.append(r)
        for i, col in enumerate(columns, 1):
            width = max([len(str(col))] + [len(str(r[i - 1])) for r in rows[:500] if r[i - 1] is not None])
            ws.column_dimensions[get_column_letter(i)].width = min(max(width + 2, 10), 48)
            if col in editable:
                for cell in ws[get_column_letter(i)][1:]:
                    cell.fill = edit_fill
        ws.freeze_panes = "D2"
        ws.auto_filter.ref = ws.dimensions

    sheet(wb.active, "Candidatos", COLUMNS, cand, editable=("Confirmar (S/N)", "CadenaCorrecta"))
    ban_cols = [c if c != "CadenaSugerida" else "BanderaSugerida" for c in COLUMNS]
    ban_cols[-1] = "BanderaCorrecta"
    sheet(wb.create_sheet(), "Banderas", ban_cols, band, editable=("Confirmar (S/N)", "BanderaCorrecta"))
    sheet(wb.create_sheet(), "Cadenas", ["Cadena", "Tipo", "KeyAccount", "LocalesReales", "PDVsVinculados", "Alias"],
          [[c["Name"], c["Kind"], "Sí" if c["IsKeyAccount"] else "No", c["StoreCount"], linked.get(c["ChainId"], 0),
            c["Aliases"]] for c in sorted(all_chains, key=lambda c: (c["Kind"], norm(c["Name"])))])
    sheet(wb.create_sheet(), "Conflictos", CONFLICT_COLUMNS, conflict_rows(conflicts),
          editable=("Confirmar (S/N)", "CadenaCorrecta"))
    ws = wb.create_sheet("LEEME")
    for line in [
        "Revisión de PDVs que parecen de cadena y no están vinculados.",
        "Hoja Candidatos: completar 'Confirmar (S/N)'. Si la cadena sugerida está mal o vacía, escribir la correcta "
        "en 'CadenaCorrecta' usando EXACTAMENTE un nombre de la hoja Cadenas (o uno nuevo si la cadena no existe).",
        "Confianza: alta = el nombre del PDV nombra la cadena; media = nombre corto/numérico o regex; "
        "baja = solo dice 'cadena' o está en el canal de cadenas sin cadena.",
        "Hoja Banderas: lo mismo para estaciones de servicio.",
        "Hoja Conflictos: PDVs que ya existían antes del import donde el subcanal cargado en campo y el nombre "
        "apuntaban a cadenas distintas. La migración los dejó en 'QuedoEn' (en los reusados gana el subcanal). "
        "Confirmar o corregir. Vacía si no se pasó --plan-json o no hubo conflictos.",
        "Este archivo no cambia nada en la app: es solo para revisar.",
    ]:
        ws.append([line])
    ws.column_dimensions["A"].width = 140
    wb.save(args.out)

    print(f"PDVs activos sin cadena analizados: {len(pdvs)}")
    print(f"Candidatos a cadena: {len(cand)}  → por confianza: {dict(Counter(r[12] for r in cand))}")
    print("   por cadena sugerida: " + ", ".join(f"{k or '(sin sugerencia)'}={v}"
                                                 for k, v in Counter(r[11] for r in cand).most_common(25)))
    print(f"Estaciones con bandera sugerida: {len(band)}  → {dict(Counter(r[11] for r in band))}")
    print(f"Conflictos subcanal vs nombre (hoja Conflictos): {len(conflicts)}"
          + ("" if args.plan_json else "  (sin --plan-json: hoja vacía)"))
    print(f"Excel: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
