import { useNavigate } from "react-router";
import { useState, useMemo } from "react";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { DateSelector } from "../components/DateSelector";
import {
  MapPin,
  Plus,
  Search,
  Clock,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Calendar,
} from "lucide-react";
import { getCurrentUser } from "../lib/auth";
import { useRouteDayPdvsForDate, useIncidentsWithPdvNames, useActiveNotifications } from "@/lib/api";
import { routeDayPdvToPointOfSaleUI, incidentToAlertUI, notificationToAlertUI } from "@/lib/api";

export function Home() {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isDateSelectorOpen, setIsDateSelectorOpen] = useState(false);

  // Trade Rep: solo su ruta asignada. Admin: todas las rutas del día
  const isAdmin = ["admin", "supervisor"].includes(currentUser.role);
  const userIdForFilter = isAdmin ? undefined : Number(currentUser.id) || undefined;

  const { data: routeDayPdvs, loading: loadingPdvs } = useRouteDayPdvsForDate(
    selectedDate,
    userIdForFilter
  );
  const { data: incidents } = useIncidentsWithPdvNames();
  const { data: notifications } = useActiveNotifications();

  const pointsOfSale = useMemo(
    () => routeDayPdvs.map(routeDayPdvToPointOfSaleUI),
    [routeDayPdvs]
  );
  const alerts = useMemo(
    () => [
      ...incidents.map(incidentToAlertUI),
      ...notifications.map(notificationToAlertUI),
    ],
    [incidents, notifications]
  );

  const syncStatus = { lastSync: new Date().toISOString(), pendingRecords: 0, pendingPhotos: 0, isOnline: true };

  const todayVisits = pointsOfSale.length;
  const completedVisits = pointsOfSale.filter((p) => p.status === "completed").length;
  const pendingVisits = pointsOfSale.filter((p) => p.status === "pending").length;
  const todayRouteName = pointsOfSale[0]?.routeName;
  const monthlyCompliance =
    todayVisits > 0 ? Math.round((completedVisits / todayVisits) * 100) : 0;
  const openAlerts = alerts.filter((a) => a.status === "open" || a.status === "in-progress").length;

  const formatDateDisplay = (date: Date) => {
    const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    
    return {
      dayName: days[date.getDay()],
      dayShort: days[date.getDay()].substring(0, 3),
      day: date.getDate(),
      month: months[date.getMonth()],
    };
  };

  const dateDisplay = formatDateDisplay(selectedDate);

  return (
    <div className="min-h-screen bg-slate-50 pb-4">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 xl:px-12">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6 pb-8 rounded-b-2xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">Hola, {currentUser.name.split(" ")[0]}</h1>
            <p className="text-blue-100 text-sm mt-1">{currentUser.zone}</p>
          </div>
          <div 
            className="bg-white/20 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-white/30 transition-colors active:scale-95"
            onClick={() => setIsDateSelectorOpen(true)}
          >
            <div className="flex items-center gap-1 mb-0.5">
              <p className="text-xs font-medium">{dateDisplay.dayShort}</p>
              <Calendar size={12} className="text-blue-100" />
            </div>
            <p className="text-lg font-bold">{dateDisplay.day} {dateDisplay.month}</p>
          </div>
        </div>

        {/* Quick Stats */}
        {loadingPdvs && (
          <div className="mt-4 text-center text-white/90 text-sm">Cargando...</div>
        )}
        <div className="grid grid-cols-3 gap-3 mt-6">
          <Card className="bg-white/95 border-0">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-blue-600">{todayVisits}</p>
              <p className="text-xs text-slate-600 mt-1">Planificadas</p>
            </CardContent>
          </Card>
          <Card className="bg-white/95 border-0">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-green-600">{completedVisits}</p>
              <p className="text-xs text-slate-600 mt-1">Completadas</p>
            </CardContent>
          </Card>
          <Card className="bg-white/95 border-0">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-orange-600">{pendingVisits}</p>
              <p className="text-xs text-slate-600 mt-1">Pendientes</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Main Content */}
      <div className="-mt-4">
        {/* Ruta del día + Primary CTA */}
        {todayRouteName && (
          <div className="mb-3 px-1">
            <p className="text-sm font-medium text-slate-600">Tu ruta hoy</p>
            <p className="text-lg font-bold text-slate-900">{todayRouteName}</p>
          </div>
        )}
        <Button
          onClick={() => navigate("/route", { state: { selectedDate: selectedDate.toISOString() } })}
          className="w-full h-14 text-base font-semibold shadow-lg mb-6"
          size="lg"
        >
          <MapPin className="mr-2" size={20} />
          {todayVisits > 0 ? "Ver Ruta Foco" : "Ver Agenda"}
        </Button>

        {/* Alerts Banner */}
        {openAlerts > 0 && (
          <Card
            className="mb-4 border-l-4 border-l-red-500 bg-red-50 cursor-pointer hover:bg-red-100 transition-colors"
            onClick={() => navigate("/alerts")}
          >
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="bg-red-600 rounded-full p-2">
                  <AlertCircle size={20} className="text-white" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-red-900">
                    {openAlerts} {openAlerts === 1 ? "Alerta activa" : "Alertas activas"}
                  </p>
                  <p className="text-sm text-red-700">Requieren atención</p>
                </div>
                <Badge variant="destructive">{openAlerts}</Badge>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sync Status */}
        {syncStatus.pendingRecords > 0 && (
          <Card
            className="mb-6 border-l-4 border-l-yellow-500 bg-yellow-50 cursor-pointer hover:bg-yellow-100 transition-colors"
            onClick={() => navigate("/sync")}
          >
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Clock size={20} className="text-yellow-700" />
                <div className="flex-1">
                  <p className="font-semibold text-yellow-900">
                    {syncStatus.pendingRecords} registros pendientes de sincronización
                  </p>
                  <p className="text-sm text-yellow-700">
                    Última sync:{" "}
                    {new Date(syncStatus.lastSync).toLocaleTimeString("es-AR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick Actions */}
        <div className="mb-6">
          <h2 className="text-lg font-bold text-slate-900 mb-3">Accesos Rápidos</h2>
          <div className="grid grid-cols-2 gap-3">
            <Card
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate("/new-pos")}
            >
              <CardContent className="p-4 text-center">
                <div className="bg-green-100 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-2">
                  <Plus size={24} className="text-green-600" />
                </div>
                <p className="font-semibold text-slate-900">Alta PDV</p>
              </CardContent>
            </Card>

            {!isAdmin && (
              <Card
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate("/my-routes")}
              >
                <CardContent className="p-4 text-center">
                  <div className="bg-indigo-100 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-2">
                    <MapPin size={24} className="text-indigo-600" />
                  </div>
                  <p className="font-semibold text-slate-900">Mis Rutas</p>
                </CardContent>
              </Card>
            )}

            <Card 
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate("/search-pdv")}
            >
              <CardContent className="p-4 text-center">
                <div className="bg-blue-100 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-2">
                  <Search size={24} className="text-blue-600" />
                </div>
                <p className="font-semibold text-slate-900">Buscar PDV</p>
              </CardContent>
            </Card>
          </div>
          
          {/* Admin Access - Only for admin/supervisor roles */}
          {["admin", "supervisor"].includes(currentUser.role) && (
            <Card
              className="mt-3 cursor-pointer hover:shadow-md transition-shadow bg-gradient-to-r from-purple-50 to-indigo-50 border-purple-200"
              onClick={() => navigate("/admin")}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="bg-purple-600 rounded-full w-12 h-12 flex items-center justify-center">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-purple-900">Panel de Administración</p>
                    <p className="text-xs text-purple-700">Dashboard, gestión y reportes</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Today's Highlights */}
        <div className="mb-6">
          <h2 className="text-lg font-bold text-slate-900 mb-3">Próximas Visitas</h2>
          {todayVisits === 0 ? (
            <Card className="border-dashed border-2 border-slate-300 bg-slate-50">
              <CardContent className="p-8 text-center">
                <div className="bg-slate-200 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-3">
                  <Calendar size={32} className="text-slate-400" />
                </div>
                <p className="font-semibold text-slate-700 mb-1">
                  No hay visitas planificadas
                </p>
                <p className="text-sm text-slate-500">
                  para {dateDisplay.dayName.toLowerCase()} {dateDisplay.day} de {dateDisplay.month}
                </p>
              </CardContent>
            </Card>
          ) : pointsOfSale.filter((p) => p.status === "pending").length === 0 ? (
            <Card className="bg-green-50 border-green-200">
              <CardContent className="p-6 text-center">
                <div className="bg-green-100 rounded-full w-14 h-14 flex items-center justify-center mx-auto mb-2">
                  <CheckCircle2 size={28} className="text-green-600" />
                </div>
                <p className="font-semibold text-green-900">
                  ¡Todas las visitas completadas!
                </p>
              </CardContent>
            </Card>
          ) : (
            pointsOfSale.filter((p) => p.status === "pending").slice(0, 3).map((pos) => (
              <Card
                key={pos.id}
                className="mb-3 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(`/pos/${pos.id}`)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h3 className="font-semibold text-slate-900">{pos.name}</h3>
                      <p className="text-sm text-slate-600 mt-1">{pos.address}</p>
                    </div>
                    <Badge
                      variant={
                        pos.priority === "high"
                          ? "destructive"
                          : pos.priority === "medium"
                          ? "default"
                          : "secondary"
                      }
                    >
                      {pos.priority === "high"
                        ? "Alta"
                        : pos.priority === "medium"
                        ? "Media"
                        : "Baja"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-slate-600">
                    <span className="flex items-center gap-1">
                      <Clock size={14} />
                      {pos.estimatedTime}
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPin size={14} />
                      {pos.channel}
                    </span>
                    {pos.compliance && (
                      <span className="flex items-center gap-1">
                        <TrendingUp size={14} />
                        {pos.compliance}%
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Performance Indicator */}
        <Card className="mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="bg-blue-600 rounded-full p-2.5">
                <CheckCircle2 size={24} className="text-white" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-slate-900">Rendimiento del Mes</p>
                <p className="text-sm text-slate-600">{monthlyCompliance}% de cumplimiento</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-blue-600">{monthlyCompliance}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      </div>

      {/* Date Selector */}
      <DateSelector
        isOpen={isDateSelectorOpen}
        onClose={() => setIsDateSelectorOpen(false)}
        selectedDate={selectedDate}
        onDateSelect={setSelectedDate}
      />
    </div>
  );
}