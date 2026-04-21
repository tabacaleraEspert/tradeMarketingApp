import { useNavigate } from "react-router";
import { useState, useMemo } from "react";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { DateSelector } from "../components/DateSelector";
import {
  MapPin, Plus, Search, Clock, CheckCircle2, AlertCircle,
  TrendingUp, Calendar, Route, ChevronRight, Target, Star, Zap,
  ArrowRight, Store, Navigation,
} from "lucide-react";
import { getCurrentUser } from "../lib/auth";
import { useSelectedDate } from "../lib/SelectedDateContext";
import {
  useRouteDayPdvsForDate, useIncidentsWithPdvNames, useActiveNotifications,
  useUserMonthlyStats, routeDayPdvToPointOfSaleUI, incidentToAlertUI, notificationToAlertUI,
} from "@/lib/api";

export function Home() {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const { selectedDate, setSelectedDate, goToToday, isToday } = useSelectedDate();
  const [isDateSelectorOpen, setIsDateSelectorOpen] = useState(false);

  const isAdmin = ["admin", "regional_manager", "territory_manager"].includes(currentUser.role);
  const userIdForFilter = isAdmin ? undefined : Number(currentUser.id) || undefined;

  const { data: routeDayPdvs, loading: loadingPdvs } = useRouteDayPdvsForDate(selectedDate, userIdForFilter);
  const { data: incidents } = useIncidentsWithPdvNames();
  const { data: notifications } = useActiveNotifications();
  const { data: monthlyStats } = useUserMonthlyStats(Number(currentUser.id) || undefined);

  const pointsOfSale = useMemo(() => routeDayPdvs.map(routeDayPdvToPointOfSaleUI), [routeDayPdvs]);
  const alerts = useMemo(() => [...incidents.map(incidentToAlertUI), ...notifications.map(notificationToAlertUI)], [incidents, notifications]);

  const todayVisits = pointsOfSale.length;
  const completedVisits = pointsOfSale.filter((p) => p.status === "completed").length;
  const pendingVisits = pointsOfSale.filter((p) => p.status === "pending" || p.status === "not-visited").length;
  const inProgressVisits = pointsOfSale.filter((p) => p.status === "in-progress").length;
  const todayRouteName = pointsOfSale[0]?.routeName;
  const progressPercent = todayVisits > 0 ? Math.round((completedVisits / todayVisits) * 100) : 0;
  const openAlerts = alerts.filter((a) => a.status === "open" || a.status === "in-progress").length;

  // NEXT STEP logic
  const nextPdv = useMemo(() => {
    // First: any in-progress visit
    const inProg = pointsOfSale.find((p) => p.status === "in-progress");
    if (inProg) return { ...inProg, step: "relevamiento" as const };
    // Then: first pending
    const pending = pointsOfSale.find((p) => p.status === "pending" || p.status === "not-visited");
    if (pending) return { ...pending, step: "checkin" as const };
    return null;
  }, [pointsOfSale]);

  const formatDateDisplay = (date: Date) => {
    const days = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    return { dayShort: days[date.getDay()], day: date.getDate(), month: months[date.getMonth()] };
  };

  const dateDisplay = formatDateDisplay(selectedDate);

  const greeting = () => {
    const h = new Date().getHours();
    return h < 12 ? "Buenos días" : h < 18 ? "Buenas tardes" : "Buenas noches";
  };

  return (
    <div className="min-h-screen bg-background pb-4">
      {/* Header - compact */}
      <div className="bg-black text-white px-5 pt-5 pb-5 rounded-b-2xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[#A48242] text-[10px] font-semibold tracking-widest uppercase">ESPERT</p>
            <h1 className="text-lg font-bold mt-0.5">{greeting()}, {currentUser.name.split(" ")[0]}</h1>
          </div>
          <div className="flex items-center gap-1.5">
            {!isToday && (
              <button
                onClick={goToToday}
                className="bg-[#A48242] hover:bg-[#A48242]/90 active:scale-95 rounded-lg px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white transition-colors"
                title="Ir a hoy"
              >
                Hoy
              </button>
            )}
            <div
              className="bg-white/10 rounded-lg px-2.5 py-1 cursor-pointer hover:bg-white/15 active:scale-95 border border-white/5 text-center"
              onClick={() => setIsDateSelectorOpen(true)}
            >
              <p className="text-[10px] text-[#979B9B]">{dateDisplay.dayShort}</p>
              <p className="text-sm font-bold leading-tight">{dateDisplay.day} {dateDisplay.month}</p>
            </div>
          </div>
        </div>

        {/* Progress ring + stats */}
        {!loadingPdvs && todayVisits > 0 && (
          <div className="flex items-center gap-4">
            <div className="relative w-14 h-14 shrink-0">
              <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
                <circle cx="28" cy="28" r="24" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
                <circle cx="28" cy="28" r="24" fill="none"
                  stroke={progressPercent === 100 ? "#22c55e" : "#A48242"}
                  strokeWidth="4" strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 24}`}
                  strokeDashoffset={`${2 * Math.PI * 24 * (1 - progressPercent / 100)}`}
                  className="transition-all duration-700" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-bold">{completedVisits}/{todayVisits}</span>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              {todayRouteName && (
                <p className="text-[10px] text-[#979B9B] truncate">{todayRouteName}</p>
              )}
              <div className="flex items-center gap-3 mt-1 text-xs">
                <span className="text-green-400 font-medium">{completedVisits} hechas</span>
                {inProgressVisits > 0 && <span className="text-amber-400 font-medium">{inProgressVisits} en curso</span>}
                <span className="text-white/60">{pendingVisits} faltan</span>
              </div>
            </div>
          </div>
        )}
        {!loadingPdvs && todayVisits === 0 && (
          <p className="text-sm text-[#979B9B]">Sin visitas planificadas para hoy</p>
        )}
        {loadingPdvs && <p className="text-sm text-[#979B9B]">Cargando...</p>}
      </div>

      {/* Content */}
      <div className="px-4 -mt-3 space-y-3">

        {/* === NEXT STEP CARD === */}
        {nextPdv && (
          <Card
            className="shadow-lg border-[#A48242]/30 overflow-hidden cursor-pointer active:scale-[0.98] transition-transform"
            onClick={() => navigate(`/pos/${nextPdv.id}`, { state: nextPdv.routeDayId ? { routeDayId: nextPdv.routeDayId } : undefined })}
          >
            <div className="bg-[#A48242] px-4 py-2 flex items-center gap-2">
              <Zap size={14} className="text-white" />
              <p className="text-xs font-semibold text-white uppercase tracking-wide">
                {nextPdv.step === "checkin" ? "Siguiente visita" : "Visita en curso"}
              </p>
              <span className="ml-auto text-[10px] text-white/70">
                #{pointsOfSale.findIndex((p) => p.id === nextPdv.id) + 1} de {todayVisits}
              </span>
            </div>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                  nextPdv.step === "checkin" ? "bg-[#A48242]/10" : "bg-amber-100"
                }`}>
                  {nextPdv.step === "checkin"
                    ? <Store size={22} className="text-[#A48242]" />
                    : <Clock size={22} className="text-amber-600" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-foreground">{nextPdv.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{nextPdv.address}</p>
                  <Badge variant="outline" className="text-[10px] mt-1">{nextPdv.channel}</Badge>
                </div>
                <div className="shrink-0 flex flex-col items-center gap-1">
                  <div className="w-9 h-9 rounded-full bg-[#A48242] flex items-center justify-center">
                    <ArrowRight size={18} className="text-white" />
                  </div>
                  <span className="text-[9px] text-muted-foreground font-medium">
                    {nextPdv.step === "checkin" ? "Check-in" : "Relevar"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* All done */}
        {todayVisits > 0 && progressPercent === 100 && (
          <Card
            className="bg-green-50 border-green-200 cursor-pointer"
            onClick={() => navigate("/route", { state: { selectedDate: selectedDate.toISOString() } })}
          >
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle2 size={28} className="text-green-600 shrink-0" />
              <div className="flex-1">
                <p className="font-bold text-green-900">Ruta completada</p>
                <p className="text-xs text-green-700">
                  {isToday ? "Toca para ver el cierre del día" : "Ver resumen de este día"}
                </p>
              </div>
              <ChevronRight size={18} className="text-green-400" />
            </CardContent>
          </Card>
        )}

        {/* See full route */}
        {todayVisits > 0 && pendingVisits > 0 && (
          <button
            onClick={() => navigate("/route", { state: { selectedDate: selectedDate.toISOString() } })}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-card border border-border hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <MapPin size={16} className="text-[#A48242]" />
              <span className="text-sm font-medium text-foreground">Ver ruta completa</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>{pendingVisits} pendientes</span>
              <ChevronRight size={14} />
            </div>
          </button>
        )}

        {/* Alerts */}
        {openAlerts > 0 && (
          <button
            onClick={() => navigate("/alerts")}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200 hover:bg-red-100 transition-colors"
          >
            <div className="bg-red-600 rounded-full p-1.5">
              <AlertCircle size={14} className="text-white" />
            </div>
            <span className="text-sm font-medium text-red-900 flex-1 text-left">
              {openAlerts} {openAlerts === 1 ? "alerta activa" : "alertas activas"}
            </span>
            <ChevronRight size={16} className="text-red-400" />
          </button>
        )}

        {/* Monthly stats — KPIs con fondo sutil de color */}
        {monthlyStats && (monthlyStats.visits > 0 || monthlyStats.new_pdvs > 0) && (
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-center">
              <Target size={14} className="mx-auto text-blue-400 mb-1" />
              <p className="text-lg font-bold text-foreground">{monthlyStats.visits}</p>
              <p className="text-[9px] text-blue-400/80">Visitas {isToday ? "mes" : dateDisplay.month}</p>
            </div>
            <div className={`rounded-xl p-3 text-center border ${
              monthlyStats.compliance >= 80
                ? "bg-emerald-500/10 border-emerald-500/20"
                : monthlyStats.compliance >= 50
                ? "bg-amber-500/10 border-amber-500/20"
                : "bg-rose-500/10 border-rose-500/20"
            }`}>
              <TrendingUp size={14} className={`mx-auto mb-1 ${
                monthlyStats.compliance >= 80 ? "text-emerald-400" : monthlyStats.compliance >= 50 ? "text-amber-400" : "text-rose-400"
              }`} />
              <p className={`text-lg font-bold ${
                monthlyStats.compliance >= 80 ? "text-emerald-400" : monthlyStats.compliance >= 50 ? "text-amber-400" : "text-rose-400"
              }`}>{monthlyStats.compliance}%</p>
              <p className={`text-[9px] ${
                monthlyStats.compliance >= 80 ? "text-emerald-400/80" : monthlyStats.compliance >= 50 ? "text-amber-400/80" : "text-rose-400/80"
              }`}>Cumplimiento</p>
            </div>
            <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-3 text-center">
              <Star size={14} className="mx-auto text-violet-400 mb-1" />
              <p className="text-lg font-bold text-foreground">{monthlyStats.new_pdvs}</p>
              <p className="text-[9px] text-violet-400/80">PDVs nuevos</p>
            </div>
          </div>
        )}

        {/* Quick actions */}
        <div className="grid grid-cols-4 gap-2">
          <button onClick={() => navigate("/new-pos")} className="flex flex-col items-center gap-1 p-2.5 rounded-xl bg-card border border-border">
            <Plus size={18} className="text-[#A48242]" />
            <span className="text-[10px] font-medium text-foreground">Alta PDV</span>
          </button>
          {!isAdmin && (
            <button onClick={() => navigate("/my-routes")} className="flex flex-col items-center gap-1 p-2.5 rounded-xl bg-card border border-border">
              <Route size={18} className="text-[#A48242]" />
              <span className="text-[10px] font-medium text-foreground">Mis Rutas</span>
            </button>
          )}
          <button onClick={() => navigate("/search-pdv")} className="flex flex-col items-center gap-1 p-2.5 rounded-xl bg-card border border-border">
            <Search size={18} className="text-[#A48242]" />
            <span className="text-[10px] font-medium text-foreground">Buscar</span>
          </button>
          <button onClick={() => navigate("/end-of-day")} className="flex flex-col items-center gap-1 p-2.5 rounded-xl bg-card border border-border">
            <Clock size={18} className="text-[#53565A]" />
            <span className="text-[10px] font-medium text-foreground">Cierre</span>
          </button>
        </div>

        {isAdmin && (
          <button
            onClick={() => navigate("/admin")}
            className="w-full flex items-center gap-3 p-3 rounded-xl bg-[#A48242]/5 border border-[#A48242]/20"
          >
            <Zap size={18} className="text-[#A48242]" />
            <span className="text-sm font-medium text-foreground flex-1 text-left">Panel Admin</span>
            <ChevronRight size={16} className="text-[#A48242]" />
          </button>
        )}

        {/* Remaining visits preview */}
        {pointsOfSale.filter((p) => p.status !== "completed").length > 1 && (
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Próximos PDVs</p>
            {pointsOfSale
              .filter((p) => p.status !== "completed" && p.id !== nextPdv?.id)
              .map((pos, i) => (
                <button
                  key={pos.id}
                  onClick={() => navigate(`/pos/${pos.id}`, { state: pos.routeDayId ? { routeDayId: pos.routeDayId } : undefined })}
                  className="w-full flex items-center gap-3 py-2.5 border-b border-border last:border-0 text-left"
                >
                  <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">
                    {pointsOfSale.findIndex((p) => p.id === pos.id) + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{pos.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{pos.address}</p>
                  </div>
                  <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                </button>
              ))}
          </div>
        )}
      </div>

      <DateSelector
        isOpen={isDateSelectorOpen}
        onClose={() => setIsDateSelectorOpen(false)}
        selectedDate={selectedDate}
        onDateSelect={setSelectedDate}
      />
    </div>
  );
}
