import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router";
import { Card, CardContent } from "../../components/ui/card";
import { ConfirmModal } from "../../components/ui/modal";
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
  holidaysApi,
  mandatoryActivitiesApi,
  useApiList,
  BEJERMAN_ZONES,
} from "@/lib/api";
import type { MandatoryActivity } from "@/lib/api";
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
  const isCreateMode = !id;
  const isMyRoute = window.location.pathname.startsWith("/my-routes");
  const backPath = isMyRoute ? "/my-routes" : "/admin/routes";

  const [route, setRoute] = useState<Awaited<ReturnType<typeof routesApi.get>> | null>(null);
  const [routePdvs, setRoutePdvs] = useState<Awaited<ReturnType<typeof routesApi.listPdvs>>>([]);
  const [pdvAssignments, setPdvAssignments] = useState<{ pdvId: number; routeId: number }[]>([]);
  const [routeForms, setRouteForms] = useState<Awaited<ReturnType<typeof routesApi.listForms>>>([]);
  const [routeDays, setRouteDays] = useState<Awaited<ReturnType<typeof routesApi.listDays>>>([]);
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [confirmRemoveDayId, setConfirmRemoveDayId] = useState<number | null>(null);
  const [confirmRemoveFormId, setConfirmRemoveFormId] = useState<number | null>(null);

  // --- Create mode: local draft PDV ids (not yet persisted) ---
  const [draftPdvIds, setDraftPdvIds] = useState<number[]>([]);
  const [showBackConfirm, setShowBackConfirm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showAddDay, setShowAddDay] = useState(false);
  const [newDayUser, setNewDayUser] = useState<number | "">("");
  const [newDayDate, setNewDayDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [newDayHoliday, setNewDayHoliday] = useState<string | null>(null);

  // PDV section state
  const [pdvViewMode, setPdvViewMode] = useState<"list" | "map">("list");
  const [pdvSearch, setPdvSearch] = useState("");
  const [pdvFilterChannel, setPdvFilterChannel] = useState<string>("all");
  const [pdvFilterCity, setPdvFilterCity] = useState<string>("all");
  const [pdvFilterZoneId, setPdvFilterZoneId] = useState<string>("all");
  const [selectedInfoPdv, setSelectedInfoPdv] = useState<number | null>(null);

  // All PDVs cache (loaded individually for route PDVs)
  const [pdvCache, setPdvCache] = useState<Map<number, Pdv>>(new Map());

  const currentUser = getCurrentUser();
  const isAdmin = ["admin", "regional_manager", "territory_manager"].includes(currentUser.role);
  const { data: allPdvs, loading: pdvsLoading } = usePdvs();
  const { data: zones } = useZones();
  const { data: forms } = useForms();
  const { data: users } = useUsers();
  const { data: allActivities, refetch: refetchActivities } = useApiList(
    () => mandatoryActivitiesApi.list({ active_only: true })
  );

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
      const [r, rp, rf, rd, assignments] = await Promise.all([
        routesApi.get(id),
        routesApi.listPdvs(id),
        routesApi.listForms(id),
        routesApi.listDays(id),
        routesApi.listPdvAssignments().catch(() => [] as { pdvId: number; routeId: number }[]),
      ]);
      setRoute(r);
      setRoutePdvs(rp.sort((a, b) => a.SortOrder - b.SortOrder));
      setRouteForms(rf);
      setRouteDays(rd.sort((a, b) => a.WorkDate.localeCompare(b.WorkDate)));
      setPdvAssignments(assignments);
    } catch (e) {
      toast.error("Error al cargar ruta");
      navigate(backPath);
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    loadRoute();
  }, [loadRoute]);

  // In create mode, load assignments separately (loadRoute skips when no id)
  useEffect(() => {
    if (isCreateMode) {
      routesApi.listPdvAssignments()
        .then((a) => setPdvAssignments(a))
        .catch(() => {});
    }
  }, [isCreateMode]);

  // Build PDV cache from allPdvs
  useEffect(() => {
    if (allPdvs.length > 0) {
      setPdvCache(new Map(allPdvs.map((p) => [p.PdvId, p])));
    }
  }, [allPdvs]);

  // IDs of PDVs already in route (include draft in create mode)
  const routePdvIds = useMemo(() => {
    const ids = new Set(routePdvs.map((rp) => rp.PdvId));
    if (isCreateMode) draftPdvIds.forEach((id) => ids.add(id));
    return ids;
  }, [routePdvs, draftPdvIds, isCreateMode]);

  // Ordered PDV objects in route
  const orderedPdvs = useMemo(() => {
    if (isCreateMode) {
      return draftPdvIds
        .map((id) => pdvCache.get(id))
        .filter(Boolean) as Pdv[];
    }
    return routePdvs
      .map((rp) => pdvCache.get(rp.PdvId))
      .filter(Boolean) as Pdv[];
  }, [routePdvs, pdvCache, draftPdvIds, isCreateMode]);

  // Route distances
  const distances = useMemo(() => segmentDistances(orderedPdvs), [orderedPdvs]);
  const totalKm = useMemo(() => totalRouteKm(orderedPdvs), [orderedPdvs]);

  // PDVs assigned to OTHER routes (excluding this one) — exclusivity
  const pdvIdsInOtherRoutes = useMemo(() => {
    const s = new Set<number>();
    for (const a of pdvAssignments) {
      if (a.routeId !== id) s.add(a.pdvId);
    }
    return s;
  }, [pdvAssignments, id]);

  // Distinct values for filters (only over PDVs not yet in this route)
  const availableChannels = useMemo(() => {
    const set = new Set<string>();
    allPdvs.forEach((p) => {
      const ch = p.ChannelName || p.Channel;
      if (ch) set.add(ch);
    });
    return Array.from(set).sort();
  }, [allPdvs]);

  const availableCities = useMemo(() => {
    const set = new Set<string>();
    allPdvs.forEach((p) => { if (p.City) set.add(p.City); });
    return Array.from(set).sort();
  }, [allPdvs]);

  // Available PDVs filtered by search + filters
  const filteredAvailablePdvs = useMemo(() => {
    const search = pdvSearch.toLowerCase();
    return allPdvs.filter((p) => {
      if (routePdvIds.has(p.PdvId)) return false;
      if (pdvIdsInOtherRoutes.has(p.PdvId)) return false;
      if (pdvFilterChannel !== "all" && (p.ChannelName || p.Channel) !== pdvFilterChannel) return false;
      if (pdvFilterCity !== "all" && p.City !== pdvFilterCity) return false;
      if (pdvFilterZoneId !== "all" && String(p.ZoneId ?? "") !== pdvFilterZoneId) return false;
      if (!search) return true;
      return (
        p.Name.toLowerCase().includes(search) ||
        (p.Address || "").toLowerCase().includes(search) ||
        (p.City || "").toLowerCase().includes(search)
      );
    });
  }, [allPdvs, routePdvIds, pdvIdsInOtherRoutes, pdvSearch, pdvFilterChannel, pdvFilterCity, pdvFilterZoneId]);

  const activePdvFilterCount =
    (pdvFilterChannel !== "all" ? 1 : 0) +
    (pdvFilterCity !== "all" ? 1 : 0) +
    (pdvFilterZoneId !== "all" ? 1 : 0);

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
    if (isCreateMode) {
      setDraftPdvIds((prev) => [...prev, pdvId]);
      toast.success("PDV agregado");
      return;
    }
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
      setPdvAssignments((prev) => [...prev, { pdvId, routeId: id }]);
      // Backend invalida IsOptimized — reflejarlo localmente
      setRoute((prev) => (prev ? { ...prev, IsOptimized: false } : prev));
      toast.success("PDV agregado a la ruta");
    } catch (e: any) {
      console.error("Error adding PDV:", e);
      toast.error(e?.message || "Error al agregar PDV");
    } finally {
      setSaving(false);
    }
  };

  const handleRemovePdv = async (pdvId: number) => {
    if (isCreateMode) {
      setDraftPdvIds((prev) => prev.filter((id) => id !== pdvId));
      toast.success("PDV quitado");
      return;
    }
    if (!id || saving) return;
    setSaving(true);
    try {
      await routesApi.removePdv(id, pdvId);
      setRoutePdvs((prev) => prev.filter((rp) => rp.PdvId !== pdvId));
      setPdvAssignments((prev) => prev.filter((a) => !(a.pdvId === pdvId && a.routeId === id)));
      setRoute((prev) => (prev ? { ...prev, IsOptimized: false } : prev));
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
      // Re-add with new SortOrder (backend updates in-place if same route)
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
      const updated = await routesApi.update(id, { IsOptimized: true });
      setRoute(updated);
      setRouteDraft((d) => (d ? { ...d } : null));
      toast.success("Ruta optimizada por distancia");
    } catch (e: any) {
      toast.error(e?.message ?? "Error al optimizar");
    } finally {
      setSaving(false);
    }
  };

  // --- Touch drag & drop reorder ---
  const listRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ index: number; startY: number; currentY: number } | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  const applyReorder = async (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const newOrder = [...orderedPdvs];
    const [moved] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, moved);

    setRoutePdvs(newOrder.map((p, i) => ({
      RouteId: id!,
      PdvId: p.PdvId,
      SortOrder: i,
      Priority: routePdvs.find((rp) => rp.PdvId === p.PdvId)?.Priority ?? 3,
    })));

    if (id) {
      try {
        await routesApi.reorderPdvs(id, newOrder.map((p) => p.PdvId));
      } catch {
        toast.error("Error al reordenar");
      }
    }
  };

  const handleTouchStart = (e: React.TouchEvent, index: number) => {
    const touch = e.touches[0];
    dragState.current = { index, startY: touch.clientY, currentY: touch.clientY };
    setDraggingIndex(index);
    setDragOffset(0);
  };

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!dragState.current || !listRef.current) return;
    e.preventDefault();
    const touch = e.touches[0];
    dragState.current.currentY = touch.clientY;
    setDragOffset(touch.clientY - dragState.current.startY);
  }, []);

  const handleTouchEnd = useCallback(async () => {
    if (!dragState.current || !listRef.current) return;
    const { index } = dragState.current;
    const cards = listRef.current.querySelectorAll("[data-pdv-card]");
    const cardHeight = (cards[0] as HTMLElement)?.offsetHeight ?? 60;
    const offset = dragState.current.currentY - dragState.current.startY;
    const moveBy = Math.round(offset / cardHeight);
    const toIndex = Math.max(0, Math.min(orderedPdvs.length - 1, index + moveBy));

    dragState.current = null;
    setDraggingIndex(null);
    setDragOffset(0);

    await applyReorder(index, toIndex);
  }, [orderedPdvs, id, routePdvs]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd);
    return () => {
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleTouchMove, handleTouchEnd]);

  const handleMoveUp = (index: number) => { if (index > 0) applyReorder(index, index - 1); };
  const handleMoveDown = (index: number) => { if (index < orderedPdvs.length - 1) applyReorder(index, index + 1); };

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

  /** Auto-generate route days from frequency config */
  const handleGenerateDays = async (weeksAhead: number = 8) => {
    if (!id || !routeDraft?.FrequencyType || !route?.AssignedUserId) return;
    setSaving(true);
    try {
      const ft = routeDraft.FrequencyType;
      const config = routeDraft.FrequencyConfig ? JSON.parse(routeDraft.FrequencyConfig) : {};
      const dates: string[] = [];
      const today = new Date();
      const startDate = config.startDate ? new Date(config.startDate + "T12:00:00") : today;
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() + weeksAhead * 7);

      // Existing dates to avoid duplicates
      const existingDates = new Set(routeDays.map((d) => d.WorkDate.split("T")[0]));

      if (ft === "daily") {
        const d = new Date(Math.max(today.getTime(), startDate.getTime()));
        while (d <= endDate) {
          const dow = d.getDay();
          if (dow >= 1 && dow <= 5) { // Mon-Fri
            const ds = d.toISOString().split("T")[0];
            if (!existingDates.has(ds)) dates.push(ds);
          }
          d.setDate(d.getDate() + 1);
        }
      } else if (ft === "weekly" && config.day != null) {
        const d = new Date(Math.max(today.getTime(), startDate.getTime()));
        // Find next occurrence of config.day
        while (d.getDay() !== config.day) d.setDate(d.getDate() + 1);
        while (d <= endDate) {
          const ds = d.toISOString().split("T")[0];
          if (!existingDates.has(ds)) dates.push(ds);
          d.setDate(d.getDate() + 7);
        }
      } else if (ft === "biweekly" && config.day != null) {
        const d = new Date(Math.max(today.getTime(), startDate.getTime()));
        // Find next occurrence of config.day
        while (d.getDay() !== config.day) d.setDate(d.getDate() + 1);
        // Align to the correct biweekly cycle from startDate
        if (config.startDate) {
          const anchor = new Date(config.startDate + "T12:00:00");
          while (anchor.getDay() !== config.day) anchor.setDate(anchor.getDate() + 1);
          const diffDays = Math.round((d.getTime() - anchor.getTime()) / 86400000);
          const weeksOff = diffDays % 14;
          if (weeksOff !== 0) d.setDate(d.getDate() + (14 - weeksOff));
        }
        while (d <= endDate) {
          const ds = d.toISOString().split("T")[0];
          if (!existingDates.has(ds)) dates.push(ds);
          d.setDate(d.getDate() + 14);
        }
      } else if (ft === "every_x_days" && config.interval) {
        const d = new Date(config.startDate ? startDate : today);
        while (d <= endDate) {
          if (d >= today) {
            const ds = d.toISOString().split("T")[0];
            if (!existingDates.has(ds)) dates.push(ds);
          }
          d.setDate(d.getDate() + config.interval);
        }
      } else if (ft === "specific_days" && config.days?.length > 0) {
        const d = new Date(today);
        while (d <= endDate) {
          if (config.days.includes(d.getDay())) {
            const ds = d.toISOString().split("T")[0];
            if (!existingDates.has(ds)) dates.push(ds);
          }
          d.setDate(d.getDate() + 1);
        }
      }

      if (dates.length === 0) {
        setSaving(false);
        return;
      }

      // Create each day
      let created = 0;
      for (const dt of dates) {
        try {
          const day = await routesApi.createDay(id, { WorkDate: dt });
          setRouteDays((prev) => [...prev, day].sort((a, b) => a.WorkDate.localeCompare(b.WorkDate)));
          created++;
        } catch { /* skip duplicates */ }
      }
      toast.success(`${created} días generados`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al generar días");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveDay = async (routeDayId: number) => {
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
    if (!id) return;
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
    } else if (isCreateMode) {
      // Initialize empty draft for create mode
      setRouteDraft({
        Name: "",
        ZoneId: null,
        BejermanZone: null,
        EstimatedMinutes: null,
        FrequencyType: null,
        FrequencyConfig: null,
        AssignedUserId: isMyRoute ? Number(getCurrentUser().id) : null,
      });
    } else {
      setRouteDraft(null);
    }
  }, [route, isCreateMode, isMyRoute]);

  // Parse frequency config
  const frequencyConfigParsed = useMemo(() => {
    if (!routeDraft?.FrequencyConfig) return {};
    try {
      return JSON.parse(routeDraft.FrequencyConfig) || {};
    } catch {
      return {};
    }
  }, [routeDraft?.FrequencyConfig]);

  const frequencyDays: number[] = frequencyConfigParsed.days || [];
  const frequencyStartDate: string = frequencyConfigParsed.startDate || "";

  const updateFrequencyConfig = (patch: Record<string, unknown>) => {
    setRouteDraft((d) => {
      if (!d) return null;
      const next = { ...frequencyConfigParsed, ...patch };
      // Strip empty/undefined values
      Object.keys(next).forEach((k) => {
        if (next[k] === undefined || next[k] === "") delete next[k];
      });
      return { ...d, FrequencyConfig: JSON.stringify(next) };
    });
  };

  const toggleFrequencyDay = (day: number) => {
    const current = [...frequencyDays];
    const idx = current.indexOf(day);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(day);
    current.sort();
    updateFrequencyConfig({ days: current });
  };

  // Track if user has touched anything in create mode
  const createModeDirty = isCreateMode && (draftPdvIds.length > 0 || (routeDraft?.Name ?? "").trim().length > 0);

  const handleBackClick = () => {
    if (isCreateMode && createModeDirty) {
      setShowBackConfirm(true);
    } else {
      navigate(backPath);
    }
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
      const frequencyChanged =
        (routeDraft.FrequencyType ?? "") !== (route?.FrequencyType ?? "") ||
        (routeDraft.FrequencyConfig ?? "") !== (route?.FrequencyConfig ?? "");

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

      // Auto-generate days when frequency changes, TM is assigned, and there are PDVs
      if (frequencyChanged && routeDraft.FrequencyType && updated.AssignedUserId && routePdvs.length > 0) {
        // Reload days (backend deleted old PLANNED days on freq change)
        const freshDays = await routesApi.listDays(id);
        setRouteDays(freshDays);
        await handleGenerateDays(8);
      }

      // Check for overlap with other routes of the same TM
      if (updated.AssignedUserId) {
        try {
          const overlap = await routesApi.checkOverlap(id);
          if (overlap.hasOverlap) {
            const routeNames = [...new Set(overlap.overlaps.map((o: { routeName: string }) => o.routeName))];
            toast.warning(
              `Solapamiento con: ${routeNames.join(", ")} (${overlap.overlaps.length} días en común)`,
              { duration: 6000 },
            );
          }
        } catch { /* overlap check is best-effort */ }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  // --- Create mode: handle the actual creation on button click ---
  const handleCreateRoute = async () => {
    if (!routeDraft?.Name?.trim()) {
      toast.error("Ponele un nombre a la ruta");
      return;
    }
    setCreating(true);
    try {
      const currentUser = getCurrentUser();
      const newRoute = await routesApi.create({
        Name: routeDraft.Name.trim(),
        ZoneId: routeDraft.ZoneId ?? undefined,
        BejermanZone: routeDraft.BejermanZone ?? undefined,
        AssignedUserId: isMyRoute ? Number(currentUser.id) : (routeDraft.AssignedUserId ?? undefined),
        FrequencyType: routeDraft.FrequencyType ?? undefined,
        FrequencyConfig: routeDraft.FrequencyConfig ?? undefined,
      });
      // Add draft PDVs
      for (let i = 0; i < draftPdvIds.length; i++) {
        try {
          await routesApi.addPdv(newRoute.RouteId, {
            PdvId: draftPdvIds[i],
            SortOrder: i,
            Priority: 3,
          });
        } catch { /* skip */ }
      }
      toast.success("Ruta creada");
      const editPath = isMyRoute
        ? `/my-routes/${newRoute.RouteId}/edit`
        : `/admin/routes/${newRoute.RouteId}/edit`;
      navigate(editPath, { replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al crear ruta");
    } finally {
      setCreating(false);
    }
  };

  if (loading || (!route && !isCreateMode)) {
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
          onClick={handleBackClick}
          className="p-2 hover:bg-muted rounded-lg transition-colors"
        >
          <ArrowLeft size={24} />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">
            {isCreateMode ? "Crear Ruta Foco" : "Editar Ruta Foco"}
          </h1>
          <p className="text-muted-foreground">{routeDraft?.Name || (route?.Name ?? "Nueva ruta")}</p>
        </div>
        {!isCreateMode && (route?.IsOptimized ? (
          <Badge className="bg-green-100 text-green-700 border-green-200 gap-1">
            <Zap size={12} /> Optimizada
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground gap-1">
            <Zap size={12} className="opacity-50" /> Sin optimizar
          </Badge>
        ))}
      </div>

      {/* Route Info */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground">Datos de la ruta</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={isMyRoute ? "md:col-span-2" : ""}>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Nombre</label>
              <Input
                value={routeDraft?.Name ?? ""}
                onChange={(e) =>
                  setRouteDraft((d) => (d ? { ...d, Name: e.target.value } : null))
                }
                placeholder="Ej: Ruta Norte - Kioscos"
              />
            </div>
            {!isMyRoute && (
              <>
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
              </>
            )}
            {!isMyRoute && (
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
            {!isMyRoute && <><div className="md:col-span-2">
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
                      onClick={() => setConfirmRemoveFormId(rf.FormId)}
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

            {/* Acciones obligatorias asignadas a esta ruta */}
            <div className="md:col-span-2 pt-4 border-t border-border">
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Acciones de ejecución
              </label>
              <p className="text-sm text-muted-foreground mb-2">
                Acciones que el TM Rep debe ejecutar en cada visita de esta ruta
              </p>
              <div className="flex flex-wrap gap-2 mb-2">
                {allActivities
                  .filter((a) => a.RouteId === id)
                  .map((a) => (
                    <Badge
                      key={a.MandatoryActivityId}
                      variant="secondary"
                      className="flex items-center gap-1 pr-1"
                    >
                      {a.Name}
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await mandatoryActivitiesApi.update(a.MandatoryActivityId, { RouteId: null } as any);
                            refetchActivities();
                            toast.success("Acción desvinculada de la ruta");
                          } catch { toast.error("Error"); }
                        }}
                        disabled={saving}
                        className="ml-1 p-0.5 hover:bg-secondary rounded"
                      >
                        <Trash2 size={14} />
                      </button>
                    </Badge>
                  ))}
              </div>
              <select
                className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-espert-gold text-sm"
                value=""
                onChange={async (e) => {
                  const actId = e.target.value ? Number(e.target.value) : 0;
                  e.target.value = "";
                  if (!actId) return;
                  try {
                    await mandatoryActivitiesApi.update(actId, { RouteId: id } as any);
                    refetchActivities();
                    toast.success("Acción vinculada a la ruta");
                  } catch { toast.error("Error"); }
                }}
                disabled={saving}
              >
                <option value="">Agregar acción de ejecución...</option>
                {allActivities
                  .filter((a) => !a.RouteId || a.RouteId === id)
                  .filter((a) => a.RouteId !== id)
                  .map((a) => (
                    <option key={a.MandatoryActivityId} value={a.MandatoryActivityId}>
                      {a.Name} ({a.ActionType})
                    </option>
                  ))}
              </select>
            </div></>}
          </div>
        </CardContent>
      </Card>

      {/* Trade Marketer + Frecuencia */}
      <div className={`grid grid-cols-1 ${!isMyRoute ? "md:grid-cols-2" : ""} gap-6`}>
        {/* Trade Marketer — solo admin */}
        {!isMyRoute && (
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
            </CardContent>
          </Card>
        )}

        {/* Frecuencia — chips visuales */}
        <Card>
          <CardContent className="p-6">
            <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
              <Calendar size={20} />
              Frecuencia
            </h3>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {[
                  { value: "", label: "Sin definir" },
                  { value: "daily", label: "Diaria" },
                  { value: "weekly", label: "Semanal" },
                  { value: "biweekly", label: "Quincenal" },
                  { value: "monthly", label: "Mensual" },
                  { value: "specific_days", label: "Días específicos" },
                  { value: "every_x_days", label: "Cada X días" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      const ft = opt.value || null;
                      setRouteDraft((d) => {
                        if (!d) return null;
                        let config = d.FrequencyConfig;
                        if (ft === "specific_days" && !config) config = JSON.stringify({ days: [] });
                        else if (ft === "every_x_days") config = JSON.stringify({ interval: 15 });
                        else if (ft === "weekly" || ft === "biweekly") {
                          const prev = config ? JSON.parse(config) : {};
                          config = JSON.stringify({ day: prev.day, startDate: prev.startDate });
                        } else if (ft && ft !== "specific_days") config = null;
                        return { ...d, FrequencyType: ft, FrequencyConfig: config };
                      });
                    }}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                      (routeDraft?.FrequencyType ?? "") === opt.value
                        ? "bg-[#A48242] text-white"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Specific days selector */}
              {routeDraft?.FrequencyType === "specific_days" && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Seleccioná los días:</p>
                  <div className="flex gap-1.5">
                    {["D", "L", "M", "X", "J", "V", "S"].map((label, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => toggleFrequencyDay(idx)}
                        className={`w-10 h-10 rounded-full text-sm font-bold transition-colors ${
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

              {/* Weekly / Biweekly: pick day */}
              {(routeDraft?.FrequencyType === "weekly" || routeDraft?.FrequencyType === "biweekly") && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    {routeDraft?.FrequencyType === "biweekly" ? "¿Qué día de la semana? (cada 2 semanas)" : "¿Qué día de la semana?"}
                  </p>
                  <div className="flex gap-1.5">
                    {["D", "L", "M", "X", "J", "V", "S"].map((label, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => updateFrequencyConfig({ day: idx })}
                        className={`w-10 h-10 rounded-full text-sm font-bold transition-colors ${
                          frequencyConfigParsed.day === idx
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

              {/* Every X days: interval */}
              {routeDraft?.FrequencyType === "every_x_days" && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">Cada</span>
                  <Input
                    type="number"
                    min={1}
                    max={90}
                    value={frequencyConfigParsed.interval ?? 15}
                    onChange={(e) => updateFrequencyConfig({ interval: Number(e.target.value) || 15 })}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">días</span>
                </div>
              )}

              {/* Start date — always visible when frequency is set */}
              {routeDraft?.FrequencyType && (
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Fecha de inicio</label>
                  <Input
                    type="date"
                    value={frequencyStartDate}
                    onChange={(e) => updateFrequencyConfig({ startDate: e.target.value })}
                    className="max-w-xs"
                  />
                </div>
              )}

              {/* Summary */}
              {routeDraft?.FrequencyType && (() => {
                const desde = frequencyStartDate ? ` · Desde ${frequencyStartDate}` : " · Elegí fecha de inicio";
                const freq = routeDraft.FrequencyType;
                let text = "";
                if (freq === "daily") text = `Todos los días hábiles${desde}`;
                else if (freq === "weekly") text = frequencyConfigParsed.day != null
                  ? `Todos los ${["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"][frequencyConfigParsed.day]}${desde}`
                  : "Seleccioná el día de la semana";
                else if (freq === "biweekly") text = frequencyConfigParsed.day != null
                  ? `Cada 2 semanas, los ${["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"][frequencyConfigParsed.day]}${desde}`
                  : "Seleccioná el día de la semana";
                else if (freq === "monthly") text = `Una vez al mes${desde}`;
                else if (freq === "specific_days") text = frequencyDays.length > 0
                  ? `Los ${frequencyDays.map((d: number) => ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][d]).join(", ")}${desde}`
                  : "Seleccioná al menos un día";
                else if (freq === "every_x_days") text = `Cada ${frequencyConfigParsed.interval || 15} días${desde}`;
                return <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">{text}</p>;
              })()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* PDVs en la ruta */}
      <Card>
        <CardContent className="p-4 sm:p-6">
          {/* Header with stats */}
          <div className="space-y-3 mb-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground flex items-center gap-2 text-base">
                <MapPin size={18} />
                PDVs ({orderedPdvs.length})
              </h3>
              <div className="flex items-center gap-2">
                {orderedPdvs.length >= 2 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOptimizeRoute}
                    disabled={saving}
                    className="gap-1 text-xs h-8"
                  >
                    <Zap size={13} />
                    <span className="hidden sm:inline">Optimizar</span>
                  </Button>
                )}
                <div className="flex rounded-lg border border-border overflow-hidden">
                  <button
                    onClick={() => setPdvViewMode("list")}
                    className={`px-2 py-1.5 text-xs transition-colors ${
                      pdvViewMode === "list"
                        ? "bg-[#A48242] text-white"
                        : "bg-card text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <List size={14} />
                  </button>
                  <button
                    onClick={() => setPdvViewMode("map")}
                    className={`px-2 py-1.5 text-xs transition-colors ${
                      pdvViewMode === "map"
                        ? "bg-[#A48242] text-white"
                        : "bg-card text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <MapIcon size={14} />
                  </button>
                </div>
              </div>
            </div>
            {totalKm > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="gap-1 text-xs">
                  <Route size={11} />
                  {totalKm.toFixed(1)} km
                </Badge>
                <Badge variant="outline" className="gap-1 text-xs text-blue-600 border-blue-200">
                  🚶 {formatMinutes(totalKm / WALK_KMH * 60)}
                </Badge>
                <Badge variant="outline" className="gap-1 text-xs text-green-600 border-green-200">
                  🚗 {formatMinutes(totalKm / DRIVE_KMH * 60)}
                </Badge>
              </div>
            )}
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
                    const inOtherRoute = !inRoute && pdvIdsInOtherRoutes.has(p.PdvId);
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
                            : inOtherRoute
                            ? {
                                path: google.maps.SymbolPath.CIRCLE,
                                fillColor: "#ef4444",
                                fillOpacity: 0.7,
                                strokeColor: "#fff",
                                strokeWeight: 1,
                                scale: 9,
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
                    const inOther = pdvIdsInOtherRoutes.has(p.PdvId);
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
                          <p className="text-xs text-gray-500 mb-1">{p.ChannelName || p.Channel}</p>
                          {inOther && !inRoute && (
                            <p className="text-xs text-red-500 font-medium mb-1">Asignado a otra ruta</p>
                          )}
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
              <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-[#A48242] inline-block" />
                  En esta ruta
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-red-500/70 inline-block" />
                  En otra ruta
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-gray-400/50 inline-block" />
                  Disponible
                </span>
              </div>
            </div>
          ) : (
            /* ========== LIST VIEW ========== */
            <div className="space-y-4">
              {/* Current route PDVs */}
              {orderedPdvs.length > 0 && (
                <div className="space-y-1" ref={listRef}>
                  {orderedPdvs.map((pdv, index) => (
                    <div
                      key={pdv.PdvId}
                      data-pdv-card
                      className={`p-3 bg-muted rounded-lg hover:bg-secondary transition-all ${
                        draggingIndex === index ? "opacity-70 scale-95 shadow-lg z-10 relative" : ""
                      }`}
                      style={draggingIndex === index ? { transform: `translateY(${dragOffset}px) scale(0.95)` } : undefined}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="flex flex-col items-center shrink-0 touch-none select-none cursor-grab active:cursor-grabbing"
                          onTouchStart={(e) => handleTouchStart(e, index)}
                        >
                          <button
                            onClick={() => handleMoveUp(index)}
                            disabled={index === 0}
                            className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6"/></svg>
                          </button>
                          <GripVertical size={16} className="text-muted-foreground" />
                          <button
                            onClick={() => handleMoveDown(index)}
                            disabled={index === orderedPdvs.length - 1}
                            className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
                          </button>
                        </div>
                        <span className="w-6 text-xs font-bold text-[#A48242] shrink-0">#{index + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground text-sm truncate">{pdv.Name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <p className="text-[11px] text-muted-foreground truncate">{pdv.Address || pdv.City || "-"}</p>
                            <Badge variant="outline" className="text-[9px] py-0 shrink-0">{pdv.ChannelName || pdv.Channel}</Badge>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemovePdv(pdv.PdvId)}
                          disabled={saving}
                          className="shrink-0 p-1.5 text-red-400 hover:text-red-600"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      {index > 0 && distances[index - 1] > 0 && (
                        <div className="flex items-center gap-2 mt-1.5 ml-8 text-[10px] text-muted-foreground">
                          <span>{distances[index - 1].toFixed(1)} km</span>
                          <span className="text-blue-600">🚶 {formatMinutes(distances[index - 1] / WALK_KMH * 60)}</span>
                          <span className="text-green-600">🚗 {formatMinutes(distances[index - 1] / DRIVE_KMH * 60)}</span>
                        </div>
                      )}
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
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h4 className="text-sm font-semibold text-muted-foreground">
                    PDVs disponibles ({filteredAvailablePdvs.length})
                  </h4>
                  {activePdvFilterCount > 0 && (
                    <button
                      onClick={() => {
                        setPdvFilterChannel("all");
                        setPdvFilterCity("all");
                        setPdvFilterZoneId("all");
                      }}
                      className="text-xs text-destructive hover:underline"
                    >
                      Limpiar filtros ({activePdvFilterCount})
                    </button>
                  )}
                </div>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                  <Input
                    placeholder="Buscar por nombre, dirección o ciudad..."
                    value={pdvSearch}
                    onChange={(e) => setPdvSearch(e.target.value)}
                    className="pl-9 text-sm"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                  <select
                    className="px-2.5 py-1.5 text-xs border border-border rounded-lg focus:ring-2 focus:ring-espert-gold"
                    value={pdvFilterChannel}
                    onChange={(e) => setPdvFilterChannel(e.target.value)}
                  >
                    <option value="all">Todos los canales</option>
                    {availableChannels.map((ch) => (
                      <option key={ch} value={ch}>{ch}</option>
                    ))}
                  </select>
                  <select
                    className="px-2.5 py-1.5 text-xs border border-border rounded-lg focus:ring-2 focus:ring-espert-gold"
                    value={pdvFilterCity}
                    onChange={(e) => setPdvFilterCity(e.target.value)}
                  >
                    <option value="all">Todas las ciudades</option>
                    {availableCities.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <select
                    className="px-2.5 py-1.5 text-xs border border-border rounded-lg focus:ring-2 focus:ring-espert-gold"
                    value={pdvFilterZoneId}
                    onChange={(e) => setPdvFilterZoneId(e.target.value)}
                  >
                    <option value="all">Todas las zonas</option>
                    {zones.map((z) => (
                      <option key={z.ZoneId} value={String(z.ZoneId)}>{z.Name}</option>
                    ))}
                  </select>
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

      {/* Días de ruta — auto-generados desde frecuencia */}
      {!isMyRoute && (<Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Calendar size={20} />
              Días programados ({routeDays.length})
            </h3>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleGenerateDays(8)}
                disabled={saving || !routeDraft?.FrequencyType || !route?.AssignedUserId || routePdvs.length === 0}
                title={
                  !route?.AssignedUserId ? "Asigná un Trade Marketer primero"
                  : !routeDraft?.FrequencyType ? "Configurá la frecuencia primero"
                  : "Generar próximas 8 semanas"
                }
                className="gap-1"
              >
                <Zap size={14} />
                Generar días
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAddDay(!showAddDay)}
                disabled={!route?.AssignedUserId || routePdvs.length === 0}
                title="Agregar un día manualmente"
              >
                <Plus size={16} />
              </Button>
            </div>
          </div>

          {showAddDay && (
            <div className="mb-4 p-3 bg-muted rounded-lg flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs text-muted-foreground mb-1">Fecha manual</label>
                <input
                  type="date"
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm"
                  value={newDayDate}
                  onChange={(e) => setNewDayDate(e.target.value)}
                />
              </div>
              <Button size="sm" onClick={handleAddDay} disabled={saving}>
                Agregar
              </Button>
            </div>
          )}

          {!route?.AssignedUserId && (
            <div className="border-2 border-dashed border-amber-300 bg-amber-50 rounded-lg p-4 mb-4 text-center">
              <p className="text-sm text-amber-700 font-medium">
                Asigná un Trade Marketer en la sección de arriba para poder programar días
              </p>
            </div>
          )}

          {!routeDraft?.FrequencyType && route?.AssignedUserId && (
            <div className="border-2 border-dashed border-blue-200 bg-blue-50 rounded-lg p-4 mb-4 text-center">
              <p className="text-sm text-blue-700 font-medium">
                Configurá la frecuencia arriba y después usá "Generar días" para programar automáticamente
              </p>
            </div>
          )}

          {routeDays.length === 0 && routeDraft?.FrequencyType ? (
            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
              <Calendar size={40} className="mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground font-medium">Sin días generados</p>
              <p className="text-sm text-muted-foreground mt-1">
                Hacé click en "Generar días" para crear las próximas 8 semanas automáticamente
              </p>
              <Button
                className="mt-4 bg-[#A48242] hover:bg-[#8B6E38] text-white"
                onClick={() => handleGenerateDays(8)}
                disabled={saving || !route?.AssignedUserId || routePdvs.length === 0}
              >
                <Zap size={16} className="mr-2" />
                Generar próximas 8 semanas
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
                      onClick={() => setConfirmRemoveDayId(d.RouteDayId)}
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
      </Card>)}
      {/* Confirm remove day */}
      <ConfirmModal
        isOpen={confirmRemoveDayId !== null}
        onClose={() => setConfirmRemoveDayId(null)}
        onConfirm={() => { if (confirmRemoveDayId !== null) handleRemoveDay(confirmRemoveDayId); }}
        title="Eliminar día"
        message="¿Eliminar este día de la ruta?"
        confirmText="Eliminar"
        type="danger"
      />

      {/* Confirm remove form */}
      <ConfirmModal
        isOpen={confirmRemoveFormId !== null}
        onClose={() => setConfirmRemoveFormId(null)}
        onConfirm={() => { if (confirmRemoveFormId !== null) handleRemoveForm(confirmRemoveFormId); }}
        title="Quitar formulario"
        message="¿Quitar este formulario de la ruta?"
        confirmText="Quitar"
        type="danger"
      />

      {/* Confirm back in create mode */}
      <ConfirmModal
        isOpen={showBackConfirm}
        onClose={() => setShowBackConfirm(false)}
        onConfirm={() => navigate(backPath)}
        title="Salir sin crear"
        message="¿Seguro que querés salir? Los datos de la ruta que cargaste se van a perder."
        confirmText="Salir"
        type="danger"
      />

      {/* Save button — sticky at bottom (edit mode) */}
      {!isCreateMode && routeDraft && routeMetadataDirty && (
        <div className="sticky bottom-0 bg-background border-t border-border p-4 -mx-6 -mb-6 mt-6">
          <Button
            className="w-full bg-[#A48242] hover:bg-[#8B6E38] text-white h-12 text-base font-semibold"
            onClick={handleSaveRouteMetadata}
            disabled={saving || !routeDraft.Name?.trim()}
          >
            <Save size={16} className="mr-2" />
            {saving ? "Guardando..." : "Guardar cambios"}
          </Button>
        </div>
      )}

      {/* Create button — sticky at bottom */}
      {isCreateMode && (
        <div className="sticky bottom-0 bg-background border-t border-border p-4 -mx-6 -mb-6 mt-6">
          <Button
            className="w-full bg-[#A48242] hover:bg-[#8B6E38] text-white h-12 text-base font-semibold"
            onClick={handleCreateRoute}
            disabled={creating || !routeDraft?.Name?.trim()}
          >
            {creating ? "Creando..." : "Crear Ruta Foco"}
          </Button>
        </div>
      )}
    </div>
  );
}
