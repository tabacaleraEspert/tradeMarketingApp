import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Users, MapPin, TrendingUp, Clock, ChevronRight, Target,
  CheckCircle2, AlertCircle, Zap, Eye, Radio, Route,
  BarChart3, User, Calendar, Download,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useUsers } from "@/lib/api";
import { toast } from "sonner";
import { exportToExcel } from "@/lib/exportExcel";

interface RepData {
  userId: number;
  name: string;
  email: string;
  routeName: string | null;
  routeId: number | null;
  liveStatus: string;
  lastActivity: string | null;
  today: { planned: number; completed: number; visits: number };
  month: { visits: number; closed: number; compliance: number; withGps: number; avgTimeMin: number; pdvsVisited: number };
}

interface TerritoryData {
  manager: { userId: number; name: string; zone: string | null };
  reps: RepData[];
  territory: {
    totalReps: number;
    totalPdvs: number;
    today: { planned: number; completed: number; progress: number };
    month: { totalVisits: number; closed: number; compliance: number };
  };
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  visiting: { label: "Visitando", color: "text-green-700", bg: "bg-green-100", icon: Radio },
  in_field: { label: "En campo", color: "text-blue-700", bg: "bg-blue-100", icon: MapPin },
  not_started: { label: "No inició", color: "text-amber-700", bg: "bg-amber-100", icon: Clock },
  completed: { label: "Terminó", color: "text-green-700", bg: "bg-green-50", icon: CheckCircle2 },
  no_route: { label: "Sin ruta hoy", color: "text-gray-500", bg: "bg-gray-100", icon: AlertCircle },
};

export function TerritoryManagement() {
  const navigate = useNavigate();
  const { data: allUsers } = useUsers();
  const [selectedManagerId, setSelectedManagerId] = useState<number | null>(null);
  const [data, setData] = useState<TerritoryData | null>(null);
  const [loading, setLoading] = useState(false);

  // Find territory managers
  const managers = useMemo(() => {
    // We'll load from the API and detect by checking the territory-overview response
    return allUsers.filter((u) => u.IsActive);
  }, [allUsers]);

  // Auto-select first TM or detect from users
  useEffect(() => {
    if (!selectedManagerId && allUsers.length > 0) {
      // Try known TM IDs (3-7)
      const tmIds = [3, 4, 5, 6, 7];
      const found = allUsers.find((u) => tmIds.includes(u.UserId));
      if (found) setSelectedManagerId(found.UserId);
    }
  }, [allUsers, selectedManagerId]);

  // Load territory data
  useEffect(() => {
    if (!selectedManagerId) return;
    setLoading(true);
    api.get<TerritoryData>("/reports/territory-overview", { manager_user_id: selectedManagerId })
      .then(setData)
      .catch(() => toast.error("Error al cargar territorio"))
      .finally(() => setLoading(false));
  }, [selectedManagerId]);

  const tmUsers = useMemo(() => {
    return allUsers.filter((u) => [3, 4, 5, 6, 7].includes(u.UserId) && u.IsActive);
  }, [allUsers]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Gestión de Territorio</h1>
          <p className="text-muted-foreground">Supervisar Trade Reps, rutas y rendimiento en tiempo real</p>
        </div>
        {data && (
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => {
              const reps = data.reps.map((r) => ({
                "Trade Rep": r.name,
                "Email": r.email,
                "Ruta": r.routeName || "Sin ruta",
                "Estado hoy": STATUS_CONFIG[r.liveStatus]?.label || r.liveStatus,
                "PDVs hoy planif.": r.today.planned,
                "PDVs hoy compl.": r.today.completed,
                "Visitas mes": r.month.visits,
                "Compliance %": r.month.compliance,
                "Con GPS": r.month.withGps,
                "Tiempo prom. (min)": r.month.avgTimeMin,
                "PDVs visitados": r.month.pdvsVisited,
              }));
              exportToExcel(`Territorio_${data.manager.name.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}`, [
                { name: "Trade Reps", data: reps },
                { name: "Resumen", data: [{
                  "Territory Manager": data.manager.name,
                  "Zona": data.manager.zone || "",
                  "Total Reps": data.territory.totalReps,
                  "Total PDVs": data.territory.totalPdvs,
                  "Progreso hoy %": data.territory.today.progress,
                  "Visitas mes": data.territory.month.totalVisits,
                  "Compliance mes %": data.territory.month.compliance,
                }]},
              ]);
              toast.success("Territorio exportado");
            }}
          >
            <Download size={16} />
            Exportar Excel
          </Button>
        )}
      </div>

      {/* TM Selector */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {tmUsers.map((tm) => (
          <button
            key={tm.UserId}
            onClick={() => setSelectedManagerId(tm.UserId)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              selectedManagerId === tm.UserId
                ? "bg-[#A48242] text-white"
                : "bg-card border border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            <User size={14} />
            {tm.DisplayName}
          </button>
        ))}
      </div>

      {loading && <p className="text-muted-foreground">Cargando territorio...</p>}

      {data && (
        <>
          {/* Territory KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-50"><Users size={20} className="text-blue-600" /></div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">{data.territory.totalReps}</p>
                    <p className="text-xs text-muted-foreground">Trade Reps</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-amber-50"><MapPin size={20} className="text-amber-600" /></div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">{data.territory.totalPdvs}</p>
                    <p className="text-xs text-muted-foreground">PDVs en zona</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-50"><Target size={20} className="text-green-600" /></div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">{data.territory.today.progress}%</p>
                    <p className="text-xs text-muted-foreground">Progreso hoy</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-50"><BarChart3 size={20} className="text-purple-600" /></div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">{data.territory.month.totalVisits}</p>
                    <p className="text-xs text-muted-foreground">Visitas del mes</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-50"><TrendingUp size={20} className="text-green-600" /></div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">{data.territory.month.compliance}%</p>
                    <p className="text-xs text-muted-foreground">Compliance mes</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Today progress bar */}
          <Card className="bg-gradient-to-r from-black to-[#1a1a18] text-white">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs text-white/60 uppercase tracking-wide font-medium">Progreso del día</p>
                  <p className="text-sm font-semibold text-white/90 mt-0.5">
                    {data.territory.today.completed} de {data.territory.today.planned} PDVs visitados
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-black">{data.territory.today.progress}%</p>
                </div>
              </div>
              <div className="w-full bg-white/10 rounded-full h-3">
                <div
                  className="h-3 rounded-full transition-all duration-700"
                  style={{
                    width: `${data.territory.today.progress}%`,
                    backgroundColor: data.territory.today.progress === 100 ? "#22c55e" : "#A48242",
                  }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Live Status: Reps */}
          <div>
            <h2 className="text-lg font-bold text-foreground mb-3 flex items-center gap-2">
              <Radio size={18} className="text-green-500" />
              Estado en vivo — Trade Reps
            </h2>
            <div className="space-y-3">
              {data.reps.map((rep) => {
                const sc = STATUS_CONFIG[rep.liveStatus] || STATUS_CONFIG.no_route;
                const StatusIcon = sc.icon;
                const todayProgress = rep.today.planned > 0 ? Math.round(rep.today.completed / rep.today.planned * 100) : 0;

                return (
                  <Card key={rep.userId} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        {/* Status indicator */}
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${sc.bg}`}>
                          <StatusIcon size={18} className={sc.color} />
                        </div>

                        <div className="flex-1 min-w-0">
                          {/* Name + status */}
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-bold text-foreground">{rep.name}</p>
                            <Badge className={`text-[10px] px-1.5 py-0 ${sc.bg} ${sc.color} border-0`}>
                              {sc.label}
                            </Badge>
                          </div>

                          {/* Route */}
                          {rep.routeName && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                              <Route size={11} />
                              {rep.routeName}
                            </p>
                          )}

                          {/* Today progress */}
                          <div className="mb-2">
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="text-muted-foreground">Hoy</span>
                              <span className="font-semibold text-foreground">{rep.today.completed}/{rep.today.planned} PDVs</span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-2">
                              <div
                                className="h-2 rounded-full transition-all"
                                style={{
                                  width: `${todayProgress}%`,
                                  backgroundColor: todayProgress === 100 ? "#22c55e" : rep.today.completed > 0 ? "#A48242" : "#e5e7eb",
                                }}
                              />
                            </div>
                          </div>

                          {/* Monthly stats */}
                          <div className="grid grid-cols-4 gap-2 text-center">
                            <div className="bg-muted/50 rounded-lg p-1.5">
                              <p className="text-sm font-bold text-foreground">{rep.month.visits}</p>
                              <p className="text-[9px] text-muted-foreground">Visitas</p>
                            </div>
                            <div className="bg-muted/50 rounded-lg p-1.5">
                              <p className={`text-sm font-bold ${rep.month.compliance >= 80 ? "text-green-600" : rep.month.compliance >= 50 ? "text-amber-600" : "text-red-600"}`}>
                                {rep.month.compliance}%
                              </p>
                              <p className="text-[9px] text-muted-foreground">Compliance</p>
                            </div>
                            <div className="bg-muted/50 rounded-lg p-1.5">
                              <p className="text-sm font-bold text-foreground">{rep.month.withGps}</p>
                              <p className="text-[9px] text-muted-foreground">Con GPS</p>
                            </div>
                            <div className="bg-muted/50 rounded-lg p-1.5">
                              <p className="text-sm font-bold text-foreground">{rep.month.avgTimeMin}m</p>
                              <p className="text-[9px] text-muted-foreground">Prom.</p>
                            </div>
                          </div>

                          {/* Last activity */}
                          {rep.lastActivity && (
                            <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
                              <Clock size={10} />
                              Última actividad: {new Date(rep.lastActivity).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col gap-1 shrink-0">
                          {rep.routeId && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs h-7 px-2"
                              onClick={() => navigate(`/admin/routes/${rep.routeId}/edit`)}
                            >
                              <Eye size={12} className="mr-1" />
                              Ruta
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}

              {data.reps.length === 0 && (
                <Card className="border-dashed border-2">
                  <CardContent className="p-8 text-center text-muted-foreground">
                    <Users size={40} className="mx-auto mb-2 opacity-30" />
                    <p className="font-medium">Sin Trade Reps en esta zona</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* Comparison table */}
          {data.reps.length >= 2 && (
            <div>
              <h2 className="text-lg font-bold text-foreground mb-3 flex items-center gap-2">
                <BarChart3 size={18} />
                Comparativa del mes
              </h2>
              <Card>
                <CardContent className="p-0">
                  <div className="grid grid-cols-[1fr_80px_80px_80px_80px] gap-2 px-4 py-2.5 border-b border-border bg-muted/40 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                    <span>Rep</span>
                    <span className="text-center">Visitas</span>
                    <span className="text-center">Compliance</span>
                    <span className="text-center">GPS</span>
                    <span className="text-center">Tiempo</span>
                  </div>
                  {data.reps.map((rep, i) => (
                    <div key={rep.userId} className={`grid grid-cols-[1fr_80px_80px_80px_80px] gap-2 px-4 py-2.5 items-center ${i < data.reps.length - 1 ? "border-b border-border" : ""}`}>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{rep.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{rep.routeName || "Sin ruta"}</p>
                      </div>
                      <div className="text-center">
                        <span className={`text-sm font-bold ${i === 0 ? "text-[#A48242]" : "text-foreground"}`}>
                          {rep.month.visits}
                        </span>
                      </div>
                      <div className="text-center">
                        <span className={`text-sm font-bold ${rep.month.compliance >= 80 ? "text-green-600" : rep.month.compliance >= 50 ? "text-amber-600" : "text-red-600"}`}>
                          {rep.month.compliance}%
                        </span>
                      </div>
                      <div className="text-center">
                        <span className="text-sm font-bold text-foreground">{rep.month.withGps}</span>
                      </div>
                      <div className="text-center">
                        <span className="text-sm font-bold text-foreground">{rep.month.avgTimeMin}m</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Alerts section */}
          <div>
            <h2 className="text-lg font-bold text-foreground mb-3 flex items-center gap-2">
              <AlertCircle size={18} className="text-amber-500" />
              Alertas del territorio
            </h2>
            <div className="space-y-2">
              {data.reps.filter((r) => r.liveStatus === "not_started" && r.today.planned > 0).map((rep) => (
                <Card key={`alert-${rep.userId}`} className="border-l-4 border-l-amber-400 bg-amber-50">
                  <CardContent className="p-3 flex items-center gap-3">
                    <Clock size={16} className="text-amber-600 shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-amber-900">{rep.name} no inició su ruta</p>
                      <p className="text-xs text-amber-700">{rep.today.planned} PDVs planificados para hoy</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {data.reps.filter((r) => r.month.compliance < 70 && r.month.visits > 0).map((rep) => (
                <Card key={`alert-comp-${rep.userId}`} className="border-l-4 border-l-red-400 bg-red-50">
                  <CardContent className="p-3 flex items-center gap-3">
                    <TrendingUp size={16} className="text-red-600 shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-red-900">Compliance bajo: {rep.name}</p>
                      <p className="text-xs text-red-700">{rep.month.compliance}% este mes (objetivo: 80%)</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {data.reps.every((r) => r.liveStatus !== "not_started" || r.today.planned === 0) &&
               data.reps.every((r) => r.month.compliance >= 70 || r.month.visits === 0) && (
                <Card className="bg-green-50 border-green-200">
                  <CardContent className="p-4 text-center">
                    <CheckCircle2 size={24} className="mx-auto text-green-600 mb-1" />
                    <p className="text-sm font-medium text-green-900">Todo en orden</p>
                    <p className="text-xs text-green-700">Sin alertas pendientes en el territorio</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
