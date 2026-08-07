import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { kpiApi, type PriceMatrixItem, type SuspiciousPriceItem } from "@/lib/api";
import { PreciosMatrix } from "./PreciosMatrix";
import { PreciosSuspicious } from "./PreciosSuspicious";

interface Props {
  year: number;
  month: number;
  userId: number | null;
  userName: string | null;
}

type GroupBy = "route" | "user";

export function PreciosTab({ year, month, userId, userName }: Props) {
  const [groupBy, setGroupBy] = useState<GroupBy>("route");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [matrix, setMatrix] = useState<PriceMatrixItem[]>([]);
  const [suspicious, setSuspicious] = useState<SuspiciousPriceItem[]>([]);

  // Si hay vendedor seleccionado en el drill-down se pasa user_id a ambos endpoints
  // para mostrar solo lo suyo (se indica en el subtítulo de la matriz más abajo).
  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    Promise.all([
      kpiApi.priceMatrix({ year, month, group_by: groupBy, user_id: userId ?? undefined }),
      kpiApi.suspiciousPrices({ year, month, user_id: userId ?? undefined }),
    ])
      .then(([matrixRows, suspiciousRows]) => {
        setMatrix(matrixRows);
        setSuspicious(suspiciousRows);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [year, month, groupBy, userId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-[#A48242] border-t-transparent rounded-full animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-center space-y-3">
          <p className="text-sm text-muted-foreground">No se pudo cargar la información de precios.</p>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-espert-gold hover:underline"
          >
            <RefreshCw size={12} /> Reintentar
          </button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="font-bold text-foreground">Matriz de precios relevados</h3>
              {userId != null && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Mostrando solo lo relevado por {userName ?? `usuario #${userId}`}.
                </p>
              )}
            </div>
            <div className="inline-flex rounded-md overflow-hidden border border-border text-xs font-semibold shrink-0">
              <button
                onClick={() => setGroupBy("route")}
                className={`px-3 py-1.5 ${groupBy === "route" ? "bg-espert-gold text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
              >
                Por ruta
              </button>
              <button
                onClick={() => setGroupBy("user")}
                className={`px-3 py-1.5 ${groupBy === "user" ? "bg-espert-gold text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
              >
                Por vendedor
              </button>
            </div>
          </div>
          <PreciosMatrix items={matrix} />
        </CardContent>
      </Card>

      <PreciosSuspicious items={suspicious} />
    </div>
  );
}
