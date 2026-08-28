import { useMemo, useState } from "react";
import { HelpCircle } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import type { IntelPortfolioRow, IntelZona } from "@/lib/api";
import { ZonaDetailModal, type ZonaDetailOrigin, type ZonaDetailVariant } from "./ZonaDetailModal";

const nf = (n: number) => n.toLocaleString("es-AR");

function coberturaBarColor(pct: number): string {
  if (pct >= 85) return "bg-green-500";
  if (pct >= 60) return "bg-amber-400";
  return "bg-red-500";
}

function coberturaTextColor(pct: number): string {
  if (pct >= 85) return "text-green-600 dark:text-green-400";
  if (pct >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

type SortKey = "zona" | "censado" | "cobertura" | "skus" | "ritmo";

const SORT_VALUE: Record<SortKey, (z: IntelZona) => number | string> = {
  zona: (z) => z.zona,
  censado: (z) => (z.pdvs ? z.censados / z.pdvs : 0),
  cobertura: (z) => z.cobertura,
  skus: (z) => z.skusPromEspert,
  ritmo: (z) => z.visitas30d,
};

const HELP = {
  profundidad:
    "SKUs Espert promedio por PDV, contando solo los PDVs de la zona que ya trabajan al menos un producto nuestro. Los puntos comparan contra la mejor zona.",
  ritmo:
    "Visitas cerradas en los últimos 30 días en PDVs de la zona, cuántos trades las hicieron y el promedio de cada uno.",
};

/**
 * Dos preguntas por zona, comparables de un vistazo:
 *   1. ¿Cuánto la conocemos?  → barra de avance del censo (censados / PDVs)
 *   2. ¿Qué tan bien estamos donde la conocemos?  → barra de cobertura Espert
 * Ordenable por cualquier encabezado; default: cobertura de mejor a peor.
 */
interface ZonasSectionProps {
  zonas: IntelZona[];
  portfolio: IntelPortfolioRow[];
  onZonaClick: (zona: IntelZona) => void;
}

export function ZonasSection({ zonas, portfolio, onZonaClick }: ZonasSectionProps) {
  const [sortKey, setSortKey] = useState<SortKey>("cobertura");
  const [sortAsc, setSortAsc] = useState(false);

  // Top SKUs Espert por zona (presencia %), para el modal de detalle.
  const topSkusPorZona = useMemo(() => {
    const map: Record<string, Array<{ producto: string; pct: number }>> = {};
    for (const z of zonas) {
      map[z.zona] = portfolio
        .map((p) => ({ producto: p.producto, pct: p.porZona[z.zona] ?? 0 }))
        .filter((p) => p.pct > 0)
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 8);
    }
    return map;
  }, [zonas, portfolio]);

  // Detalle: click en cualquier parte de la fila abre el modal, que anima
  // desde el punto exacto del click.
  const [detail, setDetail] = useState<{
    zona: IntelZona;
    origin: ZonaDetailOrigin;
    variant: ZonaDetailVariant;
  } | null>(null);
  const openDetail = (z: IntelZona, e: React.MouseEvent, variant: ZonaDetailVariant) => {
    setDetail({
      zona: z,
      variant,
      origin: {
        dx: e.clientX - window.innerWidth / 2,
        dy: e.clientY - window.innerHeight / 2,
      },
    });
  };

  const ordered = useMemo(() => {
    const val = SORT_VALUE[sortKey];
    return [...zonas].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sortAsc ? cmp : -cmp;
    });
  }, [zonas, sortKey, sortAsc]);

  const maxSkus = Math.max(1, ...zonas.map((z) => z.skusPromEspert));

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(key === "zona"); // texto: A→Z; métricas: de mayor a menor
    }
  };

  const Header = ({
    label,
    k,
    className = "",
    help,
  }: {
    label: string;
    k: SortKey;
    className?: string;
    help?: string;
  }) => (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <button
        onClick={() => toggleSort(k)}
        className={`inline-flex items-center gap-0.5 uppercase tracking-wider font-semibold hover:text-foreground transition-colors ${
          sortKey === k ? "text-espert-gold" : ""
        }`}
      >
        {label}
        <span className="w-2 text-[9px]">{sortKey === k ? (sortAsc ? "▲" : "▼") : ""}</span>
      </button>
      {help && (
        <span title={help} className="cursor-help text-muted-foreground/70 hover:text-foreground">
          <HelpCircle size={12} />
        </span>
      )}
    </span>
  );

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="font-bold text-foreground text-sm mb-1">¿Cómo está cada zona?</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Por zona: cuánto la conocemos (avance del censo) y qué tan bien estamos donde ya
          censamos. Tocá un encabezado para ordenar, y una fila para entrar al tablero de esa zona.
        </p>

        {/* Encabezado */}
        <div className="hidden md:grid md:grid-cols-[9.5rem_1fr_1fr_7rem_7rem] gap-x-4 pb-2 border-b border-border text-[10px] text-muted-foreground">
          <Header label="Zona" k="zona" />
          <Header label="¿Cuánto la conocemos? · censo" k="censado" />
          <Header label="¿Cómo estamos ahí? · cobertura" k="cobertura" />
          <Header label="SKUs por PDV" k="skus" className="justify-end" help={HELP.profundidad} />
          <Header label="Ritmo 30d" k="ritmo" className="justify-end" help={HELP.ritmo} />
        </div>

        <div className="divide-y divide-border/60">
          {ordered.map((z) => {
            const pctCensado = z.pdvs ? Math.round((z.censados / z.pdvs) * 100) : 0;
            const porTrade = z.trades30d ? Math.round(z.visitas30d / z.trades30d) : 0;
            return (
              <div
                key={z.zonaId}
                onClick={() => onZonaClick(z)}
                className="grid grid-cols-2 md:grid-cols-[9.5rem_1fr_1fr_7rem_7rem] gap-x-4 gap-y-2 py-3 items-center hover:bg-muted/30 cursor-pointer"
              >
                {/* Zona */}
                <div className="col-span-2 md:col-span-1 flex items-center gap-2 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${coberturaBarColor(z.cobertura)}`}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{z.zona}</p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">{nf(z.pdvs)} PDVs</p>
                  </div>
                </div>

                {/* Avance del censo */}
                <div>
                  <div className="flex justify-between text-[11px] tabular-nums mb-1">
                    <span className="text-muted-foreground">{nf(z.censados)} censados</span>
                    <span className="font-semibold text-foreground">{pctCensado}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#2a78d6] rounded-full"
                      style={{ width: `${pctCensado}%` }}
                    />
                  </div>
                </div>

                {/* Cobertura Espert */}
                <div>
                  <div className="flex justify-between text-[11px] tabular-nums mb-1">
                    <span className="text-muted-foreground">{nf(z.conEspert)} con Espert</span>
                    <span className={`font-semibold ${coberturaTextColor(z.cobertura)}`}>
                      {z.cobertura}%
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${coberturaBarColor(z.cobertura)}`}
                      style={{ width: `${z.cobertura}%` }}
                    />
                  </div>
                </div>

                {/* SKUs por PDV — click acá abre el modal con los 5 más
                    presentes (no el de stats de la fila) */}
                <div
                  className="text-right"
                  onClick={(e) => {
                    e.stopPropagation();
                    openDetail(z, e, "skus");
                  }}
                >
                  <p className="text-sm font-bold text-foreground tabular-nums">
                    {Math.round(z.skusPromEspert)}
                  </p>
                  <div className="flex gap-0.5 justify-end mt-1">
                    {Array.from({ length: 8 }, (_, i) => (
                      <span
                        key={i}
                        className={`w-1.5 h-1.5 rounded-full ${
                          i < Math.round((z.skusPromEspert / maxSkus) * 8)
                            ? "bg-espert-gold"
                            : "bg-muted-foreground/30 dark:bg-muted-foreground/40"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">SKUs/PDV</p>
                </div>

                {/* Ritmo */}
                <div className="text-right tabular-nums">
                  <p className="text-sm font-bold text-foreground">{nf(z.visitas30d)}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {z.trades30d > 0
                      ? `${z.trades30d} trade${z.trades30d > 1 ? "s" : ""} · ${nf(porTrade)} c/u`
                      : "sin visitas"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {detail && (
          <ZonaDetailModal
            zona={detail.zona}
            topSkus={topSkusPorZona[detail.zona.zona] ?? []}
            origin={detail.origin}
            variant={detail.variant}
            onClose={() => setDetail(null)}
          />
        )}
      </CardContent>
    </Card>
  );
}
