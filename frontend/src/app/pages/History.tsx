import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Modal } from "../components/ui/modal";
import {
  ArrowLeft, Calendar, Clock, MessageSquare, FileText, MapPin,
  User, Navigation, ClipboardList, Camera, ChevronRight, X, Download,
} from "lucide-react";
import { pdvsApi, visitsApi, usersApi, formsApi, visitPhotosApi } from "@/lib/api";
import type { Visit, Pdv, VisitAnswer, VisitPhotoRead } from "@/lib/api/types";
import { exportToExcel } from "@/lib/exportExcel";
import { Button } from "../components/ui/button";
import { renderAnswerValue } from "../lib/answerFormatter";
import { toast } from "sonner";

interface VisitCheck {
  VisitCheckId: number;
  CheckType: string;
  Ts: string | null;
  Lat: number | null;
  Lon: number | null;
  AccuracyMeters: number | null;
  DistanceToPdvM: number | null;
}

interface FormQuestion {
  QuestionId: number;
  FormId: number;
  Label: string;
  QType: string;
  IsRequired: boolean;
  SortOrder: number;
}

export function History() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [pdv, setPdv] = useState<Pdv | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState<"all" | "month" | "quarter">("all");

  // Modal state
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);
  const [modalDetail, setModalDetail] = useState<{
    checks: VisitCheck[];
    answers: VisitAnswer[];
    photos: VisitPhotoRead[];
    userName: string | null;
    questions: FormQuestion[];
  } | null>(null);
  const [modalLoading, setModalLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    const pdvId = Number(id);
    setLoading(true);
    Promise.all([
      pdvsApi.get(pdvId).catch(() => null),
      visitsApi.list({ pdv_id: pdvId, limit: 200 }).catch(() => []),
    ])
      .then(([p, vs]) => {
        setPdv(p);
        setVisits([...vs].sort((a, b) => new Date(b.OpenedAt).getTime() - new Date(a.OpenedAt).getTime()));
      })
      .finally(() => setLoading(false));
  }, [id]);

  const openVisitDetail = async (visit: Visit) => {
    setSelectedVisit(visit);
    setModalDetail(null);
    setModalLoading(true);
    try {
      const [checks, answers, photos] = await Promise.all([
        visitsApi.listChecks(visit.VisitId).catch(() => []),
        visitsApi.listAnswers(visit.VisitId).catch(() => []),
        visitPhotosApi.list(visit.VisitId).catch(() => [] as VisitPhotoRead[]),
      ]);
      let userName: string | null = null;
      try { const u = await usersApi.get(visit.UserId); userName = u.DisplayName; } catch {}

      let questions: FormQuestion[] = [];
      if (answers.length > 0) {
        const allForms = await formsApi.list().catch(() => []);
        for (const f of allForms) {
          const qs = await formsApi.listQuestions(f.FormId).catch(() => []);
          questions.push(...qs);
        }
      }
      setModalDetail({ checks, answers, photos, userName, questions });
    } catch {} finally {
      setModalLoading(false);
    }
  };

  const now = new Date();
  const filteredVisits = visits.filter((v) => {
    if (dateFilter === "all") return true;
    const d = new Date(v.OpenedAt);
    if (dateFilter === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    if (dateFilter === "quarter") return (now.getTime() - d.getTime()) / 86400000 <= 90;
    return true;
  });

  const closedCount = visits.filter((v) => v.Status === "CLOSED").length;
  const avgDurationMin = (() => {
    const closed = visits.filter((v) => v.Status === "CLOSED" && v.ClosedAt);
    if (!closed.length) return null;
    return Math.round(closed.reduce((s, v) => s + (new Date(v.ClosedAt!).getTime() - new Date(v.OpenedAt).getTime()), 0) / closed.length / 60000);
  })();

  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!pdv || filteredVisits.length === 0) return;
    setExporting(true);
    try {
      // Build visit rows with details
      const visitRows: Record<string, unknown>[] = [];
      const answerRows: Record<string, unknown>[] = [];
      const gpsRows: Record<string, unknown>[] = [];

      for (const v of filteredVisits) {
        const d = dur(v);
        const dt = formatDt(v.OpenedAt);

        // Get user name
        let userName = "";
        try { const u = await usersApi.get(v.UserId); userName = u.DisplayName; } catch {}

        visitRows.push({
          "Fecha": dt.date,
          "Hora inicio": dt.time,
          "Hora cierre": v.ClosedAt ? formatDt(v.ClosedAt).time : "",
          "Duración (min)": d ?? "",
          "Estado": v.Status === "CLOSED" ? "Cerrada" : "Abierta",
          "Trade Rep": userName,
          "Observación": v.CloseReason || "",
        });

        // Load details
        const [checks, answers] = await Promise.all([
          visitsApi.listChecks(v.VisitId).catch(() => []),
          visitsApi.listAnswers(v.VisitId).catch(() => []),
        ]);

        for (const c of checks) {
          gpsRows.push({
            "Fecha": dt.date,
            "Tipo": c.CheckType === "IN" ? "Entrada" : "Salida",
            "Hora": c.Ts ? new Date(c.Ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "",
            "Latitud": c.Lat ? Number(c.Lat).toFixed(6) : "",
            "Longitud": c.Lon ? Number(c.Lon).toFixed(6) : "",
            "Distancia al PDV (m)": c.DistanceToPdvM != null ? Math.round(Number(c.DistanceToPdvM)) : "",
            "Precisión (m)": c.AccuracyMeters != null ? Math.round(Number(c.AccuracyMeters)) : "",
          });
        }

        // Load question labels if not loaded yet
        let allQuestions: FormQuestion[] = [];
        if (answers.length > 0) {
          const forms = await formsApi.list().catch(() => []);
          for (const f of forms) {
            const qs = await formsApi.listQuestions(f.FormId).catch(() => []);
            allQuestions.push(...qs);
          }
        }

        for (const a of answers) {
          const q = allQuestions.find((q) => q.QuestionId === a.QuestionId);
          answerRows.push({
            "Fecha visita": dt.date,
            "Pregunta": q?.Label || `Pregunta #${a.QuestionId}`,
            "Respuesta": renderAnswerValue(a),
            "Trade Rep": userName,
          });
        }
      }

      exportToExcel(`Historico_${pdv.Name.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}`, [
        { name: "Visitas", data: visitRows },
        ...(gpsRows.length > 0 ? [{ name: "GPS", data: gpsRows }] : []),
        ...(answerRows.length > 0 ? [{ name: "Relevamiento", data: answerRows }] : []),
      ]);
      toast.success(`Exportadas ${filteredVisits.length} visitas`);
    } catch (e) {
      toast.error("Error al exportar");
    } finally {
      setExporting(false);
    }
  };

  // renderAnswerValue extraído a app/lib/answerFormatter.ts

  const formatDt = (iso: string) => {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "long", year: "numeric" }),
      time: d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }),
    };
  };

  const dur = (v: Visit) => v.ClosedAt ? Math.round((new Date(v.ClosedAt).getTime() - new Date(v.OpenedAt).getTime()) / 60000) : null;

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Cargando...</p></div>;
  if (!pdv) return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">PDV no encontrado</p></div>;

  return (
    <div className="min-h-screen bg-background pb-4">
      {/* Header */}
      <div className="bg-card border-b border-border p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => navigate(`/pos/${id}`)} className="p-2 hover:bg-muted rounded-lg">
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Histórico</h1>
            <p className="text-sm text-muted-foreground">{pdv.Name}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={handleExport}
            disabled={exporting || filteredVisits.length === 0}
          >
            <Download size={14} />
            {exporting ? "..." : "Excel"}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {(["all", "month", "quarter"] as const).map((f) => (
            <button key={f} onClick={() => setDateFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${dateFilter === f ? "bg-[#A48242] text-white" : "bg-muted text-foreground"}`}>
              {f === "all" ? "Todas" : f === "month" ? "Este Mes" : "Último Trim."}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Summary */}
        <Card className="bg-gradient-to-r from-black to-[#1a1a18] text-white">
          <CardContent className="p-4">
            <h3 className="font-semibold mb-3 text-sm">Resumen</h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <p className="text-2xl font-bold">{visits.length}</p>
                <p className="text-[10px] text-white/60">Total visitas</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-green-400">{closedCount}</p>
                <p className="text-[10px] text-white/60">Completadas</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-[#A48242]">{avgDurationMin ?? "—"}m</p>
                <p className="text-[10px] text-white/60">Duración prom.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Timeline */}
        <h3 className="font-semibold text-foreground flex items-center gap-2 text-sm">
          <Calendar size={16} />
          Visitas ({filteredVisits.length})
        </h3>

        {filteredVisits.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground"><FileText size={32} className="mx-auto mb-2 opacity-40" />Sin visitas</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {filteredVisits.map((visit, index) => {
              const dt = formatDt(visit.OpenedAt);
              const d = dur(visit);
              return (
                <Card
                  key={visit.VisitId}
                  className="cursor-pointer hover:shadow-md transition-all active:scale-[0.99]"
                  onClick={() => openVisitDetail(visit)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center gap-3">
                      <div className={`rounded-full w-9 h-9 flex items-center justify-center text-xs font-bold shrink-0 ${
                        visit.Status === "CLOSED" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                      }`}>
                        {filteredVisits.length - index}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground text-sm">{dt.date}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          <Clock size={11} />
                          <span>{dt.time}</span>
                          {d !== null && <span>· {d} min</span>}
                        </div>
                      </div>
                      <Badge className={`text-[10px] shrink-0 ${visit.Status === "CLOSED" ? "bg-green-600" : "bg-amber-500"}`}>
                        {visit.Status === "CLOSED" ? "Cerrada" : "Abierta"}
                      </Badge>
                      <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Visit Detail Modal */}
      <Modal
        isOpen={selectedVisit !== null}
        onClose={() => { setSelectedVisit(null); setModalDetail(null); }}
        title="Detalle de Visita"
        size="lg"
      >
        {selectedVisit && (() => {
          const dt = formatDt(selectedVisit.OpenedAt);
          const d = dur(selectedVisit);
          const dtClose = selectedVisit.ClosedAt ? formatDt(selectedVisit.ClosedAt) : null;

          return (
            <div className="space-y-5">
              {/* Visit header */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-bold text-foreground">{dt.date}</p>
                  <p className="text-sm text-muted-foreground">{pdv?.Name}</p>
                </div>
                <Badge className={`${selectedVisit.Status === "CLOSED" ? "bg-green-600" : "bg-amber-500"}`}>
                  {selectedVisit.Status === "CLOSED" ? "Cerrada" : "Abierta"}
                </Badge>
              </div>

              {/* Time info */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-muted rounded-lg p-3 text-center">
                  <Clock size={16} className="mx-auto text-muted-foreground mb-1" />
                  <p className="text-sm font-bold text-foreground">{dt.time}</p>
                  <p className="text-[10px] text-muted-foreground">Inicio</p>
                </div>
                <div className="bg-muted rounded-lg p-3 text-center">
                  <Clock size={16} className="mx-auto text-muted-foreground mb-1" />
                  <p className="text-sm font-bold text-foreground">{dtClose?.time ?? "—"}</p>
                  <p className="text-[10px] text-muted-foreground">Cierre</p>
                </div>
                <div className="bg-muted rounded-lg p-3 text-center">
                  <MapPin size={16} className="mx-auto text-[#A48242] mb-1" />
                  <p className="text-sm font-bold text-foreground">{d ?? "—"} min</p>
                  <p className="text-[10px] text-muted-foreground">Duración</p>
                </div>
              </div>

              {modalLoading && (
                <div className="text-center py-6 text-muted-foreground text-sm">Cargando detalle...</div>
              )}

              {modalDetail && (
                <>
                  {/* Trade Rep */}
                  {modalDetail.userName && (
                    <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                      <User size={16} className="text-muted-foreground" />
                      <div>
                        <p className="text-xs text-muted-foreground">Trade Rep</p>
                        <p className="text-sm font-semibold text-foreground">{modalDetail.userName}</p>
                      </div>
                    </div>
                  )}

                  {/* GPS Checks */}
                  {modalDetail.checks.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <Navigation size={13} />
                        Ubicación GPS
                      </h4>
                      <div className="space-y-2">
                        {modalDetail.checks.map((c) => (
                          <div key={c.VisitCheckId} className="flex items-center gap-3 p-2.5 bg-white border border-border rounded-lg text-sm">
                            <Badge variant="outline" className={`text-[10px] shrink-0 ${c.CheckType === "IN" ? "border-green-300 text-green-700" : "border-red-300 text-red-700"}`}>
                              {c.CheckType === "IN" ? "Entrada" : "Salida"}
                            </Badge>
                            <div className="flex-1 min-w-0 text-xs text-muted-foreground">
                              {c.Ts && <span>{new Date(c.Ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
                              {c.Lat && <span className="ml-2">{Number(c.Lat).toFixed(5)}, {Number(c.Lon).toFixed(5)}</span>}
                            </div>
                            {c.DistanceToPdvM != null && (
                              <span className="text-xs text-muted-foreground shrink-0">{Math.round(Number(c.DistanceToPdvM))}m</span>
                            )}
                            {c.AccuracyMeters != null && (
                              <span className="text-[10px] text-muted-foreground shrink-0">±{Math.round(Number(c.AccuracyMeters))}m</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Form Answers */}
                  {modalDetail.answers.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <ClipboardList size={13} />
                        Relevamiento ({modalDetail.answers.length} respuestas)
                      </h4>
                      <div className="border border-border rounded-lg overflow-hidden">
                        {modalDetail.answers.map((a, i) => {
                          const q = modalDetail.questions.find((q) => q.QuestionId === a.QuestionId);
                          const val = renderAnswerValue(a);
                          return (
                            <div key={a.AnswerId} className={`flex items-center justify-between px-3 py-2.5 text-sm ${i % 2 === 0 ? "bg-white" : "bg-muted/30"}`}>
                              <span className="text-muted-foreground text-xs flex-1 mr-3">{q?.Label || `Pregunta #${a.QuestionId}`}</span>
                              <span className={`font-semibold text-sm shrink-0 ${
                                val === "Sí" || val === "OK" || val === "Completo" || val === "Bien" ? "text-green-700" :
                                val === "No" || val === "Faltante" || val === "Sin stock" ? "text-red-600" :
                                "text-foreground"
                              }`}>{val}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Photos */}
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                      <Camera size={13} />
                      Fotos
                    </h4>
                    <div className="border-2 border-dashed border-border rounded-lg p-6 text-center text-muted-foreground">
                      <Camera size={24} className="mx-auto mb-1 opacity-30" />
                      <p className="text-xs">Sin fotos en esta visita</p>
                    </div>
                  </div>

                  {/* Observations */}
                  {selectedVisit.CloseReason && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <MessageSquare size={13} />
                        Observaciones
                      </h4>
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <p className="text-sm text-amber-900">{selectedVisit.CloseReason}</p>
                      </div>
                    </div>
                  )}

                  {/* Fotos de la visita */}
                  {modalDetail.photos.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <Camera size={13} />
                        Fotos ({modalDetail.photos.length})
                      </h4>
                      <div className="grid grid-cols-3 gap-2">
                        {modalDetail.photos.map((p) => (
                          <div key={p.FileId} className="relative">
                            <img
                              src={p.url}
                              alt={p.PhotoType}
                              className="w-full h-20 object-cover rounded-lg border border-border"
                            />
                            <div className="absolute bottom-0.5 left-0.5">
                              <Badge variant="secondary" className="text-[10px] px-1 py-0">{p.PhotoType}</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Empty state */}
                  {modalDetail.checks.length === 0 && modalDetail.answers.length === 0 && modalDetail.photos.length === 0 && !selectedVisit.CloseReason && (
                    <div className="text-center py-4 text-muted-foreground">
                      <FileText size={32} className="mx-auto mb-2 opacity-30" />
                      <p className="text-sm">Sin datos adicionales registrados</p>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
