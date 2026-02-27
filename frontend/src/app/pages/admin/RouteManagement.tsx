import { useState } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Modal } from "../../components/ui/modal";
import {
  Plus,
  Users,
  MapPin,
  Calendar,
  Edit,
  Trash2,
  Copy,
} from "lucide-react";
import { useApiList, routesApi, useZones, useUsers, useForms, BEJERMAN_ZONES } from "@/lib/api";
import { toast } from "sonner";

export function RouteManagement() {
  const navigate = useNavigate();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [formName, setFormName] = useState("");
  const [formZoneId, setFormZoneId] = useState<number | "">("");
  const [formFormId, setFormFormId] = useState<number | "">("");
  const [formBejermanZone, setFormBejermanZone] = useState("");
  const [formEstimatedMinutes, setFormEstimatedMinutes] = useState<number | "">("");
  const [formIsActive, setFormIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const { data: routes, loading, refetch } = useApiList(() => routesApi.list());
  const { data: zones } = useZones();
  const { data: users } = useUsers();
  const { data: forms } = useForms();

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Gestión de Rutas Foco</h1>
          <p className="text-slate-600">Asignar PDV a usuarios y configurar frecuencias</p>
        </div>
        <Button
          onClick={() => {
            setIsCreateModalOpen(true);
            setSelectedRouteId(null);
            setFormName("");
            setFormZoneId("");
            setFormFormId("");
            setFormBejermanZone("");
            setFormEstimatedMinutes("");
            setFormIsActive(true);
          }}
          className="gap-2"
        >
          <Plus size={20} />
          Nueva Ruta
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-slate-600 mb-1">Rutas Activas</p>
            <p className="text-3xl font-bold text-blue-600">
              {routes.filter((r) => r.IsActive).length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-slate-600 mb-1">Total PDV en Rutas</p>
            <p className="text-3xl font-bold text-green-600">
              {routes.reduce((acc, r) => acc + (r.PdvCount ?? 0), 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-slate-600 mb-1">Total Rutas</p>
            <p className="text-3xl font-bold text-purple-600">{routes.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-slate-600 mb-1">Promedio PDV/Ruta</p>
            <p className="text-3xl font-bold text-slate-600">
              {routes.length > 0
                ? Math.round(
                    routes.reduce((acc, r) => acc + (r.PdvCount ?? 0), 0) / routes.length
                  )
                : 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Routes List */}
      {loading && (
        <p className="text-slate-600">Cargando rutas...</p>
      )}
      <div className="grid grid-cols-1 gap-4">
        {routes.map((route) => (
          <Card key={route.RouteId} className="hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-bold text-slate-900">{route.Name}</h3>
                    <Badge variant={route.IsActive ? "default" : "secondary"}>
                      {route.IsActive ? "Activa" : "Inactiva"}
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/admin/routes/${route.RouteId}/edit`)}
                  >
                    <Edit size={16} />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      if (confirm("¿Eliminar esta ruta?")) {
                        try {
                          await routesApi.delete(route.RouteId);
                          toast.success("Ruta eliminada");
                          refetch();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Error");
                        }
                      }
                    }}
                  >
                    <Trash2 size={16} className="text-red-600" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4">
                <div>
                  <p className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                    <MapPin size={12} />
                    PDVs
                  </p>
                  <p className="text-xl font-bold text-slate-900">{route.PdvCount ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Zona Bejerman</p>
                  <p className="text-sm font-semibold text-slate-900">
                    {route.BejermanZone ?? "-"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Tiempo est. (min)</p>
                  <p className="text-sm font-semibold text-slate-900">
                    {route.EstimatedMinutes != null ? `${route.EstimatedMinutes} min` : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                    <Calendar size={12} />
                    Creada
                  </p>
                  <p className="text-sm font-semibold text-slate-900">
                    {new Date(route.CreatedAt).toLocaleDateString("es-AR")}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Formulario</p>
                  <p className="text-sm font-semibold text-slate-900">
                    {route.FormId ? forms.find((f) => f.FormId === route.FormId)?.Name ?? `#${route.FormId}` : "-"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isCreateModalOpen || selectedRouteId !== null}
        onClose={() => {
          setIsCreateModalOpen(false);
          setSelectedRouteId(null);
        }}
        title={selectedRouteId ? "Editar Ruta" : "Nueva Ruta"}
        size="lg"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateModalOpen(false);
                setSelectedRouteId(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              disabled={saving || !formName.trim()}
              onClick={async () => {
                setSaving(true);
                try {
                  if (selectedRouteId) {
                    await routesApi.update(selectedRouteId, {
                      Name: formName,
                      ZoneId: formZoneId || undefined,
                      FormId: formFormId || undefined,
                      BejermanZone: formBejermanZone || undefined,
                      EstimatedMinutes: formEstimatedMinutes !== "" ? Number(formEstimatedMinutes) : undefined,
                      IsActive: formIsActive,
                    });
                    toast.success("Ruta actualizada");
                    setIsCreateModalOpen(false);
                    setSelectedRouteId(null);
                    refetch();
                  } else {
                    const newRoute = await routesApi.create({
                      Name: formName,
                      ZoneId: formZoneId || undefined,
                      FormId: formFormId || undefined,
                      BejermanZone: formBejermanZone || undefined,
                      EstimatedMinutes: formEstimatedMinutes !== "" ? Number(formEstimatedMinutes) : undefined,
                      IsActive: formIsActive,
                    });
                    toast.success("Ruta creada");
                    setIsCreateModalOpen(false);
                    setSelectedRouteId(null);
                    refetch();
                    navigate(`/admin/routes/${newRoute.RouteId}/edit`);
                  }
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Error");
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Guardando..." : "Guardar Ruta"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Nombre de la Ruta
            </label>
            <Input
              placeholder="Ej: Ruta Norte - Kioscos"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Zona</label>
            <select
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formZoneId}
              onChange={(e) =>
                setFormZoneId(e.target.value ? Number(e.target.value) : "")
              }
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
            <label className="block text-sm font-medium text-slate-700 mb-1">Zona Bejerman</label>
            <select
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formBejermanZone}
              onChange={(e) => setFormBejermanZone(e.target.value)}
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
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Tiempo estimado (min) — solo Admin
            </label>
            <Input
              type="number"
              placeholder="Ej: 120"
              value={formEstimatedMinutes}
              onChange={(e) =>
                setFormEstimatedMinutes(e.target.value ? Number(e.target.value) : "")
              }
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Formulario</label>
            <select
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formFormId}
              onChange={(e) =>
                setFormFormId(e.target.value ? Number(e.target.value) : "")
              }
            >
              <option value="">Sin formulario</option>
              {forms.map((f) => (
                <option key={f.FormId} value={f.FormId}>
                  {f.Name} {f.Channel ? `(${f.Channel})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Estado</label>
            <select
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formIsActive ? "active" : "inactive"}
              onChange={(e) => setFormIsActive(e.target.value === "active")}
            >
              <option value="active">Activa</option>
              <option value="inactive">Inactiva</option>
            </select>
          </div>
        </div>
      </Modal>
    </div>
  );
}
