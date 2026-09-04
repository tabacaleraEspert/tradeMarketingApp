import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { ArrowLeft, Camera, MapPin, Phone, RefreshCw } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { intelligenceApi, type IntelPdvDetail } from "@/lib/api";
import { ProveedorRow } from "./ProveedoresCard";

const nf = (n: number) => n.toLocaleString("es-AR");

type CensoFiltro = "espert" | "competencia" | "todos";

interface Props {
  pdvId: number;
  onBack: () => void;
}

/**
 * La ficha de UN punto de venta — el último nivel de drill: contacto, censo
 * consolidado con precio por producto, evolución, visitas y fotos.
 */
export function PdvPage({ pdvId, onBack }: Props) {
  const [entered, setEntered] = useState(false);
  const [d, setD] = useState<IntelPdvDetail | null>(null);
  const [error, setError] = useState(false);
  const [censoFiltro, setCensoFiltro] = useState<CensoFiltro>("espert");
  const [soloTrabaja, setSoloTrabaja] = useState(true);

  useLayoutEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, []);

  const load = useCallback(() => {
    setError(false);
    intelligenceApi.pdvDetail(pdvId).then(setD).catch(() => setError(true));
  }, [pdvId]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    load();
    return () => cancelAnimationFrame(raf);
  }, [load]);

  const censo = (d?.censo ?? []).filter((r) => {
    if (censoFiltro === "espert" && !r.esEspert) return false;
    if (censoFiltro === "competencia" && r.esEspert) return false;
    if (soloTrabaja && !r.trabaja) return false;
    return true;
  });

  const maxVisMes = Math.max(1, ...(d?.evolucion ?? []).map((e) => e.visitas));

  const chip = (value: CensoFiltro, label: string) => (
    <button
      onClick={() => setCensoFiltro(value)}
      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
        censoFiltro === value ? "bg-espert-gold text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"
      }`}
    >
      {label}
    </button>
  );

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
          <ArrowLeft size={14} /> Volver
        </button>
        <p className="text-xs font-semibold uppercase tracking-widest text-espert-gold">Punto de venta</p>
        <h2 className="text-2xl font-bold text-foreground">{d?.info.nombre ?? `PDV #${pdvId}`}</h2>
        {d && (
          <p className="text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
            <MapPin size={13} className="shrink-0" />
            {d.info.direccion || "Sin dirección"} · {d.info.canal} · {d.info.zona} · atendido por{" "}
            <span className="font-semibold text-foreground">{d.info.trade}</span>
            {d.info.horario && <> · {d.info.horario}</>}
          </p>
        )}
      </div>

      {error && (
        <Card>
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">No se pudo cargar el PDV.</p>
            <button onClick={load} className="inline-flex items-center gap-1.5 text-xs font-semibold text-espert-gold hover:underline">
              <RefreshCw size={12} /> Reintentar
            </button>
          </CardContent>
        </Card>
      )}
      {!d && !error && (
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-2 border-[#A48242] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {d && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { v: nf(d.totalVisitas), l: "Visitas", d2: d.visitas[0] ? `última: ${d.visitas[0].fecha.slice(0, 10)}` : "nunca" },
              { v: String(d.skusEspertHoy.length), l: "SKUs Espert hoy" },
              {
                v: d.info.sueltos == null ? "s/d" : d.info.sueltos ? "Sí" : "No",
                l: "Vende sueltos",
              },
              {
                v: d.info.volumenMensual != null ? nf(d.info.volumenMensual) : "s/d",
                l: "Volumen mensual",
                d2: d.info.categoria ?? undefined,
              },
              { v: String(d.censo.filter((r) => r.trabaja && !r.esEspert).length), l: "SKUs competencia" },
              { v: String(d.fotos.length), l: "Fotos recientes" },
            ].map((t) => (
              <Card key={t.l}>
                <CardContent className="p-4">
                  <p className="text-xl font-bold text-foreground tabular-nums">{t.v}</p>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-1">{t.l}</p>
                  {t.d2 && <p className="text-xs text-muted-foreground">{t.d2}</p>}
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid lg:grid-cols-[1fr_1.4fr] gap-4">
            <div className="space-y-4">
              <Card>
                <CardContent className="p-4">
                  <h3 className="font-bold text-foreground text-sm mb-2">Contactos</h3>
                  {d.contactos.length === 0 && (
                    <p className="text-sm text-muted-foreground">Sin contactos cargados.</p>
                  )}
                  <div className="space-y-2">
                    {d.contactos.map((ct, i) => (
                      <div key={i} className="text-sm">
                        <p className="font-semibold text-foreground">
                          {ct.nombre}
                          {ct.rol && <span className="ml-2 text-xs text-muted-foreground">{ct.rol}</span>}
                          {ct.decision && (
                            <span className="ml-2 text-[10px] uppercase font-bold text-espert-gold">
                              decisión {ct.decision}
                            </span>
                          )}
                        </p>
                        {ct.telefono && (
                          <a
                            href={`tel:${ct.telefono}`}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-espert-gold"
                          >
                            <Phone size={11} /> {ct.telefono}
                          </a>
                        )}
                        {ct.notas && <p className="text-xs text-muted-foreground">{ct.notas}</p>}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <h3 className="font-bold text-foreground text-sm mb-1">
                    Proveedores
                    {(d.proveedores?.length ?? 0) > 0 && (
                      <span className="text-muted-foreground font-normal"> · {d.proveedores.length}</span>
                    )}
                  </h3>
                  <p className="text-xs text-muted-foreground mb-1">
                    Cargados por los reps en el censo de proveedores del PDV.
                  </p>
                  {(d.proveedores?.length ?? 0) === 0 && (
                    <p className="text-sm text-muted-foreground">Sin proveedores cargados.</p>
                  )}
                  {(d.proveedores ?? []).map((p) => (
                    <ProveedorRow key={`${p.telefono ?? ""}|${p.nombre}`} p={p} />
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <h3 className="font-bold text-foreground text-sm mb-1">Evolución</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    Visitas por mes y SKUs Espert relevados como trabajados.
                  </p>
                  <div className="flex items-end gap-1.5 h-24">
                    {d.evolucion.map((e) => (
                      <div key={e.mes} className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
                        <span className="text-[10px] text-muted-foreground tabular-nums">{e.visitas}</span>
                        <div
                          className="w-full rounded-t bg-[#2a78d6]/80"
                          style={{ height: `${Math.max(3, (e.visitas / maxVisMes) * 56)}px` }}
                        />
                        <span className="text-[9px] text-muted-foreground">{e.mes.slice(5)}</span>
                        <span className="text-[9px] font-bold text-espert-gold tabular-nums">
                          {e.skusEspert || "·"}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    Azul: visitas · dorado: SKUs Espert del mes
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 flex-wrap mb-2">
                  <h3 className="font-bold text-foreground text-sm mr-2">¿Qué hay en la góndola?</h3>
                  {chip("espert", "Espert")}
                  {chip("competencia", "Competencia")}
                  {chip("todos", "Todo")}
                  <button
                    onClick={() => setSoloTrabaja((v) => !v)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                      soloTrabaja ? "bg-espert-gold/15 text-espert-gold" : "bg-muted text-muted-foreground hover:bg-muted/70"
                    }`}
                  >
                    Solo lo que trabaja
                  </button>
                </div>
                <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
                  <table className="w-full text-xs tabular-nums">
                    <thead className="sticky top-0 bg-card z-10">
                      <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                        <th className="py-1.5 pr-3">Producto</th>
                        <th className="py-1.5 pr-3">Fabricante</th>
                        <th className="py-1.5 pr-3 text-center">Trabaja</th>
                        <th className="py-1.5 pr-3 text-right">Precio</th>
                        <th className="py-1.5 text-right">Últ. censo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {censo.map((r) => (
                        <tr key={r.producto} className="border-b border-border/40 hover:bg-muted/30">
                          <td className={`py-1 pr-3 font-medium whitespace-nowrap ${r.esEspert ? "text-espert-gold" : "text-foreground"}`}>
                            {r.producto}
                          </td>
                          <td className="py-1 pr-3 whitespace-nowrap text-muted-foreground">{r.fabricante}</td>
                          <td className="py-1 pr-3 text-center">
                            {r.trabaja ? (
                              <span className="text-green-600 dark:text-green-400 font-bold">
                                ✓{(r.disponibilidad ?? "").toLowerCase() === "quiebre" ? " quiebre" : ""}
                              </span>
                            ) : (
                              <span className="text-red-500 font-bold">✗</span>
                            )}
                          </td>
                          <td className="py-1 pr-3 text-right">
                            {r.precio != null ? `$${nf(r.precio)}` : "—"}
                          </td>
                          <td className="py-1 text-right text-muted-foreground whitespace-nowrap">{r.fecha}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {censo.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">Nada con estos filtros.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-4">
                <h3 className="font-bold text-foreground text-sm mb-2">Últimas visitas</h3>
                <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
                  <table className="w-full text-xs tabular-nums">
                    <thead className="sticky top-0 bg-card z-10">
                      <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                        <th className="py-1.5 pr-3">Fecha</th>
                        <th className="py-1.5 pr-3">Trade</th>
                        <th className="py-1.5 pr-3 text-right">Duración</th>
                        <th className="py-1.5 pr-3 text-center">GPS</th>
                        <th className="py-1.5 text-center">Fotos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.visitas.map((v) => (
                        <tr key={v.visitId} className="border-b border-border/40 hover:bg-muted/30">
                          <td className="py-1 pr-3 whitespace-nowrap text-foreground">{v.fecha}</td>
                          <td className="py-1 pr-3 whitespace-nowrap">{v.trade}</td>
                          <td className="py-1 pr-3 text-right">{v.duracionMin != null ? `${v.duracionMin}m` : "—"}</td>
                          <td className="py-1 pr-3 text-center">{v.gps ? "✓" : "—"}</td>
                          <td className="py-1 text-center">{v.fotos || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {d.visitas.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">Sin visitas registradas.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <h3 className="font-bold text-foreground text-sm mb-2 inline-flex items-center gap-1.5">
                  <Camera size={14} /> Fotos recientes
                </h3>
                {d.fotos.length === 0 && (
                  <p className="text-sm text-muted-foreground">Sin fotos.</p>
                )}
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {d.fotos.map((f, i) => (
                    <a
                      key={`${f.visitId}-${i}`}
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block aspect-square rounded-lg overflow-hidden bg-muted hover:opacity-80 transition-opacity"
                      title={`${f.tipo} · ${f.fecha ?? ""}`}
                    >
                      <img src={f.url} alt={f.tipo} loading="lazy" className="w-full h-full object-cover" />
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
