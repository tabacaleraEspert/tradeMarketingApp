import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Search, Filter, Calendar, User, Clock, MapPin, ChevronDown } from "lucide-react";
import { api } from "@/lib/api/client";
import { usersApi } from "@/lib/api";
import { toast } from "sonner";

interface TimelineEvent {
  ts: string | null;
  type: string;
  icon: string;
  title: string;
  detail: string;
  visitId?: number;
  pdvId?: number;
  pdvName?: string;
  userId?: number;
  userName?: string;
}

interface TimelineResponse {
  user: { UserId: number; DisplayName: string; Email: string };
  events: TimelineEvent[];
  totalEvents: number;
}

interface UserOption {
  UserId: number;
  DisplayName: string;
  Email: string;
}

const TYPE_COLORS: Record<string, string> = {
  visit_open: "bg-blue-500",
  visit_close: "bg-green-500",
  check_in: "bg-indigo-500",
  check_out: "bg-purple-500",
  photo: "bg-pink-500",
  form_fill: "bg-amber-500",
  action: "bg-orange-500",
  coverage: "bg-teal-500",
  pop: "bg-cyan-500",
  market_news: "bg-yellow-600",
  incident: "bg-red-500",
  note: "bg-gray-500",
  pdv_create: "bg-emerald-600",
  route_create: "bg-violet-500",
};

const TYPE_LABELS: Record<string, string> = {
  visit_open: "Visita",
  visit_close: "Cierre",
  check_in: "Check-in",
  check_out: "Check-out",
  photo: "Foto",
  form_fill: "Formulario",
  action: "Acción",
  coverage: "Cobertura",
  pop: "POP",
  market_news: "Novedad",
  incident: "Incidente",
  note: "Nota",
  pdv_create: "Alta PDV",
  route_create: "Ruta creada",
};

function formatTs(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "long", day: "numeric", month: "long",
  });
}

export function AuditTimeline() {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }));
  const [dateTo, setDateTo] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }));
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState<string>("all");
  const [searchUser, setSearchUser] = useState("");

  useEffect(() => {
    usersApi.list().then((u) =>
      setUsers(u.map((x: any) => ({ UserId: x.UserId, DisplayName: x.DisplayName, Email: x.Email })))
    ).catch(() => {});
  }, []);

  const filteredUsers = useMemo(() => {
    if (!searchUser) return users;
    const q = searchUser.toLowerCase();
    return users.filter(u => u.DisplayName.toLowerCase().includes(q) || u.Email.toLowerCase().includes(q));
  }, [users, searchUser]);

  const loadTimeline = async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = {
        date_from: dateFrom,
        date_to: dateTo + "T23:59:59",
      };
      if (selectedUserId) params.user_id = selectedUserId;
      const result = await api.get<TimelineResponse>("/audit/user-timeline", params);
      setData(result);
    } catch (e: any) {
      toast.error(e?.message || "Error al cargar timeline");
    } finally {
      setLoading(false);
    }
  };

  // Auto-load on mount
  useEffect(() => { loadTimeline(); }, []);

  const filteredEvents = useMemo(() => {
    if (!data) return [];
    if (filterType === "all") return data.events;
    return data.events.filter(e => e.type === filterType);
  }, [data, filterType]);

  // Group events by user then by date
  const groupedByUser = useMemo(() => {
    const userGroups: Record<string, TimelineEvent[]> = {};
    for (const ev of filteredEvents) {
      const key = ev.userName || `Usuario #${ev.userId || "?"}`;
      if (!userGroups[key]) userGroups[key] = [];
      userGroups[key].push(ev);
    }
    return Object.entries(userGroups).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredEvents]);

  // Group events by date (within a user or all)
  const groupByDate = (events: TimelineEvent[]) => {
    const groups: Record<string, TimelineEvent[]> = {};
    for (const ev of events) {
      const dateKey = ev.ts ? ev.ts.split("T")[0] : "sin-fecha";
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(ev);
    }
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  };

  const eventTypes = useMemo(() => {
    if (!data) return [];
    const types = new Set(data.events.map(e => e.type));
    return Array.from(types).sort();
  }, [data]);

  return (
    <div className="space-y-4 pb-8">
      <div>
        <h1 className="text-xl font-bold">Auditoría de Usuario</h1>
        <p className="text-sm text-muted-foreground">Timeline completo de actividad por vendedor</p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 space-y-3">
          {/* User select */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">Usuario</p>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchUser}
                onChange={(e) => setSearchUser(e.target.value)}
                placeholder="Buscar usuario..."
                className="pl-8 h-9 text-sm"
              />
            </div>
            {(searchUser || !selectedUserId) && filteredUsers.length > 0 && (
              <div className="mt-1 max-h-40 overflow-y-auto border border-border rounded-lg bg-background">
                {filteredUsers.slice(0, 10).map(u => (
                  <button
                    key={u.UserId}
                    onClick={() => { setSelectedUserId(u.UserId); setSearchUser(u.DisplayName); }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${selectedUserId === u.UserId ? "bg-[#A48242]/10 font-semibold" : ""}`}
                  >
                    <span className="font-medium">{u.DisplayName}</span>
                    <span className="text-muted-foreground ml-2 text-xs">{u.Email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Date range */}
          <div className="flex gap-2">
            <div className="flex-1">
              <p className="text-xs font-semibold text-muted-foreground mb-1">Desde</p>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold text-muted-foreground mb-1">Hasta</p>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 text-sm" />
            </div>
          </div>

          <Button onClick={loadTimeline} disabled={loading} className="w-full h-9 bg-[#A48242] hover:bg-[#8a6d35]">
            {loading ? "Cargando..." : selectedUserId ? "Ver timeline" : "Ver todos los usuarios"}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {data && (
        <>
          {/* Stats */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                {data.user ? (
                  <>
                    <div className="w-10 h-10 rounded-full bg-[#A48242] flex items-center justify-center text-white font-bold text-lg">
                      {data.user.DisplayName.charAt(0)}
                    </div>
                    <div>
                      <p className="font-bold">{data.user.DisplayName}</p>
                      <p className="text-xs text-muted-foreground">{data.user.Email}</p>
                    </div>
                  </>
                ) : (
                  <div>
                    <p className="font-bold">Todos los usuarios</p>
                    <p className="text-xs text-muted-foreground">{groupedByUser.length} usuarios con actividad</p>
                  </div>
                )}
                <div className="ml-auto text-right">
                  <p className="text-2xl font-bold text-[#A48242]">{data.totalEvents}</p>
                  <p className="text-[10px] text-muted-foreground">eventos</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Type filter chips */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setFilterType("all")}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${filterType === "all" ? "bg-[#A48242] text-white" : "bg-muted text-muted-foreground"}`}
            >
              Todos ({data.events.length})
            </button>
            {eventTypes.map(t => {
              const count = data.events.filter(e => e.type === t).length;
              return (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${filterType === t ? "bg-[#A48242] text-white" : "bg-muted text-muted-foreground"}`}
                >
                  {TYPE_LABELS[t] || t} ({count})
                </button>
              );
            })}
          </div>

          {/* Timeline grouped by user */}
          <div className="space-y-6">
            {groupedByUser.map(([userName, userEvents]) => (
              <div key={userName}>
                {/* User header */}
                {!selectedUserId && (
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-full bg-[#A48242]/10 flex items-center justify-center">
                      <User size={16} className="text-[#A48242]" />
                    </div>
                    <p className="font-bold text-foreground">{userName}</p>
                    <Badge variant="outline" className="text-[10px]">{userEvents.length} eventos</Badge>
                  </div>
                )}

                {groupByDate(userEvents).map(([dateKey, events]) => (
                  <div key={`${userName}-${dateKey}`} className={!selectedUserId ? "ml-4" : ""}>
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar size={14} className="text-[#A48242]" />
                      <p className="text-xs font-bold text-[#A48242] uppercase">
                        {dateKey !== "sin-fecha" ? formatDate(dateKey) : "Sin fecha"}
                      </p>
                      <Badge variant="outline" className="text-[10px]">{events.length}</Badge>
                    </div>

                    <div className="relative ml-3 border-l-2 border-border pl-4 space-y-2 mb-4">
                      {events.map((ev, i) => (
                        <div key={`${dateKey}-${i}`} className="relative">
                          <div className={`absolute -left-[21px] top-2 w-3 h-3 rounded-full border-2 border-background ${TYPE_COLORS[ev.type] || "bg-gray-400"}`} />
                          <div className="bg-muted rounded-lg p-3">
                            <div className="flex items-start gap-2">
                              <span className="text-base">{ev.icon}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold truncate">{ev.title}</p>
                                  <Badge variant="outline" className={`text-[9px] shrink-0 ${TYPE_COLORS[ev.type] || ""} text-white border-0`}>
                                    {TYPE_LABELS[ev.type] || ev.type}
                                  </Badge>
                                </div>
                                {ev.detail && <p className="text-xs text-muted-foreground mt-0.5">{ev.detail}</p>}
                              </div>
                              <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                                {ev.ts ? new Date(ev.ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }) : ""}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}

            {filteredEvents.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Clock size={40} className="mx-auto mb-2 opacity-50" />
                <p className="font-medium">Sin eventos</p>
                <p className="text-sm">No hay actividad para los filtros seleccionados</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
