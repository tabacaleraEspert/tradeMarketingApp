import { useState, useMemo } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Modal } from "../../components/ui/modal";
import {
  Plus,
  Edit,
  Trash2,
  Eye,
  CheckSquare,
  Type,
  List,
  Image,
  Hash,
  Calendar,
  ToggleLeft,
  Route,
  Search,
  ChevronRight,
  FileText,
  ClipboardList,
  Link2,
  Camera,
  Package,
  Megaphone,
  Repeat,
  Tag,
  MoreHorizontal,
  Zap,
  BookOpen,
} from "lucide-react";
import { useApiList, formsApi, routesApi, mandatoryActivitiesApi } from "@/lib/api";
import type { MandatoryActivity } from "@/lib/api";
import { toast } from "sonner";

interface FormWithQuestions {
  FormId: number;
  Name: string;
  Channel: string | null;
  Version: number;
  IsActive: boolean;
  CreatedAt: string;
  questionsCount?: number;
}

const FIELD_TYPES = [
  { type: "text", icon: Type, label: "Texto" },
  { type: "number", icon: Hash, label: "Número" },
  { type: "select", icon: List, label: "Selección" },
  { type: "checkbox", icon: CheckSquare, label: "Checkbox" },
  { type: "radio", icon: ToggleLeft, label: "Radio" },
  { type: "date", icon: Calendar, label: "Fecha" },
  { type: "textarea", icon: Type, label: "Texto Largo" },
  { type: "photo", icon: Image, label: "Foto" },
];

const ACTION_TYPES = [
  { value: "cobertura", label: "Generación de Cobertura", icon: Package, color: "bg-amber-50 text-amber-700" },
  { value: "pop", label: "Colocación de POP", icon: Megaphone, color: "bg-blue-50 text-blue-700" },
  { value: "canje_sueltos", label: "Canje de Sueltos", icon: Repeat, color: "bg-green-50 text-green-700" },
  { value: "promo", label: "Activación de Promo", icon: Tag, color: "bg-orange-50 text-orange-700" },
  { value: "otra", label: "Otra Acción", icon: MoreHorizontal, color: "bg-gray-50 text-gray-600" },
];

const CHANNELS = ["Kiosco", "Autoservicio", "Mayorista", "Supermercado", "Relevamiento", "Gastronomía"];

export function FormBuilder() {
  const navigate = useNavigate();
  // Active tab
  const [activeTab, setActiveTab] = useState<"relevamiento" | "ejecucion">("relevamiento");

  // Form state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedForm, setSelectedForm] = useState<FormWithQuestions | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formChannel, setFormChannel] = useState("");
  const [formVersion, setFormVersion] = useState(1);
  const [saving, setSaving] = useState(false);
  const [previewQuestions, setPreviewQuestions] = useState<Awaited<ReturnType<typeof formsApi.listQuestions>>>([]);
  const [assignRoutesFormId, setAssignRoutesFormId] = useState<number | null>(null);
  const [routeIdsWithForm, setRouteIdsWithForm] = useState<Set<number>>(new Set());
  const [assignLoading, setAssignLoading] = useState(false);

  // Activity state
  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<MandatoryActivity | null>(null);
  const [actForm, setActForm] = useState({
    Name: "", ActionType: "", Description: "", PhotoRequired: true,
    ChannelId: "" as number | "", RouteId: "" as number | "", IsActive: true,
  });

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [filterChannel, setFilterChannel] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  // Data
  const { data: routes } = useApiList(() => routesApi.list());
  const { data: forms, loading: formsLoading, refetch: refetchForms } = useApiList(async () => {
    const f = await formsApi.list();
    return Promise.all(
      f.map(async (form) => {
        const q = await formsApi.listQuestions(form.FormId);
        return { ...form, questionsCount: q.length };
      })
    );
  });
  const { data: activities, loading: activitiesLoading, refetch: refetchActivities } = useApiList(
    () => mandatoryActivitiesApi.list()
  );

  const uniqueChannels = useMemo(() => {
    const channels = new Set<string>();
    forms.forEach((f) => { if (f.Channel) channels.add(f.Channel); });
    return Array.from(channels).sort();
  }, [forms]);

  // Filtered forms
  const filteredForms = useMemo(() => {
    return forms.filter((f) => {
      if (searchTerm && !f.Name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (filterChannel !== "all" && f.Channel !== filterChannel) return false;
      if (filterStatus === "active" && !f.IsActive) return false;
      if (filterStatus === "inactive" && f.IsActive) return false;
      return true;
    });
  }, [forms, searchTerm, filterChannel, filterStatus]);

  // Filtered activities
  const filteredActivities = useMemo(() => {
    return activities.filter((a) => {
      if (searchTerm && !a.Name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (filterStatus === "active" && !a.IsActive) return false;
      if (filterStatus === "inactive" && a.IsActive) return false;
      return true;
    });
  }, [activities, searchTerm, filterStatus]);

  const totalQuestions = forms.reduce((s, f) => s + (f.questionsCount ?? 0), 0);

  const openActivityModal = (activity?: MandatoryActivity) => {
    if (activity) {
      setEditingActivity(activity);
      setActForm({
        Name: activity.Name, ActionType: activity.ActionType, Description: activity.Description || "",
        PhotoRequired: activity.PhotoRequired, ChannelId: activity.ChannelId ?? "",
        RouteId: activity.RouteId ?? "", IsActive: activity.IsActive,
      });
    } else {
      setEditingActivity(null);
      setActForm({ Name: "", ActionType: "", Description: "", PhotoRequired: true, ChannelId: "", RouteId: "", IsActive: true });
    }
    setIsActivityModalOpen(true);
  };

  const handleSaveActivity = async () => {
    if (!actForm.Name.trim() || !actForm.ActionType) {
      toast.error("Nombre y tipo son obligatorios");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        Name: actForm.Name, ActionType: actForm.ActionType, Description: actForm.Description || undefined,
        PhotoRequired: actForm.PhotoRequired,
        ChannelId: actForm.ChannelId ? Number(actForm.ChannelId) : undefined,
        RouteId: actForm.RouteId ? Number(actForm.RouteId) : undefined,
        IsActive: actForm.IsActive,
      };
      if (editingActivity) {
        await mandatoryActivitiesApi.update(editingActivity.MandatoryActivityId, payload);
        toast.success("Acción actualizada");
      } else {
        await mandatoryActivitiesApi.create(payload);
        toast.success("Acción creada");
      }
      setIsActivityModalOpen(false);
      refetchActivities();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Plantillas de Visita</h1>
          <p className="text-muted-foreground">Configurar qué debe relevar y ejecutar el Trade Rep en cada visita</p>
        </div>
        <Button
          onClick={() => {
            if (activeTab === "relevamiento") {
              setIsCreateModalOpen(true);
              setSelectedForm(null);
              setFormName("");
              setFormChannel("");
              setFormVersion(1);
            } else {
              openActivityModal();
            }
          }}
          className="gap-2"
        >
          <Plus size={20} />
          {activeTab === "relevamiento" ? "Nuevo Formulario" : "Nueva Acción"}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50">
                <BookOpen size={20} className="text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{forms.filter((f) => f.IsActive).length}</p>
                <p className="text-xs text-muted-foreground">Formularios activos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-50">
                <ClipboardList size={20} className="text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{totalQuestions}</p>
                <p className="text-xs text-muted-foreground">Preguntas</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-50">
                <Zap size={20} className="text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{activities.filter((a) => a.IsActive).length}</p>
                <p className="text-xs text-muted-foreground">Acciones de ejecución</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-50">
                <Camera size={20} className="text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{activities.filter((a) => a.PhotoRequired).length}</p>
                <p className="text-xs text-muted-foreground">Con foto obligatoria</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        <button
          onClick={() => setActiveTab("relevamiento")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
            activeTab === "relevamiento"
              ? "border-[#A48242] text-[#A48242]"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <BookOpen size={16} />
          Relevamiento
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-1">{forms.length}</Badge>
        </button>
        <button
          onClick={() => setActiveTab("ejecucion")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
            activeTab === "ejecucion"
              ? "border-[#A48242] text-[#A48242]"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Zap size={16} />
          Acciones de Ejecución
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-1">{activities.length}</Badge>
        </button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
              <Input
                placeholder={activeTab === "relevamiento" ? "Buscar formulario..." : "Buscar acción..."}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            {activeTab === "relevamiento" && (
              <select
                className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-espert-gold text-sm"
                value={filterChannel}
                onChange={(e) => setFilterChannel(e.target.value)}
              >
                <option value="all">Todos los canales</option>
                {uniqueChannels.map((ch) => (
                  <option key={ch} value={ch}>{ch}</option>
                ))}
              </select>
            )}
            <select
              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-espert-gold text-sm"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="all">Todos los estados</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* ===== RELEVAMIENTO TAB ===== */}
      {activeTab === "relevamiento" && (
        <Card>
          <CardContent className="p-0">
            <div className="grid grid-cols-[1fr_120px_100px_100px_140px_80px] gap-3 px-4 py-3 border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              <span>Formulario</span>
              <span>Canal</span>
              <span className="text-center">Preguntas</span>
              <span className="text-center">Versión</span>
              <span>Creado</span>
              <span></span>
            </div>
            {filteredForms.length === 0 && !formsLoading && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <BookOpen size={40} className="opacity-30 mb-2" />
                <p className="font-medium">Sin formularios</p>
                <p className="text-sm">Los formularios capturan datos del PDV (precios, SKUs, materiales)</p>
              </div>
            )}
            {filteredForms.map((form) => (
              <div
                key={form.FormId}
                className="grid grid-cols-[1fr_120px_100px_100px_140px_80px] gap-3 px-4 py-3 border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors items-center"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-foreground truncate">{form.Name}</p>
                    <Badge variant={form.IsActive ? "default" : "secondary"} className="text-[10px] px-1.5 py-0 shrink-0">
                      {form.IsActive ? "Activo" : "Inactivo"}
                    </Badge>
                  </div>
                  <button
                    onClick={async () => {
                      setAssignRoutesFormId(form.FormId);
                      const res = await formsApi.getRoutesWithForm(form.FormId);
                      setRouteIdsWithForm(new Set(res.route_ids));
                    }}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-[#A48242] mt-0.5 transition-colors"
                  >
                    <Route size={11} />
                    Asignar a rutas
                  </button>
                </div>
                <div>
                  {form.Channel ? <Badge variant="outline" className="text-xs">{form.Channel}</Badge> : <span className="text-xs text-muted-foreground">-</span>}
                </div>
                <div className="text-center">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[#A48242]/10 text-[#A48242] font-bold text-sm">{form.questionsCount ?? 0}</span>
                </div>
                <div className="text-center">
                  <Badge variant="outline" className="text-xs">v{form.Version}</Badge>
                </div>
                <div className="text-sm text-muted-foreground">
                  {new Date(form.CreatedAt).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })}
                </div>
                <div className="flex items-center justify-end gap-0.5">
                  <button onClick={async () => { setSelectedForm(form); setIsPreviewOpen(true); setPreviewQuestions(await formsApi.listQuestions(form.FormId)); }} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Vista previa"><Eye size={15} /></button>
                  <button onClick={() => navigate(`/admin/forms/${form.FormId}/edit`)} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Editar"><Edit size={15} /></button>
                  <button onClick={async () => { if (confirm("¿Eliminar?")) { await formsApi.delete(form.FormId); toast.success("Eliminado"); refetchForms(); } }} className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors" title="Eliminar"><Trash2 size={15} /></button>
                  <ChevronRight size={16} className="text-muted-foreground cursor-pointer" onClick={() => navigate(`/admin/forms/${form.FormId}/edit`)} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ===== EJECUCION TAB ===== */}
      {activeTab === "ejecucion" && (
        <Card>
          <CardContent className="p-0">
            <div className="grid grid-cols-[1fr_160px_100px_100px_80px] gap-3 px-4 py-3 border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              <span>Acción</span>
              <span>Tipo</span>
              <span className="text-center">Foto</span>
              <span className="text-center">Estado</span>
              <span></span>
            </div>
            {filteredActivities.length === 0 && !activitiesLoading && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Zap size={40} className="opacity-30 mb-2" />
                <p className="font-medium">Sin acciones de ejecución</p>
                <p className="text-sm">Las acciones son tareas que el Rep ejecuta en el PDV (colocar POP, canjear sueltos, etc.)</p>
              </div>
            )}
            {filteredActivities.map((act) => {
              const typeInfo = ACTION_TYPES.find((t) => t.value === act.ActionType);
              const TypeIcon = typeInfo?.icon || MoreHorizontal;
              return (
                <div
                  key={act.MandatoryActivityId}
                  className="grid grid-cols-[1fr_160px_100px_100px_80px] gap-3 px-4 py-3 border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors items-center cursor-pointer"
                  onClick={() => openActivityModal(act)}
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">{act.Name}</p>
                    {act.Description && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{act.Description}</p>
                    )}
                  </div>
                  <div>
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full ${typeInfo?.color || "bg-gray-50 text-gray-600"}`}>
                      <TypeIcon size={13} />
                      {typeInfo?.label || act.ActionType}
                    </span>
                  </div>
                  <div className="text-center">
                    {act.PhotoRequired ? (
                      <span className="inline-flex items-center gap-1 text-xs text-purple-600">
                        <Camera size={14} />
                        Sí
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">No</span>
                    )}
                  </div>
                  <div className="text-center">
                    <Badge variant={act.IsActive ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                      {act.IsActive ? "Activa" : "Inactiva"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-end gap-0.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); if (confirm("¿Eliminar?")) { mandatoryActivitiesApi.delete(act.MandatoryActivityId).then(() => { toast.success("Eliminada"); refetchActivities(); }).catch((err) => toast.error(err instanceof Error ? err.message : "Error")); } }}
                      className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                    <ChevronRight size={16} className="text-muted-foreground" />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ===== MODALS ===== */}

      {/* Create/Edit Form Modal */}
      <Modal
        isOpen={isCreateModalOpen || (selectedForm !== null && !isPreviewOpen)}
        onClose={() => { setIsCreateModalOpen(false); setSelectedForm(null); }}
        title={selectedForm ? "Editar Formulario" : "Nuevo Formulario de Relevamiento"}
        size="xl"
        footer={<>
          <Button variant="outline" onClick={() => { setIsCreateModalOpen(false); setSelectedForm(null); }}>Cancelar</Button>
          <Button disabled={saving || !formName.trim()} onClick={async () => {
            setSaving(true);
            try {
              if (selectedForm) {
                await formsApi.update(selectedForm.FormId, { Name: formName, Channel: formChannel || undefined, Version: formVersion });
                toast.success("Formulario actualizado"); setIsCreateModalOpen(false); setSelectedForm(null); refetchForms();
              } else {
                const newForm = await formsApi.create({ Name: formName, Channel: formChannel || undefined, Version: formVersion });
                toast.success("Formulario creado"); setIsCreateModalOpen(false); setSelectedForm(null); refetchForms();
                navigate(`/admin/forms/${newForm.FormId}/edit`);
              }
            } catch (e) { toast.error(e instanceof Error ? e.message : "Error"); } finally { setSaving(false); }
          }}>{saving ? "Guardando..." : "Guardar"}</Button>
        </>}
      >
        <div className="space-y-4">
          <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
            Los formularios de relevamiento capturan datos observables: precios, SKUs, materiales POP, promociones, proveedores.
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Nombre</label>
            <Input placeholder="Ej: Censo de Precios - Kioscos" value={formName} onChange={(e) => setFormName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Canal</label>
            <select className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-espert-gold" value={formChannel} onChange={(e) => setFormChannel(e.target.value)}>
              <option value="">Todos los canales</option>
              {CHANNELS.map((ch) => <option key={ch} value={ch}>{ch}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Versión</label>
            <Input type="number" min={1} value={formVersion} onChange={(e) => setFormVersion(Number(e.target.value) || 1)} />
          </div>
        </div>
      </Modal>

      {/* Create/Edit Activity Modal */}
      <Modal
        isOpen={isActivityModalOpen}
        onClose={() => setIsActivityModalOpen(false)}
        title={editingActivity ? "Editar Acción de Ejecución" : "Nueva Acción de Ejecución"}
        size="lg"
        footer={<>
          <Button variant="outline" onClick={() => setIsActivityModalOpen(false)}>Cancelar</Button>
          <Button disabled={saving || !actForm.Name.trim() || !actForm.ActionType} onClick={handleSaveActivity}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </>}
      >
        <div className="space-y-4">
          <div className="p-3 bg-green-50 rounded-lg text-sm text-green-700">
            Las acciones de ejecución son tareas que el Rep realiza en el PDV: colocar materiales, canjear sueltos, activar promos. Requieren evidencia fotográfica.
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Nombre de la acción</label>
            <Input placeholder="Ej: Colocar cigarrera en mostrador" value={actForm.Name} onChange={(e) => setActForm((f) => ({ ...f, Name: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Tipo de acción</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {ACTION_TYPES.map((at) => {
                const Icon = at.icon;
                return (
                  <button
                    key={at.value}
                    type="button"
                    onClick={() => setActForm((f) => ({ ...f, ActionType: at.value }))}
                    className={`flex items-center gap-2 p-3 rounded-lg border-2 text-sm font-medium transition-colors ${
                      actForm.ActionType === at.value
                        ? "border-[#A48242] bg-[#A48242]/5"
                        : "border-border hover:border-muted-foreground/30"
                    }`}
                  >
                    <Icon size={16} />
                    {at.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Descripción</label>
            <textarea
              className="w-full px-3 py-2 border border-border rounded-lg text-sm"
              rows={2}
              placeholder="Instrucciones para el Rep..."
              value={actForm.Description}
              onChange={(e) => setActForm((f) => ({ ...f, Description: e.target.value }))}
            />
          </div>
          <div className="flex items-center justify-between p-3 border border-border rounded-lg">
            <div>
              <p className="text-sm font-medium text-foreground">Foto obligatoria</p>
              <p className="text-xs text-muted-foreground">El Rep debe tomar foto como evidencia</p>
            </div>
            <button
              type="button"
              onClick={() => setActForm((f) => ({ ...f, PhotoRequired: !f.PhotoRequired }))}
              className={`w-10 h-6 rounded-full transition-colors ${actForm.PhotoRequired ? "bg-[#A48242]" : "bg-gray-300"}`}
            >
              <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-1 ${actForm.PhotoRequired ? "translate-x-4" : ""}`} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Ruta (opcional)</label>
              <select className="w-full px-3 py-2 border border-border rounded-lg text-sm" value={actForm.RouteId} onChange={(e) => setActForm((f) => ({ ...f, RouteId: e.target.value ? Number(e.target.value) : "" }))}>
                <option value="">Todas las rutas</option>
                {routes.map((r) => <option key={r.RouteId} value={r.RouteId}>{r.Name}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 pb-2">
                <input type="checkbox" checked={actForm.IsActive} onChange={(e) => setActForm((f) => ({ ...f, IsActive: e.target.checked }))} />
                <span className="text-sm">Activa</span>
              </label>
            </div>
          </div>
        </div>
      </Modal>

      {/* Assign to Routes Modal */}
      <Modal
        isOpen={assignRoutesFormId !== null}
        onClose={() => setAssignRoutesFormId(null)}
        title={`Asignar a rutas: ${assignRoutesFormId ? forms.find((f) => f.FormId === assignRoutesFormId)?.Name ?? "" : ""}`}
        size="lg"
        footer={assignRoutesFormId && (
          <div className="flex items-center justify-between w-full">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={assignLoading} onClick={async () => { setAssignLoading(true); try { await formsApi.bulkAssignToRoutes(assignRoutesFormId, { assign_to_all: true }); const res = await formsApi.getRoutesWithForm(assignRoutesFormId); setRouteIdsWithForm(new Set(res.route_ids)); toast.success("Asignado a todas"); } catch (e) { toast.error(e instanceof Error ? e.message : "Error"); } finally { setAssignLoading(false); } }}>Asignar a todos</Button>
            </div>
            <Button variant="outline" onClick={() => setAssignRoutesFormId(null)}>Cerrar</Button>
          </div>
        )}
      >
        {assignRoutesFormId && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-2 bg-muted rounded-lg">
              <span className="text-sm font-medium">{routeIdsWithForm.size} de {routes.length} rutas asignadas</span>
            </div>
            <div className="max-h-64 overflow-y-auto border rounded-lg divide-y">
              {routes.map((route) => (
                <label key={route.RouteId} className="flex items-center gap-3 p-3 hover:bg-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={routeIdsWithForm.has(route.RouteId)}
                    onChange={async (e) => {
                      setAssignLoading(true);
                      try {
                        if (e.target.checked) {
                          await routesApi.addForm(route.RouteId, { FormId: assignRoutesFormId, SortOrder: 0 });
                          setRouteIdsWithForm((prev) => new Set([...prev, route.RouteId]));
                        } else {
                          await formsApi.removeFromRoute(assignRoutesFormId, route.RouteId);
                          setRouteIdsWithForm((prev) => { const n = new Set(prev); n.delete(route.RouteId); return n; });
                        }
                      } catch (err) { toast.error(err instanceof Error ? err.message : "Error"); } finally { setAssignLoading(false); }
                    }}
                    disabled={assignLoading}
                  />
                  <span className="flex-1 text-sm font-medium">{route.Name}</span>
                  {route.AssignedUserName && <span className="text-xs text-muted-foreground">{route.AssignedUserName}</span>}
                </label>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* Preview Modal */}
      <Modal isOpen={isPreviewOpen} onClose={() => { setIsPreviewOpen(false); setSelectedForm(null); }} title={`Vista Previa: ${selectedForm?.Name}`} size="lg">
        <div className="space-y-4">
          {previewQuestions.map((q) => {
            const qType = q.QType?.toLowerCase() || "text";
            const FieldIcon = FIELD_TYPES.find((ft) => ft.type === qType)?.icon || Type;
            return (
              <div key={q.QuestionId} className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <FieldIcon size={16} />{q.Label}{q.IsRequired && <span className="text-red-500">*</span>}
                </label>
                {qType === "text" && <Input placeholder="Ingresar texto..." disabled />}
                {qType === "number" && <Input type="number" placeholder="0" disabled />}
                {(qType === "select" || qType === "radio") && <select className="w-full px-3 py-2 border border-border rounded-lg" disabled><option>Seleccionar...</option></select>}
                {qType === "textarea" && <textarea className="w-full px-3 py-2 border border-border rounded-lg" rows={2} disabled placeholder="Ingresar..." />}
                {qType === "checkbox" && <label className="flex items-center gap-2"><input type="checkbox" disabled /><span className="text-sm text-muted-foreground">Marcar si aplica</span></label>}
                {qType === "photo" && <div className="border-2 border-dashed border-border rounded-lg p-4 text-center text-sm text-muted-foreground"><Image size={24} className="mx-auto mb-1 opacity-40" />Captura de foto</div>}
              </div>
            );
          })}
          {previewQuestions.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <ClipboardList size={40} className="mx-auto opacity-30 mb-2" />
              <p className="font-medium">Sin preguntas</p>
              <p className="text-sm">Editá el formulario para agregar preguntas</p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
