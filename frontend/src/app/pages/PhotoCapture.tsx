import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { ArrowLeft, Camera, Image as ImageIcon, Trash2, Check, Upload } from "lucide-react";
import { pointsOfSale } from "../data/mockData";
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
  const pos = pointsOfSale.find((p) => p.id === id);

  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("storefront");

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

  const handleFinish = () => {
    const requiredCategories = categories.filter((c) => c.required).map((c) => c.id);
    const capturedCategories = [...new Set(photos.map((p) => p.category))];
    const missingCategories = requiredCategories.filter(
      (cat) => !capturedCategories.includes(cat)
    );

    if (missingCategories.length > 0) {
      toast.error("Faltan fotos obligatorias");
      return;
    }

    toast.success("Evidencia fotográfica completada");
    navigate(`/pos/${id}`);
  };

  const getCategoryPhotos = (categoryId: string) => {
    return photos.filter((p) => p.category === categoryId);
  };

  const getMinPhotosRequired = () => {
    return categories.filter((c) => c.required).length;
  };

  if (!pos) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={() => navigate(`/pos/${id}`)}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-900">Evidencia Fotográfica</h1>
            <p className="text-sm text-slate-600">{pos.name}</p>
          </div>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-600">
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
            <Label className="text-sm font-semibold text-slate-900 mb-3 block">
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
                        ? "border-blue-600 bg-blue-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          isSelected ? "bg-blue-600" : "bg-slate-200"
                        }`}
                      >
                        <ImageIcon
                          size={20}
                          className={isSelected ? "text-white" : "text-slate-600"}
                        />
                      </div>
                      <div className="text-left">
                        <p className="font-semibold text-slate-900 flex items-center gap-2">
                          {category.label}
                          {category.required && (
                            <span className="text-xs text-red-600">*Obligatorio</span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500">
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
              <h3 className="font-semibold text-slate-900 mb-3">
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
                    <div className="mt-1 text-xs text-slate-600 text-center">
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
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-4">
            <h3 className="font-semibold text-blue-900 mb-2">Recomendaciones</h3>
            <ul className="space-y-1 text-sm text-blue-800">
              <li className="flex items-start gap-2">
                <span className="text-blue-600 font-bold">•</span>
                <span>Asegúrate de tomar fotos claras y bien iluminadas</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 font-bold">•</span>
                <span>Las fotos obligatorias son necesarias para completar la visita</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 font-bold">•</span>
                <span>Las fotos se sincronizarán automáticamente cuando tengas conexión</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Fixed Bottom Actions */}
      <div className="fixed bottom-20 left-0 right-0 bg-white border-t border-slate-200 p-4">
        <Button
          className="w-full h-12 text-base font-semibold"
          onClick={handleFinish}
          disabled={photos.length < getMinPhotosRequired()}
        >
          Finalizar y Guardar
        </Button>
      </div>
    </div>
  );
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <label className={className}>{children}</label>;
}
