import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Maximize2, RefreshCw, X } from "lucide-react";
import { intelligenceApi, type TmrRutaRow, type TmrCatalogResponse } from "@/lib/api";
import { DEFAULT_PERIOD, periodParams, type TmrPeriod } from "./PeriodFilter";

const nf = (n: number) => n.toLocaleString("es-AR");

type Modo = "precio" | "cobertura";

/**
 * "Cobertura por Marca y Ruta" del Tablero TMR, por vendedor: filas = productos
 * agrupados por fabricante (grupos colapsables), columnas = sus rutas foco.
 * Modo precio (promedio relevado en la ruta) o cobertura (% de PDVs que lo
 * trabajan). Filtro por fabricante, y los productos sin dato se ocultan.
 */
export function TradeRutaMatrix({ userId, title, period = DEFAULT_PERIOD }: { userId: number; title?: string; period?: TmrPeriod }) {
  const [rutas, setRutas] = useState<TmrRutaRow[] | null>(null);
  const [catalog, setCatalog] = useState<TmrCatalogResponse | null>(null);
  const [error, setError] = useState(false);
  const [modo, setModo] = useState<Modo>("precio");
  const [fabFilter, setFabFilter] = useState<string>("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [full, setFull] = useState(false);
  // Rutas ocultas (chips) y orden por columna de ruta (según el modo activo).
  const [hiddenRutas, setHiddenRutas] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ ruta: string; asc: boolean } | null>(null);
  const toggleSort = (ruta: string) =>
    setSort((prev) => (prev?.ruta === ruta ? { ruta, asc: !prev.asc } : { ruta, asc: false }));
  const toggleRuta = (nombre: string) =>
    setHiddenRutas((prev) => {
      const next = new Set(prev);
      if (next.has(nombre)) next.delete(nombre);
      else next.add(nombre);
      return next;
    });

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const load = useCallback(() => {
    setError(false);
    const params = periodParams(period);
    Promise.all([
      intelligenceApi.tmrRoutes({ ...params, user_id: userId }),
      intelligenceApi.tmrCatalog(params),
    ])
      .then(([r, c]) => {
        setRutas(r.rutas);
        setCatalog(c);
      })
      .catch(() => setError(true));
  }, [userId, period]);
  useEffect(() => { load(); }, [load]);

  const cols = useMemo(
    () =>
      rutas
        ? [...rutas].sort((a, b) => b.pdvs - a.pdvs).filter((r) => !hiddenRutas.has(r.nombre))
        : [],
    [rutas, hiddenRutas]
  );
  const allRutas = useMemo(
    () => (rutas ? [...rutas].sort((a, b) => b.pdvs - a.pdvs) : []),
    [rutas]
  );

  // Fabricante → productos CON algún dato en alguna ruta de este trade.
  const grupos = useMemo(() => {
    if (!catalog || !rutas) return [];
    const hasData = (prod: string) =>
      rutas.some((r) => (r.prod_cob?.[prod] ?? 0) > 0 || r.precios_ruta?.[prod]);
    return Object.entries(catalog.prod_fab_groups)
      .map(([fab, prods]) => ({ fab, prods: prods.filter(hasData) }))
      .filter((g) => g.prods.length > 0)
      .sort((a, b) => (a.fab === "Espert" ? -1 : b.fab === "Espert" ? 1 : b.prods.length - a.prods.length));
  }, [catalog, rutas]);

  const visibles = fabFilter ? grupos.filter((g) => g.fab === fabFilter) : grupos;

  const toggle = (fab: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(fab)) next.delete(fab);
      else next.add(fab);
      return next;
    });

  if (error) {
    return (
      <div className="text-center py-4 space-y-2">
        <p className="text-xs text-muted-foreground">No se pudo cargar la matriz de rutas.</p>
        <button onClick={load} className="inline-flex items-center gap-1.5 text-xs font-semibold text-espert-gold hover:underline">
          <RefreshCw size={12} /> Reintentar
        </button>
      </div>
    );
  }
  if (!rutas || !catalog) {
    return (
      <div className="flex items-center justify-center h-20">
        <div className="w-5 h-5 border-2 border-[#A48242] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (cols.length === 0) {
    return <p className="text-xs text-muted-foreground py-3">Sin rutas foco activas este mes.</p>;
  }

  const modeBtn = (m: Modo, label: string) => (
    <button
      onClick={() => setModo(m)}
      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
        modo === m ? "bg-espert-gold text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"
      }`}
    >
      {label}
    </button>
  );

  const body = (
    <div className={full ? "flex-1 flex flex-col min-h-0" : ""}>
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        {modeBtn("precio", "Precio promedio")}
        {modeBtn("cobertura", "Cobertura %")}
        <select
          value={fabFilter}
          onChange={(e) => setFabFilter(e.target.value)}
          className="border border-border rounded-md bg-background text-foreground text-[11px] px-2 py-1 ml-1"
        >
          <option value="">Todas las marcas</option>
          {grupos.map((g) => (
            <option key={g.fab} value={g.fab}>{g.fab}</option>
          ))}
        </select>
        <span className="text-[11px] text-muted-foreground ml-auto">
          {modo === "precio" ? "precio promedio relevado en la ruta" : "% de PDVs de la ruta que lo trabajan"}
        </span>
        {!full && (
          <button
            onClick={() => setFull(true)}
            title="Ampliar"
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Maximize2 size={14} />
          </button>
        )}
      </div>

      {/* Chips de rutas: sacar/poner columnas con un click */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Rutas:</span>
        {allRutas.map((r) => {
          const off = hiddenRutas.has(r.nombre);
          return (
            <button
              key={r.nombre}
              onClick={() => toggleRuta(r.nombre)}
              className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition-colors ${
                off
                  ? "bg-transparent border border-border text-muted-foreground/60 line-through"
                  : "bg-espert-gold/15 text-espert-gold"
              }`}
            >
              {r.nombre}
            </button>
          );
        })}
      </div>

      <div className={`overflow-x-auto overflow-y-auto border border-border rounded-lg ${full ? "flex-1 min-h-0" : "max-h-[420px]"}`}>
        <table className="w-full text-[11px] tabular-nums">
          <thead className="sticky top-0 z-20 bg-card">
            <tr className="text-left text-[9px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="py-1.5 px-2 sticky left-0 bg-card z-10">Producto</th>
              {cols.map((r) => (
                <th
                  key={r.nombre}
                  className={`py-1.5 px-1.5 text-center whitespace-nowrap cursor-pointer hover:text-foreground ${sort?.ruta === r.nombre ? "text-espert-gold" : ""}`}
                  title={`${r.nombre} — click para ordenar por esta ruta`}
                  onClick={() => toggleSort(r.nombre)}
                >
                  {r.nombre}
                  {sort?.ruta === r.nombre ? (sort.asc ? " ▲" : " ▼") : ""}
                  <span className="block normal-case font-normal">{r.pdvs} PDVs</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibles.map((g) => {
              const closed = collapsed.has(g.fab);
              return (
                <GrupoFab
                  key={g.fab}
                  fab={g.fab}
                  prods={g.prods}
                  cols={cols}
                  modo={modo}
                  closed={closed}
                  sort={sort}
                  onToggle={() => toggle(g.fab)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (full) {
    return createPortal(
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        onClick={() => setFull(false)}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-[92vw] h-[90vh] rounded-xl border border-border bg-card shadow-2xl p-4 lg:p-5 flex flex-col"
        >
          <div className="flex items-center justify-between mb-3 shrink-0">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-espert-gold">Cobertura por marca y ruta</p>
              {title && <h3 className="text-lg font-bold text-foreground">{title}</h3>}
            </div>
            <button
              onClick={() => setFull(false)}
              aria-label="Cerrar"
              className="p-2 rounded-full text-muted-foreground hover:bg-muted transition-colors"
            >
              <X size={20} />
            </button>
          </div>
          {body}
        </div>
      </div>,
      document.body
    );
  }
  return body;
}

function GrupoFab({
  fab, prods, cols, modo, closed, sort, onToggle,
}: {
  fab: string;
  prods: string[];
  cols: TmrRutaRow[];
  modo: Modo;
  closed: boolean;
  sort: { ruta: string; asc: boolean } | null;
  onToggle: () => void;
}) {
  // Orden por la columna elegida, según el modo activo, DENTRO del grupo.
  const sorted = useMemo(() => {
    if (!sort) return prods;
    const r = cols.find((c) => c.nombre === sort.ruta);
    if (!r) return prods;
    const val = (prod: string) =>
      modo === "precio" ? r.precios_ruta?.[prod]?.avg ?? -1 : r.prod_cob?.[prod] ?? -1;
    return [...prods].sort((a, b) => (sort.asc ? val(a) - val(b) : val(b) - val(a)));
  }, [prods, cols, sort, modo]);

  return (
    <>
      <tr className="bg-muted/60 cursor-pointer hover:bg-muted" onClick={onToggle}>
        <td colSpan={1 + cols.length} className="py-1.5 px-2 sticky left-0">
          <span className={`font-semibold ${fab === "Espert" ? "text-espert-gold" : "text-foreground"}`}>
            <ChevronDown
              size={12}
              className={`inline mr-1 transition-transform duration-200 ${closed ? "-rotate-90" : ""}`}
            />
            {fab} ({prods.length})
          </span>
        </td>
      </tr>
      {!closed &&
        sorted.map((prod) => (
          <tr key={prod} className="border-b border-border/40 hover:bg-muted/30">
            <td className="py-1 px-2 whitespace-nowrap max-w-[150px] truncate font-medium text-foreground sticky left-0 bg-card">
              {prod}
            </td>
            {cols.map((r) => {
              const cob = r.prod_cob?.[prod];
              const precio = r.precios_ruta?.[prod];
              let contenido: React.ReactNode = <span className="text-muted-foreground/40">—</span>;
              if (modo === "precio" && precio) {
                contenido = (
                  <span className="font-semibold text-foreground" title={`n=${precio.n} · min $${nf(precio.min)} · max $${nf(precio.max)}`}>
                    ${nf(precio.avg)}
                  </span>
                );
              } else if (modo === "cobertura" && cob) {
                const alpha = Math.min(0.85, Math.max(0.08, cob / 110));
                contenido = (
                  <span
                    className="inline-block min-w-[38px] rounded px-1 py-0.5 font-semibold"
                    style={{ background: `rgba(235, 104, 52, ${alpha})`, color: alpha > 0.5 ? "#fff" : undefined }}
                  >
                    {cob}%
                  </span>
                );
              }
              return (
                <td key={r.nombre} className="py-1 px-1.5 text-center">
                  {contenido}
                </td>
              );
            })}
          </tr>
        ))}
    </>
  );
}
