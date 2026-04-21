import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Label } from "../components/ui/label";
import { ArrowLeft, Camera, Image as ImageIcon, Trash2, Check, Upload } from "lucide-react";
import { pdvsApi, visitsApi, visitPhotosApi, ApiError } from "@/lib/api";
import type { VisitPhotoRead } from "@/lib/api";
import { executeOrEnqueue } from "@/lib/offline";
import { toast } from "sonner";

// Extiende VisitPhotoRead con campos opcionales para fotos pendientes de sync (offline)
interface PhotoItem extends VisitPhotoRead {
  _pending?: boolean;
  _localUrl?: string;
}

interface CategoryDef {
  id: string;
  label: string;
  required: boolean;
}

const CATEGORIES: CategoryDef[] = [
  { id: "storefront", label: "Frente del Local", required: true },
  { id: "shelf", label: "Góndola/Exhibición", required: true },
  { id: "pop", label: "Material POP", required: false },
  { id: "price", label: "Precio", required: false },
  { id: "other", label: "Otra", required: false },
];

export function PhotoCapture() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const routeDayId = (location.state as { routeDayId?: number } | null)?.routeDayId;
  const visitIdFromState = (location.state as { visitId?: number } | null)?.visitId;

  const [pdv, setPdv] = useState<Awaited<ReturnType<typeof pdvsApi.get>> | null>(null);
  const [visitId, setVisitId] = useState<number | null>(visitIdFromState ?? null);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("storefront");
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cargar PDV + resolver VisitId
  useEffect(() => {
    if (!id) return;
    pdvsApi.get(Number(id)).then(setPdv).catch(() => setPdv(null));
    if (!visitIdFromState) {
      visitsApi.list({ pdv_id: Number(id), status: "OPEN" }).then((v) => {
        if (v.length > 0) setVisitId(v[0].VisitId);
      });
    } else {
      setVisitId(visitIdFromState);
    }
  }, [id, visitIdFromState]);

  // Cargar fotos existentes cuando se resuelva el visitId
  useEffect(() => {
    if (!visitId) return;
    visitPhotosApi
      .list(visitId)
      .then(setPhotos)
      .catch(() => setPhotos([]));
  }, [visitId]);

  // Click en "Tomar Foto" → abre el input file nativo con captura de cámara
  const triggerCapture = () => {
    if (!visitId) {
      toast.error("No hay una visita abierta. Hacé check-in primero.");
      return;
    }
    fileInputRef.current?.click();
  };

  // Obtener GPS actual (best-effort, no bloqueante)
  const getCurrentCoords = (): Promise<{ lat?: number; lon?: number }> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({});
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => resolve({}),
        { enableHighAccuracy: true, timeout: 5000 }
      );
    });
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Resetear el input para que el mismo file pueda seleccionarse de nuevo
    e.target.value = "";
    if (!file || !visitId) return;

    // Validación básica del lado del cliente
    if (!file.type.startsWith("image/")) {
      toast.error("Sólo se permiten imágenes");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("La imagen es demasiado grande (máx 10 MB)");
      return;
    }

    setUploading(true);
    try {
      const coords = await getCurrentCoords();
      const sortOrder = photos.filter((p) => p.PhotoType === selectedCategory).length + 1;

      // Construir las partes multipart
      const formParts: Array<{ name: string; value: Blob | string; filename?: string }> = [
        { name: "file", value: file, filename: file.name || `photo-${Date.now()}.jpg` },
        { name: "photo_type", value: selectedCategory },
        { name: "sort_order", value: String(sortOrder) },
      ];
      if (coords.lat != null) formParts.push({ name: "lat", value: String(coords.lat) });
      if (coords.lon != null) formParts.push({ name: "lon", value: String(coords.lon) });

      try {
        const isTempVisit = visitId < 0;
        const result = await executeOrEnqueue<VisitPhotoRead>({
          kind: "photo_upload",
          method: "POST",
          url: `/files/photos/visit/${visitId}`,
          formParts,
          label: `Foto ${selectedCategory}`,
          _tempVisitId: isTempVisit ? visitId : undefined,
        });

        if (result.queued) {
          // Mostrar foto local con preview hasta que se sincronice
          const localUrl = URL.createObjectURL(file);
          const ghost: PhotoItem = {
            VisitId: visitId,
            FileId: -result.queueId, // negativo para distinguir
            PhotoType: selectedCategory,
            SortOrder: sortOrder,
            Notes: null,
            url: localUrl,
            content_type: file.type,
            size_bytes: file.size,
            created_at: new Date().toISOString(),
            _pending: true,
            _localUrl: localUrl,
          };
          setPhotos((prev) => [...prev, ghost]);
          toast.success("Foto guardada. Se subirá cuando vuelva la conexión.");
        } else {
          setPhotos((prev) => [...prev, result.data]);
          toast.success("Foto subida");
        }
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Error al subir la foto");
      }
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (fileId: number) => {
    if (!visitId) return;
    if (!confirm("¿Eliminar esta foto?")) return;
    setDeleting(fileId);
    try {
      await visitPhotosApi.delete(visitId, fileId);
      setPhotos((prev) => prev.filter((p) => p.FileId !== fileId));
      toast.success("Foto eliminada");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Error al eliminar");
    } finally {
      setDeleting(null);
    }
  };

  const handleFinish = () => {
    const required = CATEGORIES.filter((c) => c.required).map((c) => c.id);
    const captured = new Set(photos.map((p) => p.PhotoType));
    const missing = required.filter((r) => !captured.has(r));
    if (missing.length > 0) {
      toast.error(
        `Faltan fotos obligatorias: ${missing
          .map((m) => CATEGORIES.find((c) => c.id === m)?.label)
          .join(", ")}`
      );
      return;
    }
    navigate(`/pos/${id}/summary`, { state: { routeDayId, visitId } });
  };

  const getCategoryPhotos = (categoryId: string) =>
    photos.filter((p) => p.PhotoType === categoryId);

  const requiredCount = CATEGORIES.filter((c) => c.required).length;
  const coveredRequired = CATEGORIES.filter(
    (c) => c.required && getCategoryPhotos(c.id).length > 0
  ).length;

  if (!pdv) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Input file oculto — dispara la cámara nativa en mobile */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* Header */}
      <div className="bg-card border-b border-border p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={() => navigate(`/pos/${id}`)}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Evidencia Fotográfica</h1>
            <p className="text-sm text-muted-foreground">{pdv.Name}</p>
          </div>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {photos.length} fotos · {coveredRequired}/{requiredCount} categorías obligatorias
          </span>
          <Badge variant={coveredRequired >= requiredCount ? "secondary" : "destructive"}>
            {coveredRequired >= requiredCount ? "Completo" : "Incompleto"}
          </Badge>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Category Selector */}
        <Card>
          <CardContent className="p-4">
            <Label className="text-sm font-semibold text-foreground mb-3 block">
              Categoría de Foto
            </Label>
            <div className="space-y-2">
              {CATEGORIES.map((category) => {
                const categoryPhotos = getCategoryPhotos(category.id);
                const isSelected = selectedCategory === category.id;
                return (
                  <button
                    key={category.id}
                    onClick={() => setSelectedCategory(category.id)}
                    className={`w-full flex items-center justify-between p-3 rounded-lg border-2 transition-colors ${
                      isSelected
                        ? "border-espert-gold bg-espert-gold/10"
                        : "border-border hover:border-espert-gold/50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          isSelected ? "bg-espert-gold" : "bg-muted"
                        }`}
                      >
                        <ImageIcon
                          size={20}
                          className={isSelected ? "text-white" : "text-muted-foreground"}
                        />
                      </div>
                      <div className="text-left">
                        <p className="font-semibold text-foreground flex items-center gap-2">
                          {category.label}
                          {category.required && (
                            <span className="text-xs text-red-600">*Obligatorio</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {categoryPhotos.length} {categoryPhotos.length === 1 ? "foto" : "fotos"}
                        </p>
                      </div>
                    </div>
                    {categoryPhotos.length > 0 && (
                      <Check size={20} className="text-green-600" />
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Capture Button */}
        <Button
          className="w-full h-14 text-base font-semibold"
          size="lg"
          onClick={triggerCapture}
          disabled={uploading || !visitId}
        >
          <Camera className="mr-2" size={20} />
          {uploading
            ? "Subiendo foto..."
            : `Tomar Foto - ${CATEGORIES.find((c) => c.id === selectedCategory)?.label}`}
        </Button>

        {/* Photo Gallery */}
        {photos.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold text-foreground mb-3">
                Fotos Capturadas ({photos.length})
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {photos.map((photo) => (
                  <div key={photo.FileId} className="relative group">
                    <img
                      src={photo.url}
                      alt={`Foto ${photo.PhotoType}`}
                      className="w-full h-32 object-cover rounded-lg border border-border"
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                      <button
                        onClick={() => handleDelete(photo.FileId)}
                        disabled={deleting === photo.FileId}
                        className="bg-red-600 text-white p-2 rounded-full hover:bg-red-700 disabled:opacity-50"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    <div className="absolute top-2 left-2">
                      <Badge variant="secondary" className="text-xs">
                        {CATEGORIES.find((c) => c.id === photo.PhotoType)?.label ?? photo.PhotoType}
                      </Badge>
                    </div>
                    <div className="absolute top-2 right-2">
                      {photo._pending ? (
                        <Badge variant="secondary" className="text-xs bg-amber-500 text-white">
                          <Upload size={12} className="mr-1" />
                          Pendiente
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs bg-green-600 text-white">
                          <Check size={12} className="mr-1" />
                          Sync
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground text-center">
                      {new Date(photo.created_at).toLocaleTimeString("es-AR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Instructions */}
        <Card className="bg-espert-gold/10 border-espert-gold/40">
          <CardContent className="p-4">
            <h3 className="font-semibold text-foreground mb-2">Recomendaciones</h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="text-espert-gold font-bold">•</span>
                <span>Asegurate de tomar fotos claras y bien iluminadas</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-espert-gold font-bold">•</span>
                <span>Las fotos obligatorias son necesarias para completar la visita</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-espert-gold font-bold">•</span>
                <span>Cada foto se sube al servidor con tu ubicación GPS si tenés permiso</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Fixed Bottom Actions */}
      <div className="sticky bottom-0 bg-card border-t border-border p-3 pb-[env(safe-area-inset-bottom)]">
        <Button
          className="w-full h-12 text-base font-semibold"
          onClick={handleFinish}
          disabled={coveredRequired < requiredCount || uploading}
        >
          Continuar a Resumen
        </Button>
      </div>
    </div>
  );
}
