import { useState, useMemo, useEffect } from "react";
import { useNavigate, useLocation } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  MapPin,
  Clock,
  TrendingUp,
  AlertCircle,
  ArrowLeft,
  Map,
  List,
  Search,
  Filter,
  Calendar,
  Route as RouteIcon,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import { useRouteDayPdvsForDate, routeDayPdvToPointOfSaleUI, useRoutes, usePdvs } from "@/lib/api";
import { useJsApiLoader, GoogleMap, MarkerF, PolylineF } from "@react-google-maps/api";
import { DateSelector } from "../components/DateSelector";
import { getCurrentUser } from "../lib/auth";
import { useSelectedDate } from "../lib/SelectedDateContext";

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const LIBRARIES: ("places")[] = ["places"];

type StatusFilter = "all" | "pending" | "in-progress" | "completed" | "not-visited";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "pending", label: "Pendiente" },
  { value: "in-progress", label: "En Curso" },
  { value: "completed", label: "Completa" },
  { value: "not-visited", label: "No Visitada" },
];

const STATUS_COLORS: Record<string, string> = {
  completed: "#22c55e",
  "in-progress": "#f59e0b",
  pending: "#A48242",
  "not-visited": "#ef4444",
};

export function RouteFocoPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentUser = getCurrentUser();
  const stateDate = location.state?.selectedDate;

  const { isLoaded: mapsLoaded } = useJsApiLoader({
    id: "google-map-script-places",
    googleMapsApiKey: GOOGLE_MAPS_KEY || " ",
    libraries: LIBRARIES,
    preventGoogleFontsLoading: true,
  });
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const { selectedDate, setSelectedDate, goToToday, isToday } = useSelectedDate();
  const [isDateSelectorOpen, setIsDateSelectorOpen] = useState(false);

  const completedPdvId = (location.state as { completedPdvId?: number } | null)?.completedPdvId;

  const isAdmin = ["admin", "supervisor"].includes(currentUser.role);
  const userIdForFilter = isAdmin ? undefined : Number(currentUser.id) || undefined;

  useEffect(() => {
    if (stateDate) {
      setSelectedDate(new Date(stateDate));
    }
  }, [stateDate, setSelectedDate]);

  const { data: routeDayPdvs, loading } = useRouteDayPdvsForDate(
    selectedDate,
    userIdForFilter
  );
  const { data: routes } = useRoutes();
  const pointsOfSale = useMemo(
    () => routeDayPdvs.map(routeDayPdvToPointOfSaleUI),
    [routeDayPdvs]
  );

  const filteredPOS = useMemo(() => {
    return pointsOfSale.filter((pos) => {
      const matchesSearch =
        pos.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (pos.address || "").toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus =
        statusFilter === "all" || pos.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [pointsOfSale, searchTerm, statusFilter]);

  // Find next PDV to visit (first pending after the last completed)
  const nextPdv = useMemo(() => {
    const pending = pointsOfSale.filter((p) => p.status === "pending" || p.status === "not-visited");
    return pending[0] || null;
  }, [pointsOfSale]);

  const completedVisits = pointsOfSale.filter((p) => p.status === "completed").length;
  const allCompleted = pointsOfSale.length > 0 && completedVisits === pointsOfSale.length;

  const getStatusLabel = (status: string) => {
    const labels = {
      pending: "Pendiente",
      "in-progress": "En Curso",
      completed: "Completa",
      "not-visited": "No Visitada",
    };
    return labels[status as keyof typeof labels] || status;
  };

  const getStatusVariant = (status: string) => {
    const variants = {
      pending: "default" as const,
      "in-progress": "default" as const,
      completed: "secondary" as const,
      "not-visited": "destructive" as const,
    };
    return variants[status as keyof typeof variants] || "default";
  };

  const getPriorityColor = (priority: string) => {
    const colors = {
      high: "bg-red-500",
      medium: "bg-yellow-500",
      low: "bg-green-500",
    };
    return colors[priority as keyof typeof colors] || "bg-secondary";
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "bg-green-500";
      case "in-progress": return "bg-amber-500";
      case "pending": return "bg-muted-foreground/30";
      case "not-visited": return "bg-muted-foreground/30";
      default: return "bg-muted-foreground/30";
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="bg-card border-b border-border p-4 sticky top-0 z-10 space-y-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/")} className="p-1.5 hover:bg-muted rounded-lg">
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-foreground">Ruta del Día</h1>
            <p className="text-xs text-muted-foreground">
              {completedVisits}/{pointsOfSale.length} completadas
            </p>
          </div>
          {/* View toggle compact */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button onClick={() => setViewMode("list")}
              className={`p-1.5 transition-colors ${viewMode === "list" ? "bg-[#A48242] text-white" : "text-muted-foreground hover:bg-muted"}`}>
              <List size={18} />
            </button>
            <button onClick={() => setViewMode("map")}
              className={`p-1.5 transition-colors ${viewMode === "map" ? "bg-[#A48242] text-white" : "text-muted-foreground hover:bg-muted"}`}>
              <Map size={18} />
            </button>
          </div>
          {!isToday && (
            <button onClick={goToToday}
              className="px-2 py-1 bg-[#A48242] text-white rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-[#A48242]/90"
              title="Ir a hoy">
              Hoy
            </button>
          )}
          <button onClick={() => setIsDateSelectorOpen(true)}
            className="px-2 py-1 bg-[#A48242]/10 rounded-lg text-[#A48242] text-sm font-medium">
            {selectedDate.getDate()}/{selectedDate.getMonth() + 1}
          </button>
        </div>

        {/* Search + filters */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
          <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 h-9 text-sm" />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
          {STATUS_OPTIONS.map((opt) => (
            <button key={opt.value} onClick={() => setStatusFilter(opt.value)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                statusFilter === opt.value ? "bg-[#A48242] text-white" : "bg-muted text-muted-foreground"
              }`}>
              {opt.label}
            </button>
          ))}
          {/* Agregar PDV fuera de ruta (#6b) */}
          <button
            onClick={() => navigate("/search-pdv")}
            className="px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap border border-dashed border-[#A48242]/40 text-[#A48242] hover:bg-[#A48242]/10"
          >
            + Fuera de ruta
          </button>
        </div>
      </div>

      <DateSelector isOpen={isDateSelectorOpen} onClose={() => setIsDateSelectorOpen(false)} selectedDate={selectedDate} onDateSelect={setSelectedDate} />

      {/* All completed banner */}
      {allCompleted && (
        <button onClick={() => navigate("/end-of-day")} className="mx-4 mt-3 flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-xl">
          <CheckCircle2 size={20} className="text-green-600 shrink-0" />
          <div className="flex-1 text-left">
            <p className="font-semibold text-green-900 text-sm">Ruta completada</p>
            <p className="text-[10px] text-green-700">Toca para ver el cierre del día</p>
          </div>
          <ChevronRight size={16} className="text-green-400" />
        </button>
      )}

      {/* Content */}
      {viewMode === "list" ? (
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Cargando ruta...</div>
          ) : filteredPOS.length === 0 ? (
            <div className="p-8 text-center">
              <MapPin size={32} className="mx-auto text-muted-foreground mb-2 opacity-40" />
              <p className="font-medium text-foreground text-sm">Sin visitas planificadas</p>
              <p className="text-xs text-muted-foreground mt-1">
                {searchTerm ? "Probá con otros términos" : statusFilter !== "all" ? "Sin visitas con ese estado" : "Sin PDVs para esta fecha"}
              </p>
              {!searchTerm && statusFilter === "all" && (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate("/search-pdv")}>Buscar PDV</Button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredPOS.map((pos, idx) => (
                <button
                  key={pos.id}
                  onClick={() => navigate(`/pos/${pos.id}`, { state: pos.routeDayId ? { routeDayId: pos.routeDayId } : undefined })}
                  className="w-full flex items-center gap-3 p-3.5 text-left hover:bg-muted/40 active:bg-muted/60 transition-colors"
                >
                  {/* Order number with status color */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    pos.status === "completed" ? "bg-green-100 text-green-700" :
                    pos.status === "in-progress" ? "bg-amber-100 text-amber-700" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground text-sm truncate">{pos.name}</p>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{pos.address}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className={`text-[10px] px-1.5 py-0 border-0 ${
                      pos.status === "completed" ? "bg-green-100 text-green-700" :
                      pos.status === "in-progress" ? "bg-amber-100 text-amber-700" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      {getStatusLabel(pos.status)}
                    </Badge>
                    <ChevronRight size={16} className="text-muted-foreground" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="h-[calc(100vh-280px)]">
          {!GOOGLE_MAPS_KEY || !mapsLoaded ? (
            <div className="h-full bg-muted flex items-center justify-center">
              <p className="text-muted-foreground">Cargando mapa...</p>
            </div>
          ) : (() => {
            const pdvsWithCoords = filteredPOS.filter((p) => p.lat !== 0 && p.lng !== 0);
            const center = pdvsWithCoords.length > 0
              ? {
                  lat: pdvsWithCoords.reduce((s, p) => s + p.lat, 0) / pdvsWithCoords.length,
                  lng: pdvsWithCoords.reduce((s, p) => s + p.lng, 0) / pdvsWithCoords.length,
                }
              : { lat: -34.6, lng: -58.45 };
            const path = pdvsWithCoords.map((p) => ({ lat: p.lat, lng: p.lng }));

            return (
              <GoogleMap
                mapContainerStyle={{ width: "100%", height: "100%" }}
                center={center}
                zoom={pdvsWithCoords.length <= 1 ? 15 : 13}
                options={{
                  disableDefaultUI: true,
                  zoomControl: true,
                  styles: [
                    { featureType: "poi", stylers: [{ visibility: "off" }] },
                    { featureType: "transit", stylers: [{ visibility: "off" }] },
                  ],
                }}
              >
                {/* Route line */}
                {path.length >= 2 && (
                  <PolylineF
                    path={path}
                    options={{
                      strokeColor: "#A48242",
                      strokeOpacity: 0.6,
                      strokeWeight: 3,
                      geodesic: true,
                    }}
                  />
                )}

                {/* PDV markers */}
                {pdvsWithCoords.map((pos, idx) => {
                  const color = STATUS_COLORS[pos.status] || "#A48242";
                  return (
                    <MarkerF
                      key={pos.id}
                      position={{ lat: pos.lat, lng: pos.lng }}
                      onClick={() =>
                        navigate(`/pos/${pos.id}`, {
                          state: pos.routeDayId ? { routeDayId: pos.routeDayId } : undefined,
                        })
                      }
                      label={{
                        text: String(idx + 1),
                        color: "#fff",
                        fontWeight: "bold",
                        fontSize: "12px",
                      }}
                      icon={{
                        path: google.maps.SymbolPath.CIRCLE,
                        fillColor: color,
                        fillOpacity: 1,
                        strokeColor: "#fff",
                        strokeWeight: 2,
                        scale: 15,
                      }}
                      title={`#${idx + 1} ${pos.name} — ${pos.status === "completed" ? "Completada" : pos.status === "in-progress" ? "En curso" : "Pendiente"}`}
                    />
                  );
                })}
              </GoogleMap>
            );
          })()}

          {/* Map legend overlay */}
          <div className="relative -mt-12 mx-4 mb-2 z-10">
            <div className="bg-white/90 backdrop-blur rounded-lg shadow-lg px-3 py-2 flex items-center justify-center gap-4 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#A48242] inline-block" />
                Pendiente
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
                En curso
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />
                Completada
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
                No visitada
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
