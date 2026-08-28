import { useEffect, useLayoutEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import type { IntelOverview, IntelTrade, IntelZona } from "@/lib/api";
import { MapaSection } from "./MapaSection";
import { OportunidadesSection } from "./OportunidadesSection";
import { EquipoSection } from "./EquipoSection";

const nf = (n: number) => n.toLocaleString("es-AR");

interface Props {
  zona: IntelZona;
  overview: IntelOverview;
  onBack: () => void;
  onTradeClick?: (trade: IntelTrade) => void;
  onRutaClick?: (ruta: string, trade: IntelTrade) => void;
}

/**
 * El tablero entero dedicado a UNA zona. Todo se deriva client-side del
 * overview (que ya viene dimensionado por zona) + los endpoints de mapa y
 * oportunidades con la zona fijada. Entra con una transición suave y "Volver"
 * restaura el tablero general tal como estaba (queda montado, oculto).
 */
export function ZonaPage({ zona: z, overview, onBack, onTradeClick, onRutaClick }: Props) {
  const [entered, setEntered] = useState(false);
  // Al entrar a la zona, arrancar desde arriba de la página — sin esto quedás
  // a mitad de scroll (donde estaba la tabla que clickeaste).
  useLayoutEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, []);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const pctCensado = z.pdvs ? Math.round((z.censados / z.pdvs) * 100) : 0;
  const comp = overview.competencia[z.zona];
  const presencia = comp
    ? Object.entries(comp.presencia).sort(([, a], [, b]) => b - a)
    : [];
  const skusZona = overview.portfolio
    .map((p) => ({ producto: p.producto, pct: p.porZona[z.zona] ?? 0 }))
    .filter((p) => p.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 10);

  const tiles = [
    { v: nf(z.pdvs), l: "PDVs activos" },
    { v: nf(z.censados), l: "Censados", d: `${pctCensado}% de la zona` },
    { v: nf(z.pdvs - z.censados), l: "Sin censar" },
    { v: `${z.cobertura}%`, l: "Cobertura Espert", d: `${nf(z.conEspert)} con Espert` },
    { v: String(z.skusPromEspert), l: "SKUs por PDV" },
    { v: nf(z.visitas30d), l: "Visitas 30d", d: `${z.trades30d} trade${z.trades30d !== 1 ? "s" : ""}` },
    {
      v: z.sueltosConDato > 0 ? `${z.sueltosPct}%` : "s/d",
      l: "Venden sueltos",
      d: z.sueltosConDato > 0 ? `de ${nf(z.sueltosConDato)} con dato` : "sin dato",
    },
  ];

  return (
    <div
      className="space-y-5 transition-all duration-300 ease-out"
      style={{ opacity: entered ? 1 : 0, transform: entered ? "translateX(0)" : "translateX(40px)" }}
    >
      <div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-espert-gold hover:underline mb-2"
        >
          <ArrowLeft size={14} /> Volver al tablero general
        </button>
        <p className="text-xs font-semibold uppercase tracking-widest text-espert-gold">Zona</p>
        <h2 className="text-2xl font-bold text-foreground">{z.zona}</h2>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {tiles.map((t) => (
          <Card key={t.l}>
            <CardContent className="p-4">
              <p className="text-xl font-bold text-foreground tabular-nums">{t.v}</p>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-1">{t.l}</p>
              {t.d && <p className="text-xs text-muted-foreground">{t.d}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <h3 className="font-bold text-foreground text-sm mb-1">¿Contra quién peleamos acá?</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Presencia por fabricante sobre {comp ? nf(comp.pdvsCig) : 0} PDVs censados con cigarrillos.
            </p>
            <div className="space-y-2">
              {presencia.map(([fab, pct]) => (
                <div key={fab} className="flex items-center gap-2 text-xs">
                  <span className={`w-32 shrink-0 truncate ${fab === "Espert" ? "font-bold text-espert-gold" : "text-foreground"}`}>
                    {fab}
                  </span>
                  <div className="flex-1 h-3.5 bg-muted rounded overflow-hidden">
                    <div
                      className={fab === "Espert" ? "h-full bg-espert-gold rounded" : "h-full bg-[#2a78d6] rounded"}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-11 text-right tabular-nums font-semibold text-foreground shrink-0">
                    {pct.toFixed(0)}%
                  </span>
                </div>
              ))}
              {presencia.length === 0 && (
                <p className="text-sm text-muted-foreground">Sin censo de cigarrillos en la zona.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h3 className="font-bold text-foreground text-sm mb-1">¿Qué SKUs nuestros están en góndola?</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Top 10 por presencia sobre los PDVs censados de la zona.
            </p>
            <div className="space-y-2">
              {skusZona.map((s) => (
                <div key={s.producto} className="flex items-center gap-2 text-xs">
                  <span className="w-32 shrink-0 truncate text-foreground">{s.producto}</span>
                  <div className="flex-1 h-3.5 bg-muted rounded overflow-hidden">
                    <div className="h-full bg-espert-gold rounded" style={{ width: `${s.pct}%` }} />
                  </div>
                  <span className="w-11 text-right tabular-nums font-semibold text-foreground shrink-0">
                    {s.pct.toFixed(0)}%
                  </span>
                </div>
              ))}
              {skusZona.length === 0 && (
                <p className="text-sm text-muted-foreground">Todavía sin SKUs Espert relevados.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <EquipoSection
        trades={overview.trades.filter((t) => t.zona === z.zona)}
        zonas={overview.zonas.filter((oz) => oz.zonaId === z.zonaId)}
        onTradeClick={onTradeClick}
        onRutaClick={onRutaClick}
      />
      <MapaSection fixedZoneId={z.zonaId} />
      <OportunidadesSection zonas={overview.zonas} fixedZona={z.zona} />
    </div>
  );
}
