import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  ArrowLeft,
  ArrowRight,
  Newspaper,
  Camera,
  Plus,
  Trash2,
  X,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import { useVisitStep } from "@/lib/useVisitAutoSave";
import { executeOrEnqueue } from "@/lib/offline";
import { marketNewsApi, visitPhotosApi, ApiError } from "@/lib/api";
import type { MarketNews } from "@/lib/api/types";
import { VisitStepIndicator } from "../components/VisitStepIndicator";
import { getCurrentUser } from "../lib/auth";

const NEWS_TAGS = [
  { value: "precio", label: "Precio", color: "bg-blue-100 text-blue-700 ring-blue-300" },
  { value: "producto", label: "Producto", color: "bg-green-100 text-green-700 ring-green-300" },
  { value: "competencia", label: "Competencia", color: "bg-red-100 text-red-700 ring-red-300" },
  { value: "canal", label: "Canal", color: "bg-purple-100 text-purple-700 ring-purple-300" },
  { value: "otros", label: "Otros", color: "bg-gray-100 text-gray-700 ring-gray-300" },
];

interface NewsDraft {
  id?: number; // existing MarketNewsId (undefined = new)
  tags: string[];
  notes: string;
  photos: { url: string; fileId?: number }[];
}

export function MarketNewsStepPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const locState = (location.state as { routeDayId?: number; visitId?: number }) || {};
  const recovered = useVisitStep(Number(id) || undefined, "market-news", locState);
  const routeDayId = locState.routeDayId ?? recovered.routeDayId;
  const visitId = locState.visitId ?? recovered.visitId;
  const currentUser = getCurrentUser();

  const [drafts, setDrafts] = useState<NewsDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activePhotoIdx, setActivePhotoIdx] = useState<number | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!visitId) { setLoading(false); return; }

    Promise.all([
      marketNewsApi.list(visitId).catch(() => []),
      visitPhotosApi.list(visitId).catch(() => []),
    ]).then(([existing, photos]) => {
      if (existing.length > 0) {
        setDrafts(existing.map((n) => {
          // Find photos for this news item
          const newsPhotos = photos
            .filter((p) => p.PhotoType === `news_${n.MarketNewsId}`)
            .map((p) => ({ url: p.Url, fileId: p.FileId }));
          return {
            id: n.MarketNewsId,
            tags: n.Tags ? n.Tags.split(",").map((t) => t.trim()) : [],
            notes: n.Notes,
            photos: newsPhotos,
          };
        }));
      }
      setLoading(false);
    });
  }, [visitId]);

  const addDraft = () => {
    setDrafts((prev) => [...prev, { tags: [], notes: "", photos: [] }]);
  };

  const updateDraft = (idx: number, field: keyof NewsDraft, value: unknown) => {
    setDrafts((prev) => prev.map((d, i) => i === idx ? { ...d, [field]: value } : d));
  };

  const removeDraft = async (idx: number) => {
    const draft = drafts[idx];
    if (draft.id && visitId) {
      try {
        await marketNewsApi.delete(draft.id);
      } catch { /* continue removing locally */ }
    }
    setDrafts((prev) => prev.filter((_, i) => i !== idx));
  };

  const toggleTag = (idx: number, tag: string) => {
    const draft = drafts[idx];
    const has = draft.tags.includes(tag);
    const next = has ? draft.tags.filter((t) => t !== tag) : [...draft.tags, tag];
    updateDraft(idx, "tags", next);
  };

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || activePhotoIdx === null) return;

    const localUrl = URL.createObjectURL(file);
    const idx = activePhotoIdx;

    setDrafts((prev) => prev.map((d, i) =>
      i === idx ? { ...d, photos: [...d.photos, { url: localUrl }] } : d
    ));

    // Queue upload (offline-tolerant) if we have a visitId and the draft is already saved
    if (visitId && drafts[idx]?.id) {
      try {
        const { compressImage } = await import("@/lib/imageCompression");
        const compressed = await compressImage(file);
        const isTempVisit = visitId < 0;
        const newsId = drafts[idx].id;
        const result = await executeOrEnqueue({
          kind: "photo_upload",
          method: "POST",
          url: `/files/photos/visit/${visitId}`,
          formParts: [
            { name: "file", value: compressed, filename: `news_${newsId}_${Date.now()}.jpg` },
            { name: "photo_type", value: `news_${newsId}` },
          ],
          label: `Foto novedad`,
          _tempVisitId: isTempVisit ? visitId : undefined,
        });
        if (!result.queued && result.data) {
          const uploaded = result.data as { FileId?: number };
          setDrafts((prev) => prev.map((d, i) =>
            i === idx ? {
              ...d,
              photos: d.photos.map((p) => p.url === localUrl ? { ...p, fileId: uploaded.FileId } : p),
            } : d
          ));
        }
      } catch { /* local preview stays, upload queued */ }
    }

    setActivePhotoIdx(null);
  };

  const deletePhoto = async (draftIdx: number, photoIdx: number) => {
    const photo = drafts[draftIdx]?.photos[photoIdx];
    if (!photo) return;

    setDrafts((prev) => prev.map((d, i) =>
      i === draftIdx ? { ...d, photos: d.photos.filter((_, pi) => pi !== photoIdx) } : d
    ));

    if (visitId && photo.fileId) {
      try {
        await visitPhotosApi.delete(visitId, photo.fileId);
      } catch { /* already removed locally */ }
    }
  };

  const handleSave = async () => {
    if (!visitId) return;
    setSaving(true);
    const isTempVisit = visitId < 0;
    try {
      // Save each draft (offline-tolerant)
      for (let i = 0; i < drafts.length; i++) {
        const draft = drafts[i];
        if (!draft.notes.trim()) continue; // skip empty

        const payload = {
          Tags: draft.tags.join(","),
          Notes: draft.notes.trim(),
          CreatedBy: Number(currentUser.id),
        };

        if (draft.id) {
          // Update existing
          await executeOrEnqueue({
            kind: "visit_news_update",
            method: "PATCH",
            url: `/visits/market-news/${draft.id}`,
            body: { Tags: payload.Tags, Notes: payload.Notes },
            label: "Actualizar novedad",
          });
        } else {
          // Create new — try online first for photo association
          const result = await executeOrEnqueue({
            kind: "visit_news_create",
            method: "POST",
            url: `/visits/${visitId}/market-news`,
            body: payload,
            label: "Nueva novedad",
            _tempVisitId: isTempVisit ? visitId : undefined,
          });

          const newsId = !result.queued && result.data
            ? (result.data as { MarketNewsId?: number }).MarketNewsId
            : null;

          // Upload any pending photos for this newly created item
          if (newsId) {
            draft.id = newsId;
            for (const photo of draft.photos) {
              if (!photo.fileId) {
                try {
                  const blob = await fetch(photo.url).then((r) => r.blob());
                  const { compressImage } = await import("@/lib/imageCompression");
                  const compressed = await compressImage(blob);
                  await executeOrEnqueue({
                    kind: "photo_upload",
                    method: "POST",
                    url: `/visits/${visitId}/photos`,
                    formParts: [
                      { name: "file", value: compressed, filename: `news_${newsId}.jpg` },
                      { name: "photo_type", value: `news_${newsId}` },
                    ],
                    label: "Foto novedad",
                    _tempVisitId: isTempVisit ? visitId : undefined,
                  }).catch(() => {});
                } catch { /* skip failed uploads */ }
              }
            }
          }
        }
      }
      toast.success("Novedades guardadas");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
    navigate(`/pos/${id}/summary`, { state: { routeDayId, visitId } });
  };

  const handleSkip = () => {
    navigate(`/pos/${id}/summary`, { state: { routeDayId, visitId } });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Cargando novedades...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-28">
      {/* Hidden photo input */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*" capture="environment"
        className="hidden"
        onChange={handlePhoto}
      />

      {/* Header */}
      <div className="bg-card border-b border-border p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/pos/${id}/actions`, { state: { routeDayId, visitId } })}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-foreground">Novedades de Mercado</h1>
            <p className="text-xs text-muted-foreground">
              {drafts.length} novedad{drafts.length !== 1 ? "es" : ""} registrada{drafts.length !== 1 ? "s" : ""}
            </p>
          </div>
          <VisitStepIndicator currentStep={5} />
        </div>
      </div>

      <div className="p-4 space-y-3">
        {drafts.length === 0 && (
          <Card className="border-dashed border-2">
            <CardContent className="p-6 text-center">
              <Newspaper size={32} className="mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground mb-3">
                No hay novedades registradas para esta visita.
              </p>
              <Button variant="outline" onClick={addDraft}>
                <Plus size={16} className="mr-2" />
                Agregar novedad
              </Button>
            </CardContent>
          </Card>
        )}

        {drafts.map((draft, idx) => (
          <Card key={idx} className="border-l-4 border-l-[#A48242]">
            <CardContent className="p-3 space-y-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Newspaper size={16} className="text-[#A48242]" />
                  <span className="text-sm font-semibold text-foreground">
                    Novedad {idx + 1}
                  </span>
                </div>
                <button
                  onClick={() => removeDraft(idx)}
                  className="p-1.5 text-red-400 hover:text-red-600 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Tags */}
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1.5 flex items-center gap-1">
                  <Tag size={10} /> Categoría
                </p>
                <div className="flex gap-1.5 flex-wrap">
                  {NEWS_TAGS.map((tag) => (
                    <button
                      key={tag.value}
                      onClick={() => toggleTag(idx, tag.value)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                        draft.tags.includes(tag.value)
                          ? `${tag.color} ring-1`
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {tag.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <textarea
                  placeholder="Describí la novedad... (ej: La competencia bajó el precio de X producto un 15%)"
                  value={draft.notes}
                  onChange={(e) => updateDraft(idx, "notes", e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm resize-none bg-background"
                />
              </div>

              {/* Photos */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-1">
                    <Camera size={10} /> Fotos
                  </p>
                  <button
                    onClick={() => { setActivePhotoIdx(idx); photoInputRef.current?.click(); }}
                    className="flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-border text-[10px] text-muted-foreground hover:bg-muted transition-colors"
                  >
                    <Camera size={12} />
                    Agregar foto
                  </button>
                </div>
                {draft.photos.length > 0 ? (
                  <div className="flex gap-1.5 flex-wrap">
                    {draft.photos.map((photo, pIdx) => (
                      <div key={pIdx} className="relative">
                        <img
                          src={photo.url}
                          alt={`Novedad ${idx + 1} foto ${pIdx + 1}`}
                          className="w-16 h-16 rounded-md object-cover border border-border"
                        />
                        <button
                          onClick={() => deletePhoto(idx, pIdx)}
                          className="absolute -top-1 -right-1 p-0.5 bg-black/60 rounded-full"
                        >
                          <X size={10} className="text-white" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground">Sin fotos adjuntas</p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}

        {drafts.length > 0 && (
          <Button variant="outline" onClick={addDraft} className="w-full border-dashed">
            <Plus size={16} className="mr-2" />
            Agregar otra novedad
          </Button>
        )}
      </div>

      {/* Bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border p-3 pb-[env(safe-area-inset-bottom)] z-20 space-y-2">
        {drafts.some((d) => d.notes.trim()) ? (
          <Button
            onClick={handleSave}
            disabled={saving}
            className="w-full h-11 bg-[#A48242] hover:bg-[#8B6E38] text-white font-semibold"
          >
            {saving ? "Guardando..." : "Guardar y continuar"}
            <ArrowRight size={16} className="ml-2" />
          </Button>
        ) : (
          <Button
            onClick={handleSkip}
            className="w-full h-11 bg-[#A48242] hover:bg-[#8B6E38] text-white font-semibold"
          >
            {drafts.length === 0 ? "Sin novedades — Continuar" : "Continuar"}
            <ArrowRight size={16} className="ml-2" />
          </Button>
        )}
      </div>
    </div>
  );
}
