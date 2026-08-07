// Helpers compartidos por PreciosTab y sus subcomponentes (matriz de precios).
import type { PriceMatrixItem } from "@/lib/api";

// Formato completo es-AR, NUNCA abreviado ("$ 4.300", no "4k" — pedido explícito del cliente).
const CURRENCY_FORMATTER = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export function formatPriceFull(value: number): string {
  return CURRENCY_FORMATTER.format(value);
}

export interface MatrixAxisItem {
  id: number;
  name: string;
}

export interface PriceCell {
  avg: number;
  min: number;
  max: number;
  n: number;
}

export interface PriceMatrix {
  productList: MatrixAxisItem[];
  groupList: MatrixAxisItem[];
  cellFor: (productId: number, groupId: number) => PriceCell | undefined;
}

// Filas = productos, columnas = grupos (rutas o vendedores), ambos en orden alfabético.
export function buildPriceMatrix(items: PriceMatrixItem[]): PriceMatrix {
  const products = new Map<number, string>();
  const groups = new Map<number, string>();
  const cells = new Map<string, PriceCell>();

  for (const item of items) {
    products.set(item.productId, item.productName);
    groups.set(item.groupId, item.groupName);
    cells.set(`${item.productId}:${item.groupId}`, {
      avg: item.avg,
      min: item.min,
      max: item.max,
      n: item.n,
    });
  }

  const sortByName = (a: MatrixAxisItem, b: MatrixAxisItem) => a.name.localeCompare(b.name);
  const productList = [...products.entries()].map(([id, name]) => ({ id, name })).sort(sortByName);
  const groupList = [...groups.entries()].map(([id, name]) => ({ id, name })).sort(sortByName);

  return {
    productList,
    groupList,
    cellFor: (productId, groupId) => cells.get(`${productId}:${groupId}`),
  };
}
