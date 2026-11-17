export type HeatBand = "alto" | "medio" | "bajo";

/**
 * Banda de color de cada valor comparado contra el resto de la columna, por
 * terciles (tercio superior / medio / inferior).
 *
 * - Los null quedan en null (sin color).
 * - Los empates comparten banda: la posición de un valor es el punto medio de
 *   su grupo de empatados, así que todos caen en el mismo tercio.
 * - Con menos de 3 valores no nulos no hay con qué comparar: todo null.
 * - `invert`: para métricas donde menos es mejor (el más bajo pasa a "alto").
 */
export function terciles(
  values: (number | null)[],
  opts?: { invert?: boolean },
): (HeatBand | null)[] {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  const n = nums.length;
  if (n < 3) return values.map(() => null);

  return values.map((v) => {
    if (v == null || !Number.isFinite(v)) return null;
    let less = 0;
    let equal = 0;
    for (const x of nums) {
      if (x < v) less++;
      else if (x === v) equal++;
    }
    // Posición relativa p = (less + equal/2) / n, comparada contra 1/3 y 2/3
    // en enteros para no depender del redondeo de punto flotante.
    const pos = 3 * (2 * less + equal);
    let band: HeatBand = pos < 2 * n ? "bajo" : pos < 4 * n ? "medio" : "alto";
    if (opts?.invert && band !== "medio") band = band === "alto" ? "bajo" : "alto";
    return band;
  });
}
