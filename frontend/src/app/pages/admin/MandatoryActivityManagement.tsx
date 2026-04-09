import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Badge } from "../../components/ui/badge";
import { Modal, ConfirmModal } from "../../components/ui/modal";
import { Switch } from "../../components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Search,
  Plus,
  Edit,
  Trash2,
  ClipboardList,
  Camera,
  Package,
  Megaphone,
  Repeat,
  Tag,
  MoreHorizontal,
} from "lucide-react";
import { mandatoryActivitiesApi, channelsApi, routesApi } from "@/lib/api";
import type { MandatoryActivity, Channel, Route } from "@/lib/api";
import { toast } from "sonner";
import { Textarea } from "../../components/ui/textarea";

const ACTION_TYPE_OPTIONS = [
  { value: "cobertura", label: "Generación de Cobertura", icon: Package, color: "bg-espert-gold/10 text-espert-gold" },
  { value: "pop", label: "Colocación de POP", icon: Megaphone, color: "bg-espert-gold/10 text-espert-gold" },
  { value: "canje_sueltos", label: "Canje de Sueltos", icon: Repeat, color: "bg-green-100 text-green-700" },
  { value: "promo", label: "Activación de Promo", icon: Tag, color: "bg-orange-100 text-orange-700" },
  { value: "otra", label: "Otra Acción", icon: MoreHorizontal, color: "bg-muted text-muted-foreground" },
];

export function MandatoryActivityManagement() {
  const [searchTerm, setSearchTerm] = useState("");
  const [activities, setActivities] = useState<MandatoryActivity[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<MandatoryActivity | null>(null);
  const [deleteActivity, setDeleteActivity] = useState<MandatoryActivity | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    Name: "",
    ActionType: "",
    Description: "",
    PhotoRequired: true,
    ChannelId: "" as number | "",
    RouteId: "" as number | "",
    IsActive: true,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [actList, chList, rtList] = await Promise.all([
        mandatoryActivitiesApi.list(),
        channelsApi.list(),
        routesApi.list().catch(() => [] as Route[]),
      ]);
      setActivities(actList);
      setChannels(chList);
      setRoutes(rtList);
    } catch {
      toast.error("Error al cargar actividades");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filtered = activities.filter((a) => {
    const term = searchTerm.toLowerCase();
    return (
      a.Name.toLowerCase().includes(term) ||
      a.ActionType.toLowerCase().includes(term) ||
      (a.Description || "").toLowerCase().includes(term)
    );
  });

  const resetForm = () => {
    setForm({ Name: "", ActionType: "", Description: "", PhotoRequired: true, ChannelId: "", RouteId: "", IsActive: true });
    setEditingActivity(null);
  };

  const openCreate = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEdit = (a: MandatoryActivity) => {
    setEditingActivity(a);
    setForm({
      Name: a.Name,
      ActionType: a.ActionType,
      Description: a.Description || "",
      PhotoRequired: a.PhotoRequired,
      ChannelId: a.ChannelId ?? "",
      RouteId: a.RouteId ?? "",
      IsActive: a.IsActive,
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.Name || !form.ActionType) {
      toast.error("Nombre y tipo de acción son obligatorios");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        Name: form.Name,
        ActionType: form.ActionType,
        Description: form.Description || undefined,
        PhotoRequired: form.PhotoRequired,
        ChannelId: form.ChannelId || null,
        RouteId: form.RouteId || null,
        IsActive: form.IsActive,
      };

      if (editingActivity) {
        await mandatoryActivitiesApi.update(editingActivity.MandatoryActivityId, payload);
        toast.success("Actividad actualizada");
      } else {
        await mandatoryActivitiesApi.create(payload);
        toast.success("Actividad creada");
      }
      setIsModalOpen(false);
      resetForm();
      loadData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteActivity) return;
    try {
      await mandatoryActivitiesApi.delete(deleteActivity.MandatoryActivityId);
      toast.success("Actividad eliminada");
      setDeleteActivity(null);
      loadData();
    } catch {
      toast.error("Error al eliminar actividad");
    }
  };

  const handleToggleActive = async (a: MandatoryActivity) => {
    try {
      await mandatoryActivitiesApi.update(a.MandatoryActivityId, { IsActive: !a.IsActive });
      setActivities((prev) =>
        prev.map((x) =>
          x.MandatoryActivityId === a.MandatoryActivityId ? { ...x, IsActive: !x.IsActive } : x
        )
      );
      toast.success(a.IsActive ? "Actividad desactivada" : "Actividad activada");
    } catch {
      toast.error("Error al cambiar estado");
    }
  };

  const getActionTypeConfig = (type: string) =>
    ACTION_TYPE_OPTIONS.find((t) => t.value === type) || ACTION_TYPE_OPTIONS[4];

  const getChannelName = (channelId: number | null) => {
    if (!channelId) return null;
    return channels.find((c) => c.ChannelId === channelId)?.Name || null;
  };

  const getRouteName = (routeId: number | null) => {
    if (!routeId) return null;
    return routes.find((r) => r.RouteId === routeId)?.Name || null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Cargando actividades...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1">Actividades Obligatorias</h1>
          <p className="text-muted-foreground">
            {activities.length} actividades configuradas &middot; Se asignan automaticamente al abrir una visita
          </p>
        </div>
        <Button className="gap-2" onClick={openCreate}>
          <Plus size={16} />
          Nueva Actividad
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-espert-gold/10 border-espert-gold/30">
          <CardContent className="p-4 text-center">
            <ClipboardList size={24} className="mx-auto text-espert-gold mb-1" />
            <p className="text-2xl font-bold text-foreground">{activities.length}</p>
            <p className="text-xs text-espert-gold">Total</p>
          </CardContent>
        </Card>
        <Card className="bg-green-50 border-green-200">
          <CardContent className="p-4 text-center">
            <ClipboardList size={24} className="mx-auto text-green-600 mb-1" />
            <p className="text-2xl font-bold text-green-900">{activities.filter((a) => a.IsActive).length}</p>
            <p className="text-xs text-green-600">Activas</p>
          </CardContent>
        </Card>
        <Card className="bg-espert-gold/10 border-espert-gold/30">
          <CardContent className="p-4 text-center">
            <Camera size={24} className="mx-auto text-espert-gold mb-1" />
            <p className="text-2xl font-bold text-foreground">{activities.filter((a) => a.PhotoRequired).length}</p>
            <p className="text-xs text-espert-gold">Requieren foto</p>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-4 text-center">
            <ClipboardList size={24} className="mx-auto text-amber-600 mb-1" />
            <p className="text-2xl font-bold text-amber-900">
              {activities.filter((a) => !a.ChannelId && !a.RouteId).length}
            </p>
            <p className="text-xs text-amber-600">Globales</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre, tipo o descripción..."
          className="pl-10"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Actividad</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Tipo</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Alcance</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Foto</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Estado</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => {
                  const cfg = getActionTypeConfig(a.ActionType);
                  const Icon = cfg.icon;
                  const channelName = getChannelName(a.ChannelId);
                  const routeName = getRouteName(a.RouteId);

                  return (
                    <tr key={a.MandatoryActivityId} className="border-b border-border hover:bg-muted transition-colors">
                      <td className="py-3 px-4">
                        <p className="font-semibold text-foreground">{a.Name}</p>
                        {a.Description && <p className="text-xs text-muted-foreground mt-0.5">{a.Description}</p>}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Badge className={cfg.color}>
                          <Icon size={12} className="mr-1" />
                          {cfg.label}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {!channelName && !routeName && (
                          <Badge variant="outline">Global</Badge>
                        )}
                        {channelName && (
                          <Badge variant="secondary" className="mr-1">Canal: {channelName}</Badge>
                        )}
                        {routeName && (
                          <Badge variant="secondary">Ruta: {routeName}</Badge>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {a.PhotoRequired ? (
                          <Badge className="bg-amber-100 text-amber-800">
                            <Camera size={12} className="mr-1" /> Requerida
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">No</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Switch checked={a.IsActive} onCheckedChange={() => handleToggleActive(a)} />
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(a)}>
                            <Edit size={16} />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDeleteActivity(a)}>
                            <Trash2 size={16} className="text-red-500" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-muted-foreground">
                      No se encontraron actividades
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); resetForm(); }}
        title={editingActivity ? "Editar Actividad" : "Nueva Actividad Obligatoria"}
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => { setIsModalOpen(false); resetForm(); }}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Guardando..." : editingActivity ? "Actualizar" : "Crear"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nombre *</Label>
            <Input
              placeholder="Ej: Cobertura mínima 3 SKUs"
              value={form.Name}
              onChange={(e) => setForm((f) => ({ ...f, Name: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label>Tipo de Acción *</Label>
            <Select value={form.ActionType} onValueChange={(v) => setForm((f) => ({ ...f, ActionType: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar tipo..." />
              </SelectTrigger>
              <SelectContent>
                {ACTION_TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Descripción</Label>
            <Textarea
              placeholder="Instrucciones para el representante..."
              value={form.Description}
              onChange={(e) => setForm((f) => ({ ...f, Description: e.target.value }))}
              className="min-h-[80px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Canal (opcional)</Label>
              <Select
                value={form.ChannelId ? String(form.ChannelId) : "all"}
                onValueChange={(v) => setForm((f) => ({ ...f, ChannelId: v === "all" ? "" : Number(v) }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos los canales" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los canales</SelectItem>
                  {channels.map((c) => (
                    <SelectItem key={c.ChannelId} value={String(c.ChannelId)}>{c.Name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Ruta (opcional)</Label>
              <Select
                value={form.RouteId ? String(form.RouteId) : "all"}
                onValueChange={(v) => setForm((f) => ({ ...f, RouteId: v === "all" ? "" : Number(v) }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todas las rutas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las rutas</SelectItem>
                  {routes.map((r) => (
                    <SelectItem key={r.RouteId} value={String(r.RouteId)}>{r.Name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-6 pt-2">
            <div className="flex items-center gap-3">
              <Switch
                checked={form.PhotoRequired}
                onCheckedChange={(v) => setForm((f) => ({ ...f, PhotoRequired: v }))}
              />
              <Label>Foto obligatoria</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={form.IsActive}
                onCheckedChange={(v) => setForm((f) => ({ ...f, IsActive: v }))}
              />
              <Label>Activa</Label>
            </div>
          </div>

          <div className="bg-muted rounded-lg p-3 text-xs text-muted-foreground">
            <p className="font-semibold mb-1">Alcance de la actividad:</p>
            {!form.ChannelId && !form.RouteId && (
              <p>Se aplicara a <strong>todas las visitas</strong> de cualquier canal y ruta.</p>
            )}
            {form.ChannelId && !form.RouteId && (
              <p>Solo se aplicara a visitas de PDVs del canal seleccionado.</p>
            )}
            {!form.ChannelId && form.RouteId && (
              <p>Solo se aplicara a visitas dentro de la ruta seleccionada.</p>
            )}
            {form.ChannelId && form.RouteId && (
              <p>Solo se aplicara a visitas que coincidan con el canal <strong>y</strong> la ruta seleccionados.</p>
            )}
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmModal
        isOpen={!!deleteActivity}
        onClose={() => setDeleteActivity(null)}
        onConfirm={handleDelete}
        title="Eliminar Actividad"
        message={`¿Estás seguro de eliminar "${deleteActivity?.Name}"? Las acciones ya creadas en visitas existentes no se verán afectadas.`}
        confirmText="Eliminar"
        type="danger"
      />
    </div>
  );
}
