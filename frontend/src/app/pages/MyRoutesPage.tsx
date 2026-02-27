import { useState } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Modal } from "../components/ui/modal";
import { ArrowLeft, Plus, MapPin, Calendar, Edit } from "lucide-react";
import {
  useMyRoutes,
  usePdvs,
  routesApi,
  BEJERMAN_ZONES,
} from "@/lib/api";
import { getCurrentUser } from "../lib/auth";
import { toast } from "sonner";

const FREQUENCY_OPTIONS = [
  { value: "every_15_days", label: "Cada 15 días" },
  { value: "weekly", label: "Semanal" },
  { value: "specific_days", label: "Días específicos" },
];

export function MyRoutesPage() {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const userId = Number(currentUser.id) || undefined;

  const { data: myRoutes, loading, refetch } = useMyRoutes(userId);
  const { data: pdvs } = usePdvs();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formBejermanZone, setFormBejermanZone] = useState("");
  const [formFrequencyType, setFormFrequencyType] = useState("");
  const [formFrequencyConfig, setFormFrequencyConfig] = useState("");
  const [selectedPdvIds, setSelectedPdvIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!formName.trim()) {
      toast.error("Nombre requerido");
      return;
    }
    setSaving(true);
    try {
      const route = await routesApi.create({
        Name: formName.trim(),
        BejermanZone: formBejermanZone || undefined,
        FrequencyType: formFrequencyType || undefined,
        FrequencyConfig: formFrequencyConfig || undefined,
        CreatedByUserId: userId,
        IsActive: true,
      });
      for (let i = 0; i < selectedPdvIds.length; i++) {
        await routesApi.addPdv(route.RouteId, {
          PdvId: selectedPdvIds[i],
          SortOrder: i + 1,
        });
      }
      toast.success("Ruta creada");
      setIsCreateModalOpen(false);
      setFormName("");
      setFormBejermanZone("");
      setFormFrequencyType("");
      setFormFrequencyConfig("");
      setSelectedPdvIds([]);
      refetch();
      navigate(`/my-routes/${route.RouteId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al crear");
    } finally {
      setSaving(false);
    }
  };

  const togglePdv = (pdvId: number) => {
    setSelectedPdvIds((prev) =>
      prev.includes(pdvId) ? prev.filter((id) => id !== pdvId) : [...prev, pdvId]
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-900">Mis Rutas Foco</h1>
            <p className="text-sm text-slate-600 mt-0.5">
              Crea y gestiona tus rutas
            </p>
          </div>
          <Button onClick={() => setIsCreateModalOpen(true)} className="gap-2">
            <Plus size={20} />
            Nueva Ruta
          </Button>
        </div>
      </div>

      <div className="p-4 max-w-2xl mx-auto">
        {loading ? (
          <p className="text-slate-600">Cargando...</p>
        ) : myRoutes.length === 0 ? (
          <Card className="border-dashed border-2 border-slate-300 bg-slate-50">
            <CardContent className="p-12 text-center">
              <p className="font-semibold text-slate-700 mb-1">
                No tienes rutas creadas
              </p>
              <p className="text-sm text-slate-500 mb-4">
                Crea tu primera ruta para planificar visitas
              </p>
              <Button onClick={() => setIsCreateModalOpen(true)}>
                <Plus size={18} className="mr-2" />
                Crear Ruta
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {myRoutes.map((route) => (
              <Card
                key={route.RouteId}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(`/my-routes/${route.RouteId}`)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-slate-900">{route.Name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        {route.BejermanZone && (
                          <Badge variant="outline">{route.BejermanZone}</Badge>
                        )}
                        <span className="text-sm text-slate-500">
                          {route.PdvCount} PDV
                        </span>
                      </div>
                    </div>
                    <Edit size={18} className="text-slate-400" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Nueva Ruta Foco"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsCreateModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={saving || !formName.trim()}
              onClick={handleCreate}
            >
              {saving ? "Creando..." : "Crear Ruta"}
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
              placeholder="Ej: RF Quilmes"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Zona Bejerman
            </label>
            <select
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formBejermanZone}
              onChange={(e) => setFormBejermanZone(e.target.value)}
            >
              <option value="">Seleccionar zona</option>
              {BEJERMAN_ZONES.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Frecuencia
            </label>
            <select
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formFrequencyType}
              onChange={(e) => setFormFrequencyType(e.target.value)}
            >
              <option value="">Sin definir</option>
              {FREQUENCY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {formFrequencyType === "specific_days" && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Días (ej: 1,3,5 = Lun, Mié, Vie)
              </label>
              <Input
                placeholder="0=Dom, 1=Lun, 2=Mar..."
                value={formFrequencyConfig}
                onChange={(e) => setFormFrequencyConfig(e.target.value)}
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              PDVs de la ruta ({selectedPdvIds.length} seleccionados)
            </label>
            <div className="max-h-48 overflow-y-auto border rounded-lg p-2 space-y-1">
              {pdvs.length === 0 ? (
                <p className="text-sm text-slate-500">No hay PDVs</p>
              ) : (
                pdvs.map((p) => (
                  <label
                    key={p.PdvId}
                    className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedPdvIds.includes(p.PdvId)}
                      onChange={() => togglePdv(p.PdvId)}
                    />
                    <span className="text-sm">{p.Name}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
