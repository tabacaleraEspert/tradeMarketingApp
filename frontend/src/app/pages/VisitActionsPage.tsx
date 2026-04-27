import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams, useLocation } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import {
  ArrowLeft,
  Plus,
  Camera,
  Trash2,
  CheckCircle2,
  Package,
  Megaphone,
  Repeat,
  Tag,
  MoreHorizontal,
  Newspaper,
  X,
  AlertTriangle,
  Clock,
  Star,
} from "lucide-react";
import { pdvsApi, visitActionsApi, marketNewsApi } from "@/lib/api";
import type { VisitAction, MarketNews } from "@/lib/api";
import { VisitStepIndicator } from "../components/VisitStepIndicator";
import { getCurrentUser } from "../lib/auth";
import { toast } from "sonner";

const ACTION_TYPES = [
  { value: "cobertura", label: "Generación de Cobertura", icon: Package, color: "bg-espert-gold/10 text-espert-gold",
    fields: ["skus", "quantity"] },
  { value: "pop", label: "Colocación de POP", icon: Megaphone, color: "bg-[#C9A962]/20 text-[#8B6E38]",
    fields: ["materialType", "location"] },
  { value: "canje_sueltos", label: "Canje de Sueltos", icon: Repeat, color: "bg-green-100 text-green-700",
    fields: ["brands", "quantity"] },
  { value: "promo", label: "Activación de Promo", icon: Tag, color: "bg-orange-100 text-orange-700",
    fields: ["promoType", "brand", "mechanic"] },
  { value: "otra", label: "Otra Acción", icon: MoreHorizontal, color: "bg-muted text-foreground",
    fields: ["category"] },
];

const MARKET_NEWS_TAGS = ["precio", "producto", "competencia", "canal", "otros"];

export function VisitActionsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const routeDayId = (location.state as { routeDayId?: number } | null)?.routeDayId;
  const visitIdFromState = (location.state as { visitId?: number } | null)?.visitId;

  const [pdv, setPdv] = useState<Awaited<ReturnType<typeof pdvsApi.get>> | null>(null);
  const [visitId, setVisitId] = useState<number | null>(visitIdFromState ?? null);
  const [actions, setActions] = useState<VisitAction[]>([]);
  const [marketNewsList, setMarketNewsList] = useState<MarketNews[]>([]);
  const [loading, setLoading] = useState(true);

  // New action form
  const [showNewAction, setShowNewAction] = useState(false);
  const [newActionType, setNewActionType] = useState("");
  const [newActionDesc, setNewActionDesc] = useState("");
  const [newActionDetails, setNewActionDetails] = useState<Record<string, string>>({});

  // Market news form
  const [showNewNews, setShowNewNews] = useState(false);
  const [newsNotes, setNewsNotes] = useState("");
  const [newsTags, setNewsTags] = useState<string[]>([]);

  const currentUser = getCurrentUser();

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const p = await pdvsApi.get(Number(id));
      setPdv(p);

      let vid = visitIdFromState;
      if (!vid) {
        const { visitsApi: vApi } = await import("@/lib/api/services");
        const openVisits = await vApi.list({ pdv_id: Number(id), status: "OPEN" });
        if (openVisits.length > 0) vid = openVisits[0].VisitId;
      }
      if (vid) {
        setVisitId(vid);
        const [acts, news] = await Promise.all([
          visitActionsApi.list(vid),
          marketNewsApi.list(vid),
        ]);
        setActions(acts);
        setMarketNewsList(news);
      }
    } catch {
      toast.error("Error al cargar datos");
    } finally {
      setLoading(false);
    }
  }, [id, visitIdFromState]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAddAction = async () => {
    if (!visitId || !newActionType) return;
    try {
      const action = await visitActionsApi.create(visitId, {
        ActionType: newActionType,
        Description: newActionDesc,
        DetailsJson: Object.keys(newActionDetails).length > 0 ? JSON.stringify(newActionDetails) : undefined,
      });
      setActions((prev) => [...prev, action]);
      setShowNewAction(false);
      setNewActionType("");
      setNewActionDesc("");
      setNewActionDetails({});
      toast.success("Acción agregada");
    } catch { toast.error("Error al agregar acción"); }
  };

  const handleDeleteAction = async (actionId: number) => {
    try {
      await visitActionsApi.delete(actionId);
      setActions((prev) => prev.filter((a) => a.VisitActionId !== actionId));
      toast.success("Acción eliminada");
    } catch { toast.error("Error al eliminar"); }
  };

  const handleMarkDone = async (actionId: number) => {
    try {
      const updated = await visitActionsApi.update(actionId, { Status: "DONE" });
      setActions((prev) => prev.map((a) => (a.VisitActionId === actionId ? updated : a)));
      toast.success("Acción completada");
    } catch { toast.error("Error al actualizar"); }
  };

  const handleMarkPhotoTaken = async (actionId: number) => {
    try {
      const updated = await visitActionsApi.update(actionId, { PhotoTaken: true });
      setActions((prev) => prev.map((a) => (a.VisitActionId === actionId ? updated : a)));
      toast.success("Foto marcada como tomada");
    } catch { toast.error("Error al actualizar"); }
  };

  const handleAddNews = async () => {
    if (!visitId || !newsNotes.trim()) return;
    try {
      const news = await marketNewsApi.create(visitId, {
        Tags: newsTags.join(","),
        Notes: newsNotes,
        CreatedBy: Number(currentUser.id),
      });
      setMarketNewsList((prev) => [...prev, news]);
      setShowNewNews(false);
      setNewsNotes("");
      setNewsTags([]);
      toast.success("Novedad registrada");
    } catch { toast.error("Error al registrar novedad"); }
  };

  const handleDeleteNews = async (newsId: number) => {
    try {
      await marketNewsApi.delete(newsId);
      setMarketNewsList((prev) => prev.filter((n) => n.MarketNewsId !== newsId));
    } catch { toast.error("Error al eliminar"); }
  };

  const handleContinue = () => {
    navigate(`/pos/${id}/summary`, {
      state: { routeDayId, visitId },
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Cargando...</p>
      </div>
    );
  }

  const actionTypeConfig = (type: string) => ACTION_TYPES.find((t) => t.value === type) || ACTION_TYPES[4];

  return (
    <div className="min-h-screen bg-background pb-40">
      {/* Header */}
      <div className="bg-card border-b border-border p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/pos/${id}/pop`, { state: { routeDayId, visitId } })}
            className="p-2 hover:bg-muted rounded-lg"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Acciones</h1>
            <p className="text-sm text-muted-foreground">{pdv?.Name}</p>
          </div>
          <VisitStepIndicator currentStep={4} />
          <div className="flex items-center gap-2 ml-2">
            {actions.filter((a) => a.IsMandatory).length > 0 && (
              <Badge className={
                actions.filter((a) => a.IsMandatory && a.Status !== "DONE").length === 0
                  ? "bg-green-100 text-green-800"
                  : "bg-amber-100 text-amber-800"
              }>
                {actions.filter((a) => a.IsMandatory && a.Status === "DONE").length}/
                {actions.filter((a) => a.IsMandatory).length} oblig.
              </Badge>
            )}
            <Badge variant="outline">{actions.length} total</Badge>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* ── MANDATORY ACTIONS ── */}
        {actions.filter((a) => a.IsMandatory).length > 0 && (
          <>
            <div className="flex items-center gap-2">
              <Star size={18} className="text-amber-500" />
              <h2 className="text-lg font-semibold text-foreground">Actividades Obligatorias</h2>
              <Badge variant="secondary" className="ml-auto">
                {actions.filter((a) => a.IsMandatory && a.Status === "DONE").length}/
                {actions.filter((a) => a.IsMandatory).length}
              </Badge>
            </div>

            {actions.filter((a) => a.IsMandatory).map((action) => {
              const cfg = actionTypeConfig(action.ActionType);
              const Icon = cfg.icon;
              const isBacklog = action.Description?.startsWith("[BACKLOG]");
              const isDone = action.Status === "DONE";

              return (
                <Card key={action.VisitActionId} className={`overflow-hidden border-l-4 ${isDone ? "border-l-green-500 opacity-75" : isBacklog ? "border-l-amber-500" : "border-l-espert-gold"}`}>
                  <CardContent className="p-0">
                    <div className="flex items-start gap-3 p-4">
                      <div className={`p-2 rounded-lg ${cfg.color}`}>
                        <Icon size={20} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-foreground">{cfg.label}</p>
                          <Badge className="bg-espert-gold/10 text-espert-gold text-[10px]">
                            <Star size={10} className="mr-0.5" /> Obligatoria
                          </Badge>
                          {isBacklog && (
                            <Badge className="bg-amber-100 text-amber-800 text-[10px]">
                              <AlertTriangle size={10} className="mr-0.5" /> Pendiente anterior
                            </Badge>
                          )}
                          {isDone && (
                            <Badge className="bg-green-100 text-green-800 text-[10px]">
                              <CheckCircle2 size={10} className="mr-0.5" /> Completada
                            </Badge>
                          )}
                        </div>
                        {action.Description && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {isBacklog ? action.Description.replace("[BACKLOG]", "").trim() : action.Description}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="border-t border-border px-4 py-2 flex items-center justify-between bg-background">
                      <div className="flex items-center gap-2">
                        {action.PhotoRequired && (
                          action.PhotoTaken ? (
                            <div className="flex items-center gap-1 text-green-600 text-sm">
                              <CheckCircle2 size={14} /> Foto
                            </div>
                          ) : (
                            <Button size="sm" variant="outline" className="text-amber-600 border-amber-200 h-7 text-xs" onClick={() => handleMarkPhotoTaken(action.VisitActionId)}>
                              <Camera size={12} className="mr-1" /> Marcar foto
                            </Button>
                          )
                        )}
                      </div>
                      {!isDone && (
                        <Button size="sm" className="bg-green-600 hover:bg-green-700 h-7 text-xs" onClick={() => handleMarkDone(action.VisitActionId)}>
                          <CheckCircle2 size={12} className="mr-1" /> Completar
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </>
        )}

        {/* ── EXECUTION ACTIONS (11a-11e) ── */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Acciones Adicionales</h2>
          <Button size="sm" onClick={() => setShowNewAction(true)}>
            <Plus size={16} className="mr-1" /> Agregar
          </Button>
        </div>

        {/* New action form */}
        {showNewAction && (
          <Card className="border-espert-gold bg-espert-gold/5">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="font-semibold">Nueva Acción</Label>
                <button onClick={() => setShowNewAction(false)} className="text-muted-foreground hover:text-muted-foreground">
                  <X size={18} />
                </button>
              </div>

              <Select value={newActionType} onValueChange={setNewActionType}>
                <SelectTrigger>
                  <SelectValue placeholder="Tipo de acción..." />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {newActionType && (
                <>
                  {/* Dynamic fields per action type */}
                  {newActionType === "cobertura" && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-sm">SKUs colocados</Label>
                        <Input placeholder="Ej: Marca X 20" value={newActionDetails.skus || ""} onChange={(e) => setNewActionDetails({ ...newActionDetails, skus: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-sm">Cantidad</Label>
                        <Input type="number" placeholder="0" value={newActionDetails.quantity || ""} onChange={(e) => setNewActionDetails({ ...newActionDetails, quantity: e.target.value })} />
                      </div>
                    </div>
                  )}
                  {newActionType === "pop" && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-sm">Tipo de material</Label>
                        <Select value={newActionDetails.materialType || ""} onValueChange={(v) => setNewActionDetails({ ...newActionDetails, materialType: v })}>
                          <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cigarrera">Cigarrera</SelectItem>
                            <SelectItem value="pantalla">Pantalla</SelectItem>
                            <SelectItem value="movil">Móvil</SelectItem>
                            <SelectItem value="stopper">Stopper</SelectItem>
                            <SelectItem value="afiche">Afiche</SelectItem>
                            <SelectItem value="otro">Otro</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-sm">Ubicación</Label>
                        <Input placeholder="Ej: Mostrador" value={newActionDetails.location || ""} onChange={(e) => setNewActionDetails({ ...newActionDetails, location: e.target.value })} />
                      </div>
                    </div>
                  )}
                  {newActionType === "canje_sueltos" && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-sm">Marcas canjeadas</Label>
                        <Input placeholder="Ej: Marca X" value={newActionDetails.brands || ""} onChange={(e) => setNewActionDetails({ ...newActionDetails, brands: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-sm">Cantidad</Label>
                        <Input type="number" placeholder="0" value={newActionDetails.quantity || ""} onChange={(e) => setNewActionDetails({ ...newActionDetails, quantity: e.target.value })} />
                      </div>
                    </div>
                  )}
                  {newActionType === "promo" && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-sm">Tipo de promo</Label>
                          <Input placeholder="Ej: 2x1" value={newActionDetails.promoType || ""} onChange={(e) => setNewActionDetails({ ...newActionDetails, promoType: e.target.value })} />
                        </div>
                        <div>
                          <Label className="text-sm">Marca</Label>
                          <Input placeholder="Ej: Marca X" value={newActionDetails.brand || ""} onChange={(e) => setNewActionDetails({ ...newActionDetails, brand: e.target.value })} />
                        </div>
                      </div>
                      <div>
                        <Label className="text-sm">Mecánica</Label>
                        <Input placeholder="Descripción de la mecánica" value={newActionDetails.mechanic || ""} onChange={(e) => setNewActionDetails({ ...newActionDetails, mechanic: e.target.value })} />
                      </div>
                    </div>
                  )}
                  {newActionType === "otra" && (
                    <div>
                      <Label className="text-sm">Categoría</Label>
                      <Input placeholder="Descripción libre" value={newActionDetails.category || ""} onChange={(e) => setNewActionDetails({ ...newActionDetails, category: e.target.value })} />
                    </div>
                  )}

                  <Textarea
                    placeholder="Descripción adicional (opcional)"
                    value={newActionDesc}
                    onChange={(e) => setNewActionDesc(e.target.value)}
                    className="min-h-[60px]"
                  />
                  <Button className="w-full" onClick={handleAddAction}>Agregar Acción</Button>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Actions list */}
        {actions.filter((a) => !a.IsMandatory).length === 0 && !showNewAction && (
          <Card className="border-dashed border-2">
            <CardContent className="p-6 text-center">
              <Package size={40} className="mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground text-sm">No hay acciones registradas aún</p>
              <p className="text-muted-foreground text-xs mt-1">Agregue las acciones ejecutadas en esta visita</p>
            </CardContent>
          </Card>
        )}

        {actions.filter((a) => !a.IsMandatory).map((action) => {
          const cfg = actionTypeConfig(action.ActionType);
          const Icon = cfg.icon;
          let details: Record<string, string> = {};
          try { if (action.DetailsJson) details = JSON.parse(action.DetailsJson); } catch { /* skip */ }

          return (
            <Card key={action.VisitActionId} className="overflow-hidden">
              <CardContent className="p-0">
                <div className="flex items-start gap-3 p-4">
                  <div className={`p-2 rounded-lg ${cfg.color}`}>
                    <Icon size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-foreground">{cfg.label}</p>
                      <button onClick={() => handleDeleteAction(action.VisitActionId)} className="text-muted-foreground hover:text-red-500">
                        <Trash2 size={16} />
                      </button>
                    </div>
                    {action.Description && <p className="text-sm text-muted-foreground mt-1">{action.Description}</p>}
                    {Object.entries(details).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {Object.entries(details).map(([k, v]) => (
                          <Badge key={k} variant="outline" className="text-xs">{k}: {v}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="border-t border-border px-4 py-2 flex items-center justify-between bg-background">
                  <div className="flex items-center gap-2">
                    {action.PhotoTaken ? (
                      <div className="flex items-center gap-1 text-green-600 text-sm">
                        <CheckCircle2 size={14} /> Foto
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" className="text-amber-600 border-amber-200 h-7 text-xs" onClick={() => handleMarkPhotoTaken(action.VisitActionId)}>
                        <Camera size={12} className="mr-1" /> Marcar foto
                      </Button>
                    )}
                  </div>
                  {action.Status !== "DONE" && (
                    <Button size="sm" className="bg-green-600 hover:bg-green-700 h-7 text-xs" onClick={() => handleMarkDone(action.VisitActionId)}>
                      <CheckCircle2 size={12} className="mr-1" /> Completar
                    </Button>
                  )}
                  {action.Status === "DONE" && (
                    <Badge className="bg-green-100 text-green-800 text-xs">
                      <CheckCircle2 size={12} className="mr-0.5" /> Completada
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* ── MARKET NEWS (Step 12) ── */}
        <div className="border-t border-border pt-4 mt-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-foreground">Novedades de Mercado</h2>
            <Button size="sm" variant="outline" onClick={() => setShowNewNews(true)}>
              <Newspaper size={16} className="mr-1" /> Agregar
            </Button>
          </div>

          {showNewNews && (
            <Card className="border-emerald-200 bg-emerald-50/50 mb-3">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="font-semibold">Nueva Novedad</Label>
                  <button onClick={() => setShowNewNews(false)} className="text-muted-foreground hover:text-muted-foreground">
                    <X size={18} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {MARKET_NEWS_TAGS.map((tag) => (
                    <button
                      key={tag}
                      onClick={() =>
                        setNewsTags((prev) =>
                          prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                        )
                      }
                      className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                        newsTags.includes(tag)
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "bg-card text-muted-foreground border-border hover:border-emerald-400"
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                <Textarea
                  placeholder="Descripción de la novedad..."
                  value={newsNotes}
                  onChange={(e) => setNewsNotes(e.target.value)}
                  className="min-h-[80px]"
                />
                <Button className="w-full" onClick={handleAddNews} disabled={!newsNotes.trim()}>
                  Registrar Novedad
                </Button>
              </CardContent>
            </Card>
          )}

          {marketNewsList.length === 0 && !showNewNews && (
            <Card className="border-dashed border-2">
              <CardContent className="p-4 text-center">
                <Newspaper size={32} className="mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground text-sm">Sin novedades registradas</p>
              </CardContent>
            </Card>
          )}

          {marketNewsList.map((news) => (
            <Card key={news.MarketNewsId} className="mb-2">
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    {news.Tags && (
                      <div className="flex flex-wrap gap-1 mb-1">
                        {news.Tags.split(",").filter(Boolean).map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                        ))}
                      </div>
                    )}
                    <p className="text-sm text-foreground">{news.Notes}</p>
                  </div>
                  <button onClick={() => handleDeleteNews(news.MarketNewsId)} className="text-muted-foreground hover:text-red-500 shrink-0">
                    <Trash2 size={14} />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="sticky bottom-0 bg-card border-t border-border p-3 pb-[env(safe-area-inset-bottom)]">
        <Button className="w-full h-11 text-sm font-semibold bg-[#A48242] hover:bg-[#8B6E38]" onClick={handleContinue}>
          <Camera className="mr-2" size={16} />
          Continuar a Resumen
        </Button>
      </div>
    </div>
  );
}
