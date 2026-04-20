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
import { getCurrentUser } from "../../lib/auth";

interface FormWithQuestions {
  FormId: number;
  Name: string;
  Channel: string | null;
  Version: number;
  IsActive: boolean;
  Frequency?: string | null;
  FrequencyConfig?: string | null;
  CreatedByUserId?: number | null;
  CreatedAt: string;
  questionsCount?: number;
}

const FIELD_TYPES = [
  { type: "text", icon: Type, label: "Texto" },
  { type: "number", icon: Hash, label: "Número" },
  { type: "select", icon: List, label: "Selección" },
  { type: "checkbox", icon: CheckSquare, label: "Checkbox" },
  { type: "checkbox_price", icon: Tag, label: "Cobertura + Precio" },
  { type: "coverage", icon: Package, label: "Cobertura Completa" },
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
  const currentUser = getCurrentUser();
  const isAdmin = currentUser.role === "admin";
  const currentUserId = Number(currentUser.id);

  // A form is "national" (admin-created) if CreatedByUserId is null (legacy) or belongs to an admin
  // For simplicity: null = national, has CreatedByUserId = check if it's the current user's
  const isNationalForm = (form: FormWithQuestions) => !form.CreatedByUserId;
  const canEditForm = (form: FormWithQuestions) => isAdmin || form.CreatedByUserId === currentUserId;

  // Active tab
  const [activeTab, setActiveTab] = useState<"relevamiento" | "ejecucion">("relevamiento");

  // Form state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedForm, setSelectedForm] = useState<FormWithQuestions | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formChannel, setFormChannel] = useState("");
  const [formVersion, setFormVersion] = useState(1);
  const [formFrequency, setFormFrequency] = useState<string>("always");
  const [formFrequencyConfig, setFormFrequencyConfig] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [previewQuestions, setPreviewQuestions] = useState<Awaited<ReturnType<typeof formsApi.listQuestions>>>([]);
  const [assignRoutesFormId, setAssignRoutesFormId] = useState<number | null>(null);
  const [routeIdsWithForm, setRouteIdsWithForm] = useState<Set<number>>(new Set());
  const [draftRouteIds, setDraftRouteIds] = useState<Set<number>>(new Set());
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignSearch, setAssignSearch] = useState("");

  // Activity state
  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<MandatoryActivity | null>(null);
  const [actForm, setActForm] = useState({
    Name: "", ActionType: "", Description: "", PhotoRequired: true,
    ChannelId: "" as number | "", RouteId: "" as number | "",
    FormId: "" as number | "", IsActive: true,
    ValidFrom: "", ValidTo: "",
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
        RouteId: activity.RouteId ?? "", FormId: activity.FormId ?? "", IsActive: activity.IsActive,
        ValidFrom: activity.ValidFrom ?? "", ValidTo: activity.ValidTo ?? "",
      });
    } else {
      setEditingActivity(null);
      setActForm({ Name: "", ActionType: "", Description: "", PhotoRequired: true, ChannelId: "", RouteId: "", FormId: "", IsActive: true, ValidFrom: "", ValidTo: "" });
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
        FormId: actForm.FormId ? Number(actForm.FormId) : undefined,
        ValidFrom: actForm.ValidFrom || undefined,
        ValidTo: actForm.ValidTo || undefined,
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
              setFormFrequency("always");
              setFormFrequencyConfig("");
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-foreground truncate">{form.Name}</p>
                    <Badge variant={form.IsActive ? "default" : "secondary"} className="text-[10px] px-1.5 py-0 shrink-0">
                      {form.IsActive ? "Activo" : "Inactivo"}
                    </Badge>
                    {isNationalForm(form) && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 gap-0.5 border-blue-200 text-blue-700 bg-blue-50">
                        Nacional
                      </Badge>
                    )}
                    {form.Frequency && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 gap-1 border-[#A48242]/30 text-[#A48242]">
                        <Repeat size={9} />
                        {form.Frequency === "always" && "Hasta nuevo aviso"}
                        {form.Frequency === "weekly" && "Semanal"}
                        {form.Frequency === "biweekly" && "Quincenal"}
                        {form.Frequency === "monthly" && "Mensual"}
                        {form.Frequency === "every_x_days" && (() => { try { return `Cada ${JSON.parse(form.FrequencyConfig || "{}").interval || 15}d`; } catch { return "Cada X días"; } })()}
                        {form.Frequency === "specific_days" && "Días específicos"}
                      </Badge>
                    )}
                  </div>
                  <button
                    onClick={async () => {
                      setAssignRoutesFormId(form.FormId);
                      setAssignSearch("");
                      const res = await formsApi.getRoutesWithForm(form.FormId);
                      const initial = new Set(res.route_ids);
                      setRouteIdsWithForm(initial);
                      setDraftRouteIds(new Set(initial));
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
                  {canEditForm(form) ? (
                    <>
                      <button onClick={() => navigate(`/admin/forms/${form.FormId}/edit`)} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Editar"><Edit size={15} /></button>
                      <button onClick={async () => { if (confirm("¿Eliminar?")) { await formsApi.delete(form.FormId); toast.success("Eliminado"); refetchForms(); } }} className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors" title="Eliminar"><Trash2 size={15} /></button>
                    </>
                  ) : (
                    <span className="text-[10px] text-muted-foreground px-1">Solo lectura</span>
                  )}
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
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground truncate">{act.Name}</p>
                      {act.FormId && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 gap-0.5 border-blue-200 text-blue-700 bg-blue-50">
                          <BookOpen size={9} />
                          {forms.find((f) => f.FormId === act.FormId)?.Name ?? "Form"}
                        </Badge>
                      )}
                      {(act.ValidFrom || act.ValidTo) && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 gap-0.5 border-amber-200 text-amber-700 bg-amber-50">
                          {act.ValidFrom && act.ValidTo
                            ? `${new Date(act.ValidFrom + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })} – ${new Date(act.ValidTo + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })}`
                            : act.ValidFrom
                            ? `Desde ${new Date(act.ValidFrom + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })}`
                            : `Hasta ${new Date(act.ValidTo! + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })}`}
                        </Badge>
                      )}
                    </div>
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
              const freqPayload = {
                Frequency: formFrequency || null,
                FrequencyConfig: formFrequencyConfig || null,
              };
              if (selectedForm) {
                await formsApi.update(selectedForm.FormId, { Name: formName, Channel: formChannel || undefined, Version: formVersion, ...freqPayload });
                toast.success("Formulario actualizado"); setIsCreateModalOpen(false); setSelectedForm(null); refetchForms();
              } else {
                const newForm = await formsApi.create({ Name: formName, Channel: formChannel || undefined, Version: formVersion, ...freqPayload });
                toast.success("Formulario creado"); setIsCreateModalOpen(false); setSelectedForm(null); refetchForms();
                navigate(`/admin/forms/${newForm.FormId}/edit`);
              }
            } catch (e) { toast.error(e instanceof Error ? e.message : "Error"); } finally { setSaving(false); }
          }}>{saving ? "Guardando..." : selectedForm ? "Guardar cambios" : "Crear y agregar preguntas"}</Button>
        </>}
      >
        <div className="space-y-5">
          {/* Hero header */}
          <div className="flex items-start gap-3 p-4 bg-gradient-to-br from-[#A48242]/10 to-blue-50 rounded-xl border border-[#A48242]/20">
            <div className="p-2.5 bg-white rounded-lg shadow-sm">
              <BookOpen size={22} className="text-[#A48242]" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground mb-0.5">
                {selectedForm ? "Editá los datos básicos del formulario" : "Creá un nuevo formulario de relevamiento"}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Los formularios capturan datos observables del PDV: precios, SKUs, materiales POP, promociones y proveedores.
                {!selectedForm && " Después podrás agregar preguntas y asignarlo a rutas."}
              </p>
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-semibold text-foreground mb-2">
              Nombre del formulario
              <span className="text-red-500">*</span>
            </label>
            <Input
              placeholder="Ej: Censo de Precios - Kioscos"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="text-base h-11"
              autoFocus
            />
            <p className="text-xs text-muted-foreground mt-1">Usá un nombre descriptivo. Lo verás en el listado y los reps lo verán en la app.</p>
          </div>

          {/* Channel selector as buttons */}
          <div>
            <label className="block text-sm font-semibold text-foreground mb-2">Canal</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setFormChannel("")}
                className={`px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                  formChannel === ""
                    ? "border-[#A48242] bg-[#A48242]/5 text-[#A48242]"
                    : "border-border hover:border-muted-foreground/30 text-muted-foreground"
                }`}
              >
                Todos los canales
              </button>
              {CHANNELS.map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => setFormChannel(ch)}
                  className={`px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                    formChannel === ch
                      ? "border-[#A48242] bg-[#A48242]/5 text-[#A48242]"
                      : "border-border hover:border-muted-foreground/30 text-muted-foreground"
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>

          {/* Version */}
          <div>
            <label className="block text-sm font-semibold text-foreground mb-2">Versión</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFormVersion(Math.max(1, formVersion - 1))}
                className="w-10 h-10 rounded-lg border border-border hover:bg-muted text-lg font-bold text-muted-foreground"
              >−</button>
              <Input
                type="number"
                min={1}
                value={formVersion}
                onChange={(e) => setFormVersion(Number(e.target.value) || 1)}
                className="text-center font-semibold w-20 h-10"
              />
              <button
                type="button"
                onClick={() => setFormVersion(formVersion + 1)}
                className="w-10 h-10 rounded-lg border border-border hover:bg-muted text-lg font-bold text-muted-foreground"
              >+</button>
              <p className="text-xs text-muted-foreground ml-2">Subí la versión cuando hagas cambios significativos.</p>
            </div>
          </div>

          {/* Frequency */}
          <div>
            <label className="block text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
              <Repeat size={14} /> Frecuencia
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {[
                { value: "always", label: "Hasta nuevo aviso" },
                { value: "weekly", label: "Semanal" },
                { value: "biweekly", label: "Quincenal" },
                { value: "monthly", label: "Mensual" },
                { value: "every_x_days", label: "Cada X días" },
                { value: "specific_days", label: "Días específicos" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setFormFrequency(opt.value);
                    if (opt.value === "every_x_days") setFormFrequencyConfig(JSON.stringify({ interval: 15 }));
                    else if (opt.value === "specific_days") setFormFrequencyConfig(JSON.stringify({ days: [] }));
                    else setFormFrequencyConfig("");
                  }}
                  className={`px-3 py-2 rounded-lg border-2 text-xs font-medium transition-all ${
                    formFrequency === opt.value
                      ? "border-[#A48242] bg-[#A48242]/5 text-[#A48242]"
                      : "border-border hover:border-muted-foreground/30 text-muted-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {formFrequency === "every_x_days" && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Cada</span>
                <Input
                  type="number"
                  min={1}
                  className="w-20 h-8 text-sm text-center"
                  value={(() => { try { return JSON.parse(formFrequencyConfig || "{}").interval || 15; } catch { return 15; } })()}
                  onChange={(e) => setFormFrequencyConfig(JSON.stringify({ interval: Number(e.target.value) || 15 }))}
                />
                <span className="text-xs text-muted-foreground">días</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Los formularios <strong>NO</strong> afectan el % de cumplimiento de la visita. Sólo las acciones obligatorias se cuentan.
            </p>
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
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1 flex items-center gap-1">
                <BookOpen size={12} /> Formulario vinculado (opcional)
              </label>
              <select className="w-full px-3 py-2 border border-border rounded-lg text-sm" value={actForm.FormId} onChange={(e) => setActForm((f) => ({ ...f, FormId: e.target.value ? Number(e.target.value) : "" }))}>
                <option value="">Sin formulario</option>
                {forms.map((f) => <option key={f.FormId} value={f.FormId}>{f.Name}</option>)}
              </select>
              <p className="text-[10px] text-muted-foreground mt-1">El Rep completará este form al ejecutar la acción</p>
            </div>
          </div>
          {/* Vigencia temporal */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Vigencia (opcional)</label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-muted-foreground mb-0.5">Desde</label>
                <input type="date" className="w-full px-3 py-2 border border-border rounded-lg text-sm" value={actForm.ValidFrom} onChange={(e) => setActForm((f) => ({ ...f, ValidFrom: e.target.value }))} />
              </div>
              <div>
                <label className="block text-[11px] text-muted-foreground mb-0.5">Hasta</label>
                <input type="date" className="w-full px-3 py-2 border border-border rounded-lg text-sm" value={actForm.ValidTo} onChange={(e) => setActForm((f) => ({ ...f, ValidTo: e.target.value }))} />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Dejá vacío para que aplique sin límite de tiempo</p>
          </div>
          <div className="flex items-center justify-end">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={actForm.IsActive} onChange={(e) => setActForm((f) => ({ ...f, IsActive: e.target.checked }))} />
              <span className="text-sm">Activa</span>
            </label>
          </div>
        </div>
      </Modal>

      {/* Assign to Routes Modal */}
      <Modal
        isOpen={assignRoutesFormId !== null}
        onClose={() => setAssignRoutesFormId(null)}
        title={`Asignar a rutas: ${assignRoutesFormId ? forms.find((f) => f.FormId === assignRoutesFormId)?.Name ?? "" : ""}`}
        size="lg"
        footer={assignRoutesFormId && (() => {
          const toAdd = [...draftRouteIds].filter((id) => !routeIdsWithForm.has(id));
          const toRemove = [...routeIdsWithForm].filter((id) => !draftRouteIds.has(id));
          const dirty = toAdd.length > 0 || toRemove.length > 0;
          return (
            <div className="flex items-center justify-between w-full">
              <p className="text-xs text-muted-foreground">
                {dirty
                  ? `${toAdd.length > 0 ? `+${toAdd.length} ` : ""}${toRemove.length > 0 ? `−${toRemove.length}` : ""} cambios pendientes`
                  : "Sin cambios"}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => setAssignRoutesFormId(null)}>Cancelar</Button>
                <Button
                  disabled={!dirty || assignLoading}
                  onClick={async () => {
                    setAssignLoading(true);
                    try {
                      if (toAdd.length > 0) {
                        await formsApi.bulkAssignToRoutes(assignRoutesFormId, { route_ids: toAdd });
                      }
                      for (const rid of toRemove) {
                        await formsApi.removeFromRoute(assignRoutesFormId, rid);
                      }
                      const res = await formsApi.getRoutesWithForm(assignRoutesFormId);
                      const fresh = new Set(res.route_ids);
                      setRouteIdsWithForm(fresh);
                      setDraftRouteIds(new Set(fresh));
                      toast.success(`Asignaciones actualizadas (${toAdd.length + toRemove.length} cambios)`);
                      setAssignRoutesFormId(null);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Error");
                    } finally {
                      setAssignLoading(false);
                    }
                  }}
                >
                  {assignLoading ? "Guardando..." : "Guardar cambios"}
                </Button>
              </div>
            </div>
          );
        })()}
      >
        {assignRoutesFormId && (() => {
          const filteredRoutes = routes.filter((r) =>
            !assignSearch || r.Name.toLowerCase().includes(assignSearch.toLowerCase()) ||
            (r.AssignedUserName || "").toLowerCase().includes(assignSearch.toLowerCase())
          );
          const visibleIds = filteredRoutes.map((r) => r.RouteId);
          const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => draftRouteIds.has(id));
          return (
            <div className="space-y-3">
              {/* Stats banner */}
              <div className="flex items-center justify-between p-3 bg-gradient-to-r from-[#A48242]/10 to-blue-50 rounded-lg border border-[#A48242]/20">
                <div className="flex items-center gap-2">
                  <Route size={16} className="text-[#A48242]" />
                  <span className="text-sm font-semibold text-foreground">
                    {draftRouteIds.size} de {routes.length} rutas seleccionadas
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDraftRouteIds(new Set(routes.map((r) => r.RouteId)))}
                    className="px-2.5 py-1 text-xs font-semibold text-[#A48242] hover:bg-[#A48242]/10 rounded transition-colors"
                  >
                    Todas
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraftRouteIds(new Set())}
                    className="px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted rounded transition-colors"
                  >
                    Ninguna
                  </button>
                </div>
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                <Input
                  placeholder="Buscar ruta o responsable..."
                  value={assignSearch}
                  onChange={(e) => setAssignSearch(e.target.value)}
                  className="pl-9 h-9 text-sm"
                />
              </div>

              {/* Bulk select for visible (filtered) routes */}
              {assignSearch && filteredRoutes.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setDraftRouteIds((prev) => {
                      const n = new Set(prev);
                      if (allVisibleSelected) visibleIds.forEach((id) => n.delete(id));
                      else visibleIds.forEach((id) => n.add(id));
                      return n;
                    });
                  }}
                  className="text-xs font-medium text-[#A48242] hover:underline"
                >
                  {allVisibleSelected ? "Deseleccionar" : "Seleccionar"} {filteredRoutes.length} {filteredRoutes.length === 1 ? "ruta visible" : "rutas visibles"}
                </button>
              )}

              {/* List */}
              <div className="max-h-72 overflow-y-auto border rounded-lg divide-y">
                {filteredRoutes.length === 0 && (
                  <div className="p-6 text-center text-sm text-muted-foreground">Sin rutas que coincidan</div>
                )}
                {filteredRoutes.map((route) => {
                  const checked = draftRouteIds.has(route.RouteId);
                  return (
                    <label
                      key={route.RouteId}
                      className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${checked ? "bg-[#A48242]/5 hover:bg-[#A48242]/10" : "hover:bg-muted"}`}
                    >
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-[#A48242]"
                        checked={checked}
                        onChange={(e) => {
                          setDraftRouteIds((prev) => {
                            const n = new Set(prev);
                            if (e.target.checked) n.add(route.RouteId);
                            else n.delete(route.RouteId);
                            return n;
                          });
                        }}
                      />
                      <span className="flex-1 text-sm font-medium">{route.Name}</span>
                      {route.AssignedUserName && (
                        <span className="text-xs text-muted-foreground">{route.AssignedUserName}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })()}
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
                {qType === "checkbox_price" && <div className="text-xs text-muted-foreground space-y-1"><div className="flex items-center gap-2"><input type="checkbox" disabled /><span>Marca ejemplo</span><span className="text-[10px] ml-2">Precio: $___</span></div></div>}
                {qType === "coverage" && <div className="text-xs text-muted-foreground space-y-1.5 border border-dashed border-border rounded-lg p-2"><div className="flex items-center gap-2 flex-wrap"><input type="checkbox" disabled /><span>Producto ejemplo</span><span className="text-[10px] bg-muted px-1.5 py-0.5 rounded">$___</span><span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">Quiebre stock</span></div><p className="text-[10px] italic">Cobertura + Precio + Quiebre de stock</p></div>}
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
