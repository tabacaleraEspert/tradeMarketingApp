import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { Badge } from "../../components/ui/badge";
import {
  ArrowLeft,
  Plus,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Trash2,
  Copy,
  Eye,
  Save,
  Type,
  Hash,
  List,
  CheckSquare,
  ToggleLeft,
  Calendar,
  Mail,
  Phone,
  Image,
  AlignLeft,
  Star,
  ChevronRight,
  X,
  DollarSign,
  Package,
} from "lucide-react";
import {
  formsApi,
  FormQuestion,
  FormOption,
} from "@/lib/api";
import { toast } from "sonner";

const QUESTION_TYPES = [
  { type: "text", icon: Type, label: "Texto corto" },
  { type: "textarea", icon: AlignLeft, label: "Párrafo" },
  { type: "number", icon: Hash, label: "Número" },
  { type: "email", icon: Mail, label: "Email" },
  { type: "phone", icon: Phone, label: "Teléfono" },
  { type: "select", icon: List, label: "Lista desplegable" },
  { type: "radio", icon: ToggleLeft, label: "Opción única" },
  { type: "checkbox", icon: CheckSquare, label: "Casillas" },
  { type: "checkbox_price", icon: DollarSign, label: "Casillas con precio" },
  { type: "coverage", icon: Package, label: "Cobertura completa" },
  { type: "date", icon: Calendar, label: "Fecha" },
  { type: "scale", icon: Star, label: "Escala lineal" },
  { type: "photo", icon: Image, label: "Foto" },
] as const;

type QType = (typeof QUESTION_TYPES)[number]["type"];

const OPTION_TYPES: QType[] = ["select", "radio", "checkbox", "checkbox_price", "coverage"];
const SCALE_DEFAULT = { min: 1, max: 5, minLabel: "", maxLabel: "" };

interface QuestionWithOptions extends FormQuestion {
  options?: FormOption[];
}

interface ConditionalRule {
  questionId: number;
  operator: "equals" | "contains" | "notEmpty" | "empty" | "notEquals";
  value?: string;
}

function parseRulesJson(json: string | null): { showIf?: ConditionalRule } | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as { showIf?: ConditionalRule };
  } catch {
    return null;
  }
}

export function FormEditorPage() {
  const { formId } = useParams();
  const navigate = useNavigate();
  const id = formId ? Number(formId) : null;

  const [form, setForm] = useState<Awaited<ReturnType<typeof formsApi.get>> | null>(null);
  const [formDraft, setFormDraft] = useState<{ Name: string; Channel: string | null } | null>(null);
  const [questions, setQuestions] = useState<QuestionWithOptions[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null);
  const [previewMode, setPreviewMode] = useState(false);

  const loadForm = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [f, qList] = await Promise.all([
        formsApi.get(id),
        formsApi.listQuestions(id),
      ]);
      setForm(f);
      setFormDraft({ Name: f.Name, Channel: f.Channel });
      const withOpts = await Promise.all(
        qList.map(async (q) => {
          const opts = OPTION_TYPES.includes(q.QType as QType)
            ? await formsApi.listOptions(q.QuestionId)
            : [];
          return { ...q, options: opts };
        })
      );
      setQuestions(withOpts.sort((a, b) => a.SortOrder - b.SortOrder));
    } catch (e) {
      toast.error("Error al cargar formulario");
      navigate("/admin/forms");
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    loadForm();
  }, [loadForm]);

  const addQuestion = async (qType: QType) => {
    if (!id || !form) return;
    setShowAddMenu(false);
    setSaving(true);
    try {
      const key = `q_${Date.now()}`;
      const q = await formsApi.createQuestion(id, {
        SortOrder: questions.length,
        KeyName: key,
        Label: "Nueva pregunta",
        QType: qType,
        IsRequired: false,
      });
      let opts: FormOption[] = [];
      if (OPTION_TYPES.includes(qType)) {
        opts = [
          await formsApi.createOption(q.QuestionId, { Value: "op1", Label: "Opción 1", SortOrder: 0 }),
          await formsApi.createOption(q.QuestionId, { Value: "op2", Label: "Opción 2", SortOrder: 1 }),
        ];
      }
      setQuestions((prev) => [...prev, { ...q, options: opts }].sort((a, b) => a.SortOrder - b.SortOrder));
      setEditingQuestionId(q.QuestionId);
      toast.success("Pregunta agregada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  const updateQuestion = async (questionId: number, data: Partial<FormQuestion>) => {
    try {
      await formsApi.updateQuestion(questionId, data);
      setQuestions((prev) =>
        prev.map((q) => (q.QuestionId === questionId ? { ...q, ...data } : q))
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const deleteQuestion = async (questionId: number) => {
    if (!confirm("¿Eliminar esta pregunta?")) return;
    try {
      await formsApi.deleteQuestion(questionId);
      setQuestions((prev) => prev.filter((q) => q.QuestionId !== questionId));
      toast.success("Pregunta eliminada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const moveQuestion = async (index: number, direction: "up" | "down") => {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= questions.length) return;
    const reordered = [...questions];
    [reordered[index], reordered[newIndex]] = [reordered[newIndex], reordered[index]];
    setSaving(true);
    try {
      await Promise.all(
        reordered.map((q, i) => formsApi.updateQuestion(q.QuestionId, { SortOrder: i }))
      );
      setQuestions(reordered.map((q, i) => ({ ...q, SortOrder: i })));
    } catch (e) {
      toast.error("Error al reordenar");
    } finally {
      setSaving(false);
    }
  };

  const addOption = (questionId: number) => {
    const q = questions.find((x) => x.QuestionId === questionId);
    if (!q?.options) return;
    const sortOrder = q.options.length;
    const newOpt = {
      OptionId: -(Date.now()), // temporal, se crea en backend al guardar
      QuestionId: questionId,
      Value: `op${sortOrder + 1}`,
      Label: `Opción ${sortOrder + 1}`,
      SortOrder: sortOrder,
    };
    setQuestions((prev) =>
      prev.map((x) =>
        x.QuestionId === questionId
          ? { ...x, options: [...(x.options || []), newOpt] }
          : x
      )
    );
  };

  const updateOption = async (questionId: number, optionId: number, label: string) => {
    try {
      await formsApi.updateOption(optionId, { Label: label });
      setQuestions((prev) =>
        prev.map((x) =>
          x.QuestionId === questionId
            ? {
                ...x,
                options: (x.options || []).map((o) =>
                  o.OptionId === optionId ? { ...o, Label: label } : o
                ),
              }
            : x
        )
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const deleteOption = async (questionId: number, optionId: number) => {
    if (optionId < 0) {
      setQuestions((prev) =>
        prev.map((x) =>
          x.QuestionId === questionId
            ? { ...x, options: (x.options || []).filter((o) => o.OptionId !== optionId) }
            : x
        )
      );
      return;
    }
    try {
      await formsApi.deleteOption(optionId);
      setQuestions((prev) =>
        prev.map((x) =>
          x.QuestionId === questionId
            ? { ...x, options: (x.options || []).filter((o) => o.OptionId !== optionId) }
            : x
        )
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const saveFormMetadata = async () => {
    if (!id || !formDraft) return;
    setSaving(true);
    try {
      await formsApi.update(id, {
        Name: formDraft.Name,
        Channel: formDraft.Channel || undefined,
      });
      setForm((f) => (f ? { ...f, Name: formDraft!.Name, Channel: formDraft!.Channel } : null));
      toast.success("Formulario guardado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const formMetadataDirty =
    formDraft && form && (formDraft.Name !== form.Name || (formDraft.Channel ?? "") !== (form.Channel ?? ""));

  const setConditionalRule = async (questionId: number, rule: ConditionalRule | null) => {
    const q = questions.find((x) => x.QuestionId === questionId);
    const existing = parseRulesJson(q?.RulesJson ?? null) || {};
    const rules = { ...existing };
    if (rule) {
      rules.showIf = rule;
    } else {
      delete rules.showIf;
    }
    const json = Object.keys(rules).length > 0 ? JSON.stringify(rules) : null;
    await updateQuestion(questionId, { RulesJson: json });
  };

  if (loading || !form) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <button
              onClick={() => navigate("/admin/forms")}
              className="p-2 hover:bg-muted rounded-lg transition-colors"
            >
              <ArrowLeft size={24} />
            </button>
            <div className="flex-1 min-w-0">
              <Input
                value={formDraft?.Name ?? ""}
                onChange={(e) => setFormDraft((d) => (d ? { ...d, Name: e.target.value } : null))}
                className="text-xl font-bold border-0 border-b-2 border-transparent hover:border-border focus:border-espert-gold focus:ring-0"
                placeholder="Nombre del formulario"
              />
              <Input
                value={formDraft?.Channel ?? ""}
                onChange={(e) => setFormDraft((d) => (d ? { ...d, Channel: e.target.value || null } : null))}
                className="text-sm text-muted-foreground mt-1 border-0 bg-transparent"
                placeholder="Canal o descripción (opcional)"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant={formMetadataDirty ? "default" : "outline"}
                size="sm"
                onClick={saveFormMetadata}
                disabled={saving || !formDraft?.Name?.trim()}
              >
                <Save size={18} className="mr-1" />
                {saving ? "Guardando..." : "Guardar"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPreviewMode(!previewMode)}>
                <Eye size={18} className="mr-1" />
                {previewMode ? "Editar" : "Vista previa"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky save bar when form has unsaved changes */}
      {formMetadataDirty && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <p className="text-sm text-amber-800">
              Tienes cambios sin guardar en el nombre o canal del formulario.
            </p>
            <Button size="sm" onClick={saveFormMetadata} disabled={saving}>
              <Save size={16} className="mr-1" />
              {saving ? "Guardando..." : "Guardar ahora"}
            </Button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-8">
        {previewMode ? (
          <FormPreview questions={questions} />
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-6">
              Haz clic en una pregunta para editarla. Los cambios se guardan al hacer clic en <strong>Guardar</strong> en cada tarjeta.
            </p>
            {/* Questions */}
            <div className="space-y-4">
              {questions.map((q, index) => (
                <QuestionCard
                  key={q.QuestionId}
                  question={q}
                  allQuestions={questions}
                  isEditing={editingQuestionId === q.QuestionId}
                  onEdit={() => setEditingQuestionId((prev) => (prev === q.QuestionId ? null : q.QuestionId))}
                  onSave={async (data) => {
                    if (data.Label !== undefined) await updateQuestion(q.QuestionId, { Label: data.Label });
                    if (data.IsRequired !== undefined) await updateQuestion(q.QuestionId, { IsRequired: data.IsRequired });
                    if (data.RulesJson !== undefined) await updateQuestion(q.QuestionId, { RulesJson: data.RulesJson });
                    const toCreate = data.newOptions ?? [];
                    const toUpdate = data.options ?? [];
                    const created = await Promise.all(
                      toCreate.map((o) =>
                        formsApi.createOption(q.QuestionId, {
                          Value: o.value,
                          Label: o.label,
                          SortOrder: o.sortOrder,
                        })
                      )
                    );
                    await Promise.all(
                      toUpdate.map(({ optionId, label }) => updateOption(q.QuestionId, optionId, label))
                    );
                    if (created.length > 0) {
                      setQuestions((prev) =>
                        prev.map((x) =>
                          x.QuestionId === q.QuestionId
                            ? {
                                ...x,
                                options: [
                                  ...(x.options || []).filter((o) => o.OptionId > 0),
                                  ...created,
                                ].sort((a, b) => a.SortOrder - b.SortOrder),
                              }
                            : x
                        )
                      );
                    }
                  }}
                  onDelete={() => deleteQuestion(q.QuestionId)}
                  onMoveUp={index > 0 ? () => moveQuestion(index, "up") : undefined}
                  onMoveDown={index < questions.length - 1 ? () => moveQuestion(index, "down") : undefined}
                  onAddOption={() => addOption(q.QuestionId)}
                  onDeleteOption={(optId) => deleteOption(q.QuestionId, optId)}
                  onSetConditional={(rule) => setConditionalRule(q.QuestionId, rule)}
                />
              ))}
            </div>

            {/* Add Question */}
            <div className="relative mt-8">
              <Button
                variant="outline"
                className="w-full h-14 border-2 border-dashed"
                onClick={() => setShowAddMenu(!showAddMenu)}
              >
                <Plus size={24} className="mr-2" />
                Agregar pregunta
              </Button>

              {showAddMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowAddMenu(false)}
                  />
                  <div className="absolute left-0 right-0 top-full mt-2 bg-card rounded-lg shadow-xl border border-border p-4 z-50 grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {QUESTION_TYPES.map(({ type, icon: Icon, label }) => (
                      <button
                        key={type}
                        onClick={() => addQuestion(type)}
                        disabled={saving}
                        className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted text-left transition-colors"
                      >
                        <Icon size={20} className="text-muted-foreground" />
                        <span className="text-sm font-medium">{label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function QuestionCard({
  question,
  allQuestions,
  isEditing,
  onEdit,
  onSave,
  onDelete,
  onMoveUp,
  onMoveDown,
  onAddOption,
  onDeleteOption,
  onSetConditional,
}: {
  question: QuestionWithOptions;
  allQuestions: QuestionWithOptions[];
  isEditing: boolean;
  onEdit: () => void;
  onSave: (data: {
    Label?: string;
    IsRequired?: boolean;
    RulesJson?: string | null;
    options?: { optionId: number; label: string }[];
    newOptions?: { value: string; label: string; sortOrder: number }[];
  }) => Promise<void>;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onAddOption: () => void;
  onDeleteOption: (optionId: number) => void;
  onSetConditional: (rule: ConditionalRule | null) => void;
}) {
  const typeInfo = QUESTION_TYPES.find((t) => t.type === question.QType);
  const Icon = typeInfo?.icon ?? Type;
  const hasOptions = OPTION_TYPES.includes(question.QType as QType);
  const rules = parseRulesJson(question.RulesJson);
  const showIf = rules?.showIf;

  const [draftLabel, setDraftLabel] = useState(question.Label);
  const [draftRequired, setDraftRequired] = useState(question.IsRequired);
  const [draftOptions, setDraftOptions] = useState<Record<number, string>>({});
  const [draftShowIf, setDraftShowIf] = useState<ConditionalRule | null | undefined>(showIf ?? undefined);
  const [draftScale, setDraftScale] = useState(() => {
    const r = parseRulesJson(question.RulesJson) as { scale?: typeof SCALE_DEFAULT } | null;
    return r?.scale || { ...SCALE_DEFAULT };
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isEditing) {
      setDraftLabel(question.Label);
      setDraftRequired(question.IsRequired);
      setDraftShowIf(showIf ?? undefined);
      const r = parseRulesJson(question.RulesJson) as { scale?: typeof SCALE_DEFAULT } | null;
      setDraftScale(r?.scale || { ...SCALE_DEFAULT });
      setDraftOptions((prev) => {
        const opts: Record<number, string> = {};
        (question.options || []).forEach((o) => {
          opts[o.OptionId] = prev[o.OptionId] ?? o.Label;
        });
        return opts;
      });
    }
  }, [isEditing, question.QuestionId, question.Label, question.IsRequired, question.RulesJson, question.options, showIf]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const rulesToSave = { ...rules };
      if (draftShowIf) {
        rulesToSave.showIf = draftShowIf;
      } else {
        delete rulesToSave.showIf;
      }
      if (question.QType === "scale") {
        rulesToSave.scale = draftScale;
      }
      const rulesJson = Object.keys(rulesToSave).length > 0 ? JSON.stringify(rulesToSave) : null;

      const optionsToSave = hasOptions && question.options
        ? question.options
          .filter((o) => o.OptionId > 0 && draftOptions[o.OptionId] !== undefined && draftOptions[o.OptionId] !== o.Label)
          .map((o) => ({ optionId: o.OptionId, label: draftOptions[o.OptionId] ?? o.Label }))
        : [];

      const newOptionsToSave = hasOptions && question.options
        ? question.options
          .filter((o) => o.OptionId < 0)
          .map((o, i) => ({
            value: o.Value,
            label: draftOptions[o.OptionId] ?? o.Label,
            sortOrder: o.SortOrder,
          }))
        : [];

      await onSave({
        Label: draftLabel,
        IsRequired: draftRequired,
        RulesJson: rulesJson,
        options: optionsToSave.length > 0 ? optionsToSave : undefined,
        newOptions: newOptionsToSave.length > 0 ? newOptionsToSave : undefined,
      });
      toast.success("Pregunta guardada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const displayLabel = isEditing ? draftLabel : question.Label;
  const displayRequired = isEditing ? draftRequired : question.IsRequired;

  return (
    <Card
      className={`overflow-hidden transition-all ${isEditing ? "ring-2 ring-espert-gold" : ""}`}
      onClick={!isEditing ? onEdit : undefined}
    >
      <CardContent className="p-0">
        <div className="flex items-start gap-2 p-4">
          <div className="flex flex-col gap-0 pt-1">
            <GripVertical size={18} className="text-muted-foreground cursor-move" />
            {onMoveUp && (
              <button onClick={(e) => { e.stopPropagation(); onMoveUp(); }} className="p-0.5 hover:bg-muted rounded">
                <ChevronUp size={16} className="text-muted-foreground" />
              </button>
            )}
            {onMoveDown && (
              <button onClick={(e) => { e.stopPropagation(); onMoveDown(); }} className="p-0.5 hover:bg-muted rounded">
                <ChevronDown size={16} className="text-muted-foreground" />
              </button>
            )}
          </div>
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <Input
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                className="text-base font-medium mb-2"
                placeholder="Pregunta"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <p className="font-medium text-foreground mb-1">{displayLabel}</p>
            )}
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                <Icon size={12} className="mr-1" />
                {typeInfo?.label || question.QType}
              </Badge>
              {displayRequired && (
                <span className="text-red-500 text-sm">*</span>
              )}
            </div>
          </div>
          {isEditing && (
            <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Obligatoria</span>
                <Switch
                  checked={draftRequired}
                  onCheckedChange={setDraftRequired}
                />
              </div>
              <Button variant="default" size="sm" onClick={(e) => { e.stopPropagation(); handleSave(); }} disabled={saving}>
                <Save size={16} className="mr-1" />
                {saving ? "Guardando..." : "Guardar"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onEdit()}>
                Cancelar
              </Button>
              <Button variant="ghost" size="sm" onClick={onDelete} className="text-red-600 hover:text-red-700">
                <Trash2 size={18} />
              </Button>
            </div>
          )}
        </div>

        {isEditing && (
          <div className="px-4 pb-4 pt-0 space-y-4 border-t border-border" onClick={(e) => e.stopPropagation()}>
            {/* Options */}
            {hasOptions && question.options && (
              <div className="space-y-2">
                <Label className="text-sm">Opciones</Label>
                {question.options.map((opt) => (
                  <div key={opt.OptionId} className="flex items-center gap-2 p-2 rounded-lg border border-border bg-muted/30">
                    {opt.ImageUrl && (
                      <img src={opt.ImageUrl} alt="" className="w-8 h-8 object-contain rounded bg-card shrink-0" />
                    )}
                    <Input
                      value={draftOptions[opt.OptionId] ?? opt.Label}
                      onChange={(e) => setDraftOptions((prev) => ({ ...prev, [opt.OptionId]: e.target.value }))}
                      className="flex-1"
                      placeholder="Etiqueta"
                    />
                    <Input
                      value={opt.ImageUrl ?? ""}
                      onChange={(e) => {
                        // Update image URL via API immediately
                        if (opt.OptionId > 0) {
                          formsApi.updateOption(opt.OptionId, { ImageUrl: e.target.value || undefined });
                        }
                      }}
                      className="w-40 text-xs"
                      placeholder="URL imagen (opcional)"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDeleteOption(opt.OptionId)}
                    >
                      <X size={16} className="text-red-500" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={onAddOption}>
                  <Plus size={14} className="mr-1" />
                  Agregar opción
                </Button>
              </div>
            )}

            {/* Scale config */}
            {question.QType === "scale" && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm">Mínimo</Label>
                  <Input
                    type="number"
                    value={draftScale.min}
                    onChange={(e) => setDraftScale((prev) => ({ ...prev, min: Number(e.target.value) || 1 }))}
                  />
                </div>
                <div>
                  <Label className="text-sm">Máximo</Label>
                  <Input
                    type="number"
                    value={draftScale.max}
                    onChange={(e) => setDraftScale((prev) => ({ ...prev, max: Number(e.target.value) || 5 }))}
                  />
                </div>
              </div>
            )}

            {/* Conditional logic */}
            <div className="space-y-2">
              <Label className="text-sm">Mostrar esta pregunta si...</Label>
              <select
                className="w-full px-3 py-2 border border-border rounded-lg"
                value={draftShowIf?.questionId ?? ""}
                onChange={(e) => {
                  const qId = Number(e.target.value);
                  if (!qId) {
                    setDraftShowIf(null);
                    return;
                  }
                  const targetQ = allQuestions.find((x) => x.QuestionId === qId);
                  if (!targetQ) return;
                  const hasOpts = OPTION_TYPES.includes(targetQ.QType as QType);
                  setDraftShowIf({
                    questionId: qId,
                    operator: hasOpts ? "equals" : "notEmpty",
                    value: hasOpts ? (targetQ.options?.[0]?.Value ?? "") : undefined,
                  });
                }}
              >
                <option value="">Ninguna (siempre visible)</option>
                {allQuestions
                  .filter((x) => x.QuestionId !== question.QuestionId)
                  .map((x) => (
                    <option key={x.QuestionId} value={x.QuestionId}>
                      {x.Label}
                    </option>
                  ))}
              </select>
              {draftShowIf && (
                <>
                  <select
                    className="w-full px-3 py-2 border border-border rounded-lg"
                    value={draftShowIf.operator}
                    onChange={(e) =>
                      setDraftShowIf((prev) => prev ? { ...prev, operator: e.target.value as ConditionalRule["operator"] } : null)
                    }
                  >
                    <option value="equals">es igual a</option>
                    <option value="notEquals">no es igual a</option>
                    <option value="contains">contiene</option>
                    <option value="notEmpty">no está vacío</option>
                    <option value="empty">está vacío</option>
                  </select>
                  {["equals", "notEquals", "contains"].includes(draftShowIf.operator) && (() => {
                    const targetQ = allQuestions.find((x) => x.QuestionId === draftShowIf!.questionId);
                    const hasOptions = targetQ && OPTION_TYPES.includes(targetQ.QType as QType);
                    if (hasOptions && targetQ?.options?.length) {
                      return (
                        <select
                          className="w-full px-3 py-2 border border-border rounded-lg"
                          value={draftShowIf.value ?? ""}
                          onChange={(e) => setDraftShowIf((prev) => prev ? { ...prev, value: e.target.value } : null)}
                        >
                          {targetQ.options.map((o) => (
                            <option key={o.OptionId} value={o.Value}>
                              {o.Label}
                            </option>
                          ))}
                        </select>
                      );
                    }
                    return (
                      <Input
                        placeholder="Texto a buscar..."
                        value={draftShowIf.value ?? ""}
                        onChange={(e) => setDraftShowIf((prev) => prev ? { ...prev, value: e.target.value } : null)}
                        className="w-full"
                      />
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FormPreview({ questions }: { questions: QuestionWithOptions[] }) {
  const [previewAnswers, setPreviewAnswers] = useState<Record<number, any>>({});
  const [previewPhotos, setPreviewPhotos] = useState<Record<string, string>>({});

  const setAnswer = (qId: number, val: any) => setPreviewAnswers((p) => ({ ...p, [qId]: val }));

  return (
    <div className="space-y-6">
      {questions.map((q) => {
        const typeInfo = QUESTION_TYPES.find((t) => t.type === q.QType);
        const Icon = typeInfo?.icon ?? Type;
        return (
          <Card key={q.QuestionId} className="overflow-hidden">
            <CardContent className="p-5">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-espert-gold/10 flex items-center justify-center shrink-0">
                  <Icon size={16} className="text-espert-gold" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">
                    {q.Label}
                    {q.IsRequired && <span className="text-red-500 ml-1">*</span>}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{typeInfo?.label}</p>
                </div>
              </div>

              {q.QType === "text" && <Input placeholder="Tu respuesta" className="bg-muted/50" />}
              {q.QType === "textarea" && (
                <textarea
                  className="w-full px-3 py-2 border border-border rounded-lg min-h-[100px] bg-muted/50 focus:outline-none focus:ring-2 focus:ring-espert-gold"
                  placeholder="Tu respuesta"
                />
              )}
              {q.QType === "number" && <Input type="number" placeholder="0" className="bg-muted/50" />}
              {q.QType === "email" && <Input type="email" placeholder="email@ejemplo.com" className="bg-muted/50" />}
              {q.QType === "phone" && <Input type="tel" placeholder="+54 11 1234-5678" className="bg-muted/50" />}
              {q.QType === "select" && (
                <select className="w-full px-3 py-2 border border-border rounded-lg bg-muted/50 focus:outline-none focus:ring-2 focus:ring-espert-gold">
                  <option value="">Seleccionar...</option>
                  {(q.options || []).map((o) => (
                    <option key={o.OptionId} value={o.Value}>{o.Label}</option>
                  ))}
                </select>
              )}
              {q.QType === "radio" && (
                <div className="space-y-2">
                  {(q.options || []).map((o) => (
                    <label key={o.OptionId} className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 cursor-pointer transition-colors">
                      <input type="radio" name={`q-${q.QuestionId}`} className="w-4 h-4 accent-[#A48242]" />
                      <span className="text-sm font-medium">{o.Label}</span>
                    </label>
                  ))}
                </div>
              )}

              {/* Checkbox as visual cards */}
              {q.QType === "checkbox" && (() => {
                const checked = (previewAnswers[q.QuestionId] as string[]) ?? [];
                return (
                  <div className="grid grid-cols-2 gap-2">
                    {(q.options || []).map((o) => {
                      const isChecked = checked.includes(o.Value);
                      const photoKey = `${q.QuestionId}_${o.OptionId}`;
                      return (
                        <div
                          key={o.OptionId}
                          onClick={() => {
                            const next = isChecked ? checked.filter((v) => v !== o.Value) : [...checked, o.Value];
                            setAnswer(q.QuestionId, next);
                          }}
                          className={`relative rounded-xl border-2 p-3 cursor-pointer transition-all ${
                            isChecked ? "border-espert-gold bg-espert-gold/5" : "border-border hover:border-espert-gold/40"
                          }`}
                        >
                          {/* Checkmark */}
                          <div className={`absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                            isChecked ? "bg-espert-gold text-white" : "border-2 border-border"
                          }`}>
                            {isChecked && "✓"}
                          </div>
                          {/* Image */}
                          {o.ImageUrl ? (
                            <img src={o.ImageUrl} alt={o.Label} className="w-full h-20 object-contain rounded-lg mb-2 bg-muted" />
                          ) : (
                            <div className="w-full h-20 rounded-lg mb-2 bg-muted/60 flex items-center justify-center">
                              <Image size={24} className="text-muted-foreground/40" />
                            </div>
                          )}
                          <p className="text-sm font-medium text-center">{o.Label}</p>
                          {/* Photo capture button */}
                          {isChecked && (
                            <button
                              onClick={(e) => { e.stopPropagation(); }}
                              className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-muted text-xs text-muted-foreground hover:bg-muted/80 transition-colors"
                            >
                              <Image size={12} />
                              {previewPhotos[photoKey] ? "Foto tomada" : "Tomar foto"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Checkbox with price as cards */}
              {q.QType === "checkbox_price" && (() => {
                const obj = (previewAnswers[q.QuestionId] as Record<string, number | null>) ?? {};
                return (
                  <div className="space-y-2">
                    {(q.options || []).map((o) => {
                      const isChecked = o.Value in obj;
                      return (
                        <div
                          key={o.OptionId}
                          className={`rounded-xl border-2 p-3 transition-all ${
                            isChecked ? "border-espert-gold bg-espert-gold/5" : "border-border"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-3 cursor-pointer flex-1">
                              <input
                                type="checkbox"
                                className="w-5 h-5 accent-[#A48242] rounded"
                                checked={isChecked}
                                onChange={(e) => {
                                  const next = { ...obj };
                                  if (e.target.checked) next[o.Value] = null;
                                  else delete next[o.Value];
                                  setAnswer(q.QuestionId, next);
                                }}
                              />
                              {o.ImageUrl && (
                                <img src={o.ImageUrl} alt={o.Label} className="w-10 h-10 object-contain rounded bg-muted" />
                              )}
                              <span className="font-medium text-sm">{o.Label}</span>
                            </label>
                            {isChecked && (
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-xs text-muted-foreground">$</span>
                                <Input type="number" placeholder="Precio" className="w-24 h-8 text-sm bg-muted/50" />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {q.QType === "date" && <Input type="date" className="bg-muted/50" />}

              {q.QType === "scale" && (() => {
                const rules = parseRulesJson(q.RulesJson) as { scale?: typeof SCALE_DEFAULT } | null;
                const scale = rules?.scale || SCALE_DEFAULT;
                const min = scale.min ?? 1;
                const max = scale.max ?? 5;
                const val = (previewAnswers[q.QuestionId] as number) ?? min;
                const steps = Array.from({ length: max - min + 1 }, (_, i) => min + i);
                return (
                  <div className="space-y-3">
                    <div className="flex gap-2 justify-between">
                      {steps.map((n) => (
                        <button
                          key={n}
                          onClick={() => setAnswer(q.QuestionId, n)}
                          className={`flex-1 h-12 rounded-xl font-semibold text-sm transition-all ${
                            val === n
                              ? "bg-espert-gold text-white shadow-md scale-105"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    {(scale as any).minLabel && (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{(scale as any).minLabel}</span>
                        <span>{(scale as any).maxLabel}</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {q.QType === "photo" && (
                <div className="border-2 border-dashed border-espert-gold/30 rounded-xl p-8 text-center bg-espert-gold/5 cursor-pointer hover:bg-espert-gold/10 transition-colors">
                  <Image size={32} className="mx-auto text-espert-gold/60 mb-2" />
                  <p className="text-sm font-medium text-espert-gold">Tomar foto</p>
                  <p className="text-xs text-muted-foreground mt-1">Toca para abrir la cámara</p>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
      {questions.length === 0 && (
        <p className="text-center text-muted-foreground py-12">Sin preguntas aún</p>
      )}
    </div>
  );
}
