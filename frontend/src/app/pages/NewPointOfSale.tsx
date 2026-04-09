import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useJsApiLoader } from "@react-google-maps/api";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import { ArrowLeft, MapPin, Camera, Send, Plus, Trash2, Search, Crosshair, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { pdvsApi, distributorsApi, ApiError } from "@/lib/api";
import { useChannels, useSubChannels } from "@/lib/api";
import { LocationMap } from "../components/LocationMap";
import { AddressAutocomplete } from "../components/AddressAutocomplete";
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

  const { isLoaded: isMapsLoaded } = useJsApiLoader({
    id: "google-map-script-places",
    googleMapsApiKey: (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) || " ",
    libraries: ["places"],
    preventGoogleFontsLoading: true,
  });

  const [geocoding, setGeocoding] = useState(false);
  const [capturingLocation, setCapturingLocation] = useState(false);
  const [capturedGps, setCapturedGps] = useState<{ lat: number; lon: number } | null>(null);
  const ADDRESS_MAX_DISTANCE_M = 300;

  // Haversine distance in meters
  const distanceMetersBetween = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };

  const addressDistance =
    capturedGps && formData.lat != null && formData.lon != null
      ? distanceMetersBetween(capturedGps.lat, capturedGps.lon, Number(formData.lat), Number(formData.lon))
      : null;
  const addressOutOfRange = addressDistance !== null && addressDistance > ADDRESS_MAX_DISTANCE_M;

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error("GPS no disponible en este navegador");
      return;
    }
    if (!isMapsLoaded || typeof google === "undefined" || !google.maps) {
      toast.error("Espera a que cargue el mapa");
      return;
    }
    setCapturingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setCapturedGps({ lat: latitude, lon: longitude });
        // Reverse geocode
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode(
          { location: { lat: latitude, lng: longitude } },
          (results, status) => {
            setCapturingLocation(false);
            if (status === "OK" && results?.[0]) {
              const addr = results[0].formatted_address;
              setFormData((f) => ({ ...f, address: addr, lat: latitude, lon: longitude }));
              toast.success("Ubicación capturada");
            } else {
              setFormData((f) => ({ ...f, lat: latitude, lon: longitude }));
              toast.warning("Ubicación capturada, pero no se pudo obtener la dirección");
            }
          }
        );
      },
      (err) => {
        setCapturingLocation(false);
        if (err.code === err.PERMISSION_DENIED) toast.error("Permiso de ubicación denegado");
        else toast.error("No se pudo obtener la ubicación");
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const handleGeocodeAddress = () => {
    const addr = formData.address?.trim();
    if (!addr || !isMapsLoaded || typeof google === "undefined" || !google.maps) {
      toast.error("Escribe una dirección y espera a que cargue el mapa");
      return;
    }
    setGeocoding(true);
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address: addr }, (results, status) => {
      setGeocoding(false);
      if (status === "OK" && results?.[0]) {
        const loc = results[0].geometry.location;
        const lat = loc.lat();
        const lon = loc.lng();
        const formattedAddr = results[0].formatted_address || addr;
        setFormData((f) => ({ ...f, address: formattedAddr, lat, lon }));
        toast.success("Ubicación encontrada");
      } else {
        toast.error("No se pudo encontrar la ubicación. Intenta con una dirección más específica.");
      }
    });
  };

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

    if (addressOutOfRange) {
      toast.error(
        `La dirección está a ${Math.round(addressDistance!)}m de la ubicación capturada (máx. ${ADDRESS_MAX_DISTANCE_M}m)`
      );
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
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="bg-card border-b border-border p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Alta de Nuevo PDV</h1>
            <p className="text-sm text-muted-foreground">Registro rápido en campo</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-4 space-y-4">
        {/* Basic Info */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-semibold text-foreground">Información Básica</h3>
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleUseCurrentLocation}
                disabled={capturingLocation || !isMapsLoaded}
                className="w-full"
              >
                <Crosshair size={16} className="mr-2" />
                {capturingLocation ? "Obteniendo ubicación..." : "Usar mi ubicación actual"}
              </Button>
              {capturedGps && (
                <p className="text-xs text-muted-foreground">
                  Ubicación capturada: {capturedGps.lat.toFixed(6)}, {capturedGps.lon.toFixed(6)}
                </p>
              )}
              <AddressAutocomplete
                id="address"
                value={formData.address}
                onChange={(address) => setFormData((f) => ({ ...f, address }))}
                onPlaceSelect={({ address, lat, lon }) =>
                  setFormData((f) => ({ ...f, address, lat, lon }))
                }
                placeholder="Buscar dirección (ej: Av. Corrientes 1234)"
              />
              {formData.address.trim() && (formData.lat == null || formData.lon == null) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleGeocodeAddress}
                  disabled={geocoding || !isMapsLoaded}
                  className="w-full"
                >
                  <Search size={16} className="mr-2" />
                  {geocoding ? "Buscando..." : "Buscar ubicación en mapa"}
                </Button>
              )}
              {addressOutOfRange && (
                <div className="flex items-start gap-2 p-2 bg-red-50 border border-red-200 rounded-lg">
                  <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">
                    La dirección está a <strong>{Math.round(addressDistance!)}m</strong> de tu ubicación capturada.
                    Máximo permitido: {ADDRESS_MAX_DISTANCE_M}m.
                  </p>
                </div>
              )}
              {addressDistance !== null && !addressOutOfRange && (
                <p className="text-xs text-green-700">
                  Dirección a {Math.round(addressDistance)}m de la ubicación capturada ✓
                </p>
              )}
              {formData.lat != null && formData.lon != null && (
                <>
                  <p className="text-xs text-muted-foreground">
                    Coordenadas: {Number(formData.lat).toFixed(6)}, {Number(formData.lon).toFixed(6)}
                  </p>
                  <LocationMap
                    lat={Number(formData.lat)}
                    lon={Number(formData.lon)}
                    height="180px"
                    className="mt-2"
                    popupText={formData.address || "Ubicación de la dirección"}
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
            <h3 className="font-semibold text-foreground">Distribuidor</h3>

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
              <h3 className="font-semibold text-foreground">Contactos</h3>
              <Button type="button" variant="outline" size="sm" onClick={addContact}>
                <Plus size={16} className="mr-1" />
                Agregar
              </Button>
            </div>

            {contacts.map((contact, index) => (
              <div key={index} className="p-3 bg-muted rounded-lg space-y-2 border border-border">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-muted-foreground">Contacto {index + 1}</span>
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
              <h3 className="font-semibold text-foreground">Fotos Iniciales</h3>
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
            <h3 className="font-semibold text-foreground">Observaciones</h3>

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
        <div className="sticky bottom-0 bg-card border-t border-border p-3">
          <Button type="submit" className="w-full h-12 text-base font-semibold" disabled={loading || addressOutOfRange}>
            <Send className="mr-2" size={18} />
            {loading ? "Creando..." : "Crear PDV"}
          </Button>
        </div>
      </form>
    </div>
  );
}
