import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import {
  ArrowLeft,
  Plus,
  MapPin,
  Trash2,
  GripVertical,
  Calendar,
  Save,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import {
  routesApi,
  usePdvs,
  useForms,
  pdvsApi,
  notificationsApi,
  useMyRoutes,
  BEJERMAN_ZONES,
} from "@/lib/api";
import { toast } from "sonner";
import { getCurrentUser } from "../lib/auth";
import { todayAR } from "../lib/dateUtils";

const FREQUENCY_OPTIONS = [
  { value: "daily", label: "Diaria" },
  { value: "weekly", label: "Semanal" },
  { value: "biweekly", label: "Quincenal" },
  { value: "monthly", label: "Mensual" },
  { value: "specific_days", label: "Días específicos" },
  { value: "every_x_days", label: "Cada X días" },
];

export function MyRouteEditorPage() {
  const { routeId } = useParams();
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const userId = Number(currentUser.id);
  const id = routeId ? Number(routeId) : null;
  // Todos los roles pueden editar rutas (el TM Rep arma y modifica sus propias rutas).
  const canEdit = ["admin", "territory_manager", "regional_manager", "ejecutivo", "vendedor"].includes(
    (currentUser.role || "").toLowerCase()
  );

  const [route, setRoute] = useState<Awaited<ReturnType<typeof routesApi.get>> | null>(null);
  const [routePdvs, setRoutePdvs] = useState<Awaited<ReturnType<typeof routesApi.listPdvs>>>([]);
  const [routeForms, setRouteForms] = useState<Awaited<ReturnType<typeof routesApi.listForms>>>([]);
  const [routeDays, setRouteDays] = useState<Awaited<ReturnType<typeof routesApi.listDays>>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddPdv, setShowAddPdv] = useState(false);
  const [showAddDay, setShowAddDay] = useState(false);
  const [newDayDate, setNewDayDate] = useState(() => todayAR());

  const { data: pdvs } = usePdvs();
  const { data: forms } = useForms();
  const { data: myRoutes } = useMyRoutes(userId);

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
      navigate("/my-routes");
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    loadRoute();
  }, [loadRoute]);

  // PDVs already assigned to ANY route (not just this one)
  const [allAssignedPdvIds, setAllAssignedPdvIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (myRoutes.length === 0) return;
    const fetchAll = async () => {
      const assigned = new Set<number>();
      for (const r of myRoutes) {
        try {
          const rps = await routesApi.listPdvs(r.RouteId);
          for (const rp of rps) assigned.add(rp.PdvId);
        } catch { /* skip */ }
      }
      setAllAssignedPdvIds(assigned);
    };
    fetchAll();
  }, [myRoutes]);

  const availablePdvs = pdvs.filter(
    (p) => !allAssignedPdvIds.has(p.PdvId) && !routePdvs.some((rp) => rp.PdvId === p.PdvId)
  );

  const notifyAdmin = async (action: string) => {
    try {
      await notificationsApi.create({
        Title: `Ruta editada por ${currentUser.name}`,
        Message: `${currentUser.name} ${action} en la ruta "${route?.Name || ""}".`,
        Type: "info",
        Priority: 3,
        CreatedBy: Number(currentUser.id),
        TargetUserId: currentUser.managerId || null,
      });
      toast.info("Se notificó al supervisor", { duration: 2000 });
    } catch {
      // Non-blocking — don't show error to TM
    }
  };

  const handleAddPdv = async (pdvId: number) => {
    if (!id) return;
    setSaving(true);
    try {
      await routesApi.addPdv(id, {
        PdvId: pdvId,
        SortOrder: routePdvs.length,
        Priority: 3,
      });
      setRoutePdvs((prev) => [
        ...prev,
        { RouteId: id, PdvId: pdvId, SortOrder: prev.length, Priority: 3 },
      ]);
      setShowAddPdv(false);
      toast.success("PDV agregado");
      await notifyAdmin("agregó un PDV");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  const handleMovePdv = async (index: number, direction: "up" | "down") => {
    if (!id) return;
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= routePdvs.length) return;
    const reordered = [...routePdvs];
    [reordered[index], reordered[newIndex]] = [reordered[newIndex], reordered[index]];
    setRoutePdvs(reordered);
    // Save to backend
    try {
      await routesApi.reorderPdvs(id, reordered.map((rp) => rp.PdvId));
    } catch { /* revert would be complex, just ignore */ }
  };

  const handleRemovePdv = async (pdvId: number) => {
    if (!id || !confirm("¿Quitar este PDV de la ruta?")) return;
    setSaving(true);
    try {
      await routesApi.removePdv(id, pdvId);
      setRoutePdvs((prev) => prev.filter((rp) => rp.PdvId !== pdvId));
      toast.success("PDV quitado");
      await notifyAdmin("quitó un PDV");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
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
        AssignedUserId: userId,
      });
      setRouteDays((prev) =>
        [...prev, day].sort((a, b) => a.WorkDate.localeCompare(b.WorkDate))
      );
      setShowAddDay(false);
      setNewDayDate(todayAR());
      toast.success("Día agregado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  /** Auto-generate route days from frequency config. Deletes future days first. */
  const handleGenerateDays = async (weeksAhead: number = 8) => {
    if (!id || !routeDraft?.FrequencyType) return;
    setSaving(true);
    try {
      // Delete future planned days (not completed/in-progress) to regenerate
      const todayStr = new Date().toISOString().split("T")[0];
      const futureDays = routeDays.filter((d) =>
        d.WorkDate.split("T")[0] >= todayStr && d.Status === "PLANNED"
      );
      for (const fd of futureDays) {
        try {
          await routesApi.deleteDay(fd.RouteDayId);
        } catch { /* skip */ }
      }
      setRouteDays((prev) => prev.filter((d) =>
        !(d.WorkDate.split("T")[0] >= todayStr && d.Status === "PLANNED")
      ));

      const ft = routeDraft.FrequencyType;
      const config = routeDraft.FrequencyConfig ? JSON.parse(routeDraft.FrequencyConfig) : {};
      const dates: string[] = [];
      const today = new Date();
      const startDate = config.startDate ? new Date(config.startDate + "T12:00:00") : today;
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() + weeksAhead * 7);
      // After deletion, remaining are past/non-planned — skip them
      const existingDates = new Set(routeDays.filter((d) => d.Status !== "PLANNED" || d.WorkDate.split("T")[0] < todayStr).map((d) => d.WorkDate.split("T")[0]));

      if (ft === "daily") {
        const d = new Date(Math.max(today.getTime(), startDate.getTime()));
        while (d <= endDate) {
          if (d.getDay() >= 1 && d.getDay() <= 5) { // Lun-Vie
            const ds = d.toISOString().split("T")[0];
            if (!existingDates.has(ds)) dates.push(ds);
          }
          d.setDate(d.getDate() + 1);
        }
      } else if (ft === "weekly" && config.day != null) {
        const d = new Date(Math.max(today.getTime(), startDate.getTime()));
        while (d.getDay() !== config.day) d.setDate(d.getDate() + 1);
        while (d <= endDate) {
          const ds = d.toISOString().split("T")[0];
          if (!existingDates.has(ds)) dates.push(ds);
          d.setDate(d.getDate() + 7);
        }
      } else if (ft === "biweekly" || ft === "every_15_days") {
        const interval = ft === "biweekly" ? 14 : 15;
        // Step from startDate to find first cycle date >= today
        const d = new Date(startDate);
        while (d < today) d.setDate(d.getDate() + interval);
        while (d <= endDate) {
          const ds = d.toISOString().split("T")[0];
          if (!existingDates.has(ds)) dates.push(ds);
          d.setDate(d.getDate() + interval);
        }
      } else if (ft === "monthly") {
        const d = new Date(startDate);
        while (d < today) d.setMonth(d.getMonth() + 1);
        while (d <= endDate) {
          const ds = d.toISOString().split("T")[0];
          if (!existingDates.has(ds)) dates.push(ds);
          d.setMonth(d.getMonth() + 1);
        }
      } else if (ft === "every_x_days") {
        const interval = config.interval || 15;
        const d = new Date(startDate);
        while (d < today) d.setDate(d.getDate() + interval);
        while (d <= endDate) {
          const ds = d.toISOString().split("T")[0];
          if (!existingDates.has(ds)) dates.push(ds);
          d.setDate(d.getDate() + interval);
        }
      } else if (ft === "specific_days" && config.days?.length > 0) {
        const d = new Date(Math.max(today.getTime(), startDate.getTime()));
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

      let created = 0;
      for (const dt of dates) {
        try {
          const day = await routesApi.createDay(id, { WorkDate: dt, AssignedUserId: userId });
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
    BejermanZone?: string | null;
    FrequencyType?: string | null;
    FrequencyConfig?: string | null;
  } | null>(null);

  useEffect(() => {
    if (route) {
      setRouteDraft({
        Name: route.Name,
        BejermanZone: route.BejermanZone ?? null,
        FrequencyType: route.FrequencyType ?? null,
        FrequencyConfig: route.FrequencyConfig ?? null,
      });
    } else {
      setRouteDraft(null);
    }
  }, [route]);

  const routeMetadataDirty =
    route &&
    routeDraft &&
    (routeDraft.Name !== route.Name ||
      (routeDraft.BejermanZone ?? "") !== (route.BejermanZone ?? "") ||
      (routeDraft.FrequencyType ?? "") !== (route.FrequencyType ?? "") ||
      (routeDraft.FrequencyConfig ?? "") !== (route.FrequencyConfig ?? ""));

  const handleSaveRouteMetadata = async () => {
    if (!id || !routeDraft) return;
    setSaving(true);
    try {
      const frequencyChanged =
        (routeDraft.FrequencyType ?? "") !== (route?.FrequencyType ?? "") ||
        (routeDraft.FrequencyConfig ?? "") !== (route?.FrequencyConfig ?? "");

      const updated = await routesApi.update(id, {
        Name: routeDraft.Name,
        BejermanZone: routeDraft.BejermanZone ?? undefined,
        FrequencyType: routeDraft.FrequencyType || undefined,
        FrequencyConfig: routeDraft.FrequencyConfig || undefined,
      });
      setRoute(updated);
      setRouteDraft({
        Name: updated.Name,
        BejermanZone: updated.BejermanZone ?? null,
        FrequencyType: updated.FrequencyType ?? null,
        FrequencyConfig: updated.FrequencyConfig ?? null,
      });
      toast.success("Ruta guardada");

      // Detect what changed for notification
      const nameChanged = routeDraft.Name !== route?.Name;
      const bejermanChanged = (routeDraft.BejermanZone ?? "") !== (route?.BejermanZone ?? "");

      // Auto-generate days when frequency is set and there are PDVs
      if (routeDraft.FrequencyType && routePdvs.length > 0) {
        if (frequencyChanged) {
          try {
            const overlap = await routesApi.checkOverlap(id);
            if (overlap.hasOverlap) {
              const names = overlap.overlaps.map((o) => o.routeName).join(", ");
              toast.warning(`Solapamiento detectado con: ${names}. Revisá las frecuencias.`);
            }
          } catch { /* non-blocking */ }
        }
        await handleGenerateDays(8);
      }

      // Notify admin for any meaningful change
      if (frequencyChanged) {
        await notifyAdmin("cambió la frecuencia");
      } else if (nameChanged || bejermanChanged) {
        const changes: string[] = [];
        if (nameChanged) changes.push(`nombre a "${routeDraft.Name}"`);
        if (bejermanChanged) changes.push("zona Bejerman");
        await notifyAdmin(`cambió ${changes.join(" y ")}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !route) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Cargando...</p>
      </div>
    );
  }

  const availableForms = forms.filter((f) => !routeForms.some((rf) => rf.FormId === f.FormId));

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="bg-card border-b border-border p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/my-routes")}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">{canEdit ? "Editar Ruta" : "Detalle de Ruta"}</h1>
            <p className="text-sm text-muted-foreground">{routeDraft?.Name ?? route.Name}</p>
          </div>
        </div>
      </div>

      <div className="p-4 max-w-2xl mx-auto space-y-6">
        {/* Datos de la ruta */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground">Datos de la ruta</h3>
              {canEdit && routeDraft && (
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
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Nombre</label>
                <Input
                  value={routeDraft?.Name ?? ""}
                  onChange={(e) =>
                    setRouteDraft((d) => (d ? { ...d, Name: e.target.value } : null))
                  }
                  placeholder="Ej: RF Quilmes"
                  disabled={!canEdit}
                />
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
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Frecuencia</label>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {[
                    { value: "", label: "Sin definir" },
                    ...FREQUENCY_OPTIONS,
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        const ft = opt.value || null;
                        setRouteDraft((d) => {
                          if (!d) return null;
                          const prev = d.FrequencyConfig ? JSON.parse(d.FrequencyConfig) : {};
                          const startDate = prev.startDate || undefined;
                          let config: string | null = null;
                          if (ft === "specific_days") config = JSON.stringify({ days: prev.days || [], startDate });
                          else if (ft === "every_x_days") config = JSON.stringify({ interval: prev.interval || 15, startDate });
                          else if (ft === "weekly") config = JSON.stringify({ day: prev.day, startDate });
                          else if (ft) config = JSON.stringify({ startDate });
                          return { ...d, FrequencyType: ft, FrequencyConfig: config };
                        });
                      }}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                        (routeDraft?.FrequencyType ?? "") === opt.value
                          ? "bg-[#A48242] text-white"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Weekly: pick day */}
                {routeDraft?.FrequencyType === "weekly" && (() => {
                  const cfg = routeDraft.FrequencyConfig ? JSON.parse(routeDraft.FrequencyConfig) : {};
                  return (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">Día de la semana:</p>
                      <div className="flex gap-1.5">
                        {["D", "L", "M", "X", "J", "V", "S"].map((label, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setRouteDraft((d) => d ? { ...d, FrequencyConfig: JSON.stringify({ ...cfg, day: idx }) } : null)}
                            className={`w-9 h-9 rounded-full text-xs font-bold transition-colors ${
                              cfg.day === idx ? "bg-[#A48242] text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Specific days */}
                {routeDraft?.FrequencyType === "specific_days" && (() => {
                  const cfg = routeDraft.FrequencyConfig ? JSON.parse(routeDraft.FrequencyConfig) : { days: [] };
                  const days: number[] = cfg.days || [];
                  const toggleDay = (idx: number) => {
                    const nd = days.includes(idx) ? days.filter((d: number) => d !== idx) : [...days, idx];
                    setRouteDraft((d) => d ? { ...d, FrequencyConfig: JSON.stringify({ ...cfg, days: nd }) } : null);
                  };
                  return (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">Seleccioná los días:</p>
                      <div className="flex gap-1.5">
                        {["D", "L", "M", "X", "J", "V", "S"].map((label, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => toggleDay(idx)}
                            className={`w-9 h-9 rounded-full text-xs font-bold transition-colors ${
                              days.includes(idx) ? "bg-[#A48242] text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Every X days: interval input */}
                {routeDraft?.FrequencyType === "every_x_days" && (() => {
                  const cfg = routeDraft.FrequencyConfig ? JSON.parse(routeDraft.FrequencyConfig) : {};
                  return (
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-muted-foreground">Cada</span>
                      <Input
                        type="number"
                        min={1}
                        max={90}
                        value={cfg.interval ?? 15}
                        onChange={(e) => setRouteDraft((d) => d ? { ...d, FrequencyConfig: JSON.stringify({ ...cfg, interval: Number(e.target.value) || 15 }) } : null)}
                        className="w-16 h-8 text-sm"
                      />
                      <span className="text-xs text-muted-foreground">días</span>
                    </div>
                  );
                })()}

                {/* Start date — for all frequency types that need it */}
                {routeDraft?.FrequencyType && routeDraft.FrequencyType !== "specific_days" && (() => {
                  const cfg = routeDraft.FrequencyConfig ? JSON.parse(routeDraft.FrequencyConfig) : {};
                  return (
                    <div className="mt-3">
                      <label className="block text-xs text-muted-foreground mb-1">Comenzar a partir de</label>
                      <Input
                        type="date"
                        value={cfg.startDate || ""}
                        onChange={(e) => setRouteDraft((d) => d ? { ...d, FrequencyConfig: JSON.stringify({ ...cfg, startDate: e.target.value }) } : null)}
                        className="max-w-[200px]"
                      />
                    </div>
                  );
                })()}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* PDVs */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <MapPin size={20} />
                Puntos de venta ({routePdvs.length})
              </h3>
              <div className="relative">
                {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddPdv(!showAddPdv)}
                  disabled={availablePdvs.length === 0}
                >
                  <Plus size={18} className="mr-1" />
                  Agregar PDV
                </Button>
                )}
                {showAddPdv && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowAddPdv(false)}
                    />
                    <div className="absolute right-0 top-full mt-2 w-72 max-h-64 overflow-y-auto bg-card rounded-lg shadow-xl border border-border p-2 z-50">
                      {availablePdvs.length === 0 ? (
                        <p className="text-sm text-muted-foreground p-2">No hay PDVs disponibles</p>
                      ) : (
                        availablePdvs.map((p) => (
                          <button
                            key={p.PdvId}
                            onClick={() => handleAddPdv(p.PdvId)}
                            disabled={saving}
                            className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted text-sm"
                          >
                            {p.Name} <span className="text-muted-foreground">({p.ChannelName || p.Channel})</span>
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {routePdvs.length === 0 ? (
              <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                <MapPin size={40} className="mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground font-medium">Sin puntos de venta</p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => setShowAddPdv(true)}
                  disabled={availablePdvs.length === 0}
                >
                  <Plus size={18} className="mr-2" />
                  Agregar PDV
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {routePdvs.map((rp, index) => (
                  <PdvRow
                    key={rp.PdvId}
                    pdvId={rp.PdvId}
                    sortOrder={index + 1}
                    onRemove={() => handleRemovePdv(rp.PdvId)}
                    onMoveUp={index > 0 ? () => handleMovePdv(index, "up") : undefined}
                    onMoveDown={index < routePdvs.length - 1 ? () => handleMovePdv(index, "down") : undefined}
                    disabled={saving}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Días asignados — auto-generados desde frecuencia */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <Calendar size={20} />
                Mis días ({routeDays.filter((d) => d.AssignedUserId === userId).length})
              </h3>
              <div className="flex gap-2">
                {canEdit && routeDraft?.FrequencyType && (
                  <Button
                    size="sm"
                    onClick={() => handleGenerateDays(8)}
                    disabled={saving || routePdvs.length === 0}
                    className="bg-[#A48242] hover:bg-[#8B6E38] text-white gap-1"
                  >
                    <Calendar size={14} />
                    Generar días
                  </Button>
                )}
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAddDay(!showAddDay)}
                    disabled={routePdvs.length === 0}
                  >
                    <Plus size={16} />
                  </Button>
                )}
              </div>
            </div>

            {showAddDay && (
              <div className="mb-4 p-3 bg-muted rounded-lg flex items-end gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-muted-foreground mb-1">Agregar fecha manual</label>
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

            {!routeDraft?.FrequencyType && (
              <div className="border-2 border-dashed border-blue-200 bg-blue-50 rounded-lg p-4 mb-4 text-center">
                <p className="text-sm text-blue-700">
                  Elegí la frecuencia arriba y usá "Generar días" para programar automáticamente
                </p>
              </div>
            )}

            {routeDays.filter((d) => d.AssignedUserId === userId).length === 0 && routeDraft?.FrequencyType ? (
              <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                <Calendar size={40} className="mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground font-medium">Sin días generados</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Hacé click en "Generar días" para crear las próximas 8 semanas
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {routeDays
                  .filter((d) => d.AssignedUserId === userId)
                  .map((d) => (
                    <div
                      key={d.RouteDayId}
                      className="flex items-center gap-3 p-3 bg-muted rounded-lg"
                    >
                      <Calendar size={18} className="text-muted-foreground" />
                      <span className="text-sm font-medium text-muted-foreground">
                        {new Date(d.WorkDate).toLocaleDateString("es-AR", {
                          timeZone: "America/Argentina/Buenos_Aires",
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
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
                  ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Formularios */}
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold text-foreground mb-2">Formularios de relevamiento</h3>
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
            <select
              className="w-full px-3 py-2 border border-border rounded-lg"
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
                  {f.Name}
                </option>
              ))}
            </select>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PdvRow({
  pdvId,
  sortOrder,
  onRemove,
  onMoveUp,
  onMoveDown,
  disabled,
}: {
  pdvId: number;
  sortOrder: number;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  disabled: boolean;
}) {
  const [pdv, setPdv] = useState<Awaited<ReturnType<typeof pdvsApi.get>> | null>(null);

  useEffect(() => {
    pdvsApi.get(pdvId).then(setPdv).catch(() => setPdv(null));
  }, [pdvId]);

  if (!pdv) {
    return (
      <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
        <span className="text-muted-foreground">#{sortOrder}</span>
        <span className="text-muted-foreground">PDV #{pdvId} (cargando...)</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
      <div className="flex flex-col gap-0.5 shrink-0">
        <button
          onClick={onMoveUp}
          disabled={!onMoveUp || disabled}
          className="p-0.5 rounded hover:bg-background disabled:opacity-20 transition-colors"
        >
          <ChevronUp size={14} className="text-muted-foreground" />
        </button>
        <button
          onClick={onMoveDown}
          disabled={!onMoveDown || disabled}
          className="p-0.5 rounded hover:bg-background disabled:opacity-20 transition-colors"
        >
          <ChevronDown size={14} className="text-muted-foreground" />
        </button>
      </div>
      <span className="w-7 text-xs font-bold text-[#A48242]">#{sortOrder}</span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-foreground text-sm truncate">{pdv.Name}</p>
        <p className="text-xs text-muted-foreground truncate">{pdv.Address || pdv.City || ""}</p>
      </div>
      <Badge variant="outline" className="text-[10px] shrink-0">{pdv.ChannelName || pdv.Channel}</Badge>
      <Button variant="ghost" size="sm" onClick={onRemove} disabled={disabled} className="shrink-0 p-1">
        <Trash2 size={16} className="text-red-500" />
      </Button>
    </div>
  );
}
