import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import {
  routesApi,
  usePdvs,
  useZones,
  useForms,
  useUsers,
  pdvsApi,
} from "@/lib/api";
import { toast } from "sonner";

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
  const [showAddPdv, setShowAddPdv] = useState(false);
  const [showAddDay, setShowAddDay] = useState(false);
  const [newDayUser, setNewDayUser] = useState<number | "">("");
  const [newDayDate, setNewDayDate] = useState(() =>
    new Date().toISOString().split("T")[0]
  );

  const { data: pdvs } = usePdvs(route?.ZoneId ?? undefined);
  const { data: zones } = useZones();
  const { data: forms } = useForms();
  const { data: users } = useUsers();

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
    if (!id || newDayUser === "") return;
    setSaving(true);
    try {
      const day = await routesApi.createDay(id, {
        WorkDate: newDayDate,
        AssignedUserId: Number(newDayUser),
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

  const handleUpdateRoute = async (data: { Name?: string; ZoneId?: number }) => {
    if (!id) return;
    try {
      const updated = await routesApi.update(id, data);
      setRoute(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  if (loading || !route) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-slate-600">Cargando...</p>
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
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ArrowLeft size={24} />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900">Editar Ruta Foco</h1>
          <p className="text-slate-600">{route.Name}</p>
        </div>
      </div>

      {/* Route Info */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <h3 className="font-semibold text-slate-900">Datos de la ruta</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nombre</label>
              <Input
                value={route.Name}
                onChange={(e) => setRoute((r) => (r ? { ...r, Name: e.target.value } : null))}
                onBlur={() => handleUpdateRoute({ Name: route.Name })}
                placeholder="Ej: Ruta Norte - Kioscos"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Zona</label>
              <select
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                value={route.ZoneId ?? ""}
                onChange={(e) => {
                  const zoneId = e.target.value ? Number(e.target.value) : undefined;
                  setRoute((r) => (r ? { ...r, ZoneId: zoneId ?? null } : null));
                  handleUpdateRoute({ ZoneId: zoneId });
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
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Formularios de relevamiento
              </label>
              <p className="text-sm text-slate-500 mb-2">
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
                      className="ml-1 p-0.5 hover:bg-slate-300 rounded"
                    >
                      <Trash2 size={14} />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="relative">
                <select
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
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

      {/* PDVs en la ruta */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
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
                  <div className="absolute right-0 top-full mt-2 w-72 max-h-64 overflow-y-auto bg-white rounded-lg shadow-xl border border-slate-200 p-2 z-50">
                    {availablePdvs.length === 0 ? (
                      <p className="text-sm text-slate-500 p-2">
                        No hay PDVs disponibles en esta zona
                      </p>
                    ) : (
                      availablePdvs.map((p) => (
                        <button
                          key={p.PdvId}
                          onClick={() => handleAddPdv(p.PdvId)}
                          disabled={saving}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 text-sm"
                        >
                          {p.Name} <span className="text-slate-400">({p.Channel})</span>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {routePdvs.length === 0 ? (
            <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center">
              <MapPin size={40} className="mx-auto text-slate-300 mb-2" />
              <p className="text-slate-600 font-medium">Sin puntos de venta</p>
              <p className="text-sm text-slate-500 mt-1">
                Agrega PDVs para definir la ruta
              </p>
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

      {/* Días de ruta (usuario + fecha) */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              <Calendar size={20} />
              Días asignados ({routeDays.length})
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
                  <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-lg shadow-xl border border-slate-200 p-4 z-50 space-y-3">
                    <p className="text-sm font-medium text-slate-700">
                      Asignar ruta a usuario y fecha
                    </p>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">
                        Usuario
                      </label>
                      <select
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                        value={newDayUser}
                        onChange={(e) =>
                          setNewDayUser(
                            e.target.value ? Number(e.target.value) : ""
                          )
                        }
                      >
                        <option value="">Seleccionar...</option>
                        {users
                          .filter((u) => u.IsActive)
                          .map((u) => (
                            <option key={u.UserId} value={u.UserId}>
                              {u.DisplayName} ({u.Email})
                            </option>
                          ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">
                        Fecha
                      </label>
                      <input
                        type="date"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                        value={newDayDate}
                        onChange={(e) => setNewDayDate(e.target.value)}
                      />
                    </div>
                    <p className="text-xs text-slate-500">
                      Se copiarán los {routePdvs.length} PDV de la ruta al día.
                    </p>
                    <Button
                      size="sm"
                      onClick={handleAddDay}
                      disabled={saving || newDayUser === ""}
                    >
                      Agregar
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>

          {routeDays.length === 0 ? (
            <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center">
              <Calendar size={40} className="mx-auto text-slate-300 mb-2" />
              <p className="text-slate-600 font-medium">Sin días asignados</p>
              <p className="text-sm text-slate-500 mt-1">
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
                    className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                  >
                    <Calendar size={18} className="text-slate-400" />
                    <span className="text-sm font-medium text-slate-700">
                      {new Date(d.WorkDate).toLocaleDateString("es-AR", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                    <User size={16} className="text-slate-400" />
                    <span className="text-sm text-slate-600">
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
      <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
        <span className="text-slate-400">#{sortOrder}</span>
        <span className="text-slate-500">PDV #{pdvId} (cargando...)</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
      <GripVertical size={18} className="text-slate-400" />
      <span className="w-8 text-sm font-medium text-slate-500">#{sortOrder}</span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-slate-900 truncate">{pdv.Name}</p>
        <p className="text-sm text-slate-500">{pdv.Address || pdv.City || pdv.Channel}</p>
      </div>
      <Badge variant="outline">{pdv.Channel}</Badge>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRemove}
        disabled={disabled}
      >
        <Trash2 size={18} className="text-red-500" />
      </Button>
    </div>
  );
}
