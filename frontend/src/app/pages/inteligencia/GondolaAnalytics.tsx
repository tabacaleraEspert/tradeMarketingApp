import { Card, CardContent } from "../../components/ui/card";
import type { IntelOverview, IntelZona } from "@/lib/api";
import { SkuName } from "./SkuName";

const nf = (n: number) => n.toLocaleString("es-AR");

/** Slide "Familias y embudo": presencia por marca propia + el embudo Milenio
 * (cuánto se pierde de la variante base a cada extensión). */
export function GondolaFamilias({ overview }: { overview: IntelOverview }) {
  const familias = overview.gondola?.familias ?? [];
  const maxFam = Math.max(1, ...familias.map((f) => f.pct));

  const milenio = overview.portfolio
    .filter((p) => p.producto.startsWith("Milenio"))
    .sort((a, b) => b.pct - a.pct);
  const maxMilenio = Math.max(1, ...milenio.map((p) => p.pct));

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card>
        <CardContent className="p-4">
          <h3 className="font-bold text-foreground text-sm mb-1">¿Qué marca nuestra llega a más puntos?</h3>
          <p className="text-xs text-muted-foreground mb-3">
            % de PDVs censados con al menos un SKU de la marca, profundidad y precio promedio.
          </p>
          <div className="space-y-2.5">
            {familias.map((f) => (
              <div key={f.marca}>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="font-semibold text-foreground">{f.marca}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {nf(f.pdvs)} PDVs · <span className="font-semibold text-foreground">{f.pct}%</span>
                  </span>
                </div>
                <div className="h-3 bg-muted rounded overflow-hidden">
                  <div className="h-full bg-espert-gold rounded" style={{ width: `${(f.pct / maxFam) * 100}%` }} />
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                  {f.skusActivos} SKUs activos · {f.skusPromPorPdv} por PDV
                  {f.precioProm != null && <> · ${nf(f.precioProm)} prom.</>}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h3 className="font-bold text-foreground text-sm mb-1">El embudo Milenio</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Red abre la puerta; cada variante muestra cuántos puntos quedan en el camino.
          </p>
          <div className="space-y-1.5">
            {milenio.map((p, i) => {
              const drop = i > 0 ? p.pct - milenio[i - 1].pct : 0;
              return (
                <div key={p.producto} className="flex items-center gap-2 text-xs">
                  <span className="w-16 shrink-0"><SkuName name={p.producto} /></span>
                  <div className="flex-1 h-5 bg-muted rounded overflow-hidden">
                    <div
                      className="h-full rounded bg-espert-gold flex items-center justify-end pr-1.5"
                      style={{ width: `${(p.pct / maxMilenio) * 100}%`, opacity: 0.45 + 0.55 * (p.pct / maxMilenio) }}
                    >
                      <span className="text-[10px] font-bold text-white tabular-nums">{p.pct.toFixed(0)}%</span>
                    </div>
                  </div>
                  <span className="w-14 text-right tabular-nums text-[10px] text-muted-foreground shrink-0">
                    {i > 0 ? `${drop.toFixed(0)}pp` : `${nf(p.pdvs)} PDVs`}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            pp = puntos de presencia que pierde respecto de la variante anterior. Cada punto con Red
            y sin la variante es una oportunidad de extensión (ver Oportunidades).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/** Slide "Rivales y brechas": contra quién juega cada SKU (por precio) y dónde
 * le falta viajar (mayor brecha entre su mejor y peor zona). */
export function GondolaRivales({ overview, zonas }: { overview: IntelOverview; zonas: IntelZona[] }) {
  const rivales = (overview.gondola?.rivales ?? []).slice(0, 8);

  // Zonas con censo confiable para medir brechas.
  const zonasOk = new Set(zonas.filter((z) => z.censados >= 30).map((z) => z.zona));
  const brechas = overview.portfolio
    .filter((p) => p.pct >= 10)
    .map((p) => {
      const pares = Object.entries(p.porZona).filter(([z]) => zonasOk.has(z));
      if (pares.length < 2) return null;
      const mejor = pares.reduce((a, b) => (b[1] > a[1] ? b : a));
      const peor = pares.reduce((a, b) => (b[1] < a[1] ? b : a));
      return { producto: p.producto, mejor, peor, brecha: mejor[1] - peor[1] };
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => b.brecha - a.brecha)
    .slice(0, 6);

  return (
    <div className="grid lg:grid-cols-[1.3fr_1fr] gap-4">
      <Card>
        <CardContent className="p-4">
          <h3 className="font-bold text-foreground text-sm mb-1">¿Contra quién juega cada SKU?</h3>
          <p className="text-xs text-muted-foreground mb-3">
            El % es la <strong>presencia</strong>: en cuántos de los PDVs censados está el producto.
            Al lado, la mediana de precio. Los rivales son los 3 de la competencia con precio más
            parecido — si el rival está en más puntos al mismo precio, la pelea es ejecución.
          </p>
          <div className="space-y-3">
            {rivales.map((r) => (
              <div key={r.sku} className="border-b border-border/50 pb-2 last:border-0">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-sm"><SkuName name={r.sku} /></span>
                  <span className="tabular-nums">
                    <span className="font-bold text-espert-gold">{r.pct.toFixed(0)}%</span>
                    <span className="text-muted-foreground"> · ${nf(r.precio)}</span>
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                  {r.rivales.map((rv) => (
                    <span key={rv.producto} className="text-[11px] text-muted-foreground tabular-nums">
                      vs <span className="text-foreground font-medium">{rv.producto}</span>{" "}
                      ({rv.fabricante}) {rv.pct.toFixed(0)}% · ${nf(rv.precio)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h3 className="font-bold text-foreground text-sm mb-1">¿Dónde le falta viajar?</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Mayor brecha entre la mejor y la peor zona de cada SKU (zonas con censo ≥30). La brecha
            es presencia que ya probamos que el producto puede tener.
          </p>
          <div className="space-y-2.5">
            {brechas.map((b) => (
              <div key={b.producto} className="text-xs">
                <div className="flex justify-between mb-0.5">
                  <span><SkuName name={b.producto} /></span>
                  <span className="font-bold text-espert-gold tabular-nums">{b.brecha.toFixed(0)}pp</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">
                  <span className="text-green-600 dark:text-green-400">{b.mejor[0]} {b.mejor[1].toFixed(0)}%</span>
                  <div className="flex-1 h-1.5 bg-muted rounded overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-green-500 to-red-500 rounded" style={{ width: "100%" }} />
                  </div>
                  <span className="text-red-600 dark:text-red-400">{b.peor[0]} {b.peor[1].toFixed(0)}%</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
