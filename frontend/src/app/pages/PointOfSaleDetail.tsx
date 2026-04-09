import { useState, useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { Modal, ConfirmModal } from "../components/ui/modal";
import {
  ArrowLeft,
  MapPin,
  Phone,
  Building2,
  User,
  Clock,
  TrendingUp,
  AlertCircle,
  Camera,
  FileText,
  History as HistoryIcon,
  Navigation,
  Edit,
  Trash2,
  Plus,
  Cake,
  MessageSquare,
} from "lucide-react";
import { pdvsApi, visitsApi, useZones, useDistributors, useChannels, useSubChannels } from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { GpsCaptureButton } from "../components/GpsCaptureButton";
import { LocationMap } from "../components/LocationMap";
import { toast } from "sonner";

export function PointOfSaleDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const routeDayId = (location.state as { routeDayId?: number } | null)?.routeDayId;
  const [pos, setPos] = useState<Awaited<ReturnType<typeof pdvsApi.get>> | null>(null);
  const [visits, setVisits] = useState<Awaited<ReturnType<typeof visitsApi.list>>>([]);
  const [loading, setLoading] = useState(true);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    channelId: "" as number | "",
    subChannelId: "" as number | "",
    address: "",
    zoneId: "" as number | "",
    distributorId: "" as number | "",
    isActive: true,
    lat: null as number | null,
    lon: null as number | null,
    contacts: [] as { ContactName: string; ContactPhone?: string; ContactRole?: string; DecisionPower?: string; Birthday?: string }[],
  });

  const { data: zones } = useZones();
  const { data: distributors } = useDistributors();
  const { data: channels } = useChannels();
  const { data: subchannels } = useSubChannels(formData.channelId || null);

  const loadData = () => {
    if (!id) return;
    const pdvId = Number(id);
    Promise.all([
      pdvsApi.get(pdvId).catch(() => null),
      visitsApi.list({ pdv_id: pdvId }),
    ]).then(([p, v]) => {
      setPos(p);
      setVisits(v);
      if (p) {
        const contactsFromPdv = p.Contacts?.length
          ? p.Contacts.map((c) => ({
              ContactName: c.ContactName,
              ContactPhone: c.ContactPhone || undefined,
              ContactRole: c.ContactRole || undefined,
              DecisionPower: c.DecisionPower || undefined,
              Birthday: c.Birthday || undefined,
            }))
          : p.ContactName
          ? [{ ContactName: p.ContactName, ContactPhone: p.ContactPhone || undefined }]
          : [];
        setFormData({
          name: p.Name,
          channelId: p.ChannelId ?? "",
          subChannelId: p.SubChannelId ?? "",
          address: p.Address || "",
          zoneId: p.ZoneId ?? "",
          distributorId: p.DistributorId ?? "",
          isActive: p.IsActive,
          lat: p.Lat != null ? Number(p.Lat) : null,
          lon: p.Lon != null ? Number(p.Lon) : null,
          contacts: contactsFromPdv,
        });
      }
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, [id]);

  const openEditModal = () => {
    if (pos) {
      const contactsFromPdv = pos.Contacts?.length
        ? pos.Contacts.map((c) => ({
            ContactName: c.ContactName,
            ContactPhone: c.ContactPhone || undefined,
            Birthday: c.Birthday || undefined,
          }))
        : pos.ContactName
        ? [{ ContactName: pos.ContactName, ContactPhone: pos.ContactPhone || undefined }]
        : [];
      setFormData({
        name: pos.Name,
        channelId: pos.ChannelId ?? "",
        subChannelId: pos.SubChannelId ?? "",
        address: pos.Address || "",
        zoneId: pos.ZoneId ?? "",
        distributorId: pos.DistributorId ?? "",
        isActive: pos.IsActive,
        lat: pos.Lat != null ? Number(pos.Lat) : null,
        lon: pos.Lon != null ? Number(pos.Lon) : null,
        contacts: contactsFromPdv.length > 0 ? contactsFromPdv : [{ ContactName: "", ContactPhone: "", ContactRole: "", DecisionPower: "", Birthday: "" }],
      });
      setIsEditModalOpen(true);
    }
  };

  const handleSave = async () => {
    if (!id || !formData.name || !formData.channelId) {
      toast.error("Nombre y canal son obligatorios");
      return;
    }
    setSaving(true);
    try {
      const contactsToSend = formData.contacts
        .filter((c) => c.ContactName.trim())
        .map((c) => ({
          ContactName: c.ContactName.trim(),
          ContactPhone: c.ContactPhone?.trim() || undefined,
          ContactRole: c.ContactRole?.trim() || undefined,
          DecisionPower: c.DecisionPower?.trim() || undefined,
          Birthday: c.Birthday || undefined,
        }));
      await pdvsApi.update(Number(id), {
        Name: formData.name,
        ChannelId: Number(formData.channelId),
        SubChannelId: formData.subChannelId ? Number(formData.subChannelId) : undefined,
        Address: formData.address || undefined,
        ZoneId: formData.zoneId || undefined,
        DistributorId: formData.distributorId || undefined,
        IsActive: formData.isActive,
        Lat: formData.lat ?? undefined,
        Lon: formData.lon ?? undefined,
        Contacts: contactsToSend,
      });
      toast.success("PDV actualizado");
      setIsEditModalOpen(false);
      loadData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await pdvsApi.delete(Number(id));
      toast.success("PDV eliminado");
      navigate("/route");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al eliminar");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async () => {
    if (!id || !pos) return;
    const newActive = !pos.IsActive;
    setSaving(true);
    try {
      await pdvsApi.update(Number(id), { IsActive: newActive });
      setPos((p) => (p ? { ...p, IsActive: newActive } : null));
      toast.success(newActive ? "PDV activado" : "PDV desactivado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al actualizar");
    } finally {
      setSaving(false);
    }
  };

  const posVisits = visits;
  const lastClosedVisit = [...posVisits]
    .filter((v) => v.Status === "CLOSED" || v.Status === "COMPLETED")
    .sort((a, b) => new Date(b.ClosedAt ?? b.OpenedAt).getTime() - new Date(a.ClosedAt ?? a.OpenedAt).getTime())[0];
  const lastVisit = [...posVisits].sort(
    (a, b) => new Date(b.OpenedAt).getTime() - new Date(a.OpenedAt).getTime()
  )[0];

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Cargando...</p>
      </div>
    );
  }

  if (!pos) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Punto de venta no encontrado</p>
      </div>
    );
  }

  // Check if there's an OPEN visit right now (for this routeDay or any)
  const openVisit = posVisits.find((v) => v.Status === "OPEN" || v.Status === "IN_PROGRESS");
  const isVisitInProgress = !!openVisit;

  // Check if TODAY's visit for this routeDay is already completed
  const todayStr = new Date().toISOString().split("T")[0];
  const isTodayCompleted = routeDayId
    ? posVisits.some((v) =>
        v.RouteDayId === routeDayId &&
        (v.Status === "CLOSED" || v.Status === "COMPLETED")
      )
    : posVisits.some((v) =>
        v.OpenedAt.startsWith(todayStr) &&
        (v.Status === "CLOSED" || v.Status === "COMPLETED")
      );

  // Show check-in button when: coming from route day AND not yet visited today AND no open visit
  const canCheckIn = !isVisitInProgress && !isTodayCompleted;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">{pos.Name}</h1>
            <p className="text-sm text-muted-foreground">{pos.ChannelName || pos.Channel || "-"}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={openEditModal}>
              <Edit size={18} />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setIsDeleteModalOpen(true)}>
              <Trash2 size={18} className="text-red-600" />
            </Button>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Recordatorio próxima visita - al entrar al PDV */}
        {!isVisitInProgress && lastClosedVisit?.CloseReason && (
          <Card className="bg-amber-50 border-amber-200">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <MessageSquare size={22} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-amber-900 mb-1">Recordatorio próxima visita</h3>
                  <p className="text-sm text-amber-800">{lastClosedVisit.CloseReason}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main Info Card */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <span className="text-sm font-medium text-foreground">PDV activo</span>
              <Switch
                checked={pos.IsActive}
                onCheckedChange={handleToggleActive}
                disabled={saving}
              />
            </div>
            <div className="flex items-start gap-2">
              <MapPin size={18} className="text-muted-foreground mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-muted-foreground">Dirección</p>
                <p className="font-medium text-foreground">{pos.Address || pos.City || "-"}</p>
              </div>
            </div>

            {pos.Lat != null && pos.Lon != null && (
              <div className="mt-3">
                <LocationMap
                  lat={Number(pos.Lat)}
                  lon={Number(pos.Lon)}
                  height="180px"
                  popupText={pos.Name}
                />
              </div>
            )}

            <div className="flex items-start gap-2">
              <Building2 size={18} className="text-muted-foreground mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-muted-foreground">Distribuidor</p>
                <p className="font-medium text-foreground">{pos.DistributorId ? `Distribuidor #${pos.DistributorId}` : "-"}</p>
              </div>
            </div>

            {(pos.Contacts?.length ? pos.Contacts : pos.ContactName ? [{ ContactName: pos.ContactName, ContactPhone: pos.ContactPhone, ContactRole: null, DecisionPower: null, Birthday: null }] : []).map((c, i) => (
              <div key={i} className="space-y-1 p-2 bg-muted rounded-lg">
                <div className="flex items-start gap-2">
                  <User size={18} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-muted-foreground">Contacto</p>
                    <p className="font-medium text-foreground">{c.ContactName}</p>
                    {(c.ContactRole || c.DecisionPower) && (
                      <div className="flex gap-1 mt-1">
                        {c.ContactRole && <Badge variant="outline" className="text-xs">{c.ContactRole}</Badge>}
                        {c.DecisionPower && <Badge variant={c.DecisionPower === "alto" ? "default" : "secondary"} className="text-xs">Decisión: {c.DecisionPower}</Badge>}
                      </div>
                    )}
                  </div>
                </div>
                {c.ContactPhone && (
                  <div className="flex items-center gap-2 ml-6">
                    <Phone size={14} className="text-muted-foreground" />
                    <span className="text-sm text-foreground">{c.ContactPhone}</span>
                  </div>
                )}
                {c.Birthday && (
                  <div className="flex items-center gap-2 ml-6">
                    <Cake size={14} className="text-muted-foreground" />
                    <span className="text-sm text-foreground">
                      Cumpleaños: {new Date(c.Birthday).toLocaleDateString("es-AR", { day: "numeric", month: "long" })}
                    </span>
                  </div>
                )}
              </div>
            ))}

            {(pos?.Address || (pos?.Lat != null && pos?.Lon != null)) ? (
              <Button variant="outline" className="w-full mt-2" size="sm" asChild>
                <a
                  href={
                    pos.Address
                      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(pos.Address)}`
                      : `https://www.google.com/maps/dir/?api=1&destination=${pos!.Lat},${pos!.Lon}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Navigation size={16} className="mr-2" />
                  Cómo llegar
                </a>
              </Button>
            ) : (
              <Button variant="outline" className="w-full mt-2" size="sm" disabled>
                <Navigation size={16} className="mr-2" />
                Cómo llegar
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Performance Indicators */}
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold text-foreground mb-3">Indicadores</h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <TrendingUp size={16} className="text-green-600" />
                  <span className="text-2xl font-bold text-foreground">-</span>
                </div>
                <p className="text-xs text-muted-foreground">Cumplimiento</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Clock size={16} className="text-espert-gold" />
                  <span className="text-2xl font-bold text-foreground">
                    {posVisits.length}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">Visitas</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <AlertCircle size={16} className="text-green-600" />
                  <span className="text-2xl font-bold text-foreground">-</span>
                </div>
                <p className="text-xs text-muted-foreground">Incidencias</p>
              </div>
            </div>

            {lastVisit && (
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground">Última visita</p>
                <p className="text-sm font-medium text-foreground">
                  {new Date(lastVisit.OpenedAt).toLocaleDateString("es-AR", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              </div>
            )}
          </CardContent>
        </Card>


        {/* Action Buttons */}
        <div className="space-y-3 pb-4">
          {/* Check-in: show when can start a new visit */}
          {canCheckIn && (
            <Button
              className="w-full h-14 text-base font-semibold bg-[#A48242] hover:bg-[#8B6E38]"
              size="lg"
              onClick={() =>
                navigate(`/pos/${id}/checkin`, {
                  state: routeDayId ? { routeDayId } : undefined,
                })
              }
            >
              <MapPin className="mr-2" size={20} />
              Iniciar Visita — Check-in
            </Button>
          )}

          {/* Visit in progress: show relevamiento + photos + actions */}
          {isVisitInProgress && (
            <>
              <Card className="border-[#A48242] bg-[#A48242]/5">
                <CardContent className="p-3">
                  <p className="text-xs font-medium text-[#A48242] mb-2 flex items-center gap-1">
                    <Clock size={12} />
                    Visita en curso — {new Date(openVisit!.OpenedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                  <div className="space-y-2">
                    <Button
                      className="w-full h-12 text-sm font-semibold"
                      onClick={() =>
                        navigate(`/pos/${id}/survey`, {
                          state: { routeDayId, visitId: openVisit?.VisitId },
                        })
                      }
                    >
                      <FileText className="mr-2" size={18} />
                      Completar Relevamiento
                    </Button>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        className="h-10 text-xs"
                        onClick={() =>
                          navigate(`/pos/${id}/photos`, {
                            state: { routeDayId, visitId: openVisit?.VisitId },
                          })
                        }
                      >
                        <Camera className="mr-1.5" size={15} />
                        Fotos
                      </Button>
                      <Button
                        variant="outline"
                        className="h-10 text-xs"
                        onClick={() =>
                          navigate(`/pos/${id}/visit-actions`, {
                            state: { routeDayId, visitId: openVisit?.VisitId },
                          })
                        }
                      >
                        <FileText className="mr-1.5" size={15} />
                        Acciones
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {/* Today completed banner */}
          {isTodayCompleted && !isVisitInProgress && (
            <Card className="bg-green-50 border-green-200">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="bg-green-600 text-white p-1.5 rounded-full">
                  <TrendingUp size={16} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-green-900">Visita de hoy completada</p>
                  <p className="text-xs text-green-700">Relevamiento enviado</p>
                </div>
              </CardContent>
            </Card>
          )}

          <Button
            variant="outline"
            className="w-full h-11"
            onClick={() => navigate(`/pos/${id}/history`)}
          >
            <HistoryIcon className="mr-2" size={16} />
            Ver Histórico
          </Button>

          <Button variant="outline" className="w-full h-11" onClick={() => navigate("/alerts")}>
            <AlertCircle className="mr-2" size={16} />
            Reportar Incidencia
          </Button>
        </div>
      </div>

      {/* Edit Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title="Editar PDV"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsEditModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-4 border-b border-border">
            <label className="text-sm font-medium text-foreground">PDV activo</label>
            <Switch
              checked={formData.isActive}
              onCheckedChange={(checked) => setFormData((f) => ({ ...f, isActive: checked }))}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Nombre del PDV</label>
              <Input
                placeholder="Ej: Kiosco El Rápido"
                value={formData.name}
                onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Canal</label>
              <Select
                value={formData.channelId ? String(formData.channelId) : ""}
                onValueChange={(v) =>
                  setFormData((f) => ({ ...f, channelId: v ? Number(v) : "", subChannelId: "" }))
                }
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
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Sub-canal</label>
              <Select
                value={formData.subChannelId ? String(formData.subChannelId) : ""}
                onValueChange={(v) =>
                  setFormData((f) => ({ ...f, subChannelId: v ? Number(v) : "" }))
                }
                disabled={!formData.channelId}
              >
                <SelectTrigger>
                  <SelectValue placeholder={formData.channelId ? "Seleccionar subcanal" : "Primero selecciona canal"} />
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
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Dirección</label>
            <Input
              placeholder="Ej: Av. Santa Fe 1234, CABA"
              value={formData.address}
              onChange={(e) => setFormData((f) => ({ ...f, address: e.target.value }))}
            />
            <GpsCaptureButton
              onCapture={({ lat, lon }) =>
                setFormData((f) => ({ ...f, lat, lon }))
              }
              className="w-full mt-2"
            >
              Capturar ubicación GPS
            </GpsCaptureButton>
            {formData.lat != null && formData.lon != null && (
              <>
                <p className="text-xs text-muted-foreground mt-1">
                  Coordenadas: {Number(formData.lat).toFixed(6)}, {Number(formData.lon).toFixed(6)}
                </p>
                <LocationMap
                  lat={Number(formData.lat)}
                  lon={Number(formData.lon)}
                  height="160px"
                  className="mt-2"
                  popupText="Ubicación del PDV"
                />
              </>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-foreground">Contactos</label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setFormData((f) => ({
                    ...f,
                    contacts: [...f.contacts, { ContactName: "", ContactPhone: "", ContactRole: "", DecisionPower: "", Birthday: "" }],
                  }))
                }
              >
                <Plus size={14} className="mr-1" />
                Agregar
              </Button>
            </div>
            {formData.contacts.map((c, i) => (
              <div key={i} className="space-y-2 mb-2 p-3 bg-muted rounded-lg">
                <div className="flex gap-2">
                  <Input
                    placeholder="Nombre"
                    value={c.ContactName}
                    onChange={(e) =>
                      setFormData((f) => ({
                        ...f,
                        contacts: f.contacts.map((ct, j) =>
                          j === i ? { ...ct, ContactName: e.target.value } : ct
                        ),
                      }))
                    }
                    className="flex-1"
                  />
                  <Input
                    placeholder="Teléfono"
                    value={c.ContactPhone || ""}
                    onChange={(e) =>
                      setFormData((f) => ({
                        ...f,
                        contacts: f.contacts.map((ct, j) =>
                          j === i ? { ...ct, ContactPhone: e.target.value } : ct
                        ),
                      }))
                    }
                    className="flex-1"
                  />
                </div>
                <div className="flex gap-2">
                  <select
                    value={c.ContactRole || ""}
                    onChange={(e) =>
                      setFormData((f) => ({
                        ...f,
                        contacts: f.contacts.map((ct, j) =>
                          j === i ? { ...ct, ContactRole: e.target.value } : ct
                        ),
                      }))
                    }
                    className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Rol...</option>
                    <option value="dueño">Dueño</option>
                    <option value="empleado">Empleado</option>
                    <option value="encargado">Encargado</option>
                  </select>
                  <select
                    value={c.DecisionPower || ""}
                    onChange={(e) =>
                      setFormData((f) => ({
                        ...f,
                        contacts: f.contacts.map((ct, j) =>
                          j === i ? { ...ct, DecisionPower: e.target.value } : ct
                        ),
                      }))
                    }
                    className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Poder de decisión...</option>
                    <option value="alto">Alto</option>
                    <option value="medio">Medio</option>
                    <option value="bajo">Bajo</option>
                  </select>
                  <Input
                    type="date"
                    placeholder="Cumpleaños"
                    value={c.Birthday || ""}
                    onChange={(e) =>
                      setFormData((f) => ({
                        ...f,
                        contacts: f.contacts.map((ct, j) =>
                          j === i ? { ...ct, Birthday: e.target.value } : ct
                        ),
                      }))
                    }
                    className="w-36"
                  />
                </div>
                {formData.contacts.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-red-600"
                    onClick={() =>
                      setFormData((f) => ({
                        ...f,
                        contacts: f.contacts.filter((_, j) => j !== i),
                      }))
                    }
                  >
                    <Trash2 size={16} />
                  </Button>
                )}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Zona</label>
              <select
                className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-espert-gold"
                value={formData.zoneId}
                onChange={(e) =>
                  setFormData((f) => ({
                    ...f,
                    zoneId: e.target.value ? Number(e.target.value) : "",
                  }))
                }
              >
                <option value="">Seleccionar zona</option>
                {zones.map((zone) => (
                  <option key={zone.ZoneId} value={zone.ZoneId}>
                    {zone.Name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Distribuidor</label>
              <select
                className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-espert-gold"
                value={formData.distributorId}
                onChange={(e) =>
                  setFormData((f) => ({
                    ...f,
                    distributorId: e.target.value ? Number(e.target.value) : "",
                  }))
                }
              >
                <option value="">Seleccionar distribuidor</option>
                {distributors.map((d) => (
                  <option key={d.DistributorId} value={d.DistributorId}>
                    {d.Name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDelete}
        title="Eliminar PDV"
        message={`¿Estás seguro de que deseas eliminar "${pos.Name}"? Esta acción no se puede deshacer.`}
        confirmText="Eliminar"
        type="danger"
      />
    </div>
  );
}
