import { useMemo, useState } from "react";

export type SortDir = "asc" | "desc";
export type SortValue = string | number | null | undefined;
export type SortState<K extends string> = { key: K; dir: SortDir };

/**
 * Ordena por `get`. Los vacíos (null / NaN) van siempre al final, en cualquier
 * dirección: un "—" no es ni el mejor ni el peor. Texto en orden alfabético
 * español, sin distinguir mayúsculas ni acentos. Orden estable.
 */
export function sortRows<T>(rows: readonly T[], get: (row: T) => SortValue, dir: SortDir): T[] {
  const empty = (v: SortValue) => v == null || v === "" || (typeof v === "number" && !Number.isFinite(v));
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    const ea = empty(va);
    const eb = empty(vb);
    if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
    if (typeof va === "number" && typeof vb === "number") return sign * (va - vb);
    return sign * String(va).localeCompare(String(vb), "es", { sensitivity: "base", numeric: true });
  });
}

/**
 * Estado de orden de una tabla. Al tocar una columna nueva, los números
 * arrancan de mayor a menor y el texto de la A a la Z; tocarla de nuevo invierte.
 */
export function useSort<T, K extends string>(
  rows: readonly T[],
  columns: Record<K, (row: T) => SortValue>,
  initial: SortState<K>,
) {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const sorted = useMemo(
    () => sortRows(rows, columns[sort.key], sort.dir),
    // `columns` es un literal estable por tabla: no hace falta en las deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, sort],
  );
  const toggle = (key: K) =>
    setSort((s) => {
      if (s.key === key) return { key, dir: s.dir === "asc" ? "desc" : "asc" };
      const sample = rows.map(columns[key]).find((v) => v != null && v !== "");
      return { key, dir: typeof sample === "string" ? "asc" : "desc" };
    });
  return { sorted, sort, toggle };
}
