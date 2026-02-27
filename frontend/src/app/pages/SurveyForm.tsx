import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams, useLocation } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Progress } from "../components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { ArrowLeft, Save, Send, Camera, WifiOff, FileText } from "lucide-react";
import {
  pdvsApi,
  routesApi,
  formsApi,
  visitsApi,
} from "@/lib/api";
import type { FormQuestion, FormOption, RouteFormWithForm } from "@/lib/api";
import { toast } from "sonner";

interface QuestionWithOptions extends FormQuestion {
  options?: FormOption[];
}

function parseRulesJson(json: string | null): { showIf?: { questionId: number; operator: string; value?: string }; scale?: { min: number; max: number; minLabel?: string; maxLabel?: string } } | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

const OPTION_TYPES = ["select", "radio", "checkbox"];
const SCALE_DEFAULT = { min: 1, max: 5, minLabel: "", maxLabel: "" };

export function SurveyForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const routeDayId = (location.state as { routeDayId?: number; visitId?: number } | null)?.routeDayId;
  const visitIdFromState = (location.state as { visitId?: number } | null)?.visitId;

  const [pdv, setPdv] = useState<Awaited<ReturnType<typeof pdvsApi.get>> | null>(null);
  const [visitId, setVisitId] = useState<number | null>(visitIdFromState ?? null);
  const [routeForms, setRouteForms] = useState<RouteFormWithForm[]>([]);
  const [formQuestions, setFormQuestions] = useState<Record<number, QuestionWithOptions[]>>({});
  const [answers, setAnswers] = useState<Record<number, string | number | boolean | string[]>>({});
  const [activeTab, setActiveTab] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const pdvId = Number(id);
      const p = await pdvsApi.get(pdvId);
      setPdv(p);

      if (!visitIdFromState) {
        const openVisits = await visitsApi.list({ pdv_id: pdvId, status: "OPEN" });
        if (openVisits.length > 0) setVisitId(openVisits[0].VisitId);
      } else {
        setVisitId(visitIdFromState);
      }

      if (routeDayId) {
        const forms = await routesApi.listDayForms(routeDayId);
        setRouteForms(forms);
        if (forms.length > 0) setActiveTab((prev) => (prev ? prev : String(forms[0].FormId)));

        const questionsByForm: Record<number, QuestionWithOptions[]> = {};
        for (const rf of forms) {
          const qList = await formsApi.listQuestions(rf.FormId);
          const withOpts = await Promise.all(
            qList.map(async (q) => {
              const opts = OPTION_TYPES.includes(q.QType)
                ? await formsApi.listOptions(q.QuestionId)
                : [];
              return { ...q, options: opts };
            })
          );
          questionsByForm[rf.FormId] = withOpts.sort((a, b) => a.SortOrder - b.SortOrder);
        }
        setFormQuestions(questionsByForm);
      }
    } catch (e) {
      toast.error("Error al cargar");
      navigate(`/pos/${id}`);
    } finally {
      setLoading(false);
    }
  }, [id, routeDayId, visitIdFromState, navigate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const setAnswer = (questionId: number, value: string | number | boolean | string[]) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const allQuestions = Object.values(formQuestions).flat();
  const completedCount = allQuestions.filter((q) => {
    const v = answers[q.QuestionId];
    if (v === undefined || v === "") return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  }).length;
  const progressPercentage = allQuestions.length > 0 ? Math.round((completedCount / allQuestions.length) * 100) : 0;

  const handleSaveDraft = () => {
    toast.success("Borrador guardado correctamente");
  };

  const handleSubmit = () => {
    toast.success("Relevamiento completado");
    navigate(`/pos/${id}/photos`, {
      state: { routeDayId, visitId: visitId ?? visitIdFromState },
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-600">Cargando...</p>
      </div>
    );
  }

  if (!pdv) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-600">PDV no encontrado</p>
      </div>
    );
  }

  if (!routeDayId || routeForms.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 pb-20">
        <div className="bg-white border-b border-slate-200 p-4 sticky top-0 z-10">
          <div className="flex items-center gap-3 mb-3">
            <button onClick={() => navigate(`/pos/${id}`)} className="p-2 hover:bg-slate-100 rounded-lg">
              <ArrowLeft size={24} />
            </button>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-slate-900">Relevamiento</h1>
              <p className="text-sm text-slate-600">{pdv.Name}</p>
            </div>
          </div>
        </div>
        <div className="p-4">
          <Card className="border-dashed border-2">
            <CardContent className="p-8 text-center">
              <FileText size={48} className="mx-auto text-slate-300 mb-4" />
              <p className="font-medium text-slate-700 mb-2">Sin formularios asignados</p>
              <p className="text-sm text-slate-500">
                Inicia la visita desde la Ruta Foco del Día para ver los formularios de relevamiento.
              </p>
              <Button variant="outline" className="mt-4" onClick={() => navigate("/route")}>
                Ir a Ruta Foco
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <div className="bg-white border-b border-slate-200 p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => navigate(`/pos/${id}`)} className="p-2 hover:bg-slate-100 rounded-lg">
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-900">Relevamiento</h1>
            <p className="text-sm text-slate-600">{pdv.Name}</p>
          </div>
          <button className="text-slate-600">
            <WifiOff size={20} />
          </button>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">Progreso</span>
            <span className="font-semibold text-blue-600">{progressPercentage}%</span>
          </div>
          <Progress value={progressPercentage} />
        </div>
      </div>

      <div className="p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="w-full h-auto flex-wrap justify-start gap-2 bg-transparent p-0">
            {routeForms.map((rf) => (
              <TabsTrigger
                key={rf.FormId}
                value={String(rf.FormId)}
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
              >
                {rf.Form.Name}
              </TabsTrigger>
            ))}
          </TabsList>

          {routeForms.map((rf) => (
            <TabsContent key={rf.FormId} value={String(rf.FormId)} className="space-y-4 mt-4">
              <Card>
                <CardContent className="p-4 space-y-4">
                  {(formQuestions[rf.FormId] || []).map((q) => (
                    <SurveyQuestionField
                      key={q.QuestionId}
                      question={q}
                      value={answers[q.QuestionId]}
                      onChange={(v) => setAnswer(q.QuestionId, v)}
                    />
                  ))}
                  {(!formQuestions[rf.FormId] || formQuestions[rf.FormId].length === 0) && (
                    <p className="text-slate-500 text-sm">Sin preguntas en este formulario</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>

        <div className="fixed bottom-20 left-0 right-0 bg-white border-t border-slate-200 p-4 space-y-2">
          <Button className="w-full h-12 text-base font-semibold" onClick={handleSubmit}>
            <Send className="mr-2" size={18} />
            Finalizar y Continuar
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={handleSaveDraft}>
              <Save className="mr-2" size={16} />
              Guardar Borrador
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() =>
                navigate(`/pos/${id}/photos`, {
                  state: { routeDayId, visitId: visitId ?? visitIdFromState },
                })
              }
            >
              <Camera className="mr-2" size={16} />
              Agregar Fotos
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SurveyQuestionField({
  question,
  value,
  onChange,
}: {
  question: QuestionWithOptions;
  value: string | number | boolean | string[] | undefined;
  onChange: (v: string | number | boolean | string[]) => void;
}) {
  const opts = question.options || [];

  if (question.QType === "text") {
    return (
      <div className="space-y-2">
        <Label>
          {question.Label}
          {question.IsRequired && <span className="text-red-500">*</span>}
        </Label>
        <Input
          placeholder="Tu respuesta"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  if (question.QType === "textarea") {
    return (
      <div className="space-y-2">
        <Label>
          {question.Label}
          {question.IsRequired && <span className="text-red-500">*</span>}
        </Label>
        <Textarea
          placeholder="Tu respuesta"
          className="min-h-[100px]"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  if (question.QType === "number") {
    return (
      <div className="space-y-2">
        <Label>
          {question.Label}
          {question.IsRequired && <span className="text-red-500">*</span>}
        </Label>
        <Input
          type="number"
          placeholder="0"
          value={(value as number) ?? ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : "")}
        />
      </div>
    );
  }

  if (question.QType === "email") {
    return (
      <div className="space-y-2">
        <Label>
          {question.Label}
          {question.IsRequired && <span className="text-red-500">*</span>}
        </Label>
        <Input
          type="email"
          placeholder="email@ejemplo.com"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  if (question.QType === "phone") {
    return (
      <div className="space-y-2">
        <Label>
          {question.Label}
          {question.IsRequired && <span className="text-red-500">*</span>}
        </Label>
        <Input
          type="tel"
          placeholder="+54 11 1234-5678"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  if (question.QType === "select") {
    return (
      <div className="space-y-2">
        <Label>
          {question.Label}
          {question.IsRequired && <span className="text-red-500">*</span>}
        </Label>
        <Select value={(value as string) ?? ""} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder="Seleccionar..." />
          </SelectTrigger>
          <SelectContent>
            {opts.map((o) => (
              <SelectItem key={o.OptionId} value={o.Value}>
                {o.Label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (question.QType === "radio") {
    return (
      <div className="space-y-2">
        <Label>
          {question.Label}
          {question.IsRequired && <span className="text-red-500">*</span>}
        </Label>
        <RadioGroup value={(value as string) ?? ""} onValueChange={onChange}>
          <div className="space-y-2">
            {opts.map((o) => (
              <div key={o.OptionId} className="flex items-center space-x-2">
                <RadioGroupItem value={o.Value} id={`${question.QuestionId}-${o.OptionId}`} />
                <Label htmlFor={`${question.QuestionId}-${o.OptionId}`} className="font-normal cursor-pointer">
                  {o.Label}
                </Label>
              </div>
            ))}
          </div>
        </RadioGroup>
      </div>
    );
  }

  if (question.QType === "checkbox") {
    const arr = (value as string[]) ?? [];
    return (
      <div className="space-y-2">
        <Label>
          {question.Label}
          {question.IsRequired && <span className="text-red-500">*</span>}
        </Label>
        <div className="space-y-2">
          {opts.map((o) => (
            <label key={o.OptionId} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4"
                checked={arr.includes(o.Value)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...arr, o.Value]
                    : arr.filter((x) => x !== o.Value);
                  onChange(next);
                }}
              />
              <span>{o.Label}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  if (question.QType === "date") {
    return (
      <div className="space-y-2">
        <Label>
          {question.Label}
          {question.IsRequired && <span className="text-red-500">*</span>}
        </Label>
        <Input
          type="date"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  if (question.QType === "scale") {
    const rules = parseRulesJson(question.RulesJson);
    const scale = rules?.scale || SCALE_DEFAULT;
    const min = scale.min ?? 1;
    const max = scale.max ?? 5;
    const num = (value as number) ?? min;
    return (
      <div className="space-y-2">
        <Label>
          {question.Label}
          {question.IsRequired && <span className="text-red-500">*</span>}
        </Label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">{min}</span>
          <input
            type="range"
            min={min}
            max={max}
            value={num}
            onChange={(e) => onChange(Number(e.target.value))}
            className="flex-1"
          />
          <span className="text-sm text-slate-500">{max}</span>
        </div>
        <p className="text-sm text-slate-600">{num}</p>
      </div>
    );
  }

  if (question.QType === "photo") {
    return (
      <div className="space-y-2">
        <Label>
          {question.Label}
          {question.IsRequired && <span className="text-red-500">*</span>}
        </Label>
        <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center text-slate-500">
          Área para capturar foto
        </div>
      </div>
    );
  }

  return null;
}
