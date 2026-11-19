import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, Lock, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Card, CardContent } from "../../../components/ui/card";
import { SearchInput } from "../../../components/ui/search-input";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { routesApi } from "@/lib/api";
import type { BoardDay, BoardRep, BoardRoute, RouteBoardData } from "@/lib/api/routeBoard";
import { describeOverlaps } from "@/lib/routeDays";
import { todayAR } from "../../../lib/dateUtils";
import {
  addDaysISO,
  cellKey,
  dayMonth,
  dowLong,
  dowShort,
  filterAndGroupReps,
  groupByCell,
  mondayOf,
  overlapText,
  planMove,
  shortDate,
  weekColumns,
  weekLabel,
} from "./boardUtils";
import { AddDayDialog } from "./AddDayDialog";
import { DayPanel } from "./DayPanel";
import { MoveConfirmDialog, type MoveRequest, type MoveScope } from "./MoveConfirmDialog";

const DND_TYPE = "ROUTE_DAY";

interface DragItem {
  day: BoardDay;
}

// ── Chip de un día planificado ───────────────────────────────────────────────

function chipState(day: BoardDay, today: string): "done" | "progress" | "missed" | "planned" {
  if (day.status === "COMPLETED" || (day.pdvCount > 0 && day.doneCount >= day.pdvCount)) return "done";
  if (day.hasVisits || day.doneCount > 0 || day.status !== "PLANNED") return "progress";
  if (day.workDate < today) return "missed";
  return "planned";
}

const CHIP_STYLE: Record<ReturnType<typeof chipState>, string> = {
  done: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200",
  progress: "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200",
  missed: "border-dashed border-border bg-muted/50 text-muted-foreground",
  planned: "border-border bg-card text-foreground border-l-[3px] border-l-espert-gold hover:shadow-sm",
};

const DayChip = memo(function DayChip({
  day,
  today,
  onOpen,
}: {
  day: BoardDay;
  today: string;
  onOpen: (day: BoardDay) => void;
}) {
  const [{ isDragging }, drag] = useDrag(
    () => ({
      type: DND_TYPE,
      item: { day } satisfies DragItem,
      canDrag: !day.locked,
      collect: (m) => ({ isDragging: m.isDragging() }),
    }),
    [day],
  );
  const state = chipState(day, today);
  const stateLabel =
    state === "done" ? "Completada" : state === "progress" ? "Con visitas" : state === "missed" ? "Sin visitas" : "Planificada";
  return (
    <button
      ref={(el) => { drag(el); }}
      type="button"
      onClick={() => onOpen(day)}
      data-testid={`chip-${day.routeDayId}`}
      data-state={state}
      title={`${day.routeName} · ${day.pdvCount} PDV · ${stateLabel}${day.locked ? " (no se puede mover)" : " — arrastrá para mover"}`}
      className={`w-full text-left rounded-md border px-2 py-1.5 text-xs transition-shadow ${CHIP_STYLE[state]} ${
        day.locked ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
      } ${isDragging ? "opacity-40" : ""}`}
    >
      <span className="flex items-center gap-1 min-w-0">
        {state === "done" && <Check size={12} className="shrink-0" />}
        {state !== "done" && day.locked && <Lock size={11} className="shrink-0 opacity-70" />}
        <span className="font-semibold truncate">{day.routeName}</span>
      </span>
      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] opacity-80">
        <span className="tabular-nums whitespace-nowrap">
          {state === "done" || state === "progress" ? `${day.doneCount}/${day.pdvCount} PDV` : `${day.pdvCount} PDV`}
        </span>
        {day.routeType === "campaign" && (
          <span className="rounded bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300 px-1 font-semibold leading-4">
            Campaña
          </span>
        )}
      </span>
    </button>
  );
});

// ── Celda (trade × día) ─────────────────────────────────────────────────────

const BoardCell = memo(function BoardCell({
  rep,
  date,
  days,
  today,
  onOpen,
  onAdd,
  onDropDay,
}: {
  rep: BoardRep;
  date: string;
  days: BoardDay[];
  today: string;
  onOpen: (day: BoardDay) => void;
  onAdd: (rep: BoardRep, date: string) => void;
  onDropDay: (day: BoardDay, date: string, userId: number) => void;
}) {
  const isPast = date < today;
  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: DND_TYPE,
      canDrop: (item: DragItem) => !isPast && !(item.day.userId === rep.userId && item.day.workDate === date),
      drop: (item: DragItem) => onDropDay(item.day, date, rep.userId),
      collect: (m) => ({ isOver: m.isOver(), canDrop: m.canDrop() }),
    }),
    [isPast, rep.userId, date, onDropDay],
  );
  const overlap = overlapText(days);
  return (
    <td
      ref={(el) => { drop(el); }}
      data-testid={`cell-${rep.userId}-${date}`}
      data-overlap={overlap ? "true" : undefined}
      className={`group/cell relative align-top border-b border-r border-border p-1.5 min-w-[150px] ${
        date === today ? "bg-espert-gold/5" : isPast ? "bg-muted/20" : ""
      } ${isOver && canDrop ? "ring-2 ring-inset ring-espert-gold bg-espert-gold/10" : ""} ${
        overlap ? "bg-amber-50/70 dark:bg-amber-950/20" : ""
      }`}
    >
      <div className="flex flex-col gap-1 min-h-[44px]">
        {overlap && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="inline-flex items-center gap-1 self-start rounded px-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400"
                aria-label={overlap}
                data-testid="overlap-flag"
              >
                <AlertTriangle size={12} /> {days.length} rutas
              </span>
            </TooltipTrigger>
            <TooltipContent>{overlap}</TooltipContent>
          </Tooltip>
        )}
        {days.map((d) => (
          <DayChip key={d.routeDayId} day={d} today={today} onOpen={onOpen} />
        ))}
        {!isPast && (
          <button
            type="button"
            onClick={() => onAdd(rep, date)}
            aria-label={`Planificar una ruta para ${rep.name} el ${shortDate(date)}`}
            title="Planificar una ruta este día"
            data-testid={`add-${rep.userId}-${date}`}
            className={`flex items-center justify-center rounded-md border border-dashed border-border text-muted-foreground hover:border-espert-gold hover:text-espert-gold transition-colors ${
              days.length === 0
                ? "flex-1 min-h-[44px] opacity-60 hover:opacity-100"
                : "h-5 opacity-0 group-hover/cell:opacity-100 focus-visible:opacity-100"
            }`}
          >
            <Plus size={14} />
          </button>
        )}
      </div>
    </td>
  );
});

// ── Tablero ─────────────────────────────────────────────────────────────────

export function RouteBoard() {
  const [monday, setMonday] = useState(() => mondayOf(todayAR()));
  const [data, setData] = useState<RouteBoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [zone, setZone] = useState("all");
  const [onlyWithDays, setOnlyWithDays] = useState(false);
  const [openDayId, setOpenDayId] = useState<number | null>(null);
  const [addTarget, setAddTarget] = useState<{ rep: BoardRep; date: string } | null>(null);
  const [moveRequest, setMoveRequest] = useState<MoveRequest | null>(null);
  const [moving, setMoving] = useState(false);
  const reqId = useRef(0);

  const load = useCallback(async (weekMonday: string): Promise<RouteBoardData | null> => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const res = await routesApi.board(weekMonday, addDaysISO(weekMonday, 6));
      if (id !== reqId.current) return null;
      setData(res);
      setError(null);
      return res;
    } catch (e) {
      if (id === reqId.current) setError(e instanceof Error ? e.message : "No se pudo cargar el tablero");
      return null;
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(monday); }, [load, monday]);
  const reload = useCallback(() => load(monday), [load, monday]);

  const today = data?.today ?? todayAR();
  // Mientras carga otra semana se siguen viendo los trades, sin los días de la anterior.
  const days = useMemo(() => (data && data.dateFrom === monday ? data.days : []), [data, monday]);
  const columns = useMemo(() => weekColumns(monday, days), [monday, days]);
  const cells = useMemo(() => groupByCell(days), [days]);
  const routesById = useMemo(() => new Map((data?.routes ?? []).map((r) => [r.routeId, r])), [data]);
  const repsById = useMemo(() => new Map((data?.reps ?? []).map((r) => [r.userId, r])), [data]);
  const zones = useMemo(
    () => [...new Set((data?.reps ?? []).map((r) => r.zoneName).filter((z): z is string => !!z))].sort((a, b) => a.localeCompare(b, "es")),
    [data],
  );
  const groups = useMemo(
    () =>
      filterAndGroupReps(data?.reps ?? [], {
        search,
        zone,
        onlyWithDays,
        repsWithDays: new Set(days.map((d) => d.userId)),
      }),
    [data, search, zone, onlyWithDays, days],
  );
  const repCount = groups.reduce((n, g) => n + g.reps.length, 0);
  const overlapCount = useMemo(() => [...cells.values()].filter((c) => c.length > 1).length, [cells]);

  const openDay = useCallback((day: BoardDay) => setOpenDayId(day.routeDayId), []);
  const openAdd = useCallback((rep: BoardRep, date: string) => setAddTarget({ rep, date }), []);

  const requestMove = useCallback(
    (day: BoardDay, targetDate: string, targetUserId: number) => {
      if (day.locked) {
        toast.error("Ese día ya tiene visitas o ya pasó: no se puede mover");
        return;
      }
      const plan = planMove(day, routesById.get(day.routeId), targetDate, targetUserId);
      if (!plan.dateChanged && !plan.repChanged) return;
      setMoveRequest({ day, targetDate, targetUserId, plan });
    },
    [routesById],
  );

  /** Aviso (no bloqueo) si la celda destino quedó con 2 o más rutas. */
  const warnIfOverlap = (fresh: RouteBoardData | null, userId: number, date: string) => {
    if (!fresh) return;
    const inCell = fresh.days.filter((d) => d.userId === userId && d.workDate === date);
    if (inCell.length > 1) {
      const name = fresh.reps.find((r) => r.userId === userId)?.name ?? "El trade";
      toast.warning(`${name} quedó con ${inCell.length} rutas el ${shortDate(date)}`, {
        description: inCell.map((d) => d.routeName).join(" · "),
        duration: 8000,
      });
    }
  };

  const executeMove = async (scope: MoveScope) => {
    if (!moveRequest) return;
    const { day, targetDate, targetUserId, plan } = moveRequest;
    const targetName = repsById.get(targetUserId)?.name ?? "otro trade";
    setMoving(true);
    try {
      if (scope === "day") {
        // Con cambio de trade solo llega acá cuando el destino es el dueño de la ruta
        // (planMove): el servidor rechaza prestar un día suelto a otro trade.
        await routesApi.updateDay(day.routeDayId, {
          ...(plan.dateChanged ? { WorkDate: targetDate } : {}),
          ...(plan.repChanged ? { AssignedUserId: targetUserId } : {}),
        });
        toast.success(`Día movido a ${shortDate(targetDate)}${plan.repChanged ? ` · ${targetName}` : ""}`);
      } else if (plan.dateChanged) {
        // Día de la semana (+ reasignación si cambió el trade): una sola operación en el servidor.
        const res = await routesApi.shiftWeekday(day.routeDayId, targetDate, plan.repChanged ? targetUserId : undefined);
        const extra = [
          res.kept ? `${res.kept} con visitas sin tocar` : "",
          res.removed ? `${res.removed} eliminados` : "",
        ].filter(Boolean).join(", ");
        toast.success(`"${day.routeName}" ahora se visita los ${dowLong(targetDate)}${plan.repChanged ? ` · ${targetName}` : ""}`, {
          description: `${res.moved} ${res.moved === 1 ? "día corrido" : "días corridos"}${extra ? ` (${extra})` : ""}`,
        });
      } else {
        await routesApi.update(day.routeId, { AssignedUserId: targetUserId });
        toast.success(`"${day.routeName}" reasignada a ${targetName}`);
      }
      setMoveRequest(null);
      setOpenDayId(null);
      const fresh = await reload();
      warnIfOverlap(fresh, targetUserId, targetDate);
      if (scope === "route") {
        // Toda la ruta: puede superponerse en otras semanas que el tablero no muestra.
        routesApi.checkOverlap(day.routeId).then((o) => {
          if (o.hasOverlap) toast.warning("La ruta se superpone con otras del mismo trade", { description: describeOverlaps(o.overlaps), duration: 9000 });
        }).catch(() => {});
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo mover");
      reload();
    } finally {
      setMoving(false);
    }
  };

  const handleCreateDay = async (route: BoardRoute) => {
    if (!addTarget) return;
    const { rep, date } = addTarget;
    await routesApi.createDay(route.routeId, { WorkDate: date, AssignedUserId: rep.userId, Origin: "board" });
    toast.success(`"${route.name}" planificada el ${shortDate(date)} para ${rep.name}`);
    setAddTarget(null);
    warnIfOverlap(await reload(), rep.userId, date);
  };

  const lastCol = columns[columns.length - 1];

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="space-y-4" data-testid="route-board">
        {/* Barra: semana + filtros */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Semana anterior" onClick={() => setMonday((m) => addDaysISO(m, -7))}>
              <ChevronLeft />
            </Button>
            <Button variant="outline" onClick={() => setMonday(mondayOf(todayAR()))} disabled={monday === mondayOf(today)}>
              Hoy
            </Button>
            <Button variant="outline" size="icon" aria-label="Semana siguiente" onClick={() => setMonday((m) => addDaysISO(m, 7))}>
              <ChevronRight />
            </Button>
          </div>
          <div className="flex items-center gap-2 text-foreground">
            <CalendarDays size={18} className="text-espert-gold" />
            <span className="text-lg font-semibold tabular-nums" data-testid="week-label">{weekLabel(monday, lastCol)}</span>
          </div>
          <div className="flex-1" />
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar trade o responsable..." className="w-full sm:w-64" />
          <select
            aria-label="Zona"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            className="h-9 px-3 border border-border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-espert-gold"
          >
            <option value="all">Todas las zonas</option>
            {zones.map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-muted-foreground select-none cursor-pointer">
            <input type="checkbox" checked={onlyWithDays} onChange={(e) => setOnlyWithDays(e.target.checked)} className="accent-[#A48242]" />
            Solo con rutas esta semana
          </label>
          <Button variant="ghost" size="icon" aria-label="Actualizar" onClick={reload} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} />
          </Button>
        </div>

        {/* Resumen + leyenda */}
        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-muted-foreground">
          <span>
            <strong className="text-foreground tabular-nums">{repCount}</strong> {repCount === 1 ? "trade" : "trades"} ·{" "}
            <strong className="text-foreground tabular-nums">{days.length}</strong> {days.length === 1 ? "día planificado" : "días planificados"}
          </span>
          {overlapCount > 0 && (
            <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400" data-testid="overlap-summary">
              <AlertTriangle size={13} /> {overlapCount} {overlapCount === 1 ? "día con rutas superpuestas" : "días con rutas superpuestas"}
            </span>
          )}
          <span className="flex-1" />
          <span className="inline-flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm border border-border border-l-[3px] border-l-espert-gold bg-card" /> Planificada</span>
          <span className="inline-flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm border border-amber-300 bg-amber-50" /> Con visitas</span>
          <span className="inline-flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm border border-emerald-300 bg-emerald-50" /> Completada</span>
          <span className="inline-flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm border border-dashed border-border bg-muted/50" /> Sin visitas</span>
          <span className="hidden lg:inline">Arrastrá una ruta para moverla de día o de trade</span>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={reload}>Reintentar</Button>
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            {/* w-0 + min-w-full: la grilla no ensancha la página (el <main> del layout es un flex
                item sin min-w-0); en pantallas angostas scrollea horizontal acá adentro. */}
            <div className="overflow-auto rounded-xl w-0 min-w-full max-h-[calc(100vh-270px)] min-h-[320px]" data-testid="board-scroll">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-30 bg-muted border-b border-r border-border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground min-w-[124px] w-[132px] sm:min-w-[190px] sm:w-[220px]">
                      Trade Marketer
                    </th>
                    {columns.map((c) => (
                      <th
                        key={c}
                        className={`sticky top-0 z-20 border-b border-r border-border px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide ${
                          c === today ? "bg-espert-gold text-white" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {dowShort(c)} <span className="tabular-nums font-normal normal-case">{dayMonth(c)}</span>
                        {c === today && <span className="ml-1 normal-case font-normal">· hoy</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!data && loading && (
                    <tr>
                      <td colSpan={columns.length + 1} className="px-4 py-16 text-center text-muted-foreground">Cargando tablero...</td>
                    </tr>
                  )}
                  {data && repCount === 0 && (
                    <tr>
                      <td colSpan={columns.length + 1} className="px-4 py-16 text-center text-muted-foreground">
                        <p className="font-medium">{data.reps.length === 0 ? "No hay trades en tu equipo" : "Ningún trade coincide con los filtros"}</p>
                        {data.reps.length > 0 && <p className="text-sm">Probá limpiar la búsqueda o la zona.</p>}
                      </td>
                    </tr>
                  )}
                  {groups.map((g) => (
                    <GroupRows
                      key={g.key}
                      label={g.label}
                      reps={g.reps}
                      showHeader={groups.length > 1}
                      columns={columns}
                      cells={cells}
                      today={today}
                      onOpen={openDay}
                      onAdd={openAdd}
                      onDropDay={requestMove}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {openDayId !== null && data && (
        <DayPanel
          routeDayId={openDayId}
          reps={data.reps}
          today={today}
          onClose={() => setOpenDayId(null)}
          onChanged={reload}
          onRequestMove={(detail, targetDate, targetUserId) => {
            const day = data.days.find((d) => d.routeDayId === detail.routeDayId);
            if (!day) return;
            // El panel es un diálogo modal (atrapa el foco): se cierra antes de abrir la confirmación.
            setOpenDayId(null);
            requestMove(day, targetDate, targetUserId);
          }}
        />
      )}

      {addTarget && data && (
        <AddDayDialog
          rep={addTarget.rep}
          date={addTarget.date}
          routes={data.routes}
          plannedRouteIds={new Set(
            days.filter((d) => d.workDate === addTarget.date && d.userId === addTarget.rep.userId).map((d) => d.routeId),
          )}
          onClose={() => setAddTarget(null)}
          onPick={handleCreateDay}
        />
      )}

      {moveRequest && (
        <MoveConfirmDialog
          request={moveRequest}
          route={routesById.get(moveRequest.day.routeId)}
          fromRep={repsById.get(moveRequest.day.userId)}
          toRep={repsById.get(moveRequest.targetUserId)}
          destinationDays={(cells.get(cellKey(moveRequest.targetUserId, moveRequest.targetDate)) ?? []).filter(
            (d) => d.routeDayId !== moveRequest.day.routeDayId,
          )}
          today={today}
          busy={moving}
          onCancel={() => setMoveRequest(null)}
          onConfirm={executeMove}
        />
      )}
    </DndProvider>
  );
}

const GroupRows = memo(function GroupRows({
  label,
  reps,
  showHeader,
  columns,
  cells,
  today,
  onOpen,
  onAdd,
  onDropDay,
}: {
  label: string;
  reps: BoardRep[];
  showHeader: boolean;
  columns: string[];
  cells: Map<string, BoardDay[]>;
  today: string;
  onOpen: (day: BoardDay) => void;
  onAdd: (rep: BoardRep, date: string) => void;
  onDropDay: (day: BoardDay, date: string, userId: number) => void;
}) {
  return (
    <>
      {showHeader && (
        <tr>
          <td
            colSpan={columns.length + 1}
            className="border-b border-border bg-muted/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            <span className="sticky left-3">{label} · {reps.length}</span>
          </td>
        </tr>
      )}
      {reps.map((rep) => (
        <tr key={rep.userId} data-testid={`rep-row-${rep.userId}`}>
          <th
            scope="row"
            className="sticky left-0 z-10 bg-card border-b border-r border-border px-3 py-2 text-left align-top font-normal min-w-[124px] w-[132px] sm:min-w-[190px] sm:w-[220px]"
          >
            <span className={`block font-medium truncate ${rep.isActive ? "text-foreground" : "text-muted-foreground line-through"}`} title={rep.name}>
              {rep.name}
            </span>
            <span className="block text-[11px] text-muted-foreground truncate">
              {rep.zoneName ?? "Sin zona"}
              {!rep.isActive && " · inactivo"}
            </span>
          </th>
          {columns.map((c) => (
            <BoardCell
              key={c}
              rep={rep}
              date={c}
              days={cells.get(cellKey(rep.userId, c)) ?? EMPTY}
              today={today}
              onOpen={onOpen}
              onAdd={onAdd}
              onDropDay={onDropDay}
            />
          ))}
        </tr>
      ))}
    </>
  );
});

const EMPTY: BoardDay[] = [];
