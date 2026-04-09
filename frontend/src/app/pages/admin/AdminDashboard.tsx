import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Users, MapPin, CheckCircle2, AlertCircle, Clock, Camera, TrendingUp,
  TrendingDown, Target, Navigation, BarChart3, Award, Zap, Eye, ArrowRight,
  AlertTriangle, Store,
} from "lucide-react";
import {
  useUsers, usePdvs, useApiList, routesApi, visitsApi, incidentsApi, reportsApi,
} from "@/lib/api";
import { api } from "@/lib/api/client";

interface Summary { totalVisits: number; closedVisits: number; totalPdvs: number; pdvsVisited: number; coverage: number; visitsWithGps: number; visitsWithPhoto: number; avgDurationMin: number; }
interface VendorRow { userId: number; name: string; zone: string; visits: number; closed: number; pdvsVisited: number; compliance: number; withGps: number; withPhoto: number; avgTimeMin: number; rank: number; }
interface ChannelRow { channelId: number; channel: string; total: number; visited: number; coverage: number; gps: number; photo: number; }

export function AdminDashboard() {
  const navigate = useNavigate();
  const { data: users } = useUsers();
  const { data: pdvs } = usePdvs();
  const { data: visits } = useApiList(() => visitsApi.list());
  const { data: incidents } = useApiList(() => incidentsApi.list());

  const [summary, setSummary] = useState<Summary | null>(null);
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [perfectStore, setPerfectStore] = useState<Awaited<ReturnType<typeof reportsApi.perfectStore>> | null>(null);
  const [trending, setTrending] = useState<Awaited<ReturnType<typeof reportsApi.trending>>>([]);
  const [smartAlerts, setSmartAlerts] = useState<Awaited<ReturnType<typeof reportsApi.smartAlerts>> | null>(null);

  useEffect(() => {
    reportsApi.summary().then(setSummary).catch(() => {});
    reportsApi.vendorRanking().then(setVendors).catch(() => {});
    reportsApi.channelCoverage().then(setChannels).catch(() => {});
    reportsApi.perfectStore().then(setPerfectStore).catch(() => {});
    reportsApi.trending({ months: 3 }).then(setTrending).catch(() => {});
    reportsApi.smartAlerts().then(setSmartAlerts).catch(() => {});
  }, []);

  const openIncidents = incidents.filter((i) => i.Status === "OPEN" || i.Status === "IN_PROGRESS");
  const activeUsers = users.filter((u) => u.IsActive);

  // Today's activity
  const todayStr = new Date().toISOString().split("T")[0];
  const todayVisits = visits.filter((v) => v.OpenedAt.startsWith(todayStr));
  const todayClosed = todayVisits.filter((v) => v.Status === "CLOSED" || v.Status === "COMPLETED");
  const todayOpen = todayVisits.filter((v) => v.Status === "OPEN");

  // Reps without activity today
  const activeRepsToday = new Set(todayVisits.map((v) => v.UserId));
  const inactiveReps = activeUsers.filter((u) => !activeRepsToday.has(u.UserId) && u.UserId > 2); // exclude admin/test

  // Coverage gap: channels below 70%
  const lowCoverageChannels = channels.filter((c) => c.coverage < 70);

  // Top & bottom performers
  const topVendors = vendors.slice(0, 3);
  const bottomVendors = [...vendors].sort((a, b) => a.visits - b.visits).slice(0, 3);

  // Reps in field right now
  const repsInField = todayOpen.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1">Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            {new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate("/admin/reports")} className="gap-2">
          <BarChart3 size={16} />
          Reportes
        </Button>
      </div>

      {/* === ROW 1: Hero KPIs === */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-black to-[#1a1a18] text-white">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Target size={18} className="text-[#A48242]" />
              <Badge className="bg-[#A48242]/20 text-[#A48242] border-0 text-[10px]">Mes</Badge>
            </div>
            <p className="text-3xl font-black">{summary?.coverage ?? 0}%</p>
            <p className="text-xs text-white/60 mt-1">Cobertura de PDVs</p>
            <p className="text-[10px] text-white/40">{summary?.pdvsVisited ?? 0}/{summary?.totalPdvs ?? 0} visitados</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <MapPin size={18} className="text-blue-600" />
              <Badge variant="outline" className="text-[10px]">Hoy</Badge>
            </div>
            <p className="text-3xl font-black text-foreground">{todayVisits.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Visitas hoy</p>
            <div className="flex gap-2 mt-1 text-[10px]">
              <span className="text-green-600">{todayClosed.length} cerradas</span>
              {todayOpen.length > 0 && <span className="text-amber-600">{todayOpen.length} en curso</span>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Navigation size={18} className="text-green-600" />
            </div>
            <p className="text-3xl font-black text-foreground">
              {summary && summary.totalVisits > 0 ? Math.round(summary.visitsWithGps / summary.totalVisits * 100) : 0}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">GPS verificado</p>
            <p className="text-[10px] text-muted-foreground">{summary?.visitsWithGps ?? 0} de {summary?.totalVisits ?? 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Clock size={18} className="text-[#A48242]" />
            </div>
            <p className="text-3xl font-black text-foreground">{summary?.avgDurationMin ?? 0}m</p>
            <p className="text-xs text-muted-foreground mt-1">Tiempo prom. visita</p>
            <p className="text-[10px] text-muted-foreground">{summary?.closedVisits ?? 0} visitas cerradas</p>
          </CardContent>
        </Card>
      </div>

      {/* === ROW 2: Alerts & Field Status === */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Live field status */}
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <h3 className="font-bold text-foreground mb-3 flex items-center gap-2">
              <Zap size={16} className="text-green-500" />
              Estado en campo — Hoy
            </h3>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-green-700">{repsInField}</p>
                <p className="text-[10px] text-green-600">En campo ahora</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-blue-700">{activeRepsToday.size}</p>
                <p className="text-[10px] text-blue-600">Con actividad hoy</p>
              </div>
              <div className={`rounded-lg p-3 text-center ${inactiveReps.length > 0 ? "bg-red-50" : "bg-green-50"}`}>
                <p className={`text-2xl font-bold ${inactiveReps.length > 0 ? "text-red-700" : "text-green-700"}`}>
                  {inactiveReps.length}
                </p>
                <p className={`text-[10px] ${inactiveReps.length > 0 ? "text-red-600" : "text-green-600"}`}>Sin actividad</p>
              </div>
            </div>
            {inactiveReps.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-red-700 flex items-center gap-1">
                  <AlertTriangle size={12} />
                  Reps sin actividad hoy:
                </p>
                <div className="flex flex-wrap gap-1">
                  {inactiveReps.slice(0, 6).map((u) => (
                    <Badge key={u.UserId} variant="outline" className="text-[10px] text-red-600 border-red-200">
                      {u.DisplayName}
                    </Badge>
                  ))}
                  {inactiveReps.length > 6 && (
                    <Badge variant="outline" className="text-[10px]">+{inactiveReps.length - 6} más</Badge>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Alerts */}
        <Card>
          <CardContent className="p-4">
            <h3 className="font-bold text-foreground mb-3 flex items-center gap-2">
              <AlertCircle size={16} className="text-red-500" />
              Alertas
            </h3>
            <div className="space-y-2">
              {openIncidents.length > 0 && (
                <div className="flex items-center justify-between p-2 bg-red-50 rounded-lg cursor-pointer" onClick={() => navigate("/admin/reports")}>
                  <span className="text-xs font-medium text-red-800">{openIncidents.length} incidencias abiertas</span>
                  <ArrowRight size={14} className="text-red-400" />
                </div>
              )}
              {lowCoverageChannels.map((ch) => (
                <div key={ch.channelId} className="flex items-center justify-between p-2 bg-amber-50 rounded-lg">
                  <span className="text-xs text-amber-800">
                    <span className="font-medium">{ch.channel}</span>: {ch.coverage}% cobertura
                  </span>
                  <TrendingDown size={14} className="text-amber-500" />
                </div>
              ))}
              {openIncidents.length === 0 && lowCoverageChannels.length === 0 && (
                <div className="text-center py-3">
                  <CheckCircle2 size={24} className="mx-auto text-green-500 mb-1" />
                  <p className="text-xs text-green-700">Sin alertas</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* === ROW 3: Coverage by Channel === */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-foreground flex items-center gap-2">
              <Store size={16} />
              Cobertura por Canal
            </h3>
            <Badge variant="outline" className="text-[10px]">Este mes</Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {channels.map((ch) => (
              <div key={ch.channelId} className="p-3 border border-border rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-foreground">{ch.channel}</p>
                  <span className={`text-sm font-bold ${
                    ch.coverage >= 80 ? "text-green-600" : ch.coverage >= 60 ? "text-amber-600" : "text-red-600"
                  }`}>{ch.coverage}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2 mb-1.5">
                  <div className={`h-2 rounded-full transition-all ${
                    ch.coverage >= 80 ? "bg-green-500" : ch.coverage >= 60 ? "bg-amber-500" : "bg-red-500"
                  }`} style={{ width: `${ch.coverage}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>{ch.visited}/{ch.total} PDVs</span>
                  <span>{ch.gps} GPS</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* === ROW 4: Vendor Performance === */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top performers */}
        <Card>
          <CardContent className="p-4">
            <h3 className="font-bold text-foreground mb-3 flex items-center gap-2">
              <Award size={16} className="text-[#A48242]" />
              Top Performers
            </h3>
            <div className="space-y-2">
              {topVendors.map((v, i) => (
                <div key={v.userId} className="flex items-center gap-3 p-2.5 bg-muted/50 rounded-lg">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                    i === 0 ? "bg-amber-100 text-amber-700" : i === 1 ? "bg-gray-200 text-gray-700" : "bg-orange-100 text-orange-700"
                  }`}>{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{v.name}</p>
                    <p className="text-[10px] text-muted-foreground">{v.zone}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-foreground">{v.visits}</p>
                    <p className="text-[10px] text-green-600">{v.compliance}%</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Full ranking table */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-foreground flex items-center gap-2">
                <BarChart3 size={16} />
                Ranking Completo
              </h3>
              <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => navigate("/admin/reports")}>
                Ver todo
              </Button>
            </div>
            <div className="space-y-0.5">
              <div className="grid grid-cols-[30px_1fr_50px_50px_50px] gap-1 px-2 py-1 text-[9px] font-semibold text-muted-foreground uppercase">
                <span>#</span><span>Rep</span><span className="text-center">Vis.</span><span className="text-center">Comp.</span><span className="text-center">GPS</span>
              </div>
              {vendors.slice(0, 8).map((v) => (
                <div key={v.userId} className="grid grid-cols-[30px_1fr_50px_50px_50px] gap-1 px-2 py-1.5 text-xs hover:bg-muted/30 rounded items-center">
                  <span className="font-bold text-muted-foreground">{v.rank}</span>
                  <span className="font-medium text-foreground truncate">{v.name}</span>
                  <span className="text-center font-semibold">{v.visits}</span>
                  <span className={`text-center font-semibold ${v.compliance >= 80 ? "text-green-600" : v.compliance >= 50 ? "text-amber-600" : "text-red-600"}`}>
                    {v.compliance}%
                  </span>
                  <span className="text-center">{v.withGps}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* === ROW 5: Activity Feed + Quick Stats === */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <h3 className="font-bold text-foreground mb-3">Actividad Reciente</h3>
            <div className="space-y-1.5">
              {visits.slice(0, 8).map((v) => {
                const user = users.find((u) => u.UserId === v.UserId);
                const pdv = pdvs.find((p) => p.PdvId === v.PdvId);
                const dur = v.ClosedAt ? Math.round((new Date(v.ClosedAt).getTime() - new Date(v.OpenedAt).getTime()) / 60000) : null;
                const isOpen = v.Status === "OPEN";
                return (
                  <div key={v.VisitId} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/30 text-xs">
                    <div className={`w-1.5 h-6 rounded-full shrink-0 ${isOpen ? "bg-amber-400" : "bg-green-400"}`} />
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold text-foreground">{user?.DisplayName || "?"}</span>
                      <span className="text-muted-foreground"> en </span>
                      <span className="font-medium text-foreground">{pdv?.Name || "?"}</span>
                    </div>
                    {dur != null && <span className="text-muted-foreground shrink-0">{dur}m</span>}
                    <Badge className={`text-[9px] px-1 py-0 border-0 shrink-0 ${isOpen ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
                      {isOpen ? "Abierta" : "Cerrada"}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {new Date(v.OpenedAt).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h3 className="font-bold text-foreground mb-3">Resumen del Sistema</h3>
            <div className="space-y-2.5">
              {[
                { label: "Total PDVs activos", value: pdvs.filter((p) => p.IsActive).length, icon: Store },
                { label: "Trade Reps activos", value: activeUsers.filter((u) => u.UserId > 2).length, icon: Users },
                { label: "Visitas este mes", value: summary?.totalVisits ?? 0, icon: MapPin },
                { label: "Cumplimiento general", value: `${summary?.coverage ?? 0}%`, icon: Target },
                { label: "Incidencias abiertas", value: openIncidents.length, icon: AlertCircle },
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <item.icon size={14} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{item.label}</span>
                  </div>
                  <span className="text-sm font-bold text-foreground">{item.value}</span>
                </div>
              ))}
            </div>

            {/* Quick navigate */}
            <div className="mt-4 pt-3 border-t border-border space-y-1.5">
              {[
                { label: "Gestión de Territorio", path: "/admin/territory" },
                { label: "Rutas Foco", path: "/admin/routes" },
                { label: "Gestión PDV", path: "/admin/pos-management" },
              ].map((item) => (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-muted text-xs"
                >
                  <span className="font-medium text-foreground">{item.label}</span>
                  <ArrowRight size={12} className="text-muted-foreground" />
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* === ROW 6: PERFECT STORE SCORE === */}
      {perfectStore && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-foreground flex items-center gap-2">
                <Award size={18} className="text-[#A48242]" />
                Perfect Store Score
              </h3>
              <Badge variant="outline" className="text-xs">Últimos 30 días</Badge>
            </div>

            {/* Score distribution */}
            <div className="grid grid-cols-5 gap-2 mb-4">
              <div className="bg-gradient-to-br from-black to-[#1a1a18] text-white rounded-xl p-3 text-center">
                <p className="text-2xl font-black">{perfectStore.summary.avgScore}</p>
                <p className="text-[9px] text-white/60">Promedio</p>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-green-700">{perfectStore.summary.perfect}</p>
                <p className="text-[9px] text-green-600">Perfectos</p>
                <p className="text-[8px] text-green-500">90-100</p>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-blue-700">{perfectStore.summary.good}</p>
                <p className="text-[9px] text-blue-600">Buenos</p>
                <p className="text-[8px] text-blue-500">70-89</p>
              </div>
              <div className="bg-amber-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-amber-700">{perfectStore.summary.needsWork}</p>
                <p className="text-[9px] text-amber-600">A mejorar</p>
                <p className="text-[8px] text-amber-500">40-69</p>
              </div>
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-red-700">{perfectStore.summary.critical}</p>
                <p className="text-[9px] text-red-600">Críticos</p>
                <p className="text-[8px] text-red-500">&lt;40</p>
              </div>
            </div>

            {/* By channel */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
              {perfectStore.byChannel.filter((c) => c.count >= 2).map((ch) => (
                <div key={ch.channel} className="flex items-center justify-between p-2 border border-border rounded-lg">
                  <div>
                    <p className="text-xs font-medium text-foreground">{ch.channel}</p>
                    <p className="text-[10px] text-muted-foreground">{ch.count} PDVs</p>
                  </div>
                  <div className={`text-lg font-black ${
                    ch.avgScore >= 80 ? "text-green-600" : ch.avgScore >= 60 ? "text-amber-600" : "text-red-600"
                  }`}>{ch.avgScore}</div>
                </div>
              ))}
            </div>

            {/* Top & bottom PDVs */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-semibold text-green-700 mb-1.5 flex items-center gap-1">
                  <TrendingUp size={12} /> Top 5 PDVs
                </p>
                {perfectStore.pdvs.slice(0, 5).map((p, i) => (
                  <div key={p.pdvId} className="flex items-center gap-2 py-1.5 text-xs border-b border-border last:border-0">
                    <span className="w-4 font-bold text-muted-foreground">{i + 1}</span>
                    <span className="flex-1 truncate text-foreground">{p.name}</span>
                    <span className={`font-bold ${p.score >= 90 ? "text-green-600" : "text-blue-600"}`}>{p.score}</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs font-semibold text-red-700 mb-1.5 flex items-center gap-1">
                  <TrendingDown size={12} /> PDVs críticos
                </p>
                {perfectStore.pdvs.filter((p) => p.score < 40).slice(0, 5).map((p, i) => (
                  <div key={p.pdvId} className="flex items-center gap-2 py-1.5 text-xs border-b border-border last:border-0">
                    <span className="flex-1 truncate text-foreground">{p.name}</span>
                    <span className="text-[10px] text-muted-foreground">{p.channel}</span>
                    <span className="font-bold text-red-600">{p.score}</span>
                  </div>
                ))}
                {perfectStore.pdvs.filter((p) => p.score < 40).length === 0 && (
                  <p className="text-xs text-green-600 py-2">Sin PDVs críticos</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* === ROW 7: TRENDING === */}
      {trending.length >= 2 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
              <BarChart3 size={18} />
              Tendencia mes a mes
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 text-muted-foreground font-semibold">Mes</th>
                    <th className="text-center py-2 text-muted-foreground font-semibold">Visitas</th>
                    <th className="text-center py-2 text-muted-foreground font-semibold">Cobertura</th>
                    <th className="text-center py-2 text-muted-foreground font-semibold">GPS %</th>
                    <th className="text-center py-2 text-muted-foreground font-semibold">Duración</th>
                    <th className="text-center py-2 text-muted-foreground font-semibold">Tendencia</th>
                  </tr>
                </thead>
                <tbody>
                  {trending.map((m, i) => {
                    const prev = i > 0 ? trending[i - 1] : null;
                    const visitDelta = prev && prev.visits > 0 ? Math.round((m.visits - prev.visits) / prev.visits * 100) : null;
                    return (
                      <tr key={m.month} className="border-b border-border last:border-0">
                        <td className="py-2.5 font-medium text-foreground">{m.month}</td>
                        <td className="py-2.5 text-center font-semibold">{m.visits}</td>
                        <td className="py-2.5 text-center">
                          <span className={`font-semibold ${m.coverage >= 70 ? "text-green-600" : m.coverage >= 50 ? "text-amber-600" : "text-red-600"}`}>
                            {m.coverage}%
                          </span>
                        </td>
                        <td className="py-2.5 text-center">{m.gpsRate}%</td>
                        <td className="py-2.5 text-center">{m.avgDuration}m</td>
                        <td className="py-2.5 text-center">
                          {visitDelta !== null && (
                            <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${
                              visitDelta >= 0 ? "text-green-600" : "text-red-600"
                            }`}>
                              {visitDelta >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                              {visitDelta >= 0 ? "+" : ""}{visitDelta}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Visual bars */}
            <div className="flex items-end gap-2 mt-4 h-20">
              {trending.map((m) => {
                const maxVisits = Math.max(...trending.map((t) => t.visits), 1);
                const height = Math.max((m.visits / maxVisits) * 100, 4);
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[9px] font-bold text-foreground">{m.visits}</span>
                    <div className="w-full rounded-t-md bg-[#A48242]" style={{ height: `${height}%` }} />
                    <span className="text-[8px] text-muted-foreground">{m.month.split(" ")[0]}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* === ROW 8: SMART ALERTS === */}
      {smartAlerts && smartAlerts.total > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-foreground flex items-center gap-2">
                <Zap size={18} className="text-amber-500" />
                Alertas Inteligentes
              </h3>
              <div className="flex gap-1.5">
                {smartAlerts.high > 0 && <Badge className="bg-red-100 text-red-700 border-0 text-[10px]">{smartAlerts.high} críticas</Badge>}
                {smartAlerts.medium > 0 && <Badge className="bg-amber-100 text-amber-700 border-0 text-[10px]">{smartAlerts.medium} medias</Badge>}
              </div>
            </div>
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {smartAlerts.alerts.slice(0, 12).map((a, i) => (
                <div key={i} className={`flex items-start gap-2.5 p-2.5 rounded-lg ${
                  a.severity === "high" ? "bg-red-50" : a.severity === "medium" ? "bg-amber-50" : "bg-muted/30"
                }`}>
                  <div className={`w-1.5 h-8 rounded-full shrink-0 mt-0.5 ${
                    a.severity === "high" ? "bg-red-500" : a.severity === "medium" ? "bg-amber-500" : "bg-gray-400"
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground">{a.title}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{a.detail}</p>
                  </div>
                  <Badge variant="outline" className="text-[9px] shrink-0">
                    {a.type === "never_visited" ? "Sin visita" :
                     a.type === "not_visited_recently" ? "Inactivo" :
                     a.type === "declining_rep" ? "Rep en baja" :
                     a.type === "low_channel_coverage" ? "Canal bajo" : a.type}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
