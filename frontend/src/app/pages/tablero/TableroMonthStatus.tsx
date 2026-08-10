import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "../../components/ui/tooltip";
import { kpiApi, type ClosedMonth } from "@/lib/api";
import { formatDateTime } from "../../lib/dateUtils";
import { ObjetivosConfirmDialog } from "./ObjetivosConfirmDialog";

const MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

interface Props {
  year: number;
  month: number;
  closedMonths: ClosedMonth[];
  /** `partial` del mes seleccionado según /kpi/variable (true = es el mes en curso, calculado en vivo). */
  partial: boolean;
  /** `day` del mes seleccionado según /kpi/variable (día actual si `partial`, último día del mes si no). */
  day: number;
  isAdmin: boolean;
  onClosed: () => void;
}

// Badge de estado del mes seleccionado (cerrado / en curso / sin cerrar) + acción
// de cierre manual para admin (T5, docs/tablero-tmr-plan-fase1.md). `closedMonths`
// es la lista completa devuelta por /kpi/closed-months (todos los años); el
// filtrado por (year, month) es local, así el padre la pide una sola vez.
export function TableroMonthStatus({ year, month, closedMonths, partial, day, isAdmin, onClosed }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);

  const now = new Date();
  const isPastMonth = year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1);
  const closedInfo = closedMonths.find((cm) => cm.year === year && cm.month === month);
  const isPartialClose = !!closedInfo && !closedInfo.complete;

  const handleConfirm = async () => {
    const result = await kpiApi.closeMonth({ year, month });
    const skipped = result.usersSkipped.length;
    toast.success(
      `Mes cerrado: ${result.usersClosed} usuario${result.usersClosed === 1 ? "" : "s"}` +
        (skipped > 0 ? ` · ${skipped} omitido${skipped === 1 ? "" : "s"} sin configuración vigente` : "")
    );
    onClosed();
  };

  const handleConfirmComplete = async () => {
    const result = await kpiApi.closeMonth({ year, month, only_missing: true });
    const completed = result.usersCompleted.length;
    toast.success(
      completed > 0
        ? `Cierre completado: ${completed} usuario${completed === 1 ? "" : "s"} más congelado${completed === 1 ? "" : "s"}`
        : "No había usuarios pendientes para completar"
    );
    onClosed();
  };

  return (
    <div className="flex items-center gap-2">
      {closedInfo?.complete ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge className="bg-green-100 text-green-700 border-0">Mes cerrado</Badge>
          </TooltipTrigger>
          <TooltipContent side="top">
            {closedInfo.frozenAt ? `Congelado el ${formatDateTime(closedInfo.frozenAt)}` : "Congelado"}
          </TooltipContent>
        </Tooltip>
      ) : closedInfo ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge className="bg-orange-100 text-orange-700 border-0">Cerrado parcial</Badge>
          </TooltipTrigger>
          <TooltipContent side="top">
            {closedInfo.users} de {closedInfo.usersWithRoutes} vendedores congelados
          </TooltipContent>
        </Tooltip>
      ) : partial ? (
        <Badge className="bg-amber-100 text-amber-700 border-0">En curso · día {day}</Badge>
      ) : isPastMonth ? (
        <Badge variant="secondary">Sin cerrar</Badge>
      ) : null}

      {isAdmin && isPastMonth && !closedInfo && (
        <Button size="sm" variant="outline" onClick={() => setConfirmOpen(true)}>
          Cerrar mes
        </Button>
      )}

      {isAdmin && isPartialClose && (
        <Button size="sm" variant="outline" onClick={() => setCompleteOpen(true)}>
          Completar cierre
        </Button>
      )}

      <ObjetivosConfirmDialog
        isOpen={confirmOpen}
        title="Cerrar mes"
        confirmText="Cerrar mes"
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
      >
        <p>
          Se congelan los resultados de <strong>{MONTH_NAMES[month - 1]} {year}</strong> para todos los vendedores.
          A partir de ahí el número no cambia aunque se carguen datos nuevos.
        </p>
      </ObjetivosConfirmDialog>

      <ObjetivosConfirmDialog
        isOpen={completeOpen}
        title="Completar cierre"
        confirmText="Completar cierre"
        onClose={() => setCompleteOpen(false)}
        onConfirm={handleConfirmComplete}
      >
        <p>
          Se congelan solo los vendedores que faltan; los ya congelados no se tocan.
        </p>
      </ObjetivosConfirmDialog>
    </div>
  );
}
