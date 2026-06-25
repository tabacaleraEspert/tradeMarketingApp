import { useState, useEffect, useCallback, useRef } from "react";
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
import { Badge } from "../components/ui/badge";
import { ArrowLeft, ArrowRight, Save, Send, Camera, CheckCircle2, CircleDashed, Clock, Image as ImageIcon } from "lucide-react";
import { VisitStepIndicator } from "../components/VisitStepIndicator";
import {
  pdvsApi,
  routesApi,
  formsApi,
  visitsApi,
} from "@/lib/api";
import type { Form, FormQuestion, FormOption } from "@/lib/api";
import { executeOrEnqueue, fetchWithCache, readCache, writeCache } from "@/lib/offline";
import { useVisitStep } from "@/lib/useVisitAutoSave";
import { useVisitFlow } from "@/lib/VisitFlowContext";
import { usePhotoCapture } from "@/lib/usePhotoCapture";
import { Trash2 } from "lucide-react";
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

const OPTION_TYPES = ["select", "radio", "checkbox", "checkbox_price", "coverage"];
const SCALE_DEFAULT = { min: 1, max: 5, minLabel: "", maxLabel: "" };

export function SurveyForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const locState = location.state as { routeDayId?: number; visitId?: number } | null;
  const recovered = useVisitStep(Number(id) || undefined, "survey", locState);
  const routeDayId = locState?.routeDayId ?? recovered.routeDayId;
  const visitIdFromState = locState?.visitId ?? recovered.visitId;

  const flow = useVisitFlow();
  const [pdv, setPdv] = useState<Awaited<ReturnType<typeof pdvsApi.get>> | null>(flow.pdv);
  const [visitId, setVisitId] = useState<number | null>(visitIdFromState ?? flow.visitId ?? null);
  const [forms, setForms] = useState<Form[]>([]);
  const [focoFormIds, setFocoFormIds] = useState<Set<number>>(new Set());
  const [formQuestions, setFormQuestions] = useState<Record<number, QuestionWithOptions[]>>({});
  const [answers, setAnswers] = useState<
    Record<number, string | number | boolean | string[] | Record<string, number | null>>
  >({});
  const [activeTab, setActiveTab] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Silent form-time tracking (no UI). Supervisors see this in analytics.
  const elapsedByFormRef = useRef<Record<number, number>>({}); // seconds accumulated (pending flush)
  const activeStartRef = useRef<number | null>(null); // ts when current form became active
  const activeFormIdRef = useRef<number | null>(null);

  const closeActiveInterval = useCallback(() => {
    if (activeFormIdRef.current != null && activeStartRef.current != null) {
      const deltaSec = Math.floor((Date.now() - activeStartRef.current) / 1000);
      if (deltaSec > 0) {
        const fid = activeFormIdRef.current;
        elapsedByFormRef.current[fid] = (elapsedByFormRef.current[fid] || 0) + deltaSec;
      }
    }
    activeStartRef.current = null;
  }, []);

  const flushFormTimes = useCallback(async (vid: number) => {
    closeActiveInterval();
    const items = Object.entries(elapsedByFormRef.current)
      .map(([fid, sec]) => ({ FormId: Number(fid), ElapsedSeconds: sec }))
      .filter((x) => x.ElapsedSeconds > 0);
    if (items.length === 0) return;
    try {
      await visitsApi.saveFormTimes(vid, items);
      elapsedByFormRef.current = {};
    } catch { /* silent */ }
    // Restart interval for the currently active form
    if (activeFormIdRef.current != null) activeStartRef.current = Date.now();
  }, [closeActiveInterval]);

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const pdvId = Number(id);
      const p = flow.pdv ?? await fetchWithCache(`pdv_${pdvId}`, () => pdvsApi.get(pdvId));
      setPdv(p);

      const effectiveVisitId = visitIdFromState ?? flow.visitId;
      if (!effectiveVisitId) {
        try {
          const openVisits = await visitsApi.list({ pdv_id: pdvId, status: "OPEN" });
          if (openVisits.length > 0) setVisitId(openVisits[0].VisitId);
        } catch { /* offline: visitId should come from state/recovery */ }
      } else {
        setVisitId(effectiveVisitId);
      }

      // Load ALL active forms (from context or cache)
      const allForms = flow.forms.length > 0 ? flow.forms : await fetchWithCache("forms_active", () => formsApi.list({ limit: 200 }));
      const activeForms = allForms.filter((f) => f.IsActive);
      setForms(activeForms);
      if (activeForms.length > 0) setActiveTab((prev) => (prev ? prev : String(activeForms[0].FormId)));

      // Mark which ones are route foco (if visit comes from a route day)
      if (routeDayId) {
        try {
          const routeForms = await routesApi.listDayForms(routeDayId);
          setFocoFormIds(new Set(routeForms.map((rf) => rf.FormId)));
        } catch { /* optional */ }
      }

      // Load questions+options for all forms (cached per form)
      const questionsByForm: Record<number, QuestionWithOptions[]> = {};
      for (const f of activeForms) {
        const withOpts = await fetchWithCache(`form_questions_${f.FormId}`, async () => {
          const qList = await formsApi.listQuestions(f.FormId);
          return Promise.all(
            qList.map(async (q) => {
              const opts = OPTION_TYPES.includes(q.QType)
                ? await formsApi.listOptions(q.QuestionId)
                : [];
              return { ...q, options: opts };
            })
          );
        });
        questionsByForm[f.FormId] = withOpts.sort((a: QuestionWithOptions, b: QuestionWithOptions) => a.SortOrder - b.SortOrder);
      }
      setFormQuestions(questionsByForm);

      // Load existing answers if revisiting
      const vid = visitIdFromState ?? null;
      if (vid) {
        // First check local draft (saved when user navigates away)
        const localDraftKey = `survey_draft_${vid}`;
        const localDraft = readCache<Record<number, unknown>>(localDraftKey);
        if (localDraft && Object.keys(localDraft).length > 0) {
          setAnswers(localDraft as Record<number, string | number | boolean | string[] | Record<string, number | null>>);
        } else {
          try {
            const existingAnswers = await fetchWithCache(`visit_answers_${vid}`, () => visitsApi.listAnswers(vid));
            const restored: Record<number, string | number | boolean | string[] | Record<string, number | null>> = {};
            for (const ans of existingAnswers) {
              if (ans.ValueJson) {
                try { restored[ans.QuestionId] = JSON.parse(ans.ValueJson); } catch { /* skip */ }
              } else if (ans.ValueBool !== null) restored[ans.QuestionId] = ans.ValueBool;
              else if (ans.ValueNumber !== null) restored[ans.QuestionId] = ans.ValueNumber;
              else if (ans.ValueText !== null) restored[ans.QuestionId] = ans.ValueText;
            }
            if (Object.keys(restored).length > 0) setAnswers(restored);
          } catch { /* no saved answers yet — offline is OK, user can fill fresh */ }
        }
      }
    } catch (e) {
      // If forms couldn't load even from cache, show error but don't navigate away
      toast.error("Error al cargar formularios. Verificá tu conexión.");
    } finally {
      setLoading(false);
    }
  }, [id, routeDayId, visitIdFromState, navigate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Track active form timer (silent, no UI)
  useEffect(() => {
    // Close out previous form's interval when active changes
    closeActiveInterval();
    const fid = activeTab ? Number(activeTab) : null;
    activeFormIdRef.current = fid;
    if (fid != null) activeStartRef.current = Date.now();
    return () => {
      closeActiveInterval();
    };
  }, [activeTab, closeActiveInterval]);

  // Pause when tab hidden, resume when visible
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        closeActiveInterval();
      } else if (document.visibilityState === "visible") {
        if (activeFormIdRef.current != null) activeStartRef.current = Date.now();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [closeActiveInterval]);

  // Flush on unmount (navigate away)
  useEffect(() => {
    return () => {
      const vid = visitId ?? visitIdFromState;
      if (!vid) return;
      closeActiveInterval();
      const items = Object.entries(elapsedByFormRef.current)
        .map(([fid, sec]) => ({ FormId: Number(fid), ElapsedSeconds: sec }))
        .filter((x) => x.ElapsedSeconds > 0);
      if (items.length > 0) {
        visitsApi.saveFormTimes(vid, items).catch(() => {});
        elapsedByFormRef.current = {};
      }
    };
  }, [visitId, visitIdFromState, closeActiveInterval]);

  const setAnswer = (
    questionId: number,
    value: string | number | boolean | string[] | Record<string, number | null>
  ) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const isAnswered = (q: QuestionWithOptions): boolean => {
    const v = answers[q.QuestionId];
    if (v === undefined || v === "") return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) return Object.keys(v).length > 0;
    return true;
  };

  const allQuestions = Object.values(formQuestions).flat();
  const completedCount = allQuestions.filter(isAnswered).length;
  const progressPercentage = allQuestions.length > 0 ? Math.round((completedCount / allQuestions.length) * 100) : 0;

  // Status per form: "pending" | "partial" | "complete"
  const getFormStatus = (formId: number): "pending" | "partial" | "complete" => {
    const qs = formQuestions[formId] || [];
    if (qs.length === 0) return "pending";
    const answered = qs.filter(isAnswered).length;
    if (answered === 0) return "pending";
    const required = qs.filter((q) => q.IsRequired);
    const requiredAnswered = required.filter(isAnswered).length;
    if (required.length > 0 && requiredAnswered === required.length && answered === qs.length) return "complete";
    if (required.length === 0 && answered === qs.length) return "complete";
    return "partial";
  };

  const getFormProgress = (formId: number): number => {
    const qs = formQuestions[formId] || [];
    if (qs.length === 0) return 0;
    return Math.round((qs.filter(isAnswered).length / qs.length) * 100);
  };

  const buildAnswerPayload = () => {
    return allQuestions
      .filter((q) => answers[q.QuestionId] !== undefined && answers[q.QuestionId] !== "")
      .map((q) => {
        const val = answers[q.QuestionId];
        const entry: {
          QuestionId: number;
          ValueText?: string | null;
          ValueNumber?: number | null;
          ValueBool?: boolean | null;
          ValueJson?: string | null;
        } = { QuestionId: q.QuestionId };

        if (typeof val === "string") entry.ValueText = val;
        else if (typeof val === "number") entry.ValueNumber = val;
        else if (typeof val === "boolean") entry.ValueBool = val;
        else if (Array.isArray(val) || typeof val === "object") entry.ValueJson = JSON.stringify(val);

        return entry;
      });
  };

  const handleSaveDraft = async () => {
    const vid = visitId ?? visitIdFromState;
    if (!vid) { toast.error("No hay visita activa"); return; }
    writeCache(`survey_draft_${vid}`, answers);
    const isTempVisit = vid < 0;
    try {
      if (isTempVisit || !navigator.onLine) {
        await executeOrEnqueue({
          kind: "visit_answers",
          method: "POST",
          url: `/visits/${vid}/answers`,
          body: { answers: buildAnswerPayload() },
          label: "Respuestas del formulario (borrador)",
          _tempVisitId: isTempVisit ? vid : undefined,
        });
        toast.success("Borrador guardado (se sincronizará con conexión)");
      } else {
        await visitsApi.saveAnswers(vid, buildAnswerPayload());
        await flushFormTimes(vid);
        toast.success("Borrador guardado correctamente");
      }
    } catch { toast.error("Error al guardar borrador"); }
  };

  // Save answers to localStorage on every change (instant local persistence)
  const answersChangedSinceLastSave = useRef(false);
  useEffect(() => {
    answersChangedSinceLastSave.current = Object.keys(answers).length > 0;
    const vid = visitId ?? visitIdFromState;
    if (vid && Object.keys(answers).length > 0) {
      writeCache(`survey_draft_${vid}`, answers);
    }
  }, [answers, visitId, visitIdFromState]);

  useEffect(() => {
    const interval = setInterval(async () => {
      if (!answersChangedSinceLastSave.current) return;
      const vid = visitId ?? visitIdFromState;
      if (!vid) return;
      try {
        const isTempVisit = vid < 0;
        if (isTempVisit || !navigator.onLine) {
          await executeOrEnqueue({
            kind: "visit_answers",
            method: "POST",
            url: `/visits/${vid}/answers`,
            body: { answers: buildAnswerPayload() },
            label: "Respuestas del formulario (borrador auto)",
            _tempVisitId: isTempVisit ? vid : undefined,
          });
        } else {
          await visitsApi.saveAnswers(vid, buildAnswerPayload());
          await flushFormTimes(vid);
        }
        answersChangedSinceLastSave.current = false;
        toast.success("Borrador guardado automáticamente", { duration: 2000 });
      } catch { /* silent autosave failure */ }
    }, 60_000);
    return () => clearInterval(interval);
  }, [visitId, visitIdFromState, flushFormTimes]);

  const handleSubmit = async () => {
    const vid = visitId ?? visitIdFromState;
    if (!vid) { toast.error("No hay visita activa"); return; }
    // Save answers locally so they survive navigation back
    writeCache(`survey_draft_${vid}`, answers);
    const isTempVisit = vid < 0;
    try {
      if (isTempVisit || !navigator.onLine) {
        await executeOrEnqueue({
          kind: "visit_answers",
          method: "POST",
          url: `/visits/${vid}/answers`,
          body: { answers: buildAnswerPayload() },
          label: "Respuestas del formulario",
          _tempVisitId: isTempVisit ? vid : undefined,
        });
        toast.success("Relevamiento guardado (se sincronizará con conexión)");
      } else {
        await visitsApi.saveAnswers(vid, buildAnswerPayload());
        await flushFormTimes(vid);
        toast.success("Relevamiento completado");
      }
      navigate(`/pos/${id}/coverage`, {
        state: { routeDayId, visitId: vid },
      });
    } catch { toast.error("Error al guardar"); }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Cargando...</p>
      </div>
    );
  }

  if (!pdv) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">PDV no encontrado</p>
      </div>
    );
  }

  if (forms.length === 0) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 gap-4">
        <p className="text-muted-foreground">No hay formularios activos disponibles</p>
        <button
          onClick={() => navigate(`/pos/${id}/coverage`, { state: { routeDayId, visitId } })}
          className="px-6 py-3 bg-[#A48242] hover:bg-[#8B6E38] text-white rounded-lg font-medium transition-colors"
        >
          Continuar a Cobertura
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="bg-card border-b border-border p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => navigate(`/pos/${id}`)} className="p-2 hover:bg-muted rounded-lg">
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Formularios</h1>
            <p className="text-sm text-muted-foreground">{pdv.Name}</p>
          </div>
          <VisitStepIndicator currentStep={1} />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Progreso</span>
            <span className="font-semibold text-espert-gold">{progressPercentage}%</span>
          </div>
          <Progress value={progressPercentage} />
        </div>
      </div>

      <div className="p-4">
        {/* Form status overview */}
        <div className="mb-4 grid grid-cols-1 gap-2">
          {forms.map((f) => {
            const status = getFormStatus(f.FormId);
            const progress = getFormProgress(f.FormId);
            const isFoco = focoFormIds.has(f.FormId);
            const isActive = activeTab === String(f.FormId);
            return (
              <button
                key={f.FormId}
                type="button"
                onClick={() => setActiveTab(String(f.FormId))}
                className={`text-left p-3 rounded-lg border transition-colors ${
                  isActive ? "bg-espert-gold/10 border-espert-gold" : "bg-card border-border hover:border-espert-gold/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {status === "complete" && <CheckCircle2 size={18} className="text-green-600 shrink-0" />}
                    {status === "partial" && <Clock size={18} className="text-amber-500 shrink-0" />}
                    {status === "pending" && <CircleDashed size={18} className="text-muted-foreground shrink-0" />}
                    <span className="font-medium text-foreground text-sm truncate">{f.Name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isFoco && <Badge className="bg-orange-500 hover:bg-orange-500 text-[10px] px-1.5 py-0">FOCO</Badge>}
                    <span className={`text-xs font-semibold ${
                      status === "complete" ? "text-green-700" : status === "partial" ? "text-amber-700" : "text-muted-foreground"
                    }`}>{progress}%</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="hidden">
            {forms.map((f) => (
              <TabsTrigger key={f.FormId} value={String(f.FormId)}>{f.Name}</TabsTrigger>
            ))}
          </TabsList>

          {forms.map((f) => (
            <TabsContent key={f.FormId} value={String(f.FormId)} className="space-y-4 mt-0">
              <Card>
                <CardContent className="p-4 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-border">
                    <h3 className="font-semibold text-foreground">{f.Name}</h3>
                    {focoFormIds.has(f.FormId) && <Badge className="bg-orange-500 hover:bg-orange-500">RUTA FOCO</Badge>}
                  </div>
                  {(formQuestions[f.FormId] || []).map((q) => (
                    <SurveyQuestionField
                      key={q.QuestionId}
                      question={q}
                      value={answers[q.QuestionId]}
                      onChange={(v) => setAnswer(q.QuestionId, v)}
                      visitId={visitId}
                    />
                  ))}
                  {(!formQuestions[f.FormId] || formQuestions[f.FormId].length === 0) && (
                    <p className="text-muted-foreground text-sm">Sin preguntas en este formulario</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>

        {/* Spacer for sticky buttons */}
        <div className="h-36" />

        {/* Action buttons - sticky to bottom */}
        <div className="sticky bottom-0 bg-card border-t border-border p-3 pb-[env(safe-area-inset-bottom)] -mx-4 space-y-2">
          <Button className="w-full h-11 text-sm font-semibold bg-[#A48242] hover:bg-[#8B6E38] text-white" onClick={handleSubmit}>
            <ArrowRight className="mr-2" size={16} />
            Continuar a Cobertura
          </Button>
          <Button variant="outline" className="w-full h-9 text-xs border-muted-foreground/30 text-muted-foreground" onClick={handleSaveDraft}>
            <Save className="mr-1.5" size={14} />
            Guardar borrador
          </Button>
        </div>
      </div>
    </div>
  );
}

function SurveyQuestionField({
  question,
  value,
  onChange,
  visitId,
}: {
  question: QuestionWithOptions;
  value: string | number | boolean | string[] | Record<string, number | null> | undefined;
  onChange: (v: string | number | boolean | string[] | Record<string, number | null>) => void;
  visitId?: number | null;
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
    const hasImages = opts.some((o) => o.ImageUrl);
    if (hasImages) {
      /* Visual card grid + foto por opción (e.g. materiales POP) */
      return <ImageCheckboxField question={question} value={value} onChange={onChange} visitId={visitId} />;
    }
    return (
      <div className="space-y-2">
        <Label>
          {question.Label}
          {question.IsRequired && <span className="text-red-500">*</span>}
        </Label>
        {/* Standard checkbox list for items without images */}
        <div className="space-y-1">
          {opts.map((o) => {
            const isChecked = arr.includes(o.Value);
            return (
              <label
                key={o.OptionId}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  isChecked ? "border-[#A48242] bg-[#A48242]/5" : "border-border hover:bg-muted/50"
                }`}
              >
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-[#A48242]"
                  checked={isChecked}
                  onChange={(e) => {
                    const next = e.target.checked ? [...arr, o.Value] : arr.filter((x) => x !== o.Value);
                    onChange(next);
                  }}
                />
                <span className="text-sm font-medium">{o.Label}</span>
              </label>
            );
          })}
        </div>
      </div>
    );
  }

  if (question.QType === "checkbox_price") {
    const obj = (value as Record<string, number | null>) ?? {};
    return (
      <div className="space-y-2">
        <Label>
          {question.Label}
          {question.IsRequired && <span className="text-red-500">*</span>}
        </Label>
        <p className="text-sm text-muted-foreground mb-2">Seleccione las marcas que trabaja e indique el precio si corresponde</p>
        <div className="space-y-2">
          {opts.map((o) => {
            const isChecked = o.Value in obj;
            const price = obj[o.Value] ?? null;
            return (
              <div key={o.OptionId} className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    className="w-4 h-4"
                    checked={isChecked}
                    onChange={(e) => {
                      const next = { ...obj };
                      if (e.target.checked) {
                        next[o.Value] = null;
                      } else {
                        delete next[o.Value];
                      }
                      onChange(next);
                    }}
                  />
                  <span>{o.Label}</span>
                </label>
                {isChecked && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Precio:</span>
                    <Input
                      type="number"
                      placeholder="0"
                      className="w-24 h-8"
                      value={price !== null ? price : ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        const num = val === "" ? null : Number(val);
                        onChange({ ...obj, [o.Value]: num });
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (question.QType === "coverage") {
    // Estructura: { "producto": { covered: true, price: 1500, stockout: false } }
    const obj = (value as Record<string, { covered: boolean; price: number | null; stockout: boolean }>) ?? {};
    return (
      <div className="space-y-2">
        <Label>
          {question.Label}
          {question.IsRequired && <span className="text-red-500">*</span>}
        </Label>
        <p className="text-sm text-muted-foreground mb-2">Marcá los productos que trabaja el PDV, indicá precio y si hay quiebre de stock</p>
        <div className="space-y-3">
          {opts.map((o) => {
            const entry = obj[o.Value] ?? { covered: false, price: null, stockout: false };
            const isCovered = entry.covered;
            return (
              <div key={o.OptionId} className={`rounded-lg border p-3 transition-colors ${isCovered ? "border-green-200 bg-green-50/50" : "border-border bg-background"}`}>
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="flex items-center gap-2 cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded"
                      checked={isCovered}
                      onChange={(e) => {
                        const next = { ...obj };
                        if (e.target.checked) {
                          next[o.Value] = { covered: true, price: null, stockout: false };
                        } else {
                          delete next[o.Value];
                        }
                        onChange(next);
                      }}
                    />
                    <span className="font-medium text-sm">{o.Label}</span>
                  </label>
                  {isCovered && (
                    <>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">$</span>
                        <Input
                          type="number"
                          placeholder="Precio"
                          className="w-24 h-8 text-sm"
                          value={entry.price !== null ? entry.price : ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            const num = val === "" ? null : Number(val);
                            onChange({ ...obj, [o.Value]: { ...entry, price: num } });
                          }}
                        />
                      </div>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded"
                          checked={entry.stockout}
                          onChange={(e) => {
                            onChange({ ...obj, [o.Value]: { ...entry, stockout: e.target.checked } });
                          }}
                        />
                        <span className={`text-xs font-medium ${entry.stockout ? "text-red-600" : "text-muted-foreground"}`}>
                          Quiebre de stock
                        </span>
                      </label>
                    </>
                  )}
                  {!isCovered && (
                    <span className="text-xs text-muted-foreground italic">No lo trabaja</span>
                  )}
                </div>
              </div>
            );
          })}
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
    const num = (value as number) ?? undefined;
    const steps = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    return (
      <div className="space-y-2">
        <Label>
          {question.Label}
          {question.IsRequired && <span className="text-red-500">*</span>}
        </Label>
        <div className="flex gap-2 justify-between">
          {steps.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              className={`flex-1 h-12 rounded-xl font-semibold text-sm transition-all ${
                num === n
                  ? "bg-[#A48242] text-white shadow-md scale-105"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        {scale.minLabel && (
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{scale.minLabel}</span>
            <span>{scale.maxLabel}</span>
          </div>
        )}
      </div>
    );
  }

  if (question.QType === "photo") {
    return <PhotoQuestionField question={question} value={value} onChange={onChange} visitId={visitId} />;
  }

  return null;
}

/**
 * Pregunta tipo "foto": abre cámara/galería, sube a la visita (cola offline-tolerante)
 * y guarda como respuesta la cantidad de fotos tomadas (para el progreso del formulario).
 */
function PhotoQuestionField({
  question,
  value,
  onChange,
  visitId,
}: {
  question: QuestionWithOptions;
  value: string | number | boolean | string[] | Record<string, number | null> | undefined;
  onChange: (v: string | number | boolean | string[] | Record<string, number | null>) => void;
  visitId?: number | null;
}) {
  const tempVisitId = visitId != null && visitId < 0 ? visitId : undefined;
  const { inputRef, inputProps, takePhoto, sourceSheet, photos, removePhoto } = usePhotoCapture({
    uploadUrl: visitId ? `/files/photos/visit/${visitId}` : undefined,
    photoType: `survey_q${question.QuestionId}`,
    label: question.Label || "Foto del formulario",
    tempVisitId,
  });

  // La respuesta = cantidad de fotos (>0 marca la pregunta como respondida).
  useEffect(() => {
    onChange(photos.length > 0 ? photos.length : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.length]);

  const handleTake = () => {
    if (!visitId) {
      toast.error("Hacé el check-in antes de sacar fotos.");
      return;
    }
    takePhoto();
  };

  return (
    <div className="space-y-2">
      <Label>
        {question.Label}
        {question.IsRequired && <span className="text-red-500">*</span>}
      </Label>
      <input ref={inputRef} {...inputProps} />
      {sourceSheet}

      {photos.length === 0 ? (
        <div
          onClick={handleTake}
          className="border-2 border-dashed border-[#A48242]/30 rounded-xl p-8 text-center bg-[#A48242]/5 cursor-pointer hover:bg-[#A48242]/10 transition-colors"
        >
          <Camera size={32} className="mx-auto text-[#A48242]/60 mb-2" />
          <p className="text-sm font-medium text-[#A48242]">Tomar foto</p>
          <p className="text-xs text-muted-foreground mt-1">Tocá para abrir la cámara o elegir de la galería</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo, idx) => (
              <div key={idx} className="relative">
                <img
                  src={photo.url}
                  alt={`Foto ${idx + 1}`}
                  className="w-full h-24 object-cover rounded-lg border border-border"
                />
                {photo.pending && (
                  <span className="absolute bottom-1 left-1 text-[9px] px-1 rounded bg-amber-500 text-white">
                    Pendiente
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removePhoto(idx)}
                  aria-label="Quitar foto"
                  className="absolute -top-1.5 -right-1.5 p-1 bg-black/70 active:bg-black/90 rounded-full"
                >
                  <Trash2 size={12} className="text-white" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={handleTake}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-[#A48242]/40 text-xs text-[#A48242] hover:bg-[#A48242]/5 transition-colors"
          >
            <Camera size={14} />
            Agregar otra foto
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Checkbox con imágenes (grilla visual) + foto opcional por opción marcada.
 * El valor sigue siendo el array de opciones seleccionadas; las fotos se suben a la
 * visita etiquetadas por opción (no van en la respuesta del formulario).
 */
function ImageCheckboxField({
  question,
  value,
  onChange,
  visitId,
}: {
  question: QuestionWithOptions;
  value: string | number | boolean | string[] | Record<string, number | null> | undefined;
  onChange: (v: string | number | boolean | string[] | Record<string, number | null>) => void;
  visitId?: number | null;
}) {
  const opts = question.options || [];
  const arr = (value as string[]) ?? [];
  const tempVisitId = visitId != null && visitId < 0 ? visitId : undefined;
  const activeOptionRef = useRef<string | null>(null);
  const [photoType, setPhotoType] = useState(`survey_q${question.QuestionId}`);
  const [photoCount, setPhotoCount] = useState<Record<string, number>>({});

  const { inputRef, inputProps, takePhoto, sourceSheet } = usePhotoCapture({
    uploadUrl: visitId ? `/files/photos/visit/${visitId}` : undefined,
    photoType,
    label: question.Label || "Foto",
    tempVisitId,
    onUploaded: () => {
      const opt = activeOptionRef.current;
      if (opt) setPhotoCount((prev) => ({ ...prev, [opt]: (prev[opt] || 0) + 1 }));
    },
  });

  const snapFor = (optValue: string) => {
    if (!visitId) {
      toast.error("Hacé el check-in antes de sacar fotos.");
      return;
    }
    activeOptionRef.current = optValue;
    // Etiqueta la foto por opción; setState aplica antes de que el usuario elija el archivo.
    setPhotoType(`survey_q${question.QuestionId}_${optValue}`);
    takePhoto();
  };

  return (
    <div className="space-y-2">
      <Label>
        {question.Label}
        {question.IsRequired && <span className="text-red-500">*</span>}
      </Label>
      <input ref={inputRef} {...inputProps} />
      {sourceSheet}
      <div className="grid grid-cols-2 gap-2">
        {opts.map((o) => {
          const isChecked = arr.includes(o.Value);
          const count = photoCount[o.Value] || 0;
          return (
            <div
              key={o.OptionId}
              onClick={() => {
                const next = isChecked ? arr.filter((v) => v !== o.Value) : [...arr, o.Value];
                onChange(next);
              }}
              className={`relative rounded-xl border-2 p-3 cursor-pointer transition-all ${
                isChecked ? "border-[#A48242] bg-[#A48242]/5" : "border-border hover:border-[#A48242]/40"
              }`}
            >
              <div className={`absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                isChecked ? "bg-[#A48242] text-white" : "border-2 border-border"
              }`}>
                {isChecked && "✓"}
              </div>
              {o.ImageUrl ? (
                <img src={o.ImageUrl} alt={o.Label} className="w-full h-20 object-contain rounded-lg mb-2 bg-muted" />
              ) : (
                <div className="w-full h-20 rounded-lg mb-2 bg-muted/60 flex items-center justify-center">
                  <ImageIcon size={24} className="text-muted-foreground/40" />
                </div>
              )}
              <p className="text-sm font-medium text-center">{o.Label}</p>
              {isChecked && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); snapFor(o.Value); }}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-muted text-xs text-muted-foreground hover:bg-muted/80 transition-colors"
                >
                  <Camera size={12} />
                  {count > 0 ? `${count} ${count === 1 ? "foto" : "fotos"}` : "Tomar foto"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
