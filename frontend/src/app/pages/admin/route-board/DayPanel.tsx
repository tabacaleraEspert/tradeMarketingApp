import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRightLeft, Check, ExternalLink, Lock, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { SearchInput } from "../../../components/ui/search-input";
import { routesApi } from "@/lib/api";
import type { BoardDayDetail, BoardPdvCandidate, BoardRep } from "@/lib/api/routeBoard";
import { dowLong, dayMonth } from "./boardUtils";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendiente",
  IN_PROGRESS: "En curso",
  DONE: "Visitado",
  SKIPPED: "Salteado",
};

const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/**
 * Panel lateral de un día planificado: PDVs del día, altas/bajas solo para ese día, mover y
 * eliminar. Es un diálogo modal de Radix (mismo primitivo que ui/sheet.tsx): aria-modal,
 * foco atrapado adentro, Escape para cerrar y el foco vuelve al chip que lo abrió.
 */
export function DayPanel({
  routeDayId,
  reps,
  today,
  onClose,
  onChanged,
  onRequestMove,
}: {
  routeDayId: number;
  reps: BoardRep[];
  today: string;
  onClose: () => void;
  /** Algo cambió (PDVs del día, día eliminado): el tablero se recarga. */
  onChanged: () => void;
  onRequestMove: (detail: BoardDayDetail, targetDate: string, targetUserId: number) => void;
}) {
  // El panel se abre sin <Dialog.Trigger>: se recuerda quién tenía el foco (el chip) para
  // devolvérselo al cerrar (Radix solo lo devuelve solo cuando hay trigger).
  const opener = useRef<Element | null>(typeof document !== "undefined" ? document.activeElement : null);
  const [detail, setDetail] = useState<BoardDayDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moveDate, setMoveDate] = useState("");
  const [moveUser, setMoveUser] = useState<number | "">("");
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState<BoardPdvCandidate[] | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await routesApi.dayDetail(routeDayId);
      setDetail(d);
      setMoveDate(d.workDate);
      setMoveUser(d.userId);
      setError(null);
    } catch (e) {
      setError(errMsg(e, "No se pudo cargar el día"));
    }
  }, [routeDayId]);

  useEffect(() => {
    setDetail(null);
    setConfirmDelete(false);
    setAdding(false);
    setQ("");
    load();
  }, [load]);

  // Candidatos para sumar al día (con debounce al tipear).
  useEffect(() => {
    if (!adding) return;
    let cancelled = false;
    const t = setTimeout(() => {
      routesApi
        .dayPdvCandidates(routeDayId, q.trim())
        .then((rows) => { if (!cancelled) setCandidates(rows); })
        .catch(() => { if (!cancelled) setCandidates([]); });
    }, q ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [adding, q, routeDayId, detail?.pdvs.length]);

  const sortedReps = useMemo(() => [...reps].sort((a, b) => a.name.localeCompare(b.name, "es")), [reps]);
  const isPast = detail ? detail.workDate < today : false;
  const canEditPdvs = detail ? !isPast : false; // el servidor rechaza tocar días pasados
  const done = detail ? detail.pdvs.filter((p) => p.executionStatus === "DONE").length : 0;
  const moveChanged = detail ? moveDate !== detail.workDate || moveUser !== detail.userId : false;

  const run = async (fn: () => Promise<unknown>, okMsg: string, failMsg: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(okMsg);
      await load();
      onChanged();
    } catch (e) {
      toast.error(errMsg(e, failMsg));
    } finally {
      setBusy(false);
    }
  };

  const removePdv = (pdvId: number, name: string) =>
    run(() => routesApi.removeDayPdv(routeDayId, pdvId), `"${name}" quitado de este día`, "No se pudo quitar el PDV");

  const addPdv = (c: BoardPdvCandidate) =>
    run(
      () =>
        routesApi.addDayPdv(routeDayId, {
          PdvId: c.pdvId,
          PlannedOrder: Math.max(0, ...(detail?.pdvs ?? []).map((p) => p.plannedOrder)) + 1,
        }),
      `"${c.name}" sumado a este día`,
      "No se pudo sumar el PDV",
    );

  const deleteDay = async () => {
    setBusy(true);
    try {
      await routesApi.deleteDay(routeDayId, "board");
      toast.success("Día de visita eliminado");
      onChanged();
      onClose();
    } catch (e) {
      toast.error(errMsg(e, "No se pudo eliminar el día"));
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <Dialog.Content
        aria-modal="true"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const el = opener.current;
          if (el instanceof HTMLElement && el.isConnected) el.focus();
        }}
        data-testid="day-panel"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-2xl focus:outline-none"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <Dialog.Description className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {detail ? `${dowLong(detail.workDate)} ${dayMonth(detail.workDate)}/${detail.workDate.slice(0, 4)}` : "Día de visita"}
            </Dialog.Description>
            <Dialog.Title className="mt-0.5 flex items-center gap-2 text-lg font-bold text-foreground">
              <span className="truncate">{detail?.routeName ?? "Cargando..."}</span>
              {detail?.routeType === "campaign" && (
                <span className="rounded bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300 px-1.5 text-[10px] font-semibold leading-4 shrink-0">
                  Campaña
                </span>
              )}
            </Dialog.Title>
            {detail && <p className="text-sm text-muted-foreground truncate">{detail.userName ?? "Sin trade"}</p>}
          </div>
          <Dialog.Close aria-label="Cerrar panel" className="rounded-lg p-2 hover:bg-muted transition-colors">
            <X size={18} />
          </Dialog.Close>
        </header>

        {error && <p className="px-5 py-4 text-sm text-destructive">{error}</p>}

        {detail && (
          <div className="flex-1 overflow-y-auto">
            {detail.locked && (
              <p className="flex items-start gap-2 border-b border-border bg-muted/50 px-5 py-2.5 text-xs text-muted-foreground" data-testid="panel-locked">
                <Lock size={13} className="mt-0.5 shrink-0" />
                {isPast
                  ? "Este día ya pasó: no se puede mover ni eliminar."
                  : "Este día ya tiene visitas o está en curso: no se puede mover ni eliminar."}
              </p>
            )}

            {/* PDVs del día */}
            <section className="px-5 py-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  PDVs del día <span className="font-normal text-muted-foreground tabular-nums">· {done}/{detail.pdvs.length} visitados</span>
                </h3>
                {canEditPdvs && (
                  <Button variant="outline" size="sm" onClick={() => setAdding((v) => !v)} data-testid="panel-add-pdv">
                    {adding ? <X /> : <Plus />} {adding ? "Cerrar" : "Sumar PDV"}
                  </Button>
                )}
              </div>

              {adding && (
                <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
                  <SearchInput value={q} onChange={setQ} placeholder="Buscar PDV por nombre o dirección..." autoFocus />
                  <p className="mt-1.5 text-[11px] text-muted-foreground">Se suma solo a este día. La ruta no cambia.</p>
                  <ul className="mt-2 max-h-52 overflow-y-auto divide-y divide-border rounded-md border border-border bg-card">
                    {candidates === null && <li className="px-3 py-3 text-xs text-muted-foreground">Buscando...</li>}
                    {candidates?.length === 0 && <li className="px-3 py-3 text-xs text-muted-foreground">No hay PDVs para sumar</li>}
                    {candidates?.map((c) => (
                      <li key={c.pdvId} className="flex items-center gap-2 px-3 py-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-foreground">{c.name}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {c.inRoute ? "De la ruta" : "De la zona"}
                            {c.address ? ` · ${c.address}` : ""}
                          </span>
                        </span>
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => addPdv(c)} aria-label={`Sumar ${c.name}`}>
                          <Plus />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <ol className="mt-3 divide-y divide-border rounded-lg border border-border">
                {detail.pdvs.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Este día no tiene PDVs</li>}
                {detail.pdvs.map((p, i) => {
                  const removable = canEditPdvs && !p.hasVisit && p.executionStatus === "PENDING";
                  return (
                    <li key={p.pdvId} className="flex items-center gap-3 px-3 py-2" data-testid={`panel-pdv-${p.pdvId}`}>
                      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{p.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {[p.address, p.city].filter(Boolean).join(" · ") || "Sin dirección"}
                        </span>
                      </span>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          p.executionStatus === "DONE"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                            : p.executionStatus === "PENDING" && !p.hasVisit
                              ? "bg-muted text-muted-foreground"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                        }`}
                      >
                        {p.executionStatus === "DONE" && <Check size={11} />}
                        {p.executionStatus === "PENDING" && p.hasVisit ? "Con visita" : STATUS_LABEL[p.executionStatus] ?? p.executionStatus}
                      </span>
                      {canEditPdvs && (
                        <button
                          type="button"
                          disabled={!removable || busy}
                          onClick={() => removePdv(p.pdvId, p.name)}
                          aria-label={`Quitar ${p.name} de este día`}
                          title={removable ? "Quitar de este día (la ruta no cambia)" : "Ya tiene una visita: no se puede quitar"}
                          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                        >
                          <X size={15} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>

            {/* Mover (alternativa a arrastrar) */}
            {!detail.locked && (
              <section className="border-t border-border px-5 py-4">
                <h3 className="text-sm font-semibold text-foreground">Mover</h3>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <label className="block text-xs text-muted-foreground">
                    Fecha
                    <input
                      type="date"
                      value={moveDate}
                      min={today}
                      max={detail.endDate ?? undefined}
                      onChange={(e) => setMoveDate(e.target.value)}
                      data-testid="panel-move-date"
                      className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-espert-gold"
                    />
                  </label>
                  <label className="block text-xs text-muted-foreground">
                    Trade Marketer
                    <select
                      value={moveUser}
                      onChange={(e) => setMoveUser(Number(e.target.value))}
                      data-testid="panel-move-user"
                      className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-espert-gold"
                    >
                      {!sortedReps.some((r) => r.userId === detail.userId) && <option value={detail.userId}>{detail.userName ?? "—"}</option>}
                      {sortedReps.map((r) => (
                        <option key={r.userId} value={r.userId}>{r.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <Button
                  className="mt-3 w-full"
                  variant="outline"
                  disabled={!moveChanged || !moveDate || moveUser === "" || busy}
                  onClick={() => moveUser !== "" && onRequestMove(detail, moveDate, moveUser)}
                  data-testid="panel-move-btn"
                >
                  <ArrowRightLeft /> Mover...
                </Button>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Cambiar el trade reasigna toda la ruta: prestar un solo día a otro trade todavía no está disponible.
                </p>
              </section>
            )}
          </div>
        )}

        {detail && (
          <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
            <Link
              to={`/admin/routes/${detail.routeId}/edit`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-espert-gold hover:underline"
              data-testid="panel-open-editor"
            >
              <ExternalLink size={14} /> Abrir editor de ruta
            </Link>
            {detail.hasVisits ? (
              <span className="text-right text-xs text-muted-foreground" data-testid="panel-delete-blocked">
                Tiene visitas cargadas: no se puede eliminar
              </span>
            ) : detail.locked ? null : confirmDelete ? (
              <span className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmDelete(false)}>No</Button>
                <Button variant="destructive" size="sm" disabled={busy} onClick={deleteDay} data-testid="panel-delete-confirm">
                  Sí, eliminar
                </Button>
              </span>
            ) : (
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)} data-testid="panel-delete">
                <Trash2 /> Eliminar día
              </Button>
            )}
          </footer>
        )}
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
