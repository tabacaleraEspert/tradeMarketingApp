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
  { type: "date", icon: Calendar, label: "Fecha" },
  { type: "scale", icon: Star, label: "Escala lineal" },
  { type: "photo", icon: Image, label: "Foto" },
] as const;

type QType = (typeof QUESTION_TYPES)[number]["type"];

const OPTION_TYPES: QType[] = ["select", "radio", "checkbox"];
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

  const addOption = async (questionId: number) => {
    const q = questions.find((x) => x.QuestionId === questionId);
    if (!q?.options) return;
    const sortOrder = q.options.length;
    try {
      const opt = await formsApi.createOption(questionId, {
        Value: `op${sortOrder + 1}`,
        Label: `Opción ${sortOrder + 1}`,
        SortOrder,
      });
      setQuestions((prev) =>
        prev.map((x) =>
          x.QuestionId === questionId
            ? { ...x, options: [...(x.options || []), opt] }
            : x
        )
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
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
        <p className="text-slate-600">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <button
              onClick={() => navigate("/admin/forms")}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <ArrowLeft size={24} />
            </button>
            <div className="flex-1">
              <Input
                value={form.Name}
                onChange={(e) => setForm((f) => (f ? { ...f, Name: e.target.value } : null))}
                onBlur={() => form && formsApi.update(id!, { Name: form.Name }).catch(() => {})}
                className="text-xl font-bold border-0 border-b-2 border-transparent hover:border-slate-200 focus:border-blue-500 focus:ring-0"
                placeholder="Sin título"
              />
              <Input
                value={form.Channel || ""}
                onChange={(e) => setForm((f) => (f ? { ...f, Channel: e.target.value || null } : null))}
                onBlur={() => form && formsApi.update(id!, { Channel: form.Channel || undefined }).catch(() => {})}
                className="text-sm text-slate-500 mt-1 border-0 bg-transparent"
                placeholder="Descripción o canal (opcional)"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPreviewMode(!previewMode)}>
                <Eye size={18} className="mr-1" />
                {previewMode ? "Editar" : "Vista previa"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-8">
        {previewMode ? (
          <FormPreview questions={questions} />
        ) : (
          <>
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
                    for (const { optionId, label } of data.options ?? []) {
                      await updateOption(q.QuestionId, optionId, label);
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
                  <div className="absolute left-0 right-0 top-full mt-2 bg-white rounded-lg shadow-xl border border-slate-200 p-4 z-50 grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {QUESTION_TYPES.map(({ type, icon: Icon, label }) => (
                      <button
                        key={type}
                        onClick={() => addQuestion(type)}
                        disabled={saving}
                        className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 text-left transition-colors"
                      >
                        <Icon size={20} className="text-slate-500" />
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
          .filter((o) => draftOptions[o.OptionId] !== undefined && draftOptions[o.OptionId] !== o.Label)
          .map((o) => ({ optionId: o.OptionId, label: draftOptions[o.OptionId] ?? o.Label }))
        : [];

      await onSave({
        Label: draftLabel,
        IsRequired: draftRequired,
        RulesJson: rulesJson,
        options: optionsToSave.length > 0 ? optionsToSave : undefined,
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
      className={`overflow-hidden transition-all ${isEditing ? "ring-2 ring-blue-500" : ""}`}
      onClick={!isEditing ? onEdit : undefined}
    >
      <CardContent className="p-0">
        <div className="flex items-start gap-2 p-4">
          <div className="flex flex-col gap-0 pt-1">
            <GripVertical size={18} className="text-slate-400 cursor-move" />
            {onMoveUp && (
              <button onClick={(e) => { e.stopPropagation(); onMoveUp(); }} className="p-0.5 hover:bg-slate-100 rounded">
                <ChevronUp size={16} className="text-slate-500" />
              </button>
            )}
            {onMoveDown && (
              <button onClick={(e) => { e.stopPropagation(); onMoveDown(); }} className="p-0.5 hover:bg-slate-100 rounded">
                <ChevronDown size={16} className="text-slate-500" />
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
              <p className="font-medium text-slate-900 mb-1">{displayLabel}</p>
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
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDraftRequired(!draftRequired)}
              >
                Obligatoria
              </Button>
              <Switch
                checked={draftRequired}
                onCheckedChange={setDraftRequired}
              />
              <Button variant="default" size="sm" onClick={(e) => { e.stopPropagation(); handleSave(); }} disabled={saving}>
                <Save size={16} className="mr-1" />
                {saving ? "Guardando..." : "Guardar"}
              </Button>
              <Button variant="ghost" size="sm" onClick={onDelete}>
                <Trash2 size={18} className="text-red-600" />
              </Button>
            </div>
          )}
        </div>

        {isEditing && (
          <div className="px-4 pb-4 pt-0 space-y-4 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
            {/* Options */}
            {hasOptions && question.options && (
              <div className="space-y-2">
                <Label className="text-sm">Opciones</Label>
                {question.options.map((opt) => (
                  <div key={opt.OptionId} className="flex items-center gap-2">
                    <Input
                      value={draftOptions[opt.OptionId] ?? opt.Label}
                      onChange={(e) => setDraftOptions((prev) => ({ ...prev, [opt.OptionId]: e.target.value }))}
                      className="flex-1"
                      placeholder="Etiqueta"
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
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
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
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
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
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg"
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
  return (
    <div className="space-y-6">
      {questions.map((q) => {
        const typeInfo = QUESTION_TYPES.find((t) => t.type === q.QType);
        const Icon = typeInfo?.icon ?? Type;
        return (
          <Card key={q.QuestionId}>
            <CardContent className="p-4">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
                <Icon size={16} />
                {q.Label}
                {q.IsRequired && <span className="text-red-500">*</span>}
              </label>
              {q.QType === "text" && <Input placeholder="Tu respuesta" />}
              {q.QType === "textarea" && (
                <textarea
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg min-h-[100px]"
                  placeholder="Tu respuesta"
                />
              )}
              {q.QType === "number" && <Input type="number" placeholder="0" />}
              {q.QType === "email" && <Input type="email" placeholder="email@ejemplo.com" />}
              {q.QType === "phone" && <Input type="tel" placeholder="+54 11 1234-5678" />}
              {q.QType === "select" && (
                <select className="w-full px-3 py-2 border border-slate-300 rounded-lg">
                  <option value="">Seleccionar...</option>
                  {(q.options || []).map((o) => (
                    <option key={o.OptionId} value={o.Value}>{o.Label}</option>
                  ))}
                </select>
              )}
              {q.QType === "radio" && (
                <div className="space-y-2">
                  {(q.options || []).map((o) => (
                    <label key={o.OptionId} className="flex items-center gap-2">
                      <input type="radio" name={`q-${q.QuestionId}`} className="w-4 h-4" />
                      <span>{o.Label}</span>
                    </label>
                  ))}
                </div>
              )}
              {q.QType === "checkbox" && (
                <div className="space-y-2">
                  {(q.options || []).map((o) => (
                    <label key={o.OptionId} className="flex items-center gap-2">
                      <input type="checkbox" className="w-4 h-4" />
                      <span>{o.Label}</span>
                    </label>
                  ))}
                </div>
              )}
              {q.QType === "date" && <Input type="date" />}
              {q.QType === "scale" && (() => {
                const rules = parseRulesJson(q.RulesJson) as { scale?: typeof SCALE_DEFAULT } | null;
                const scale = rules?.scale || SCALE_DEFAULT;
                const min = scale.min ?? 1;
                const max = scale.max ?? 5;
                return (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-500">{min}</span>
                    <input type="range" min={min} max={max} defaultValue={min} className="flex-1" />
                    <span className="text-sm text-slate-500">{max}</span>
                  </div>
                );
              })()}
              {q.QType === "photo" && (
                <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center text-slate-500">
                  Área para capturar foto
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
      {questions.length === 0 && (
        <p className="text-center text-slate-500 py-12">Sin preguntas aún</p>
      )}
    </div>
  );
}
