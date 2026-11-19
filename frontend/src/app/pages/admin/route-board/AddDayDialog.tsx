import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Modal } from "../../../components/ui/modal";
import { SearchInput } from "../../../components/ui/search-input";
import type { BoardRep, BoardRoute } from "@/lib/api/routeBoard";
import { routesForDate, shortDate } from "./boardUtils";

/**
 * "+" de una celda: planificar ese día una de las rutas vigentes DE ESE TRADE. Un día es
 * siempre del dueño de la ruta (prestar un día a otro trade todavía no está disponible).
 */
export function AddDayDialog({
  rep,
  date,
  routes,
  plannedRouteIds,
  onClose,
  onPick,
}: {
  rep: BoardRep;
  date: string;
  routes: BoardRoute[];
  /** Rutas que ese trade ya tiene planificadas en esa fecha (no se repiten). */
  plannedRouteIds: Set<number>;
  onClose: () => void;
  onPick: (route: BoardRoute) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);

  const own = useMemo(
    () => routesForDate(routes, date).filter((r) => r.assignedUserId === rep.userId),
    [routes, date, rep.userId],
  );
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return own.filter((r) => !q || r.name.toLowerCase().includes(q));
  }, [own, search]);

  const pick = async (route: BoardRoute) => {
    setSavingId(route.routeId);
    try {
      await onPick(route);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo planificar el día");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Planificar ${shortDate(date)} · ${rep.name}`} size="md">
      <div className="space-y-3" data-testid="add-day-dialog">
        {own.length > 5 && <SearchInput value={search} onChange={setSearch} placeholder="Buscar ruta..." autoFocus />}
        <p className="text-xs text-muted-foreground">
          Rutas vigentes de {rep.name}. Para darle una ruta de otro trade, reasigná la ruta (arrastrala a su fila o desde el editor).
        </p>
        <ul className="max-h-[50vh] overflow-y-auto divide-y divide-border rounded-lg border border-border">
          {list.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground" data-testid="add-day-empty">
              {own.length === 0 ? `${rep.name} no tiene rutas vigentes para ese día` : "Ninguna ruta coincide con la búsqueda"}
            </li>
          )}
          {list.map((r) => {
            const planned = plannedRouteIds.has(r.routeId);
            return (
              <li key={r.routeId}>
                <button
                  type="button"
                  disabled={planned || savingId !== null}
                  onClick={() => pick(r)}
                  data-testid={`pick-route-${r.routeId}`}
                  className="w-full px-4 py-2.5 text-left transition-colors hover:bg-espert-gold/5 disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-foreground truncate">{r.name}</span>
                    {r.routeType === "campaign" && (
                      <span className="rounded bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300 px-1.5 text-[10px] font-semibold leading-4 shrink-0">
                        Campaña
                      </span>
                    )}
                    <span className="flex-1" />
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      {savingId === r.routeId ? "Planificando..." : planned ? "Ya planificada ese día" : `${r.pdvCount ?? 0} PDV`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
