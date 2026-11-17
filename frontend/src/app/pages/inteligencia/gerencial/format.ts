export const DASH = "—";

/** Entero con separador de miles es-AR ("10.363"); null → "—". */
export function nf(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return Math.round(n).toLocaleString("es-AR");
}

/** Número con hasta un decimal es-AR ("9,8"); null → "—". */
export function dec1(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return n.toLocaleString("es-AR", { maximumFractionDigits: 1 });
}

/** Porcentaje 0–100 con hasta un decimal ("47%", "17,2%"); null → "—". */
export function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return `${dec1(n)}%`;
}

/** a sobre b como porcentaje 0–100 con un decimal; null si b es 0. */
export function ratioPct(a: number, b: number): number | null {
  if (!b) return null;
  return Math.round((a / b) * 1000) / 10;
}
