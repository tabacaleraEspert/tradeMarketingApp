import { AlertTriangle, ArrowRight, CalendarRange, CalendarCheck } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Modal } from "../../../components/ui/modal";
import type { BoardDay, BoardRep, BoardRoute } from "@/lib/api/routeBoard";
import { dayMonth, dowLong, shortDate, type MovePlan } from "./boardUtils";

export type MoveScope = "day" | "route";

export interface MoveRequest {
  day: BoardDay;
  targetDate: string;
  targetUserId: number;
  plan: MovePlan;
}

/** Confirmación al soltar (o mover desde el panel): solo este día o toda la ruta. */
export function MoveConfirmDialog({
  request,
  route,
  fromRep,
  toRep,
  destinationDays,
  today,
  busy,
  onCancel,
  onConfirm,
}: {
  request: MoveRequest;
  route: BoardRoute | undefined;
  fromRep: BoardRep | undefined;
  toRep: BoardRep | undefined;
  /** Otras rutas que el trade destino ya tiene ese día (aviso, no bloqueo). */
  destinationDays: BoardDay[];
  /** Hoy (AR): mover el día de hoy merece un aviso (el trade puede tenerlo abierto en el celular). */
  today: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (scope: MoveScope) => void;
}) {
  const { day, targetDate, plan } = request;
  const fromName = fromRep?.name ?? "—";
  const toName = toRep?.name ?? "—";
  const isCampaign = (route?.routeType ?? day.routeType) === "campaign";

  const wholeLines: string[] = [];
  if (plan.dateChanged) {
    wholeLines.push(
      `La ruta pasa a visitarse los ${dowLong(targetDate)}: cambia su frecuencia y se corren los días planificados desde el ${dayMonth(day.workDate)}. Los que ya tienen visitas no se tocan.`,
    );
  }
  if (plan.repChanged) {
    wholeLines.push(
      `La ruta se reasigna a ${toName}: pasan a su nombre todos los días planificados desde hoy${isCampaign ? "" : " y los PDVs de la ruta"}.`,
    );
  }

  return (
    <Modal isOpen onClose={busy ? () => {} : onCancel} title="Mover ruta" size="md">
      <div className="space-y-4" data-testid="move-dialog">
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
          <p className="font-semibold text-foreground truncate">{day.routeName}</p>
          <p className="mt-1 flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
            <span>{shortDate(day.workDate)} · {fromName}</span>
            <ArrowRight size={14} className="shrink-0" />
            <span className="font-medium text-foreground">{shortDate(targetDate)} · {toName}</span>
          </p>
        </div>

        {destinationDays.length > 0 && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              {toName} ya tiene {destinationDays.length === 1 ? "otra ruta" : `${destinationDays.length} rutas`} ese día (
              {destinationDays.map((d) => d.routeName).join(" · ")}). Se puede mover igual: quedan superpuestas.
            </span>
          </p>
        )}

        {day.workDate === today && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2 text-sm text-amber-900 dark:text-amber-200" data-testid="move-today-warning">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              Este día es de hoy. Si {fromName} ya abrió la app, lo va a seguir viendo en el celular hasta que actualice; las
              visitas que cargue hoy no se pierden, pero quedan fuera de este día de ruta.
            </span>
          </p>
        )}

        <div className="space-y-2">
          {plan.dayOnly ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onConfirm("day")}
              data-testid="move-only-day"
              className="w-full rounded-lg border border-border px-4 py-3 text-left transition-colors hover:border-espert-gold hover:bg-espert-gold/5 disabled:opacity-50"
            >
              <span className="flex items-center gap-2 font-semibold text-foreground">
                <CalendarCheck size={16} className="text-espert-gold" /> Solo este día
              </span>
              <span className="mt-0.5 block text-sm text-muted-foreground">
                Mueve únicamente la visita del {shortDate(day.workDate)}. La ruta, su frecuencia y sus otros días no cambian.
              </span>
            </button>
          ) : (
            plan.dayOnlyReason && (
              <p className="px-1 text-xs text-muted-foreground" data-testid="move-only-day-na">
                {plan.dayOnlyReason}
              </p>
            )
          )}

          {plan.wholeRoute ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onConfirm("route")}
              data-testid="move-whole-route"
              className="w-full rounded-lg border border-border px-4 py-3 text-left transition-colors hover:border-espert-gold hover:bg-espert-gold/5 disabled:opacity-50"
            >
              <span className="flex items-center gap-2 font-semibold text-foreground">
                <CalendarRange size={16} className="text-espert-gold" /> Toda la ruta de acá en adelante
              </span>
              {wholeLines.map((l) => (
                <span key={l} className="mt-0.5 block text-sm text-muted-foreground">{l}</span>
              ))}
            </button>
          ) : (
            plan.wholeRouteReason && (
              <p className="px-1 text-xs text-muted-foreground" data-testid="move-whole-route-na">
                No se puede mover toda la ruta: {plan.wholeRouteReason}
              </p>
            )
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {busy ? "Moviendo..." : "Cancelar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
