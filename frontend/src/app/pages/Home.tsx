import { useNavigate } from "react-router";
import { useState, useMemo, useEffect, useCallback } from "react";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { DateSelector } from "../components/DateSelector";
import {
  MapPin, Plus, Search, Clock, CheckCircle2, AlertCircle,
  TrendingUp, Calendar, Route, ChevronRight, Target, Star, Zap,
  ArrowRight, Store, Navigation, Locate, Loader2, X,
} from "lucide-react";
import { getCurrentUser } from "../lib/auth";
import { useSelectedDate } from "../lib/SelectedDateContext";
import {
  routeDayPdvToPointOfSaleUI, incidentToAlertUI, notificationToAlertUI,
  pdvsApi, productsApi, formsApi, dashboardApi, visitsApi,
  channelsApi, subchannelsApi, supplierTypesApi, supplierProductTypesApi, zonesApi,
  usersApi, mandatoryActivitiesApi, pdvSuppliersApi, pdvProductCategoriesApi,
  useIncidentsWithPdvNames, useActiveNotifications,
} from "@/lib/api";
import { fetchRouteDayPdvsForDate } from "@/lib/api/hooks";
import { useQuery } from "@/lib/api/useQuery";
import { fetchWithCache, writeCache } from "@/lib/offline";
import type { DashboardHomeData } from "@/lib/api/services";

/** Timezone-safe Date → YYYY-MM-DD */
function dateToYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function Home() {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const { selectedDate, setSelectedDate, goToToday, isToday } = useSelectedDate();
  const [isDateSelectorOpen, setIsDateSelectorOpen] = useState(false);

  const isAdmin = ["admin", "regional_manager", "territory_manager"].includes(currentUser.role);

  // ── Aggregated API call with fallback to legacy individual calls ──
  const dateStr = dateToYMD(selectedDate);
  const userIdForFilter = isAdmin ? undefined : Number(currentUser.id) || undefined;

  const fetchHomeData = async (): Promise<DashboardHomeData> => {
    try {
      return await dashboardApi.home(dateStr);
    } catch {
      // Fallback: /dashboard/home not deployed yet — use individual calls
      const [rdpData, monthlyData] = await Promise.all([
        fetchRouteDayPdvsForDate(selectedDate, userIdForFilter),
        fetchWithCache(`monthly_stats_${currentUser.id}`, () =>
          import("@/lib/api/services").then((m) => m.usersApi.getMonthlyStats(Number(currentUser.id))),
          2 * 60 * 60 * 1000,
        ).catch(() => ({ visits: 0, compliance: 0, new_pdvs: 0 })),
      ]);
      // Detect open visit
      let openVisit: DashboardHomeData["openVisit"] = null;
      try {
        const userId = Number(currentUser.id);
        const open = await visitsApi.list({ user_id: userId, status: "OPEN" });
        const ip = open[0] || (await visitsApi.list({ user_id: userId, status: "IN_PROGRESS" }).catch(() => []))[0];
        if (ip) {
          const pdv = await pdvsApi.get(ip.PdvId).catch(() => null);
          if (pdv) openVisit = { VisitId: ip.VisitId, PdvId: ip.PdvId, PdvName: pdv.Name, Status: ip.Status };
        }
      } catch { /* offline */ }
      return { routeDayPdvs: rdpData, openVisit, monthlyStats: monthlyData, alertCount: 0 };
    }
  };

  const { data: homeData, loading: loadingPdvs, refetch: refetchHome } = useQuery(
    `dashboard_home_${dateStr}`,
    fetchHomeData,
    { ttlMs: 4 * 60 * 60 * 1000 },
  );

  const routeDayPdvs = homeData?.routeDayPdvs ?? [];
  const globalOpenVisit = homeData?.openVisit ?? null;
  const monthlyStats = homeData?.monthlyStats ?? null;

  // Incidents & notifications still fetched separately (they have their own cache + are used in alerts list)
  const { data: incidents } = useIncidentsWithPdvNames();
  const { data: notifications } = useActiveNotifications(Number(currentUser.id) || undefined);

  // ── Nearby kiosk modal — PDVs loaded on demand, not on mount ──
  const [nearbyOpen, setNearbyOpen] = useState(false);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [userCoords, setUserCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [nearbySearch, setNearbySearch] = useState("");
  const [nearbyPdvList, setNearbyPdvList] = useState<any[]>([]);

  const distanceMetersBetween = useCallback((lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }, []);

  const handleOpenNearby = useCallback(() => {
    setNearbyOpen(true);
    setNearbyLoading(true);
    setNearbySearch("");
    // Fetch PDVs on demand (deferred from mount)
    const pdvPromise = fetchWithCache("pdvs_all_all", () => pdvsApi.list({}));
    const geoPromise = new Promise<{ lat: number; lon: number }>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        reject,
        { enableHighAccuracy: true, timeout: 10000 },
      );
    });
    Promise.all([pdvPromise, geoPromise])
      .then(([pdvs, coords]) => {
        setUserCoords(coords);
        setNearbyPdvList(pdvs);
        setNearbyLoading(false);
      })
      .catch(() => setNearbyLoading(false));
  }, []);

  const nearbyPdvs = useMemo(() => {
    if (!userCoords || nearbyPdvList.length === 0) return [];
    return nearbyPdvList
      .filter((p: any) => p.Lat != null && p.Lon != null && p.IsActive)
      .map((p: any) => ({ ...p, distance: distanceMetersBetween(userCoords.lat, userCoords.lon, p.Lat!, p.Lon!) }))
      .sort((a: any, b: any) => a.distance - b.distance)
      .filter((p: any) => !nearbySearch || p.Name.toLowerCase().includes(nearbySearch.toLowerCase()) || (p.Address || "").toLowerCase().includes(nearbySearch.toLowerCase()));
  }, [userCoords, nearbyPdvList, nearbySearch, distanceMetersBetween]);

  // Refetch when user comes back to this page
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") refetchHome(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refetchHome]);

  // Pre-fetch data needed for offline — once per session, not on every navigation
  const [cacheProgress, setCacheProgress] = useState<{ done: number; total: number } | null>(null);
  const CACHE_SESSION_KEY = "espert.offline_cached_today";

  const runOfflinePreCache = useCallback(() => {
    if (!navigator.onLine || routeDayPdvs.length === 0) return;

    // Mark as running so we don't re-trigger
    sessionStorage.setItem(CACHE_SESSION_KEY, dateStr);
    setCacheProgress({ done: 0, total: 0 });

    const schedule = typeof requestIdleCallback === "function" ? requestIdleCallback : (fn: () => void) => setTimeout(fn, 200);
    schedule(async () => {
      let done = 0;
      let total = 0;
      const track = <T,>(p: Promise<T>): Promise<T> => {
        total++;
        setCacheProgress((prev) => ({ done: prev?.done ?? 0, total }));
        return p.finally(() => {
          done++;
          setCacheProgress({ done, total });
        });
      };

      // Per-PDV data for today's route
      for (const rdp of routeDayPdvs) {
        track(fetchWithCache(`pdv_${rdp.PdvId}`, () => pdvsApi.get(rdp.PdvId)).catch(() => {}));
        track(fetchWithCache(`pdv_suppliers_${rdp.PdvId}`, () => pdvSuppliersApi.list(rdp.PdvId)).catch(() => {}));
        track(fetchWithCache(`pdv_categories_${rdp.PdvId}`, () => pdvProductCategoriesApi.list(rdp.PdvId)).catch(() => {}));
        // Cache zone suppliers once using first real PDV (all PDVs in zone return same suppliers)
        if (rdp === routeDayPdvs[0]) {
          track(fetchWithCache(`zone_suppliers_pdv_${rdp.PdvId}`, () => pdvSuppliersApi.searchZone(rdp.PdvId))
            .then((data: any) => writeCache("zone_suppliers_all", data))
            .catch(() => {}));
        }
      }
      // Reference data
      const zoneId = currentUser.zoneId;
      track(fetchWithCache(`pdvs_${zoneId ?? "all"}_all`, () => pdvsApi.list(zoneId ? { zone_id: zoneId } : {})).catch(() => {}));
      track(fetchWithCache("products_all", () => productsApi.list()).catch(() => {}));
      track(fetchWithCache("products_active", () => productsApi.list({ active_only: true })).catch(() => {}));
      track(fetchWithCache("supplier_types", () => supplierTypesApi.list()).catch(() => {}));
      track(fetchWithCache("supplier_product_types", () => supplierProductTypesApi.list()).catch(() => {}));
      track(fetchWithCache("zones", () => zonesApi.list()).catch(() => {}));
      track(fetchWithCache("users", () => usersApi.list()).catch(() => {}));
      track(fetchWithCache("mandatory_activities", () => mandatoryActivitiesApi.list({ active_only: true })).catch(() => {}));
      // Channels + subchannels
      track(fetchWithCache("channels", () => channelsApi.list()).then((chs: any[]) => {
        for (const ch of chs) track(fetchWithCache(`subchannels_${ch.ChannelId}`, () => subchannelsApi.list(ch.ChannelId)).catch(() => {}));
      }).catch(() => {}));
      // Forms + questions
      track(fetchWithCache("forms_active", () => formsApi.list({ limit: 200 })).then((forms: any[]) => {
        for (const f of forms) track(fetchWithCache(`form_questions_${f.FormId}`, () => formsApi.listQuestions(f.FormId)).catch(() => {}));
      }).catch(() => {}));
      // User visits + open visit PDV data
      const uid = Number(currentUser.id);
      track(fetchWithCache(`visits_user_${uid}`, () => visitsApi.list({ user_id: uid })).then((visits: any[]) => {
        for (const v of visits) {
          if (v.Status === "OPEN" || v.Status === "IN_PROGRESS") {
            track(fetchWithCache(`pdv_${v.PdvId}`, () => pdvsApi.get(v.PdvId)).catch(() => {}));
            track(fetchWithCache(`visits_pdv_${v.PdvId}`, () => visitsApi.list({ pdv_id: v.PdvId })).catch(() => {}));
            track(fetchWithCache(`pdv_suppliers_${v.PdvId}`, () => pdvSuppliersApi.list(v.PdvId)).catch(() => {}));
            track(fetchWithCache(`pdv_categories_${v.PdvId}`, () => pdvProductCategoriesApi.list(v.PdvId)).catch(() => {}));
          }
        }
      }).catch(() => {}));
    });
  }, [routeDayPdvs, dateStr, currentUser.id, currentUser.zoneId]);

  // Auto-run precache once per session (or when date changes)
  useEffect(() => {
    const cached = sessionStorage.getItem(CACHE_SESSION_KEY);
    if (cached === dateStr) return; // already cached for today
    if (routeDayPdvs.length > 0) runOfflinePreCache();
  }, [routeDayPdvs, dateStr, runOfflinePreCache]);

  const allPointsOfSale = useMemo(() => routeDayPdvs.map(routeDayPdvToPointOfSaleUI), [routeDayPdvs]);
  const alerts = useMemo(() => [...incidents.map(incidentToAlertUI), ...notifications.map(notificationToAlertUI)], [incidents, notifications]);

  // Group PDVs by route
  const routeGroups = useMemo(() => {
    const groups: Record<string, typeof allPointsOfSale> = {};
    for (const p of allPointsOfSale) {
      const key = p.routeName || "Sin ruta";
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    return groups;
  }, [allPointsOfSale]);
  const routeNames = Object.keys(routeGroups);

  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  // Auto-select first route when data loads
  useEffect(() => {
    if (routeNames.length > 0 && !selectedRoute) {
      setSelectedRoute(routeNames[0]);
    }
  }, [routeNames.length]);

  const pointsOfSale = selectedRoute && routeGroups[selectedRoute] ? routeGroups[selectedRoute] : allPointsOfSale;

  const todayVisits = pointsOfSale.length;
  const completedVisits = pointsOfSale.filter((p) => p.status === "completed").length;
  const pendingVisits = pointsOfSale.filter((p) => p.status === "pending" || p.status === "not-visited").length;
  const inProgressVisits = pointsOfSale.filter((p) => p.status === "in-progress").length;
  const todayRouteName = selectedRoute || pointsOfSale[0]?.routeName;
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
            {/* Badge offline-ready: feedback persistente al usuario sobre si los
                datos están cacheados para operar sin conexión. */}
            {(() => {
              const isCaching = cacheProgress && cacheProgress.total > 0 && cacheProgress.done < cacheProgress.total;
              const cachedToday = sessionStorage.getItem(CACHE_SESSION_KEY) === dateStr;
              const isReady = cacheProgress
                ? cacheProgress.total > 0 && cacheProgress.done >= cacheProgress.total
                : cachedToday;
              if (isCaching) {
                return (
                  <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-amber-300/90">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    Cargando offline {cacheProgress!.done}/{cacheProgress!.total}
                  </span>
                );
              }
              if (isReady) {
                return (
                  <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-green-300/90">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    Offline listo
                  </span>
                );
              }
              return (
                <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-[#979B9B]">
                  <span className="w-1.5 h-1.5 rounded-full bg-white/30" />
                  Sin datos offline
                </span>
              );
            })()}
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
              <div
                className="absolute inset-0 flex items-center justify-center"
                aria-label={progressPercent === 100 ? `${completedVisits} de ${todayVisits} visitas completadas` : undefined}
              >
                {progressPercent === 100 ? (
                  <CheckCircle2 size={20} className="text-green-500" />
                ) : (
                  <span className="text-xs font-bold">{completedVisits}/{todayVisits}</span>
                )}
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
        {/* Route selector — if multiple routes today */}
        {!loadingPdvs && routeNames.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 mt-2">
            {routeNames.map((name) => (
              <button
                key={name}
                onClick={() => setSelectedRoute(name)}
                className={`px-3 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors ${
                  selectedRoute === name
                    ? "bg-[#A48242] text-white"
                    : "bg-white/10 text-white/60 hover:bg-white/20"
                }`}
              >
                {name} ({routeGroups[name].length})
              </button>
            ))}
          </div>
        )}

        {!loadingPdvs && todayVisits === 0 && routeNames.length === 0 && (
          <p className="text-sm text-[#979B9B]">Sin visitas planificadas para hoy</p>
        )}
        {loadingPdvs && <p className="text-sm text-[#979B9B]">Cargando...</p>}
      </div>

      {/* Banner visita abierta global */}
      {globalOpenVisit && (
        <div className="mx-4 -mt-3 mb-2 relative z-10">
          <Card className="border-amber-400 bg-amber-50 shadow-md">
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                <div className="bg-amber-500 rounded-full p-2 shrink-0">
                  <AlertCircle size={18} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-amber-900">Visita en curso</p>
                  <p className="text-sm font-semibold text-amber-800 truncate">{globalOpenVisit.PdvName}</p>
                </div>
                <button
                  onClick={() => navigate(`/pos/${globalOpenVisit.PdvId}`)}
                  className="shrink-0 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"
                >
                  Ir <ArrowRight size={12} />
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Content */}
      {/* -mt-3 hace que la primera card "asome" debajo del header negro redondeado.
          Sólo aplica si hay una nextPdv card (diseñada para ese efecto); si no,
          el primer item es un botón plano que quedaría superpuesto al header.

          isolation/contain: workaround para ghosting de Chromium en Android —
          en algunos devices (drivers GPU + versiones de WebView específicas),
          las stats cards y los quick action buttons quedaban duplicados como
          fantasmas al repintar. Forzando un stacking context aislado + content
          containment, el painter de Chromium recicla la capa correctamente. */}
      <div
        className={`px-4 space-y-3 ${nextPdv ? "-mt-3" : "mt-3"}`}
        style={{ isolation: "isolate", contain: "layout paint", transform: "translateZ(0)" }}
      >

        {/* === NEXT STEP CARD === */}
        {nextPdv && (
          <Card
            className="shadow-lg border-[#A48242]/30 overflow-hidden cursor-pointer active:scale-[0.98] transition-transform"
            onClick={() => {
              if (nextPdv.step === "checkin") {
                navigate(`/pos/${nextPdv.id}/checkin`, { state: nextPdv.routeDayId ? { routeDayId: nextPdv.routeDayId } : undefined });
              } else if (nextPdv.step === "relevamiento") {
                navigate(`/pos/${nextPdv.id}/survey`, { state: nextPdv.routeDayId ? { routeDayId: nextPdv.routeDayId } : undefined });
              } else {
                navigate(`/pos/${nextPdv.id}`, { state: nextPdv.routeDayId ? { routeDayId: nextPdv.routeDayId } : undefined });
              }
            }}
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

        {/* Offline cache progress — below next visit card */}
        {cacheProgress && cacheProgress.done < cacheProgress.total && (
          <div className="py-1.5">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-1">
              <div className="w-3 h-3 border-2 border-[#A48242] border-t-transparent rounded-full animate-spin" />
              <span>Preparando datos offline... {cacheProgress.done}/{cacheProgress.total}</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-[#A48242] rounded-full transition-all duration-300"
                style={{ width: `${Math.round((cacheProgress.done / cacheProgress.total) * 100)}%` }}
              />
            </div>
          </div>
        )}
        {cacheProgress && cacheProgress.done > 0 && cacheProgress.done >= cacheProgress.total && (
          <button
            onClick={() => { sessionStorage.removeItem(CACHE_SESSION_KEY); runOfflinePreCache(); }}
            className="flex items-center gap-2 text-[11px] text-green-600 py-1"
          >
            <CheckCircle2 size={14} />
            <span>Datos offline listos</span>
            <span className="text-muted-foreground ml-1">(tocar para recargar)</span>
          </button>
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

        {/* Nearby kiosk button */}
        <button
          onClick={handleOpenNearby}
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-[#A48242]/10 border border-[#A48242]/20 hover:bg-[#A48242]/20 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Locate size={16} className="text-[#A48242]" />
            <span className="text-sm font-medium text-foreground">Buscar kiosco cerca</span>
          </div>
          <ChevronRight size={14} className="text-[#A48242]" />
        </button>

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
          <button onClick={() => {
            if (pendingVisits > 0) {
              if (window.confirm(`Tenés ${pendingVisits} visita${pendingVisits > 1 ? "s" : ""} pendiente${pendingVisits > 1 ? "s" : ""}. ¿Querés ir al cierre de todos modos?`)) {
                navigate("/end-of-day");
              }
            } else {
              navigate("/end-of-day");
            }
          }} className="flex flex-col items-center gap-1 p-2.5 rounded-xl bg-card border border-border">
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

      {/* Nearby kiosk modal */}
      {nearbyOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-[1000]" onClick={() => setNearbyOpen(false)} />
          <div className="fixed inset-0 z-[1001] flex items-end sm:items-center justify-center">
            <div className="bg-card rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] flex flex-col animate-slide-up" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                  <Locate size={18} className="text-[#A48242]" />
                  <h2 className="text-lg font-bold text-foreground">Kioscos cerca</h2>
                </div>
                <button onClick={() => setNearbyOpen(false)} className="p-2 hover:bg-muted rounded-lg"><X size={20} /></button>
              </div>
              {/* Search */}
              <div className="px-4 py-2 border-b border-border shrink-0">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Filtrar por nombre o dirección..."
                    value={nearbySearch}
                    onChange={(e) => setNearbySearch(e.target.value)}
                    className="w-full h-9 pl-9 pr-3 border border-border rounded-lg text-sm bg-background"
                  />
                </div>
              </div>
              {/* List */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {nearbyLoading ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Loader2 size={24} className="animate-spin mb-2" />
                    <p className="text-sm">Obteniendo ubicación...</p>
                  </div>
                ) : !userCoords ? (
                  <div className="text-center py-12">
                    <MapPin size={32} className="mx-auto text-muted-foreground mb-2 opacity-40" />
                    <p className="text-sm text-muted-foreground">No se pudo obtener tu ubicación</p>
                    <button onClick={handleOpenNearby} className="mt-2 text-xs text-[#A48242] font-semibold">Reintentar</button>
                  </div>
                ) : nearbyPdvs.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No se encontraron kioscos{nearbySearch ? " con ese filtro" : ""}</p>
                ) : (
                  nearbyPdvs.slice(0, 50).map((p) => (
                    <button
                      key={p.PdvId}
                      onClick={() => { setNearbyOpen(false); navigate(`/pos/${p.PdvId}`); }}
                      className="w-full bg-background rounded-xl border border-border px-3 py-3 flex items-center gap-3 text-left hover:bg-muted/50 transition-colors"
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${p.distance < 500 ? "bg-green-100" : p.distance < 2000 ? "bg-amber-100" : "bg-muted"}`}>
                        <Store size={18} className={p.distance < 500 ? "text-green-600" : p.distance < 2000 ? "text-amber-600" : "text-muted-foreground"} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{p.Name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{p.Address || "Sin dirección"}</p>
                        {p.ChannelName && <Badge variant="outline" className="text-[9px] mt-0.5">{p.ChannelName}</Badge>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-bold ${p.distance < 500 ? "text-green-600" : p.distance < 2000 ? "text-amber-600" : "text-muted-foreground"}`}>
                          {p.distance < 1000 ? `${Math.round(p.distance)}m` : `${(p.distance / 1000).toFixed(1)}km`}
                        </p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
          <style>{`
            @keyframes slide-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
            .animate-slide-up { animation: slide-up 0.25s ease-out; }
          `}</style>
        </>
      )}
    </div>
  );
}
