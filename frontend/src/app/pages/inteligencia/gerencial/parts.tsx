import type { KeyboardEvent, ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { SortState } from "./sort";
import { Card } from "../../../components/ui/card";

/** Tarjeta de indicador: etiqueta, número grande, barra fina opcional y bajada. */
export function StatCard({
  label,
  value,
  sub,
  barPct,
  valueClassName = "",
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  /** 0–100; si viene, dibuja la barra fina bajo el número. */
  barPct?: number | null;
  valueClassName?: string;
}) {
  return (
    <Card className="gap-0 p-4 min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums text-foreground ${valueClassName}`}>{value}</p>
      {barPct != null && <MiniBar pct={barPct} className="mt-2" />}
      {sub && <p className="mt-1.5 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

export function MiniBar({ pct, className = "" }: { pct: number; className?: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className={`h-1 rounded-full bg-muted overflow-hidden ${className}`}>
      <div className="h-full rounded-full bg-espert-gold" style={{ width: `${w}%` }} />
    </div>
  );
}

export function SectionTitle({ title, context }: { title: string; context: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 className="text-sm font-bold uppercase tracking-widest text-foreground shrink-0">{title}</h2>
      <div className="hidden sm:block flex-1 h-px bg-border" />
      <span className="text-xs text-muted-foreground">{context}</span>
    </div>
  );
}

/** Tarjeta con título + bajada y una tabla que scrollea horizontal adentro. */
export function TableCard({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card className="gap-0 min-w-0">
      <div className="px-4 pt-4 pb-2">
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {/* contain: la tabla scrollea adentro y no ensancha el <main> del layout
          (que es un flex item sin min-w-0) en pantallas angostas. */}
      <div className="overflow-x-auto pb-1 [contain:inline-size]">{children}</div>
    </Card>
  );
}

export const TH = "px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap";
export const TD = "px-3 py-2 whitespace-nowrap";
export const ROW_CLICK = "border-t border-border/60 cursor-pointer hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-espert-gold";

/** Hace que una fila <tr> clickeable también responda a Enter / barra espaciadora. */
export function rowKeyHandler(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}

/** Encabezado de columna que ordena la tabla al tocarlo. */
export function SortTH<K extends string>({
  label,
  col,
  sort,
  onSort,
  align = "right",
}: {
  label: string;
  col: K;
  sort: SortState<K>;
  onSort: (col: K) => void;
  align?: "left" | "right" | "center";
}) {
  const active = sort.key === col;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  const justify = align === "left" ? "justify-start" : align === "center" ? "justify-center" : "justify-end";
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={`${TH} !p-0`}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        title={`Ordenar por ${label}`}
        className={`flex w-full items-center gap-1 px-3 py-2 text-[10px] whitespace-nowrap uppercase tracking-wider font-semibold hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-espert-gold ${justify} ${active ? "text-foreground" : ""}`}
      >
        {label}
        <Icon size={11} className={active ? "text-espert-gold" : "opacity-40"} aria-hidden />
      </button>
    </th>
  );
}
