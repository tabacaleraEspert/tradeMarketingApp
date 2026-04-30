import { useState, useEffect, useRef } from "react";
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
  StickyNote,
  CheckCircle2,
  X,
  ArrowRight,
  Flag,
  Calendar,
  BarChart3,
  PhoneCall,
  MessageCircle,
  ChevronDown,
  ChevronUp,
  ImageIcon,
} from "lucide-react";
import { pdvsApi, visitsApi, pdvNotesApi, pdvPhotosApi, routesApi, fetchRouteDayPdvsForDate, useZones, useDistributors, useChannels, useSubChannels, useMyRoutes, ApiError } from "@/lib/api";
import type { PdvPhotoRead, Route } from "@/lib/api";
import { formatDateLong, formatDateCompact, formatTime24, todayAR } from "../lib/dateUtils";
import type { PdvNote } from "@/lib/api";
import { getCurrentUser } from "../lib/auth";
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
  const [pdvNotes, setPdvNotes] = useState<PdvNote[]>([]);
  const [newNoteContent, setNewNoteContent] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [showAddNote, setShowAddNote] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nextPdvId, setNextPdvId] = useState<number | null>(null);
  const [nextPdvName, setNextPdvName] = useState<string | null>(null);
  const [nextRouteDayId, setNextRouteDayId] = useState<number | null>(null);
  const currentUser = getCurrentUser();
  const cameFromCompletedVisit = (location.state as { completedPdvId?: number; fromNextButton?: boolean } | null)?.fromNextButton;
  const [loading, setLoading] = useState(true);
  const [pdvPhotos, setPdvPhotos] = useState<PdvPhotoRead[]>([]);
  const [expandedContactIdx, setExpandedContactIdx] = useState<number | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteNoteId, setDeleteNoteId] = useState<number | null>(null);
  const [showClosedModal, setShowClosedModal] = useState(false);
  const [closedReason, setClosedReason] = useState("");
  const [globalOpenVisit, setGlobalOpenVisit] = useState<{ VisitId: number; PdvId: number; PdvName?: string } | null>(null);
  const [showContactModal, setShowContactModal] = useState(false);
  const [editContacts, setEditContacts] = useState<typeof formData.contacts>([]);
  const [savingContacts, setSavingContacts] = useState(false);
  const [showAssignRouteModal, setShowAssignRouteModal] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [assigningRoute, setAssigningRoute] = useState(false);
  const [detectedRouteDayId, setDetectedRouteDayId] = useState<number | null>(null);
  const [pdvHasRoute, setPdvHasRoute] = useState<boolean | null>(null); // null = loading
  const [routeCheckDone, setRouteCheckDone] = useState(false);
  const [closingAsClosed, setClosingAsClosed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    businessName: "",
    channelId: "" as number | "",
    subChannelId: "" as number | "",
    address: "",
    zoneId: "" as number | "",
    distributorId: "" as number | "",
    monthlyVolume: "" as number | "",
    distributorIds: [] as number[],
    isActive: true,
    inactiveReason: "",
    lat: null as number | null,
    lon: null as number | null,
    openingTime: "",
    closingTime: "",
    visitDay: "" as number | "",
    contacts: [] as { ContactName: string; ContactPhone?: string; ContactRole?: string; DecisionPower?: string; Birthday?: string; Notes?: string; ProfileNotes?: string }[],
  });
  // Modal específico para razón de inactivar
  const [showInactiveReasonModal, setShowInactiveReasonModal] = useState(false);
  const [inactiveReasonDraft, setInactiveReasonDraft] = useState("");

  const { data: zones } = useZones();
  const { data: distributors } = useDistributors();
  const { data: channels } = useChannels();
  const { data: subchannels } = useSubChannels(formData.channelId || null);
  const { data: myRoutes } = useMyRoutes(Number(currentUser.id));

  // Detect if this PDV is in today's route AND if it's in any of MY routes
  useEffect(() => {
    if (!id) { setRouteCheckDone(true); setPdvHasRoute(false); return; }
    const pdvId = Number(id);

    if (routeDayId) {
      setDetectedRouteDayId(routeDayId);
      setPdvHasRoute(true);
      setRouteCheckDone(true);
      return;
    }

    (async () => {
      try {
        // 1. Check if PDV is in today's route day
        const rdpList = await fetchRouteDayPdvsForDate(new Date(), Number(currentUser.id)).catch(() => []);
        const routeDayMatch = rdpList.find((rdp) => rdp.pdv.PdvId === pdvId);
        setDetectedRouteDayId(routeDayMatch?.routeDayId ?? null);

        if (routeDayMatch) {
          setPdvHasRoute(true);
          return;
        }

        // 2. Check all route assignments and cross-reference with my routes
        const [assignments, myRoutesList] = await Promise.all([
          routesApi.listPdvAssignments().catch(() => []),
          routesApi.list({ assigned_user_id: Number(currentUser.id) }).catch(() => []),
        ]);

        // Only count routes explicitly assigned to me (not unassigned ones)
        const myRouteIds = new Set(
          myRoutesList
            .filter((r) => r.AssignedUserId === Number(currentUser.id))
            .map((r) => r.RouteId)
        );
        const isInMyRoute = assignments.some((a) => a.pdvId === pdvId && myRouteIds.has(a.routeId));
        setPdvHasRoute(isInMyRoute);
      } catch {
        setPdvHasRoute(false);
      } finally {
        setRouteCheckDone(true);
      }
    })();
  }, [id, routeDayId, currentUser.id]);

  // The effective routeDayId: either from navigation or auto-detected
  const effectiveRouteDayId = routeDayId ?? detectedRouteDayId;

  const reloadNotes = () => {
    if (!id) return;
    pdvNotesApi.list(Number(id)).then(setPdvNotes).catch(() => setPdvNotes([]));
  };

  const loadData = () => {
    if (!id) return;
    const pdvId = Number(id);
    setLoadError(null);
    Promise.all([
      pdvsApi.get(pdvId).catch((e) => {
        setLoadError(
          e instanceof ApiError ? e.message : "No se pudo cargar el PDV"
        );
        return null;
      }),
      visitsApi.list({ pdv_id: pdvId }).catch(() => []),
      pdvNotesApi.list(pdvId).catch(() => [] as PdvNote[]),
      pdvPhotosApi.list(pdvId).catch(() => [] as PdvPhotoRead[]),
    ]).then(async ([p, v, n, photos]) => {
      setPos(p);
      setVisits(v);
      setPdvNotes(n);
      setPdvPhotos(photos);

      // Check for any open visit by this user (in ANY pdv)
      try {
        const userVisits = await visitsApi.list({ user_id: Number(currentUser.id) });
        const openElsewhere = userVisits.find(
          (uv) => (uv.Status === "OPEN" || uv.Status === "IN_PROGRESS") && uv.PdvId !== Number(id)
        );
        if (openElsewhere) {
          // Try to get the PDV name
          try {
            const otherPdv = await pdvsApi.get(openElsewhere.PdvId);
            setGlobalOpenVisit({ VisitId: openElsewhere.VisitId, PdvId: openElsewhere.PdvId, PdvName: otherPdv.Name });
          } catch {
            setGlobalOpenVisit({ VisitId: openElsewhere.VisitId, PdvId: openElsewhere.PdvId });
          }
        } else {
          setGlobalOpenVisit(null);
        }
      } catch {
        setGlobalOpenVisit(null);
      }
      if (p) {
        const contactsFromPdv = p.Contacts?.length
          ? p.Contacts.map((c) => ({
              ContactName: c.ContactName,
              ContactPhone: c.ContactPhone || undefined,
              ContactRole: c.ContactRole || undefined,
              DecisionPower: c.DecisionPower || undefined,
              Birthday: c.Birthday || undefined,
              Notes: c.Notes || undefined,
              ProfileNotes: c.ProfileNotes || undefined,
            }))
          : p.ContactName
          ? [{ ContactName: p.ContactName, ContactPhone: p.ContactPhone || undefined }]
          : [];
        setFormData({
          name: p.Name,
          businessName: p.BusinessName || "",
          channelId: p.ChannelId ?? "",
          subChannelId: p.SubChannelId ?? "",
          address: p.Address || "",
          zoneId: p.ZoneId ?? "",
          distributorId: p.DistributorId ?? "",
          monthlyVolume: p.MonthlyVolume ?? "",
          distributorIds: p.Distributors?.map((d) => d.DistributorId) || (p.DistributorId ? [p.DistributorId] : []),
          isActive: p.IsActive,
          inactiveReason: p.InactiveReason ?? "",
          lat: p.Lat != null ? Number(p.Lat) : null,
          lon: p.Lon != null ? Number(p.Lon) : null,
          openingTime: p.OpeningTime || "",
          closingTime: p.ClosingTime || "",
          visitDay: p.VisitDay ?? "",
          contacts: contactsFromPdv,
        });
      }
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, [id]);

  // Calcular cuál es el próximo PDV pendiente en la ruta del día
  useEffect(() => {
    if (!id) return;
    const currentPdvId = Number(id);
    const userId = Number(currentUser.id) || undefined;
    fetchRouteDayPdvsForDate(new Date(), userId)
      .then((dayPdvs) => {
        const pending = dayPdvs
          .filter((p) => p.pdv.PdvId !== currentPdvId)
          .filter((p) => {
            const status = (p.ExecutionStatus || "PENDING").toUpperCase();
            return status !== "DONE" && status !== "COMPLETED";
          });
        if (pending.length > 0) {
          setNextPdvId(pending[0].pdv.PdvId);
          setNextPdvName(pending[0].pdv.Name);
          setNextRouteDayId(pending[0].RouteDayId);
        } else {
          setNextPdvId(null);
          setNextPdvName(null);
          setNextRouteDayId(null);
        }
      })
      .catch(() => {
        setNextPdvId(null);
        setNextPdvName(null);
      });
  }, [id, currentUser.id]);

  const handlePdvCerrado = async () => {
    if (!closedReason.trim()) {
      toast.error("Ingresá el motivo");
      return;
    }
    setClosingAsClosed(true);
    try {
      // Create visit and close immediately
      const visit = await visitsApi.create({
        PdvId: Number(id),
        RouteDayId: effectiveRouteDayId ?? undefined,
        Status: "OPEN",
      });
      await visitsApi.update(visit.VisitId, {
        Status: "CLOSED",
        CloseReason: `PDV_CERRADO: ${closedReason.trim()}`,
      });
      toast.success("PDV marcado como cerrado");
      setShowClosedModal(false);
      setClosedReason("");
      // Advance to next
      if (nextPdvId) {
        navigate(`/pos/${nextPdvId}`, {
          state: { routeDayId: nextRouteDayId, fromNextButton: true },
        });
      } else {
        navigate("/end-of-day");
      }
    } catch (e: any) {
      toast.error(e?.message ?? e?.detail ?? "Error al registrar PDV cerrado");
    } finally {
      setClosingAsClosed(false);
    }
  };

  const goToNextPdv = () => {
    if (nextPdvId == null) return;
    navigate(`/pos/${nextPdvId}`, {
      state: { routeDayId: nextRouteDayId, fromNextButton: true },
    });
  };

  const handleAddNote = async () => {
    if (!id || !newNoteContent.trim()) return;
    setSavingNote(true);
    try {
      await pdvNotesApi.create(Number(id), {
        Content: newNoteContent.trim(),
        CreatedByUserId: Number(currentUser.id) || undefined,
      });
      setNewNoteContent("");
      setShowAddNote(false);
      reloadNotes();
      toast.success("Nota agregada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar nota");
    } finally {
      setSavingNote(false);
    }
  };

  const handleResolveNote = async (noteId: number) => {
    try {
      await pdvNotesApi.update(noteId, {
        IsResolved: true,
        ResolvedByUserId: Number(currentUser.id) || undefined,
      });
      reloadNotes();
      toast.success("Nota marcada como resuelta");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    try {
      await pdvNotesApi.delete(noteId);
      reloadNotes();
      toast.success("Nota eliminada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const openEditModal = () => {
    if (pos) {
      const contactsFromPdv = pos.Contacts?.length
        ? pos.Contacts.map((c) => ({
            ContactName: c.ContactName,
            ContactPhone: c.ContactPhone || undefined,
            ContactRole: c.ContactRole || undefined,
            DecisionPower: c.DecisionPower || undefined,
            Birthday: c.Birthday || undefined,
            Notes: c.Notes || undefined,
            ProfileNotes: c.ProfileNotes || undefined,
          }))
        : pos.ContactName
        ? [{ ContactName: pos.ContactName, ContactPhone: pos.ContactPhone || undefined }]
        : [];
      setFormData({
        name: pos.Name,
        businessName: pos.BusinessName || "",
        channelId: pos.ChannelId ?? "",
        subChannelId: pos.SubChannelId ?? "",
        address: pos.Address || "",
        zoneId: pos.ZoneId ?? "",
        distributorId: pos.DistributorId ?? "",
        monthlyVolume: pos.MonthlyVolume ?? "",
        distributorIds: pos.Distributors?.map((d) => d.DistributorId) || (pos.DistributorId ? [pos.DistributorId] : []),
        isActive: pos.IsActive,
        inactiveReason: pos.InactiveReason ?? "",
        lat: pos.Lat != null ? Number(pos.Lat) : null,
        lon: pos.Lon != null ? Number(pos.Lon) : null,
        openingTime: pos.OpeningTime || "",
        closingTime: pos.ClosingTime || "",
        visitDay: pos.VisitDay ?? "",
        contacts: contactsFromPdv.length > 0 ? contactsFromPdv : [{ ContactName: "", ContactPhone: "", ContactRole: "", DecisionPower: "", Birthday: "", Notes: "", ProfileNotes: "" }],
      });
      setIsEditModalOpen(true);
    }
  };

  const handleSave = async () => {
    if (!id || !formData.name || !formData.channelId) {
      toast.error("Nombre y canal son obligatorios");
      return;
    }
    if (!formData.isActive && !formData.inactiveReason.trim()) {
      toast.error("Ingresá el motivo de desactivación");
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
          Notes: c.Notes?.trim() || undefined,
          ProfileNotes: c.ProfileNotes?.trim() || undefined,
        }));
      await pdvsApi.update(Number(id), {
        Name: formData.name,
        BusinessName: formData.businessName || undefined,
        ChannelId: Number(formData.channelId),
        SubChannelId: formData.subChannelId ? Number(formData.subChannelId) : undefined,
        MonthlyVolume: formData.monthlyVolume !== "" ? Number(formData.monthlyVolume) : undefined,
        Address: formData.address || undefined,
        ZoneId: formData.zoneId || undefined,
        DistributorId: formData.distributorId || undefined,
        DistributorIds: formData.distributorIds.length > 0 ? formData.distributorIds : undefined,
        IsActive: formData.isActive,
        InactiveReason: !formData.isActive ? formData.inactiveReason.trim() : undefined,
        Lat: formData.lat ?? undefined,
        Lon: formData.lon ?? undefined,
        OpeningTime: formData.openingTime || undefined,
        ClosingTime: formData.closingTime || undefined,
        VisitDay: formData.visitDay === "" ? undefined : Number(formData.visitDay),
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

  const handleAssignToRoute = async () => {
    if (!id || !selectedRouteId) return;
    setAssigningRoute(true);
    try {
      // Get current PDVs in the route to determine sort order
      const existingPdvs = await routesApi.listPdvs(selectedRouteId);
      const sortOrder = existingPdvs.length + 1;
      await routesApi.addPdv(selectedRouteId, { PdvId: Number(id), SortOrder: sortOrder });
      const routeName = myRoutes.find((r) => r.RouteId === selectedRouteId)?.Name || "ruta";
      toast.success(`PDV agregado a ${routeName}`);
      setShowAssignRouteModal(false);
      // Mark as having route immediately — no need to re-check
      setPdvHasRoute(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al asignar ruta");
    } finally {
      setAssigningRoute(false);
    }
  };

  const openContactModal = () => {
    const contacts = pos?.Contacts?.length
      ? pos.Contacts.map((c) => ({
          ContactName: c.ContactName,
          ContactPhone: c.ContactPhone || "",
          ContactRole: c.ContactRole || "",
          DecisionPower: c.DecisionPower || "",
          Birthday: c.Birthday || "",
          Notes: c.Notes || "",
          ProfileNotes: c.ProfileNotes || "",
        }))
      : pos?.ContactName
      ? [{ ContactName: pos.ContactName, ContactPhone: pos.ContactPhone || "", ContactRole: "", DecisionPower: "", Birthday: "", Notes: "", ProfileNotes: "" }]
      : [{ ContactName: "", ContactPhone: "", ContactRole: "", DecisionPower: "", Birthday: "", Notes: "", ProfileNotes: "" }];
    setEditContacts(contacts);
    setShowContactModal(true);
  };

  const handleSaveContacts = async () => {
    if (!id) return;
    setSavingContacts(true);
    try {
      const contactsToSend = editContacts
        .filter((c) => c.ContactName.trim())
        .map((c) => ({
          ContactName: c.ContactName.trim(),
          ContactPhone: c.ContactPhone?.trim() || undefined,
          ContactRole: c.ContactRole?.trim() || undefined,
          DecisionPower: c.DecisionPower?.trim() || undefined,
          Birthday: c.Birthday || undefined,
          Notes: c.Notes?.trim() || undefined,
          ProfileNotes: c.ProfileNotes?.trim() || undefined,
        }));
      await pdvsApi.update(Number(id), { Contacts: contactsToSend });
      toast.success("Contactos actualizados");
      setShowContactModal(false);
      loadData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar contactos");
    } finally {
      setSavingContacts(false);
    }
  };

  // Toggle activo/inactivo desde el switch — si va a desactivar, pide razón
  const handleToggleActiveWithReason = (newActive: boolean) => {
    if (!newActive) {
      // Desactivando → abrir modal para pedir razón
      setInactiveReasonDraft("");
      setShowInactiveReasonModal(true);
    } else {
      // Reactivando → directo
      handleToggleActive();
    }
  };

  const confirmInactivate = async () => {
    if (!id || !pos) return;
    if (!inactiveReasonDraft.trim()) {
      toast.error("Por favor indicá la razón");
      return;
    }
    setSaving(true);
    try {
      await pdvsApi.update(Number(id), {
        IsActive: false,
        InactiveReason: inactiveReasonDraft.trim(),
      });
      setPos((p) => (p ? { ...p, IsActive: false, InactiveReason: inactiveReasonDraft.trim() } : null));
      toast.success("PDV desactivado");
      setShowInactiveReasonModal(false);
      setInactiveReasonDraft("");
      loadData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
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
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <AlertCircle size={48} className="mx-auto text-destructive/70" />
          <p className="text-base font-semibold text-foreground">
            {loadError || "Punto de venta no encontrado"}
          </p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={loadData}>
              Reintentar
            </Button>
            <Button onClick={() => navigate(-1)}>
              Volver
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Check if there's an OPEN visit right now (for this routeDay or any)
  const openVisit = posVisits.find((v) => v.Status === "OPEN" || v.Status === "IN_PROGRESS");
  const isVisitInProgress = !!openVisit;

  // Check if TODAY's visit for this routeDay is already completed
  const todayStr = todayAR();
  const isTodayCompleted = effectiveRouteDayId
    ? posVisits.some((v) =>
        v.RouteDayId === effectiveRouteDayId &&
        (v.Status === "CLOSED" || v.Status === "COMPLETED")
      )
    : posVisits.some((v) =>
        v.OpenedAt.startsWith(todayStr) &&
        (v.Status === "CLOSED" || v.Status === "COMPLETED")
      );

  // Show check-in button when: no open visit here, not completed today, AND no open visit in another PDV
  const canCheckIn = !isVisitInProgress && !isTodayCompleted && !globalOpenVisit;

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
            {!["vendedor", "tm_rep"].includes((currentUser.role || "").toLowerCase()) && (
              <Button variant="outline" size="sm" onClick={() => setIsDeleteModalOpen(true)}>
                <Trash2 size={18} className="text-red-600" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Banner si el PDV está inactivo */}
        {!pos.IsActive && (
          <Card className="bg-rose-50/70 border-rose-200">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <AlertCircle size={22} className="text-rose-600/80 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-rose-900">PDV inactivo</p>
                  {pos.InactiveReason && (
                    <p className="text-xs text-rose-800 mt-0.5">{pos.InactiveReason}</p>
                  )}
                  {pos.ReactivateOn && (
                    <p className="text-[11px] text-rose-700/80 mt-1">
                      Recordatorio para reactivar:{" "}
                      <strong>
                        {formatDateLong(pos.ReactivateOn)}
                      </strong>
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Banner de "viniste de cerrar una visita" — sólo si tenés un próximo PDV */}
        {cameFromCompletedVisit && nextPdvId != null && (
          <Card className="bg-emerald-50 border-emerald-200">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 size={22} className="text-emerald-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-emerald-900">Ruta en curso</p>
                  <p className="text-xs text-emerald-800">
                    Este es el siguiente PDV pendiente de tu ruta de hoy.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Botón flotante "Siguiente PDV" — aparece si este PDV ya está completado y hay otro pendiente */}
        {isTodayCompleted && nextPdvId != null && (
          <Card className="bg-[#A48242]/10 border-[#A48242]/40">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="bg-[#A48242] rounded-full p-2 flex-shrink-0">
                  <Flag size={18} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">Siguiente PDV pendiente</p>
                  <p className="font-semibold text-foreground truncate">{nextPdvName}</p>
                </div>
                <Button onClick={goToNextPdv} size="sm" className="flex-shrink-0 gap-1">
                  Ir ahí
                  <ArrowRight size={14} />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Si el día ya terminó (no hay más PDVs pendientes) y este ya está completado */}
        {isTodayCompleted && nextPdvId == null && (
          <Card className="bg-emerald-50 border-emerald-200">
            <CardContent className="p-4 text-center">
              <CheckCircle2 size={28} className="mx-auto text-emerald-600 mb-2" />
              <p className="font-semibold text-emerald-900">¡Terminaste tu ruta del día!</p>
              <p className="text-xs text-emerald-800 mb-3">No hay más PDVs pendientes para hoy.</p>
              <Button variant="outline" size="sm" onClick={() => navigate("/end-of-day")}>
                Ir al cierre del día
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Notas y TODOs del PDV */}
        <Card className={pdvNotes.some((n) => !n.IsResolved) ? "bg-amber-50/60 border-amber-200" : "border-border"}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <StickyNote size={18} className="text-amber-600/80" />
                <h3 className="font-semibold text-foreground">Notas del PDV</h3>
                {pdvNotes.filter((n) => !n.IsResolved).length > 0 && (
                  <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">
                    {pdvNotes.filter((n) => !n.IsResolved).length} pendiente{pdvNotes.filter((n) => !n.IsResolved).length === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
              {!showAddNote && (
                <Button size="sm" variant="outline" onClick={() => setShowAddNote(true)} className="gap-1 h-7 text-xs">
                  <Plus size={12} /> Nueva
                </Button>
              )}
            </div>

            {showAddNote && (
              <div className="mb-3 space-y-2">
                <textarea
                  value={newNoteContent}
                  onChange={(e) => setNewNoteContent(e.target.value)}
                  placeholder="Ej: Hablar con Juan sobre el reposicionamiento de cigarreras. Pasar a buscar el material que quedó..."
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm resize-none"
                  rows={3}
                  autoFocus
                />
                <div className="flex items-center justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setShowAddNote(false); setNewNoteContent(""); }}>
                    Cancelar
                  </Button>
                  <Button size="sm" disabled={!newNoteContent.trim() || savingNote} onClick={handleAddNote}>
                    {savingNote ? "Guardando..." : "Agregar nota"}
                  </Button>
                </div>
              </div>
            )}

            {pdvNotes.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">
                Sin notas. Dejá una para que el próximo TM Rep que visite este PDV la vea.
              </p>
            ) : (
              <div className="space-y-2">
                {pdvNotes.filter((n) => !n.IsResolved).map((n) => (
                  <div key={n.PdvNoteId} className="flex items-start gap-2 p-3 bg-white rounded-lg border border-amber-200/60">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground whitespace-pre-wrap break-words">{n.Content}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {n.CreatedByName ?? "Usuario"} · {formatDateCompact(n.CreatedAt)}
                      </p>
                    </div>
                    <button
                      onClick={() => handleResolveNote(n.PdvNoteId)}
                      className="p-1.5 rounded hover:bg-emerald-100 text-emerald-600/80"
                      title="Marcar como resuelta"
                    >
                      <CheckCircle2 size={16} />
                    </button>
                    <button
                      onClick={() => setDeleteNoteId(n.PdvNoteId)}
                      className="p-1.5 rounded hover:bg-red-100 text-muted-foreground hover:text-red-600"
                      title="Eliminar"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
                {pdvNotes.filter((n) => n.IsResolved).length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      {pdvNotes.filter((n) => n.IsResolved).length} resuelta{pdvNotes.filter((n) => n.IsResolved).length === 1 ? "" : "s"}
                    </summary>
                    <div className="space-y-1.5 mt-2">
                      {pdvNotes.filter((n) => n.IsResolved).slice(0, 5).map((n) => (
                        <div key={n.PdvNoteId} className="text-xs text-muted-foreground line-through pl-3 border-l-2 border-emerald-200">
                          {n.Content}
                          <span className="block text-[9px] no-underline">
                            ✓ {n.ResolvedByName ?? "Usuario"} · {n.ResolvedAt ? formatDateCompact(n.ResolvedAt) : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recordatorio próxima visita - legacy CloseReason */}
        {!isVisitInProgress && lastClosedVisit?.CloseReason && (
          <Card className="bg-amber-50/60 border-amber-200">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <MessageSquare size={22} className="text-amber-600/80 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-amber-900 mb-1">Recordatorio última visita</h3>
                  <p className="text-sm text-amber-800">{lastClosedVisit.CloseReason}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Contactos del PDV — card prominente */}
        <Card className="border-[#A48242]/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <User size={18} className="text-[#A48242]" />
                <h3 className="font-semibold text-foreground">Personas del local</h3>
              </div>
              <Button size="sm" variant="outline" onClick={openContactModal} className="gap-1 h-8 text-xs">
                <Edit size={12} /> Editar
              </Button>
            </div>

            {(() => {
              const contacts = pos.Contacts?.length
                ? pos.Contacts
                : pos.ContactName
                ? [{ ContactName: pos.ContactName, ContactPhone: pos.ContactPhone, ContactRole: null, DecisionPower: null, Birthday: null, Notes: null, ProfileNotes: null }]
                : [];

              if (contacts.length === 0) {
                return (
                  <button
                    onClick={openContactModal}
                    className="w-full p-4 border-2 border-dashed border-border rounded-lg text-center hover:border-[#A48242]/50 hover:bg-[#A48242]/5 transition-colors"
                  >
                    <Plus size={20} className="mx-auto text-muted-foreground mb-1" />
                    <p className="text-sm text-muted-foreground">Agregar contacto</p>
                  </button>
                );
              }

              return (
                <div className="space-y-2">
                  {contacts.map((c, i) => {
                    const isExpanded = expandedContactIdx === i;
                    const phone = c.ContactPhone?.replace(/[^0-9+]/g, "") || "";
                    return (
                      <div key={i} className="p-3 bg-muted/60 rounded-lg border border-border/50">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-[#A48242]/15 flex items-center justify-center shrink-0">
                            <User size={20} className="text-[#A48242]" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-foreground">{c.ContactName}</p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                              {c.ContactRole && <Badge variant="outline" className="text-[10px] py-0">{c.ContactRole}</Badge>}
                              {c.DecisionPower && <Badge variant={c.DecisionPower === "alto" ? "default" : "secondary"} className="text-[10px] py-0">Decisión: {c.DecisionPower}</Badge>}
                              {c.Birthday && (
                                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                  <Cake size={10} />
                                  {new Date(c.Birthday).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "short" })}
                                </span>
                              )}
                            </div>
                          </div>
                          <button onClick={() => setExpandedContactIdx(isExpanded ? null : i)} className="p-1 text-muted-foreground hover:text-foreground">
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </button>
                        </div>

                        {/* Quick action bar: phone + whatsapp */}
                        {phone && (
                          <div className="flex gap-2 mt-2 ml-[52px]">
                            <a href={`tel:${phone}`} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-100 hover:bg-green-200 transition-colors text-xs font-medium text-green-800">
                              <PhoneCall size={14} /> {c.ContactPhone}
                            </a>
                            <a href={`https://wa.me/549${phone.replace(/^\+?54?9?/, "")}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-100 hover:bg-emerald-200 transition-colors text-xs font-medium text-emerald-800">
                              <MessageCircle size={14} /> WhatsApp
                            </a>
                          </div>
                        )}

                        {isExpanded && (
                          <div className="mt-2 pt-2 border-t border-border/50 ml-[52px] space-y-1.5">
                            {c.Birthday && <div className="flex items-center gap-1.5"><Cake size={13} className="text-muted-foreground" /><span className="text-xs text-foreground">Cumpleaños: {new Date(c.Birthday).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "long" })}</span></div>}
                            {(c as any).Notes && <div className="p-2 bg-amber-50/50 rounded text-xs text-amber-900"><span className="font-semibold">Notas:</span> {(c as any).Notes}</div>}
                            {(c as any).ProfileNotes && <div className="p-2 bg-blue-50/50 rounded text-xs text-blue-900"><span className="font-semibold">Perfil:</span> {(c as any).ProfileNotes}</div>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Main Info Card */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <span className="text-sm font-medium text-foreground">PDV activo</span>
              <Switch
                checked={pos.IsActive}
                onCheckedChange={handleToggleActiveWithReason}
                disabled={saving}
              />
            </div>

            {/* === DATOS DEL LOCAL (pasos 5-8) === */}
            <p className="text-[10px] font-bold text-[#A48242] uppercase tracking-wider mt-3 mb-1">Datos del local</p>

            {/* Razón social */}
            {pos.BusinessName && (
              <div className="flex items-start gap-2">
                <Building2 size={18} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm text-muted-foreground">Razón social</p>
                  <p className="font-medium text-foreground">{pos.BusinessName}</p>
                </div>
              </div>
            )}

            <div className="flex items-start gap-2">
              <MapPin size={18} className="text-muted-foreground mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-muted-foreground">Dirección</p>
                <p className="font-medium text-foreground">{pos.Address || pos.City || "-"}</p>
              </div>
            </div>

            {/* Horarios */}
            {(pos.OpeningTime || pos.ClosingTime) && (
              <div className="flex items-start gap-2">
                <Clock size={18} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm text-muted-foreground">Horario</p>
                  <p className="font-medium text-foreground">
                    {pos.OpeningTime || "?"} — {pos.ClosingTime || "?"}
                  </p>
                </div>
              </div>
            )}

            {/* Día de visita */}
            {pos.VisitDay != null && (
              <div className="flex items-start gap-2">
                <Calendar size={18} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm text-muted-foreground">Día de visita</p>
                  <p className="font-medium text-foreground">
                    {["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"][pos.VisitDay] ?? "-"}
                  </p>
                </div>
              </div>
            )}

            {/* Volumen / Categoría */}
            {(pos.MonthlyVolume != null || pos.Category) && (
              <div className="flex items-start gap-2">
                <BarChart3 size={18} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm text-muted-foreground">Volumen mensual</p>
                  <p className="font-medium text-foreground">
                    {pos.MonthlyVolume != null ? `${pos.MonthlyVolume.toLocaleString()} atados/mes` : "-"}
                    {pos.Category && (
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded ${
                        pos.Category === "Grande" ? "bg-emerald-100 text-emerald-800" :
                        pos.Category === "Mediano" ? "bg-amber-100 text-amber-800" :
                        "bg-slate-100 text-slate-700"
                      }`}>
                        {pos.Category}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            )}

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

            {/* Distribuidores */}
            <div className="flex items-start gap-2">
              <Building2 size={18} className="text-muted-foreground mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-muted-foreground">Distribuidor{pos.Distributors && pos.Distributors.length > 1 ? "es" : ""}</p>
                {pos.Distributors && pos.Distributors.length > 0 ? (
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {pos.Distributors.map((d) => (
                      <span key={d.DistributorId} className="text-xs px-2 py-0.5 bg-muted rounded font-medium">{d.Name}</span>
                    ))}
                  </div>
                ) : (
                  <p className="font-medium text-foreground">-</p>
                )}
              </div>
            </div>

            {/* === UBICACIÓN === */}
            <p className="text-[10px] font-bold text-[#A48242] uppercase tracking-wider mt-3 mb-1">Ubicación</p>

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

        {/* Galería de fotos del PDV */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <ImageIcon size={18} className="text-[#A48242]" />
                Fotos del local
              </h3>
              <div>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file || !id) return;
                    try {
                      const photo = await pdvPhotosApi.upload(Number(id), file, { photoType: "fachada" });
                      setPdvPhotos((prev) => [...prev, photo]);
                      toast.success("Foto subida");
                    } catch {
                      toast.error("Error al subir foto");
                    }
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => photoInputRef.current?.click()}
                  className="gap-1"
                >
                  <Camera size={14} />
                  Agregar
                </Button>
              </div>
            </div>
            {pdvPhotos.length === 0 ? (
              <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                <Camera size={32} className="mx-auto text-muted-foreground mb-2 opacity-40" />
                <p className="text-xs text-muted-foreground">Sin fotos del local</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => photoInputRef.current?.click()}
                  className="mt-2 text-xs text-[#A48242]"
                >
                  Tomar primera foto
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {pdvPhotos.map((photo) => (
                  <div key={photo.FileId} className="relative group">
                    <img
                      src={photo.url}
                      alt={photo.PhotoType}
                      className="w-full h-24 object-cover rounded-lg border border-border"
                    />
                    <div className="absolute bottom-1 left-1">
                      <Badge variant="secondary" className="text-[8px] px-1 py-0">{photo.PhotoType}</Badge>
                    </div>
                    <button
                      onClick={async () => {
                        if (!id) return;
                        try {
                          await pdvPhotosApi.delete(Number(id), photo.FileId);
                          setPdvPhotos((prev) => prev.filter((p) => p.FileId !== photo.FileId));
                          toast.success("Foto eliminada");
                        } catch { toast.error("Error al eliminar"); }
                      }}
                      className="absolute top-1 right-1 p-0.5 bg-black/60 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={12} className="text-white" />
                    </button>
                  </div>
                ))}
              </div>
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
                  {formatDateLong(lastVisit.OpenedAt)}
                </p>
              </div>
            )}
          </CardContent>
        </Card>


        {/* Action Buttons */}
        <div className="space-y-3 pb-4">
          {/* Blocked: open visit in another PDV */}
          {globalOpenVisit && !isVisitInProgress && (
            <Card className="border-amber-300 bg-amber-50">
              <CardContent className="p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle size={18} className="text-amber-600 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-amber-900">
                      Tenés una visita abierta en {globalOpenVisit.PdvName || `PDV #${globalOpenVisit.PdvId}`}
                    </p>
                    <p className="text-xs text-amber-700 mt-1">
                      Cerrá esa visita antes de hacer check-in en otro PDV.
                    </p>
                  </div>
                </div>
                <Button
                  className="w-full mt-2 h-10 text-sm bg-amber-600 hover:bg-amber-700"
                  onClick={() => navigate(`/pos/${globalOpenVisit.PdvId}`)}
                >
                  Ir a cerrar visita
                </Button>
              </CardContent>
            </Card>
          )}

          {/* CASE 1: Has route → Check-in */}
          {canCheckIn && pdvHasRoute === true && (
            <div className="space-y-2">
              <Button
                className="w-full h-14 text-base font-semibold bg-[#A48242] hover:bg-[#8B6E38]"
                size="lg"
                onClick={() =>
                  navigate(`/pos/${id}/checkin`, {
                    state: effectiveRouteDayId ? { routeDayId: effectiveRouteDayId } : undefined,
                  })
                }
              >
                <MapPin className="mr-2" size={20} />
                Iniciar Visita — Check-in
              </Button>
              <Button
                variant="outline"
                className="w-full h-10 text-sm border-red-200 text-red-600 hover:bg-red-50"
                onClick={() => setShowClosedModal(true)}
              >
                <X className="mr-2" size={16} />
                PDV Cerrado
              </Button>
            </div>
          )}

          {/* CASE 2: No route → Assign route (no check-in) */}
          {canCheckIn && pdvHasRoute === false && routeCheckDone && (
            <div className="space-y-2">
              <Button
                className="w-full h-14 text-base font-semibold bg-[#A48242] hover:bg-[#8B6E38]"
                size="lg"
                onClick={() => { setSelectedRouteId(null); setShowAssignRouteModal(true); }}
              >
                <Plus className="mr-2" size={20} />
                Asignar a Ruta
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Este PDV no está en ninguna ruta. Asignalo para poder hacer check-in.
              </p>
            </div>
          )}

          {/* Visit in progress: show relevamiento + photos + actions */}
          {isVisitInProgress && (
            <>
              <Card className="border-[#A48242] bg-[#A48242]/5">
                <CardContent className="p-3">
                  <p className="text-xs font-medium text-[#A48242] mb-2 flex items-center gap-1">
                    <Clock size={12} />
                    Visita en curso — {formatTime24(openVisit!.OpenedAt)}
                  </p>
                  <div className="space-y-2">
                    <Button
                      className="w-full h-12 text-sm font-semibold"
                      onClick={() =>
                        navigate(`/pos/${id}/survey`, {
                          state: { routeDayId: effectiveRouteDayId, visitId: openVisit?.VisitId },
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
                            state: { routeDayId: effectiveRouteDayId, visitId: openVisit?.VisitId },
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
                          navigate(`/pos/${id}/actions`, {
                            state: { routeDayId: effectiveRouteDayId, visitId: openVisit?.VisitId },
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
          <div className="pb-4 border-b border-border space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">PDV activo</label>
              <Switch
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData((f) => ({ ...f, isActive: checked, inactiveReason: checked ? "" : f.inactiveReason }))}
              />
            </div>
            {!formData.isActive && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
                <p className="text-xs font-medium text-red-700">Motivo de desactivación <span className="text-red-500">*</span></p>
                <div className="flex flex-wrap gap-1.5">
                  {["Cerró definitivamente", "No quiere trabajar con nosotros", "Cerró por reformas", "Sin stock recurrente", "Otro"].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setFormData((f) => ({ ...f, inactiveReason: r === "Otro" ? "" : r }))}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                        formData.inactiveReason === r ? "bg-red-100 border-red-300 text-red-700" : "bg-white border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <textarea
                  placeholder="Detalle del motivo..."
                  value={formData.inactiveReason}
                  onChange={(e) => setFormData((f) => ({ ...f, inactiveReason: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 border border-red-200 rounded-lg text-sm resize-none bg-white"
                />
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Nombre de fantasía <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="Ej: Kiosco El Rápido"
                value={formData.name}
                onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Razón social <span className="text-muted-foreground text-xs">(opcional)</span>
              </label>
              <Input
                placeholder="Ej: Kiosco El Rápido S.R.L."
                value={formData.businessName}
                onChange={(e) => setFormData((f) => ({ ...f, businessName: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Canal <span className="text-red-500">*</span>
              </label>
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
            <label className="block text-sm font-medium text-foreground mb-1">Volumen mensual (atados)</label>
            <Input
              type="number"
              min={0}
              placeholder="Ej: 500"
              value={formData.monthlyVolume === "" ? "" : formData.monthlyVolume}
              onChange={(e) =>
                setFormData((f) => ({ ...f, monthlyVolume: e.target.value ? Number(e.target.value) : "" }))
              }
            />
            {formData.monthlyVolume !== "" && (
              <p className={`text-xs mt-1 font-medium ${
                Number(formData.monthlyVolume) > 1500 ? "text-emerald-700" :
                Number(formData.monthlyVolume) > 800 ? "text-amber-700" : "text-slate-600"
              }`}>
                Categoría: {Number(formData.monthlyVolume) > 1500 ? "Grande" : Number(formData.monthlyVolume) > 800 ? "Mediano" : "Chico"}
              </p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Horario apertura</label>
              <Input
                type="time"
                value={formData.openingTime}
                onChange={(e) => setFormData((f) => ({ ...f, openingTime: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Horario cierre</label>
              <Input
                type="time"
                value={formData.closingTime}
                onChange={(e) => setFormData((f) => ({ ...f, closingTime: e.target.value }))}
              />
            </div>
            {/* Día de visita: sólo visible para supervisores+, no para vendedores */}
            {!["vendedor"].includes((currentUser.role || "").toLowerCase()) && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Día de visita</label>
              <select
                className="w-full h-10 px-3 border border-border rounded-md text-sm bg-background"
                value={formData.visitDay === "" ? "" : String(formData.visitDay)}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, visitDay: e.target.value === "" ? "" : Number(e.target.value) }))
                }
              >
                <option value="">Sin día fijo</option>
                <option value="1">Lunes</option>
                <option value="2">Martes</option>
                <option value="3">Miércoles</option>
                <option value="4">Jueves</option>
                <option value="5">Viernes</option>
                <option value="6">Sábado</option>
                <option value="0">Domingo</option>
              </select>
            </div>
            )}
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
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                    Observaciones generales
                  </label>
                  <textarea
                    placeholder="Notas operativas. Ej: prefiere ser visitado por la tarde, cierra los lunes…"
                    value={c.Notes || ""}
                    onChange={(e) =>
                      setFormData((f) => ({
                        ...f,
                        contacts: f.contacts.map((ct, j) =>
                          j === i ? { ...ct, Notes: e.target.value } : ct
                        ),
                      }))
                    }
                    rows={2}
                    className="w-full text-xs px-3 py-2 border border-border rounded-md resize-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                    Perfil del contacto
                  </label>
                  <textarea
                    placeholder="Preferencias / qué evitar. Ej: hincha de Boca, no hablar de política, le interesa el fútbol…"
                    value={c.ProfileNotes || ""}
                    onChange={(e) =>
                      setFormData((f) => ({
                        ...f,
                        contacts: f.contacts.map((ct, j) =>
                          j === i ? { ...ct, ProfileNotes: e.target.value } : ct
                        ),
                      }))
                    }
                    rows={2}
                    className="w-full text-xs px-3 py-2 border border-border rounded-md resize-none"
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
              <label className="block text-sm font-medium text-foreground mb-1">Distribuidores</label>
              {/* Chips de distribuidores seleccionados */}
              {formData.distributorIds.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {formData.distributorIds.map((did) => {
                    const d = distributors.find((x) => x.DistributorId === did);
                    return (
                      <span key={did} className="inline-flex items-center gap-1 px-2 py-1 bg-muted rounded text-xs">
                        {d?.Name ?? `#${did}`}
                        <button
                          type="button"
                          onClick={() => setFormData((f) => ({ ...f, distributorIds: f.distributorIds.filter((x) => x !== did) }))}
                          className="text-muted-foreground hover:text-red-600"
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              <select
                className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-espert-gold text-sm"
                value=""
                onChange={(e) => {
                  const id = Number(e.target.value);
                  if (id && !formData.distributorIds.includes(id)) {
                    setFormData((f) => ({ ...f, distributorIds: [...f.distributorIds, id] }));
                  }
                }}
              >
                <option value="">Agregar distribuidor...</option>
                {distributors
                  .filter((d) => !formData.distributorIds.includes(d.DistributorId))
                  .map((d) => (
                    <option key={d.DistributorId} value={d.DistributorId}>
                      {d.Name} {d.DistributorType ? `(${d.DistributorType})` : ""}
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

      {/* Delete Note Confirmation */}
      <ConfirmModal
        isOpen={deleteNoteId !== null}
        onClose={() => setDeleteNoteId(null)}
        onConfirm={() => { if (deleteNoteId !== null) handleDeleteNote(deleteNoteId); }}
        title="Eliminar nota"
        message="¿Eliminar esta nota?"
        confirmText="Eliminar"
        type="danger"
      />

      {/* Modal "razón de inactivación" */}
      <Modal
        isOpen={showInactiveReasonModal}
        onClose={() => setShowInactiveReasonModal(false)}
        title="Desactivar PDV"
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowInactiveReasonModal(false)}>
              Cancelar
            </Button>
            <Button onClick={confirmInactivate} disabled={saving || !inactiveReasonDraft.trim()}>
              {saving ? "Guardando..." : "Confirmar"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            ¿Por qué pasás a inactivo este PDV? Esta razón queda registrada y se va a programar
            un recordatorio en <strong>60 días</strong> para revisar si conviene reactivarlo.
          </p>
          <textarea
            placeholder="Ej: el dueño no quiere trabajar con nosotros, cerró por reformas, sin stock recurrente…"
            value={inactiveReasonDraft}
            onChange={(e) => setInactiveReasonDraft(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border border-border rounded-lg text-sm resize-none"
            autoFocus
          />
        </div>
      </Modal>

      {/* Modal PDV Cerrado */}
      <Modal
        isOpen={showClosedModal}
        onClose={() => { setShowClosedModal(false); setClosedReason(""); }}
        title="PDV Cerrado"
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => { setShowClosedModal(false); setClosedReason(""); }}>
              Cancelar
            </Button>
            <Button
              onClick={handlePdvCerrado}
              disabled={closingAsClosed || !closedReason.trim()}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {closingAsClosed ? "Registrando..." : "Confirmar y avanzar"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            El PDV se marcará como visitado sin afectar tu performance.
            Seleccioná o escribí el motivo:
          </p>
          <div className="flex flex-wrap gap-2">
            {["Cerrado por vacaciones", "Cerrado por refacciones", "No atiende hoy", "Horario reducido", "Otro"].map((reason) => (
              <button
                key={reason}
                type="button"
                onClick={() => setClosedReason(reason === "Otro" ? "" : reason)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  closedReason === reason
                    ? "bg-red-100 border-red-300 text-red-700"
                    : "bg-muted border-border text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {reason}
              </button>
            ))}
          </div>
          <textarea
            placeholder="Detalle del motivo..."
            value={closedReason}
            onChange={(e) => setClosedReason(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-border rounded-lg text-sm resize-none"
            autoFocus
          />
        </div>
      </Modal>

      {/* Contact Edit Modal */}
      <Modal
        isOpen={showContactModal}
        onClose={() => setShowContactModal(false)}
        title="Personas del local"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowContactModal(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSaveContacts}
              disabled={savingContacts}
              className="bg-[#A48242] hover:bg-[#8B6E38]"
            >
              {savingContacts ? "Guardando..." : "Guardar contactos"}
            </Button>
          </>
        }
      >
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {editContacts.map((c, idx) => (
            <div key={idx} className="p-4 border border-border rounded-lg space-y-3 relative">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#A48242] uppercase">Contacto {idx + 1}</span>
                {editContacts.length > 1 && (
                  <button
                    onClick={() => setEditContacts((prev) => prev.filter((_, i) => i !== idx))}
                    className="p-1 text-red-400 hover:text-red-600 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground mb-1 block">Nombre *</label>
                  <Input
                    value={c.ContactName}
                    onChange={(e) => setEditContacts((prev) => prev.map((cc, i) => i === idx ? { ...cc, ContactName: e.target.value } : cc))}
                    placeholder="Nombre completo"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Teléfono</label>
                  <Input
                    value={c.ContactPhone || ""}
                    onChange={(e) => setEditContacts((prev) => prev.map((cc, i) => i === idx ? { ...cc, ContactPhone: e.target.value } : cc))}
                    placeholder="11 1234-5678"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Rol</label>
                  <Input
                    value={c.ContactRole || ""}
                    onChange={(e) => setEditContacts((prev) => prev.map((cc, i) => i === idx ? { ...cc, ContactRole: e.target.value } : cc))}
                    placeholder="Dueño, Encargado..."
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Poder de decisión</label>
                  <select
                    value={c.DecisionPower || ""}
                    onChange={(e) => setEditContacts((prev) => prev.map((cc, i) => i === idx ? { ...cc, DecisionPower: e.target.value } : cc))}
                    className="w-full h-10 px-3 border border-border rounded-md text-sm bg-background"
                  >
                    <option value="">—</option>
                    <option value="alto">Alto</option>
                    <option value="medio">Medio</option>
                    <option value="bajo">Bajo</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Cumpleaños</label>
                  <Input
                    type="date"
                    value={c.Birthday || ""}
                    onChange={(e) => setEditContacts((prev) => prev.map((cc, i) => i === idx ? { ...cc, Birthday: e.target.value } : cc))}
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground mb-1 block">Notas</label>
                  <textarea
                    value={c.Notes || ""}
                    onChange={(e) => setEditContacts((prev) => prev.map((cc, i) => i === idx ? { ...cc, Notes: e.target.value } : cc))}
                    placeholder="Observaciones sobre esta persona..."
                    rows={2}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm resize-none"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground mb-1 block">Perfil</label>
                  <textarea
                    value={c.ProfileNotes || ""}
                    onChange={(e) => setEditContacts((prev) => prev.map((cc, i) => i === idx ? { ...cc, ProfileNotes: e.target.value } : cc))}
                    placeholder="Info del perfil comercial..."
                    rows={2}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm resize-none"
                  />
                </div>
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            className="w-full border-dashed"
            onClick={() => setEditContacts((prev) => [...prev, { ContactName: "", ContactPhone: "", ContactRole: "", DecisionPower: "", Birthday: "", Notes: "", ProfileNotes: "" }])}
          >
            <Plus size={16} className="mr-2" /> Agregar contacto
          </Button>
        </div>
      </Modal>

      {/* Assign Route Modal */}
      <Modal
        isOpen={showAssignRouteModal}
        onClose={() => setShowAssignRouteModal(false)}
        title="Asignar a ruta"
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowAssignRouteModal(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleAssignToRoute}
              disabled={!selectedRouteId || assigningRoute}
              className="bg-[#A48242] hover:bg-[#8B6E38]"
            >
              {assigningRoute ? "Asignando..." : "Confirmar"}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground mb-3">
            Elegí la ruta a la que querés agregar <strong>{pos?.Name}</strong>:
          </p>
          {myRoutes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No tenés rutas creadas.</p>
          ) : (
            <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
              {myRoutes.filter((r) => r.IsActive).map((route) => (
                <button
                  key={route.RouteId}
                  onClick={() => setSelectedRouteId(route.RouteId)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                    selectedRouteId === route.RouteId
                      ? "border-[#A48242] bg-[#A48242]/10"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    selectedRouteId === route.RouteId ? "bg-[#A48242] text-white" : "bg-muted text-muted-foreground"
                  }`}>
                    <Navigation size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground text-sm">{route.Name}</p>
                    {route.BejermanZone && (
                      <p className="text-xs text-muted-foreground">{route.BejermanZone}</p>
                    )}
                  </div>
                  {selectedRouteId === route.RouteId && (
                    <CheckCircle2 size={18} className="text-[#A48242] shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
