import { useState, useMemo, useEffect } from "react";
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
  List,
  ChevronDown,
  ChevronUp,
  Filter,
  User,
  Clock,
  Eye,
  Navigation,
  BarChart3,
} from "lucide-react";
import { usePdvs, useZones, useDistributors, useChannels, useSubChannels, useUsers, pdvsApi, distributorsApi } from "@/lib/api";
import { api } from "@/lib/api/client";
import { GpsCaptureButton } from "../../components/GpsCaptureButton";
import { LocationMap } from "../../components/LocationMap";
import { AddressAutocomplete, type AddressResult } from "../../components/AddressAutocomplete";
import { PdvMapView } from "../../components/PdvMapView";
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
  tradeMarketer: string;
  visitCount: number;
  hasCoords: boolean;
}

export function POSManagement() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedChannel, setSelectedChannel] = useState<string>("all");
  const [selectedZoneId, setSelectedZoneId] = useState<number | undefined>();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedPOS, setSelectedPOS] = useState<POSData | null>(null);
  interface ContactFormData {
    ContactName: string;
    ContactPhone: string;
    ContactRole: string;
    DecisionPower: string;
    Birthday: string;
  }
  const emptyContact = (): ContactFormData => ({
    ContactName: "",
    ContactPhone: "",
    ContactRole: "",
    DecisionPower: "",
    Birthday: "",
  });

  const [formData, setFormData] = useState({
    name: "",
    channelId: "" as number | "",
    subChannelId: "" as number | "",
    address: "",
    city: "",
    contacts: [emptyContact()] as ContactFormData[],
    zoneId: "" as number | "",
    distributorIds: [] as number[],
    isActive: true,
    lat: null as number | null,
    lon: null as number | null,
  });
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [allMapData, setAllMapData] = useState<any[]>([]);
  const [mapLoading, setMapLoading] = useState(false);
  const [editingLocationId, setEditingLocationId] = useState<number | null>(null);
  const [locationAddress, setLocationAddress] = useState("");
  const [locationCoords, setLocationCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [savingLocation, setSavingLocation] = useState(false);
  const [creatingDistributor, setCreatingDistributor] = useState(false);
  const [newDistributorName, setNewDistributorName] = useState("");
  const [newDistributorPhone, setNewDistributorPhone] = useState("");
  const [newDistributorType, setNewDistributorType] = useState("");
  const [newDistributorSource, setNewDistributorSource] = useState("");
  const [savingDistributor, setSavingDistributor] = useState(false);

  // Advanced filters
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [selectedTradeMarketer, setSelectedTradeMarketer] = useState<string>("all");
  const [selectedDaysSinceVisit, setSelectedDaysSinceVisit] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [selectedVisitFrequency, setSelectedVisitFrequency] = useState<string>("all");
  const [selectedDistributorFilter, setSelectedDistributorFilter] = useState<string>("all");
  const [selectedRouteFilter, setSelectedRouteFilter] = useState<string>("all");

  const { data: pdvs, loading, refetch } = usePdvs(selectedZoneId);
  const { data: zones } = useZones();
  const { data: distributors, refetch: refetchDistributors } = useDistributors();
  const { data: channels } = useChannels();
  const { data: subchannels } = useSubChannels(formData.channelId || null);
  const { data: users } = useUsers();

  // Always load enriched pdv-map data for advanced filters
  const [mapRefreshKey, setMapRefreshKey] = useState(0);
  useEffect(() => {
    setMapLoading(true);
    api.get<any[]>("/reports/pdv-map", selectedZoneId ? { zone_id: selectedZoneId } : undefined)
      .then(setAllMapData)
      .catch(() => toast.error("Error al cargar datos del mapa"))
      .finally(() => setMapLoading(false));
  }, [selectedZoneId, mapRefreshKey]);

  // Build lookup from enriched data (pdvId -> enriched info)
  const enrichedLookup = useMemo(() => {
    const map = new Map<number, any>();
    allMapData.forEach((p) => map.set(p.pdvId, p));
    return map;
  }, [allMapData]);

  // Unique trade marketers from enriched data
  const tradeMarketers = useMemo(() => {
    return users
      .filter((u) => u.IsActive)
      .map((u) => ({ id: u.UserId, name: u.DisplayName }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users]);

  // Count active advanced filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedTradeMarketer !== "all") count++;
    if (selectedDaysSinceVisit !== "all") count++;
    if (selectedStatus !== "all") count++;
    if (selectedLocation !== "all") count++;
    if (selectedVisitFrequency !== "all") count++;
    if (selectedDistributorFilter !== "all") count++;
    if (selectedRouteFilter !== "all") count++;
    return count;
  }, [selectedTradeMarketer, selectedDaysSinceVisit, selectedStatus, selectedLocation, selectedVisitFrequency, selectedDistributorFilter, selectedRouteFilter]);

  const clearAdvancedFilters = () => {
    setSelectedTradeMarketer("all");
    setSelectedDaysSinceVisit("all");
    setSelectedStatus("all");
    setSelectedLocation("all");
    setSelectedVisitFrequency("all");
    setSelectedDistributorFilter("all");
    setSelectedRouteFilter("all");
  };

  // Helper: check if a PDV matches advanced filters using enriched data
  const matchesAdvancedFilters = (pdvId: number, pdvDistributorIds?: number[]) => {
    const enriched = enrichedLookup.get(pdvId);

    // Trade marketer filter
    if (selectedTradeMarketer !== "all") {
      if (selectedTradeMarketer === "unassigned") {
        if (enriched?.assignedUserName && enriched.assignedUserName !== "Sin asignar") return false;
      } else {
        if (enriched?.assignedUserName !== selectedTradeMarketer) return false;
      }
    }

    // Days since last visit
    if (selectedDaysSinceVisit !== "all") {
      const lastVisit = enriched?.lastVisit;
      const daysSince = lastVisit
        ? Math.floor((Date.now() - new Date(lastVisit).getTime()) / (1000 * 60 * 60 * 24))
        : Infinity;

      switch (selectedDaysSinceVisit) {
        case "7": if (daysSince > 7) return false; break;
        case "14": if (daysSince <= 7 || daysSince > 14) return false; break;
        case "30": if (daysSince <= 14 || daysSince > 30) return false; break;
        case "60": if (daysSince <= 30 || daysSince > 60) return false; break;
        case "60+": if (daysSince <= 60) return false; break;
        case "never": if (daysSince !== Infinity) return false; break;
      }
    }

    // Location filter
    if (selectedLocation !== "all") {
      const hasCoords = enriched?.hasCoords ?? false;
      if (selectedLocation === "with" && !hasCoords) return false;
      if (selectedLocation === "without" && hasCoords) return false;
    }

    // Visit frequency
    if (selectedVisitFrequency !== "all") {
      const count = enriched?.visitCount ?? 0;
      switch (selectedVisitFrequency) {
        case "0": if (count !== 0) return false; break;
        case "1-5": if (count < 1 || count > 5) return false; break;
        case "6-20": if (count < 6 || count > 20) return false; break;
        case "20+": if (count <= 20) return false; break;
      }
    }

    // Distributor filter
    if (selectedDistributorFilter !== "all") {
      const ids = pdvDistributorIds || [];
      if (selectedDistributorFilter === "none") {
        if (ids.length > 0) return false;
      } else {
        if (!ids.includes(Number(selectedDistributorFilter))) return false;
      }
    }

    // Route assignment filter
    if (selectedRouteFilter !== "all") {
      const hasRoute = enriched?.hasRoute ?? false;
      if (selectedRouteFilter === "with" && !hasRoute) return false;
      if (selectedRouteFilter === "without" && hasRoute) return false;
    }

    return true;
  };

  // Filter map data by all filters (client-side)
  const mapData = useMemo(() => {
    return allMapData.filter((p) => {
      const matchesSearch =
        !searchTerm ||
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.address && p.address.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesChannel = selectedChannel === "all" || p.channel === selectedChannel;

      // Trade marketer
      let matchesTM = true;
      if (selectedTradeMarketer !== "all") {
        if (selectedTradeMarketer === "unassigned") {
          matchesTM = !p.assignedUserName || p.assignedUserName === "Sin asignar";
        } else {
          matchesTM = p.assignedUserName === selectedTradeMarketer;
        }
      }

      // Days since last visit
      let matchesDays = true;
      if (selectedDaysSinceVisit !== "all") {
        const daysSince = p.lastVisit
          ? Math.floor((Date.now() - new Date(p.lastVisit).getTime()) / (1000 * 60 * 60 * 24))
          : Infinity;
        switch (selectedDaysSinceVisit) {
          case "7": matchesDays = daysSince <= 7; break;
          case "14": matchesDays = daysSince > 7 && daysSince <= 14; break;
          case "30": matchesDays = daysSince > 14 && daysSince <= 30; break;
          case "60": matchesDays = daysSince > 30 && daysSince <= 60; break;
          case "60+": matchesDays = daysSince > 60; break;
          case "never": matchesDays = daysSince === Infinity; break;
        }
      }

      // Location
      let matchesLoc = true;
      if (selectedLocation !== "all") {
        matchesLoc = selectedLocation === "with" ? p.hasCoords : !p.hasCoords;
      }

      // Visit frequency
      let matchesFreq = true;
      if (selectedVisitFrequency !== "all") {
        const c = p.visitCount ?? 0;
        switch (selectedVisitFrequency) {
          case "0": matchesFreq = c === 0; break;
          case "1-5": matchesFreq = c >= 1 && c <= 5; break;
          case "6-20": matchesFreq = c >= 6 && c <= 20; break;
          case "20+": matchesFreq = c > 20; break;
        }
      }

      // Route assignment
      let matchesRoute = true;
      if (selectedRouteFilter !== "all") {
        const hr = p.hasRoute ?? false;
        matchesRoute = selectedRouteFilter === "with" ? hr : !hr;
      }

      return matchesSearch && matchesChannel && matchesTM && matchesDays && matchesLoc && matchesFreq && matchesRoute;
    });
  }, [allMapData, searchTerm, selectedChannel, selectedTradeMarketer, selectedDaysSinceVisit, selectedLocation, selectedVisitFrequency, selectedRouteFilter]);

  const pdvsWithCoords = useMemo(() => mapData.filter((p: any) => p.hasCoords), [mapData]);
  const pdvsWithoutCoords = useMemo(() => mapData.filter((p: any) => !p.hasCoords), [mapData]);

  const zoneMap = useMemo(() => new Map(zones.map((z) => [z.ZoneId, z.Name])), [zones]);
  const distributorMap = useMemo(
    () => new Map(distributors.map((d) => [d.DistributorId, d.Name])),
    [distributors]
  );

  const posList: POSData[] = useMemo(
    () =>
      pdvs.map((p) => {
        const enriched = enrichedLookup.get(p.PdvId);
        return {
          id: String(p.PdvId),
          name: p.Name,
          address: p.Address || p.City || "-",
          channel: p.ChannelName || p.Channel || "-",
          distributor: p.Distributors && p.Distributors.length > 0
          ? p.Distributors.map((d) => d.Name).join(", ")
          : p.DistributorId ? distributorMap.get(p.DistributorId) || `#${p.DistributorId}` : "-",
          contact: p.ContactName || "-",
          phone: p.ContactPhone || "-",
          zone: p.ZoneId ? zoneMap.get(p.ZoneId) || `#${p.ZoneId}` : "-",
          status: (p.IsActive ? "active" : "inactive") as POSData["status"],
          compliance: 0,
          lastVisit: enriched?.lastVisit || "-",
          tradeMarketer: enriched?.assignedUserName || "Sin asignar",
          visitCount: enriched?.visitCount ?? 0,
          hasCoords: enriched?.hasCoords ?? false,
        };
      }),
    [pdvs, zoneMap, distributorMap, enrichedLookup]
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

    // Status filter
    let matchesStatus = true;
    if (selectedStatus !== "all") {
      matchesStatus = selectedStatus === "active" ? pos.status === "active" : pos.status === "inactive";
    }

    // Advanced filters using enriched data
    const pdv = pdvs.find((p) => String(p.PdvId) === pos.id);
    const distIds = pdv?.Distributors?.map((d) => d.DistributorId) || (pdv?.DistributorId ? [pdv.DistributorId] : []);
    const matchesAdvanced = matchesAdvancedFilters(Number(pos.id), distIds);

    return matchesSearch && matchesChannel && matchesStatus && matchesAdvanced;
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
      const existingContacts: ContactFormData[] =
        pdv?.Contacts && pdv.Contacts.length > 0
          ? pdv.Contacts.map((c) => ({
              ContactName: c.ContactName || "",
              ContactPhone: c.ContactPhone || "",
              ContactRole: c.ContactRole || "",
              DecisionPower: c.DecisionPower || "",
              Birthday: c.Birthday || "",
            }))
          : [emptyContact()];
      const distIds = pdv?.Distributors && pdv.Distributors.length > 0
        ? pdv.Distributors.map((d) => d.DistributorId)
        : pdv?.DistributorId ? [pdv.DistributorId] : [];
      setFormData({
        name: pos.name,
        channelId: pdv?.ChannelId ?? "",
        subChannelId: pdv?.SubChannelId ?? "",
        address: pos.address,
        city: pdv?.City || "",
        contacts: existingContacts,
        zoneId: pdv?.ZoneId ?? "",
        distributorIds: distIds,
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
        city: "",
        contacts: [emptyContact()],
        zoneId: "",
        distributorIds: [],
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
      const validContacts = formData.contacts
        .filter((c) => c.ContactName.trim())
        .map((c) => ({
          ContactName: c.ContactName.trim(),
          ContactPhone: c.ContactPhone || undefined,
          ContactRole: c.ContactRole || undefined,
          DecisionPower: c.DecisionPower || undefined,
          Birthday: c.Birthday || undefined,
        }));
      const payload = {
        Name: formData.name,
        ChannelId: Number(formData.channelId),
        SubChannelId: formData.subChannelId ? Number(formData.subChannelId) : undefined,
        Address: formData.address || undefined,
        City: formData.city || undefined,
        ZoneId: formData.zoneId ? Number(formData.zoneId) : undefined,
        DistributorIds: formData.distributorIds.length > 0 ? formData.distributorIds : [],
        IsActive: formData.isActive,
        Lat: formData.lat ?? undefined,
        Lon: formData.lon ?? undefined,
        Contacts: validContacts.length > 0 ? validContacts : undefined,
      };
      if (selectedPOS) {
        await pdvsApi.update(Number(selectedPOS.id), payload);
        toast.success("PDV actualizado");
      } else {
        await pdvsApi.create(payload);
        toast.success("PDV creado");
      }
      setIsCreateModalOpen(false);
      setSelectedPOS(null);
      refetch();
      setMapRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveLocation = async (pdvId: number) => {
    if (!locationCoords) {
      toast.error("Selecciona una dirección del autocompletado");
      return;
    }
    setSavingLocation(true);
    try {
      await pdvsApi.update(pdvId, {
        Lat: locationCoords.lat,
        Lon: locationCoords.lon,
        Address: locationAddress || undefined,
      });
      toast.success("Ubicación actualizada");
      setEditingLocationId(null);
      setLocationAddress("");
      setLocationCoords(null);
      setMapRefreshKey((k) => k + 1);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar ubicación");
    } finally {
      setSavingLocation(false);
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
          <h1 className="text-3xl font-bold text-foreground mb-2">Gestión de PDV</h1>
          <p className="text-muted-foreground">Administrar puntos de venta y aprobaciones</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setViewMode("list")}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
                viewMode === "list"
                  ? "bg-[#A48242] text-white"
                  : "bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              <List size={16} />
              Lista
            </button>
            <button
              onClick={() => setViewMode("map")}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
                viewMode === "map"
                  ? "bg-[#A48242] text-white"
                  : "bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              <MapIcon size={16} />
              Mapa
            </button>
          </div>
          <Button onClick={() => { setIsCreateModalOpen(true); openModal(); }} className="gap-2">
            <Plus size={20} />
            Nuevo PDV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 space-y-4">
          {/* Primary filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
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
                className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-espert-gold"
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
                className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-espert-gold"
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

          {/* Advanced filters toggle */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <Filter size={16} />
              Filtros avanzados
              {activeFilterCount > 0 && (
                <Badge className="bg-[#A48242] text-white text-xs px-1.5 py-0">{activeFilterCount}</Badge>
              )}
              {showAdvancedFilters ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {activeFilterCount > 0 && (
              <button
                onClick={clearAdvancedFilters}
                className="text-xs text-destructive hover:underline"
              >
                Limpiar filtros
              </button>
            )}
          </div>

          {/* Advanced filters panel */}
          {showAdvancedFilters && (
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 pt-3 border-t border-border">
              {/* Trade Marketer */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                  <User size={13} />
                  Trade Marketer
                </label>
                <select
                  value={selectedTradeMarketer}
                  onChange={(e) => setSelectedTradeMarketer(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-espert-gold"
                >
                  <option value="all">Todos</option>
                  <option value="unassigned">Sin asignar</option>
                  {tradeMarketers.map((tm) => (
                    <option key={tm.id} value={tm.name}>{tm.name}</option>
                  ))}
                </select>
              </div>

              {/* Days since last visit */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                  <Clock size={13} />
                  Última visita
                </label>
                <select
                  value={selectedDaysSinceVisit}
                  onChange={(e) => setSelectedDaysSinceVisit(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-espert-gold"
                >
                  <option value="all">Cualquiera</option>
                  <option value="7">Últimos 7 días</option>
                  <option value="14">8 - 14 días</option>
                  <option value="30">15 - 30 días</option>
                  <option value="60">31 - 60 días</option>
                  <option value="60+">Más de 60 días</option>
                  <option value="never">Nunca visitado</option>
                </select>
              </div>

              {/* Status */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                  <Eye size={13} />
                  Estado
                </label>
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-espert-gold"
                >
                  <option value="all">Todos</option>
                  <option value="active">Activos</option>
                  <option value="inactive">Inactivos</option>
                </select>
              </div>

              {/* GPS Location */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                  <Navigation size={13} />
                  Ubicación GPS
                </label>
                <select
                  value={selectedLocation}
                  onChange={(e) => setSelectedLocation(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-espert-gold"
                >
                  <option value="all">Todos</option>
                  <option value="with">Con ubicación</option>
                  <option value="without">Sin ubicación</option>
                </select>
              </div>

              {/* Visit Frequency */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                  <BarChart3 size={13} />
                  Frecuencia visitas
                </label>
                <select
                  value={selectedVisitFrequency}
                  onChange={(e) => setSelectedVisitFrequency(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-espert-gold"
                >
                  <option value="all">Todas</option>
                  <option value="0">Nunca visitado</option>
                  <option value="1-5">1 a 5 visitas</option>
                  <option value="6-20">6 a 20 visitas</option>
                  <option value="20+">Más de 20 visitas</option>
                </select>
              </div>

              {/* Distributor */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                  <MapPin size={13} />
                  Distribuidor
                </label>
                <select
                  value={selectedDistributorFilter}
                  onChange={(e) => setSelectedDistributorFilter(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-espert-gold"
                >
                  <option value="all">Todos</option>
                  <option value="none">Sin distribuidor</option>
                  {distributors.map((d) => (
                    <option key={d.DistributorId} value={String(d.DistributorId)}>
                      {d.Name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Route assignment */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                  <Filter size={13} />
                  Asignación a ruta
                </label>
                <select
                  value={selectedRouteFilter}
                  onChange={(e) => setSelectedRouteFilter(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-espert-gold"
                >
                  <option value="all">Todos</option>
                  <option value="with">Con ruta asignada</option>
                  <option value="without">Sin ruta (huérfanos)</option>
                </select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results Summary */}
      {loading && (
        <p className="text-sm text-muted-foreground">Cargando PDVs...</p>
      )}
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span>
          Mostrando <span className="font-semibold text-foreground">{filteredPOS.length}</span> de{" "}
          <span className="font-semibold text-foreground">{posList.length}</span> PDV
        </span>
      </div>

      {/* Map View */}
      {viewMode === "map" && (
        <>
          <Card>
            <CardContent className="p-4">
              {mapLoading ? (
                <div className="flex items-center justify-center py-20 text-muted-foreground">
                  Cargando mapa...
                </div>
              ) : pdvsWithCoords.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
                  <MapIcon size={40} className="opacity-40" />
                  <p>No hay PDVs con coordenadas GPS</p>
                  <p className="text-xs">Agrega ubicación GPS a los PDVs para verlos en el mapa</p>
                </div>
              ) : (
                <PdvMapView pdvs={pdvsWithCoords} height="600px" />
              )}
            </CardContent>
          </Card>

          {/* PDVs sin ubicación */}
          {pdvsWithoutCoords.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <MapPin size={18} className="text-destructive" />
                    <h3 className="font-semibold text-foreground">PDVs sin ubicación</h3>
                    <Badge variant="outline" className="text-destructive border-destructive/30">
                      {pdvsWithoutCoords.length}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">Agrega la dirección para ubicarlos en el mapa</p>
                </div>

                <div className="space-y-2">
                  {pdvsWithoutCoords.map((pdv: any) => (
                    <div
                      key={pdv.pdvId}
                      className="flex items-center gap-4 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-foreground truncate">{pdv.name}</p>
                          <Badge variant="outline" className="text-xs shrink-0">{pdv.channel}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">
                          {pdv.address || "Sin dirección"}
                        </p>
                      </div>

                      {editingLocationId === pdv.pdvId ? (
                        <div className="flex items-center gap-2 flex-1 max-w-lg">
                          <div className="flex-1">
                            <AddressAutocomplete
                              value={locationAddress}
                              onChange={setLocationAddress}
                              onPlaceSelect={(result: AddressResult) => {
                                setLocationAddress(result.address);
                                setLocationCoords({ lat: result.lat, lon: result.lon });
                              }}
                              placeholder="Buscar dirección en Argentina..."
                              className="text-sm"
                            />
                            {locationCoords && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {locationCoords.lat.toFixed(5)}, {locationCoords.lon.toFixed(5)}
                              </p>
                            )}
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleSaveLocation(pdv.pdvId)}
                            disabled={!locationCoords || savingLocation}
                          >
                            {savingLocation ? "..." : "Guardar"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingLocationId(null);
                              setLocationAddress("");
                              setLocationCoords(null);
                            }}
                          >
                            Cancelar
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 shrink-0"
                          onClick={() => {
                            setEditingLocationId(pdv.pdvId);
                            setLocationAddress(pdv.address || "");
                            setLocationCoords(null);
                          }}
                        >
                          <MapPin size={14} />
                          Agregar ubicación
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* POS List */}
      {viewMode === "list" && <div className="grid grid-cols-1 gap-4">
        {filteredPOS.map((pos) => (
          <Card key={pos.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-bold text-foreground">{pos.name}</h3>
                    <StatusChip
                      status={getStatusChipType(pos.status) as any}
                      label={getStatusLabel(pos.status)}
                      size="sm"
                    />
                  </div>
                  <div className="space-y-1 text-sm text-muted-foreground">
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
                    <span className="text-xs text-muted-foreground">Activo</span>
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

              <div className="grid grid-cols-2 md:grid-cols-6 gap-4 pt-4 border-t border-border">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Canal</p>
                  <Badge variant="outline">{pos.channel}</Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Zona</p>
                  <p className="text-sm font-semibold text-foreground">{pos.zone}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Distribuidor</p>
                  <p className="text-sm font-semibold text-foreground">{pos.distributor}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Trade Marketer</p>
                  <p className={`text-sm font-semibold ${pos.tradeMarketer === "Sin asignar" ? "text-destructive" : "text-foreground"}`}>
                    {pos.tradeMarketer}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Visitas</p>
                  <p className="text-sm font-semibold text-foreground">
                    {pos.visitCount > 0 ? pos.visitCount : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Última Visita</p>
                  <p className={`text-sm font-semibold ${
                    pos.lastVisit !== "-" &&
                    Math.floor((Date.now() - new Date(pos.lastVisit).getTime()) / (1000 * 60 * 60 * 24)) > 30
                      ? "text-destructive"
                      : "text-foreground"
                  }`}>
                    {pos.lastVisit !== "-"
                      ? new Date(pos.lastVisit).toLocaleDateString("es-AR")
                      : "-"}
                  </p>
                </div>
              </div>

              {pos.status === "pending-approval" && (
                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border">
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
      </div>}

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
          <div className="flex items-center justify-between pb-4 border-b border-border">
            <label className="text-sm font-medium text-muted-foreground">PDV activo</label>
            <Switch
              checked={formData.isActive}
              onCheckedChange={(checked) => setFormData((f) => ({ ...f, isActive: checked }))}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Nombre del PDV
              </label>
              <Input
                placeholder="Ej: Kiosco El Rápido"
                value={formData.name}
                onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Canal</label>
              <select
                className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-espert-gold"
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
              <label className="block text-sm font-medium text-muted-foreground mb-1">Sub-canal</label>
              <select
                className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-espert-gold"
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
            <label className="block text-sm font-medium text-muted-foreground mb-1">Dirección</label>
            <AddressAutocomplete
              value={formData.address}
              onChange={(addr) => setFormData((f) => ({ ...f, address: addr }))}
              onPlaceSelect={(result: AddressResult) =>
                setFormData((f) => ({ ...f, address: result.address, lat: result.lat, lon: result.lon }))
              }
              placeholder="Buscar dirección en Argentina..."
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

          {/* Contactos */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-muted-foreground">Contactos</label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() =>
                  setFormData((f) => ({ ...f, contacts: [...f.contacts, emptyContact()] }))
                }
              >
                <Plus size={14} />
                Agregar contacto
              </Button>
            </div>

            {formData.contacts.map((contact, idx) => (
              <div key={idx} className="p-3 border border-border rounded-lg space-y-3 bg-muted/30">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">
                    Contacto {idx + 1}
                  </span>
                  {formData.contacts.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((f) => ({
                          ...f,
                          contacts: f.contacts.filter((_, i) => i !== idx),
                        }))
                      }
                      className="text-destructive hover:text-destructive/80 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Nombre *</label>
                    <Input
                      placeholder="Nombre del contacto"
                      value={contact.ContactName}
                      onChange={(e) =>
                        setFormData((f) => ({
                          ...f,
                          contacts: f.contacts.map((c, i) =>
                            i === idx ? { ...c, ContactName: e.target.value } : c
                          ),
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Teléfono</label>
                    <Input
                      placeholder="+54 11 1234-5678"
                      value={contact.ContactPhone}
                      onChange={(e) =>
                        setFormData((f) => ({
                          ...f,
                          contacts: f.contacts.map((c, i) =>
                            i === idx ? { ...c, ContactPhone: e.target.value } : c
                          ),
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Rol</label>
                    <select
                      className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-espert-gold"
                      value={contact.ContactRole}
                      onChange={(e) =>
                        setFormData((f) => ({
                          ...f,
                          contacts: f.contacts.map((c, i) =>
                            i === idx ? { ...c, ContactRole: e.target.value } : c
                          ),
                        }))
                      }
                    >
                      <option value="">Seleccionar rol</option>
                      <option value="dueño">Dueño</option>
                      <option value="encargado">Encargado</option>
                      <option value="empleado">Empleado</option>
                      <option value="temporal">Temporal</option>
                      <option value="repositor">Repositor</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Poder de decisión</label>
                    <select
                      className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-espert-gold"
                      value={contact.DecisionPower}
                      onChange={(e) =>
                        setFormData((f) => ({
                          ...f,
                          contacts: f.contacts.map((c, i) =>
                            i === idx ? { ...c, DecisionPower: e.target.value } : c
                          ),
                        }))
                      }
                    >
                      <option value="">Seleccionar</option>
                      <option value="alto">Alto - Decide compras</option>
                      <option value="medio">Medio - Influye</option>
                      <option value="bajo">Bajo - No decide</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Cumpleaños</label>
                    <Input
                      type="date"
                      value={contact.Birthday}
                      onChange={(e) =>
                        setFormData((f) => ({
                          ...f,
                          contacts: f.contacts.map((c, i) =>
                            i === idx ? { ...c, Birthday: e.target.value } : c
                          ),
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Ciudad</label>
              <AddressAutocomplete
                value={formData.city}
                onChange={(val) => setFormData((f) => ({ ...f, city: val }))}
                onPlaceSelect={(result: AddressResult) =>
                  setFormData((f) => ({ ...f, city: result.address }))
                }
                placeholder="Buscar ciudad en Argentina..."
                id="city"
                searchType="cities"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Distribuidores
              </label>

              {/* Chips de distribuidores seleccionados */}
              {formData.distributorIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {formData.distributorIds.map((dId) => {
                    const dist = distributors.find((d) => d.DistributorId === dId);
                    return (
                      <span
                        key={dId}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-[#A48242]/10 text-[#A48242] border border-[#A48242]/30 rounded-full"
                      >
                        {dist?.Name || `#${dId}`}
                        <button
                          type="button"
                          onClick={() =>
                            setFormData((f) => ({
                              ...f,
                              distributorIds: f.distributorIds.filter((id) => id !== dId),
                            }))
                          }
                          className="hover:text-destructive transition-colors ml-0.5"
                        >
                          <XCircle size={13} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Selector + crear nuevo */}
              {creatingDistributor ? (
                <div className="space-y-2 p-3 border border-border rounded-lg bg-muted/30">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Nuevo distribuidor</p>
                  <Input
                    placeholder="Nombre *"
                    value={newDistributorName}
                    onChange={(e) => setNewDistributorName(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setCreatingDistributor(false);
                        setNewDistributorName("");
                        setNewDistributorPhone("");
                        setNewDistributorType("");
                        setNewDistributorSource("");
                      }
                    }}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Teléfono"
                      value={newDistributorPhone}
                      onChange={(e) => setNewDistributorPhone(e.target.value)}
                    />
                    <select
                      value={newDistributorType}
                      onChange={(e) => setNewDistributorType(e.target.value)}
                      className="h-10 px-3 border border-border rounded-md text-sm bg-background"
                    >
                      <option value="">Tipo...</option>
                      <option value="Distribuidor">Distribuidor</option>
                      <option value="Mayorista">Mayorista</option>
                      <option value="Intermediario">Intermediario</option>
                    </select>
                  </div>
                  <Input
                    placeholder="De dónde se abastece (ej: directo de fábrica)"
                    value={newDistributorSource}
                    onChange={(e) => setNewDistributorSource(e.target.value)}
                  />
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setCreatingDistributor(false);
                        setNewDistributorName("");
                        setNewDistributorPhone("");
                        setNewDistributorType("");
                        setNewDistributorSource("");
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      disabled={!newDistributorName.trim() || savingDistributor}
                      onClick={async () => {
                        setSavingDistributor(true);
                        try {
                          const created = await distributorsApi.create({
                            Name: newDistributorName.trim(),
                            Phone: newDistributorPhone.trim() || undefined,
                            DistributorType: newDistributorType || undefined,
                            SupplierSource: newDistributorSource.trim() || undefined,
                          });
                          await refetchDistributors();
                          setFormData((f) => ({
                            ...f,
                            distributorIds: [...f.distributorIds, created.DistributorId],
                          }));
                          setCreatingDistributor(false);
                          setNewDistributorName("");
                          setNewDistributorPhone("");
                          setNewDistributorType("");
                          setNewDistributorSource("");
                          toast.success("Distribuidor creado");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Error al crear distribuidor");
                        } finally {
                          setSavingDistributor(false);
                        }
                      }}
                    >
                      {savingDistributor ? "..." : "Crear"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <select
                    className="flex-1 px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-espert-gold"
                    value=""
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      if (id && !formData.distributorIds.includes(id)) {
                        setFormData((f) => ({
                          ...f,
                          distributorIds: [...f.distributorIds, id],
                        }));
                      }
                    }}
                  >
                    <option value="">Agregar distribuidor...</option>
                    {distributors
                      .filter((d) => !formData.distributorIds.includes(d.DistributorId))
                      .map((d) => (
                        <option key={d.DistributorId} value={d.DistributorId}>
                          {d.Name}
                        </option>
                      ))}
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => setCreatingDistributor(true)}
                    title="Crear nuevo distribuidor"
                  >
                    <Plus size={16} />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
