import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import {
  ArrowLeft, Zap, MapPin, Clock, Route as RouteIcon,
  CheckCircle2, AlertTriangle, Search, Store, ChevronRight,
} from "lucide-react";
import { pdvsApi, routesApi } from "@/lib/api";
import type { Pdv } from "@/lib/api";
import { getCurrentUser } from "../lib/auth";
import { toast } from "sonner";
import { useJsApiLoader, GoogleMap, MarkerF, PolylineF } from "@react-google-maps/api";

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const ROUTE_COLORS = ["#A48242", "#2E86AB", "#22c55e", "#f59e0b", "#dc2626", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1"];

type ProposalRoute = {
  index: number;
  name: string;
  pdvs: { PdvId: number; Name: string; Address: string | null; Lat: number | null; Lon: number | null; SortOrder: number }[];
  total_distance_km: number;
  estimated_minutes: number;
};

export function RouteGeneratorPage() {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const userId = Number(currentUser.id);

  // Step 1: Select PDVs
  // Step 2: Review proposal
  // Step 3: Confirm & create
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [allPdvs, setAllPdvs] = useState<Pdv[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [proposal, setProposal] = useState<ProposalRoute[]>([]);
  const [unassignedIds, setUnassignedIds] = useState<number[]>([]);
  const [namePrefix, setNamePrefix] = useState("Ruta");
  const [maxRoutes, setMaxRoutes] = useState(5);
  const [minPdvs, setMinPdvs] = useState(10);
  const [maxPdvs, setMaxPdvs] = useState(15);

  const { isLoaded: mapsLoaded } = useJsApiLoader({
    id: "google-map-script-places",
    googleMapsApiKey: GOOGLE_MAPS_KEY || " ",
    libraries: ["places"] as any,
    preventGoogleFontsLoading: true,
  });
  const [assignedPdvIds, setAssignedPdvIds] = useState<Set<number>>(new Set());
  const [showAssigned, setShowAssigned] = useState(false);

  useEffect(() => {
    Promise.all([
      pdvsApi.list({ active_only: true }),
      routesApi.listPdvAssignments().catch(() => [] as { pdvId: number; routeId: number }[]),
    ]).then(([list, assignments]) => {
      setAllPdvs(list);
      setAssignedPdvIds(new Set(assignments.map((a) => a.pdvId)));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // By default, only show PDVs NOT already in a route
  const availablePdvs = useMemo(() => {
    const base = showAssigned ? allPdvs : allPdvs.filter((p) => !assignedPdvIds.has(p.PdvId));
    if (!searchTerm.trim()) return base;
    const s = searchTerm.toLowerCase();
    return base.filter((p) =>
      p.Name.toLowerCase().includes(s) ||
      (p.Address ?? "").toLowerCase().includes(s) ||
      (p.City ?? "").toLowerCase().includes(s)
    );
  }, [allPdvs, searchTerm, assignedPdvIds, showAssigned]);

  const filteredPdvs = availablePdvs;

  const togglePdv = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredPdvs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredPdvs.map((p) => p.PdvId)));
    }
  };

  const handleGenerate = async () => {
    if (selectedIds.size === 0) {
      toast.error("Seleccioná al menos un PDV");
      return;
    }
    setGenerating(true);
    try {
      const result = await routesApi.generateProposal({
        pdv_ids: [...selectedIds],
        max_routes: maxRoutes,
        min_pdvs_per_route: minPdvs,
        max_pdvs_per_route: maxPdvs,
        route_name_prefix: namePrefix || "Ruta",
      });
      setProposal(result.routes);
      setUnassignedIds(result.unassigned_pdv_ids);
      setStep(2);
      if (result.unassigned_pdv_ids.length > 0) {
        toast.warning(`${result.unassigned_pdv_ids.length} PDVs sin coordenadas no se pudieron agrupar`);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Error al generar propuesta");
    } finally {
      setGenerating(false);
    }
  };

  const handleConfirm = async () => {
    setCreating(true);
    let skipped = 0;
    try {
      for (const route of proposal) {
        const newRoute = await routesApi.create({
          Name: route.name,
          AssignedUserId: userId,
          EstimatedMinutes: route.estimated_minutes,
        });
        for (const pdv of route.pdvs) {
          try {
            await routesApi.addPdv(newRoute.RouteId, {
              PdvId: pdv.PdvId,
              SortOrder: pdv.SortOrder,
              Priority: 3,
            });
          } catch {
            skipped++;
          }
        }
      }
      const msg = skipped > 0
        ? `${proposal.length} rutas creadas (${skipped} PDVs ya asignados se omitieron)`
        : `${proposal.length} rutas creadas`;
      toast.success(msg);
      navigate("/my-routes");
    } catch (e: any) {
      toast.error(e?.message ?? "Error al crear rutas");
    } finally {
      setCreating(false);
    }
  };

  const formatMinutes = (min: number) => {
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="bg-card border-b border-border p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => step === 1 ? navigate("/my-routes") : setStep(1)}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Generar Rutas Foco</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {step === 1 ? `${selectedIds.size} PDVs seleccionados` : `${proposal.length} rutas propuestas`}
            </p>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className={step === 1 ? "font-bold text-[#A48242]" : ""}>1. Seleccionar</span>
            <ChevronRight size={12} />
            <span className={step === 2 ? "font-bold text-[#A48242]" : ""}>2. Revisar</span>
          </div>
        </div>
      </div>

      <div className="p-4 max-w-3xl mx-auto">
        {/* Step 1: Select PDVs */}
        {step === 1 && (
          <div className="space-y-4">
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                    <Input
                      placeholder="Buscar por nombre, dirección o ciudad..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Button variant="outline" size="sm" onClick={selectAll}>
                    {selectedIds.size === filteredPdvs.length ? "Deseleccionar" : "Seleccionar"} todos
                  </Button>
                </div>
                {assignedPdvIds.size > 0 && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={showAssigned} onChange={(e) => setShowAssigned(e.target.checked)} />
                    <span className="text-xs text-muted-foreground">Mostrar ya asignados ({assignedPdvIds.size})</span>
                  </label>
                )}
                {assignedPdvIds.size > 0 && !showAssigned && (
                  <p className="text-xs text-muted-foreground">
                    {allPdvs.length - assignedPdvIds.size} PDVs disponibles · {assignedPdvIds.size} ya en rutas (ocultos)
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Config */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="font-semibold text-foreground text-sm">Configuración</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1">Cantidad de rutas</label>
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={maxRoutes}
                      onChange={(e) => setMaxRoutes(Number(e.target.value) || 1)}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1">PDVs por ruta (mín)</label>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={minPdvs}
                      onChange={(e) => setMinPdvs(Number(e.target.value) || 1)}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1">PDVs por ruta (máx)</label>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={maxPdvs}
                      onChange={(e) => setMaxPdvs(Number(e.target.value) || 1)}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1">Prefijo nombre</label>
                    <Input
                      value={namePrefix}
                      onChange={(e) => setNamePrefix(e.target.value)}
                      placeholder="Ruta"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Con {selectedIds.size} PDVs seleccionados → ~{selectedIds.size > 0 ? Math.ceil(selectedIds.size / ((minPdvs + maxPdvs) / 2)) : 0} rutas de ~{Math.round((minPdvs + maxPdvs) / 2)} PDVs
                </p>
              </CardContent>
            </Card>

            {loading ? (
              <p className="text-muted-foreground text-center py-8">Cargando PDVs...</p>
            ) : (
              <Card>
                <CardContent className="p-0 max-h-[60vh] overflow-y-auto">
                  {filteredPdvs.map((pdv) => (
                    <label
                      key={pdv.PdvId}
                      className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(pdv.PdvId)}
                        onChange={() => togglePdv(pdv.PdvId)}
                        className="rounded border-gray-300"
                      />
                      <Store size={14} className="text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{pdv.Name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{pdv.Address}</p>
                      </div>
                      {assignedPdvIds.has(pdv.PdvId) && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 text-blue-600 border-blue-200">
                          En ruta
                        </Badge>
                      )}
                      {pdv.Lat == null && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 text-amber-600 border-amber-200">
                          Sin GPS
                        </Badge>
                      )}
                    </label>
                  ))}
                  {filteredPdvs.length === 0 && (
                    <p className="text-center text-sm text-muted-foreground py-8">Sin PDVs</p>
                  )}
                </CardContent>
              </Card>
            )}

            <div className="sticky bottom-0 bg-card border-t border-border p-3 pb-[env(safe-area-inset-bottom)] -mx-4">
              <Button
                className="w-full h-12 text-base font-semibold bg-[#A48242] hover:bg-[#8a6d35]"
                onClick={handleGenerate}
                disabled={generating || selectedIds.size === 0}
              >
                <Zap className="mr-2" size={18} />
                {generating ? "Generando..." : `Generar rutas con ${selectedIds.size} PDVs`}
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Review proposal */}
        {step === 2 && (
          <div className="space-y-4">
            {unassignedIds.length > 0 && (
              <Card className="border-amber-200 bg-amber-50">
                <CardContent className="p-3 flex items-center gap-2">
                  <AlertTriangle size={16} className="text-amber-600 shrink-0" />
                  <p className="text-sm text-amber-800">
                    {unassignedIds.length} PDVs sin coordenadas no se pudieron agrupar. Agregalos manualmente después.
                  </p>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-3 gap-3">
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold text-[#A48242]">{proposal.length}</p>
                  <p className="text-xs text-muted-foreground">Rutas</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">
                    {proposal.reduce((s, r) => s + r.pdvs.length, 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">PDVs totales</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">
                    {Math.round(proposal.reduce((s, r) => s + r.total_distance_km, 0))} km
                  </p>
                  <p className="text-xs text-muted-foreground">Distancia total</p>
                </CardContent>
              </Card>
            </div>

            {/* Map */}
            {mapsLoaded && (() => {
              const allPoints = proposal.flatMap((r) => r.pdvs.filter((p) => p.Lat && p.Lon));
              if (allPoints.length === 0) return null;
              const centerLat = allPoints.reduce((s, p) => s + p.Lat!, 0) / allPoints.length;
              const centerLng = allPoints.reduce((s, p) => s + p.Lon!, 0) / allPoints.length;
              return (
                <Card className="overflow-hidden">
                  <GoogleMap
                    mapContainerStyle={{ width: "100%", height: "400px" }}
                    center={{ lat: centerLat, lng: centerLng }}
                    zoom={12}
                    options={{ disableDefaultUI: true, zoomControl: true, streetViewControl: false }}
                  >
                    {proposal.map((route, ri) => {
                      const color = ROUTE_COLORS[ri % ROUTE_COLORS.length];
                      const routePoints = route.pdvs.filter((p) => p.Lat && p.Lon);
                      return (
                        <div key={route.index}>
                          {/* Markers */}
                          {routePoints.map((pdv, idx) => (
                            <MarkerF
                              key={pdv.PdvId}
                              position={{ lat: pdv.Lat!, lng: pdv.Lon! }}
                              label={{
                                text: String(idx + 1),
                                color: "#fff",
                                fontSize: "10px",
                                fontWeight: "bold",
                              }}
                              icon={{
                                path: google.maps.SymbolPath.CIRCLE,
                                scale: 12,
                                fillColor: color,
                                fillOpacity: 1,
                                strokeColor: "#fff",
                                strokeWeight: 2,
                              }}
                              title={`${route.name} #${idx + 1}: ${pdv.Name}`}
                            />
                          ))}
                          {/* Polyline */}
                          {routePoints.length > 1 && (
                            <PolylineF
                              path={routePoints.map((p) => ({ lat: p.Lat!, lng: p.Lon! }))}
                              options={{
                                strokeColor: color,
                                strokeOpacity: 0.7,
                                strokeWeight: 3,
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </GoogleMap>
                  {/* Legend */}
                  <div className="p-3 flex flex-wrap gap-3 border-t border-border">
                    {proposal.map((route, ri) => (
                      <div key={route.index} className="flex items-center gap-1.5 text-xs">
                        <span
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: ROUTE_COLORS[ri % ROUTE_COLORS.length] }}
                        />
                        <span className="text-muted-foreground">{route.name} ({route.pdvs.length})</span>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })()}

            {proposal.map((route, ri) => (
              <Card key={route.index} className="overflow-hidden">
                <div className="h-1" style={{ backgroundColor: ROUTE_COLORS[ri % ROUTE_COLORS.length] }} />
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: ROUTE_COLORS[ri % ROUTE_COLORS.length] }} />
                      <h3 className="font-bold text-foreground">{route.name}</h3>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Store size={12} /> {route.pdvs.length} PDVs
                      </span>
                      <span className="flex items-center gap-1">
                        <MapPin size={12} /> {route.total_distance_km} km
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={12} /> {formatMinutes(route.estimated_minutes)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {route.pdvs.map((pdv, idx) => (
                      <span
                        key={pdv.PdvId}
                        className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-muted/60 text-muted-foreground"
                      >
                        <span className="w-4 h-4 rounded-full text-white text-[8px] font-bold flex items-center justify-center" style={{ backgroundColor: ROUTE_COLORS[ri % ROUTE_COLORS.length] }}>
                          {idx + 1}
                        </span>
                        <span className="truncate max-w-[120px]">{pdv.Name}</span>
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}

            <div className="sticky bottom-0 bg-card border-t border-border p-3 pb-[env(safe-area-inset-bottom)] -mx-4 flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
                Volver a editar
              </Button>
              <Button
                className="flex-1 bg-[#A48242] hover:bg-[#8a6d35]"
                onClick={handleConfirm}
                disabled={creating}
              >
                <CheckCircle2 className="mr-2" size={18} />
                {creating ? "Creando..." : `Crear ${proposal.length} rutas`}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
