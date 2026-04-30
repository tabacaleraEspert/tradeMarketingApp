import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useJsApiLoader } from "@react-google-maps/api";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import { ArrowLeft, MapPin, Camera, Send, Plus, Trash2, Search, Crosshair, AlertTriangle, Info } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "../components/ui/tooltip";
import { toast } from "sonner";
import { pdvsApi, pdvPhotosApi, pdvNotesApi, distributorsApi, routesApi, ApiError } from "@/lib/api";
import { useChannels, useSubChannels, useMyRoutes } from "@/lib/api";
import { LocationMap } from "../components/LocationMap";
import { AddressAutocomplete } from "../components/AddressAutocomplete";
import type { Distributor, Route } from "@/lib/api/types";
import { getCurrentUser } from "../lib/auth";

interface ContactForm {
  contactName: string;
  contactPhone: string;
  contactRole: string;
  decisionPower: string;
  birthday: string;
  notes: string;
  profileNotes: string;
}

export function NewPointOfSale() {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();

  const [formData, setFormData] = useState({
    name: "",
    address: "",
    channelId: "" as number | "",
    subChannelId: "" as number | "",
    monthlyVolume: "" as number | "",
    distributorId: "",
    observations: "",
    lat: null as number | null,
    lon: null as number | null,
  });

  const [contacts, setContacts] = useState<ContactForm[]>([
    { contactName: "", contactPhone: "", contactRole: "", decisionPower: "", birthday: "", notes: "", profileNotes: "" },
  ]);

  // Franjas horarias
  const [timeSlots, setTimeSlots] = useState<{ from: string; to: string; label: string }[]>([
    { from: "08:00", to: "13:00", label: "Mañana" },
  ]);

  // Distribuidores: seleccionados de la lista + nuevos creados inline
  const [selectedDistributorIds, setSelectedDistributorIds] = useState<number[]>([]);
  const [newDistributors, setNewDistributors] = useState<{ name: string; phone: string }[]>([]);

  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<number | "">("");
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);
  const [photos, setPhotos] = useState<{ url: string; file: File }[]>([]);

  const userId = Number(currentUser.id) || undefined;
  const { data: myRoutes } = useMyRoutes(userId);

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

  const photoInputRef = useRef<HTMLInputElement>(null);

  const handleTakePhoto = () => {
    photoInputRef.current?.click();
  };

  const handlePhotoSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Sólo se permiten imágenes");
      return;
    }
    const localUrl = URL.createObjectURL(file);
    setPhotos([...photos, { url: localUrl, file }]);
    toast.success("Foto capturada");
  };

  const addContact = () => {
    setContacts([...contacts, { contactName: "", contactPhone: "", contactRole: "", decisionPower: "", birthday: "", notes: "", profileNotes: "" }]);
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

    if (submittingRef.current) return;

    if (!formData.name.trim() || !formData.address.trim() || !formData.channelId) {
      toast.error("Por favor completa los campos obligatorios");
      return;
    }

    if (addressOutOfRange) {
      toast.error(
        `La dirección está a ${Math.round(addressDistance!)}m de la ubicación capturada (máx. ${ADDRESS_MAX_DISTANCE_M}m)`
      );
      return;
    }

    submittingRef.current = true;
    setLoading(true);
    try {
      const contactsToSend = contacts
        .filter((c) => c.contactName.trim())
        .map((c) => ({
          ContactName: c.contactName.trim(),
          ContactPhone: c.contactPhone.trim() || undefined,
          ContactRole: c.contactRole || undefined,
          DecisionPower: c.decisionPower || undefined,
          Birthday: c.birthday || undefined,
          Notes: c.notes?.trim() || undefined,
          ProfileNotes: c.profileNotes?.trim() || undefined,
        }));

      // Time slots → OpeningTime/ClosingTime (first slot) + TimeSlotsJson (all)
      const validSlots = timeSlots.filter((s) => s.from && s.to);
      const newPdv = await pdvsApi.create({
        Name: formData.name.trim(),
        Address: formData.address.trim(),
        ChannelId: Number(formData.channelId),
        SubChannelId: formData.subChannelId ? Number(formData.subChannelId) : undefined,
        ZoneId: currentUser.zoneId ?? undefined,
        DistributorId: selectedDistributorIds[0] || undefined,
        DistributorIds: selectedDistributorIds.length > 0 ? selectedDistributorIds : undefined,
        Lat: formData.lat ?? undefined,
        Lon: formData.lon ?? undefined,
        OpeningTime: validSlots[0]?.from || undefined,
        ClosingTime: validSlots[0]?.to || undefined,
        TimeSlotsJson: validSlots.length > 0 ? JSON.stringify(validSlots) : undefined,
        MonthlyVolume: formData.monthlyVolume !== "" ? Number(formData.monthlyVolume) : undefined,
        Contacts: contactsToSend.length > 0 ? contactsToSend : undefined,
      });

      if (newPdv?.PdvId) {
        // Upload photos
        const failedPhotos: number[] = [];
        for (let i = 0; i < photos.length; i++) {
          try {
            await pdvPhotosApi.upload(newPdv.PdvId, photos[i].file, {
              photoType: "fachada",
              sortOrder: i + 1,
            });
          } catch {
            failedPhotos.push(i + 1);
          }
        }
        if (failedPhotos.length > 0) {
          toast.warning(`No se pudieron subir ${failedPhotos.length} foto(s)`);
        }

        // Save observations as PdvNote
        const obs = formData.observations.trim();
        if (obs) {
          try {
            await pdvNotesApi.create(newPdv.PdvId, { Content: obs, CreatedByUserId: userId });
          } catch {
            toast.warning("Observaciones no se pudieron guardar");
          }
        }

        // Create new distributors and associate them
        const allDistributorIds = [...selectedDistributorIds];
        const failedDistributors: string[] = [];
        for (const nd of newDistributors) {
          if (!nd.name.trim()) continue;
          try {
            const created = await distributorsApi.create({ Name: nd.name.trim(), Phone: nd.phone.trim() || undefined });
            allDistributorIds.push(created.DistributorId);
          } catch {
            failedDistributors.push(nd.name.trim());
          }
        }
        if (failedDistributors.length > 0) {
          toast.warning(`No se pudieron crear distribuidores: ${failedDistributors.join(", ")}`);
        }
        // Update PDV with all distributor IDs if we created new ones
        if (allDistributorIds.length > selectedDistributorIds.length) {
          try {
            await pdvsApi.update(newPdv.PdvId, { DistributorIds: allDistributorIds });
          } catch {
            toast.warning("No se pudieron asociar los nuevos distribuidores al PDV");
          }
        }
      }

      // Add to route if selected
      if (selectedRouteId && newPdv?.PdvId) {
        try {
          await routesApi.addPdv(Number(selectedRouteId), { PdvId: newPdv.PdvId, SortOrder: 999, Priority: 3 });
          const routeName = myRoutes.find((r) => r.RouteId === Number(selectedRouteId))?.Name;
          toast.success(`PDV creado y agregado a ${routeName}`);
        } catch {
          toast.success("PDV creado, pero no se pudo agregar a la ruta");
        }
      } else {
        toast.success("PDV creado correctamente");
      }
      navigate("/");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Error al crear el PDV");
    } finally {
      submittingRef.current = false;
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
              <div className="flex items-center gap-1.5">
                <Label htmlFor="channel">
                  Canal <span className="text-red-600">*</span>
                </Label>
                {formData.channelId && channels.find((c) => c.ChannelId === Number(formData.channelId))?.Description && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="text-muted-foreground hover:text-foreground">
                        <Info size={14} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[260px]">
                      {channels.find((c) => c.ChannelId === Number(formData.channelId))?.Description}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
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
                      <span>{ch.Name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {formData.channelId && channels.find((c) => c.ChannelId === Number(formData.channelId))?.Description && (
                <p className="text-xs text-muted-foreground">
                  {channels.find((c) => c.ChannelId === Number(formData.channelId))?.Description}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="subChannel">Sub-canal</Label>
                {formData.subChannelId && subchannels.find((s) => s.SubChannelId === Number(formData.subChannelId))?.Description && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="text-muted-foreground hover:text-foreground">
                        <Info size={14} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[260px]">
                      {subchannels.find((s) => s.SubChannelId === Number(formData.subChannelId))?.Description}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
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
                      <span>{sc.Name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {formData.subChannelId && subchannels.find((s) => s.SubChannelId === Number(formData.subChannelId))?.Description && (
                <p className="text-xs text-muted-foreground">
                  {subchannels.find((s) => s.SubChannelId === Number(formData.subChannelId))?.Description}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="monthlyVolume">Volumen mensual (atados)</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground hover:text-foreground">
                      <Info size={14} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[260px]">
                    Estimación de atados de cigarrillos vendidos por mes (toda la categoría). Para PDVs nuevos, estimar en la primera visita.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="monthlyVolume"
                type="number"
                min={0}
                placeholder="Ej: 500"
                value={formData.monthlyVolume === "" ? "" : formData.monthlyVolume}
                onChange={(e) =>
                  setFormData({ ...formData, monthlyVolume: e.target.value ? Number(e.target.value) : "" })
                }
              />
              {formData.monthlyVolume !== "" && (
                <Badge
                  variant={
                    formData.monthlyVolume > 1500 ? "default" :
                    formData.monthlyVolume > 800 ? "secondary" : "outline"
                  }
                >
                  {formData.monthlyVolume > 1500 ? "Grande" :
                   formData.monthlyVolume > 800 ? "Mediano" : "Chico"}
                  {" — "}
                  {formData.monthlyVolume > 1500 ? "más de 1.500 atados/mes" :
                   formData.monthlyVolume > 800 ? "800 a 1.500 atados/mes" : "0 a 800 atados/mes"}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Franjas horarias */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground">Horarios de atención</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setTimeSlots([...timeSlots, { from: "14:00", to: "18:00", label: "" }])}
              >
                <Plus size={16} className="mr-1" />
                Franja
              </Button>
            </div>

            {/* Quick presets */}
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: "Corrido 8-20", slots: [{ from: "08:00", to: "20:00", label: "Corrido" }] },
                { label: "Mañana + Tarde", slots: [{ from: "08:00", to: "13:00", label: "Mañana" }, { from: "16:00", to: "20:00", label: "Tarde" }] },
                { label: "Mañana sola", slots: [{ from: "08:00", to: "13:00", label: "Mañana" }] },
                { label: "24hs", slots: [{ from: "00:00", to: "23:59", label: "24hs" }] },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setTimeSlots(preset.slots)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium border border-border text-muted-foreground hover:bg-muted transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {timeSlots.map((slot, idx) => {
              const [fromH = "08", fromM = "00"] = slot.from.split(":");
              const [toH = "20", toM = "00"] = slot.to.split(":");
              const updateTime = (field: "from" | "to", h: string, m: string) => {
                const updated = [...timeSlots];
                updated[idx] = { ...slot, [field]: `${h.padStart(2, "0")}:${m.padStart(2, "0")}` };
                setTimeSlots(updated);
              };
              return (
                <div key={idx} className="p-3 bg-muted/50 rounded-lg border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <Input
                      placeholder="Ej: Mañana"
                      value={slot.label}
                      onChange={(e) => {
                        const updated = [...timeSlots];
                        updated[idx] = { ...slot, label: e.target.value };
                        setTimeSlots(updated);
                      }}
                      className="flex-1 h-8 text-sm"
                    />
                    {timeSlots.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setTimeSlots(timeSlots.filter((_, i) => i !== idx))}
                        className="p-1.5 ml-2 text-red-400 hover:text-red-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 flex-1">
                      <select value={fromH} onChange={(e) => updateTime("from", e.target.value, fromM)} className="h-10 px-2 border border-border rounded-md text-sm bg-background flex-1 text-center">
                        {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                      <span className="text-muted-foreground font-bold">:</span>
                      <select value={fromM} onChange={(e) => updateTime("from", fromH, e.target.value)} className="h-10 px-2 border border-border rounded-md text-sm bg-background flex-1 text-center">
                        {["00", "15", "30", "45"].map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <span className="text-muted-foreground text-xs font-medium">a</span>
                    <div className="flex items-center gap-1 flex-1">
                      <select value={toH} onChange={(e) => updateTime("to", e.target.value, toM)} className="h-10 px-2 border border-border rounded-md text-sm bg-background flex-1 text-center">
                        {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                      <span className="text-muted-foreground font-bold">:</span>
                      <select value={toM} onChange={(e) => updateTime("to", toH, e.target.value)} className="h-10 px-2 border border-border rounded-md text-sm bg-background flex-1 text-center">
                        {["00", "15", "30", "45"].map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              );
            })}

            {timeSlots.length === 0 && (
              <p className="text-xs text-muted-foreground">Sin horario definido. Agregá una franja o usá un preset.</p>
            )}
          </CardContent>
        </Card>

        {/* Distributors */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground">Distribuidores</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setNewDistributors([...newDistributors, { name: "", phone: "" }])}
              >
                <Plus size={16} className="mr-1" />
                Nuevo
              </Button>
            </div>

            {/* Select from existing */}
            <div className="space-y-2">
              <Label>De la lista</Label>
              <div className="flex flex-wrap gap-2">
                {distributors.map((d) => {
                  const selected = selectedDistributorIds.includes(d.DistributorId);
                  return (
                    <button
                      key={d.DistributorId}
                      type="button"
                      onClick={() =>
                        setSelectedDistributorIds((prev) =>
                          selected ? prev.filter((id) => id !== d.DistributorId) : [...prev, d.DistributorId]
                        )
                      }
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        selected
                          ? "bg-[#A48242]/10 border-[#A48242] text-[#A48242]"
                          : "bg-muted border-border text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {d.Name}
                    </button>
                  );
                })}
                {distributors.length === 0 && (
                  <p className="text-xs text-muted-foreground">No hay distribuidores cargados</p>
                )}
              </div>
            </div>

            {/* New distributors inline */}
            {newDistributors.map((nd, idx) => (
              <div key={idx} className="p-3 bg-muted rounded-lg space-y-2 border border-border">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-muted-foreground">Nuevo distribuidor</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:text-red-700"
                    onClick={() => setNewDistributors(newDistributors.filter((_, i) => i !== idx))}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Nombre del distribuidor"
                    value={nd.name}
                    onChange={(e) => {
                      const updated = [...newDistributors];
                      updated[idx] = { ...nd, name: e.target.value };
                      setNewDistributors(updated);
                    }}
                    className="flex-1"
                  />
                  <Input
                    type="tel"
                    placeholder="Teléfono"
                    value={nd.phone}
                    onChange={(e) => {
                      const updated = [...newDistributors];
                      updated[idx] = { ...nd, phone: e.target.value };
                      setNewDistributors(updated);
                    }}
                    className="w-36"
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Route assignment */}
        {myRoutes.length > 0 && (
          <Card>
            <CardContent className="p-4 space-y-4">
              <h3 className="font-semibold text-foreground">Agregar a Ruta Foco</h3>
              <Select
                value={selectedRouteId ? String(selectedRouteId) : ""}
                onValueChange={(value) => setSelectedRouteId(value ? Number(value) : "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sin asignar a ruta (opcional)" />
                </SelectTrigger>
                <SelectContent>
                  {myRoutes.map((r) => (
                    <SelectItem key={r.RouteId} value={String(r.RouteId)}>
                      {r.Name} ({r.PdvCount} PDVs)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        )}

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
                  <div className="flex gap-2">
                    <Input
                      placeholder="Nombre y apellido"
                      value={contact.contactName}
                      onChange={(e) => updateContact(index, "contactName", e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      type="tel"
                      placeholder="Teléfono"
                      value={contact.contactPhone}
                      onChange={(e) => updateContact(index, "contactPhone", e.target.value)}
                      className="flex-1"
                    />
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={contact.contactRole}
                      onChange={(e) => updateContact(index, "contactRole", e.target.value)}
                      className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Rol...</option>
                      <option value="dueño">Dueño</option>
                      <option value="empleado">Empleado</option>
                      <option value="encargado">Encargado</option>
                    </select>
                    <select
                      value={contact.decisionPower}
                      onChange={(e) => updateContact(index, "decisionPower", e.target.value)}
                      className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Decisión...</option>
                      <option value="alto">Alto</option>
                      <option value="medio">Medio</option>
                      <option value="bajo">Bajo</option>
                    </select>
                    <Input
                      type="date"
                      placeholder="Cumpleaños"
                      value={contact.birthday}
                      onChange={(e) => updateContact(index, "birthday", e.target.value)}
                      className="w-36"
                    />
                  </div>
                  <textarea
                    placeholder="Observaciones (notas operativas)"
                    value={contact.notes}
                    onChange={(e) => updateContact(index, "notes", e.target.value)}
                    rows={2}
                    className="w-full text-xs px-3 py-2 border border-border rounded-md resize-none"
                  />
                  <textarea
                    placeholder="Perfil del contacto (preferencias, qué evitar...)"
                    value={contact.profileNotes}
                    onChange={(e) => updateContact(index, "profileNotes", e.target.value)}
                    rows={2}
                    className="w-full text-xs px-3 py-2 border border-border rounded-md resize-none"
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
                    src={photo.url}
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
        <div className="sticky bottom-0 bg-card border-t border-border p-3 pb-[env(safe-area-inset-bottom)]">
          <Button type="submit" className="w-full h-12 text-base font-semibold" disabled={loading || addressOutOfRange}>
            <Send className="mr-2" size={18} />
            {loading ? "Creando..." : "Crear PDV"}
          </Button>
        </div>
      </form>

      {/* File input outside form to prevent iOS issues with capture */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePhotoSelected}
      />
    </div>
  );
}
