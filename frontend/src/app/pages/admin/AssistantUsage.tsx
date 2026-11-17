/**
 * Uso de Puchi — consultas al asistente, costo y herramientas usadas (solo admin).
 *
 * Los textos de preguntas y respuestas se pueden purgar pasados 90 días; las
 * métricas (tokens, costo, herramientas) quedan.
 */
import { Fragment, useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, Filter, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { assistantApi, type AssistantUsage as AssistantUsageData, type AssistantUsageTurn } from "@/lib/api/assistant";
import { Markdown } from "../../components/assistant/markdown";
import { fmtSeconds, fmtUsd } from "../../components/assistant/format";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";

const PURGE_DAYS = 90;
const PURGED = "— (purgada)";

const pad = (n: number) => String(n).padStart(2, "0");
const toIsoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const fmtInt = (n: number) => n.toLocaleString("es-AR");
const fmtDateTimeAr = (iso: string) =>
  new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z").toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export function AssistantUsage() {
  const today = new Date();
  const [dateFrom, setDateFrom] = useState(toIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [dateTo, setDateTo] = useState(toIsoDate(today));
  const [data, setData] = useState<AssistantUsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purging, setPurging] = useState(false);

  const load = useCallback(async () => {
    if (!dateFrom || !dateTo) return;
    setLoading(true);
    setError(null);
    try {
      setData(await assistantApi.usage(dateFrom, dateTo));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el uso de Puchi.");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  const purge = async () => {
    setPurging(true);
    try {
      const { purged } = await assistantApi.purge(PURGE_DAYS);
      toast.success(
        purged === 0
          ? `No había textos de más de ${PURGE_DAYS} días para purgar`
          : `Se purgaron los textos de ${fmtInt(purged)} consulta${purged === 1 ? "" : "s"}`
      );
      setConfirmPurge(false);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron purgar los textos");
    } finally {
      setPurging(false);
    }
  };

  const summary = data?.summary;
  const dateCls = "h-9 px-2 border border-border rounded-lg text-sm bg-background max-w-full";

  return (
    // Grilla de una columna minmax(0,1fr): la tabla ancha scrollea adentro de su card en vez de ensanchar la página.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground">Uso de Puchi</h1>
          <p className="text-xs text-muted-foreground">Consultas al asistente, costo y herramientas que usó para responder</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setConfirmPurge(true)} className="gap-1.5">
          <Trash2 size={14} /> Purgar textos de más de {PURGE_DAYS} días
        </Button>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter size={14} className="text-muted-foreground" />
            <input type="date" value={dateFrom} max={dateTo} onChange={(e) => setDateFrom(e.target.value)} aria-label="Desde" className={dateCls} />
            <span className="text-xs text-muted-foreground">a</span>
            <input type="date" value={dateTo} min={dateFrom} onChange={(e) => setDateTo(e.target.value)} aria-label="Hasta" className={dateCls} />
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card>
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>Reintentar</Button>
          </CardContent>
        </Card>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">Cargando...</p>
      ) : (
        <div className={`grid grid-cols-[minmax(0,1fr)] gap-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Consultas" value={fmtInt(summary!.turns)} />
            <Kpi label="Personas" value={fmtInt(summary!.users)} />
            <Kpi
              label="Costo del período"
              value={fmtUsd(summary!.costUsd, 2)}
              caption={`proyección mensual ${fmtUsd(summary!.projectedMonthlyUsd, 2)}`}
            />
            <Kpi
              label="% tokens cacheados"
              value={`${summary!.cachedPct.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`}
              caption="bajo sostenido = caché roto"
            />
          </div>

          <Card>
            <CardContent className="p-4">
              <h2 className="text-sm font-bold text-foreground mb-2">Herramientas más usadas</h2>
              {data.tools.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ninguna consulta usó herramientas en este período.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {data.tools.map((t) => (
                    <li key={t.tool} className="inline-flex items-center gap-2 rounded-full bg-secondary pl-3 pr-1 py-1 text-xs font-medium text-secondary-foreground">
                      <span className="font-mono">{t.tool}</span>
                      <span className="rounded-full bg-card px-2 py-0.5 tabular-nums font-semibold text-foreground">{fmtInt(t.count)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              {data.turns.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground">No hubo consultas en este período.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>Fecha</TableHead>
                      <TableHead>Usuario</TableHead>
                      <TableHead>Pregunta</TableHead>
                      <TableHead className="text-right">Vueltas</TableHead>
                      <TableHead className="text-right">Duración</TableHead>
                      <TableHead className="text-right">Tokens (cacheados)</TableHead>
                      <TableHead className="text-right">Costo</TableHead>
                      <TableHead className="text-center">OK</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.turns.map((t) => {
                      const open = expanded === t.id;
                      return (
                        <Fragment key={t.id}>
                          <TableRow onClick={() => setExpanded(open ? null : t.id)} className="cursor-pointer" data-state={open ? "selected" : undefined}>
                            <TableCell>
                              <button
                                type="button"
                                aria-expanded={open}
                                aria-label={open ? "Ocultar detalle" : "Ver detalle"}
                                className="grid place-items-center rounded p-0.5 text-muted-foreground hover:text-foreground"
                              >
                                {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                              </button>
                            </TableCell>
                            <TableCell className="tabular-nums text-muted-foreground">{fmtDateTimeAr(t.createdUtc)}</TableCell>
                            <TableCell>{t.userName}</TableCell>
                            <TableCell className="max-w-[320px] truncate whitespace-nowrap" title={t.question ?? undefined}>
                              {t.question ?? <span className="text-muted-foreground">{PURGED}</span>}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{t.rounds}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtSeconds(t.durationMs)}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {fmtInt(t.tokensIn + t.tokensOut)} <span className="text-muted-foreground">({fmtInt(t.tokensCached)})</span>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{fmtUsd(t.costUsd)}</TableCell>
                            <TableCell className="text-center">
                              {t.ok ? (
                                <Check size={16} aria-label="OK" className="inline text-green-700 dark:text-green-400" />
                              ) : (
                                <span title={t.error ?? "Error"} className="inline-flex items-center gap-1 text-xs font-semibold text-destructive">
                                  <TriangleAlert size={14} /> Error
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                          {open && (
                            <TableRow className="hover:bg-transparent">
                              <TableCell colSpan={9} className="whitespace-normal bg-muted/40 p-4">
                                <TurnDetail turn={t} />
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          {data.turns.length >= 500 && (
            <p className="text-xs text-muted-foreground">Se muestran las 500 consultas más recientes del período. Acotá las fechas para ver el resto.</p>
          )}
        </div>
      )}

      <AlertDialog open={confirmPurge} onOpenChange={(o) => !purging && setConfirmPurge(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Purgar textos de más de {PURGE_DAYS} días</AlertDialogTitle>
            <AlertDialogDescription>
              Se borran las preguntas y respuestas guardadas de las consultas con más de {PURGE_DAYS} días. Las métricas
              (tokens, costo, herramientas) se conservan. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purging}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={purging}
              onClick={(e) => {
                e.preventDefault();
                void purge();
              }}
            >
              {purging ? "Purgando..." : "Purgar textos"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Kpi({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
        {caption && <p className="mt-1 text-xs text-muted-foreground">{caption}</p>}
      </CardContent>
    </Card>
  );
}

function TurnDetail({ turn }: { turn: AssistantUsageTurn }) {
  return (
    <div className="max-w-4xl space-y-4 text-sm">
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-1">Pregunta</p>
        <p className="whitespace-pre-wrap break-words text-foreground">{turn.question ?? PURGED}</p>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-1">Respuesta</p>
        {turn.answer === null ? (
          <p className="text-muted-foreground">{PURGED}</p>
        ) : (
          <div className="rounded-lg border border-border bg-card p-3">
            <Markdown text={turn.answer} />
          </div>
        )}
      </div>
      {!turn.ok && turn.error && (
        <p className="text-destructive">
          <span className="font-semibold">Error:</span> {turn.error}
        </p>
      )}
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-1">Herramientas de esta consulta</p>
        {turn.tools.length === 0 ? (
          <p className="text-muted-foreground">No usó herramientas.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-2 py-1.5 font-semibold">Herramienta</th>
                  <th className="px-2 py-1.5 font-semibold">Argumentos</th>
                  <th className="px-2 py-1.5 text-right font-semibold">ms</th>
                </tr>
              </thead>
              <tbody>
                {turn.tools.map((tool, i) => (
                  <tr key={i} className="border-b border-border last:border-0 align-top">
                    <td className="px-2 py-1.5 font-mono whitespace-nowrap">{tool.tool}</td>
                    <td className="px-2 py-1.5 font-mono break-all text-muted-foreground">{tool.argsJson ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtInt(tool.durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
