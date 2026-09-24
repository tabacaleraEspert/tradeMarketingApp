"""HTML del mail del reporte de comportamiento.

Tablas + estilos inline (Outlook / Gmail / clientes móviles no respetan <style>
ni flex/grid). Sin motor de templates: f-strings + `html.escape`.
"""
from __future__ import annotations

from datetime import date
from html import escape

_INK = "#111111"      # negro de la app
_GOLD = "#A48242"     # espert-gold
_MUTED = "#6b7280"
_BORDER = "#e5e7eb"
_SEV_COLOR = {"alta": "#b91c1c", "media": "#b45309", "baja": "#6b7280"}


def _fmt_pct(v) -> str:
    return "—" if v is None else f"{v}%"


def _fmt_num(v) -> str:
    if v is None:
        return "—"
    if isinstance(v, float):
        return f"{v:,.1f}".replace(",", "X").replace(".", ",").replace("X", ".").removesuffix(",0")
    return f"{v:,}".replace(",", ".")


def tiles(kpis: dict) -> list[tuple[str, str, bool]]:
    """(label, valor, destacar) de los 6 tiles del mail."""
    return [
        ("Trades con actividad", _fmt_num(kpis["trades"]), False),
        ("Visitas", _fmt_num(kpis["visitas"]), False),
        ("PDVs por día", _fmt_num(kpis["pdvsPorDia"]), False),
        ("Cumplimiento plan", _fmt_pct(kpis["planPct"]), (kpis["planPct"] or 100) < 80),
        ("Visitas con GPS", _fmt_pct(kpis["gpsPct"]), (kpis["gpsPct"] or 100) < 90),
        ("Alertas graves", _fmt_num(kpis["alertasAlta"]), kpis["alertasAlta"] > 0),
    ]


def subject_for(payload: dict, test: bool) -> str:
    tipo = "semanal" if payload["kind"] == "weekly" else "mensual"
    prueba = " de prueba" if test else ""
    return f"Resumen {tipo}{prueba} de comportamiento de trades — {payload['periodLabel']}"


def render_mail(payload: dict, url: str, expires: date, test: bool) -> tuple[str, str, str]:
    """Devuelve (asunto, html, texto plano)."""
    subject = subject_for(payload, test)
    kpis = payload["kpis"]
    anomalias = payload["anomalias"]
    expira = expires.strftime("%d/%m/%Y")
    periodo = escape(payload["periodLabel"])
    titulo = ("Resumen semanal" if payload["kind"] == "weekly" else "Resumen mensual") + (" (prueba)" if test else "")

    cells = []
    for label, value, warn in tiles(kpis):
        color = "#b91c1c" if warn else _INK
        cells.append(
            f'<td width="33%" style="padding:6px;">'
            f'<div style="border:1px solid {_BORDER};border-radius:10px;padding:12px 10px;background:#ffffff;">'
            f'<div style="font-size:11px;color:{_MUTED};text-transform:uppercase;letter-spacing:.04em;">{escape(label)}</div>'
            f'<div style="font-size:24px;font-weight:700;color:{color};margin-top:4px;">{escape(value)}</div>'
            f"</div></td>"
        )
    tiles_html = "".join(f"<tr>{''.join(cells[i:i + 3])}</tr>" for i in range(0, len(cells), 3))

    if anomalias:
        items = "".join(
            f'<tr><td style="padding:8px 0;border-bottom:1px solid {_BORDER};font-size:14px;color:#111827;">'
            f'<span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:{_SEV_COLOR[a["severidad"]]};margin-right:8px;"></span>'
            f'<strong>{escape(a["userName"])}</strong> · {escape(a["label"])} · '
            f'<span style="color:{_MUTED};">{escape(a["dato"])}</span></td></tr>'
            for a in anomalias
        )
    else:
        items = f'<tr><td style="padding:8px 0;font-size:14px;color:{_MUTED};">Sin anomalías en el período.</td></tr>'

    if not kpis["trades"]:
        items = f'<tr><td style="padding:8px 0;font-size:14px;color:{_MUTED};">Ningún trade de tu equipo registró actividad en el período.</td></tr>'

    html = f"""<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{escape(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#f9fafb;border-radius:14px;overflow:hidden;">
  <tr><td style="background:{_INK};padding:20px 22px;color:#ffffff;border-bottom:3px solid {_GOLD};">
    <div style="font-size:12px;color:{_GOLD};letter-spacing:.06em;text-transform:uppercase;">Trade Marketing · Espert</div>
    <div style="font-size:20px;font-weight:700;margin-top:4px;">{escape(titulo)} de comportamiento</div>
    <div style="font-size:14px;margin-top:4px;opacity:.9;">{periodo}</div>
  </td></tr>
  <tr><td style="padding:14px 16px 4px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">{tiles_html}</table>
  </td></tr>
  <tr><td style="padding:10px 22px 4px;">
    <div style="font-size:13px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:.04em;">Anomalías destacadas</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">{items}</table>
  </td></tr>
  <tr><td align="center" style="padding:22px;">
    <a href="{escape(url)}" style="display:inline-block;background:{_GOLD};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px;">Ver reporte completo →</a>
    <div style="font-size:12px;color:{_MUTED};margin-top:12px;">El link vence el {expira}. Cualquiera con el link puede verlo: no lo reenvíes.</div>
  </td></tr>
</table>
<div style="font-size:11px;color:{_MUTED};margin-top:10px;">Mail automático de la app de Trade Marketing. No respondas a este mensaje.</div>
</td></tr></table>
</body></html>"""

    lines = [titulo + " de comportamiento — " + payload["periodLabel"], ""]
    lines += [f"{label}: {value}" for label, value, _ in tiles(kpis)]
    lines += ["", "Anomalías destacadas:"]
    lines += [f"- {a['userName']} · {a['label']} · {a['dato']}" for a in anomalias] or ["- Sin anomalías"]
    lines += ["", f"Ver reporte completo: {url}", f"El link vence el {expira}."]
    return subject, html, "\n".join(lines)
