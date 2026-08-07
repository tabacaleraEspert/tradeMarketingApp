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

function sortRouteRows(list: RouteSummaryRow[], sort: { key: SortKey; dir: "asc" | "desc" }): RouteSummaryRow[] {
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = a[sort.key];
    const vb = b[sort.key];
    if (typeof va === "string" || typeof vb === "string") {
      return factor * String(va).localeCompare(String(vb));
    }
    return factor * ((va as number) - (vb as number));
  });
}

function routeTotals(list: RouteSummaryRow[]) {
  const sum = (key: keyof RouteSummaryRow) => list.reduce((acc, r) => acc + (r[key] as number), 0);
  const planned = sum("planned");
  // El endpoint no expone el numerador crudo de "efectividad" (PDVs efectivos), solo el
  // porcentaje ya redondeado por ruta. Se reconstruye para poder recalcular el total real
  // (no un promedio de promedios); puede diferir en <1 PDV por redondeo acumulado.
  const effectivePdvs = list.reduce((acc, r) => acc + Math.round((r.effectiveness / 100) * r.planned), 0);
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
}

interface VendorGroup {
  userId: number;
  userName: string | null;
  rows: RouteSummaryRow[];
  totals: ReturnType<typeof routeTotals>;
}

export function RutasTab({ year, month, userId, managerId, vendors, onSelectUser }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rows, setRows] = useState<RouteSummaryRow[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "effectiveness", dir: "desc" });

  // Con territorio seleccionado pero sin vendedor puntual se pide sin user_id (el endpoint
  // trae todos los usuarios visibles) y se filtra client-side a los vendedores del
  // territorio elegido; así quedan agrupadas por TMR igual que en la vista General
  // (ver `groups` más abajo).
  const vendorIds = useMemo(() => new Set(vendors.map((v) => v.userId)), [vendors]);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    kpiApi.routeSummary({ year, month, user_id: userId ?? undefined })
      .then((data) => {
        setRows(managerId != null && userId == null ? data.filter((r) => vendorIds.has(r.userId)) : data);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [year, month, userId, managerId, vendorIds]);

  useEffect(() => { load(); }, [load]);

  const sortedRows = useMemo(() => sortRouteRows(rows, sort), [rows, sort]);

  const totals = useMemo(() => routeTotals(rows), [rows]);

  // Sin vendedor puntual seleccionado el endpoint puede traer rutas de varios TMRs: se
  // agrupan por dueño (orden y sorting por columna preservados dentro de cada grupo) para
  // no mostrar una tabla plana sin saber de quién es cada ruta. Con vendedor seleccionado
  // queda en null y la tabla se renderiza como antes (sin encabezados de grupo).
  const groups = useMemo<VendorGroup[] | null>(() => {
    if (userId != null) return null;
    const byUser = new Map<number, RouteSummaryRow[]>();
    for (const r of rows) {
      const list = byUser.get(r.userId);
      if (list) list.push(r);
      else byUser.set(r.userId, [r]);
    }
    const result: VendorGroup[] = [];
    for (const [uid, list] of byUser) {
      result.push({ userId: uid, userName: list[0].userName, rows: sortRouteRows(list, sort), totals: routeTotals(list) });
    }
    result.sort((a, b) => (a.userName ?? "").localeCompare(b.userName ?? ""));
    return result;
  }, [rows, userId, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      return { key, dir: COLUMNS.find((c) => c.key === key)?.defaultDir ?? "desc" };
    });
  };

  if (managerId != null && userId == null && vendors.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 flex flex-col items-center gap-3 text-center">
          <Users size={28} className="text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">Elegí un vendedor del territorio para ver sus rutas.</p>
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
            {groups ? (
              groups.map((g) => (
                <tbody key={g.userId}>
                  <tr
                    className="bg-muted/40 cursor-pointer hover:bg-muted/60"
                    onClick={() => onSelectUser(g.userId)}
                  >
                    <td colSpan={COLUMNS.length} className="py-2 px-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-foreground">{g.userName ?? `Usuario #${g.userId}`}</span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className="text-muted-foreground font-semibold">
                            {g.rows.length} ruta{g.rows.length === 1 ? "" : "s"}
                          </span>
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full font-semibold ${toneClasses[toneFor(g.totals.effectiveness)].pillBg} ${toneClasses[toneFor(g.totals.effectiveness)].pillText}`}
                          >
                            {formatPct(g.totals.effectiveness)}%
                          </span>
                        </span>
                      </div>
                    </td>
                  </tr>
                  {g.rows.map((r) => (
                    <RouteRow key={r.routeId} row={r} />
                  ))}
                </tbody>
              ))
            ) : (
              <tbody>
                {sortedRows.map((r) => (
                  <RouteRow key={r.routeId} row={r} />
                ))}
              </tbody>
            )}
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

function RouteRow({ row }: { row: RouteSummaryRow }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-2.5 font-medium text-foreground">{row.name}</td>
      <td className="py-2.5 text-center">{row.pdvs}</td>
      <td className="py-2.5 text-center">{row.planned}</td>
      <td className="py-2.5 text-center">{row.visited}</td>
      <td className="py-2.5">
        <EffectivenessCell value={row.effectiveness} />
      </td>
      <td className="py-2.5 text-center">{row.actions}</td>
      <td className="py-2.5 text-center">{row.withMaterial}</td>
      <td className="py-2.5 text-center">{row.sellsLoose}</td>
      <td className="py-2.5 text-center">{row.withExchange}</td>
    </tr>
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
