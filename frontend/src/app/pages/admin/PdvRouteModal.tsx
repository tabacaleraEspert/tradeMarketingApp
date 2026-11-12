import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { SearchInput } from "../../components/ui/search-input";
import { api } from "@/lib/api/client";
import { routesApi, type Route } from "@/lib/api";

/** Cambiar la ruta regular de un PDV desde Gestión (POST /routes/move-pdv).
 *  El backend re-optimiza solo el orden de las rutas tocadas. */

interface Props {
  pdv: { id: number; name: string; routeId: number | null; routeName: string | null } | null;
  onClose: () => void;
  onDone: () => void;
}

let routesCache: Route[] | null = null;

export function PdvRouteModal({ pdv, onClose, onDone }: Props) {
  const [routes, setRoutes] = useState<Route[]>(routesCache ?? []);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!pdv) return;
    setSearch("");
    if (routesCache) return;
    setLoading(true);
    routesApi
      .list()
      .then((all) => {
        const today = new Date().toISOString().slice(0, 10);
        routesCache = all
          .filter((r) => r.IsActive && r.RouteType !== "campaign" && (!r.EndDate || r.EndDate >= today))
          .sort((a, b) => a.Name.localeCompare(b.Name));
        setRoutes(routesCache);
      })
      .catch((e) => toast.error(e?.message || "No se pudieron cargar las rutas"))
      .finally(() => setLoading(false));
  }, [pdv]);

  const shown = useMemo(() => {
    const t = search.trim().toLowerCase();
    const list = t
      ? routes.filter((r) => r.Name.toLowerCase().includes(t) || (r.AssignedUserName || "").toLowerCase().includes(t))
      : routes;
    return list.slice(0, 80);
  }, [routes, search]);

  const move = async (routeId: number | null) => {
    if (!pdv) return;
    setSaving(true);
    try {
      const r = await api.post<{ changed: boolean; to: string | null }>("/routes/move-pdv", {
        pdv_id: pdv.id,
        to_route_id: routeId,
      });
      toast.success(r.to ? `${pdv.name} pasó a ${r.to}; orden re-optimizado` : `${pdv.name} quedó sin ruta`);
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "No se pudo cambiar la ruta");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={!!pdv} onClose={saving ? () => {} : onClose} title={`Ruta de ${pdv?.name ?? ""}`}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Ruta actual: <span className="font-semibold text-foreground">{pdv?.routeName ?? "Sin ruta"}</span>. Al cambiarla,
          el PDV pasa al trade de la ruta nueva y se re-optimiza el orden de las dos rutas.
        </p>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar ruta o trade..." />
        <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
          {loading && <p className="p-3 text-sm text-muted-foreground">Cargando rutas...</p>}
          {!loading && shown.length === 0 && <p className="p-3 text-sm text-muted-foreground">No hay rutas que coincidan.</p>}
          {shown.map((r) => {
            const current = r.RouteId === pdv?.routeId;
            return (
              <button
                key={r.RouteId}
                disabled={saving || current}
                onClick={() => move(r.RouteId)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-60 disabled:hover:bg-transparent"
              >
                <span className="truncate font-medium">{r.Name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {current ? "Ruta actual" : r.AssignedUserName || "Sin trade"}
                </span>
              </button>
            );
          })}
        </div>
        {pdv?.routeId != null && (
          <Button variant="outline" size="sm" disabled={saving} onClick={() => move(null)}>
            Quitar de la ruta
          </Button>
        )}
      </div>
    </Modal>
  );
}
