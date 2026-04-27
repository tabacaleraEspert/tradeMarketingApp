import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Switch } from "../components/ui/switch";
import {
  ArrowLeft,
  ArrowRight,
  Megaphone,
  LayoutGrid,
  Camera,
  CheckCircle2,
  X,
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

interface POPRow {
  MaterialType: string;
  MaterialName: string;
  Companies: string[]; // multiple companies
  Present: boolean;
  HasPrice: boolean | null;
}

export function POPCensusPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { routeDayId, visitId } = (location.state as { routeDayId?: number; visitId?: number }) || {};

  const [rows, setRows] = useState<POPRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Photo evidence per material (keyed by MaterialName)
  const [popPhotos, setPopPhotos] = useState<Record<string, string>>({});
  const [activePhotoMaterial, setActivePhotoMaterial] = useState<string | null>(null);
  const popPhotoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!visitId) { setLoading(false); return; }

    visitPOPApi.list(visitId).then((existing) => {
      if (existing.length > 0) {
        setRows(existing.map((e) => ({
          MaterialType: e.MaterialType,
          MaterialName: e.MaterialName,
          Companies: e.Company ? e.Company.split(",").map((c) => c.trim()) : [],
          Present: e.Present,
          HasPrice: e.HasPrice,
        })));
      } else {
        const initial: POPRow[] = [];
        for (const [type, materials] of Object.entries(POP_MATERIALS)) {
          for (const mat of materials) {
            initial.push({
              MaterialType: type,
              MaterialName: mat.name,
              Companies: [],
              Present: false,
              HasPrice: null,
            });
          }
        }
        setRows(initial);
      }
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

  const handlePopPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !activePhotoMaterial) return;
    // Show local preview immediately
    const localUrl = URL.createObjectURL(file);
    setPopPhotos((p) => ({ ...p, [activePhotoMaterial]: localUrl }));
    // Upload to server if visitId is available
    if (visitId) {
      try {
        await visitPhotosApi.upload(visitId, file, { photoType: `pop_${activePhotoMaterial}` });
      } catch { /* local preview stays */ }
    }
    setActivePhotoMaterial(null);
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Hidden photo input */}
      <input
        ref={popPhotoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
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
            {rows.filter((r) => r.MaterialType === "primario").map((row, _idx) => {
              const idx = rows.indexOf(row);
              return (
                <Card key={row.MaterialName} className={`overflow-hidden ${row.Present ? "border-l-4 border-l-green-400" : ""}`}>
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
                        {/* Company */}
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
                        {/* Photo evidence */}
                        <div className="flex items-center gap-2">
                          {popPhotos[row.MaterialName] ? (
                            <div className="relative">
                              <img src={popPhotos[row.MaterialName]} alt={row.MaterialName} className="w-16 h-16 rounded-lg object-cover border border-border" />
                              <button
                                onClick={() => setPopPhotos((p) => { const n = { ...p }; delete n[row.MaterialName]; return n; })}
                                className="absolute -top-1 -right-1 p-0.5 bg-black/60 rounded-full"
                              >
                                <X size={10} className="text-white" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setActivePhotoMaterial(row.MaterialName); popPhotoInputRef.current?.click(); }}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:bg-muted transition-colors"
                            >
                              <Camera size={14} />
                              Foto evidencia
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
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
            {rows.filter((r) => r.MaterialType === "secundario").map((row) => {
              const idx = rows.indexOf(row);
              return (
                <Card key={row.MaterialName} className={`overflow-hidden ${row.Present ? "border-l-4 border-l-[#C9A962]" : ""}`}>
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
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => updateRow(idx, "HasPrice", true)}
                            className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                              row.HasPrice === true ? "bg-green-100 text-green-800 ring-1 ring-green-300" : "bg-muted text-muted-foreground"
                            }`}
                          >
                            Con precio
                          </button>
                          <button
                            onClick={() => updateRow(idx, "HasPrice", false)}
                            className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                              row.HasPrice === false ? "bg-amber-100 text-amber-800 ring-1 ring-amber-300" : "bg-muted text-muted-foreground"
                            }`}
                          >
                            Sin precio
                          </button>
                        </div>
                        {/* Photo evidence */}
                        <div className="flex items-center gap-2">
                          {popPhotos[row.MaterialName] ? (
                            <div className="relative">
                              <img src={popPhotos[row.MaterialName]} alt={row.MaterialName} className="w-16 h-16 rounded-lg object-cover border border-border" />
                              <button
                                onClick={() => setPopPhotos((p) => { const n = { ...p }; delete n[row.MaterialName]; return n; })}
                                className="absolute -top-1 -right-1 p-0.5 bg-black/60 rounded-full"
                              >
                                <X size={10} className="text-white" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setActivePhotoMaterial(row.MaterialName); popPhotoInputRef.current?.click(); }}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:bg-muted transition-colors"
                            >
                              <Camera size={14} />
                              Foto evidencia
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
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
