import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { intelligenceApi, type IntelOverview } from "@/lib/api";
import { ResumenSection } from "./ResumenSection";
import { MapaSection } from "./MapaSection";
import { ZonasSection } from "./ZonasSection";
import { CompetenciaSection } from "./CompetenciaSection";
import { PortfolioSection } from "./PortfolioSection";
import { OportunidadesSection } from "./OportunidadesSection";
import { TradesSection } from "./TradesSection";

/**
 * Inteligencia Comercial: la versión viva del informe del censo — cobertura,
 * competencia, portfolio y el motor de oportunidades, contra /intelligence/*.
 * El mapa y las oportunidades fetchean por su cuenta (endpoints separados,
 * cacheados juntos en el backend); el resto sale del overview.
 */
export function InteligenciaPage() {
  const [overview, setOverview] = useState<IntelOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    intelligenceApi
      .overview()
      .then(setOverview)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1240px] mx-auto">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-espert-gold">
          Trade Marketing · datos de producción en vivo
        </p>
        <h1 className="text-2xl font-bold text-foreground mt-1">Inteligencia Comercial</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Explotación del censo de campo: cobertura por zona, competencia directa,
          portfolio en góndola y el motor de oportunidades por punto de venta.
          {overview && <span className="ml-1">Actualizado: {overview.generadoEl}.</span>}
        </p>
      </header>

      {loading && (
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <div className="w-6 h-6 border-2 border-[#A48242] border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-muted-foreground">
                Consolidando el censo completo — la primera carga puede tardar…
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card>
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">No se pudo cargar la inteligencia comercial.</p>
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-espert-gold hover:underline"
            >
              <RefreshCw size={12} /> Reintentar
            </button>
          </CardContent>
        </Card>
      )}

      {overview && !loading && (
        <>
          <ResumenSection data={overview} />
          <MapaSection />
          <ZonasSection zonas={overview.zonas} />
          <CompetenciaSection
            competencia={overview.competencia}
            precioFab={overview.precioFab}
          />
          <PortfolioSection portfolio={overview.portfolio} zonas={overview.zonas} />
          <OportunidadesSection zonas={overview.zonas} />
          <TradesSection trades={overview.trades} />
        </>
      )}
    </div>
  );
}
