import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Switch } from "../components/ui/switch";
import {
  ArrowLeft,
  ArrowRight,
  LayoutGrid,
  Camera,
  X,
  ImageIcon,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { visitPOPApi, visitPhotosApi, ApiError } from "@/lib/api";
import { executeOrEnqueue, fetchWithCache } from "@/lib/offline";
import { useVisitStep, useAutoSaveDraft, getDraft } from "@/lib/useVisitAutoSave";
import { useVisitFlow } from "@/lib/VisitFlowContext";
import { usePhotoSource } from "@/lib/photoSource";
import { VisitStepIndicator } from "../components/VisitStepIndicator";
import { PopMaterialPicker } from "../components/PopMaterialPicker";
import {
  COMPETITOR_COMPANIES,
  GENERIC_POP_MATERIALS,
  buildCensusPayload,
  buildCensusState,
  espertItemFromMaterial,
  espertKey,
  espertPhotoKey,
  overlayCensusDraft,
  popPhotoKey,
  usePopMaterials,
  type CensusState,
  type CompetitorRow,
  type EspertItem,
} from "@/lib/popMaterials";

interface PhotoEntry {
  url: string;
  fileId?: number; // if uploaded to server
}

export function POPCensusPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const locState = (location.state as { routeDayId?: number; visitId?: number }) || {};
  const recovered = useVisitStep(Number(id) || undefined, "pop", locState);
  const flow = useVisitFlow();
  const routeDayId = locState.routeDayId ?? recovered.routeDayId;
  const visitId = locState.visitId ?? recovered.visitId ?? flow.visitId;

  // rows = lista genérica de competencia; espert = piezas Espert (catálogo MKT o "sin código")
  const [census, setCensus] = useState<CensusState>({ rows: [], espert: [] });
  const rows = census.rows;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { materials, loading: materialsLoading } = usePopMaterials();
  const materialByCode = new Map(materials.map((m) => [m.Code, m]));
  // Photos keyed by "pop_{material|code}_{company}" — supports multiple per key
  const [popPhotos, setPopPhotos] = useState<Record<string, PhotoEntry[]>>({});
  const [activePhotoKey, setActivePhotoKey] = useState<string | null>(null);
  const popPhotoInputRef = useRef<HTMLInputElement>(null);
  const { openSheet: openPopPhotoSheet, sheet: popPhotoSheet } = usePhotoSource(popPhotoInputRef);

  useEffect(() => {
    if (!visitId) { setLoading(false); return; }

    Promise.all([
      fetchWithCache(`visit_pop_${visitId}`, () => visitPOPApi.list(visitId)).catch(() => []),
      fetchWithCache(`visit_photos_${visitId}`, () => visitPhotosApi.list(visitId)).catch(() => []),
    ]).then(([existing, photos]) => {
      // Lista genérica completa + piezas Espert guardadas (censos viejos sin
      // MaterialCode se parten: la parte Espert pasa a pieza "sin código").
      const base = buildCensusState(existing);
      // Overlay any unsaved local draft (e.g. user marked materials then
      // navigated away with the back arrow / step indicator without pressing
      // "Continuar"). The draft is at least as fresh as the backend data.
      setCensus(overlayCensusDraft(base, getDraft<unknown>(visitId, "pop")));

      // Load existing photos (grouped by PhotoType)
      const photoMap: Record<string, PhotoEntry[]> = {};
      for (const p of photos) {
        if (p.PhotoType?.startsWith("pop_")) {
          if (!photoMap[p.PhotoType]) photoMap[p.PhotoType] = [];
          photoMap[p.PhotoType].push({ url: p.url, fileId: p.FileId });
        }
      }
      setPopPhotos(photoMap);

      setLoading(false);
    }).catch(() => {
      setLoading(false);
      toast.error("Error al cargar censo POP");
    });
  }, [visitId]);

  // Persist every change to a local draft so nothing is lost when the user
  // leaves this step by ANY route (back arrow, step indicator, hardware back,
  // refresh). Gated on `!loading` so the empty initial state can't clobber it.
  useAutoSaveDraft(visitId, "pop", census, !loading);

  const updateRow = (idx: number, field: keyof CompetitorRow, value: string | boolean | null | string[]) => {
    setCensus((prev) => ({ ...prev, rows: prev.rows.map((r, i) => i === idx ? { ...r, [field]: value } : r) }));
  };

  const addEspert = (item: EspertItem) => {
    if (census.espert.some((e) => espertKey(e) === espertKey(item))) {
      toast.info("Ese material ya está cargado");
      return;
    }
    setCensus((prev) => ({ ...prev, espert: [...prev.espert, item] }));
    setPickerOpen(false);
  };

  const updateEspert = (key: string, patch: Partial<EspertItem>) => {
    setCensus((prev) => ({ ...prev, espert: prev.espert.map((e) => espertKey(e) === key ? { ...e, ...patch } : e) }));
  };

  const removeEspert = (key: string) => {
    setCensus((prev) => ({ ...prev, espert: prev.espert.filter((e) => espertKey(e) !== key) }));
  };

  // Persist marks to the backend (offline-tolerant). Returns true on success.
  const persist = async (silent = false): Promise<boolean> => {
    if (!visitId) return false;
    const items = buildCensusPayload(census);
    if (items.length > 50) {
      if (!silent) toast.error("Máximo 50 materiales por censo");
      return false;
    }
    setSaving(true);
    try {
      const isTempVisit = visitId < 0;
      await executeOrEnqueue({
        kind: "visit_pop",
        method: "PUT",
        url: `/visits/${visitId}/pop`,
        body: { items },
        label: "Censo POP",
        _tempVisitId: isTempVisit ? visitId : undefined,
      });
      if (!silent) toast.success("Censo POP guardado");
      return true;
    } catch (err) {
      if (!silent) toast.error(err instanceof ApiError ? err.message : "Error al guardar");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    await persist();
    navigate(`/pos/${id}/suppliers`, { state: { routeDayId, visitId } });
  };

  const handleBack = async () => {
    await persist(true);
    navigate(`/pos/${id}/coverage`, { state: { routeDayId, visitId } });
  };

  const handlePopPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file || !activePhotoKey) return;
      if (!file.type.startsWith("image/")) return;
      const localUrl = URL.createObjectURL(file);
      const key = activePhotoKey;
      // Optimistic preview
      setPopPhotos((prev) => ({
        ...prev,
        [key]: [...(prev[key] || []), { url: localUrl }],
      }));
      // Queue upload (compressed, offline-tolerant)
      if (visitId) {
        try {
          const { compressImage } = await import("@/lib/imageCompression");
          const compressed = await compressImage(file);
          const isTempVisit = visitId < 0;
          const result = await executeOrEnqueue({
            kind: "photo_upload",
            method: "POST",
            url: `/files/photos/visit/${visitId}`,
            formParts: [
              { name: "file", value: compressed, filename: `pop_${Date.now()}.jpg` },
              { name: "photo_type", value: key },
            ],
            label: `Foto POP ${key}`,
            _tempVisitId: isTempVisit ? visitId : undefined,
          });
          if (!result.queued && result.data) {
            const uploaded = result.data as { FileId?: number };
            setPopPhotos((prev) => ({
              ...prev,
              [key]: (prev[key] || []).map((p) =>
                p.url === localUrl ? { ...p, fileId: uploaded.FileId } : p
              ),
            }));
          }
        } catch { /* local preview stays, upload queued */ }
      }
      setActivePhotoKey(null);
    } catch (err) {
      // Never crash the app on photo errors
      console.warn("[POPCensus] photo capture error:", err);
      setActivePhotoKey(null);
    }
  };

  const handleDeletePhoto = async (key: string, photoIdx: number) => {
    const photo = popPhotos[key]?.[photoIdx];
    if (!photo) return;
    // Remove from local state
    setPopPhotos((prev) => ({
      ...prev,
      [key]: (prev[key] || []).filter((_, i) => i !== photoIdx),
    }));
    // Delete from server
    if (visitId && photo.fileId) {
      try {
        await visitPhotosApi.delete(visitId, photo.fileId);
      } catch { /* already removed locally */ }
    }
  };

  const espert = census.espert;
  const competitorPresent = rows.filter((r) => r.Present).length;
  const presentCount = competitorPresent + espert.length;
  const primaryPresent = rows.filter((r) => r.Present && r.MaterialType === "primario").length
    + espert.filter((e) => e.MaterialType === "primario").length;
  const secondaryPresent = presentCount - primaryPresent;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Cargando materiales...</div>
      </div>
    );
  }

  /** Bloque de fotos para una clave pop_{material}_{empresa}. */
  const renderPhotoBlock = (key: string, label: string, alt: string) => {
    const photos = popPhotos[key] || [];
    return (
      <div className="p-2 bg-muted/50 rounded-lg">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-foreground">{label}</span>
          <button
            onClick={() => { setActivePhotoKey(key); openPopPhotoSheet(); }}
            aria-label={`Sacar foto del material POP de ${label}`}
            className="flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-border text-[10px] text-muted-foreground hover:bg-background transition-colors"
          >
            <Camera size={12} />
            Foto
          </button>
        </div>
        {photos.length > 0 ? (
          <div className="flex gap-1.5 flex-wrap">
            {photos.map((photo, pIdx) => (
              <div key={pIdx} className="relative">
                <img src={photo.url} alt={alt} className="w-14 h-14 rounded-md object-cover border border-border" />
                <button
                  onClick={() => {
                    if (!window.confirm("¿Borrar esta foto?")) return;
                    handleDeletePhoto(key, pIdx);
                  }}
                  aria-label="Borrar foto"
                  className="absolute -top-1 -right-1 p-1 bg-black/70 active:bg-black/90 rounded-full"
                >
                  <X size={12} className="text-white" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <ImageIcon size={10} /> Sin foto — capturá el material POP
          </p>
        )}
      </div>
    );
  };

  const renderHasPrice = (value: boolean | null, onChange: (v: boolean) => void) => (
    <div className="flex gap-1.5">
      <button
        onClick={() => onChange(true)}
        className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
          value === true ? "bg-green-100 text-green-800 ring-1 ring-green-300" : "bg-muted text-muted-foreground"
        }`}
      >
        Con precio
      </button>
      <button
        onClick={() => onChange(false)}
        className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
          value === false ? "bg-amber-100 text-amber-800 ring-1 ring-amber-300" : "bg-muted text-muted-foreground"
        }`}
      >
        Sin precio
      </button>
    </div>
  );

  const renderEspertCard = (item: EspertItem) => {
    const key = espertKey(item);
    const mat = item.MaterialCode ? materialByCode.get(item.MaterialCode) : undefined;
    return (
      <Card key={key} className="overflow-hidden border-l-4 border-l-[#A48242]">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-start gap-2.5">
            {mat?.PhotoUrl ? (
              <img src={mat.PhotoUrl} alt="" loading="lazy" className="w-11 h-11 rounded-lg object-cover border border-border bg-muted shrink-0"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            ) : null}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground leading-tight">{item.MaterialName}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {item.MaterialCode ?? "Sin código"} ·{" "}
                {item.MaterialCode ? (
                  item.MaterialType === "primario" ? "Primario" : "Secundario"
                ) : (
                  // Pieza sin código: el trade elige si es primario o secundario
                  <button
                    type="button"
                    onClick={() => updateEspert(key, { MaterialType: item.MaterialType === "primario" ? "secundario" : "primario" })}
                    className="underline decoration-dotted"
                  >
                    {item.MaterialType === "primario" ? "Primario" : "Secundario"} (cambiar)
                  </button>
                )}
              </p>
            </div>
            <button
              onClick={() => removeEspert(key)}
              aria-label={`Quitar ${item.MaterialName}`}
              className="p-1.5 text-muted-foreground hover:text-red-500"
            >
              <Trash2 size={15} />
            </button>
          </div>
          {renderPhotoBlock(espertPhotoKey(item), "Espert", item.MaterialName)}
          {renderHasPrice(item.HasPrice, (v) => updateEspert(key, { HasPrice: v }))}
        </CardContent>
      </Card>
    );
  };

  const renderMaterialCard = (row: CompetitorRow, borderColor: string) => {
    const idx = rows.indexOf(row);
    return (
      <Card key={row.MaterialName} className={`overflow-hidden ${row.Present ? `border-l-4 ${borderColor}` : ""}`}>
        <CardContent className="p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">{row.MaterialName}</span>
            <Switch
              checked={row.Present}
              onCheckedChange={(v) => updateRow(idx, "Present", v)}
            />
          </div>

          {row.Present && (
            <div className="mt-2.5 pt-2.5 border-t border-border space-y-2">
              {/* Empresas de la competencia — Espert se carga por catálogo arriba */}
              <div className="flex gap-1.5 flex-wrap">
                {COMPETITOR_COMPANIES.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      const has = row.Companies.includes(c);
                      const next = has ? row.Companies.filter((x) => x !== c) : [...row.Companies, c];
                      updateRow(idx, "Companies", next);
                    }}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                      row.Companies.includes(c)
                        ? "bg-[#A48242]/15 text-[#A48242] ring-1 ring-[#A48242]/40"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>

              {/* Photo per company */}
              {row.Companies.length > 0 && (
                <div className="space-y-2">
                  {row.Companies.map((company) => (
                    <div key={company}>
                      {renderPhotoBlock(popPhotoKey(row.MaterialName, company), company, `${row.MaterialName} ${company}`)}
                    </div>
                  ))}
                </div>
              )}

              {renderHasPrice(row.HasPrice, (v) => updateRow(idx, "HasPrice", v))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Hidden photo input — el origen (cámara/galería) lo decide el selector */}
      <input
        ref={popPhotoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePopPhoto}
      />
      {popPhotoSheet}
      <PopMaterialPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        materials={materials}
        loading={materialsLoading}
        selectedCodes={espert.map((e) => e.MaterialCode).filter((c): c is string => !!c)}
        onSelect={(m) => addEspert(espertItemFromMaterial(m))}
        otherLabel="Otro material Espert (viejo / sin código)"
        onOther={(name) => addEspert({ MaterialCode: null, MaterialName: name, MaterialType: "secundario", HasPrice: null })}
        title="Material Espert presente"
      />

      {/* Header */}
      <div className="bg-card border-b border-border p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-foreground">Censo de Materiales POP</h1>
            <p className="text-xs text-muted-foreground">
              {presentCount} presentes &middot; {espert.length} Espert &middot; {primaryPresent} primarios, {secondaryPresent} secundarios
            </p>
          </div>
          <VisitStepIndicator currentStep={3} />
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Material Espert — desde el catálogo MKT */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <LayoutGrid size={16} className="text-[#A48242]" />
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">Material Espert</h2>
            <Badge variant="secondary" className="text-[10px]">{espert.length}</Badge>
          </div>
          <div className="space-y-2">
            {espert.map(renderEspertCard)}
            <Button
              type="button"
              variant="outline"
              onClick={() => setPickerOpen(true)}
              className="w-full gap-1.5 border-dashed border-[#A48242]/50 text-[#A48242]"
            >
              <Plus size={15} /> Agregar material Espert
            </Button>
          </div>
        </div>

        {/* Competencia — material primario */}
        <div>
          <div className="flex items-center gap-2 mb-3 mt-6">
            <LayoutGrid size={16} className="text-[#A48242]" />
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">Competencia · Primario</h2>
            <Badge variant="secondary" className="text-[10px]">{rows.filter((r) => r.Present && r.MaterialType === "primario").length}/{GENERIC_POP_MATERIALS.primario.length}</Badge>
          </div>
          <div className="space-y-2">
            {rows.filter((r) => r.MaterialType === "primario").map((row) =>
              renderMaterialCard(row, "border-l-green-400")
            )}
          </div>
        </div>

        {/* Material secundario */}
        <div>
          <div className="flex items-center gap-2 mb-3 mt-6">
            <LayoutGrid size={16} className="text-[#C9A962]" />
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">Competencia · Secundario</h2>
            <Badge variant="secondary" className="text-[10px]">{rows.filter((r) => r.Present && r.MaterialType === "secundario").length}/{GENERIC_POP_MATERIALS.secundario.length}</Badge>
          </div>
          <div className="space-y-2">
            {rows.filter((r) => r.MaterialType === "secundario").map((row) =>
              renderMaterialCard(row, "border-l-[#C9A962]")
            )}
          </div>
        </div>
      </div>

      {/* Bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border p-3 pb-[env(safe-area-inset-bottom)] z-20">
        <Button
          onClick={handleSave}
          disabled={saving}
          className="w-full h-11 bg-[#A48242] hover:bg-[#8B6E38] text-white font-semibold"
        >
          {saving ? "Guardando..." : "Continuar a Acciones"}
          <ArrowRight size={16} className="ml-2" />
        </Button>
      </div>
    </div>
  );
}
