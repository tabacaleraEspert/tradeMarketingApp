import { useState } from "react";
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
  Copy,
  Eye,
  CheckSquare,
  Type,
  List,
  Image,
  Hash,
  Calendar,
  ToggleLeft,
  ChevronDown,
  ChevronUp,
  Route,
} from "lucide-react";
import { useApiList, formsApi, routesApi } from "@/lib/api";
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

export function FormBuilder() {
  const navigate = useNavigate();
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

  const { data: routes } = useApiList(() => routesApi.list());
  const { data: forms, loading, refetch } = useApiList(async () => {
    const f = await formsApi.list();
    const withCount = await Promise.all(
      f.map(async (form) => {
        const q = await formsApi.listQuestions(form.FormId);
        return { ...form, questionsCount: q.length };
      })
    );
    return withCount;
  });

  const fieldTypes = [
    { type: "text", icon: Type, label: "Texto" },
    { type: "number", icon: Hash, label: "Número" },
    { type: "select", icon: List, label: "Selección" },
    { type: "checkbox", icon: CheckSquare, label: "Checkbox" },
    { type: "radio", icon: ToggleLeft, label: "Radio" },
    { type: "date", icon: Calendar, label: "Fecha" },
    { type: "textarea", icon: Type, label: "Texto Largo" },
    { type: "photo", icon: Image, label: "Foto" },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Constructor de Formularios</h1>
          <p className="text-slate-600">Crear y gestionar formularios de relevamiento por canal</p>
        </div>
        <Button
          onClick={() => {
            setIsCreateModalOpen(true);
            setSelectedForm(null);
            setFormName("");
            setFormChannel("");
            setFormVersion(1);
          }}
          className="gap-2"
        >
          <Plus size={20} />
          Nuevo Formulario
        </Button>
      </div>

      {/* Summary Cards */}
      {loading && <p className="text-slate-600">Cargando formularios...</p>}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-slate-600 mb-1">Formularios Activos</p>
            <p className="text-3xl font-bold text-green-600">
              {forms.filter((f) => f.IsActive).length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-slate-600 mb-1">Inactivos</p>
            <p className="text-3xl font-bold text-yellow-600">
              {forms.filter((f) => !f.IsActive).length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-slate-600 mb-1">Total</p>
            <p className="text-3xl font-bold text-slate-600">{forms.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Forms List */}
      <div className="grid grid-cols-1 gap-4">
        {forms.map((form) => (
          <Card key={form.FormId} className="hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-bold text-slate-900">{form.Name}</h3>
                    <Badge variant={form.IsActive ? "default" : "secondary"}>
                      {form.IsActive ? "Activo" : "Inactivo"}
                    </Badge>
                    <Badge variant="outline">v{form.Version}</Badge>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-slate-600">
                    <span>Canal: <span className="font-semibold">{form.Channel || "-"}</span></span>
                    <span>•</span>
                    <span>{form.questionsCount ?? 0} preguntas</span>
                    <span>•</span>
                    <span>Creado: {new Date(form.CreatedAt).toLocaleDateString("es-AR")}</span>
                  </div>
                  <div className="mt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-slate-600 -ml-2"
                      onClick={async () => {
                        setAssignRoutesFormId(form.FormId);
                        const res = await formsApi.getRoutesWithForm(form.FormId);
                        setRouteIdsWithForm(new Set(res.route_ids));
                      }}
                    >
                      <Route size={14} className="mr-1" />
                      Asignar a rutas
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      setSelectedForm(form);
                      setIsPreviewOpen(true);
                      const q = await formsApi.listQuestions(form.FormId);
                      setPreviewQuestions(q);
                    }}
                  >
                    <Eye size={16} />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/admin/forms/${form.FormId}/edit`)}
                  >
                    <Edit size={16} />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      if (confirm("¿Eliminar este formulario?")) {
                        try {
                          await formsApi.delete(form.FormId);
                          toast.success("Formulario eliminado");
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
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Form Builder Modal */}
      <Modal
        isOpen={isCreateModalOpen || (selectedForm !== null && !isPreviewOpen)}
        onClose={() => {
          setIsCreateModalOpen(false);
          setSelectedForm(null);
        }}
        title={selectedForm ? "Editar Formulario" : "Nuevo Formulario"}
        size="xl"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateModalOpen(false);
                setSelectedForm(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              disabled={saving || !formName.trim()}
              onClick={async () => {
                setSaving(true);
                try {
                  if (selectedForm) {
                    await formsApi.update(selectedForm.FormId, {
                      Name: formName,
                      Channel: formChannel || undefined,
                      Version: formVersion,
                    });
                    toast.success("Formulario actualizado");
                    setIsCreateModalOpen(false);
                    setSelectedForm(null);
                    refetch();
                  } else {
                    const newForm = await formsApi.create({
                      Name: formName,
                      Channel: formChannel || undefined,
                      Version: formVersion,
                    });
                    toast.success("Formulario creado");
                    setIsCreateModalOpen(false);
                    setSelectedForm(null);
                    refetch();
                    navigate(`/admin/forms/${newForm.FormId}/edit`);
                  }
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Error");
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Nombre del Formulario
            </label>
            <Input
              placeholder="Ej: Relevamiento Kioscos"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Canal</label>
            <select
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formChannel}
              onChange={(e) => setFormChannel(e.target.value)}
            >
              <option value="">Seleccionar canal</option>
              <option value="Kiosco">Kiosco</option>
              <option value="Autoservicio">Autoservicio</option>
              <option value="Mayorista">Mayorista</option>
              <option value="Supermercado">Supermercado</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Versión</label>
            <Input
              type="number"
              min={1}
              value={formVersion}
              onChange={(e) => setFormVersion(Number(e.target.value) || 1)}
            />
          </div>
        </div>
      </Modal>

      {/* Modal Asignar a Rutas */}
      <Modal
        isOpen={assignRoutesFormId !== null}
        onClose={() => setAssignRoutesFormId(null)}
        title={`Asignar formulario a rutas${assignRoutesFormId ? `: ${forms.find((f) => f.FormId === assignRoutesFormId)?.Name}` : ""}`}
        size="lg"
        footer={
          assignRoutesFormId && (
            <div className="flex items-center justify-between w-full">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={assignLoading || routes.length === 0}
                  onClick={async () => {
                    setAssignLoading(true);
                    try {
                      await formsApi.bulkAssignToRoutes(assignRoutesFormId, {
                        assign_to_all: true,
                      });
                      const res = await formsApi.getRoutesWithForm(assignRoutesFormId);
                      setRouteIdsWithForm(new Set(res.route_ids));
                      toast.success("Asignado a todas las rutas");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Error");
                    } finally {
                      setAssignLoading(false);
                    }
                  }}
                >
                  Asignar a todos
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={assignLoading || routeIdsWithForm.size === 0}
                  onClick={async () => {
                    if (!confirm("¿Quitar este formulario de todas las rutas?")) return;
                    setAssignLoading(true);
                    try {
                      for (const rid of routeIdsWithForm) {
                        await formsApi.removeFromRoute(assignRoutesFormId, rid);
                      }
                      setRouteIdsWithForm(new Set());
                      toast.success("Quitado de todas las rutas");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Error");
                    } finally {
                      setAssignLoading(false);
                    }
                  }}
                >
                  Quitar de todos
                </Button>
              </div>
              <Button variant="outline" onClick={() => setAssignRoutesFormId(null)}>
                Cerrar
              </Button>
            </div>
          )
        }
      >
        {assignRoutesFormId && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={
                    routes.length > 0 &&
                    routes.every((r) => routeIdsWithForm.has(r.RouteId))
                  }
                  onChange={async (e) => {
                    setAssignLoading(true);
                    try {
                      if (e.target.checked) {
                        await formsApi.bulkAssignToRoutes(assignRoutesFormId, {
                          assign_to_all: true,
                        });
                        const res = await formsApi.getRoutesWithForm(assignRoutesFormId);
                        setRouteIdsWithForm(new Set(res.route_ids));
                        toast.success("Asignado a todas las rutas");
                      } else {
                        const ids = [...routeIdsWithForm];
                        for (const rid of ids) {
                          await formsApi.removeFromRoute(assignRoutesFormId, rid);
                        }
                        setRouteIdsWithForm(new Set());
                        toast.success("Quitado de todas las rutas");
                      }
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Error");
                    } finally {
                      setAssignLoading(false);
                    }
                  }}
                  disabled={assignLoading}
                />
                <span className="text-sm font-medium">Seleccionar todos</span>
              </label>
            </div>
            <div className="max-h-64 overflow-y-auto border rounded-lg divide-y">
              {routes.length === 0 ? (
                <p className="p-4 text-slate-500 text-sm">No hay rutas</p>
              ) : (
                routes.map((route) => (
                  <label
                    key={route.RouteId}
                    className="flex items-center gap-3 p-3 hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={routeIdsWithForm.has(route.RouteId)}
                      onChange={async (e) => {
                        const checked = e.target.checked;
                        setAssignLoading(true);
                        try {
                          if (checked) {
                            await routesApi.addForm(route.RouteId, {
                              FormId: assignRoutesFormId,
                              SortOrder: 0,
                            });
                            setRouteIdsWithForm((prev) =>
                              new Set([...prev, route.RouteId])
                            );
                          } else {
                            await formsApi.removeFromRoute(
                              assignRoutesFormId,
                              route.RouteId
                            );
                            setRouteIdsWithForm((prev) => {
                              const next = new Set(prev);
                              next.delete(route.RouteId);
                              return next;
                            });
                          }
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Error");
                        } finally {
                          setAssignLoading(false);
                        }
                      }}
                      disabled={assignLoading}
                    />
                    <span
                      className="flex-1 text-sm font-medium hover:text-blue-600"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        navigate(`/admin/routes/${route.RouteId}/edit`);
                        setAssignRoutesFormId(null);
                      }}
                    >
                      {route.Name}
                    </span>
                    {route.BejermanZone && (
                      <Badge variant="outline" className="text-xs">
                        {route.BejermanZone}
                      </Badge>
                    )}
                  </label>
                ))
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Preview Modal */}
      <Modal
        isOpen={isPreviewOpen}
        onClose={() => {
          setIsPreviewOpen(false);
          setSelectedForm(null);
        }}
        title={`Vista Previa: ${selectedForm?.Name}`}
        size="lg"
      >
        <div className="space-y-4">
          {previewQuestions.map((q) => {
            const qType = q.QType?.toLowerCase() || "text";
            const FieldIcon = fieldTypes.find((ft) => ft.type === qType)?.icon || Type;
            return (
              <div key={q.QuestionId} className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <FieldIcon size={16} />
                  {q.Label}
                  {q.IsRequired && <span className="text-red-500">*</span>}
                </label>
                {qType === "text" && <Input placeholder="Ingresar texto..." />}
                {qType === "number" && <Input type="number" placeholder="0" />}
                {(qType === "select" || qType === "radio") && (
                  <select className="w-full px-3 py-2 border border-slate-300 rounded-lg">
                    <option value="">Seleccionar...</option>
                  </select>
                )}
                {qType === "textarea" && (
                  <textarea
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    rows={3}
                    placeholder="Ingresar..."
                  />
                )}
                {qType === "checkbox" && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" className="w-4 h-4" />
                    <span className="text-sm text-slate-600">Marcar si aplica</span>
                  </label>
                )}
              </div>
            );
          })}
          {previewQuestions.length === 0 && (
            <p className="text-slate-500 text-center py-4">Sin preguntas</p>
          )}
        </div>
      </Modal>
    </div>
  );
}
