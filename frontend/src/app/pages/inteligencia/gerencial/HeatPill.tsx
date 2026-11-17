import type { HeatBand } from "./heat";
import { DASH } from "./format";

const BAND_CLS: Record<HeatBand, string> = {
  alto: "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300",
  medio: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  bajo: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
};

const PILL = "inline-block min-w-[2.75rem] rounded-full px-2 py-0.5 text-center text-[11px] font-semibold tabular-nums";

/** Valor de una celda con el color de su tercil; "—" (sin color) si no hay dato. */
export function HeatPill({ text, band }: { text: string; band: HeatBand | null }) {
  if (text === DASH) return <span className="text-muted-foreground">{DASH}</span>;
  if (!band) return <span className="tabular-nums">{text}</span>;
  return <span className={`${PILL} ${BAND_CLS[band]}`}>{text}</span>;
}

export function HeatLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>Color: compara a los TM Reps del filtro dentro de cada columna.</span>
      <span className={`${PILL} ${BAND_CLS.alto}`}>tercio superior</span>
      <span className={`${PILL} ${BAND_CLS.medio}`}>tercio medio</span>
      <span className={`${PILL} ${BAND_CLS.bajo}`}>tercio inferior</span>
    </p>
  );
}
