import { useState, useMemo } from "react";
import { useNavigate } from "react-router";
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
} from "lucide-react";
import { usePdvs, pdvToPointOfSaleUI } from "@/lib/api";

type ActiveFilter = "all" | "active" | "inactive";

const ACTIVE_OPTIONS: { value: ActiveFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Activos" },
  { value: "inactive", label: "Inactivos" },
];

export function RouteList() {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");

  const { data: pdvs, loading } = usePdvs();
  const channels = useMemo(
    () => ["all", ...Array.from(new Set(pdvs.map((p) => p.Channel).filter(Boolean))).sort()],
    [pdvs]
  );

  const filteredPdvs = useMemo(() => {
    return pdvs.filter((p) => {
      const matchesSearch =
        p.Name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.Address || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.City || "").toLowerCase().includes(searchTerm.toLowerCase());
      const matchesActive =
        activeFilter === "all" ||
        (activeFilter === "active" && p.IsActive) ||
        (activeFilter === "inactive" && !p.IsActive);
      const matchesChannel =
        channelFilter === "all" || p.Channel === channelFilter;
      return matchesSearch && matchesActive && matchesChannel;
    });
  }, [pdvs, searchTerm, activeFilter, channelFilter]);

  const pointsOfSale = useMemo(
    () => filteredPdvs.map(pdvToPointOfSaleUI),
    [filteredPdvs]
  );

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
    return colors[priority as keyof typeof colors] || "bg-gray-500";
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate("/")}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-900">Buscar PDV</h1>
            <p className="text-sm text-slate-600 mt-0.5">
              {pointsOfSale.length} de {pdvs.length} puntos de venta
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <Input
            placeholder="Buscar por nombre o dirección..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Filters */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1">
            <Filter size={16} className="text-slate-500 flex-shrink-0" />
            {ACTIVE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setActiveFilter(opt.value)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  activeFilter === opt.value
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {channels.length > 2 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1">
              <span className="text-xs text-slate-500 flex-shrink-0">Canal:</span>
              {channels.map((ch) => (
                <button
                  key={ch}
                  onClick={() => setChannelFilter(ch)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                    channelFilter === ch
                      ? "bg-blue-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {ch === "all" ? "Todos" : ch}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* View Toggle */}
      <div className="sticky top-[180px] z-10 px-4 py-2 bg-slate-50">
        <div className="flex items-center gap-2 bg-white rounded-lg p-1 shadow-sm">
          <button
            onClick={() => setViewMode("list")}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md transition-colors ${
              viewMode === "list" ? "bg-blue-600 text-white" : "text-slate-600"
            }`}
          >
            <List size={18} />
            <span className="text-sm font-medium">Lista</span>
          </button>
          <button
            onClick={() => setViewMode("map")}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md transition-colors ${
              viewMode === "map" ? "bg-blue-600 text-white" : "text-slate-600"
            }`}
          >
            <Map size={18} />
            <span className="text-sm font-medium">Mapa</span>
          </button>
        </div>
      </div>

      {/* Content */}
      {viewMode === "list" ? (
        <div className="p-4 space-y-3">
          {loading ? (
            <Card className="border-dashed border-2 border-slate-300 bg-slate-50">
              <CardContent className="p-8 text-center">
                <p className="text-slate-600">Cargando PDVs...</p>
              </CardContent>
            </Card>
          ) : pointsOfSale.length === 0 ? (
            <Card className="border-dashed border-2 border-slate-300 bg-slate-50">
              <CardContent className="p-12 text-center">
                <div className="bg-slate-200 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                  <Search size={32} className="text-slate-400" />
                </div>
                <p className="font-semibold text-slate-700 mb-1">
                  No se encontraron puntos de venta
                </p>
                <p className="text-sm text-slate-500">
                  {searchTerm || activeFilter !== "all" || channelFilter !== "all"
                    ? "Intenta con otros filtros o términos de búsqueda"
                    : "No hay PDVs registrados"}
                </p>
              </CardContent>
            </Card>
          ) : (
            pointsOfSale.map((pos) => (
              <Card
                key={pos.id}
                className="cursor-pointer hover:shadow-md transition-shadow relative overflow-hidden"
                onClick={() => navigate(`/pos/${pos.id}`)}
              >
                {/* Priority Indicator */}
                <div className={`absolute left-0 top-0 bottom-0 w-1 ${getPriorityColor(pos.priority)}`} />
                
                <CardContent className="p-4 pl-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="font-bold text-slate-900 mb-1">{pos.name}</h3>
                      <p className="text-sm text-slate-600 flex items-start gap-1">
                        <MapPin size={14} className="mt-0.5 flex-shrink-0" />
                        <span>{pos.address}</span>
                      </p>
                    </div>
                    {pos.isActive !== undefined ? (
                      <Badge
                        variant={pos.isActive ? "default" : "secondary"}
                        className="ml-2 whitespace-nowrap"
                      >
                        {pos.isActive ? "Activo" : "Inactivo"}
                      </Badge>
                    ) : (
                      <Badge variant={getStatusVariant(pos.status)} className="ml-2 whitespace-nowrap">
                        {getStatusLabel(pos.status)}
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-1 mb-3">
                    <Badge variant="outline" className="text-xs">
                      {pos.channel}
                    </Badge>
                    {pos.estimatedTime && (
                      <Badge variant="outline" className="text-xs">
                        <Clock size={12} className="mr-1" />
                        {pos.estimatedTime}
                      </Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-100">
                    <div className="text-center">
                      <p className="text-xs text-slate-500 mb-0.5">Cumplimiento</p>
                      <div className="flex items-center justify-center gap-1">
                        <TrendingUp size={14} className="text-green-600" />
                        <span className="text-sm font-semibold text-slate-900">
                          {pos.compliance}%
                        </span>
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-slate-500 mb-0.5">Prioridad</p>
                      <span className="text-sm font-semibold text-slate-900 capitalize">
                        {pos.priority === "high"
                          ? "Alta"
                          : pos.priority === "medium"
                          ? "Media"
                          : "Baja"}
                      </span>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-slate-500 mb-0.5">Incidencias</p>
                      <div className="flex items-center justify-center gap-1">
                        {pos.recentIssues && pos.recentIssues > 0 ? (
                          <>
                            <AlertCircle size={14} className="text-red-600" />
                            <span className="text-sm font-semibold text-red-600">
                              {pos.recentIssues}
                            </span>
                          </>
                        ) : (
                          <span className="text-sm font-semibold text-green-600">0</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <Button className="w-full mt-3" onClick={(e) => { e.stopPropagation(); navigate(`/pos/${pos.id}`); }}>
                    Ver Detalle
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      ) : (
        <div className="h-[calc(100vh-280px)] bg-slate-200 flex items-center justify-center">
          <div className="text-center p-8">
            <Map size={48} className="mx-auto mb-4 text-slate-400" />
            <p className="text-slate-600 font-medium">Vista de Mapa</p>
            <p className="text-sm text-slate-500 mt-2">
              Integración con mapa interactivo
            </p>
          </div>
        </div>
      )}
    </div>
  );
}