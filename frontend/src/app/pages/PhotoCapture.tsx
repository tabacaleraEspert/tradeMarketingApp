import { useState, useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { ArrowLeft, Camera, Image as ImageIcon, Trash2, Check, Upload } from "lucide-react";
import { pdvsApi, visitsApi } from "@/lib/api";
import { toast } from "sonner";

interface CapturedPhoto {
  id: string;
  category: string;
  url: string;
  timestamp: Date;
  synced: boolean;
}

export function PhotoCapture() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const routeDayId = (location.state as { routeDayId?: number } | null)?.routeDayId;
  const visitIdFromState = (location.state as { visitId?: number } | null)?.visitId;

  const [pdv, setPdv] = useState<Awaited<ReturnType<typeof pdvsApi.get>> | null>(null);
  const [visitId, setVisitId] = useState<number | null>(visitIdFromState ?? null);
  const [reminderForNext, setReminderForNext] = useState("");
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("storefront");
  const [saving, setSaving] = useState(false);

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

  const categories = [
    { id: "storefront", label: "Frente del Local", required: true },
    { id: "shelf", label: "Góndola/Exhibición", required: true },
    { id: "pop", label: "Material POP", required: false },
    { id: "price", label: "Precio", required: false },
    { id: "other", label: "Otra", required: false },
  ];

  const handleCapture = () => {
    // Simulate photo capture
    const mockPhotos = [
      "https://images.unsplash.com/photo-1604719312566-8912e9227c6a",
      "https://images.unsplash.com/photo-1578916171728-46686eac8d58",
      "https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a",
    ];
    
    const newPhoto: CapturedPhoto = {
      id: Date.now().toString(),
      category: selectedCategory,
      url: mockPhotos[Math.floor(Math.random() * mockPhotos.length)],
      timestamp: new Date(),
      synced: false,
    };

    setPhotos([...photos, newPhoto]);
    toast.success("Foto capturada correctamente");
  };

  const handleDelete = (photoId: string) => {
    setPhotos(photos.filter((p) => p.id !== photoId));
    toast.success("Foto eliminada");
  };

  const handleFinish = async () => {
    const requiredCategories = categories.filter((c) => c.required).map((c) => c.id);
    const capturedCategories = [...new Set(photos.map((p) => p.category))];
    const missingCategories = requiredCategories.filter(
      (cat) => !capturedCategories.includes(cat)
    );

    if (missingCategories.length > 0) {
      toast.error("Faltan fotos obligatorias");
      return;
    }

    setSaving(true);
    try {
      toast.success("Evidencia fotográfica completada");
      navigate(`/pos/${id}/summary`, {
        state: { routeDayId, visitId },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const getCategoryPhotos = (categoryId: string) => {
    return photos.filter((p) => p.category === categoryId);
  };

  const getMinPhotosRequired = () => {
    return categories.filter((c) => c.required).length;
  };

  if (!pdv) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
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
            {photos.length} fotos capturadas (mínimo {getMinPhotosRequired()})
          </span>
          <Badge variant={photos.length >= getMinPhotosRequired() ? "secondary" : "destructive"}>
            {photos.length >= getMinPhotosRequired() ? "Completo" : "Incompleto"}
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
              {categories.map((category) => {
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
          onClick={handleCapture}
        >
          <Camera className="mr-2" size={20} />
          Tomar Foto - {categories.find((c) => c.id === selectedCategory)?.label}
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
                  <div key={photo.id} className="relative group">
                    <img
                      src={photo.url}
                      alt={`Foto ${photo.category}`}
                      className="w-full h-32 object-cover rounded-lg"
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                      <button
                        onClick={() => handleDelete(photo.id)}
                        className="bg-red-600 text-white p-2 rounded-full hover:bg-red-700"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    <div className="absolute top-2 left-2">
                      <Badge variant="secondary" className="text-xs">
                        {categories.find((c) => c.id === photo.category)?.label}
                      </Badge>
                    </div>
                    <div className="absolute top-2 right-2">
                      {photo.synced ? (
                        <Badge variant="secondary" className="text-xs bg-green-600">
                          <Check size={12} className="mr-1" />
                          Sync
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs bg-yellow-600">
                          <Upload size={12} className="mr-1" />
                          Pendiente
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground text-center">
                      {photo.timestamp.toLocaleTimeString("es-AR", {
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
        <Card className="bg-espert-gold/10 border-espert-gold">
          <CardContent className="p-4">
            <h3 className="font-semibold text-foreground mb-2">Recomendaciones</h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="text-espert-gold font-bold">•</span>
                <span>Asegúrate de tomar fotos claras y bien iluminadas</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-espert-gold font-bold">•</span>
                <span>Las fotos obligatorias son necesarias para completar la visita</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-espert-gold font-bold">•</span>
                <span>Las fotos se sincronizarán automáticamente cuando tengas conexión</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Fixed Bottom Actions */}
      <div className="sticky bottom-0 bg-card border-t border-border p-3">
        <Button
          className="w-full h-12 text-base font-semibold"
          onClick={handleFinish}
          disabled={photos.length < getMinPhotosRequired() || saving}
        >
          {saving ? "Guardando..." : "Continuar a Resumen"}
        </Button>
      </div>
    </div>
  );
}
