import { useState } from "react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Modal } from "../../components/ui/modal";
import { Textarea } from "../../components/ui/textarea";
import { Plus, Bell, Edit, Trash2 } from "lucide-react";
import { useApiList, notificationsApi } from "@/lib/api";
import { toast } from "sonner";

export function NotificationManagement() {
  const { data: notifications, loading, refetch } = useApiList(() =>
    notificationsApi.list()
  );
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    Title: "",
    Message: "",
    Type: "info",
    Priority: 2,
    IsActive: true,
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.Title.trim() || !form.Message.trim()) {
      toast.error("Título y mensaje son obligatorios");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await notificationsApi.update(editingId, form);
        toast.success("Notificación actualizada");
      } else {
        await notificationsApi.create(form);
        toast.success("Notificación creada");
      }
      setIsCreateModalOpen(false);
      setEditingId(null);
      setForm({ Title: "", Message: "", Type: "info", Priority: 2, IsActive: true });
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("¿Eliminar esta notificación?")) return;
    try {
      await notificationsApi.delete(id);
      toast.success("Notificación eliminada");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const getTypeLabel = (t: string) =>
    ({ info: "Info", warning: "Aviso", urgent: "Urgente" }[t] || t);
  const getPriorityLabel = (p: number) =>
    ({ 1: "Alta", 2: "Media", 3: "Baja" }[p] || "Media");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            Notificaciones
          </h1>
          <p className="text-slate-600">
            Crea notificaciones que verán los Trade Rep (como incidencias)
          </p>
        </div>
        <Button
          onClick={() => {
            setIsCreateModalOpen(true);
            setEditingId(null);
            setForm({ Title: "", Message: "", Type: "info", Priority: 2, IsActive: true });
          }}
          className="gap-2"
        >
          <Plus size={20} />
          Nueva Notificación
        </Button>
      </div>

      {loading ? (
        <p className="text-slate-600">Cargando...</p>
      ) : (
        <div className="grid gap-4">
          {notifications.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <Bell size={48} className="mx-auto mb-4 text-slate-300" />
                <p className="text-slate-600 mb-2">No hay notificaciones</p>
                <Button onClick={() => setIsCreateModalOpen(true)}>
                  Crear primera notificación
                </Button>
              </CardContent>
            </Card>
          ) : (
            notifications.map((n) => (
              <Card key={n.NotificationId} className="hover:shadow-md">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-lg font-bold text-slate-900">
                          {n.Title}
                        </h3>
                        <Badge variant={n.IsActive ? "default" : "secondary"}>
                          {n.IsActive ? "Activa" : "Inactiva"}
                        </Badge>
                        <Badge variant="outline">{getTypeLabel(n.Type)}</Badge>
                        <Badge variant="outline">
                          {getPriorityLabel(n.Priority)}
                        </Badge>
                      </div>
                      <p className="text-slate-600 text-sm">{n.Message}</p>
                      <p className="text-xs text-slate-400 mt-2">
                        {new Date(n.CreatedAt).toLocaleString("es-AR")}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingId(n.NotificationId);
                          setForm({
                            Title: n.Title,
                            Message: n.Message,
                            Type: n.Type,
                            Priority: n.Priority,
                            IsActive: n.IsActive,
                          });
                        }}
                      >
                        <Edit size={16} />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(n.NotificationId)}
                      >
                        <Trash2 size={16} className="text-red-600" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      <Modal
        isOpen={isCreateModalOpen || editingId !== null}
        onClose={() => {
          setIsCreateModalOpen(false);
          setEditingId(null);
        }}
        title={editingId ? "Editar Notificación" : "Nueva Notificación"}
        size="md"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateModalOpen(false);
                setEditingId(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              disabled={saving || !form.Title.trim() || !form.Message.trim()}
              onClick={handleSave}
            >
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Título *
            </label>
            <Input
              placeholder="Ej: Nueva campaña de verano"
              value={form.Title}
              onChange={(e) => setForm((f) => ({ ...f, Title: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Mensaje *
            </label>
            <Textarea
              placeholder="Texto que verán los Trade Rep..."
              rows={4}
              value={form.Message}
              onChange={(e) => setForm((f) => ({ ...f, Message: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Tipo
              </label>
              <select
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                value={form.Type}
                onChange={(e) => setForm((f) => ({ ...f, Type: e.target.value }))}
              >
                <option value="info">Info</option>
                <option value="warning">Aviso</option>
                <option value="urgent">Urgente</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Prioridad
              </label>
              <select
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                value={form.Priority}
                onChange={(e) =>
                  setForm((f) => ({ ...f, Priority: Number(e.target.value) }))
                }
              >
                <option value={1}>Alta</option>
                <option value={2}>Media</option>
                <option value={3}>Baja</option>
              </select>
            </div>
          </div>
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.IsActive}
                onChange={(e) =>
                  setForm((f) => ({ ...f, IsActive: e.target.checked }))
                }
              />
              <span className="text-sm font-medium text-slate-700">
                Activa (visible para Trade Rep)
              </span>
            </label>
          </div>
        </div>
      </Modal>
    </div>
  );
}
