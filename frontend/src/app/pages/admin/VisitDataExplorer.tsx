import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import {
  Search, MapPin, User, Clock, ChevronRight, FileText,
  Package, Megaphone, Newspaper, Camera, CheckCircle2,
  XCircle, AlertCircle, Filter, Download, Eye,
} from "lucide-react";
import { visitsApi, formsApi } from "@/lib/api";
import { API_BASE_URL } from "@/lib/api/config";
import { getAccessToken } from "@/lib/api/auth-storage";
import { toast } from "sonner";
import { exportToExcel } from "@/lib/exportExcel";

interface EnrichedVisit {
  VisitId: number;
  PdvId: number;
  UserId: number;
  Status: string;
  OpenedAt: string | null;
  ClosedAt: string | null;
  CloseReason: string | null;
  PdvName: string | null;
  PdvAddress: string | null;
  UserName: string | null;
}

interface VisitFull {
  visit: { VisitId: number; PdvId: number; UserId: number; Status: string; OpenedAt: string | null; ClosedAt: string | null; CloseReason: string | null };
  pdv: { PdvId: number; Name: string; Address: string | null; Channel: string | null } | null;
  user: { UserId: number; DisplayName: string; Email: string } | null;
  answers: Array<{ QuestionId: number; Label: string; QType: string; ValueText: string | null; ValueNumber: number | null; ValueBool: boolean | null; ValueJson: string | null }>;
  coverage: Array<{ ProductId: number; ProductName: string; Category: string; Manufacturer: string | null; IsOwn: boolean; Works: boolean; Price: number | null; Availability: string | null }>;
  pop: Array<{ MaterialType: string; MaterialName: string; Company: string | null; Present: boolean; HasPrice: boolean | null }>;
  marketNews: Array<{ MarketNewsId: number; Tags: string | null; Notes: string; CreatedAt: string | null }>;
  photos: Array<{ FileId: number; PhotoType: string; url: string; Notes: string | null }>;
}

async function fetchVisitsFull(params: Record<string, string | number>): Promise<EnrichedVisit[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  qs.set("enrich", "true");
  const token = getAccessToken();
  const res = await fetch(`${API_BASE_URL}/visits?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Error al cargar visitas");
  return res.json();
}

async function fetchVisitDetail(visitId: number): Promise<VisitFull> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE_URL}/visits/${visitId}/full`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Error al cargar detalle");
  return res.json();
}

function formatDate(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function renderAnswerValue(a: { QType: string; ValueText: string | null; ValueNumber: number | null; ValueBool: boolean | null; ValueJson: string | null }) {
  if (a.ValueJson) {
    try {
      const parsed = JSON.parse(a.ValueJson);
      if (typeof parsed === "object" && !Array.isArray(parsed)) {
        // checkbox_price: { brand: price }
        return Object.entries(parsed)
          .filter(([, v]) => v !== null && v !== false)
          .map(([k, v]) => `${k}: ${v === true ? "Si" : `$${v}`}`)
          .join(", ") || "-";
      }
      if (Array.isArray(parsed)) return parsed.join(", ");
      return String(parsed);
    } catch { return a.ValueJson; }
  }
  if (a.ValueBool !== null) return a.ValueBool ? "Si" : "No";
  if (a.ValueNumber !== null) return String(a.ValueNumber);
  return a.ValueText || "-";
}

export function VisitDataExplorer() {
  const [visits, setVisits] = useState<EnrichedVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("CLOSED");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // Detail modal
  const [selectedVisit, setSelectedVisit] = useState<VisitFull | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<"forms" | "coverage" | "pop" | "news" | "photos">("forms");

  const loadVisits = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { limit: PAGE_SIZE, skip: page * PAGE_SIZE };
      if (statusFilter) params.status = statusFilter;
      const data = await fetchVisitsFull(params);
      setVisits(data);
    } catch { toast.error("Error al cargar visitas"); }
    finally { setLoading(false); }
  }, [statusFilter, page]);

  useEffect(() => { loadVisits(); }, [loadVisits]);

  const openDetail = async (visitId: number) => {
    setDetailLoading(true);
    setDetailTab("forms");
    try {
      const data = await fetchVisitDetail(visitId);
      setSelectedVisit(data);
    } catch { toast.error("Error al cargar detalle"); }
    finally { setDetailLoading(false); }
  };

  const filtered = search
    ? visits.filter((v) =>
        (v.PdvName || "").toLowerCase().includes(search.toLowerCase()) ||
        (v.UserName || "").toLowerCase().includes(search.toLowerCase()) ||
        (v.PdvAddress || "").toLowerCase().includes(search.toLowerCase())
      )
    : visits;

  // Group by TM Rep
  const groupedByUser = filtered.reduce((acc, v) => {
    const key = v.UserName || `Usuario #${v.UserId}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(v);
    return acc;
  }, {} as Record<string, EnrichedVisit[]>);
  const sortedGroups = Object.entries(groupedByUser).sort(([a], [b]) => a.localeCompare(b));

  const handleExport = () => {
    if (!selectedVisit) return;
    const sv = selectedVisit;
    const sheets: Array<{ name: string; data: Record<string, unknown>[] }> = [];

    if (sv.answers.length) {
      sheets.push({
        name: "Formularios",
        data: sv.answers.map((a) => ({ Pregunta: a.Label, Tipo: a.QType, Respuesta: renderAnswerValue(a) })),
      });
    }
    if (sv.coverage.length) {
      sheets.push({
        name: "Cobertura",
        data: sv.coverage.map((c) => ({
          Producto: c.ProductName, Categoria: c.Category, Fabricante: c.Manufacturer || "",
          Propio: c.IsOwn ? "Si" : "No", Trabaja: c.Works ? "Si" : "No",
          Precio: c.Price ?? "", Disponibilidad: c.Availability || "",
        })),
      });
    }
    if (sv.pop.length) {
      sheets.push({
        name: "POP",
        data: sv.pop.map((p) => ({
          Tipo: p.MaterialType, Material: p.MaterialName, Empresa: p.Company || "",
          Presente: p.Present ? "Si" : "No", Precio: p.HasPrice === true ? "Con precio" : p.HasPrice === false ? "Sin precio" : "",
        })),
      });
    }
    if (sv.marketNews.length) {
      sheets.push({
        name: "Novedades",
        data: sv.marketNews.map((n) => ({ Tags: n.Tags || "", Nota: n.Notes, Fecha: n.CreatedAt || "" })),
      });
    }

    if (sheets.length === 0) { toast.warning("Sin datos para exportar"); return; }
    exportToExcel(`Visita_${sv.visit.VisitId}_${sv.pdv?.Name || "PDV"}`, sheets);
    toast.success("Exportado");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-1">Censos y Respuestas</h1>
        <p className="text-muted-foreground text-sm">Ver el detalle de cada visita: formularios, cobertura, POP y novedades</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
          <Input
            placeholder="Buscar PDV, vendedor o dirección..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5">
          {[
            { value: "CLOSED", label: "Cerradas" },
            { value: "OPEN", label: "Abiertas" },
            { value: "", label: "Todas" },
          ].map((f) => (
            <button
              key={f.value}
              onClick={() => { setStatusFilter(f.value); setPage(0); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                statusFilter === f.value
                  ? "bg-[#A48242] text-white"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Visit list */}
      {loading ? (
        <div className="py-20 text-center text-muted-foreground">Cargando visitas...</div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground">Sin visitas encontradas</div>
      ) : (
        <>
          <div className="space-y-6">
            {sortedGroups.map(([userName, userVisits]) => (
              <div key={userName}>
                {/* TM Rep header */}
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-[#A48242]/10 flex items-center justify-center">
                    <User size={16} className="text-[#A48242]" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground text-sm">{userName}</p>
                    <p className="text-[10px] text-muted-foreground">{userVisits.length} visita{userVisits.length !== 1 ? "s" : ""}</p>
                  </div>
                </div>

                <Card>
                  <CardContent className="p-0 divide-y divide-border">
                    {userVisits.map((v) => (
                      <button
                        key={v.VisitId}
                        onClick={() => openDetail(v.VisitId)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                          v.Status === "CLOSED" ? "bg-green-100" : v.Status === "OPEN" ? "bg-amber-100" : "bg-muted"
                        }`}>
                          {v.Status === "CLOSED" ? <CheckCircle2 size={16} className="text-green-600" /> :
                           v.Status === "OPEN" ? <Clock size={16} className="text-amber-600" /> :
                           <AlertCircle size={16} className="text-muted-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-foreground text-sm truncate">{v.PdvName || `PDV #${v.PdvId}`}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {v.PdvAddress && <span className="text-[11px] text-muted-foreground truncate">{v.PdvAddress}</span>}
                            <span className="text-[10px] text-muted-foreground">{formatDate(v.OpenedAt)}</span>
                          </div>
                        </div>
                        <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                      </button>
                    ))}
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>

          <div className="flex justify-center gap-2">
            {page > 0 && (
              <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)}>Anterior</Button>
            )}
            {filtered.length === PAGE_SIZE && (
              <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
            )}
          </div>
        </>
      )}

      {/* Detail Modal */}
      <Modal
        isOpen={!!selectedVisit || detailLoading}
        onClose={() => setSelectedVisit(null)}
        title={selectedVisit ? `${selectedVisit.pdv?.Name || "PDV"} — ${formatDate(selectedVisit.visit.OpenedAt)}` : "Cargando..."}
        size="lg"
      >
        {detailLoading ? (
          <div className="py-12 text-center text-muted-foreground">Cargando detalle...</div>
        ) : selectedVisit && (
          <div className="space-y-4">
            {/* Visit header */}
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div>
                <p className="text-sm font-medium">{selectedVisit.user?.DisplayName}</p>
                <p className="text-xs text-muted-foreground">{selectedVisit.pdv?.Address} · {selectedVisit.pdv?.Channel}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleExport} className="gap-1">
                  <Download size={14} /> Excel
                </Button>
                <Badge variant={selectedVisit.visit.Status === "CLOSED" ? "secondary" : "outline"}>
                  {selectedVisit.visit.Status}
                </Badge>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 overflow-x-auto border-b border-border pb-1">
              {[
                { key: "forms", label: "Formularios", icon: FileText, count: selectedVisit.answers.length },
                { key: "coverage", label: "Cobertura", icon: Package, count: selectedVisit.coverage.filter((c) => c.Works).length },
                { key: "pop", label: "POP", icon: Megaphone, count: selectedVisit.pop.filter((p) => p.Present).length },
                { key: "news", label: "Novedades", icon: Newspaper, count: selectedVisit.marketNews.length },
                { key: "photos", label: "Fotos", icon: Camera, count: selectedVisit.photos.length },
              ].map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setDetailTab(tab.key as typeof detailTab)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium whitespace-nowrap transition-colors ${
                      detailTab === tab.key
                        ? "bg-[#A48242]/10 text-[#A48242] border-b-2 border-[#A48242]"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon size={14} />
                    {tab.label}
                    {tab.count > 0 && <Badge variant="secondary" className="text-[9px] px-1 py-0">{tab.count}</Badge>}
                  </button>
                );
              })}
            </div>

            {/* Tab content */}
            <div className="max-h-[50vh] overflow-y-auto">
              {/* FORMS */}
              {detailTab === "forms" && (
                selectedVisit.answers.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Sin respuestas de formulario</p>
                ) : (
                  <div className="space-y-2">
                    {selectedVisit.answers.map((a, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                        <div className="flex-1">
                          <p className="text-xs font-medium text-foreground">{a.Label}</p>
                          <p className="text-sm text-foreground mt-1">{renderAnswerValue(a)}</p>
                        </div>
                        <Badge variant="outline" className="text-[9px] shrink-0">{a.QType}</Badge>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* COVERAGE */}
              {detailTab === "coverage" && (
                selectedVisit.coverage.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Sin datos de cobertura</p>
                ) : (
                  <div className="space-y-1">
                    {/* Group by category */}
                    {Object.entries(
                      selectedVisit.coverage.reduce((acc, c) => {
                        if (!acc[c.Category]) acc[c.Category] = [];
                        acc[c.Category].push(c);
                        return acc;
                      }, {} as Record<string, typeof selectedVisit.coverage>)
                    ).map(([cat, products]) => (
                      <div key={cat}>
                        <p className="text-[10px] font-bold text-[#A48242] uppercase tracking-wider mt-3 mb-1">{cat}</p>
                        {products.map((c) => (
                          <div key={c.ProductId} className={`flex items-center justify-between p-2 rounded ${c.Works ? "bg-green-50" : "bg-muted/30"}`}>
                            <div className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${c.Works ? "bg-green-500" : "bg-gray-300"}`} />
                              <span className="text-xs text-foreground">{c.ProductName}</span>
                              {c.IsOwn && <Badge className="text-[8px] px-1 py-0 bg-[#A48242]/10 text-[#A48242]">ESPERT</Badge>}
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                              {c.Price != null && <span className="font-medium">${c.Price}</span>}
                              {c.Availability === "quiebre" && <Badge variant="destructive" className="text-[8px] px-1 py-0">Quiebre</Badge>}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* POP */}
              {detailTab === "pop" && (
                selectedVisit.pop.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Sin datos POP</p>
                ) : (
                  <div className="space-y-1">
                    {selectedVisit.pop.map((p, i) => (
                      <div key={i} className={`flex items-center justify-between p-2.5 rounded ${p.Present ? "bg-green-50" : "bg-muted/30"}`}>
                        <div>
                          <span className="text-xs font-medium text-foreground">{p.MaterialName}</span>
                          {p.Company && <span className="text-[10px] text-muted-foreground ml-2">({p.Company})</span>}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={p.Present ? "secondary" : "outline"} className="text-[9px]">
                            {p.Present ? "Presente" : "Ausente"}
                          </Badge>
                          {p.HasPrice !== null && (
                            <Badge variant="outline" className="text-[9px]">
                              {p.HasPrice ? "Con precio" : "Sin precio"}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* NEWS */}
              {detailTab === "news" && (
                selectedVisit.marketNews.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Sin novedades</p>
                ) : (
                  <div className="space-y-2">
                    {selectedVisit.marketNews.map((n) => (
                      <Card key={n.MarketNewsId}>
                        <CardContent className="p-3">
                          {n.Tags && (
                            <div className="flex gap-1 mb-1">
                              {n.Tags.split(",").filter(Boolean).map((t) => (
                                <Badge key={t} variant="secondary" className="text-[9px]">{t.trim()}</Badge>
                              ))}
                            </div>
                          )}
                          <p className="text-sm text-foreground">{n.Notes}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">{formatDate(n.CreatedAt)}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )
              )}

              {/* PHOTOS */}
              {detailTab === "photos" && (
                selectedVisit.photos.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Sin fotos</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {selectedVisit.photos.map((p) => (
                      <div key={p.FileId} className="relative group">
                        <img src={p.url} alt={p.PhotoType} className="w-full h-32 object-cover rounded-lg border border-border" />
                        <div className="absolute bottom-1 left-1">
                          <Badge variant="secondary" className="text-[8px] px-1 py-0 bg-black/60 text-white">{p.PhotoType}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
