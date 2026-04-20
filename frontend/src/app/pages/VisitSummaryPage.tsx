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
  Navigation, FileText,
} from "lucide-react";
import { pdvsApi, visitsApi, visitActionsApi, marketNewsApi, formsApi, pdvNotesApi, visitPhotosApi, fetchRouteDayPdvsForDate } from "@/lib/api";
import type { VisitPhotoRead } from "@/lib/api";
import { executeOrEnqueue } from "@/lib/offline";
import { getCurrentUser } from "../lib/auth";
import type { Pdv, VisitAction, MarketNews, VisitAnswer } from "@/lib/api";
import { toast } from "sonner";
import { renderAnswerValue } from "../lib/answerFormatter";

interface StepData {
  label: string;
  icon: React.ElementType;
  status: "completed" | "partial" | "pending";
  detail: string;
  type: "relevamiento" | "acciones" | "fotos" | "novedades";
}

interface FormQuestion {
  QuestionId: number;
  Label: string;
  QType: string;
}

export function VisitSummaryPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const routeDayId = (location.state as { routeDayId?: number } | null)?.routeDayId;
  const visitIdFromState = (location.state as { visitId?: number } | null)?.visitId;

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

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const p = await pdvsApi.get(Number(id));
      setPdv(p);

      let vid = visitIdFromState;
      if (!vid) {
        const openVisits = await visitsApi.list({ pdv_id: Number(id), status: "OPEN" });
        if (openVisits.length > 0) vid = openVisits[0].VisitId;
      }
      if (!vid) { toast.error("No hay visita activa"); navigate(`/pos/${id}`); return; }
      setVisitId(vid);

      const [ans, acts, nws, validation, chks, visit, photos] = await Promise.all([
        visitsApi.listAnswers(vid),
        visitActionsApi.list(vid),
        marketNewsApi.list(vid),
        visitsApi.validateClose(vid),
        visitsApi.listChecks(vid),
        visitsApi.get(vid),
        visitPhotosApi.list(vid).catch(() => [] as VisitPhotoRead[]),
      ]);

      setAnswers(ans);
      setActions(acts);
      setNews(nws);
      setChecks(chks);
      setVisitData(visit);
      setVisitPhotos(photos);

      // Load questions for answers
      if (ans.length > 0) {
        const forms = await formsApi.list().catch(() => []);
        const allQ: FormQuestion[] = [];
        for (const f of forms) {
          const qs = await formsApi.listQuestions(f.FormId).catch(() => []);
          allQ.push(...qs);
        }
        setQuestions(allQ);
      }

      const statusSteps: StepData[] = [];

      // Relevamiento
      if (ans.length > 0) {
        const missing = validation.missing.filter((m) => m.questionId);
        statusSteps.push({
          label: "Relevamiento", icon: ClipboardCheck, type: "relevamiento",
          status: missing.length === 0 ? "completed" : "partial",
          detail: missing.length === 0 ? `${ans.length} respuestas` : `${missing.length} pendientes`,
        });
      } else {
        statusSteps.push({ label: "Relevamiento", icon: ClipboardCheck, type: "relevamiento", status: "pending", detail: "Sin respuestas" });
      }

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
        {/* Visit info */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {checkIn?.Ts && (
            <span className="flex items-center gap-1">
              <Clock size={12} />
              Check-in: {new Date(checkIn.Ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
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
              return (
                <button
                  key={idx}
                  onClick={() => setDetailModal(step.type)}
                  className="w-full flex items-center gap-3 p-3.5 text-left hover:bg-muted/30 active:bg-muted/50 transition-colors"
                >
                  {statusIcon(step.status)}
                  <Icon size={16} className="text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-foreground">{step.label}</p>
                    <p className="text-[11px] text-muted-foreground">{step.detail}</p>
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                </button>
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
      <div className="sticky bottom-0 bg-card border-t border-border p-3">
        <Button
          className="w-full h-11 text-sm font-semibold bg-red-600 hover:bg-red-700"
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
        <div className="space-y-1">
          {answers.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">Sin respuestas registradas</p>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              {answers.map((a, i) => {
                const q = questions.find((q) => q.QuestionId === a.QuestionId);
                const val = renderAnswerValue(a);
                return (
                  <div key={a.AnswerId} className={`flex items-center justify-between px-3 py-2.5 text-sm ${i % 2 === 0 ? "bg-white" : "bg-muted/30"}`}>
                    <span className="text-muted-foreground text-xs flex-1 mr-3">{q?.Label || `Pregunta #${a.QuestionId}`}</span>
                    <span className={`font-semibold text-sm shrink-0 ${
                      val === "Sí" || val === "OK" || val === "Completo" || val === "Bien" ? "text-green-700" :
                      val === "No" || val === "Faltante" || val === "Sin stock" ? "text-red-600" : "text-foreground"
                    }`}>{val}</span>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground text-center pt-2">{answers.length} respuestas registradas</p>
        </div>
      </Modal>

      {/* Acciones detail */}
      <Modal
        isOpen={detailModal === "acciones"}
        onClose={() => setDetailModal(null)}
        title="Acciones de Ejecución"
        size="lg"
      >
        <div className="space-y-2">
          {actions.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">Sin acciones registradas</p>
          ) : (
            actions.map((a: VisitAction) => (
              <div key={a.VisitActionId} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                {a.Status === "DONE" ? (
                  <CheckCircle2 size={18} className="text-green-600 shrink-0" />
                ) : (
                  <Clock size={18} className="text-amber-500 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-foreground">{a.ActionType}</p>
                  {a.Description && <p className="text-xs text-muted-foreground truncate">{a.Description}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {a.PhotoRequired && (
                    <Badge variant={a.PhotoTaken ? "default" : "destructive"} className="text-[10px]">
                      {a.PhotoTaken ? "Foto OK" : "Sin foto"}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[10px]">{a.Status}</Badge>
                </div>
              </div>
            ))
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
                  {new Date(p.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            ))}
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
