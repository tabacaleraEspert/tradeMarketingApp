/**
 * Reporte de comportamiento por mail — página pública `/r/:token` (sin sesión).
 *
 * El token de la URL es la credencial (vence a los 30 días). Muestra el
 * snapshot del período (tiles, anomalías, tabla por trade) y, en
 * `/r/:token/t/:userId`, el detalle de un trade con la misma vista que la
 * pestaña Comportamiento de Inteligencia (sin links a pantallas con login).
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AlertTriangle, ArrowLeft, ChevronRight, Clock, Loader2 } from "lucide-react";
import {
  ApiError,
  publicReportsApi,
  type BehaviorKpiDelta,
  type BehaviorReportKpis,
  type BehaviorReportTrade,
  type IntelBehaviorResponse,
  type PublicBehaviorReport,
} from "@/lib/api";
import { Card, CardContent } from "../../components/ui/card";
import { IntelNavContext } from "../inteligencia/nav-context";
import { ComportamientoView } from "../inteligencia/comportamiento/ComportamientoView";
import { SEVERITY_CLASS, alertLabel, semaforo } from "../inteligencia/comportamiento/alert-meta";
import { dayMonth, deltaClass, fmtDelta } from "./delta-format";

const READ_ONLY_NAV = { openPdv: () => {}, readOnly: true };

// El reporte no cambia (snapshot): se memoiza por token para volver del
// detalle de un trade a la tabla sin volver a pedirlo.
const reportMemo = new Map<string, PublicBehaviorReport>();

type LoadState<T> = { data: T | null; error: { status: number; message: string } | null; loading: boolean };

function useLoad<T>(key: string | null, load: () => Promise<T>, initial: T | null = null): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ data: initial, error: null, loading: initial == null });
  useEffect(() => {
    if (!key || initial != null) return;
    let alive = true;
    setState({ data: null, error: null, loading: true });
    load()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((e: unknown) => {
        const status = e instanceof ApiError ? e.status : 0;
        const message = e instanceof Error ? e.message : "Error";
        if (alive) setState({ data: null, error: { status, message }, loading: false });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    const prevTitle = document.title;
    document.title = "Reporte de comportamiento · Espert";
    return () => {
      meta.remove();
      document.title = prevTitle;
    };
  }, []);
}

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};
const pct = (v: number | null) => (v == null ? "—" : `${v}%`);
const nf = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 1 });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function PublicReportPage() {
  const { token = "", userId } = useParams();
  useNoIndex();
  const report = useLoad(token, () => publicReportsApi.get(token), reportMemo.get(token) ?? null);
  useEffect(() => {
    if (report.data) reportMemo.set(token, report.data);
  }, [report.data, token]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 py-5 sm:py-8 space-y-5">
        <header className="flex items-center gap-3">
          <img src="/tm-logo.png" alt="" className="w-10 h-10 rounded-xl object-contain" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Trade Marketing · Espert</p>
            <h1 className="text-lg sm:text-xl font-bold leading-tight">
              {report.data
                ? `Resumen ${report.data.kind === "weekly" ? "semanal" : "mensual"} de comportamiento`
                : "Reporte de comportamiento"}
            </h1>
          </div>
        </header>

        {report.loading && <Spinner text="Cargando reporte..." />}
        {report.error && <ErrorState status={report.error.status} />}
        {report.data &&
          (userId ? (
            <TradeDetail token={token} report={report.data} userId={Number(userId)} />
          ) : (
            <Summary token={token} report={report.data} />
          ))}
      </div>
    </div>
  );
}

function Spinner({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-12">
      <Loader2 size={16} className="animate-spin" /> {text}
    </div>
  );
}

function ErrorState({ status }: { status: number }) {
  const [title, body] =
    status === 410
      ? ["Este reporte venció", "Los links de los reportes duran 30 días. El próximo resumen llega por mail."]
      : status === 404
        ? ["Link inválido", "Revisá que el link esté completo (copialo entero desde el mail)."]
        : status === 429
          ? ["Demasiadas consultas", "Esperá un minuto y volvé a intentar."]
          : ["No se pudo cargar el reporte", "Revisá la conexión y volvé a intentar."];
  return (
    <Card>
      <CardContent className="p-6 flex items-start gap-3">
        {status === 410 ? <Clock className="text-muted-foreground shrink-0" /> : <AlertTriangle className="text-amber-600 shrink-0" />}
        <div>
          <p className="font-semibold">{title}</p>
          <p className="text-sm text-muted-foreground mt-1">{body}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function PeriodLine({ report }: { report: PublicBehaviorReport }) {
  return (
    <p className="text-sm text-muted-foreground">
      <span className="font-semibold text-foreground">{report.periodLabel}</span>
      {report.recipientName && <> · para {report.recipientName}</>} · el link vence el {fmtDate(report.expiresAt)}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

type SortKey = "alertas" | "userName" | "visitas" | "pdvsPorDia" | "planPct" | "gpsPct" | "fueraPerimetro" | "onProm";

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "userName", label: "Trade" },
  { key: "alertas", label: "Alertas", numeric: true },
  { key: "visitas", label: "Visitas", numeric: true },
  { key: "pdvsPorDia", label: "PDVs/día", numeric: true },
  { key: "planPct", label: "Plan", numeric: true },
  { key: "gpsPct", label: "GPS", numeric: true },
  { key: "fueraPerimetro", label: "Fuera perím.", numeric: true },
  { key: "onProm", label: "ON / OFF" },
];

function sortValue(t: BehaviorReportTrade, k: SortKey): number | string {
  switch (k) {
    case "alertas":
      return t.alertasAlta * 1000 + t.alertasTotal;
    case "userName":
      return t.userName.toLowerCase();
    case "onProm":
      return t.onProm ?? "99:99";
    default:
      return t[k] ?? -1;
  }
}

function Summary({ token, report }: { token: string; report: PublicBehaviorReport }) {
  const k = report.kpis;
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "alertas", desc: true });
  const trades = useMemo(() => {
    const out = [...report.trades];
    out.sort((a, b) => {
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return sort.desc ? -c : c;
    });
    return out;
  }, [report.trades, sort]);

  const comps = report.comparativas ?? [];
  const tiles: { key: keyof BehaviorReportKpis; l: string; v: string; d?: string; cls?: string }[] = [
    { key: "trades", l: "Trades con actividad", v: String(k.trades), d: `${plural(k.diasTrabajados, "día trabajado", "días trabajados")}` },
    { key: "visitas", l: "Visitas", v: nf(k.visitas), d: `${nf(k.kmLinea)} km en línea recta` },
    { key: "pdvsPorDia", l: "PDVs por día", v: nf(k.pdvsPorDia) },
    { key: "planPct", l: "Cumplimiento plan", v: pct(k.planPct), d: `${plural(k.diasConPlanSinVisitas, "día", "días")} con plan sin visitas`, cls: semaforo(k.planPct, 80, 50) },
    { key: "gpsPct", l: "Visitas con GPS", v: pct(k.gpsPct), d: `${k.fueraPerimetro} fuera de perímetro`, cls: semaforo(k.gpsPct, 90, 70) },
    { key: "alertasAlta", l: "Alertas graves", v: String(k.alertasAlta), d: `${plural(k.alertasTotal, "alerta", "alertas")} en total`, cls: semaforo(k.alertasAlta, 0, 3, false) },
  ];

  return (
    <div className="space-y-5">
      <PeriodLine report={report} />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {tiles.map((t) => (
          <Card key={t.l}>
            <CardContent className="p-3 sm:p-4">
              <p className={`text-xl font-bold tabular-nums leading-tight ${t.cls ?? "text-foreground"}`}>{t.v}</p>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-1">{t.l}</p>
              {t.d && <p className="text-[11px] text-muted-foreground">{t.d}</p>}
              {comps.map((c) => {
                const d = c.deltas[t.key];
                return (
                  <p key={c.key} className="text-[11px] mt-0.5 tabular-nums" title={c.label}>
                    <span className={deltaClass(d)}>{fmtDelta(d)}</span>{" "}
                    <span className="text-muted-foreground">{c.short}</span>
                  </p>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
      {comps.length > 0 && (
        <p className="text-[11px] text-muted-foreground -mt-2">
          ▲▼ diferencia y desvío % (en porcentajes, puntos). Comparado con{" "}
          {comps.map((c, i) => (
            <span key={c.key}>
              {i > 0 && " y "}
              {c.label.replace(/^vs /, "")} ({dayMonth(c.from)}–{dayMonth(c.to)})
            </span>
          ))}
          .
        </p>
      )}

      <Card>
        <CardContent className="p-4">
          <h2 className="font-bold text-sm mb-2">Anomalías destacadas</h2>
          {report.anomalias.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin anomalías en el período.</p>
          ) : (
            <ul className="divide-y divide-border">
              {report.anomalias.map((a) => (
                <li key={`${a.userId}-${a.tipo}`}>
                  <Link
                    to={`/r/${token}/t/${a.userId}`}
                    className="flex items-start gap-2 py-2 text-sm hover:bg-muted/50 -mx-2 px-2 rounded-lg"
                  >
                    <span className={`mt-0.5 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded shrink-0 ${SEVERITY_CLASS[a.severidad]}`}>{a.severidad}</span>
                    <span className="flex-1 min-w-0">
                      <span className="font-semibold">{a.userName}</span>
                      <span className="text-muted-foreground"> · {a.label} · {a.dato}</span>
                    </span>
                    <ChevronRight size={14} className="mt-1 text-muted-foreground shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 sm:p-2">
          <h2 className="font-bold text-sm px-4 pt-4 pb-2">
            Trades <span className="text-xs font-semibold text-muted-foreground">({trades.length})</span>
            {comps[0] && (
              <span className="ml-2 text-[11px] font-normal text-muted-foreground">▲▼ {comps[0].label}</span>
            )}
          </h2>
          {trades.length === 0 ? (
            <p className="text-sm text-muted-foreground px-4 pb-4">Ningún trade registró actividad en el período.</p>
          ) : (
            <>
            {/* Celular: lista (una tabla de 8 columnas no entra). */}
            <ul className="sm:hidden divide-y divide-border border-t border-border">
              {trades.map((t) => (
                <TradeItem key={t.userId} token={token} t={t} />
              ))}
            </ul>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    {COLUMNS.map((c) => (
                      <th key={c.key} className={`px-3 py-2 font-semibold whitespace-nowrap ${c.numeric ? "text-right" : "text-left"}`}>
                        <button
                          type="button"
                          onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : c.numeric === true }))}
                          className="hover:text-foreground"
                        >
                          {c.label}
                          {sort.key === c.key ? (sort.desc ? " ↓" : " ↑") : ""}
                        </button>
                      </th>
                    ))}
                    <th className="w-6" />
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => (
                    <TradeRow key={t.userId} token={token} t={t} />
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Diferencia contra el período anterior, debajo del valor de la tabla. */
function Delta({ d }: { d: BehaviorKpiDelta | null | undefined }) {
  if (!d) return null;
  return <span className={`block text-[10px] ${deltaClass(d)}`}>{fmtDelta(d, true)}</span>;
}

function topAlerts(t: BehaviorReportTrade, n = 2) {
  return Object.entries(t.alertas)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, n)
    .map(([tipo, c]) => `${alertLabel(tipo)} ${c}`)
    .join(" · ");
}

function TradeItem({ token, t }: { token: string; t: BehaviorReportTrade }) {
  const top = topAlerts(t);
  return (
    <li>
      <Link to={`/r/${token}/t/${t.userId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{t.userName}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {t.visitas} visitas{t.prev?.visitas && <span className={deltaClass(t.prev.visitas)}> ({fmtDelta(t.prev.visitas, true)})</span>} · plan{" "}
            <span className={semaforo(t.planPct, 80, 50)}>{pct(t.planPct)}</span> · GPS{" "}
            <span className={semaforo(t.gpsPct, 90, 70)}>{pct(t.gpsPct)}</span> · {t.onProm ?? "—"}–{t.offProm ?? "—"}
          </p>
          {top && <p className="text-[11px] text-muted-foreground truncate">{top}</p>}
        </div>
        <span className="text-right shrink-0">
          {t.alertasAlta > 0 && (
            <span className="inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300 mr-1">
              {t.alertasAlta}
            </span>
          )}
          <span className="text-sm tabular-nums">{t.alertasTotal}</span>
          <span className="block text-[10px] text-muted-foreground">alertas</span>
        </span>
        <ChevronRight size={16} className="text-muted-foreground shrink-0" />
      </Link>
    </li>
  );
}

function TradeRow({ token, t }: { token: string; t: BehaviorReportTrade }) {
  const navigate = useNavigate();
  const href = `/r/${token}/t/${t.userId}`;
  const top = topAlerts(t);
  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/50 cursor-pointer" onClick={() => navigate(href)}>
      <td className="px-3 py-2">
        <Link to={href} className="font-semibold hover:underline">
          {t.userName}
        </Link>
        {top && <p className="text-[11px] text-muted-foreground">{top}</p>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
        {t.alertasAlta > 0 && (
          <span className="inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300 mr-1">
            {t.alertasAlta}
          </span>
        )}
        {t.alertasTotal}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {t.visitas}
        <Delta d={t.prev?.visitas} />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{nf(t.pdvsPorDia)}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        <span className={semaforo(t.planPct, 80, 50)}>{pct(t.planPct)}</span>
        <Delta d={t.prev?.planPct} />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <span className={semaforo(t.gpsPct, 90, 70)}>{pct(t.gpsPct)}</span>
        <Delta d={t.prev?.gpsPct} />
      </td>
      <td className={`px-3 py-2 text-right tabular-nums ${semaforo(t.fueraPerimetro, 0, 2, false)}`}>{t.fueraPerimetro}</td>
      <td className="px-3 py-2 tabular-nums whitespace-nowrap">
        {t.onProm ?? "—"} / {t.offProm ?? "—"}
      </td>
      <td className="pr-3">
        <Link to={href} aria-label={`Ver detalle de ${t.userName}`}>
          <ChevronRight size={16} className="text-muted-foreground" />
        </Link>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Detalle de un trade
// ---------------------------------------------------------------------------

function TradeDetail({ token, report, userId }: { token: string; report: PublicBehaviorReport; userId: number }) {
  const trade = report.trades.find((t) => t.userId === userId);
  const detail = useLoad<IntelBehaviorResponse>(trade ? `${token}-${userId}` : null, () => publicReportsApi.trade(token, userId));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link
          to={`/r/${token}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground hover:bg-muted/70"
        >
          <ArrowLeft size={13} /> Todos los trades
        </Link>
        <h2 className="text-lg font-bold">{trade?.userName ?? "Trade"}</h2>
      </div>
      <PeriodLine report={report} />

      {!trade && <ErrorState status={404} />}
      {detail.loading && <Spinner text="Cargando comportamiento..." />}
      {detail.error && <ErrorState status={detail.error.status} />}
      {detail.data && trade && (
        <IntelNavContext.Provider value={READ_ONLY_NAV}>
          <ComportamientoView data={detail.data} userId={userId} userName={trade.userName} />
        </IntelNavContext.Provider>
      )}
    </div>
  );
}
