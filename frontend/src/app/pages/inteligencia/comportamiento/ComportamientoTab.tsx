/**
 * Pestaña "Comportamiento" del TM rep (Inteligencia): auditoría del trade por
 * rango — ON/OFF, PDVs/día, km (línea recta del backend o por calle vía
 * Directions), GPS, cumplimiento del plan y alertas; lista de días expandible
 * con timeline + mapa, mapa del período completo y export CSV.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent } from "../../../components/ui/card";
import { ComportamientoView } from "./ComportamientoView";
import { DEFAULT_RANGE, RangeFilter } from "./RangeFilter";
import { rangeError, resolveRange, type RangeValue } from "./range-utils";
import { prefetchBehavior, useBehavior } from "./useBehavior";

interface Props {
  userId: number;
  userName: string;
}

export function ComportamientoTab({ userId, userName }: Props) {
  const [rangeValue, setRangeValue] = useState<RangeValue>(DEFAULT_RANGE);
  const range = useMemo(
    () => (rangeError(rangeValue) ? null : resolveRange(rangeValue)),
    [rangeValue]
  );
  const { data, loading, error, retry } = useBehavior(userId, range);

  // Al entrar se muestra "esta semana" (rango chico, responde rápido) y,
  // apenas llega, se precargan en segundo plano "semana pasada" y "este mes"
  // de a uno: cambiar de chip queda instantáneo sin apilar consultas en S0.
  useEffect(() => {
    if (!data || rangeValue.preset !== "esta_semana") return;
    const others = [resolveRange({ preset: "semana_pasada" }), resolveRange({ preset: "este_mes" })]
      .filter((r): r is NonNullable<typeof r> => r !== null);
    void prefetchBehavior(userId, others);
  }, [userId, data, rangeValue.preset]);

  return (
    <div className="space-y-4">
      <RangeFilter value={rangeValue} onChange={setRangeValue} loading={loading} />

      {error && !data && (
        <Card>
          <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button onClick={retry} className="inline-flex items-center gap-1 text-xs font-semibold text-espert-gold hover:underline">
              <RefreshCw size={12} /> Reintentar
            </button>
          </CardContent>
        </Card>
      )}

      {!data && loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
          <Loader2 size={16} className="animate-spin" /> Cargando comportamiento...
        </div>
      )}

      {data && <ComportamientoView data={data} loading={loading} userId={userId} userName={userName} />}
    </div>
  );
}
