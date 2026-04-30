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
} from "lucide-react";
import { toast } from "sonner";
import { visitPOPApi, visitPhotosApi, ApiError } from "@/lib/api";
import { VisitStepIndicator } from "../components/VisitStepIndicator";

const POP_COMPANIES = ["Espert", "Massalin", "BAT", "TABSA", "Otra"];

const POP_MATERIALS = {
  primario: [
    { name: "Cigarrera aérea", icon: "🗄" },
    { name: "Cigarrera de espalda", icon: "📦" },
    { name: "Pantalla / Display", icon: "📺" },
    { name: "Otro primario", icon: "📋" },
  ],
  secundario: [
    { name: "Móvil / Colgante", icon: "🔔" },
    { name: "Stopper", icon: "🛑" },
    { name: "Escalerita", icon: "📊" },
    { name: "Exhibidor", icon: "🗃" },
    { name: "Afiche", icon: "🖼" },
    { name: "Otro secundario", icon: "📋" },
  ],
};

/** Build a photoType key for a material+company combo */
function popPhotoKey(materialName: string, company: string) {
  return `pop_${materialName}_${company}`;
}

interface POPRow {
  MaterialType: string;
  MaterialName: string;
  Companies: string[];
  Present: boolean;
  HasPrice: boolean | null;
}

interface PhotoEntry {
  url: string;
  fileId?: number; // if uploaded to server
}

export function POPCensusPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { routeDayId, visitId } = (location.state as { routeDayId?: number; visitId?: number }) || {};

  const [rows, setRows] = useState<POPRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Photos keyed by "pop_{material}_{company}" — supports multiple per key
  const [popPhotos, setPopPhotos] = useState<Record<string, PhotoEntry[]>>({});
  const [activePhotoKey, setActivePhotoKey] = useState<string | null>(null);
  const popPhotoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!visitId) { setLoading(false); return; }

    Promise.all([
      visitPOPApi.list(visitId),
      visitPhotosApi.list(visitId).catch(() => []),
    ]).then(([existing, photos]) => {
      // Always show ALL materials, merging with saved data
      const existingMap = new Map(existing.map((e) => [e.MaterialName, e]));
      const allRows: POPRow[] = [];
      for (const [type, materials] of Object.entries(POP_MATERIALS)) {
        for (const mat of materials) {
          const saved = existingMap.get(mat.name);
          allRows.push({
            MaterialType: type,
            MaterialName: mat.name,
            Companies: saved?.Company ? saved.Company.split(",").map((c) => c.trim()) : [],
            Present: saved?.Present ?? false,
            HasPrice: saved?.HasPrice ?? null,
          });
        }
      }
      setRows(allRows);

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

  const updateRow = (idx: number, field: keyof POPRow, value: string | boolean | null | string[]) => {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const handleSave = async () => {
    if (!visitId) return;
    setSaving(true);
    try {
      const items = rows
        .filter((r) => r.Present || r.Companies.length > 0)
        .map((r) => ({
          MaterialType: r.MaterialType,
          MaterialName: r.MaterialName,
          Company: r.Companies.length > 0 ? r.Companies.join(", ") : undefined,
          Present: r.Present,
          HasPrice: r.HasPrice ?? undefined,
        }));
      await visitPOPApi.bulkSave(visitId, items);
      toast.success("Censo POP guardado");
      navigate(`/pos/${id}/actions`, { state: { routeDayId, visitId } });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handlePopPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !activePhotoKey) return;
    const localUrl = URL.createObjectURL(file);
    const key = activePhotoKey;
    // Add to local state immediately
    setPopPhotos((prev) => ({
      ...prev,
      [key]: [...(prev[key] || []), { url: localUrl }],
    }));
    // Upload to server
    if (visitId) {
      try {
        const result = await visitPhotosApi.upload(visitId, file, { photoType: key });
        // Update with server fileId
        setPopPhotos((prev) => ({
          ...prev,
          [key]: (prev[key] || []).map((p) =>
            p.url === localUrl ? { ...p, fileId: result.FileId } : p
          ),
        }));
      } catch { /* local preview stays */ }
    }
    setActivePhotoKey(null);
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

  const presentCount = rows.filter((r) => r.Present).length;
  const primaryPresent = rows.filter((r) => r.Present && r.MaterialType === "primario").length;
  const secondaryPresent = rows.filter((r) => r.Present && r.MaterialType === "secundario").length;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Cargando materiales...</div>
      </div>
    );
  }

  const renderMaterialCard = (row: POPRow, borderColor: string) => {
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
              {/* Company selection — each selected company gets a photo section */}
              <div className="flex gap-1.5 flex-wrap">
                {POP_COMPANIES.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      const has = row.Companies.includes(c);
                      const next = has ? row.Companies.filter((x) => x !== c) : [...row.Companies, c];
                      updateRow(idx, "Companies", next as unknown as string);
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
                  {row.Companies.map((company) => {
                    const key = popPhotoKey(row.MaterialName, company);
                    const photos = popPhotos[key] || [];
                    return (
                      <div key={company} className="p-2 bg-muted/50 rounded-lg">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] font-semibold text-foreground">{company}</span>
                          <button
                            onClick={() => { setActivePhotoKey(key); popPhotoInputRef.current?.click(); }}
                            className="flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-border text-[10px] text-muted-foreground hover:bg-background transition-colors"
                          >
                            <Camera size={12} />
                            Foto
                          </button>
                        </div>
                        {photos.length > 0 && (
                          <div className="flex gap-1.5 flex-wrap">
                            {photos.map((photo, pIdx) => (
                              <div key={pIdx} className="relative">
                                <img
                                  src={photo.url}
                                  alt={`${row.MaterialName} ${company}`}
                                  className="w-14 h-14 rounded-md object-cover border border-border"
                                />
                                <button
                                  onClick={() => handleDeletePhoto(key, pIdx)}
                                  className="absolute -top-1 -right-1 p-0.5 bg-black/60 rounded-full"
                                >
                                  <X size={10} className="text-white" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        {photos.length === 0 && (
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <ImageIcon size={10} /> Sin foto
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* HasPrice */}
              <div className="flex gap-1.5">
                <button
                  onClick={() => updateRow(idx, "HasPrice", true)}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                    row.HasPrice === true
                      ? "bg-green-100 text-green-800 ring-1 ring-green-300"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  Con precio
                </button>
                <button
                  onClick={() => updateRow(idx, "HasPrice", false)}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                    row.HasPrice === false
                      ? "bg-amber-100 text-amber-800 ring-1 ring-amber-300"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  Sin precio
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Hidden photo input — outside form */}
      <input
        ref={popPhotoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePopPhoto}
      />

      {/* Header */}
      <div className="bg-card border-b border-border p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/pos/${id}/coverage`, { state: { routeDayId, visitId } })}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-foreground">Censo de Materiales POP</h1>
            <p className="text-xs text-muted-foreground">
              {presentCount} presentes &middot; {primaryPresent} primarios, {secondaryPresent} secundarios
            </p>
          </div>
          <VisitStepIndicator currentStep={3} />
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Material primario */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <LayoutGrid size={16} className="text-[#A48242]" />
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">Material Primario</h2>
            <Badge variant="secondary" className="text-[10px]">{primaryPresent}/{POP_MATERIALS.primario.length}</Badge>
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
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">Material Secundario</h2>
            <Badge variant="secondary" className="text-[10px]">{secondaryPresent}/{POP_MATERIALS.secundario.length}</Badge>
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
