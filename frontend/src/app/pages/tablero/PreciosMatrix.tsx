import type { PriceMatrixItem } from "@/lib/api";
import { buildPriceMatrix, formatPriceFull } from "./precios-utils";

interface Props {
  items: PriceMatrixItem[];
}

// Contenedor con scroll horizontal propio (la página no debe scrollear horizontal) y
// primera columna (producto) sticky para no perder la referencia al desplazarse.
export function PreciosMatrix({ items }: Props) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        Sin precios relevados para el período seleccionado.
      </p>
    );
  }

  const { productList, groupList, cellFor } = buildPriceMatrix(items);

  return (
    <div className="overflow-x-auto border border-border rounded-md">
      <table className="text-xs border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="sticky left-0 z-10 bg-card text-left py-2 px-3 text-muted-foreground font-semibold whitespace-nowrap">
              Producto
            </th>
            {groupList.map((g) => (
              <th key={g.id} className="text-center py-2 px-3 text-muted-foreground font-semibold whitespace-nowrap">
                {g.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {productList.map((p) => (
            <tr key={p.id} className="border-b border-border last:border-0">
              <td className="sticky left-0 z-10 bg-card py-2 px-3 font-medium text-foreground whitespace-nowrap">
                {p.name}
              </td>
              {groupList.map((g) => {
                const cell = cellFor(p.id, g.id);
                return (
                  <td key={g.id} className="text-center py-2 px-3 whitespace-nowrap">
                    {cell ? (
                      <span title={`Mín: ${formatPriceFull(cell.min)} · Máx: ${formatPriceFull(cell.max)} · n=${cell.n}`}>
                        {formatPriceFull(cell.avg)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
