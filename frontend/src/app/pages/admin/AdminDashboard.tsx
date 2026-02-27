import { useState, useEffect } from "react";
import { KPICard } from "../../components/ui/kpi-card";
import { Card, CardContent } from "../../components/ui/card";
import { StatusChip } from "../../components/ui/status-chip";
import { Badge } from "../../components/ui/badge";
import {
  Users,
  MapPin,
  CheckCircle2,
  AlertCircle,
  Clock,
  Camera,
} from "lucide-react";
import {
  useZones,
  useUsers,
  useDistributors,
  usePdvs,
  useApiList,
  routesApi,
  formsApi,
  visitsApi,
  incidentsApi,
  rolesApi,
} from "@/lib/api";

export function AdminDashboard() {
  const { data: zones } = useZones();
  const { data: users } = useUsers();
  const { data: distributors } = useDistributors();
  const { data: pdvs } = usePdvs();
  const { data: roles } = useApiList(() => rolesApi.list());
  const { data: routes } = useApiList(() => routesApi.list());
  const { data: forms } = useApiList(() => formsApi.list());
  const { data: visits } = useApiList(() => visitsApi.list());
  const { data: incidents } = useApiList(() => incidentsApi.list());

  const hasInProgressVisits = visits.some(
    (v) => v.Status === "OPEN" || v.Status === "IN_PROGRESS"
  );
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!hasInProgressVisits) return;
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, [hasInProgressVisits]);

  const openIncidents = incidents.filter(
    (i) => i.Status === "OPEN" || i.Status === "IN_PROGRESS"
  );
  const activeUsers = users.filter((u) => u.IsActive);

  const kpis = [
    {
      title: "Visitas Totales",
      value: String(visits.length),
      subtitle: "Registradas en el sistema",
      icon: <MapPin size={20} />,
      color: "blue" as const,
    },
    {
      title: "PDVs",
      value: String(pdvs.length),
      subtitle: `${pdvs.filter((p) => p.IsActive).length} activos`,
      icon: <CheckCircle2 size={20} />,
      color: "green" as const,
    },
    {
      title: "Incidencias Abiertas",
      value: String(openIncidents.length),
      subtitle: "Requieren atención",
      icon: <AlertCircle size={20} />,
      color: "red" as const,
    },
    {
      title: "Usuarios Activos",
      value: String(activeUsers.length),
      subtitle: `${zones.length} zonas`,
      icon: <Users size={20} />,
      color: "purple" as const,
    },
  ];

  const formatDuration = (openedAt: string, closedAt: string | null) => {
    const start = new Date(openedAt).getTime();
    const end = closedAt ? new Date(closedAt).getTime() : Date.now();
    const ms = end - start;
    const mins = Math.floor(ms / 60000);
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    if (hours > 0) {
      return `${hours}h ${remainingMins}min`;
    }
    return `${mins}min`;
  };

  const recentActivity =
    visits.length > 0
      ? visits.slice(0, 5).map((v) => ({
          id: v.VisitId,
          user: users.find((u) => u.UserId === v.UserId)?.DisplayName || `Usuario #${v.UserId}`,
          action: v.Status === "OPEN" || v.Status === "IN_PROGRESS" ? "En curso" : "Completada",
          pos: pdvs.find((p) => p.PdvId === v.PdvId)?.Name || `PDV #${v.PdvId}`,
          time: new Date(v.OpenedAt).toLocaleString("es-AR", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          }),
          duration: formatDuration(v.OpenedAt, v.ClosedAt),
          isInProgress: v.Status === "OPEN" || v.Status === "IN_PROGRESS",
          status: (v.Status === "OPEN" || v.Status === "IN_PROGRESS"
            ? "in-progress"
            : "completed") as const,
        }))
      : [
          {
            id: 0,
            user: "-",
            action: "Sin actividad",
            pos: "-",
            time: "-",
            status: "pending" as const,
          },
        ];

  const visitsByUser = visits.reduce(
    (acc, v) => {
      acc[v.UserId] = (acc[v.UserId] || 0) + 1;
      return acc;
    },
    {} as Record<number, number>
  );
  const completedVisits = visits.filter((v) => v.ClosedAt != null);
  const avgDurationMs =
    completedVisits.length > 0
      ? completedVisits.reduce((acc, v) => {
          const start = new Date(v.OpenedAt).getTime();
          const end = new Date(v.ClosedAt!).getTime();
          return acc + (end - start);
        }, 0) / completedVisits.length
      : 0;
  const avgDurationMins = Math.round(avgDurationMs / 60000);

  const topPerformers = activeUsers
    .map((u) => ({
      name: u.DisplayName,
      visits: visitsByUser[u.UserId] || 0,
      compliance: 0,
      zone: zones.find((z) => z.ZoneId === u.ZoneId)?.Name || "-",
    }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 5);

  const pdvsByChannel = pdvs.reduce(
    (acc, p) => {
      acc[p.Channel] = (acc[p.Channel] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const channelStats =
    Object.keys(pdvsByChannel).length > 0
      ? Object.entries(pdvsByChannel).map(([channel, total]) => ({
          channel,
          total,
          completed: 0,
          pending: total,
          percentage: 0,
        }))
      : [
          { channel: "Sin datos", total: 0, completed: 0, pending: 0, percentage: 0 },
        ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Dashboard</h1>
        <p className="text-slate-600">Resumen de operaciones en tiempo real</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi, index) => (
          <KPICard key={index} {...kpi} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="p-6">
              <h2 className="text-xl font-bold text-slate-900 mb-4">Actividad Reciente</h2>
              <div className="space-y-3">
                {recentActivity.map((activity) => (
                  <div
                    key={activity.id}
                    className="flex items-center gap-4 p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex-1">
                      <p className="font-semibold text-slate-900">{activity.user}</p>
                      <p className="text-sm text-slate-600">
                        {activity.action} en <span className="font-medium">{activity.pos}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-200/80 rounded-md">
                        <Clock size={14} className="text-slate-600" />
                        <span className="text-xs font-medium text-slate-700">
                          {activity.duration}
                        </span>
                      </div>
                      <StatusChip status={activity.status} size="sm" />
                    </div>
                    <p className="text-xs text-slate-500 min-w-[80px] text-right">
                      {activity.time}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Channel Performance */}
          <Card className="mt-6">
            <CardContent className="p-6">
              <h2 className="text-xl font-bold text-slate-900 mb-4">
                Ejecución por Canal
              </h2>
              <div className="space-y-4">
                {channelStats.map((stat) => (
                  <div key={stat.channel}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <p className="font-semibold text-slate-900">{stat.channel}</p>
                        <Badge variant="outline" className="text-xs">
                          {stat.completed}/{stat.total}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">
                          {stat.percentage}%
                        </span>
                      </div>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          stat.percentage >= 90
                            ? "bg-green-500"
                            : stat.percentage >= 75
                            ? "bg-blue-500"
                            : "bg-yellow-500"
                        }`}
                        style={{ width: `${stat.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Top Performers */}
        <div>
          <Card>
            <CardContent className="p-6">
              <h2 className="text-xl font-bold text-slate-900 mb-4">
                Top Vendedores
              </h2>
              <div className="space-y-3">
                {topPerformers.map((performer, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg"
                  >
                    <div
                      className={`flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm ${
                        index === 0
                          ? "bg-yellow-100 text-yellow-700"
                          : index === 1
                          ? "bg-slate-200 text-slate-700"
                          : index === 2
                          ? "bg-orange-100 text-orange-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-slate-900">
                        {performer.name}
                      </p>
                      <p className="text-xs text-slate-500">{performer.zone}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-slate-600">
                          <span className="font-semibold">{performer.visits}</span> visitas
                        </span>
                        <span className="text-xs font-semibold text-green-600">
                          {performer.compliance}%
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Recursos del Sistema - usa todos los endpoints */}
          <Card className="mt-6">
            <CardContent className="p-6">
              <h2 className="text-xl font-bold text-slate-900 mb-4">
                Recursos del Sistema
              </h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">Zonas</span>
                  <span className="font-semibold">{zones.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Roles</span>
                  <span className="font-semibold">{roles.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Distribuidores</span>
                  <span className="font-semibold">{distributors.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Rutas</span>
                  <span className="font-semibold">{routes.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Formularios</span>
                  <span className="font-semibold">{forms.length}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <Card className="mt-6">
            <CardContent className="p-6">
              <h2 className="text-xl font-bold text-slate-900 mb-4">
                Estadísticas Rápidas
              </h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Camera size={20} className="text-blue-600" />
                    <span className="text-sm font-medium text-slate-700">
                      Fotos del día
                    </span>
                  </div>
                  <span className="text-lg font-bold text-blue-600">342</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={20} className="text-green-600" />
                    <span className="text-sm font-medium text-slate-700">
                      Con GPS OK
                    </span>
                  </div>
                  <span className="text-lg font-bold text-green-600">98%</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Clock size={20} className="text-purple-600" />
                    <span className="text-sm font-medium text-slate-700">
                      Tiempo promedio visita
                    </span>
                  </div>
                  <span className="text-lg font-bold text-purple-600">
                    {completedVisits.length > 0
                      ? avgDurationMins >= 60
                        ? `${Math.floor(avgDurationMins / 60)}h ${avgDurationMins % 60}min`
                        : `${avgDurationMins}min`
                      : "-"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}