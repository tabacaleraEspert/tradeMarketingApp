/** Formatos es-AR compartidos por el chat y la página de uso. */

/** 3200 → "3,2 s" */
export function fmtSeconds(ms: number): string {
  return `${(ms / 1000).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
}

/** 0.004 → "US$ 0,004". Por defecto 3 decimales: una consulta cuesta milésimas de dólar. */
export function fmtUsd(usd: number, decimals = 3): string {
  return `US$ ${usd.toLocaleString("es-AR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

/** Pie de una respuesta terminada: "3,2 s · US$ 0,004" */
export function fmtAnswerFooter(durationMs: number, costUsd: number): string {
  return `${fmtSeconds(durationMs)} · ${fmtUsd(costUsd)}`;
}
