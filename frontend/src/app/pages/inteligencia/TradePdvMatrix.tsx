import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, RefreshCw, X } from "lucide-react";
import { intelligenceApi, type TmrPdvRow } from "@/lib/api";
import { useIntelNav } from "./nav-context";
import { DEFAULT_PERIOD, periodParams, type TmrPeriod } from "./PeriodFilter";

/** "Milenio Icergy" → "M.ICERGY", "Melbourne Aura" → "MELB.A", como el Tablero TMR. */
function shortSku(name: string): string {
  const rules: Array<[string, (rest: string) => string]> = [
    ["Milenio ", (r) => `M.${r.toUpperCase()}`],
    ["Melbourne ", (r) => `MELB.${r[0]?.toUpperCase() ?? ""}`],
    ["Mill ", (r) => `MILL ${r[0]?.toUpperCase() ?? ""}`],
    ["Van Kiff ", (r) => `VK.${r[0]?.toUpperCase() ?? ""}`],
    ["Bold ", (r) => `BOLD ${r[0]?.toUpperCase() ?? ""}.`],
  ];
  for (const [prefix, fmt] of rules) {
    if (name.startsWith(prefix)) return fmt(name.slice(prefix.length));
  }
  return name.toUpperCase();
}

type Filtro = "todos" | "visitados" | "sin_visitar";

const BRANDS = ["Milenio", "Melbourne", "Mill", "Bold", "Van Kiff", "Lebonn", "Blank", "Dito", "Fleek"];

function brandOf(name: string): string {
  return BRANDS.find((b) => name.startsWith(b)) ?? "Otros";
}

/**
 * La matriz producto x PDV del Tablero TMR, por vendedor: una fila por PDV de
 * sus rutas foco, una columna por SKU Espert (verde trabaja / rojo no / gris
 * sin relevar), agrupada por ruta. Se monta recién al abrir el detalle del
 * trade — es el fetch caro del tablero.
 */
interface TradePdvMatrixProps {
  userId: number;
  title?: string;
  /** Muestra solo esa ruta, abierta y sin cabecera de grupo (página de ruta). */
  fixedRuta?: string;
  /** Ventana de datos (filtro de período); default: mes en curso. */
  period?: TmrPeriod;
  /** Click en el nombre de una ruta → navegar a su página. */
  onRutaClick?: (ruta: string) => void;
}

export function TradePdvMatrix({ userId, title, fixedRuta, period = DEFAULT_PERIOD, onRutaClick }: TradePdvMatrixProps) {
  const [rows, setRows] = useState<TmrPdvRow[] | null>(null);
  const [prods, setProds] = useState<string[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("visitados");
  const [full, setFull] = useState(false);
  // Marcas ocultas: sacar/poner las columnas de una marca con un click.
  const [hiddenBrands, setHiddenBrands] = useState<Set<string>>(new Set());
  // Orden por columna: "vis" o el índice del SKU (✓ > ✗ > sin relevar).
  const [sort, setSort] = useState<{ col: number | "vis"; asc: boolean } | null>(null);
  const toggleSort = (col: number | "vis") =>
    setSort((prev) => (prev?.col === col ? { col, asc: !prev.asc } : { col, asc: false }));

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const load = useCallback(() => {
    setError(false);
    setLoading(true);
    intelligenceApi
      .tmrPdvs({ ...periodParams(period), user_id: userId })
      .then((resp) => {
        setRows(Object.values(resp.tmr_pdvs)[0] ?? []);
        setProds(resp.espert_prods);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [userId, period]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    let base = fixedRuta ? rows.filter((r) => r.ruta === fixedRuta) : rows;
    if (filtro === "visitados") base = base.filter((r) => r.vis > 0);
    if (filtro === "sin_visitar") base = base.filter((r) => r.vis === 0);
    return base;
  }, [rows, filtro, fixedRuta]);

  const porRuta = useMemo(() => {
    const map = new Map<string, TmrPdvRow[]>();
    for (const r of filtered) map.set(r.ruta, [...(map.get(r.ruta) ?? []), r]);
    return [...map.entries()];
  }, [filtered]);

  const brandsPresent = useMemo(
    () => [...new Set(prods.map(brandOf))].sort((a, b) => BRANDS.indexOf(a) - BRANDS.indexOf(b)),
    [prods]
  );
  // Columnas visibles con su índice original (pr[] se indexa contra prods).
  const visibleCols = useMemo(
    () =>
      prods
        .map((name, idx) => ({ name, idx }))
        .filter((c) => !hiddenBrands.has(brandOf(c.name))),
    [prods, hiddenBrands]
  );
  const toggleBrand = (b: string) =>
    setHiddenBrands((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });

  if (error) {
    return (
      <div className="text-center py-4 space-y-2">
        <p className="text-xs text-muted-foreground">No se pudo cargar la matriz de PDVs.</p>
        <button onClick={load} className="inline-flex items-center gap-1.5 text-xs font-semibold text-espert-gold hover:underline">
          <RefreshCw size={12} /> Reintentar
        </button>
      </div>
    );
  }
  if (!rows) {
    return (
      <div className="flex items-center justify-center h-20">
        <div className="w-5 h-5 border-2 border-[#A48242] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const btn = (f: Filtro, label: string) => (
    <button
      onClick={() => setFiltro(f)}
      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
        filtro === f ? "bg-espert-gold text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"
      }`}
    >
      {label}
    </button>
  );

  const body = (
    <div className={full ? "flex-1 flex flex-col min-h-0" : ""}>
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        {btn("todos", "Todos los PDVs")}
        {btn("visitados", "Solo visitados")}
        {btn("sin_visitar", "Sin visitar")}
        <span className="text-[11px] text-muted-foreground ml-1">{filtered.length} PDVs</span>
        {loading && (
          <span className="w-3.5 h-3.5 border-2 border-espert-gold border-t-transparent rounded-full animate-spin" role="status" aria-label="Cargando" />
        )}
        <span className="text-[11px] text-muted-foreground ml-auto hidden sm:flex items-center gap-3">
          <span className="text-green-600 dark:text-green-400">✓ trabaja</span>
          <span className="text-red-500">✗ no trabaja</span>
          <span>— sin relevar</span>
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

      {/* Chips de marca: sacar/poner las columnas de una marca con un click */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Columnas:</span>
        {brandsPresent.map((b) => {
          const off = hiddenBrands.has(b);
          return (
            <button
              key={b}
              onClick={() => toggleBrand(b)}
              className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition-colors ${
                off
                  ? "bg-transparent border border-border text-muted-foreground/60 line-through"
                  : "bg-espert-gold/15 text-espert-gold"
              }`}
            >
              {b}
            </button>
          );
        })}
      </div>

      <div className={`overflow-x-auto overflow-y-auto border border-border rounded-lg transition-opacity ${loading ? "opacity-50 pointer-events-none" : ""} ${full ? "flex-1 min-h-0" : "max-h-[420px]"}`}>
        <table className="w-full text-[11px] tabular-nums">
          <thead className="sticky top-0 z-20 bg-card">
            <tr className="text-left text-[9px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="py-1.5 px-2 sticky left-0 bg-card z-10">PDV</th>
              <th className="py-1.5 px-2">Localidad</th>
              <th className="py-1.5 px-2">Canal</th>
              <th
                className={`py-1.5 px-1 text-center cursor-pointer hover:text-foreground ${sort?.col === "vis" ? "text-espert-gold" : ""}`}
                onClick={() => toggleSort("vis")}
                title="Ordenar por visitas"
              >
                Vis.{sort?.col === "vis" ? (sort.asc ? " ▲" : " ▼") : ""}
              </th>
              {visibleCols.map((c) => (
                <th
                  key={c.name}
                  className={`py-1.5 px-1 text-center whitespace-nowrap cursor-pointer hover:text-foreground ${sort?.col === c.idx ? "text-espert-gold" : ""}`}
                  title={`${c.name} — click para ordenar`}
                  onClick={() => toggleSort(c.idx)}
                >
                  {shortSku(c.name)}
                  {sort?.col === c.idx ? (sort.asc ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {porRuta.map(([ruta, pdvs]) => (
              <RutaGroup
                key={ruta}
                ruta={ruta}
                pdvs={pdvs}
                cols={visibleCols}
                sort={sort}
                sinCabecera={!!fixedRuta}
                onRutaClick={onRutaClick}
              />
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">Sin PDVs con este filtro.</p>
        )}
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
              <p className="text-[10px] font-semibold uppercase tracking-widest text-espert-gold">Matriz producto × PDV</p>
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

function RutaGroup({
  ruta, pdvs, cols, sort, sinCabecera, onRutaClick,
}: {
  ruta: string;
  pdvs: TmrPdvRow[];
  cols: Array<{ name: string; idx: number }>;
  sort: { col: number | "vis"; asc: boolean } | null;
  sinCabecera?: boolean;
  onRutaClick?: (ruta: string) => void;
}) {
  // Cerradas por default: primero el pantallazo de rutas, después el detalle.
  const [open, setOpen] = useState(!!sinCabecera);
  const { openPdv } = useIntelNav();

  // El orden aplica DENTRO de cada ruta (los grupos no se mezclan).
  const sorted = useMemo(() => {
    if (!sort) return pdvs;
    const val = (r: TmrPdvRow) =>
      sort.col === "vis" ? r.vis : (r.pr[sort.col] ?? -1); // ✓=1 > ✗=0 > sin relevar=-1
    return [...pdvs].sort((a, b) => (sort.asc ? val(a) - val(b) : val(b) - val(a)));
  }, [pdvs, sort]);

  return (
    <>
      {!sinCabecera && (
      <tr
        className="bg-muted/60 cursor-pointer hover:bg-muted"
        onClick={() => setOpen((v) => !v)}
      >
        <td colSpan={4 + cols.length} className="py-1.5 px-2 font-semibold text-foreground sticky left-0">
          <span className={`inline-block mr-1.5 transition-transform duration-200 ${open ? "" : "-rotate-90"}`}>▾</span>
          {onRutaClick ? (
            <button
              onClick={(e) => { e.stopPropagation(); onRutaClick(ruta); }}
              className="hover:text-espert-gold hover:underline transition-colors"
              title={`Ver la página de ${ruta}`}
            >
              {ruta}
            </button>
          ) : (
            ruta
          )}{" "}
          ({pdvs.length} PDVs)
        </td>
      </tr>
      )}
      {open &&
        sorted.map((r) => {
          const sinVisita = r.vis === 0;
          return (
            <tr key={`${ruta}-${r.n}-${r.loc}`} className={`border-b border-border/40 hover:bg-muted/30 ${sinVisita ? "opacity-50" : ""}`}>
              <td className="py-1 px-2 whitespace-nowrap max-w-[160px] truncate font-medium text-foreground sticky left-0 bg-card">
                {r.id != null ? (
                  <button
                    onClick={() => openPdv(r.id!)}
                    className="hover:text-espert-gold hover:underline transition-colors truncate max-w-full"
                    title={`Ver la ficha de ${r.n}`}
                  >
                    {r.n}
                  </button>
                ) : (
                  r.n
                )}
              </td>
              <td className="py-1 px-2 whitespace-nowrap max-w-[140px] truncate text-muted-foreground">{r.loc}</td>
              <td className="py-1 px-2 whitespace-nowrap text-muted-foreground">{r.canal}</td>
              <td className="py-1 px-1 text-center font-semibold text-foreground">{r.vis || "—"}</td>
              {cols.map(({ name, idx }) => {
                const v = r.pr[idx];
                return (
                <td key={name} className="py-1 px-1 text-center">
                  {v === 1 ? (
                    <span className="text-green-600 dark:text-green-400 font-bold">✓</span>
                  ) : v === 0 ? (
                    <span className="text-red-500 font-bold">✗</span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
                );
              })}
            </tr>
          );
        })}
    </>
  );
}
