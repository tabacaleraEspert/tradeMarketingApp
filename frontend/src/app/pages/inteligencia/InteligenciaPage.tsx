import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { intelligenceApi, type IntelOverview, type IntelTrade, type IntelZona } from "@/lib/api";
import { ZonaPage } from "./ZonaPage";
import { TradePage } from "./TradePage";
import { RutaPage } from "./RutaPage";
import { PdvPage } from "./PdvPage";
import { IntelNavContext } from "./nav-context";
import { ResumenSection } from "./ResumenSection";
import { SlideDeck } from "./SlideDeck";
import { ZonasSection } from "./ZonasSection";
import { ZonasVolumenChart } from "./ZonasVolumenChart";
import { ZonasMiniCharts } from "./ZonasMiniCharts";
import { CompetenciaHeatmap, PreciosFabricantes } from "./CompetenciaSection";
import { PortfolioSection } from "./PortfolioSection";
import { GondolaFamilias, GondolaRivales } from "./GondolaAnalytics";
import { OportunidadesSection } from "./OportunidadesSection";
import { EquipoSection } from "./EquipoSection";
import { EquipoTablaCruda } from "./EquipoTablaCruda";

/**
 * Inteligencia Comercial: la versión viva del informe del censo — cobertura,
 * competencia, portfolio y el motor de oportunidades, contra /intelligence/*.
 * El mapa y las oportunidades fetchean por su cuenta (endpoints separados,
 * cacheados juntos en el backend); el resto sale del overview.
 */
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function mesLabel(yyyymm: string | null): string {
  if (!yyyymm) return "";
  const [y, m] = yyyymm.split("-").map(Number);
  return `${MESES[(m ?? 1) - 1]} ${y}`;
}

export function InteligenciaPage() {
  const [overview, setOverview] = useState<IntelOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Drill de zona: el tablero general queda montado (oculto) para volver
  // exactamente donde estabas.
  const [zonaActiva, setZonaActiva] = useState<IntelZona | null>(null);
  // Drill de TM rep: por encima de la zona; "Volver" baja un nivel a la vez.
  const [tradeActivo, setTradeActivo] = useState<IntelTrade | null>(null);
  const [rutaActiva, setRutaActiva] = useState<{ ruta: string; trade: IntelTrade } | null>(null);
  // Último nivel: la ficha del PDV, accesible desde matrices, mapa y oportunidades.
  const [pdvActivo, setPdvActivo] = useState<number | null>(null);

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
    <IntelNavContext.Provider value={{ openPdv: setPdvActivo }}>
    <div className="p-4 lg:p-6 space-y-6 max-w-[1240px] mx-auto">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-espert-gold">
          Trade Marketing · datos de producción en vivo
        </p>
        <h1 className="text-2xl font-bold text-foreground mt-1">Inteligencia Comercial</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Explotación del censo de campo: cobertura por zona, competencia directa,
          portfolio en góndola y el motor de oportunidades por punto de venta.
          {overview && (
            <span className="ml-1">
              Tomando datos desde <strong className="text-foreground">{mesLabel(overview.datosDesde)}</strong>
              {" "}({overview.mesesDeDatos} meses de censo) · Actualizado: {overview.generadoEl}.
            </span>
          )}
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

      {pdvActivo != null && (
        <PdvPage key={pdvActivo} pdvId={pdvActivo} onBack={() => setPdvActivo(null)} />
      )}

      {overview && rutaActiva && (
        <div className={pdvActivo != null ? "hidden" : ""}>
        <RutaPage
          key={`${rutaActiva.trade.userId}-${rutaActiva.ruta}`}
          userId={rutaActiva.trade.userId}
          tradeNombre={rutaActiva.trade.nombre}
          rutaNombre={rutaActiva.ruta}
          onBack={() => setRutaActiva(null)}
          onTradeClick={() => {
            const t = rutaActiva.trade;
            setRutaActiva(null);
            setTradeActivo(t);
          }}
          onZonaClick={(zonaName) => {
            const z = overview.zonas.find((x) => x.zona === zonaName);
            if (z) {
              setRutaActiva(null);
              setTradeActivo(null);
              setZonaActiva(z);
            }
          }}
        />
        </div>
      )}

      {overview && tradeActivo && (
        <div className={rutaActiva || pdvActivo != null ? "hidden" : ""}>
          <TradePage
            key={tradeActivo.userId}
            trade={tradeActivo}
            overview={overview}
            onBack={() => setTradeActivo(null)}
            onRutaClick={(ruta) => setRutaActiva({ ruta, trade: tradeActivo })}
          />
        </div>
      )}

      {overview && zonaActiva && (
        <div className={tradeActivo || rutaActiva || pdvActivo != null ? "hidden" : ""}>
          <ZonaPage
            key={zonaActiva.zonaId}
            zona={zonaActiva}
            overview={overview}
            onBack={() => setZonaActiva(null)}
            onTradeClick={setTradeActivo}
            onRutaClick={(ruta, trade) => setRutaActiva({ ruta, trade })}
          />
        </div>
      )}

      {overview && !loading && (
        <div className={zonaActiva || tradeActivo || rutaActiva || pdvActivo != null ? "hidden" : "space-y-6"}>
          <ResumenSection data={overview} />

          <div className="flex items-center gap-3 pt-4">
            <h2 className="text-sm font-bold uppercase tracking-widest text-espert-gold shrink-0">
              Análisis en detalle
            </h2>
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground shrink-0">
              Navegá con las flechas, ← → o deslizando al costado
            </span>
          </div>

          <SlideDeck
            slides={[
              {
                key: "zonas",
                title: "Zonas y competencia",
                node: (
                  <div className="space-y-5">
                    <SlideDeck
                      compact
                      slides={[
                        { key: "tabla", title: "Cómo está cada zona", node: <ZonasSection zonas={overview.zonas} portfolio={overview.portfolio} onZonaClick={setZonaActiva} /> },
                        {
                          key: "volumen",
                          title: "Peso y representatividad",
                          node: (
                            <div className="space-y-4">
                              <ZonasVolumenChart zonas={overview.zonas} />
                              <ZonasMiniCharts zonas={overview.zonas} />
                            </div>
                          ),
                        },
                      ]}
                    />
                    <SlideDeck
                      compact
                      slides={[
                        { key: "presencia", title: "Contra quién peleamos", node: <CompetenciaHeatmap competencia={overview.competencia} /> },
                        { key: "precios", title: "A qué precio juega cada uno", node: <PreciosFabricantes precioFab={overview.precioFab} /> },
                      ]}
                    />
                  </div>
                ),
              },
              // El mapa canvas de la vista país quedó afuera del deck (decisión
              // 2026-08-27): el mapa útil es el de Google dentro de cada zona.
              {
                key: "gondola",
                title: "Góndola",
                node: (
                  <SlideDeck
                    compact
                    slides={[
                      { key: "presencia", title: "Presencia por zona", node: <PortfolioSection portfolio={overview.portfolio} zonas={overview.zonas} /> },
                      { key: "familias", title: "Familias y embudo", node: <GondolaFamilias overview={overview} /> },
                      { key: "rivales", title: "Rivales y brechas", node: <GondolaRivales overview={overview} zonas={overview.zonas} /> },
                    ]}
                  />
                ),
              },
              {
                key: "oportunidades",
                title: "Oportunidades",
                node: <OportunidadesSection zonas={overview.zonas} />,
              },
              {
                key: "equipo",
                title: "Equipo",
                node: (
                  <SlideDeck
                    compact
                    slides={[
                      { key: "porzona", title: "Zona → TM rep", node: <EquipoSection trades={overview.trades} zonas={overview.zonas} onTradeClick={setTradeActivo} onRutaClick={(ruta, trade) => setRutaActiva({ ruta, trade })} /> },
                      { key: "tabla", title: "Tabla completa", node: <EquipoTablaCruda /> },
                    ]}
                  />
                ),
              },
            ]}
          />
        </div>
      )}
    </div>
    </IntelNavContext.Provider>
  );
}
