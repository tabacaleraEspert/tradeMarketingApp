import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import { ArrowLeft, MapPin, Camera, Send } from "lucide-react";
import { toast } from "sonner";
import { pdvsApi, distributorsApi, ApiError } from "@/lib/api";
import type { Distributor } from "@/lib/api/types";
import { getCurrentUser } from "../lib/auth";

export function NewPointOfSale() {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();

  const [formData, setFormData] = useState({
    name: "",
    address: "",
    channel: "",
    subChannel: "",
    distributorId: "",
    contactName: "",
    contactPhone: "",
    observations: "",
  });

  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [loading, setLoading] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);

  useEffect(() => {
    distributorsApi.list().then((list) => setDistributors(list)).catch(() => {});
  }, []);

  const handleTakePhoto = () => {
    const mockPhoto = "https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a";
    setPhotos([...photos, mockPhoto]);
    toast.success("Foto capturada");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.address || !formData.channel) {
      toast.error("Por favor completa los campos obligatorios");
      return;
    }

    setLoading(true);
    try {
      await pdvsApi.create({
        Name: formData.name,
        Address: formData.address,
        Channel: formData.channel,
        ZoneId: currentUser.zoneId ?? undefined,
        DistributorId: formData.distributorId ? Number(formData.distributorId) : undefined,
        ContactName: formData.contactName || undefined,
        ContactPhone: formData.contactPhone || undefined,
        IsActive: true,
      });
      toast.success("PDV creado y enviado para validación");
      navigate("/");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Error al crear el PDV");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-900">Alta de Nuevo PDV</h1>
            <p className="text-sm text-slate-600">Registro rápido en campo</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-4 space-y-4">
        {/* Basic Info */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-semibold text-slate-900">Información Básica</h3>
              <Badge variant="destructive" className="text-xs">Obligatorio</Badge>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">
                Nombre del Comercio <span className="text-red-600">*</span>
              </Label>
              <Input
                id="name"
                placeholder="Ej: Kiosco La Esquina"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">
                Dirección <span className="text-red-600">*</span>
              </Label>
              <Input
                id="address"
                placeholder="Ej: Av. Corrientes 1234"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                required
              />
              <Button type="button" variant="outline" size="sm" className="w-full">
                <MapPin size={16} className="mr-2" />
                Usar Ubicación GPS Actual
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="channel">
                Canal <span className="text-red-600">*</span>
              </Label>
              <Select
                value={formData.channel}
                onValueChange={(value) => setFormData({ ...formData, channel: value })}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar canal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kiosco">Kiosco</SelectItem>
                  <SelectItem value="autoservicio">Autoservicio</SelectItem>
                  <SelectItem value="supermercado">Supermercado</SelectItem>
                  <SelectItem value="mayorista">Mayorista</SelectItem>
                  <SelectItem value="estacion-servicio">Estación de Servicio</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="subChannel">Sub-canal</Label>
              <Input
                id="subChannel"
                placeholder="Ej: Tradicional, Cadena, etc."
                value={formData.subChannel}
                onChange={(e) => setFormData({ ...formData, subChannel: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Distributor */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-slate-900">Distribuidor</h3>

            <div className="space-y-2">
              <Label htmlFor="distributor">Distribuidor Asociado</Label>
              <Select
                value={formData.distributorId}
                onValueChange={(value) => setFormData({ ...formData, distributorId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar distribuidor" />
                </SelectTrigger>
                <SelectContent>
                  {distributors.map((d) => (
                    <SelectItem key={d.DistributorId} value={String(d.DistributorId)}>
                      {d.Name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Contact Info */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-slate-900">Contacto</h3>

            <div className="space-y-2">
              <Label htmlFor="contactName">Nombre del Responsable</Label>
              <Input
                id="contactName"
                placeholder="Nombre y apellido"
                value={formData.contactName}
                onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contactPhone">Teléfono</Label>
              <Input
                id="contactPhone"
                type="tel"
                placeholder="+54 11 1234-5678"
                value={formData.contactPhone}
                onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Photos */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Fotos Iniciales</h3>
              <Badge variant="outline">{photos.length} fotos</Badge>
            </div>

            <Button type="button" variant="outline" className="w-full" onClick={handleTakePhoto}>
              <Camera size={18} className="mr-2" />
              Tomar Foto del Frente
            </Button>

            {photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {photos.map((photo, index) => (
                  <img
                    key={index}
                    src={photo}
                    alt={`Foto ${index + 1}`}
                    className="w-full h-24 object-cover rounded-lg"
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Observations */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-slate-900">Observaciones</h3>

            <div className="space-y-2">
              <Label htmlFor="observations">Información Adicional</Label>
              <Textarea
                id="observations"
                placeholder="Cualquier información relevante sobre el punto de venta"
                rows={4}
                value={formData.observations}
                onChange={(e) => setFormData({ ...formData, observations: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Info Banner */}
        <Card className="bg-yellow-50 border-yellow-200">
          <CardContent className="p-4">
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="mt-0.5 bg-yellow-600 text-white border-yellow-600">
                Pendiente
              </Badge>
              <div className="flex-1">
                <p className="text-sm font-semibold text-yellow-900 mb-1">
                  PDV en Validación
                </p>
                <p className="text-xs text-yellow-800">
                  El punto de venta será enviado para validación por el equipo administrativo antes de ser activado en el sistema
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Submit Button */}
        <div className="fixed bottom-20 left-0 right-0 bg-white border-t border-slate-200 p-4">
          <Button type="submit" className="w-full h-12 text-base font-semibold" disabled={loading}>
            <Send className="mr-2" size={18} />
            {loading ? "Enviando..." : "Enviar para Validación"}
          </Button>
        </div>
      </form>
    </div>
  );
}
