import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Modal } from "../components/ui/modal";
import {
  ArrowLeft, Calendar, Clock, MessageSquare, FileText, MapPin,
  User, Navigation, ClipboardList, Camera, ChevronRight, X, Download,
} from "lucide-react";
import { pdvsApi, visitsApi, usersApi, formsApi, visitPhotosApi, visitCoverageApi, visitPOPApi, visitActionsApi, marketNewsApi, productsApi } from "@/lib/api";
import type { Visit, Pdv, VisitAnswer, VisitPhotoRead, VisitCoverageItem, VisitPOPItem, VisitAction, MarketNews, Product } from "@/lib/api/types";
import { exportToExcel } from "@/lib/exportExcel";
import { Button } from "../components/ui/button";
import { renderAnswerValue } from "../lib/answerFormatter";
import { formatTime24, formatDateLong, todayAR } from "../lib/dateUtils";
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
    coverage: VisitCoverageItem[];
    popItems: VisitPOPItem[];
    actions: VisitAction[];
    news: MarketNews[];
    productMap: Record<number, Product>;
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
      const vid = visit.VisitId;
      const [checks, answers, photos, coverage, popItems, actions, news] = await Promise.all([
        visitsApi.listChecks(vid).catch(() => []),
        visitsApi.listAnswers(vid).catch(() => []),
        visitPhotosApi.list(vid).catch(() => [] as VisitPhotoRead[]),
        visitCoverageApi.list(vid).catch(() => [] as VisitCoverageItem[]),
        visitPOPApi.list(vid).catch(() => [] as VisitPOPItem[]),
        visitActionsApi.list(vid).catch(() => [] as VisitAction[]),
        marketNewsApi.list(vid).catch(() => [] as MarketNews[]),
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

      let productMap: Record<number, Product> = {};
      if (coverage.length > 0) {
        const prods = await productsApi.list({ active_only: false }).catch(() => []);
        for (const p of prods) productMap[p.ProductId] = p;
      }

      setModalDetail({ checks, answers, photos, userName, questions, coverage, popItems, actions, news, productMap });
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
            "Hora": c.Ts ? new Date(c.Ts).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "",
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

      exportToExcel(`Historico_${pdv.Name.replace(/\s+/g, "_")}_${todayAR()}`, [
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
    const weekday = d.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short" });
    return {
      date: `${weekday} ${formatDateLong(d)}`,
      time: formatTime24(d),
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
                              {c.Ts && <span>{new Date(c.Ts).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
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

                  {/* Formularios */}
                  {modalDetail.answers.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <ClipboardList size={13} />
                        Formularios ({modalDetail.answers.length})
                      </h4>
                      {modalDetail.answers.map((a) => {
                        const q = modalDetail.questions.find((qq) => qq.QuestionId === a.QuestionId);
                        const rawJson = a.ValueJson || a.ValueText;
                        let parsed: Record<string, unknown> | null = null;
                        try { if (rawJson && (rawJson.startsWith("{") || rawJson.startsWith("["))) parsed = JSON.parse(rawJson); } catch {}
                        const isCoverage = parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
                          Object.values(parsed).some((v) => typeof v === "object" && v !== null && "covered" in (v as Record<string, unknown>));

                        return (
                          <div key={a.AnswerId} className="border border-border rounded-lg overflow-hidden mb-2">
                            <div className="px-3 py-1.5 bg-muted/30 border-b border-border">
                              <span className="text-[11px] font-semibold text-foreground">{q?.Label || `Pregunta #${a.QuestionId}`}</span>
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
                            ) : (
                              <div className="px-3 py-2"><span className="text-sm text-foreground">{renderAnswerValue(a)}</span></div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Cobertura y Precios */}
                  {modalDetail.coverage.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <ClipboardList size={13} />
                        Cobertura y Precios
                      </h4>
                      <table className="w-full text-xs border border-border rounded-lg overflow-hidden">
                        <thead><tr className="border-b border-border text-muted-foreground bg-muted/30">
                          <th className="text-left py-1.5 px-3 font-medium">Producto</th>
                          <th className="text-right py-1.5 px-3 font-medium w-16">Precio</th>
                          <th className="text-right py-1.5 px-3 font-medium w-20">Estado</th>
                        </tr></thead>
                        <tbody className="divide-y divide-border">
                          {modalDetail.coverage.filter((c) => c.Works).map((c) => {
                            const prod = modalDetail.productMap[c.ProductId];
                            return (
                              <tr key={c.VisitCoverageId}>
                                <td className="py-1.5 px-3 text-foreground">
                                  {prod?.Name || `#${c.ProductId}`}
                                  {prod?.IsOwn && <span className="ml-1 text-[8px] px-1 py-0 rounded bg-[#A48242]/10 text-[#A48242] font-semibold">ESPERT</span>}
                                </td>
                                <td className="py-1.5 px-3 text-right font-semibold tabular-nums">{c.Price != null ? `$${Number(c.Price).toLocaleString()}` : "—"}</td>
                                <td className="py-1.5 px-3 text-right">
                                  <Badge variant={c.Availability === "quiebre" ? "destructive" : "secondary"} className="text-[9px] px-1 py-0">{c.Availability === "quiebre" ? "Quiebre" : "Disp."}</Badge>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Censo POP */}
                  {modalDetail.popItems.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <ClipboardList size={13} />
                        Censo POP
                      </h4>
                      <table className="w-full text-xs border border-border rounded-lg overflow-hidden">
                        <thead><tr className="border-b border-border text-muted-foreground bg-muted/30">
                          <th className="text-left py-1.5 px-3 font-medium">Material</th>
                          <th className="text-left py-1.5 px-3 font-medium w-20">Empresa</th>
                          <th className="text-right py-1.5 px-3 font-medium w-20">Precio</th>
                        </tr></thead>
                        <tbody className="divide-y divide-border">
                          {modalDetail.popItems.filter((p) => p.Present).map((p) => (
                            <tr key={p.VisitPOPItemId}>
                              <td className="py-1.5 px-3 text-foreground">
                                {p.MaterialName}
                                <Badge variant="outline" className="text-[8px] ml-1 py-0">{p.MaterialType === "primario" ? "1ro" : "2do"}</Badge>
                              </td>
                              <td className="py-1.5 px-3 text-muted-foreground">{p.Company || "—"}</td>
                              <td className="py-1.5 px-3 text-right">
                                {p.HasPrice !== null && <Badge variant={p.HasPrice ? "secondary" : "outline"} className="text-[9px] px-1 py-0">{p.HasPrice ? "Con precio" : "Sin precio"}</Badge>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Acciones */}
                  {modalDetail.actions.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <ClipboardList size={13} />
                        Acciones ({modalDetail.actions.length})
                      </h4>
                      <table className="w-full text-xs border border-border rounded-lg overflow-hidden">
                        <thead><tr className="border-b border-border text-muted-foreground bg-muted/30">
                          <th className="text-left py-1.5 px-3 font-medium">Acción</th>
                          <th className="text-left py-1.5 px-3 font-medium w-16">Tipo</th>
                          <th className="text-right py-1.5 px-3 font-medium w-20">Estado</th>
                        </tr></thead>
                        <tbody className="divide-y divide-border">
                          {modalDetail.actions.map((a) => (
                            <tr key={a.VisitActionId}>
                              <td className="py-1.5 px-3 text-foreground">{a.Description || a.ActionType}</td>
                              <td className="py-1.5 px-3"><Badge variant="outline" className="text-[8px]">{a.ActionType}</Badge></td>
                              <td className="py-1.5 px-3 text-right">
                                <Badge variant={a.Status === "DONE" ? "secondary" : "destructive"} className="text-[9px] px-1 py-0">{a.Status === "DONE" ? "Hecho" : "Pendiente"}</Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Novedades */}
                  {modalDetail.news.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <MessageSquare size={13} />
                        Novedades ({modalDetail.news.length})
                      </h4>
                      <div className="space-y-1.5">
                        {modalDetail.news.map((n) => (
                          <div key={n.MarketNewsId} className="p-2 bg-muted/30 rounded-lg">
                            {n.Tags && <div className="flex gap-1 mb-1">{n.Tags.split(",").map((t) => <Badge key={t} variant="outline" className="text-[8px] py-0">{t.trim()}</Badge>)}</div>}
                            <p className="text-xs text-foreground">{n.Notes}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Fotos */}
                  {modalDetail.photos.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <Camera size={13} />
                        Fotos ({modalDetail.photos.length})
                      </h4>
                      <div className="grid grid-cols-3 gap-2">
                        {modalDetail.photos.map((p) => (
                          <div key={p.FileId} className="relative">
                            <img src={p.url} alt={p.PhotoType} className="w-full h-20 object-cover rounded-lg border border-border" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            <div className="absolute bottom-0.5 left-0.5">
                              <Badge variant="secondary" className="text-[8px] px-1 py-0">{p.PhotoType}</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Observaciones */}
                  {selectedVisit.CloseReason && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <MessageSquare size={13} />
                        Nota para próxima visita
                      </h4>
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <p className="text-sm text-amber-900">{selectedVisit.CloseReason}</p>
                      </div>
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
