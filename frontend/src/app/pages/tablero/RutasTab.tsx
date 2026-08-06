import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, RefreshCw, Users } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { kpiApi, type RouteSummaryRow } from "@/lib/api";
import { formatPct, toneFor, toneClasses } from "./resumen-utils";

interface VendorOption {
  userId: number;
  name: string | null;
}

interface Props {
  year: number;
  month: number;
  userId: number | null;
  managerId: number | null;
  vendors: VendorOption[];
  onSelectUser: (userId: number) => void;
}

type SortKey = keyof Pick<
  RouteSummaryRow,
  "name" | "pdvs" | "planned" | "visited" | "effectiveness" | "actions" | "withMaterial" | "sellsLoose" | "withExchange"
>;

interface Column {
  key: SortKey;
  label: string;
  align: "left" | "center";
  defaultDir: "asc" | "desc";
}

// NOTA: RouteSummaryRow (services.ts) no trae el dueño/TMR de la ruta — solo `routeId`/`name`.
// Cuando userId es null el endpoint /kpi/route-summary devuelve las rutas de todos los usuarios
// visibles, pero sin ese dato no podemos agrupar por TMR (spec §2 del plan): se muestra tabla
// plana. Si el endpoint llegara a agregar un campo de dueño, agrupar acá.
const COLUMNS: Column[] = [
  { key: "name", label: "Ruta", align: "left", defaultDir: "asc" },
  { key: "pdvs", label: "PDVs", align: "center", defaultDir: "desc" },
  { key: "planned", label: "Planificadas", align: "center", defaultDir: "desc" },
  { key: "visited", label: "Realizadas", align: "center", defaultDir: "desc" },
  { key: "effectiveness", label: "Efectividad", align: "center", defaultDir: "desc" },
  { key: "actions", label: "Acciones", align: "center", defaultDir: "desc" },
  { key: "withMaterial", label: "Con material", align: "center", defaultDir: "desc" },
  { key: "sellsLoose", label: "Venden sueltos", align: "center", defaultDir: "desc" },
  { key: "withExchange", label: "Con canje", align: "center", defaultDir: "desc" },
];

export function RutasTab({ year, month, userId, managerId, vendors, onSelectUser }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rows, setRows] = useState<RouteSummaryRow[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "effectiveness", dir: "desc" });

  // Con territorio seleccionado pero sin vendedor no se pide nada al backend:
  // se muestra el mensaje de "elegí un vendedor" (ver render más abajo).
  const load = useCallback(() => {
    if (managerId != null && userId == null) {
      setRows([]);
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    kpiApi.routeSummary({ year, month, user_id: userId ?? undefined })
      .then(setRows)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [year, month, userId, managerId]);

  useEffect(() => { load(); }, [load]);

  const sortedRows = useMemo(() => {
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      if (typeof va === "string" || typeof vb === "string") {
        return factor * String(va).localeCompare(String(vb));
      }
      return factor * ((va as number) - (vb as number));
    });
  }, [rows, sort]);

  const totals = useMemo(() => {
    const sum = (key: keyof RouteSummaryRow) => rows.reduce((acc, r) => acc + (r[key] as number), 0);
    const planned = sum("planned");
    // El endpoint no expone el numerador crudo de "efectividad" (PDVs efectivos), solo el
    // porcentaje ya redondeado por ruta. Se reconstruye para poder recalcular el total real
    // (no un promedio de promedios); puede diferir en <1 PDV por redondeo acumulado.
    const effectivePdvs = rows.reduce((acc, r) => acc + Math.round((r.effectiveness / 100) * r.planned), 0);
    const effectiveness = planned > 0 ? Math.round((effectivePdvs / planned) * 10000) / 100 : 0;
    return {
      pdvs: sum("pdvs"),
      planned,
      visited: sum("visited"),
      effectiveness,
      actions: sum("actions"),
      withMaterial: sum("withMaterial"),
      sellsLoose: sum("sellsLoose"),
      withExchange: sum("withExchange"),
    };
  }, [rows]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      return { key, dir: COLUMNS.find((c) => c.key === key)?.defaultDir ?? "desc" };
    });
  };

  if (managerId != null && userId == null) {
    return (
      <Card>
        <CardContent className="p-10 flex flex-col items-center gap-3 text-center">
          <Users size={28} className="text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">Elegí un vendedor del territorio para ver sus rutas.</p>
          {vendors.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-center">
              {vendors.map((v) => (
                <button
                  key={v.userId}
                  onClick={() => onSelectUser(v.userId)}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground hover:bg-muted/70"
                >
                  {v.name ?? `Usuario #${v.userId}`}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

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
          <p className="text-sm text-muted-foreground">No se pudo cargar el resumen de rutas.</p>
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

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground text-center py-8">
            Sin datos de rutas foco para el período seleccionado.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="font-bold text-foreground mb-3">Resumen por ruta foco</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className={`py-2 text-muted-foreground font-semibold cursor-pointer select-none whitespace-nowrap ${
                      col.align === "left" ? "text-left" : "text-center"
                    }`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {sort.key === col.key && (sort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr key={r.routeId} className="border-b border-border last:border-0">
                  <td className="py-2.5 font-medium text-foreground">{r.name}</td>
                  <td className="py-2.5 text-center">{r.pdvs}</td>
                  <td className="py-2.5 text-center">{r.planned}</td>
                  <td className="py-2.5 text-center">{r.visited}</td>
                  <td className="py-2.5">
                    <EffectivenessCell value={r.effectiveness} />
                  </td>
                  <td className="py-2.5 text-center">{r.actions}</td>
                  <td className="py-2.5 text-center">{r.withMaterial}</td>
                  <td className="py-2.5 text-center">{r.sellsLoose}</td>
                  <td className="py-2.5 text-center">{r.withExchange}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold text-foreground">
                <td className="py-2.5">Total</td>
                <td className="py-2.5 text-center">{totals.pdvs}</td>
                <td className="py-2.5 text-center">{totals.planned}</td>
                <td className="py-2.5 text-center">{totals.visited}</td>
                <td className="py-2.5">
                  <EffectivenessCell value={totals.effectiveness} />
                </td>
                <td className="py-2.5 text-center">{totals.actions}</td>
                <td className="py-2.5 text-center">{totals.withMaterial}</td>
                <td className="py-2.5 text-center">{totals.sellsLoose}</td>
                <td className="py-2.5 text-center">{totals.withExchange}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function EffectivenessCell({ value }: { value: number }) {
  const colors = toneClasses[toneFor(value)];
  const width = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="relative flex-1 bg-muted rounded-full h-2">
        <div className={`h-2 rounded-full transition-all ${colors.bar}`} style={{ width: `${width}%` }} />
      </div>
      <span className={`font-semibold ${colors.text} shrink-0`}>{formatPct(value)}%</span>
    </div>
  );
}
