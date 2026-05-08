import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import {
  ArrowLeft, ArrowRight, Plus, Camera, Trash2, CheckCircle2,
  ChevronRight, ChevronDown, Repeat, Megaphone, Tag, Dice5, MoreHorizontal,
  Pencil, Package, X, Sparkles, GraduationCap, ClipboardList, MessageSquareWarning, UserCheck,
} from "lucide-react";
import { pdvsApi, visitActionsApi, productsApi, visitPhotosApi } from "@/lib/api";
import type { VisitAction, Product } from "@/lib/api";
import { executeOrEnqueue, fetchWithCache } from "@/lib/offline";
import { useVisitStep } from "@/lib/useVisitAutoSave";
import { VisitStepIndicator } from "../components/VisitStepIndicator";
import { toast } from "sonner";

// ── Constants ──
const CATEGORIES = [
  { id: "canje_sueltos", label: "Canje de Sueltos", desc: "Recibir atados vacíos y entregar llenos", icon: Repeat, accent: "bg-green-50 text-green-700", requiresProgram: true },
  { id: "pop", label: "Colocación de Material POP", desc: "Cigarreras, displays y otros materiales", icon: Megaphone, accent: "bg-[#A48242]/10 text-[#A48242]" },
  { id: "promo", label: "Activación de Promociones", desc: "Prueba, rotación, volumen o escalerita", icon: Tag, accent: "bg-orange-50 text-orange-700" },
  { id: "juego", label: "Juegos Lúdicos", desc: "Ruleta, raspadita y activaciones", icon: Dice5, accent: "bg-amber-50 text-amber-700" },
  { id: "otra", label: "Otras Acciones", desc: "Capacitación, relevamiento, reclamos", icon: MoreHorizontal, accent: "bg-muted text-foreground" },
];

const POP_MATERIALS = {
  Primario: ["Cigarrera aérea", "Cigarrera de espalda", "Pantalla / Display", "Otro primario"],
  Secundario: ["Móvil / Colgante", "Stopper", "Escalerita", "Exhibidor", "Afiche", "Otro secundario"],
};
const COMPANIES = ["Espert", "Massalin", "BAT", "TABSA", "Otra"];
const PROMO_TABS = [
  { id: "prueba", label: "Prueba", desc: "Incentivar la prueba de un producto nuevo" },
  { id: "rotacion", label: "Rotación", desc: "Estimular la salida de un producto que no rota" },
  { id: "volumen", label: "Volumen", desc: "Oferta atada a volumen" },
  { id: "escalerita", label: "Escalerita", desc: "Ampliar cobertura con display" },
];
const GAME_TYPES = ["Ruleta", "Raspadita", "Otro"];
const GAME_PRIZES = ["Atado de cigarrillos", "Cartón (10 atados)", "Otro"];
const OTRA_CATEGORIES = ["Capacitación al PDV", "Relevamiento especial", "Reclamo del PDV", "Visita con supervisor", "Otro"];
const OTRA_ICONS: Record<string, React.ElementType> = {
  "Capacitación al PDV": GraduationCap, "Relevamiento especial": ClipboardList,
  "Reclamo del PDV": MessageSquareWarning, "Visita con supervisor": UserCheck, "Otro": MoreHorizontal,
};
const NEGOCIACION_TYPES = ["Quiosco nuevo", "Difícil penetración", "Extensión por desarrollo de marca"];
const BRAND_FAMILIES = ["Milenio", "Mill", "Melbourne", "Van Kiff", "Lebonn"];

export function VisitActionsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const locState = location.state as { routeDayId?: number; visitId?: number } | null;
  const recovered = useVisitStep(Number(id) || undefined, "actions", locState);
  const routeDayId = locState?.routeDayId ?? recovered.routeDayId;
  const visitIdFromState = locState?.visitId ?? recovered.visitId;

  const [pdv, setPdv] = useState<Awaited<ReturnType<typeof pdvsApi.get>> | null>(null);
  const [visitId, setVisitId] = useState<number | null>(visitIdFromState ?? null);
  const [actions, setActions] = useState<VisitAction[]>([]);
  const [ownProducts, setOwnProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeForm, setActiveForm] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoCallback, setPhotoCallback] = useState<((file: File) => void) | null>(null);

  // Form state (shared, reset per form)
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [formPhotos, setFormPhotos] = useState<{ url: string; file?: File }[]>([]);

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [p, products] = await Promise.all([
        fetchWithCache(`pdv_${id}`, () => pdvsApi.get(Number(id))),
        fetchWithCache("products_active", () => productsApi.list({ active_only: true })),
      ]);
      setPdv(p);
      setOwnProducts(products.filter((pr) => pr.IsOwn));

      let vid = visitIdFromState;
      if (!vid) {
        try {
          const { visitsApi: vApi } = await import("@/lib/api/services");
          const openVisits = await vApi.list({ pdv_id: Number(id), status: "OPEN" });
          if (openVisits.length > 0) vid = openVisits[0].VisitId;
        } catch { /* offline: visitId should come from state/recovery */ }
      }
      if (vid) {
        setVisitId(vid);
        try { setActions(await visitActionsApi.list(vid)); } catch { /* offline: start with empty actions */ }
      }
    } catch { toast.error("Error al cargar datos. Verificá tu conexión."); }
    finally { setLoading(false); }
  }, [id, visitIdFromState]);

  useEffect(() => { loadData(); }, [loadData]);

  const resetForm = () => { setFormData({}); setFormPhotos([]); setActiveForm(null); };

  const handleSaveAction = async (type: string, description: string, details: Record<string, unknown>) => {
    if (!visitId) return;
    const isOffline = !navigator.onLine;
    const hasPhotos = formPhotos.length > 0;
    // Photos required when online, optional when offline (will be uploaded later)
    if (!hasPhotos && !isOffline) { toast.error("Foto obligatoria"); return; }
    setSaving(true);
    try {
      const isTempVisit = visitId < 0;
      const actionBody = {
        ActionType: type,
        Description: description,
        DetailsJson: JSON.stringify(details),
        PhotoRequired: true,
        PhotoTaken: hasPhotos,
      };
      const result = await executeOrEnqueue({
        kind: "visit_action_create",
        method: "POST",
        url: `/visits/${visitId}/actions`,
        body: actionBody,
        label: `Acción: ${type}`,
        _tempVisitId: isTempVisit ? visitId : undefined,
      });
      // Queue photo uploads (compressed, deferred — don't block the user)
      if (hasPhotos) {
        const { compressImage } = await import("@/lib/imageCompression");
        const actionId = !result.queued && result.data ? (result.data as { VisitActionId?: number }).VisitActionId : Date.now();
        for (const photo of formPhotos) {
          if (photo.file) {
            try {
              const compressed = await compressImage(photo.file);
              await executeOrEnqueue({
                kind: "photo_upload",
                method: "POST",
                url: `/files/photos/visit/${visitId}`,
                formParts: [
                  { name: "file", value: compressed, filename: `action_${actionId}.jpg` },
                  { name: "photo_type", value: `action_${type}_${actionId}` },
                ],
                label: `Foto acción ${type}`,
                _tempVisitId: isTempVisit ? visitId : undefined,
              });
            } catch { /* queued for later */ }
          }
        }
      }
      // Add to local list
      if (!result.queued && result.data) {
        setActions((prev) => [...prev, result.data as VisitAction]);
      } else {
        setActions((prev) => [...prev, { ...actionBody, VisitActionId: -Date.now(), VisitId: visitId } as VisitAction]);
      }
      resetForm();
      toast.success(isOffline && !hasPhotos
        ? "Acción guardada (sin foto — recordá sacarla después)"
        : "Acción registrada");
    } catch { toast.error("Error al guardar acción"); }
    finally { setSaving(false); }
  };

  const handleDeleteAction = async (actionId: number) => {
    try {
      await visitActionsApi.delete(actionId);
      setActions((prev) => prev.filter((a) => a.VisitActionId !== actionId));
      toast.success("Acción eliminada");
    } catch { toast.error("Error al eliminar"); }
  };

  const takePhoto = () => {
    setPhotoCallback(() => (file: File) => {
      const url = URL.createObjectURL(file);
      setFormPhotos((prev) => [...prev, { url, file }]);
    });
    photoInputRef.current?.click();
  };

  const handlePhotoInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !photoCallback) return;
    photoCallback(file);
    setPhotoCallback(null);
  };

  const [showEmptyBrands, setShowEmptyBrands] = useState(false);
  const [showEntregadosBrands, setShowEntregadosBrands] = useState(false);
  const fd = (key: string) => formData[key] as string ?? "";
  const setFd = (key: string, val: unknown) => setFormData((p) => ({ ...p, [key]: val }));

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Cargando...</p></div>;
  }

  const totalPhotos = actions.filter((a) => a.PhotoTaken).length;

  // ── Sub-form renderers ──
  const renderPhotoSection = (label: string) => (
    <div className="space-y-2">
      <p className="text-[10px] font-bold text-[#A48242] uppercase tracking-wider flex items-center gap-1"><Camera size={10} /> {label}</p>
      {formPhotos.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {formPhotos.map((p, i) => (
            <div key={i} className="relative">
              <img src={p.url} alt="" className="w-16 h-16 rounded-lg object-cover border border-border" />
              <button onClick={() => setFormPhotos((prev) => prev.filter((_, j) => j !== i))} className="absolute -top-1 -right-1 p-0.5 bg-black/60 rounded-full"><X size={10} className="text-white" /></button>
            </div>
          ))}
        </div>
      )}
      <Button type="button" variant="outline" size="sm" onClick={takePhoto} className="w-full gap-1.5">
        <Camera size={14} /> {formPhotos.length === 0 ? "Tomar foto (obligatoria)" : "Agregar otra foto"}
      </Button>
    </div>
  );

  const renderProductSelect = (key: string, label: string) => (
    <div>
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">{label} *</p>
      <select value={fd(key)} onChange={(e) => setFd(key, e.target.value)} className="w-full h-10 px-3 border border-border rounded-lg text-sm bg-background">
        <option value="">Seleccionar...</option>
        {ownProducts.map((p) => <option key={p.ProductId} value={p.Name}>{p.Name}</option>)}
      </select>
    </div>
  );

  // ── CANJE DE SUELTOS ──
  const renderCanjeForm = () => {
    const cigaretteProducts = ownProducts.filter((p) => p.Category?.toLowerCase() === "cigarrillos");
    const modalidad = fd("modalidad") || "10+1";
    const divisor = modalidad === "5+1" ? 5 : 10;
    const step = divisor; // 5+1 suma de 5, 10+1 suma de 10
    const cantidades = (formData.cantidades as Record<string, number>) || {};
    const totalVacios = Object.values(cantidades).reduce((s, v) => s + v, 0);
    const llenos = Math.floor(totalVacios / divisor);
    const filledProducts = cigaretteProducts.filter((p) => (cantidades[p.Name] || 0) > 0);
    const emptyProducts = cigaretteProducts.filter((p) => !(cantidades[p.Name] || 0));

    // Atados a entregar (llenos) — por marca, de a 1
    const entregados = (formData.entregados as Record<string, number>) || {};
    const totalEntregados = Object.values(entregados).reduce((s, v) => s + v, 0);
    const filledEntregados = cigaretteProducts.filter((p) => (entregados[p.Name] || 0) > 0);
    const emptyEntregados = cigaretteProducts.filter((p) => !(entregados[p.Name] || 0));
    return (
      <div className="space-y-4">
        {/* Modalidad */}
        <div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Modalidad activa</p>
          <div className="flex rounded-lg border border-border overflow-hidden">
            {["5+1", "10+1"].map((m) => (
              <button key={m} onClick={() => setFd("modalidad", m)} className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${modalidad === m ? "bg-[#A48242] text-white" : "bg-background text-muted-foreground"}`}>{m}</button>
            ))}
          </div>
        </div>

        {/* Negociación */}
        <div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Tipo de negociación *</p>
          <select value={fd("negociacion")} onChange={(e) => setFd("negociacion", e.target.value)} className="w-full h-10 px-3 border border-border rounded-lg text-sm bg-background">
            <option value="">Seleccionar...</option>
            {NEGOCIACION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* Atados vacíos recibidos */}
        <div>
          <p className="text-[10px] font-bold text-[#A48242] uppercase tracking-wider mb-2 flex items-center gap-1"><Package size={10} /> Atados vacíos recibidos</p>
          {filledProducts.length > 0 && (
            <div className="space-y-1.5 mb-2">
              {filledProducts.map((p) => (
                <div key={p.ProductId} className="bg-background rounded-xl border-l-[3px] border-l-green-400 border border-border px-3 py-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{p.Name}</p>
                  </div>
                  <input type="number" inputMode="numeric" min={0} value={cantidades[p.Name] || ""} placeholder="0" onChange={(e) => setFd("cantidades", { ...cantidades, [p.Name]: Math.max(0, Number(e.target.value) || 0) })} className="w-20 text-center text-sm font-bold border border-border rounded-lg h-9 bg-background" />
                </div>
              ))}
            </div>
          )}
          <button onClick={() => setShowEmptyBrands(!showEmptyBrands)} className="w-full bg-background rounded-xl border border-border px-3 py-2.5 text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            <ChevronDown size={12} className={showEmptyBrands ? "rotate-180" : ""} /> {showEmptyBrands ? "Ocultar" : "Ver"} otras marcas ({emptyProducts.length})
          </button>
          {showEmptyBrands && (
            <div className="mt-1.5 space-y-1 bg-background rounded-xl border border-border divide-y divide-border overflow-hidden">
              {emptyProducts.map((p) => (
                <div key={p.ProductId} className="px-3 py-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground truncate">{p.Name}</span>
                  <button onClick={() => setFd("cantidades", { ...cantidades, [p.Name]: step })} className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center"><Plus size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cálculo automático */}
        {totalVacios > 0 && (
          <div className="rounded-2xl bg-black text-white p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#C9A962] mb-2">Cálculo automático</p>
            <div className="flex items-center justify-between">
              <div><p className="text-[11px] text-white/60">Vacíos recibidos</p><p className="text-xl font-bold">{totalVacios} <span className="text-xs text-white/60">atados</span></p></div>
              <ArrowRight size={18} className="text-[#C9A962]" />
              <div><p className="text-[11px] text-white/60">Llenos a entregar</p><p className="text-xl font-bold text-[#C9A962]">{llenos} <span className="text-xs text-white/60">atados</span></p></div>
            </div>
            <p className="text-[10px] text-white/50 mt-2 pt-2 border-t border-white/10">Modalidad {modalidad} · cada {divisor} vacíos = 1 lleno</p>
            {totalEntregados > 0 && totalEntregados !== llenos && (
              <p className={`text-[10px] mt-1 font-semibold ${totalEntregados > llenos ? "text-red-400" : "text-amber-400"}`}>
                {totalEntregados > llenos ? `Excedido: seleccionaste ${totalEntregados} pero corresponden ${llenos}` : `Faltan ${llenos - totalEntregados} atado(s) por asignar`}
              </p>
            )}
          </div>
        )}

        {/* Atados a entregar (llenos) — de a 1, combinando marcas */}
        {llenos > 0 && (
          <div>
            <p className="text-[10px] font-bold text-[#C9A962] uppercase tracking-wider mb-2 flex items-center gap-1"><Package size={10} /> Atados llenos a entregar ({totalEntregados}/{llenos})</p>
            {filledEntregados.length > 0 && (
              <div className="space-y-1.5 mb-2">
                {filledEntregados.map((p) => (
                  <div key={p.ProductId} className="bg-background rounded-xl border-l-[3px] border-l-[#C9A962] border border-border px-3 py-2.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{p.Name}</p>
                    </div>
                    <input type="number" inputMode="numeric" min={0} max={llenos} value={entregados[p.Name] || ""} placeholder="0" onChange={(e) => { const v = Math.max(0, Number(e.target.value) || 0); const others = totalEntregados - (entregados[p.Name] || 0); setFd("entregados", { ...entregados, [p.Name]: Math.min(v, llenos - others) }); }} className="w-20 text-center text-sm font-bold border border-border rounded-lg h-9 bg-background" />
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setShowEntregadosBrands(!showEntregadosBrands)} className="w-full bg-background rounded-xl border border-border px-3 py-2.5 text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <ChevronDown size={12} className={showEntregadosBrands ? "rotate-180" : ""} /> {showEntregadosBrands ? "Ocultar" : "Ver"} marcas disponibles ({emptyEntregados.length})
            </button>
            {showEntregadosBrands && (
              <div className="mt-1.5 space-y-1 bg-background rounded-xl border border-border divide-y divide-border overflow-hidden">
                {emptyEntregados.map((p) => (
                  <div key={p.ProductId} className="px-3 py-2 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground truncate">{p.Name}</span>
                    <button
                      onClick={() => {
                        if (totalEntregados >= llenos) return;
                        setFd("entregados", { ...entregados, [p.Name]: 1 });
                      }}
                      disabled={totalEntregados >= llenos}
                      className={`w-7 h-7 rounded-lg flex items-center justify-center ${totalEntregados >= llenos ? "bg-muted text-muted-foreground" : "bg-muted"}`}
                    ><Plus size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {renderPhotoSection("Foto de evidencia")}
      </div>
    );
  };

  // ── COLOCACIÓN POP ──
  const renderPOPForm = () => {
    const tipo = fd("tipo") || "Primario";
    const materials = POP_MATERIALS[tipo as keyof typeof POP_MATERIALS] || [];
    const selectedCompanies = (formData.companies as string[]) || [];

    return (
      <div className="space-y-4">
        <div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Tipo de material</p>
          <div className="flex rounded-lg border border-border overflow-hidden">
            {["Primario", "Secundario"].map((t) => (
              <button key={t} onClick={() => setFd("tipo", t)} className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${tipo === t ? "bg-[#A48242] text-white" : "bg-background text-muted-foreground"}`}>{t}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Material específico</p>
          <div className="space-y-1.5">
            {materials.map((m) => (
              <button key={m} onClick={() => setFd("material", m)} className={`w-full bg-background rounded-xl border px-3.5 py-3 flex items-center justify-between ${fd("material") === m ? "border-[#A48242] ring-1 ring-[#A48242]/20" : "border-border"}`}>
                <span className={`text-sm ${fd("material") === m ? "font-bold text-foreground" : "text-muted-foreground"}`}>{m}</span>
                {fd("material") === m && <CheckCircle2 size={16} className="text-[#A48242]" />}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Ubicación en el PDV</p>
          <Input value={fd("ubicacion")} onChange={(e) => setFd("ubicacion", e.target.value)} placeholder="Ej: Mostrador principal, Ventana lateral" />
        </div>
        {renderPhotoSection("Foto del material colocado")}
      </div>
    );
  };

  // ── PROMOCIONES ──
  const renderPromoForm = () => {
    const tab = fd("promoType") || "prueba";
    return (
      <div className="space-y-4">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {PROMO_TABS.map((t) => (
            <button key={t.id} onClick={() => setFd("promoType", t.id)} className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${tab === t.id ? "bg-black text-white" : "bg-muted text-muted-foreground"}`}>{t.label}</button>
          ))}
        </div>
        <div className="rounded-xl bg-[#A48242]/10 border border-[#A48242]/20 px-3 py-2.5">
          <p className="text-xs font-bold text-[#A48242]">{PROMO_TABS.find((t) => t.id === tab)?.label}</p>
          <p className="text-[11px] text-[#A48242]/80 mt-0.5">{PROMO_TABS.find((t) => t.id === tab)?.desc}</p>
        </div>

        {renderProductSelect("producto", "Producto")}

        {tab === "prueba" && (
          <div><p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Regalo / complemento</p><Input value={fd("regalo")} onChange={(e) => setFd("regalo", e.target.value)} placeholder="Ej: encendedor, cenicero" /></div>
        )}
        {tab === "rotacion" && (
          <div><p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Recurso utilizado</p><Input value={fd("recurso")} onChange={(e) => setFd("recurso", e.target.value)} placeholder="Ej: encendedores" /></div>
        )}
        {tab === "volumen" && (
          <>
            <div><p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Mecánica</p><textarea value={fd("mecanica")} onChange={(e) => setFd("mecanica", e.target.value)} placeholder="Ej: 2 Milenio al precio de 1" rows={2} className="w-full px-3 py-2 border border-border rounded-lg text-sm resize-none" /></div>
            <div><p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Premio incluido</p><Input value={fd("premio")} onChange={(e) => setFd("premio", e.target.value)} placeholder="Ej: gorra, encendedor" /></div>
          </>
        )}
        {tab === "escalerita" && (
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Marca</p>
            <div className="flex flex-wrap gap-1.5">
              {BRAND_FAMILIES.map((b) => (
                <button key={b} onClick={() => setFd("marca", b)} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${fd("marca") === b ? "bg-[#A48242]/15 text-[#A48242] ring-1 ring-[#A48242]/40" : "bg-muted text-muted-foreground"}`}>{b}</button>
              ))}
            </div>
          </div>
        )}
        <div><p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Cantidad utilizada</p><Input type="number" value={fd("cantidad")} onChange={(e) => setFd("cantidad", e.target.value)} placeholder="0" /></div>
        {renderPhotoSection("Foto de la promoción")}
      </div>
    );
  };

  // ── JUEGOS ──
  const renderJuegoForm = () => (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Tipo de juego</p>
        <div className="grid grid-cols-3 gap-1.5">
          {GAME_TYPES.map((g) => {
            const sel = fd("tipoJuego") === g;
            const Icon = g === "Ruleta" ? Dice5 : g === "Raspadita" ? Tag : MoreHorizontal;
            return (
              <button key={g} onClick={() => setFd("tipoJuego", g)} className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border ${sel ? "bg-[#A48242]/10 border-[#A48242] ring-1 ring-[#A48242]/30" : "bg-background border-border"}`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${sel ? "bg-[#A48242] text-white" : "bg-muted text-muted-foreground"}`}><Icon size={16} /></div>
                <span className={`text-[11px] font-semibold ${sel ? "text-[#A48242]" : "text-muted-foreground"}`}>{g}</span>
              </button>
            );
          })}
        </div>
        {fd("tipoJuego") === "Otro" && <Input value={fd("tipoJuegoOtro")} onChange={(e) => setFd("tipoJuegoOtro", e.target.value)} placeholder="Describir juego..." className="mt-2" />}
      </div>
      <div>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Premio entregado</p>
        <div className="space-y-1.5">
          {GAME_PRIZES.map((p) => (
            <button key={p} onClick={() => setFd("premio", p)} className={`w-full bg-background rounded-xl border px-3.5 py-3 flex items-center justify-between ${fd("premio") === p ? "border-[#A48242] ring-1 ring-[#A48242]/20" : "border-border"}`}>
              <span className={`text-sm ${fd("premio") === p ? "font-bold text-foreground" : "text-muted-foreground"}`}>{p}</span>
              {fd("premio") === p && <CheckCircle2 size={16} className="text-[#A48242]" />}
            </button>
          ))}
        </div>
        {fd("premio") === "Otro" && <Input value={fd("premioOtro")} onChange={(e) => setFd("premioOtro", e.target.value)} placeholder="Describir premio..." className="mt-2" />}
      </div>
      <div><p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Cantidad de premios</p><Input type="number" value={fd("cantidad")} onChange={(e) => setFd("cantidad", e.target.value)} placeholder="0" /></div>
      {renderProductSelect("marcaPremio", "Marca del premio")}
      {renderPhotoSection("Foto de la activación")}
    </div>
  );

  // ── OTRAS ──
  const renderOtraForm = () => (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Categoría</p>
        <div className="space-y-1.5">
          {OTRA_CATEGORIES.map((c) => {
            const sel = fd("categoria") === c;
            const Icon = OTRA_ICONS[c] || MoreHorizontal;
            return (
              <button key={c} onClick={() => setFd("categoria", c)} className={`w-full bg-background rounded-xl border px-3.5 py-3 flex items-center gap-2.5 ${sel ? "border-[#A48242] ring-1 ring-[#A48242]/20" : "border-border"}`}>
                <div className={`w-7 h-7 rounded-md flex items-center justify-center ${sel ? "bg-[#A48242] text-white" : "bg-muted text-muted-foreground"}`}><Icon size={14} /></div>
                <span className={`text-sm ${sel ? "font-bold text-foreground" : "text-muted-foreground"}`}>{c}</span>
                {sel && <CheckCircle2 size={16} className="text-[#A48242] ml-auto" />}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Descripción *</p>
        <textarea value={fd("descripcion")} onChange={(e) => setFd("descripcion", e.target.value)} rows={4} placeholder="Describí la acción realizada..." className="w-full px-3 py-2 border border-border rounded-lg text-sm resize-none" />
      </div>
      {renderPhotoSection("Foto de evidencia")}
    </div>
  );

  // ── Save handler per type ──
  const handleSave = () => {
    if (!activeForm) return;
    const type = activeForm;
    let desc = "";
    const details = { ...formData };

    if (type === "canje_sueltos") {
      const cant = (formData.cantidades as Record<string, number>) || {};
      const total = Object.values(cant).reduce((s, v) => s + v, 0);
      desc = `Canje ${fd("modalidad") || "5+1"} · ${total} vacíos · ${fd("marcaEntregada")}`;
    } else if (type === "pop") {
      desc = `${fd("material")} · ${((formData.companies as string[]) || []).join(", ")} · ${fd("ubicacion")}`;
    } else if (type === "promo") {
      desc = `${PROMO_TABS.find((t) => t.id === fd("promoType"))?.label || "Promo"} · ${fd("producto")}`;
    } else if (type === "juego") {
      desc = `${fd("tipoJuego")} · ${fd("premio")} · ${fd("cantidad")} unid.`;
    } else if (type === "otra") {
      desc = `${fd("categoria")} · ${(fd("descripcion") || "").slice(0, 60)}`;
    }

    handleSaveAction(type, desc, details);
  };

  // ── MAIN RENDER ──
  if (activeForm) {
    const cat = CATEGORIES.find((c) => c.id === activeForm);
    return (
      <div className="min-h-screen bg-background pb-24">
        <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoInput} />
        <div className="bg-card border-b border-border p-4 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <button onClick={resetForm} className="p-2 hover:bg-muted rounded-lg"><ArrowLeft size={24} /></button>
            <div className="flex-1">
              <h1 className="text-lg font-bold text-foreground">{cat?.label}</h1>
              <p className="text-xs text-muted-foreground">{cat?.desc}</p>
            </div>
            <VisitStepIndicator currentStep={4} />
          </div>
        </div>
        <div className="p-4">
          {activeForm === "canje_sueltos" && renderCanjeForm()}
          {activeForm === "pop" && renderPOPForm()}
          {activeForm === "promo" && renderPromoForm()}
          {activeForm === "juego" && renderJuegoForm()}
          {activeForm === "otra" && renderOtraForm()}
        </div>
        <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border p-3 pb-[env(safe-area-inset-bottom)] z-20">
          <Button onClick={handleSave} disabled={saving || formPhotos.length === 0} className={`w-full h-11 font-semibold ${formPhotos.length === 0 ? "bg-muted text-muted-foreground" : "bg-[#A48242] hover:bg-[#8B6E38] text-white"}`}>
            {saving ? "Guardando..." : formPhotos.length === 0 ? "Foto obligatoria" : "Guardar acción"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoInput} />
      {/* Header */}
      <div className="bg-card border-b border-border p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/pos/${id}/pop`, { state: { routeDayId, visitId } })} className="p-2 hover:bg-muted rounded-lg"><ArrowLeft size={24} /></button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-foreground">Acciones de Ejecución</h1>
            <p className="text-xs text-muted-foreground">{pdv?.Name}</p>
          </div>
          <VisitStepIndicator currentStep={4} />
        </div>
      </div>

      {/* Stats */}
      <div className="px-4 py-3 bg-card border-b border-border">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-muted px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ejecutadas</p>
            <p className="text-xl font-bold text-foreground">{actions.length}</p>
          </div>
          <div className="rounded-xl bg-[#A48242]/10 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#A48242]">Fotos</p>
            <p className="text-xl font-bold text-[#A48242]">{totalPhotos} <span className="text-[10px] font-semibold">subidas</span></p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Categories */}
        <p className="text-[10px] font-bold text-[#A48242] uppercase tracking-wider flex items-center gap-1"><Package size={10} /> Tipo de acción</p>
        {CATEGORIES.map((cat) => {
          const count = actions.filter((a) => a.ActionType === cat.id).length;
          const Icon = cat.icon;
          return (
            <button key={cat.id} onClick={() => { setFormData({}); setFormPhotos([]); setActiveForm(cat.id); }} className="w-full bg-card rounded-2xl border border-border p-3.5 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors">
              <div className={`w-11 h-11 rounded-xl ${cat.accent} flex items-center justify-center shrink-0`}><Icon size={22} /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-bold text-foreground">{cat.label}</p>
                  {count > 0 && <Badge className="bg-green-100 text-green-700 text-[10px] px-1.5 py-0">{count}</Badge>}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{cat.desc}</p>
              </div>
              <ChevronRight size={18} className="text-muted-foreground shrink-0" />
            </button>
          );
        })}

        {/* Executed actions */}
        {actions.length > 0 && (
          <div className="pt-3">
            <p className="text-[10px] font-bold text-[#A48242] uppercase tracking-wider flex items-center gap-1 mb-2"><CheckCircle2 size={10} /> Acciones realizadas ({actions.length})</p>
            <div className="space-y-2">
              {actions.map((a) => {
                const cat = CATEGORIES.find((c) => c.id === a.ActionType);
                const Icon = cat?.icon || MoreHorizontal;
                let details: Record<string, unknown> = {};
                try { details = a.DetailsJson ? JSON.parse(a.DetailsJson) : {}; } catch {}
                return (
                  <Card key={a.VisitActionId} className="overflow-hidden">
                    <CardContent className="p-0">
                      <div className="flex items-stretch">
                        <div className={`w-[70px] shrink-0 flex items-center justify-center ${cat?.accent || "bg-muted"}`}>
                          <Icon size={24} />
                        </div>
                        <div className="flex-1 min-w-0 p-3">
                          <div className="flex items-center gap-1.5">
                            <Badge variant="secondary" className="text-[9px]">{cat?.label || a.ActionType}</Badge>
                          </div>
                          <p className="text-xs font-semibold text-foreground mt-1 truncate">{a.Description || "Sin descripción"}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <button onClick={() => handleDeleteAction(a.VisitActionId)} className="text-[11px] font-semibold text-red-600 flex items-center gap-1"><Trash2 size={11} /> Eliminar</button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border p-3 pb-[env(safe-area-inset-bottom)] z-20">
        <Button onClick={() => navigate(`/pos/${id}/market-news`, { state: { routeDayId, visitId } })} className="w-full h-11 bg-[#A48242] hover:bg-[#8B6E38] text-white font-semibold">
          Continuar a Novedades <ArrowRight size={16} className="ml-2" />
        </Button>
        <p className="text-[10px] text-muted-foreground text-center mt-1">{actions.length} acciones registradas en esta visita</p>
      </div>
    </div>
  );
}
