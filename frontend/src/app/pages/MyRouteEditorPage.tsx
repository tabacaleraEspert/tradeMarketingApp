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
} from "lucide-react";
import {
  routesApi,
  usePdvs,
  useForms,
  pdvsApi,
  BEJERMAN_ZONES,
} from "@/lib/api";
import { toast } from "sonner";
import { getCurrentUser } from "../lib/auth";

const FREQUENCY_OPTIONS = [
  { value: "every_15_days", label: "Cada 15 días" },
  { value: "weekly", label: "Semanal" },
  { value: "specific_days", label: "Días específicos" },
];

export function MyRouteEditorPage() {
  const { routeId } = useParams();
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const userId = Number(currentUser.id);
  const id = routeId ? Number(routeId) : null;

  const [route, setRoute] = useState<Awaited<ReturnType<typeof routesApi.get>> | null>(null);
  const [routePdvs, setRoutePdvs] = useState<Awaited<ReturnType<typeof routesApi.listPdvs>>>([]);
  const [routeForms, setRouteForms] = useState<Awaited<ReturnType<typeof routesApi.listForms>>>([]);
  const [routeDays, setRouteDays] = useState<Awaited<ReturnType<typeof routesApi.listDays>>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddPdv, setShowAddPdv] = useState(false);
  const [showAddDay, setShowAddDay] = useState(false);
  const [newDayDate, setNewDayDate] = useState(() =>
    new Date().toISOString().split("T")[0]
  );

  const { data: pdvs } = usePdvs();
  const { data: forms } = useForms();

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

  const availablePdvs = pdvs.filter(
    (p) => !routePdvs.some((rp) => rp.PdvId === p.PdvId)
  );

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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  const handleRemovePdv = async (pdvId: number) => {
    if (!id || !confirm("¿Quitar este PDV de la ruta?")) return;
    setSaving(true);
    try {
      await routesApi.removePdv(id, pdvId);
      setRoutePdvs((prev) => prev.filter((rp) => rp.PdvId !== pdvId));
      toast.success("PDV quitado");
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
      const updated = await routesApi.update(id, {
        Name: routeDraft.Name,
        BejermanZone: routeDraft.BejermanZone ?? undefined,
        FrequencyType: routeDraft.FrequencyType ?? undefined,
        FrequencyConfig: routeDraft.FrequencyConfig ?? undefined,
      });
      setRoute(updated);
      setRouteDraft({
        Name: updated.Name,
        BejermanZone: updated.BejermanZone ?? null,
        FrequencyType: updated.FrequencyType ?? null,
        FrequencyConfig: updated.FrequencyConfig ?? null,
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
            <h1 className="text-xl font-bold text-foreground">Editar Ruta</h1>
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
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Nombre</label>
                <Input
                  value={routeDraft?.Name ?? ""}
                  onChange={(e) =>
                    setRouteDraft((d) => (d ? { ...d, Name: e.target.value } : null))
                  }
                  placeholder="Ej: RF Quilmes"
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
                <select
                  className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-espert-gold"
                  value={routeDraft?.FrequencyType ?? ""}
                  onChange={(e) => {
                    const v = e.target.value || undefined;
                    setRouteDraft((d) => (d ? { ...d, FrequencyType: v ?? null } : null));
                  }}
                >
                  <option value="">Sin definir</option>
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddPdv(!showAddPdv)}
                  disabled={availablePdvs.length === 0}
                >
                  <Plus size={18} className="mr-1" />
                  Agregar PDV
                </Button>
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
                    disabled={saving}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Días asignados (solo a mí) */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <Calendar size={20} />
                Mis días asignados ({routeDays.filter((d) => d.AssignedUserId === userId).length})
              </h3>
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddDay(!showAddDay)}
                  disabled={routePdvs.length === 0}
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
                    <div className="absolute right-0 top-full mt-2 w-72 bg-card rounded-lg shadow-xl border border-border p-4 z-50 space-y-3">
                      <p className="text-sm font-medium text-muted-foreground">
                        Agregar fecha a mi agenda
                      </p>
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1">Fecha</label>
                        <input
                          type="date"
                          className="w-full px-3 py-2 border border-border rounded-lg"
                          value={newDayDate}
                          onChange={(e) => setNewDayDate(e.target.value)}
                        />
                      </div>
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

            {routeDays.filter((d) => d.AssignedUserId === userId).length === 0 ? (
              <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                <Calendar size={40} className="mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground font-medium">Sin días asignados</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Agrega fechas para planificar tu ruta
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
  disabled,
}: {
  pdvId: number;
  sortOrder: number;
  onRemove: () => void;
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
    <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
      <GripVertical size={18} className="text-muted-foreground" />
      <span className="w-8 text-sm font-medium text-muted-foreground">#{sortOrder}</span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-foreground truncate">{pdv.Name}</p>
        <p className="text-sm text-muted-foreground">{pdv.Address || pdv.City || pdv.ChannelName}</p>
      </div>
      <Badge variant="outline">{pdv.ChannelName || pdv.Channel}</Badge>
      <Button variant="ghost" size="sm" onClick={onRemove} disabled={disabled}>
        <Trash2 size={18} className="text-red-500" />
      </Button>
    </div>
  );
}
