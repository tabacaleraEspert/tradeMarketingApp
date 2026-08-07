import { CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import type { SuspiciousPriceItem } from "@/lib/api";
import { formatDateCompact } from "../../lib/dateUtils";
import { formatPriceFull } from "./precios-utils";

interface Props {
  items: SuspiciousPriceItem[];
}

// Este listado no corrige nada solo: existe para que el TMR/admin revise el dato en
// origen (visita/relevamiento) — filter_price_outliers ya descartó estos precios del
// cálculo de la matriz por estar fuera de [0.25x, 4x] la mediana del producto.
export function PreciosSuspicious({ items }: Props) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-bold text-foreground inline-flex items-center gap-2">
              Precios sospechosos
              <Badge variant={items.length > 0 ? "destructive" : "secondary"}>{items.length}</Badge>
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Precios muy alejados de la mediana del producto (o de prueba), descartados de la matriz. Revisá el
              relevamiento en origen para corregirlo.
            </p>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6 flex items-center justify-center gap-1.5">
            <CheckCircle2 size={14} className="text-green-600" /> Sin precios sospechosos este mes
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 text-muted-foreground font-semibold">Fecha</th>
                  <th className="text-left py-2 text-muted-foreground font-semibold">Producto</th>
                  <th className="text-right py-2 text-muted-foreground font-semibold">Precio relevado</th>
                  <th className="text-right py-2 text-muted-foreground font-semibold">Mediana de referencia</th>
                  <th className="text-left py-2 text-muted-foreground font-semibold">PDV</th>
                  <th className="text-left py-2 text-muted-foreground font-semibold">Vendedor</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} className="border-b border-border last:border-0">
                    <td className="py-2.5 text-muted-foreground whitespace-nowrap">{formatDateCompact(item.date)}</td>
                    <td className="py-2.5 font-medium text-foreground">{item.productName}</td>
                    <td className="py-2.5 text-right font-semibold text-red-600">{formatPriceFull(item.price)}</td>
                    <td className="py-2.5 text-right text-muted-foreground">{formatPriceFull(item.medianPrice)}</td>
                    <td className="py-2.5">{item.pdvName ?? `PDV #${item.pdvId}`}</td>
                    <td className="py-2.5">{item.userName ?? `Usuario #${item.userId}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
