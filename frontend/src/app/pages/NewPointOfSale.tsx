import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import { ArrowLeft, MapPin, Camera, Send, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { pdvsApi, distributorsApi, ApiError } from "@/lib/api";
import { useChannels, useSubChannels } from "@/lib/api";
import { GpsCaptureButton } from "../components/GpsCaptureButton";
import { LocationMap } from "../components/LocationMap";
import type { Distributor } from "@/lib/api/types";
import { getCurrentUser } from "../lib/auth";

interface ContactForm {
  contactName: string;
  contactPhone: string;
  birthday: string;
}

export function NewPointOfSale() {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();

  const [formData, setFormData] = useState({
    name: "",
    address: "",
    channelId: "" as number | "",
    subChannelId: "" as number | "",
    distributorId: "",
    observations: "",
    lat: null as number | null,
    lon: null as number | null,
  });

  const [contacts, setContacts] = useState<ContactForm[]>([
    { contactName: "", contactPhone: "", birthday: "" },
  ]);

  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [loading, setLoading] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);

  const { data: channels } = useChannels();
  const { data: subchannels } = useSubChannels(formData.channelId || null);

  useEffect(() => {
    distributorsApi.list().then((list) => setDistributors(list)).catch(() => {});
  }, []);

  const handleTakePhoto = () => {
    const mockPhoto = "https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a";
    setPhotos([...photos, mockPhoto]);
    toast.success("Foto capturada");
  };

  const addContact = () => {
    setContacts([...contacts, { contactName: "", contactPhone: "", birthday: "" }]);
  };

  const removeContact = (index: number) => {
    if (contacts.length > 1) {
      setContacts(contacts.filter((_, i) => i !== index));
    }
  };

  const updateContact = (index: number, field: keyof ContactForm, value: string) => {
    setContacts(
      contacts.map((c, i) => (i === index ? { ...c, [field]: value } : c))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.address || !formData.channelId) {
      toast.error("Por favor completa los campos obligatorios");
      return;
    }

    setLoading(true);
    try {
      const contactsToSend = contacts
        .filter((c) => c.contactName.trim())
        .map((c) => ({
          ContactName: c.contactName.trim(),
          ContactPhone: c.contactPhone.trim() || undefined,
          Birthday: c.birthday || undefined,
        }));

      await pdvsApi.create({
        Name: formData.name,
        Address: formData.address,
        ChannelId: Number(formData.channelId),
        SubChannelId: formData.subChannelId ? Number(formData.subChannelId) : undefined,
        ZoneId: currentUser.zoneId ?? undefined,
        DistributorId: formData.distributorId ? Number(formData.distributorId) : undefined,
        Lat: formData.lat ?? undefined,
        Lon: formData.lon ?? undefined,
        Contacts: contactsToSend.length > 0 ? contactsToSend : undefined,
      });
      toast.success("PDV creado correctamente");
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
              <GpsCaptureButton
                onCapture={({ lat, lon }) =>
                  setFormData((f) => ({ ...f, lat, lon }))
                }
                className="w-full"
              >
                Usar ubicación GPS actual
              </GpsCaptureButton>
              {formData.lat != null && formData.lon != null && (
                <>
                  <p className="text-xs text-slate-500">
                    Coordenadas: {Number(formData.lat).toFixed(6)}, {Number(formData.lon).toFixed(6)}
                  </p>
                  <LocationMap
                    lat={Number(formData.lat)}
                    lon={Number(formData.lon)}
                    height="180px"
                    className="mt-2"
                    popupText="Ubicación capturada"
                  />
                </>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="channel">
                Canal <span className="text-red-600">*</span>
              </Label>
              <Select
                value={formData.channelId ? String(formData.channelId) : ""}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    channelId: value ? Number(value) : "",
                    subChannelId: "",
                  })
                }
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar canal" />
                </SelectTrigger>
                <SelectContent>
                  {channels.map((ch) => (
                    <SelectItem key={ch.ChannelId} value={String(ch.ChannelId)}>
                      {ch.Name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="subChannel">Sub-canal</Label>
              <Select
                value={formData.subChannelId ? String(formData.subChannelId) : ""}
                onValueChange={(value) =>
                  setFormData({ ...formData, subChannelId: value ? Number(value) : "" })
                }
                disabled={!formData.channelId}
              >
                <SelectTrigger>
                  <SelectValue placeholder={formData.channelId ? "Seleccionar subcanal" : "Primero selecciona un canal"} />
                </SelectTrigger>
                <SelectContent>
                  {subchannels.map((sc) => (
                    <SelectItem key={sc.SubChannelId} value={String(sc.SubChannelId)}>
                      {sc.Name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

        {/* Contact Info - múltiples */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Contactos</h3>
              <Button type="button" variant="outline" size="sm" onClick={addContact}>
                <Plus size={16} className="mr-1" />
                Agregar
              </Button>
            </div>

            {contacts.map((contact, index) => (
              <div key={index} className="p-3 bg-slate-50 rounded-lg space-y-2 border border-slate-200">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-slate-600">Contacto {index + 1}</span>
                  {contacts.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => removeContact(index)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  )}
                </div>
                <div className="space-y-2">
                  <Input
                    placeholder="Nombre y apellido"
                    value={contact.contactName}
                    onChange={(e) => updateContact(index, "contactName", e.target.value)}
                  />
                  <Input
                    type="tel"
                    placeholder="+54 11 1234-5678"
                    value={contact.contactPhone}
                    onChange={(e) => updateContact(index, "contactPhone", e.target.value)}
                  />
                  <Input
                    type="date"
                    placeholder="Cumpleaños"
                    value={contact.birthday}
                    onChange={(e) => updateContact(index, "birthday", e.target.value)}
                  />
                </div>
              </div>
            ))}
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

        {/* Submit Button */}
        <div className="fixed bottom-20 left-0 right-0 bg-white border-t border-slate-200 p-4">
          <Button type="submit" className="w-full h-12 text-base font-semibold" disabled={loading}>
            <Send className="mr-2" size={18} />
            {loading ? "Creando..." : "Crear PDV"}
          </Button>
        </div>
      </form>
    </div>
  );
}
