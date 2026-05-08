import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams, useLocation } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import { Modal } from "../components/ui/modal";
import {
  ArrowLeft, CheckCircle2, AlertTriangle, XCircle, ClipboardCheck,
  Camera, Zap, Newspaper, LogOut, ChevronRight, Clock, MapPin,
  Navigation, FileText, Megaphone, Package,
} from "lucide-react";
import { pdvsApi, visitsApi, visitActionsApi, marketNewsApi, formsApi, pdvNotesApi, visitPhotosApi, fetchRouteDayPdvsForDate, visitCoverageApi, visitPOPApi, productsApi } from "@/lib/api";
import { fetchWithCache } from "@/lib/offline";
import type { VisitCoverageItem, VisitPOPItem, Product } from "@/lib/api/types";
import { VisitIndicatorsBar } from "../components/VisitIndicatorsBar";
import type { VisitPhotoRead } from "@/lib/api";
import { executeOrEnqueue } from "@/lib/offline";
import { useVisitStep, clearVisitContext } from "@/lib/useVisitAutoSave";
import { getCurrentUser } from "../lib/auth";
import { formatTime24 } from "../lib/dateUtils";
import type { Pdv, VisitAction, MarketNews, VisitAnswer } from "@/lib/api";
import { toast } from "sonner";
import { renderAnswerValue } from "../lib/answerFormatter";

interface StepData {
  label: string;
  icon: React.ElementType;
  status: "completed" | "partial" | "pending";
  detail: string;
  type: "relevamiento" | "cobertura" | "pop" | "acciones" | "fotos" | "novedades";
}

const STEP_ROUTES: Record<StepData["type"], string> = {
  relevamiento: "survey",
  cobertura: "coverage",
  pop: "pop",
  acciones: "actions",
  fotos: "photos",
  novedades: "market-news",
};

interface FormQuestion {
  QuestionId: number;
  Label: string;
  QType: string;
}

export function VisitSummaryPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const locState = location.state as { routeDayId?: number; visitId?: number } | null;
  const recovered = useVisitStep(Number(id) || undefined, "summary", locState);
  const routeDayId = locState?.routeDayId ?? recovered.routeDayId;
  const visitIdFromState = locState?.visitId ?? recovered.visitId;

  const [pdv, setPdv] = useState<Pdv | null>(null);
  const [visitId, setVisitId] = useState<number | null>(visitIdFromState ?? null);
  const [steps, setSteps] = useState<StepData[]>([]);
  const [reminderForNext, setReminderForNext] = useState("");
  const [closing, setClosing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Detail modal
  const [detailModal, setDetailModal] = useState<string | null>(null);
  const [answers, setAnswers] = useState<VisitAnswer[]>([]);
  const [questions, setQuestions] = useState<FormQuestion[]>([]);
  const [actions, setActions] = useState<VisitAction[]>([]);
  const [news, setNews] = useState<MarketNews[]>([]);
  const [checks, setChecks] = useState<any[]>([]);
  const [visitPhotos, setVisitPhotos] = useState<VisitPhotoRead[]>([]);
  const [visitData, setVisitData] = useState<any>(null);
  const [coverageItems, setCoverageItems] = useState<VisitCoverageItem[]>([]);
  const [popItems, setPopItems] = useState<VisitPOPItem[]>([]);
  const [productMap, setProductMap] = useState<Record<number, Product>>({});

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const p = await fetchWithCache(`pdv_${id}`, () => pdvsApi.get(Number(id)));
      setPdv(p);

      let vid = visitIdFromState;
      if (!vid) {
        try {
          const openVisits = await visitsApi.list({ pdv_id: Number(id), status: "OPEN" });
          if (openVisits.length > 0) vid = openVisits[0].VisitId;
        } catch { /* offline: rely on state/recovery */ }
      }
      if (!vid) { toast.error("No hay visita activa"); navigate(`/pos/${id}`); return; }
      setVisitId(vid);

      const [ans, acts, nws, validation, chks, visit, photos, cov, pop] = await Promise.all([
        visitsApi.listAnswers(vid).catch(() => []),
        visitActionsApi.list(vid).catch(() => []),
        marketNewsApi.list(vid).catch(() => []),
        visitsApi.validateClose(vid).catch(() => ({ missing: [], warnings: [] })),
        visitsApi.listChecks(vid).catch(() => []),
        visitsApi.get(vid).catch(() => null),
        visitPhotosApi.list(vid).catch(() => [] as VisitPhotoRead[]),
        visitCoverageApi.list(vid).catch(() => [] as VisitCoverageItem[]),
        visitPOPApi.list(vid).catch(() => [] as VisitPOPItem[]),
      ]);

      setAnswers(ans);
      setActions(acts);
      setNews(nws);
      setChecks(chks);
      setVisitData(visit);
      setVisitPhotos(photos);
      setCoverageItems(cov);
      setPopItems(pop);

      // Load product names for coverage
      if (cov.length > 0) {
        fetchWithCache("products_all", () => productsApi.list({ active_only: false })).then((prods) => {
          const map: Record<number, Product> = {};
          for (const p of prods) map[p.ProductId] = p;
          setProductMap(map);
        }).catch(() => {});
      }

      // Load questions for answers (cached)
      if (ans.length > 0) {
        const forms = await fetchWithCache("forms_active", () => formsApi.list()).catch(() => []);
        const allQ: FormQuestion[] = [];
        for (const f of forms) {
          const qs = await fetchWithCache(`form_questions_${f.FormId}`, () => formsApi.listQuestions(f.FormId)).catch(() => []);
          allQ.push(...qs);
        }
        setQuestions(allQ);
      }

      const statusSteps: StepData[] = [];

      // Relevamiento (Formularios)
      if (ans.length > 0) {
        const missing = validation.missing.filter((m) => m.questionId);
        statusSteps.push({
          label: "Formularios", icon: ClipboardCheck, type: "relevamiento",
          status: missing.length === 0 ? "completed" : "partial",
          detail: missing.length === 0 ? `${ans.length} completados` : `${missing.length} pendientes`,
        });
      } else {
        statusSteps.push({ label: "Formularios", icon: ClipboardCheck, type: "relevamiento", status: "pending", detail: "Sin completar" });
      }

      // Cobertura
      const covWorking = cov.filter((c: VisitCoverageItem) => c.Works).length;
      const covBreaks = cov.filter((c: VisitCoverageItem) => c.Works && c.Availability === "quiebre").length;
      statusSteps.push({
        label: "Cobertura y Precios", icon: ClipboardCheck, type: "cobertura" as any,
        status: cov.length > 0 ? "completed" : "pending",
        detail: cov.length > 0
          ? `${covWorking} trabajan${covBreaks > 0 ? ` · ${covBreaks} quiebres` : ""}`
          : "Sin completar",
      });

      // POP
      const popPresent = pop.filter((p: VisitPOPItem) => p.Present).length;
      statusSteps.push({
        label: "Censo POP", icon: Megaphone as any, type: "pop" as any,
        status: pop.length > 0 ? "completed" : "pending",
        detail: pop.length > 0 ? `${popPresent} presentes` : "Sin completar",
      });

      // Acciones
      if (acts.length > 0) {
        const noPhoto = acts.filter((a: VisitAction) => a.PhotoRequired && !a.PhotoTaken);
        statusSteps.push({
          label: "Acciones de Ejecución", icon: Zap, type: "acciones",
          status: noPhoto.length === 0 ? "completed" : "partial",
          detail: noPhoto.length === 0 ? `${acts.length} ejecutadas` : `${noPhoto.length} sin foto`,
        });
      } else {
        statusSteps.push({ label: "Acciones de Ejecución", icon: Zap, type: "acciones", status: "pending", detail: "Sin acciones" });
      }

      // Fotos
      const photosReq = acts.filter((a: VisitAction) => a.PhotoRequired).length;
      const photosDone = acts.filter((a: VisitAction) => a.PhotoTaken).length;
      statusSteps.push({
        label: "Evidencia Fotográfica", icon: Camera, type: "fotos",
        status: photosReq === 0 || photosDone === photosReq ? "completed" : photosDone > 0 ? "partial" : "pending",
        detail: photosReq === 0 ? "Sin fotos requeridas" : `${photosDone}/${photosReq} fotos`,
      });

      // Novedades
      statusSteps.push({
        label: "Novedades de Mercado", icon: Newspaper, type: "novedades",
        status: nws.length > 0 ? "completed" : "pending",
        detail: nws.length > 0 ? `${nws.length} novedades` : "Sin novedades (opcional)",
      });

      setSteps(statusSteps);
      if (!validation.valid) setValidationErrors(validation.missing.map((m) => m.label));
    } catch { toast.error("Error al cargar resumen"); }
    finally { setLoading(false); }
  }, [id, visitIdFromState, navigate]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleClose = async () => {
    if (!visitId) return;
    setClosing(true);
    try {
      // 1. GPS check-out (offline-tolerant, best-effort)
      try {
        const gps = await new Promise<any>((resolve) => {
          if (!navigator.geolocation) { resolve({}); return; }
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ Lat: pos.coords.latitude, Lon: pos.coords.longitude, AccuracyMeters: pos.coords.accuracy }),
            () => resolve({}), { enableHighAccuracy: true, timeout: 5000 }
          );
        });
        const isTempVisit = visitId < 0;
        await executeOrEnqueue({
          kind: "visit_check",
          method: "POST",
          url: `/visits/${visitId}/checks`,
          body: { CheckType: "OUT", ...gps },
          label: "Check-out GPS",
          _tempVisitId: isTempVisit ? visitId : undefined,
        });
      } catch {}

      // 2. Cierre de visita (offline-tolerant, crítico)
      const isTempVisit = visitId < 0;
      const closeResult = await executeOrEnqueue({
        kind: "visit_update",
        method: "PATCH",
        url: `/visits/${visitId}`,
        body: { Status: "CLOSED", CloseReason: reminderForNext || undefined },
        label: "Cierre de visita",
        _tempVisitId: isTempVisit ? visitId : undefined,
      });

      // Clear visit draft/context from localStorage
      clearVisitContext();

      // 3. Si dejó una nota para la próxima visita, crear PdvNote (offline-tolerant)
      if (reminderForNext.trim() && id) {
        const currentUser = getCurrentUser();
        try {
          await executeOrEnqueue({
            kind: "pdv_note_create",
            method: "POST",
            url: `/pdvs/${id}/notes`,
            body: {
              Content: reminderForNext.trim(),
              CreatedByUserId: Number(currentUser.id) || undefined,
              VisitId: visitId,
            },
            label: "Nota para próxima visita",
          });
        } catch {
          // No es bloqueante
        }
      }

      // Buscar el próximo PDV pendiente en la ruta del día
      try {
        const currentUser = getCurrentUser();
        const userId = Number(currentUser.id) || undefined;
        const today = new Date();
        const dayPdvs = await fetchRouteDayPdvsForDate(today, userId);
        const currentPdvId = Number(id);
        const pending = dayPdvs
          .filter((p) => p.pdv.PdvId !== currentPdvId)
          .filter((p) => {
            const status = (p.ExecutionStatus || "PENDING").toUpperCase();
            return status !== "DONE" && status !== "COMPLETED";
          });
        if (pending.length > 0) {
          const nextPdv = pending[0];
          // Mostrar modal de éxito con el nombre del próximo PDV
          if (closeResult.queued) {
            toast.success("Visita guardada. Se sincronizará cuando vuelva la conexión.");
          } else {
            toast("Visita cerrada. Siguiente: " + nextPdv.pdv.Name, {
              icon: "🎯",
              duration: 4000,
              action: {
                label: "Ir →",
                onClick: () => navigate(`/pos/${nextPdv.pdv.PdvId}`, {
                  state: { routeDayId: nextPdv.RouteDayId, completedPdvId: currentPdvId, fromNextButton: true },
                }),
              },
            });
          }
          // Navegar después de un delay para que se vea el toast
          setTimeout(() => {
            navigate(`/pos/${nextPdv.pdv.PdvId}`, {
              state: { routeDayId: nextPdv.RouteDayId, completedPdvId: currentPdvId, fromNextButton: true },
            });
          }, 1500);
          return;
        }
        // Sin más PDVs pendientes
        toast.success("¡Ruta del día completada!");
        navigate("/end-of-day", { state: { completedPdvId: currentPdvId } });
        return;
      } catch {
        if (closeResult.queued) {
          toast.success("Visita guardada. Se sincronizará cuando vuelva la conexión.");
        } else {
          toast.success("Visita cerrada");
        }
        navigate("/", { state: { completedPdvId: Number(id) } });
      }
    } catch { toast.error("Error al cerrar visita"); }
    finally { setClosing(false); }
  };

  // renderAnswerValue extraído a app/lib/answerFormatter.ts

  const statusIcon = (s: string) => {
    if (s === "completed") return <CheckCircle2 size={18} className="text-green-600" />;
    if (s === "partial") return <AlertTriangle size={18} className="text-amber-500" />;
    return <XCircle size={18} className="text-red-400" />;
  };

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Cargando...</p></div>;

  const completedCount = steps.filter((s) => s.status === "completed").length;
  const checkIn = checks.find((c) => c.CheckType === "IN");
  const duration = visitData?.OpenedAt
    ? Math.round((Date.now() - new Date(visitData.OpenedAt).getTime()) / 60000)
    : null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1.5 hover:bg-muted rounded-lg">
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-foreground">Resumen de Visita</h1>
            <p className="text-xs text-muted-foreground">{pdv?.Name}</p>
          </div>
          <Badge variant={completedCount === steps.length ? "default" : "secondary"} className="text-xs">
            {completedCount}/{steps.length}
          </Badge>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Indicators bar */}
        {visitId && <VisitIndicatorsBar visitId={visitId} />}

        {/* Visit info */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {checkIn?.Ts && (
            <span className="flex items-center gap-1">
              <Clock size={12} />
              Check-in: {formatTime24(checkIn.Ts)}
            </span>
          )}
          {duration != null && (
            <span className="flex items-center gap-1">
              <MapPin size={12} />
              {duration} min en PDV
            </span>
          )}
        </div>

        {/* Steps - clickable */}
        <Card>
          <CardContent className="p-0 divide-y divide-border">
            {steps.map((step, idx) => {
              const Icon = step.icon;
              const isIncomplete = step.status === "partial" || step.status === "pending";
              return (
                <div key={idx} className="flex items-center gap-3 p-3.5 hover:bg-muted/30 transition-colors">
                  <button
                    onClick={() => setDetailModal(step.type)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  >
                    {statusIcon(step.status)}
                    <Icon size={16} className="text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-foreground">{step.label}</p>
                      <p className="text-[11px] text-muted-foreground">{step.detail}</p>
                    </div>
                  </button>
                  {isIncomplete ? (
                    <button
                      onClick={() => navigate(`/pos/${id}/${STEP_ROUTES[step.type]}`, { state: { routeDayId, visitId } })}
                      className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-amber-100 text-amber-800 hover:bg-amber-200 transition-colors shrink-0"
                    >
                      Completar
                    </button>
                  ) : (
                    <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Validation warnings */}
        {validationErrors.length > 0 && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-amber-800 text-xs">Campos obligatorios pendientes</p>
              <ul className="text-[11px] text-amber-700 mt-1 space-y-0.5">
                {validationErrors.slice(0, 3).map((err, i) => <li key={i}>- {err}</li>)}
                {validationErrors.length > 3 && <li>y {validationErrors.length - 3} más...</li>}
              </ul>
            </div>
          </div>
        )}

        {/* Reminder → se guarda como nota pendiente del PDV */}
        <Card>
          <CardContent className="p-3 space-y-2">
            <p className="font-medium text-sm text-foreground">Nota / TODO para la próxima visita</p>
            <p className="text-[11px] text-muted-foreground">
              Se guarda como nota del PDV. El próximo TM Rep que visite este punto la va a ver al hacer check-in.
            </p>
            <Textarea
              placeholder="Ej: Verificar stock de producto X, hablar con el encargado, traer material POP..."
              value={reminderForNext}
              onChange={(e) => setReminderForNext(e.target.value)}
              className="min-h-[60px] text-sm"
            />
          </CardContent>
        </Card>

        {/* Spacer */}
        <div className="h-16" />
      </div>

      {/* Close button */}
      <div className="sticky bottom-0 bg-card border-t border-border p-3 pb-[env(safe-area-inset-bottom)]">
        <Button
          className="w-full h-11 text-sm font-semibold bg-[#A48242] hover:bg-[#8a6d35]"
          onClick={handleClose}
          disabled={closing}
        >
          <LogOut className="mr-2" size={16} />
          {closing ? "Cerrando..." : "Cerrar Visita y Check-out"}
        </Button>
      </div>

      {/* === DETAIL MODALS === */}

      {/* Relevamiento detail */}
      <Modal
        isOpen={detailModal === "relevamiento"}
        onClose={() => setDetailModal(null)}
        title="Relevamiento"
        size="lg"
      >
        <div className="space-y-3">
          {answers.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">Sin respuestas registradas</p>
          ) : (
            answers.map((a) => {
              const q = questions.find((qq) => qq.QuestionId === a.QuestionId);
              const rawJson = a.ValueJson || a.ValueText;
              let parsed: Record<string, unknown> | null = null;
              try { if (rawJson && (rawJson.startsWith("{") || rawJson.startsWith("["))) parsed = JSON.parse(rawJson); } catch {}

              const isCoverage = parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
                Object.values(parsed).some((v) => typeof v === "object" && v !== null && "covered" in (v as Record<string, unknown>));
              const isCheckboxPrice = parsed && typeof parsed === "object" && !Array.isArray(parsed) && !isCoverage &&
                Object.values(parsed).some((v) => v === null || typeof v === "number");

              return (
                <div key={a.AnswerId} className="border border-border rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-muted/30 border-b border-border">
                    <span className="text-xs font-semibold text-foreground">{q?.Label || `Pregunta #${a.QuestionId}`}</span>
                  </div>
                  {isCoverage && parsed ? (
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-border text-muted-foreground">
                        <th className="text-left py-1 px-3 font-medium">Producto</th>
                        <th className="text-right py-1 px-3 font-medium w-16">Precio</th>
                        <th className="text-right py-1 px-3 font-medium w-20">Estado</th>
                      </tr></thead>
                      <tbody className="divide-y divide-border">
                        {Object.entries(parsed as Record<string, { covered: boolean; price?: number | null; stockout?: boolean }>)
                          .filter(([, v]) => (v as any).covered)
                          .map(([key, v]) => {
                            const item = v as { covered: boolean; price?: number | null; stockout?: boolean };
                            const name = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                            return (
                              <tr key={key}>
                                <td className="py-1.5 px-3 text-foreground">{name}</td>
                                <td className="py-1.5 px-3 text-right font-semibold tabular-nums">{item.price != null ? `$${item.price}` : "—"}</td>
                                <td className="py-1.5 px-3 text-right">
                                  <Badge variant={item.stockout ? "destructive" : "secondary"} className="text-[9px] px-1 py-0">{item.stockout ? "Quiebre" : "OK"}</Badge>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  ) : isCheckboxPrice && parsed ? (
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-border text-muted-foreground">
                        <th className="text-left py-1 px-3 font-medium">Producto</th>
                        <th className="text-right py-1 px-3 font-medium w-20">Precio</th>
                      </tr></thead>
                      <tbody className="divide-y divide-border">
                        {Object.entries(parsed as Record<string, number | null>).map(([key, v]) => {
                          const name = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                          return (
                            <tr key={key}>
                              <td className="py-1.5 px-3 text-foreground">{name}</td>
                              <td className="py-1.5 px-3 text-right font-semibold tabular-nums">{v != null ? `$${v}` : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="px-3 py-2">
                      <span className="text-sm text-foreground">{renderAnswerValue(a)}</span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Modal>

      {/* Acciones detail */}
      <Modal
        isOpen={detailModal === "acciones"}
        onClose={() => setDetailModal(null)}
        title="Acciones de Ejecución"
        size="lg"
      >
        <div>
          {actions.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">Sin acciones registradas</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-xs text-muted-foreground">
                <th className="text-left py-1.5 font-medium">Acción</th>
                <th className="text-left py-1.5 font-medium w-20">Tipo</th>
                <th className="text-right py-1.5 font-medium w-20">Estado</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {actions.map((a: VisitAction) => (
                  <tr key={a.VisitActionId}>
                    <td className="py-2">
                      <span className="text-foreground">{a.Description || a.ActionType}</span>
                    </td>
                    <td className="py-2"><Badge variant="outline" className="text-[9px]">{a.ActionType}</Badge></td>
                    <td className="py-2 text-right">
                      <Badge variant={a.Status === "DONE" ? "secondary" : "destructive"} className="text-[9px] px-1.5 py-0">
                        {a.Status === "DONE" ? "Hecho" : a.Status === "BACKLOG" ? "Backlog" : "Pendiente"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Modal>

      {/* Fotos detail */}
      <Modal
        isOpen={detailModal === "fotos"}
        onClose={() => setDetailModal(null)}
        title="Evidencia Fotográfica"
        size="lg"
      >
        {visitPhotos.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Camera size={40} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">Sin fotos subidas para esta visita</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {visitPhotos.map((p) => (
              <div key={p.FileId} className="relative">
                <img
                  src={p.url}
                  alt={p.PhotoType}
                  className="w-full h-32 object-cover rounded-lg border border-border"
                />
                <div className="absolute bottom-1 left-1">
                  <Badge variant="secondary" className="text-[9px]">{p.PhotoType}</Badge>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground text-center">
                  {formatTime24(p.created_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Cobertura detail */}
      <Modal
        isOpen={detailModal === "cobertura"}
        onClose={() => setDetailModal(null)}
        title="Cobertura y Precios"
        size="lg"
      >
        {coverageItems.length === 0 ? (
          <p className="text-center text-muted-foreground py-6 text-sm">Sin datos de cobertura</p>
        ) : (
          <div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-left py-1.5 font-medium">Producto</th>
                  <th className="text-right py-1.5 font-medium w-20">Precio</th>
                  <th className="text-right py-1.5 font-medium w-24">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {coverageItems.filter((c) => c.Works).map((c) => {
                  const prod = productMap[c.ProductId];
                  return (
                    <tr key={c.VisitCoverageId}>
                      <td className="py-2">
                        <span className="font-medium text-foreground">{prod?.Name || `#${c.ProductId}`}</span>
                        {prod?.IsOwn && <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-[#A48242]/10 text-[#A48242] font-semibold">ESPERT</span>}
                      </td>
                      <td className="text-right py-2 font-semibold tabular-nums">
                        {c.Price != null ? `$${Number(c.Price).toLocaleString()}` : "—"}
                      </td>
                      <td className="text-right py-2">
                        <Badge variant={c.Availability === "quiebre" ? "destructive" : "secondary"} className="text-[9px] px-1.5 py-0">
                          {c.Availability === "quiebre" ? "Quiebre" : "Disponible"}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-3 pt-2 border-t border-border">
              {coverageItems.filter((c) => c.Works).length} trabajan de {coverageItems.length} relevados
              {coverageItems.filter((c) => c.Availability === "quiebre").length > 0 &&
                ` · ${coverageItems.filter((c) => c.Availability === "quiebre").length} quiebres`}
            </p>
          </div>
        )}
      </Modal>

      {/* POP detail */}
      <Modal
        isOpen={detailModal === "pop"}
        onClose={() => setDetailModal(null)}
        title="Censo de Materiales POP"
      >
        {popItems.length === 0 ? (
          <p className="text-center text-muted-foreground py-6 text-sm">Sin datos de POP</p>
        ) : (
          <div>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-xs text-muted-foreground">
                <th className="text-left py-1.5 font-medium">Material</th>
                <th className="text-left py-1.5 font-medium w-20">Empresa</th>
                <th className="text-right py-1.5 font-medium w-20">Precio</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {popItems.filter((p) => p.Present).map((p) => (
                  <tr key={p.VisitPOPItemId}>
                    <td className="py-2">
                      <span className="text-foreground">{p.MaterialName}</span>
                      <Badge variant="outline" className="text-[8px] ml-1 py-0">{p.MaterialType === "primario" ? "1ro" : "2do"}</Badge>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">{p.Company || "—"}</td>
                    <td className="py-2 text-right">
                      {p.HasPrice !== null && (
                        <Badge variant={p.HasPrice ? "secondary" : "outline"} className="text-[9px] px-1.5 py-0">
                          {p.HasPrice ? "Con precio" : "Sin precio"}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visitPhotos.filter((ph) => ph.PhotoType.startsWith("pop_")).length > 0 && (
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs font-medium text-muted-foreground mb-2">Fotos de evidencia:</p>
                <div className="grid grid-cols-3 gap-2">
                  {visitPhotos.filter((ph) => ph.PhotoType.startsWith("pop_")).map((ph) => (
                    <div key={ph.FileId}>
                      <img src={ph.url} alt={ph.PhotoType} className="w-full h-20 object-cover rounded-lg border border-border" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      <p className="text-[9px] text-muted-foreground text-center mt-0.5">{ph.PhotoType.replace("pop_", "")}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Novedades detail */}
      <Modal
        isOpen={detailModal === "novedades"}
        onClose={() => setDetailModal(null)}
        title="Novedades de Mercado"
      >
        <div className="space-y-2">
          {news.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">Sin novedades registradas (opcional)</p>
          ) : (
            news.map((n: MarketNews) => (
              <div key={n.MarketNewsId} className="p-3 bg-muted/30 rounded-lg">
                {n.Tags && (
                  <div className="flex gap-1 mb-1">
                    {n.Tags.split(",").map((t, i) => (
                      <Badge key={i} variant="outline" className="text-[10px]">{t.trim()}</Badge>
                    ))}
                  </div>
                )}
                <p className="text-sm text-foreground">{n.Notes || "Sin detalle"}</p>
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}
