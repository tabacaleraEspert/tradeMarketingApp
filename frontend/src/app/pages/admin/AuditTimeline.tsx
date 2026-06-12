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
}

interface TimelineResponse {
  user: { UserId: number; DisplayName: string; Email: string };
  events: TimelineEvent[];
  totalEvents: number;
}

interface ActiveUser {
  UserId: number;
  DisplayName: string;
  Email: string;
  count: number;
  lastTs: string | null;
}

const TYPE_COLORS: Record<string, string> = {
  pdv_created: "bg-emerald-600",
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
};

const TYPE_LABELS: Record<string, string> = {
  pdv_created: "Alta PDV",
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
};

function formatTs(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function formatDate(dateKey: string) {
  // dateKey es "YYYY-MM-DD" (ya en día de Argentina). new Date("YYYY-MM-DD")
  // parsea medianoche UTC y al renderizar en -03 retrocede un día — por eso
  // se construye con partes (medianoche local, sin conversión de zona).
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", {
    weekday: "long", day: "numeric", month: "long",
  });
}

function hhmm(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires",
  });
}

// Un día se compone de bloques: una "visita" (colapsable, con sus pasos) o un
// evento "suelto" (alta de PDV, nota, etc.) que ocurre entre visitas.
type VisitBlock = {
  kind: "visit";
  key: string;
  visitId: number;
  pdvName: string;
  anchorTs: string;
  openTs: string | null;
  closeTs: string | null;
  events: TimelineEvent[];
};
type LooseBlock = { kind: "loose"; key: string; anchorTs: string; event: TimelineEvent };
type DayBlock = VisitBlock | LooseBlock;

export function AuditTimeline() {
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().split("T")[0]);
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [searched, setSearched] = useState(false);
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState<string>("all");
  // Visitas expandidas (key = `${dateKey}-visit-${visitId}`). Arrancan colapsadas.
  const [expandedVisits, setExpandedVisits] = useState<Set<string>>(new Set());
  const toggleVisit = (key: string) =>
    setExpandedVisits((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  // Paso 1: buscar los trades que tuvieron movimiento en el rango elegido.
  const loadActiveUsers = async () => {
    setLoadingUsers(true);
    setData(null);
    setSelectedUserId(null);
    try {
      const res = await api.get<{ users: ActiveUser[] }>("/audit/active-users", {
        date_from: dateFrom + "T00:00:00-03:00",
        date_to: dateTo + "T23:59:59-03:00",
      });
      setActiveUsers(res.users);
      setSearched(true);
    } catch (e: any) {
      toast.error(e?.message || "Error al buscar trades");
    } finally {
      setLoadingUsers(false);
    }
  };

  // Paso 2: al clicar un trade, traer su timeline del rango (igual que antes).
  const loadTimeline = async (userId: number) => {
    setSelectedUserId(userId);
    setLoading(true);
    try {
      const result = await api.get<TimelineResponse>("/audit/user-timeline", {
        user_id: userId,
        date_from: dateFrom + "T00:00:00-03:00",
        date_to: dateTo + "T23:59:59-03:00",
      });
      setData(result);
    } catch (e: any) {
      toast.error(e?.message || "Error al cargar timeline");
    } finally {
      setLoading(false);
    }
  };

  const filteredEvents = useMemo(() => {
    if (!data) return [];
    if (filterType === "all") return data.events;
    return data.events.filter(e => e.type === filterType);
  }, [data, filterType]);

  // Agrupado día → bloques. Dentro de cada día, los eventos con visitId se
  // juntan en un bloque "visita" (colapsable); los que no tienen visita (alta de
  // PDV, notas) quedan como bloques sueltos. Todo ordenado cronológicamente
  // ascendente (mañana → noche); los días, del más reciente al más viejo.
  const groupedByDay = useMemo(() => {
    const days: Record<string, TimelineEvent[]> = {};
    for (const ev of filteredEvents) {
      const dateKey = ev.ts ? new Date(ev.ts).toLocaleDateString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" }) : "sin-fecha";
      (days[dateKey] ||= []).push(ev);
    }
    const result: Array<[string, DayBlock[]]> = [];
    for (const [dateKey, evs] of Object.entries(days)) {
      evs.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
      const visitMap = new Map<number, TimelineEvent[]>();
      const blocks: DayBlock[] = [];
      for (const ev of evs) {
        if (ev.visitId != null) {
          if (!visitMap.has(ev.visitId)) visitMap.set(ev.visitId, []);
          visitMap.get(ev.visitId)!.push(ev);
        } else {
          blocks.push({ kind: "loose", key: `${dateKey}-loose-${ev.type}-${ev.ts}-${ev.pdvId ?? ""}`, anchorTs: ev.ts || "", event: ev });
        }
      }
      for (const [visitId, vEvents] of visitMap.entries()) {
        const open = vEvents.find((e) => e.type === "visit_open");
        const close = vEvents.find((e) => e.type === "visit_close");
        const named = vEvents.find((e) => e.pdvName);
        blocks.push({
          kind: "visit",
          key: `${dateKey}-visit-${visitId}`,
          visitId,
          pdvName: named?.pdvName || `Visita #${visitId}`,
          anchorTs: vEvents[0]?.ts || "",
          openTs: open?.ts || null,
          closeTs: close?.ts || null,
          events: vEvents,
        });
      }
      blocks.sort((a, b) => (a.anchorTs || "").localeCompare(b.anchorTs || ""));
      result.push([dateKey, blocks]);
    }
    result.sort((a, b) => b[0].localeCompare(a[0]));
    return result;
  }, [filteredEvents]);

  const eventTypes = useMemo(() => {
    if (!data) return [];
    const types = new Set(data.events.map(e => e.type));
    return Array.from(types).sort();
  }, [data]);

  const renderEventRow = (ev: TimelineEvent, key: string) => (
    <div key={key} className="relative">
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
            {ev.ts ? hhmm(ev.ts) : ""}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4 pb-8">
      <div>
        <h1 className="text-xl font-bold">Auditoría de Usuario</h1>
        <p className="text-sm text-muted-foreground">Elegí el rango y mirá qué trades se movieron</p>
      </div>

      {/* Paso 1: rango de fechas */}
      <Card>
        <CardContent className="p-4 space-y-3">
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
          <Button onClick={loadActiveUsers} disabled={loadingUsers} className="w-full h-9 bg-[#A48242] hover:bg-[#8a6d35]">
            {loadingUsers ? "Buscando..." : "Ver trades con movimiento"}
          </Button>
        </CardContent>
      </Card>

      {/* Paso 2: lista de trades con movimiento (cuando no hay timeline abierto) */}
      {!data && searched && (
        <div className="space-y-2">
          {activeUsers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <User size={40} className="mx-auto mb-2 opacity-50" />
              <p className="font-medium">Sin movimiento</p>
              <p className="text-sm">Ningún trade registró actividad en el rango seleccionado</p>
            </div>
          ) : (
            <>
              <p className="text-xs font-semibold text-muted-foreground px-1">
                {activeUsers.length} trade{activeUsers.length === 1 ? "" : "s"} con movimiento
              </p>
              {activeUsers.map((u) => (
                <button
                  key={u.UserId}
                  onClick={() => loadTimeline(u.UserId)}
                  disabled={loading}
                  className="w-full text-left"
                >
                  <Card className="hover:bg-muted/40 transition-colors">
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[#A48242] flex items-center justify-center text-white font-bold text-lg shrink-0">
                        {u.DisplayName.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold truncate">{u.DisplayName}</p>
                        <p className="text-xs text-muted-foreground truncate">{u.Email}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg font-bold text-[#A48242]">{u.count}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {u.lastTs ? formatTs(u.lastTs) : "movs"}
                        </p>
                      </div>
                      <ChevronDown size={16} className="-rotate-90 text-muted-foreground shrink-0" />
                    </CardContent>
                  </Card>
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* Results */}
      {data && (
        <>
          {/* Volver a la lista de trades */}
          <button
            onClick={() => { setData(null); setSelectedUserId(null); }}
            className="text-sm text-[#A48242] font-semibold flex items-center gap-1 hover:underline"
          >
            <ChevronDown size={16} className="rotate-90" /> Volver a trades
          </button>

          {/* User info + stats */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#A48242] flex items-center justify-center text-white font-bold text-lg">
                  {data.user.DisplayName.charAt(0)}
                </div>
                <div>
                  <p className="font-bold">{data.user.DisplayName}</p>
                  <p className="text-xs text-muted-foreground">{data.user.Email}</p>
                </div>
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

          {/* Timeline — día → visita (colapsable) → pasos; sueltos intercalados */}
          <div className="space-y-5">
            {groupedByDay.map(([dateKey, blocks]) => {
              const dayCount = blocks.reduce((n, b) => n + (b.kind === "visit" ? b.events.length : 1), 0);
              return (
              <div key={dateKey}>
                <div className="flex items-center gap-2 mb-2">
                  <Calendar size={14} className="text-[#A48242]" />
                  <p className="text-xs font-bold text-[#A48242] uppercase">
                    {dateKey !== "sin-fecha" ? formatDate(dateKey) : "Sin fecha"}
                  </p>
                  <Badge variant="outline" className="text-[10px]">{dayCount}</Badge>
                </div>

                <div className="relative ml-3 border-l-2 border-border pl-4 space-y-2">
                  {blocks.map((b) => {
                    if (b.kind === "loose") return renderEventRow(b.event, b.key);
                    const expanded = expandedVisits.has(b.key);
                    const openT = b.openTs ? hhmm(b.openTs) : null;
                    const closeT = b.closeTs ? hhmm(b.closeTs) : null;
                    return (
                      <div key={b.key} className="relative">
                        <div className="absolute -left-[21px] top-3.5 w-3 h-3 rounded-full border-2 border-background bg-blue-500" />
                        <button
                          onClick={() => toggleVisit(b.key)}
                          className="w-full text-left bg-card border border-border rounded-lg p-3 hover:bg-muted/40 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <ChevronDown size={16} className={`shrink-0 text-muted-foreground transition-transform ${expanded ? "" : "-rotate-90"}`} />
                            <MapPin size={14} className="text-[#A48242] shrink-0" />
                            <span className="text-sm font-semibold truncate flex-1">{b.pdvName}</span>
                            <Badge variant="outline" className="text-[9px] shrink-0">{b.events.length} pasos</Badge>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {openT || "?"}{closeT ? ` → ${closeT}` : " · abierta"}
                            </span>
                          </div>
                        </button>
                        {expanded && (
                          <div className="mt-2 ml-2 border-l-2 border-border/60 pl-4 space-y-2">
                            {b.events.map((ev, i) => renderEventRow(ev, `${b.key}-${i}`))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              );
            })}

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
