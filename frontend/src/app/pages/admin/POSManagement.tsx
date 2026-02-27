import { useState, useMemo } from "react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { StatusChip } from "../../components/ui/status-chip";
import { Badge } from "../../components/ui/badge";
import { Modal } from "../../components/ui/modal";
import { Switch } from "../../components/ui/switch";
import {
  Search,
  Plus,
  MapPin,
  Phone,
  Edit,
  Trash2,
  CheckCircle,
  XCircle,
  Map as MapIcon,
} from "lucide-react";
import { usePdvs, useZones, useDistributors, useChannels, useSubChannels, pdvsApi } from "@/lib/api";
import { GpsCaptureButton } from "../../components/GpsCaptureButton";
import { LocationMap } from "../../components/LocationMap";
import { toast } from "sonner";

interface POSData {
  id: string;
  name: string;
  address: string;
  channel: string;
  distributor: string;
  contact: string;
  phone: string;
  zone: string;
  status: "active" | "pending-approval" | "inactive";
  compliance: number;
  lastVisit: string;
}

export function POSManagement() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedChannel, setSelectedChannel] = useState<string>("all");
  const [selectedZoneId, setSelectedZoneId] = useState<number | undefined>();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedPOS, setSelectedPOS] = useState<POSData | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    channelId: "" as number | "",
    subChannelId: "" as number | "",
    address: "",
    contact: "",
    phone: "",
    zoneId: "" as number | "",
    distributorId: "" as number | "",
    isActive: true,
    lat: null as number | null,
    lon: null as number | null,
  });
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const { data: pdvs, loading, refetch } = usePdvs(selectedZoneId);
  const { data: zones } = useZones();
  const { data: distributors } = useDistributors();
  const { data: channels } = useChannels();
  const { data: subchannels } = useSubChannels(formData.channelId || null);

  const zoneMap = useMemo(() => new Map(zones.map((z) => [z.ZoneId, z.Name])), [zones]);
  const distributorMap = useMemo(
    () => new Map(distributors.map((d) => [d.DistributorId, d.Name])),
    [distributors]
  );

  const posList: POSData[] = useMemo(
    () =>
      pdvs.map((p) => ({
        id: String(p.PdvId),
        name: p.Name,
        address: p.Address || p.City || "-",
        channel: p.ChannelName || p.Channel || "-",
        distributor: p.DistributorId ? distributorMap.get(p.DistributorId) || `#${p.DistributorId}` : "-",
        contact: p.ContactName || "-",
        phone: p.ContactPhone || "-",
        zone: p.ZoneId ? zoneMap.get(p.ZoneId) || `#${p.ZoneId}` : "-",
        status: (p.IsActive ? "active" : "inactive") as POSData["status"],
        compliance: 0,
        lastVisit: "-",
      })),
    [pdvs, zoneMap, distributorMap]
  );

  const channelFilterOptions = useMemo(
    () => ["Todos", ...Array.from(new Set(pdvs.map((p) => p.ChannelName || p.Channel).filter(Boolean))).sort()],
    [pdvs]
  );

  const filteredPOS = posList.filter((pos) => {
    const matchesSearch =
      pos.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      pos.address.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesChannel = selectedChannel === "all" || pos.channel === selectedChannel;
    return matchesSearch && matchesChannel;
  });

  const getStatusChipType = (status: string) => {
    switch (status) {
      case "active":
        return "completed";
      case "pending-approval":
        return "pending";
      case "inactive":
        return "alert";
      default:
        return "pending";
    }
  };

  const handleToggleActive = async (posId: string, currentActive: boolean) => {
    setTogglingId(posId);
    try {
      await pdvsApi.update(Number(posId), { IsActive: !currentActive });
      toast.success(!currentActive ? "PDV activado" : "PDV desactivado");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al actualizar");
    } finally {
      setTogglingId(null);
    }
  };

  const openModal = (pos?: POSData) => {
    if (pos) {
      setSelectedPOS(pos);
      const pdv = pdvs.find((p) => String(p.PdvId) === pos.id);
      setFormData({
        name: pos.name,
        channelId: pdv?.ChannelId ?? "",
        subChannelId: pdv?.SubChannelId ?? "",
        address: pos.address,
        contact: pos.contact,
        phone: pos.phone,
        zoneId: pdv?.ZoneId ?? "",
        distributorId: pdv?.DistributorId ?? "",
        isActive: pos.status === "active",
        lat: pdv?.Lat != null ? Number(pdv.Lat) : null,
        lon: pdv?.Lon != null ? Number(pdv.Lon) : null,
      });
    } else {
      setSelectedPOS(null);
      setFormData({
        name: "",
        channelId: "",
        subChannelId: "",
        address: "",
        contact: "",
        phone: "",
        zoneId: "",
        distributorId: "",
        isActive: true,
        lat: null,
        lon: null,
      });
    }
  };

  const handleSave = async () => {
    if (!formData.name || !formData.channelId) {
      toast.error("Nombre y canal son obligatorios");
      return;
    }
    setSaving(true);
    try {
      const contacts = formData.contact
        ? [{ ContactName: formData.contact, ContactPhone: formData.phone || undefined }]
        : undefined;
      if (selectedPOS) {
        await pdvsApi.update(Number(selectedPOS.id), {
          Name: formData.name,
          ChannelId: Number(formData.channelId),
          SubChannelId: formData.subChannelId ? Number(formData.subChannelId) : undefined,
          Address: formData.address || undefined,
          ZoneId: formData.zoneId || undefined,
          DistributorId: formData.distributorId || undefined,
          IsActive: formData.isActive,
          Lat: formData.lat ?? undefined,
          Lon: formData.lon ?? undefined,
          Contacts: contacts,
        });
        toast.success("PDV actualizado");
      } else {
        await pdvsApi.create({
          Name: formData.name,
          ChannelId: Number(formData.channelId),
          SubChannelId: formData.subChannelId ? Number(formData.subChannelId) : undefined,
          Address: formData.address || undefined,
          ZoneId: formData.zoneId || undefined,
          DistributorId: formData.distributorId || undefined,
          IsActive: formData.isActive,
          Lat: formData.lat ?? undefined,
          Lon: formData.lon ?? undefined,
          Contacts: contacts,
        });
        toast.success("PDV creado");
      }
      setIsCreateModalOpen(false);
      setSelectedPOS(null);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "active":
        return "Activo";
      case "pending-approval":
        return "Pendiente Aprobación";
      case "inactive":
        return "Inactivo";
      default:
        return status;
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Gestión de PDV</h1>
          <p className="text-slate-600">Administrar puntos de venta y aprobaciones</p>
        </div>
        <Button onClick={() => { setIsCreateModalOpen(true); openModal(); }} className="gap-2">
          <Plus size={20} />
          Nuevo PDV
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <Input
                placeholder="Buscar por nombre o dirección..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Channel Filter */}
            <div>
              <select
                value={selectedChannel}
                onChange={(e) => setSelectedChannel(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">Todos los canales</option>
                {channelFilterOptions.slice(1).map((channel) => (
                  <option key={channel} value={channel}>
                    {channel}
                  </option>
                ))}
              </select>
            </div>

            {/* Zone Filter */}
            <div>
              <select
                value={selectedZoneId ?? "all"}
                onChange={(e) =>
                  setSelectedZoneId(e.target.value === "all" ? undefined : Number(e.target.value))
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">Todas las zonas</option>
                {zones.map((zone) => (
                  <option key={zone.ZoneId} value={zone.ZoneId}>
                    {zone.Name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results Summary */}
      {loading && (
        <p className="text-sm text-slate-600">Cargando PDVs...</p>
      )}
      <div className="flex items-center gap-4 text-sm text-slate-600">
        <span>
          Mostrando <span className="font-semibold text-slate-900">{filteredPOS.length}</span> de{" "}
          <span className="font-semibold text-slate-900">{posList.length}</span> PDV
        </span>
      </div>

      {/* POS List */}
      <div className="grid grid-cols-1 gap-4">
        {filteredPOS.map((pos) => (
          <Card key={pos.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-bold text-slate-900">{pos.name}</h3>
                    <StatusChip
                      status={getStatusChipType(pos.status) as any}
                      label={getStatusLabel(pos.status)}
                      size="sm"
                    />
                  </div>
                  <div className="space-y-1 text-sm text-slate-600">
                    <p className="flex items-center gap-2">
                      <MapPin size={14} />
                      {pos.address}
                    </p>
                    <p className="flex items-center gap-2">
                      <Phone size={14} />
                      {pos.contact} - {pos.phone}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Activo</span>
                    <Switch
                      checked={pos.status === "active"}
                      onCheckedChange={() => handleToggleActive(pos.id, pos.status === "active")}
                      disabled={togglingId === pos.id}
                    />
                  </div>
                  <Button variant="outline" size="sm" onClick={() => { setSelectedPOS(pos); openModal(pos); }}>
                    <Edit size={16} />
                  </Button>
                  <Button variant="outline" size="sm">
                    <MapIcon size={16} />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-4 border-t border-slate-200">
                <div>
                  <p className="text-xs text-slate-500 mb-1">Canal</p>
                  <Badge variant="outline">{pos.channel}</Badge>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Zona</p>
                  <p className="text-sm font-semibold text-slate-900">{pos.zone}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Distribuidor</p>
                  <p className="text-sm font-semibold text-slate-900">{pos.distributor}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Cumplimiento</p>
                  <p className="text-sm font-semibold text-slate-900">
                    {pos.compliance > 0 ? `${pos.compliance}%` : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Última Visita</p>
                  <p className="text-sm font-semibold text-slate-900">
                    {pos.lastVisit !== "-"
                      ? new Date(pos.lastVisit).toLocaleDateString("es-AR")
                      : "-"}
                  </p>
                </div>
              </div>

              {pos.status === "pending-approval" && (
                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-200">
                  <Button size="sm" className="gap-2">
                    <CheckCircle size={16} />
                    Aprobar
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2">
                    <XCircle size={16} />
                    Rechazar
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isCreateModalOpen || selectedPOS !== null}
        onClose={() => {
          setIsCreateModalOpen(false);
          setSelectedPOS(null);
        }}
        title={selectedPOS ? "Editar PDV" : "Nuevo PDV"}
        size="lg"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateModalOpen(false);
                setSelectedPOS(null);
              }}
            >
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <label className="text-sm font-medium text-slate-700">PDV activo</label>
            <Switch
              checked={formData.isActive}
              onCheckedChange={(checked) => setFormData((f) => ({ ...f, isActive: checked }))}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Nombre del PDV
              </label>
              <Input
                placeholder="Ej: Kiosco El Rápido"
                value={formData.name}
                onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Canal</label>
              <select
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={formData.channelId}
                onChange={(e) =>
                  setFormData((f) => ({
                    ...f,
                    channelId: e.target.value ? Number(e.target.value) : "",
                    subChannelId: "",
                  }))
                }
              >
                <option value="">Seleccionar canal</option>
                {channels.map((ch) => (
                  <option key={ch.ChannelId} value={ch.ChannelId}>
                    {ch.Name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Sub-canal</label>
              <select
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={formData.subChannelId}
                onChange={(e) =>
                  setFormData((f) => ({
                    ...f,
                    subChannelId: e.target.value ? Number(e.target.value) : "",
                  }))
                }
                disabled={!formData.channelId}
              >
                <option value="">Seleccionar subcanal</option>
                {subchannels.map((sc) => (
                  <option key={sc.SubChannelId} value={sc.SubChannelId}>
                    {sc.Name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Dirección</label>
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
                <p className="text-xs text-slate-500 mt-1">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Contacto</label>
              <Input
                placeholder="Nombre del contacto"
                value={formData.contact}
                onChange={(e) => setFormData((f) => ({ ...f, contact: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Teléfono</label>
              <Input
                placeholder="+54 11 1234-5678"
                value={formData.phone}
                onChange={(e) => setFormData((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Zona</label>
              <select
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Distribuidor
              </label>
              <select
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
    </div>
  );
}
