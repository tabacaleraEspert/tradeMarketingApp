import { useCallback, useEffect, useState } from "react";
import { Phone, RefreshCw, Truck } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { intelligenceApi, type IntelSupplierRow } from "@/lib/api";

/** Shape mínimo de la fila: el detalle de PDV no trae pdvs/pdvNombres. */
export interface ProveedorItem {
  nombre: string;
  telefono: string | null;
  tipo: string | null;
  productos: string[];
  pdvs?: number;
  pdvNombres?: string[];
}

/** Fila de proveedor compartida por los tres niveles del drill (PDV, ruta, trade). */
export function ProveedorRow({ p, showPdvCount }: { p: ProveedorItem; showPdvCount?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-border last:border-0">
      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
        <Truck size={14} className="text-espert-gold" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-foreground">{p.nombre}</span>
          {p.tipo && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-muted text-muted-foreground">
              {p.tipo}
            </span>
          )}
          {showPdvCount && p.pdvs != null && (
            <span
              className="text-[11px] font-semibold text-espert-gold tabular-nums"
              title={p.pdvNombres?.join("\n")}
            >
              en {p.pdvs} {p.pdvs === 1 ? "PDV" : "PDVs"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap mt-0.5 text-xs text-muted-foreground">
          {p.telefono && (
            <a href={`tel:${p.telefono}`} className="inline-flex items-center gap-1 hover:text-espert-gold">
              <Phone size={11} /> {p.telefono}
            </a>
          )}
          {p.productos.length > 0 && <span className="truncate">{p.productos.join(" · ")}</span>}
        </div>
      </div>
    </div>
  );
}

interface Props {
  /** Trade dueño de las rutas foco. */
  userId: number;
  /** Acotar a UNA ruta foco (nombre); sin esto, todas las rutas del trade. */
  ruta?: string;
}

/**
 * Proveedores cargados en los PDVs de las rutas foco del trade (o de una ruta):
 * el censo de proveedores que levantan los reps en campo, agregado por
 * proveedor con la cantidad de PDVs donde aparece.
 */
export function ProveedoresCard({ userId, ruta }: Props) {
  const [items, setItems] = useState<IntelSupplierRow[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    setItems(null);
    intelligenceApi
      .suppliers({ user_id: userId, ...(ruta ? { ruta } : {}) })
      .then((r) => setItems(r.items))
      .catch(() => setError(true));
  }, [userId, ruta]);

  useEffect(() => {
    load();
  }, [load]);

  // Sin proveedores cargados no se muestra la card: el censo de proveedores es
  // reciente y la mayoría de las rutas todavía no tiene ninguno relevado.
  if (items !== null && items.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="font-bold text-foreground text-sm mb-1">
          Proveedores {ruta ? "en la ruta" : "en las rutas del trade"}
          {items !== null && <span className="text-muted-foreground font-normal"> · {items.length}</span>}
        </h3>
        <p className="text-xs text-muted-foreground mb-2">
          Cargados por los reps en el censo de proveedores de cada PDV.
        </p>
        {error && (
          <div className="text-center py-3 space-y-2">
            <p className="text-xs text-muted-foreground">No se pudieron cargar los proveedores.</p>
            <button onClick={load} className="inline-flex items-center gap-1.5 text-xs font-semibold text-espert-gold hover:underline">
              <RefreshCw size={12} /> Reintentar
            </button>
          </div>
        )}
        {items === null && !error && (
          <div className="flex items-center justify-center h-16">
            <div className="w-5 h-5 border-2 border-[#A48242] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {items !== null && items.map((p) => (
          <ProveedorRow key={`${p.telefono ?? ""}|${p.nombre}`} p={p} showPdvCount />
        ))}
      </CardContent>
    </Card>
  );
}
