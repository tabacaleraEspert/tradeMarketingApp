import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import {
  ArrowLeft,
  Plus,
  MapPin,
  Trash2,
  GripVertical,
  Calendar,
  User,
  Save,
  Search,
  Map as MapIcon,
  List,
  Route,
  CheckCircle,
  Circle,
  Zap,
} from "lucide-react";
import {
  routesApi,
  usePdvs,
  useZones,
  useForms,
  useUsers,
  pdvsApi,
  BEJERMAN_ZONES,
} from "@/lib/api";
import type { Pdv } from "@/lib/api/types";
import { useJsApiLoader, GoogleMap, MarkerF, PolylineF, InfoWindowF } from "@react-google-maps/api";
import { toast } from "sonner";
import { getCurrentUser } from "../../lib/auth";

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const LIBRARIES: ("places")[] = ["places"];

// Haversine distance in km
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Nearest-neighbor TSP optimization
function optimizeRouteOrder(pdvList: Pdv[]): Pdv[] {
  const withCoords = pdvList.filter((p) => p.Lat != null && p.Lon != null);
  const withoutCoords = pdvList.filter((p) => p.Lat == null || p.Lon == null);
  if (withCoords.length <= 1) return [...withCoords, ...withoutCoords];

  const remaining = [...withCoords];
  const ordered: Pdv[] = [remaining.shift()!];

  while (remaining.length > 0) {
    const last = ordered[ordered.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(
        Number(last.Lat), Number(last.Lon),
        Number(remaining[i].Lat), Number(remaining[i].Lon)
      );
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    ordered.push(remaining.splice(bestIdx, 1)[0]);
  }
  return [...ordered, ...withoutCoords];
}

// Estimated times (~5 km/h walking, ~25 km/h city driving avg)
const WALK_KMH = 5;
const DRIVE_KMH = 25;

function formatMinutes(mins: number): string {
  if (mins < 60) return `${Math.round(mins)} min`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// Compute total route distance
function totalRouteKm(pdvList: Pdv[]): number {
  let total = 0;
  const withCoords = pdvList.filter((p) => p.Lat != null && p.Lon != null);
  for (let i = 1; i < withCoords.length; i++) {
    total += haversineKm(
      Number(withCoords[i - 1].Lat), Number(withCoords[i - 1].Lon),
      Number(withCoords[i].Lat), Number(withCoords[i].Lon)
    );
  }
  return total;
}

// Segment distances between consecutive PDVs
function segmentDistances(pdvList: Pdv[]): number[] {
  const dists: number[] = [];
  for (let i = 1; i < pdvList.length; i++) {
    if (pdvList[i - 1].Lat != null && pdvList[i].Lat != null) {
      dists.push(
        haversineKm(
          Number(pdvList[i - 1].Lat), Number(pdvList[i - 1].Lon),
          Number(pdvList[i].Lat), Number(pdvList[i].Lon)
        )
      );
    } else {
      dists.push(0);
    }
  }
  return dists;
}

export function RouteEditorPage() {
  const { routeId } = useParams();
  const navigate = useNavigate();
  const id = routeId ? Number(routeId) : null;

  const [route, setRoute] = useState<Awaited<ReturnType<typeof routesApi.get>> | null>(null);
  const [routePdvs, setRoutePdvs] = useState<Awaited<ReturnType<typeof routesApi.listPdvs>>>([]);
  const [routeForms, setRouteForms] = useState<Awaited<ReturnType<typeof routesApi.listForms>>>([]);
  const [routeDays, setRouteDays] = useState<Awaited<ReturnType<typeof routesApi.listDays>>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddDay, setShowAddDay] = useState(false);
  const [newDayUser, setNewDayUser] = useState<number | "">("");
  const [newDayDate, setNewDayDate] = useState(() => new Date().toISOString().split("T")[0]);

  // PDV section state
  const [pdvViewMode, setPdvViewMode] = useState<"list" | "map">("list");
  const [pdvSearch, setPdvSearch] = useState("");
  const [selectedInfoPdv, setSelectedInfoPdv] = useState<number | null>(null);

  // All PDVs cache (loaded individually for route PDVs)
  const [pdvCache, setPdvCache] = useState<Map<number, Pdv>>(new Map());

  const currentUser = getCurrentUser();
  const isAdmin = ["admin", "supervisor"].includes(currentUser.role);
  const { data: allPdvs, loading: pdvsLoading } = usePdvs();
  const { data: zones } = useZones();
  const { data: forms } = useForms();
  const { data: users } = useUsers();

  const { isLoaded: mapsLoaded } = useJsApiLoader({
    id: "google-map-script-places",
    googleMapsApiKey: GOOGLE_MAPS_KEY || " ",
    libraries: LIBRARIES,
    preventGoogleFontsLoading: true,
  });

  const loadRoute = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [r, rp, rf, rd] = await Promise.all([
        routesApi.get(id),
        routesApi.listPdvs(id),
        routesApi.listForms(id),
        routesApi.listDays(id),
      ]);
      setRoute(r);
      setRoutePdvs(rp.sort((a, b) => a.SortOrder - b.SortOrder));
      setRouteForms(rf);
      setRouteDays(rd.sort((a, b) => a.WorkDate.localeCompare(b.WorkDate)));
    } catch (e) {
      toast.error("Error al cargar ruta");
      navigate("/admin/routes");
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    loadRoute();
  }, [loadRoute]);

  // Build PDV cache from allPdvs
  useEffect(() => {
    if (allPdvs.length > 0) {
      setPdvCache(new Map(allPdvs.map((p) => [p.PdvId, p])));
    }
  }, [allPdvs]);

  // IDs of PDVs already in route
  const routePdvIds = useMemo(() => new Set(routePdvs.map((rp) => rp.PdvId)), [routePdvs]);

  // Ordered PDV objects in route
  const orderedPdvs = useMemo(() => {
    return routePdvs
      .map((rp) => pdvCache.get(rp.PdvId))
      .filter(Boolean) as Pdv[];
  }, [routePdvs, pdvCache]);

  // Route distances
  const distances = useMemo(() => segmentDistances(orderedPdvs), [orderedPdvs]);
  const totalKm = useMemo(() => totalRouteKm(orderedPdvs), [orderedPdvs]);

  // Available PDVs filtered by search
  const filteredAvailablePdvs = useMemo(() => {
    const search = pdvSearch.toLowerCase();
    return allPdvs.filter((p) => {
      if (routePdvIds.has(p.PdvId)) return false;
      if (!search) return true;
      return (
        p.Name.toLowerCase().includes(search) ||
        (p.Address || "").toLowerCase().includes(search) ||
        (p.City || "").toLowerCase().includes(search)
      );
    });
  }, [allPdvs, routePdvIds, pdvSearch]);

  // All PDVs with coords for map (both in route and not)
  const allPdvsWithCoords = useMemo(
    () => allPdvs.filter((p) => p.Lat != null && p.Lon != null),
    [allPdvs]
  );

  // Map center
  const mapCenter = useMemo(() => {
    const withCoords = orderedPdvs.filter((p) => p.Lat != null);
    if (withCoords.length > 0) {
      const lat = withCoords.reduce((s, p) => s + Number(p.Lat), 0) / withCoords.length;
      const lng = withCoords.reduce((s, p) => s + Number(p.Lon), 0) / withCoords.length;
      return { lat, lng };
    }
    if (allPdvsWithCoords.length > 0) {
      const lat = allPdvsWithCoords.reduce((s, p) => s + Number(p.Lat), 0) / allPdvsWithCoords.length;
      const lng = allPdvsWithCoords.reduce((s, p) => s + Number(p.Lon), 0) / allPdvsWithCoords.length;
      return { lat, lng };
    }
    return { lat: -34.6, lng: -58.45 };
  }, [orderedPdvs, allPdvsWithCoords]);

  // Route polyline path
  const polylinePath = useMemo(
    () =>
      orderedPdvs
        .filter((p) => p.Lat != null && p.Lon != null)
        .map((p) => ({ lat: Number(p.Lat), lng: Number(p.Lon) })),
    [orderedPdvs]
  );

  const handleAddPdv = async (pdvId: number) => {
    if (!id || saving) return;
    setSaving(true);
    try {
      const result = await routesApi.addPdv(id, {
        PdvId: pdvId,
        SortOrder: routePdvs.length,
        Priority: 3,
      });
      setRoutePdvs((prev) => [
        ...prev,
        result,
      ]);
      toast.success("PDV agregado a la ruta");
    } catch (e: any) {
      console.error("Error adding PDV:", e);
      toast.error(e?.message || "Error al agregar PDV");
    } finally {
      setSaving(false);
    }
  };

  const handleRemovePdv = async (pdvId: number) => {
    if (!id || saving) return;
    setSaving(true);
    try {
      await routesApi.removePdv(id, pdvId);
      setRoutePdvs((prev) => prev.filter((rp) => rp.PdvId !== pdvId));
      toast.success("PDV quitado de la ruta");
    } catch (e: any) {
      console.error("Error removing PDV:", e);
      toast.error(e?.message || "Error al quitar PDV");
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePdv = (pdvId: number) => {
    if (routePdvIds.has(pdvId)) {
      handleRemovePdv(pdvId);
    } else {
      handleAddPdv(pdvId);
    }
  };

  const handleOptimizeRoute = async () => {
    if (!id || orderedPdvs.length < 2) return;
    const optimized = optimizeRouteOrder(orderedPdvs);
    setSaving(true);
    try {
      // Remove all and re-add in optimized order
      for (const rp of routePdvs) {
        await routesApi.removePdv(id, rp.PdvId);
      }
      const newRoutePdvs = [];
      for (let i = 0; i < optimized.length; i++) {
        await routesApi.addPdv(id, {
          PdvId: optimized[i].PdvId,
          SortOrder: i,
          Priority: 3,
        });
        newRoutePdvs.push({ RouteId: id, PdvId: optimized[i].PdvId, SortOrder: i, Priority: 3 });
      }
      setRoutePdvs(newRoutePdvs);
      toast.success("Ruta optimizada por distancia");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al optimizar");
    } finally {
      setSaving(false);
    }
  };

  const handleAddDay = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const day = await routesApi.createDay(id, {
        WorkDate: newDayDate,
      });
      setRouteDays((prev) =>
        [...prev, day].sort((a, b) => a.WorkDate.localeCompare(b.WorkDate))
      );
      setShowAddDay(false);
      setNewDayUser("");
      setNewDayDate(new Date().toISOString().split("T")[0]);
      toast.success("Día agregado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveDay = async (routeDayId: number) => {
    if (!confirm("¿Eliminar este día de la ruta?")) return;
    setSaving(true);
    try {
      await routesApi.deleteDay(routeDayId);
      setRouteDays((prev) => prev.filter((d) => d.RouteDayId !== routeDayId));
      toast.success("Día eliminado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  const handleAddForm = async (formId: number) => {
    if (!id) return;
    setSaving(true);
    try {
      await routesApi.addForm(id, { FormId: formId, SortOrder: routeForms.length });
      const form = forms.find((f) => f.FormId === formId);
      if (form) setRouteForms((prev) => [...prev, { RouteId: id, FormId: formId, SortOrder: prev.length, Form: form }]);
      toast.success("Formulario agregado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveForm = async (formId: number) => {
    if (!id || !confirm("¿Quitar este formulario de la ruta?")) return;
    setSaving(true);
    try {
      await routesApi.removeForm(id, formId);
      setRouteForms((prev) => prev.filter((rf) => rf.FormId !== formId));
      toast.success("Formulario quitado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  const [routeDraft, setRouteDraft] = useState<{
    Name?: string;
    ZoneId?: number | null;
    BejermanZone?: string | null;
    EstimatedMinutes?: number | null;
    FrequencyType?: string | null;
    FrequencyConfig?: string | null;
    AssignedUserId?: number | null;
  } | null>(null);

  useEffect(() => {
    if (route) {
      setRouteDraft({
        Name: route.Name,
        ZoneId: route.ZoneId ?? null,
        BejermanZone: route.BejermanZone ?? null,
        EstimatedMinutes: route.EstimatedMinutes ?? null,
        FrequencyType: route.FrequencyType ?? null,
        FrequencyConfig: route.FrequencyConfig ?? null,
        AssignedUserId: route.AssignedUserId ?? null,
      });
    } else {
      setRouteDraft(null);
    }
  }, [route]);

  // Parse frequency config
  const frequencyDays = useMemo(() => {
    if (!routeDraft?.FrequencyConfig) return [];
    try {
      const parsed = JSON.parse(routeDraft.FrequencyConfig);
      return parsed.days || [];
    } catch {
      return [];
    }
  }, [routeDraft?.FrequencyConfig]);

  const toggleFrequencyDay = (day: number) => {
    const current = [...frequencyDays];
    const idx = current.indexOf(day);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(day);
    current.sort();
    setRouteDraft((d) =>
      d ? { ...d, FrequencyConfig: JSON.stringify({ days: current }) } : null
    );
  };

  const routeMetadataDirty =
    route &&
    routeDraft &&
    (routeDraft.Name !== route.Name ||
      (routeDraft.ZoneId ?? null) !== (route.ZoneId ?? null) ||
      (routeDraft.BejermanZone ?? "") !== (route.BejermanZone ?? "") ||
      (routeDraft.EstimatedMinutes ?? null) !== (route.EstimatedMinutes ?? null) ||
      (routeDraft.FrequencyType ?? "") !== (route.FrequencyType ?? "") ||
      (routeDraft.FrequencyConfig ?? "") !== (route.FrequencyConfig ?? "") ||
      (routeDraft.AssignedUserId ?? null) !== (route.AssignedUserId ?? null));

  const handleSaveRouteMetadata = async () => {
    if (!id || !routeDraft) return;
    setSaving(true);
    try {
      const updated = await routesApi.update(id, {
        Name: routeDraft.Name,
        ZoneId: routeDraft.ZoneId ?? undefined,
        BejermanZone: routeDraft.BejermanZone ?? undefined,
        EstimatedMinutes: routeDraft.EstimatedMinutes ?? undefined,
        FrequencyType: routeDraft.FrequencyType ?? undefined,
        FrequencyConfig: routeDraft.FrequencyConfig ?? undefined,
        AssignedUserId: routeDraft.AssignedUserId ?? undefined,
      });
      setRoute(updated);
      setRouteDraft({
        Name: updated.Name,
        ZoneId: updated.ZoneId ?? null,
        BejermanZone: updated.BejermanZone ?? null,
        EstimatedMinutes: updated.EstimatedMinutes ?? null,
        FrequencyType: updated.FrequencyType ?? null,
        FrequencyConfig: updated.FrequencyConfig ?? null,
        AssignedUserId: updated.AssignedUserId ?? null,
      });
      toast.success("Ruta guardada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !route) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Cargando...</p>
      </div>
    );
  }

  const availableForms = forms.filter((f) => !routeForms.some((rf) => rf.FormId === f.FormId));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate("/admin/routes")}
          className="p-2 hover:bg-muted rounded-lg transition-colors"
        >
          <ArrowLeft size={24} />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">Editar Ruta Foco</h1>
          <p className="text-muted-foreground">{routeDraft?.Name ?? route.Name}</p>
        </div>
      </div>

      {/* Route Info */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground">Datos de la ruta</h3>
            {routeDraft && (
              <Button
                variant={routeMetadataDirty ? "default" : "outline"}
                size="sm"
                onClick={handleSaveRouteMetadata}
                disabled={saving || !routeDraft.Name?.trim()}
              >
                <Save size={16} className="mr-1" />
                {saving ? "Guardando..." : "Guardar"}
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Nombre</label>
              <Input
                value={routeDraft?.Name ?? ""}
                onChange={(e) =>
                  setRouteDraft((d) => (d ? { ...d, Name: e.target.value } : null))
                }
                placeholder="Ej: Ruta Norte - Kioscos"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Zona</label>
              <select
                className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-espert-gold"
                value={routeDraft?.ZoneId ?? ""}
                onChange={(e) => {
                  const zoneId = e.target.value ? Number(e.target.value) : undefined;
                  setRouteDraft((d) => (d ? { ...d, ZoneId: zoneId ?? null } : null));
                }}
              >
                <option value="">Sin zona</option>
                {zones.map((z) => (
                  <option key={z.ZoneId} value={z.ZoneId}>
                    {z.Name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Zona Bejerman</label>
              <select
                className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-espert-gold"
                value={routeDraft?.BejermanZone ?? ""}
                onChange={(e) => {
                  const v = e.target.value || undefined;
                  setRouteDraft((d) => (d ? { ...d, BejermanZone: v ?? null } : null));
                }}
              >
                <option value="">Sin zona</option>
                {BEJERMAN_ZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>
            {isAdmin && (
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                  Tiempo estimado (min)
                </label>
                <Input
                  type="number"
                  value={routeDraft?.EstimatedMinutes ?? ""}
                  onChange={(e) => {
                    const v = e.target.value ? Number(e.target.value) : undefined;
                    setRouteDraft((d) =>
                      d ? { ...d, EstimatedMinutes: v ?? null } : null
                    );
                  }}
                  placeholder="Ej: 120"
                />
              </div>
            )}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Formularios de relevamiento
              </label>
              <p className="text-sm text-muted-foreground mb-2">
                Cada formulario se verá como tab en Relevamiento
              </p>
              <div className="flex flex-wrap gap-2 mb-2">
                {routeForms.map((rf) => (
                  <Badge
                    key={rf.FormId}
                    variant="secondary"
                    className="flex items-center gap-1 pr-1"
                  >
                    {rf.Form.Name}
                    <button
                      type="button"
                      onClick={() => handleRemoveForm(rf.FormId)}
                      disabled={saving}
                      className="ml-1 p-0.5 hover:bg-secondary rounded"
                    >
                      <Trash2 size={14} />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="relative">
                <select
                  className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-espert-gold"
                  value=""
                  onChange={(e) => {
                    const formId = e.target.value ? Number(e.target.value) : 0;
                    if (formId) handleAddForm(formId);
                    e.target.value = "";
                  }}
                  disabled={saving || availableForms.length === 0}
                >
                  <option value="">
                    {availableForms.length === 0 ? "Todos agregados" : "Agregar formulario..."}
                  </option>
                  {availableForms.map((f) => (
                    <option key={f.FormId} value={f.FormId}>
                      {f.Name} {f.Channel ? `(${f.Channel})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Trade Marketer asignado + Frecuencia */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Trade Marketer */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <User size={20} />
                Trade Marketer asignado
              </h3>
            </div>
            <select
              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-espert-gold"
              value={routeDraft?.AssignedUserId ?? ""}
              onChange={(e) => {
                const uid = e.target.value ? Number(e.target.value) : null;
                setRouteDraft((d) => (d ? { ...d, AssignedUserId: uid } : null));
              }}
            >
              <option value="">Sin asignar</option>
              {users.filter((u) => u.IsActive).map((u) => (
                <option key={u.UserId} value={u.UserId}>
                  {u.DisplayName} ({u.Email})
                </option>
              ))}
            </select>
            {route?.AssignedUserName && !routeMetadataDirty && (
              <p className="text-sm text-muted-foreground mt-2">
                Asignado a: <span className="font-medium text-foreground">{route.AssignedUserName}</span>
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Este TM se asignará automáticamente a los nuevos días de ruta
            </p>
          </CardContent>
        </Card>

        {/* Frecuencia */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <Calendar size={20} />
                Frecuencia
              </h3>
            </div>
            <div className="space-y-4">
              <select
                className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-espert-gold"
                value={routeDraft?.FrequencyType ?? ""}
                onChange={(e) => {
                  const ft = e.target.value || null;
                  setRouteDraft((d) => {
                    if (!d) return null;
                    // Reset config when changing type
                    let config = d.FrequencyConfig;
                    if (ft === "specific_days" && !config) config = JSON.stringify({ days: [] });
                    else if (ft !== "specific_days") config = ft === "every_x_days" ? JSON.stringify({ interval: 15 }) : null;
                    return { ...d, FrequencyType: ft, FrequencyConfig: config };
                  });
                }}
              >
                <option value="">Sin frecuencia definida</option>
                <option value="daily">Diaria</option>
                <option value="specific_days">Días específicos de la semana</option>
                <option value="weekly">Semanal</option>
                <option value="every_x_days">Cada X días</option>
                <option value="biweekly">Quincenal</option>
                <option value="monthly">Mensual</option>
              </select>

              {/* Specific days selector */}
              {routeDraft?.FrequencyType === "specific_days" && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Seleccioná los días de la semana:</p>
                  <div className="flex gap-1.5">
                    {["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((label, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => toggleFrequencyDay(idx)}
                        className={`w-10 h-10 rounded-full text-xs font-medium transition-colors ${
                          frequencyDays.includes(idx)
                            ? "bg-[#A48242] text-white"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Every X days interval */}
              {routeDraft?.FrequencyType === "every_x_days" && (
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Cada cuántos días:</label>
                  <Input
                    type="number"
                    min={1}
                    max={90}
                    value={(() => {
                      try { return JSON.parse(routeDraft.FrequencyConfig || "{}").interval || 15; } catch { return 15; }
                    })()}
                    onChange={(e) => {
                      const interval = Number(e.target.value) || 15;
                      setRouteDraft((d) =>
                        d ? { ...d, FrequencyConfig: JSON.stringify({ interval }) } : null
                      );
                    }}
                    placeholder="15"
                  />
                </div>
              )}

              {/* Summary */}
              {routeDraft?.FrequencyType && (
                <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                  {routeDraft.FrequencyType === "daily" && "Se ejecuta todos los días"}
                  {routeDraft.FrequencyType === "weekly" && "Se ejecuta una vez por semana"}
                  {routeDraft.FrequencyType === "biweekly" && "Se ejecuta cada 2 semanas"}
                  {routeDraft.FrequencyType === "monthly" && "Se ejecuta una vez al mes"}
                  {routeDraft.FrequencyType === "specific_days" && (
                    frequencyDays.length > 0
                      ? `Se ejecuta los ${frequencyDays.map((d: number) => ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][d]).join(", ")}`
                      : "Seleccioná al menos un día"
                  )}
                  {routeDraft.FrequencyType === "every_x_days" && (() => {
                    try { const i = JSON.parse(routeDraft.FrequencyConfig || "{}").interval || 15; return `Se ejecuta cada ${i} días`; } catch { return "Cada 15 días"; }
                  })()}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* PDVs en la ruta */}
      <Card>
        <CardContent className="p-6">
          {/* Header with stats */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <MapPin size={20} />
                Puntos de venta ({routePdvs.length})
              </h3>
              {totalKm > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="gap-1">
                    <Route size={13} />
                    {totalKm.toFixed(1)} km
                  </Badge>
                  <Badge variant="outline" className="gap-1 text-blue-600 border-blue-200">
                    🚶 {formatMinutes(totalKm / WALK_KMH * 60)}
                  </Badge>
                  <Badge variant="outline" className="gap-1 text-green-600 border-green-200">
                    🚗 {formatMinutes(totalKm / DRIVE_KMH * 60)}
                  </Badge>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {orderedPdvs.length >= 2 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOptimizeRoute}
                  disabled={saving}
                  className="gap-1.5"
                >
                  <Zap size={15} />
                  Optimizar ruta
                </Button>
              )}
              {/* View toggle */}
              <div className="flex rounded-lg border border-border overflow-hidden">
                <button
                  onClick={() => setPdvViewMode("list")}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    pdvViewMode === "list"
                      ? "bg-[#A48242] text-white"
                      : "bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <List size={14} />
                  Lista
                </button>
                <button
                  onClick={() => setPdvViewMode("map")}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    pdvViewMode === "map"
                      ? "bg-[#A48242] text-white"
                      : "bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <MapIcon size={14} />
                  Mapa
                </button>
              </div>
            </div>
          </div>

          {pdvViewMode === "map" ? (
            /* ========== MAP VIEW ========== */
            <div>
              {!GOOGLE_MAPS_KEY || !mapsLoaded ? (
                <div className="flex items-center justify-center py-20 text-muted-foreground">
                  Cargando mapa...
                </div>
              ) : (
                <GoogleMap
                  mapContainerStyle={{ width: "100%", height: "500px", borderRadius: "0.5rem" }}
                  center={mapCenter}
                  zoom={allPdvsWithCoords.length <= 1 ? 14 : 12}
                  options={{
                    disableDefaultUI: false,
                    zoomControl: true,
                    streetViewControl: false,
                    mapTypeControl: false,
                    styles: [
                      { featureType: "poi", stylers: [{ visibility: "off" }] },
                      { featureType: "transit", stylers: [{ visibility: "off" }] },
                    ],
                  }}
                >
                  {/* Route polyline */}
                  {polylinePath.length >= 2 && (
                    <PolylineF
                      path={polylinePath}
                      options={{
                        strokeColor: "#A48242",
                        strokeOpacity: 0.8,
                        strokeWeight: 3,
                      }}
                    />
                  )}

                  {/* All PDVs as markers */}
                  {allPdvsWithCoords.map((p) => {
                    const inRoute = routePdvIds.has(p.PdvId);
                    const orderIdx = inRoute
                      ? routePdvs.findIndex((rp) => rp.PdvId === p.PdvId) + 1
                      : 0;

                    return (
                      <MarkerF
                        key={p.PdvId}
                        position={{ lat: Number(p.Lat), lng: Number(p.Lon) }}
                        onClick={() => setSelectedInfoPdv(p.PdvId)}
                        label={
                          inRoute
                            ? {
                                text: String(orderIdx),
                                color: "#fff",
                                fontWeight: "bold",
                                fontSize: "12px",
                              }
                            : undefined
                        }
                        icon={
                          inRoute
                            ? {
                                path: google.maps.SymbolPath.CIRCLE,
                                fillColor: "#A48242",
                                fillOpacity: 1,
                                strokeColor: "#fff",
                                strokeWeight: 2,
                                scale: 14,
                              }
                            : {
                                path: google.maps.SymbolPath.CIRCLE,
                                fillColor: "#9ca3af",
                                fillOpacity: 0.5,
                                strokeColor: "#fff",
                                strokeWeight: 1,
                                scale: 8,
                              }
                        }
                      />
                    );
                  })}

                  {/* Info window */}
                  {selectedInfoPdv && (() => {
                    const p = pdvCache.get(selectedInfoPdv);
                    if (!p || p.Lat == null) return null;
                    const inRoute = routePdvIds.has(p.PdvId);
                    return (
                      <InfoWindowF
                        position={{ lat: Number(p.Lat), lng: Number(p.Lon) }}
                        onCloseClick={() => setSelectedInfoPdv(null)}
                      >
                        <div className="p-1 min-w-[180px]">
                          <p className="font-semibold text-sm mb-1">{p.Name}</p>
                          {p.Address && (
                            <p className="text-xs text-gray-500 mb-1">{p.Address}</p>
                          )}
                          <p className="text-xs text-gray-500 mb-2">{p.ChannelName || p.Channel}</p>
                          <button
                            onClick={() => handleTogglePdv(p.PdvId)}
                            disabled={saving}
                            className={`w-full text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                              inRoute
                                ? "bg-red-50 text-red-600 hover:bg-red-100"
                                : "bg-amber-50 text-amber-700 hover:bg-amber-100"
                            }`}
                          >
                            {inRoute ? "Quitar de la ruta" : "Agregar a la ruta"}
                          </button>
                        </div>
                      </InfoWindowF>
                    );
                  })()}
                </GoogleMap>
              )}

              {/* Map legend */}
              <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-[#A48242] inline-block" />
                  En la ruta (click para quitar)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-gray-400/50 inline-block" />
                  Disponible (click para agregar)
                </span>
              </div>
            </div>
          ) : (
            /* ========== LIST VIEW ========== */
            <div className="space-y-4">
              {/* Current route PDVs */}
              {orderedPdvs.length > 0 && (
                <div className="space-y-1">
                  {orderedPdvs.map((pdv, index) => (
                    <div
                      key={pdv.PdvId}
                      className="flex items-center gap-3 p-3 bg-muted rounded-lg hover:bg-secondary transition-colors"
                    >
                      <GripVertical size={18} className="text-muted-foreground" />
                      <span className="w-8 text-sm font-bold text-[#A48242]">#{index + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate">{pdv.Name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {pdv.Address || pdv.City || "-"}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {pdv.ChannelName || pdv.Channel}
                      </Badge>
                      {index > 0 && distances[index - 1] > 0 && (
                        <span className="text-xs text-muted-foreground whitespace-nowrap flex items-center gap-1.5">
                          {distances[index - 1].toFixed(1)} km
                          <span className="text-blue-500">🚶{formatMinutes(distances[index - 1] / WALK_KMH * 60)}</span>
                          <span className="text-green-500">🚗{formatMinutes(distances[index - 1] / DRIVE_KMH * 60)}</span>
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemovePdv(pdv.PdvId)}
                        disabled={saving}
                      >
                        <Trash2 size={16} className="text-red-500" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {orderedPdvs.length === 0 && (
                <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                  <MapPin size={40} className="mx-auto text-muted-foreground mb-2" />
                  <p className="text-muted-foreground font-medium">Sin puntos de venta</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Buscá y agregá PDVs de la lista de abajo, o usá la vista Mapa
                  </p>
                </div>
              )}

              {/* Divider + search */}
              <div className="border-t border-border pt-4">
                <div className="flex items-center gap-3 mb-3">
                  <h4 className="text-sm font-semibold text-muted-foreground">
                    PDVs disponibles ({filteredAvailablePdvs.length})
                  </h4>
                </div>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                  <Input
                    placeholder="Buscar por nombre, dirección o ciudad..."
                    value={pdvSearch}
                    onChange={(e) => setPdvSearch(e.target.value)}
                    className="pl-9 text-sm"
                  />
                </div>
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {filteredAvailablePdvs.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      {pdvSearch ? "Sin resultados" : "No hay PDVs disponibles en esta zona"}
                    </p>
                  ) : (
                    filteredAvailablePdvs.map((p) => (
                      <button
                        key={p.PdvId}
                        onClick={() => handleAddPdv(p.PdvId)}
                        disabled={saving}
                        className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted transition-colors text-left"
                      >
                        <Circle size={16} className="text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{p.Name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {p.Address || p.City || "-"}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-xs shrink-0">
                          {p.ChannelName || p.Channel}
                        </Badge>
                        <Plus size={16} className="text-[#A48242] shrink-0" />
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Días de ruta */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Calendar size={20} />
              Días programados ({routeDays.length})
            </h3>
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddDay(!showAddDay)}
                disabled={routePdvs.length === 0 || !route?.AssignedUserId}
                title={!route?.AssignedUserId ? "Asigná un Trade Marketer primero" : ""}
              >
                <Plus size={18} className="mr-1" />
                Agregar día
              </Button>
              {showAddDay && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowAddDay(false)}
                  />
                  <div className="absolute right-0 top-full mt-2 w-80 bg-card rounded-lg shadow-xl border border-border p-4 z-50 space-y-3">
                    <p className="text-sm font-medium text-muted-foreground">
                      Programar día de ruta
                    </p>
                    {route?.AssignedUserName && (
                      <div className="flex items-center gap-2 p-2 bg-muted rounded-lg">
                        <User size={14} className="text-muted-foreground" />
                        <span className="text-sm font-medium">{route.AssignedUserName}</span>
                      </div>
                    )}
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Fecha</label>
                      <input
                        type="date"
                        className="w-full px-3 py-2 border border-border rounded-lg"
                        value={newDayDate}
                        onChange={(e) => setNewDayDate(e.target.value)}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Se copiarán los {routePdvs.length} PDV de la ruta al día.
                    </p>
                    <Button
                      size="sm"
                      onClick={handleAddDay}
                      disabled={saving}
                    >
                      Agregar
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>

          {!route?.AssignedUserId && (
            <div className="border-2 border-dashed border-amber-300 bg-amber-50 rounded-lg p-4 mb-4 text-center">
              <p className="text-sm text-amber-700 font-medium">
                Asigná un Trade Marketer en la sección de arriba para poder programar días
              </p>
            </div>
          )}

          {routeDays.length === 0 ? (
            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
              <Calendar size={40} className="mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground font-medium">Sin días asignados</p>
              <p className="text-sm text-muted-foreground mt-1">
                Asigna usuarios y fechas para que realicen la ruta
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => setShowAddDay(true)}
                disabled={routePdvs.length === 0}
              >
                <Plus size={18} className="mr-2" />
                Agregar día
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {routeDays.map((d) => {
                const user = users.find((u) => u.UserId === d.AssignedUserId);
                return (
                  <div
                    key={d.RouteDayId}
                    className="flex items-center gap-3 p-3 bg-muted rounded-lg hover:bg-secondary transition-colors"
                  >
                    <Calendar size={18} className="text-muted-foreground" />
                    <span className="text-sm font-medium text-muted-foreground">
                      {new Date(d.WorkDate).toLocaleDateString("es-AR", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                    <User size={16} className="text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {user?.DisplayName ?? user?.Email ?? `Usuario #${d.AssignedUserId}`}
                    </span>
                    <Badge variant="outline" className="ml-auto text-xs">
                      {d.Status}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveDay(d.RouteDayId)}
                      disabled={saving}
                    >
                      <Trash2 size={16} className="text-red-500" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
