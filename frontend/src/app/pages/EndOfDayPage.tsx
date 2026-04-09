import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import {
  ArrowLeft,
  MapPin,
  Clock,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Calendar,
  Package,
  Megaphone,
  Repeat,
  Tag,
  ClipboardList,
} from "lucide-react";
import { visitsApi, routesApi, visitActionsApi } from "@/lib/api";
import type { Visit, VisitAction } from "@/lib/api";
import { useRouteDayPdvsForDate } from "@/lib/api/hooks";
import { getCurrentUser } from "../lib/auth";
import { toast } from "sonner";

export function EndOfDayPage() {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const today = new Date();

  const isAdmin = currentUser.role === "admin" || currentUser.role === "supervisor";
  const userIdFilter = isAdmin ? undefined : Number(currentUser.id);

  const { data: routeDayPdvs, loading } = useRouteDayPdvsForDate(today, userIdFilter);

  const [visits, setVisits] = useState<Visit[]>([]);
  const [allActions, setAllActions] = useState<VisitAction[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(true);

  useEffect(() => {
    const loadVisits = async () => {
      setLoadingDetails(true);
      try {
        const todayStr = today.toISOString().split("T")[0];
        const v = await visitsApi.list({ user_id: Number(currentUser.id) });
        const todayVisits = v.filter((vis) => vis.OpenedAt.startsWith(todayStr));
        setVisits(todayVisits);

        // Load actions for today's visits
        const actionPromises = todayVisits.map((vis) => visitActionsApi.list(vis.VisitId));
        const actionResults = await Promise.all(actionPromises);
        setAllActions(actionResults.flat());
      } catch {
        toast.error("Error al cargar datos");
      } finally {
        setLoadingDetails(false);
      }
    };
    loadVisits();
  }, [currentUser.id]);

  const planned = routeDayPdvs.length;
  const visited = visits.filter((v) => v.Status === "CLOSED" || v.Status === "COMPLETED").length;
  const openVisits = visits.filter((v) => v.Status === "OPEN").length;
  const compliance = planned > 0 ? Math.round((visited / planned) * 100) : 0;

  // Average visit duration
  const durations = visits
    .filter((v) => v.OpenedAt && v.ClosedAt)
    .map((v) => {
      const open = new Date(v.OpenedAt).getTime();
      const close = new Date(v.ClosedAt!).getTime();
      return (close - open) / 60000; // minutes
    });
  const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  // Actions by type
  const actionsByType: Record<string, number> = {};
  for (const a of allActions) {
    actionsByType[a.ActionType] = (actionsByType[a.ActionType] || 0) + 1;
  }

  const actionTypeLabels: Record<string, { label: string; icon: React.ElementType }> = {
    cobertura: { label: "Cobertura", icon: Package },
    pop: { label: "POP", icon: Megaphone },
    canje_sueltos: { label: "Canje Sueltos", icon: Repeat },
    promo: { label: "Promos", icon: Tag },
    otra: { label: "Otras", icon: ClipboardList },
  };

  // Pending items (open visits with reminders)
  const pendingItems = visits
    .filter((v) => v.CloseReason)
    .map((v) => ({ visitId: v.VisitId, pdvId: v.PdvId, reminder: v.CloseReason! }));

  if (loading || loadingDetails) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Cargando resumen del día...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#53565A] to-[#000000] text-white p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => navigate("/")} className="p-2 hover:bg-white/10 rounded-lg">
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold">Cierre de Jornada</h1>
            <div className="flex items-center gap-2 text-sm text-white/70">
              <Calendar size={14} />
              {today.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Main KPIs */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="bg-espert-gold/10 border-espert-gold">
            <CardContent className="p-4 text-center">
              <MapPin size={24} className="mx-auto text-espert-gold mb-1" />
              <p className="text-2xl font-bold text-foreground">{visited}/{planned}</p>
              <p className="text-xs text-espert-gold">PDVs Visitados</p>
            </CardContent>
          </Card>
          <Card className="bg-green-50 border-green-200">
            <CardContent className="p-4 text-center">
              <TrendingUp size={24} className="mx-auto text-green-600 mb-1" />
              <p className="text-2xl font-bold text-green-900">{compliance}%</p>
              <p className="text-xs text-green-600">Compliance</p>
            </CardContent>
          </Card>
          <Card className="bg-espert-gold/10 border-espert-gold">
            <CardContent className="p-4 text-center">
              <Clock size={24} className="mx-auto text-espert-gold mb-1" />
              <p className="text-2xl font-bold text-foreground">{avgDuration} min</p>
              <p className="text-xs text-espert-gold">Duración Promedio</p>
            </CardContent>
          </Card>
          <Card className="bg-orange-50 border-orange-200">
            <CardContent className="p-4 text-center">
              <Package size={24} className="mx-auto text-orange-600 mb-1" />
              <p className="text-2xl font-bold text-orange-900">{allActions.length}</p>
              <p className="text-xs text-orange-600">Acciones Ejecutadas</p>
            </CardContent>
          </Card>
        </div>

        {/* Compliance bar */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-foreground">Cumplimiento del Día</h3>
              <span className="text-sm font-medium text-espert-gold">{compliance}%</span>
            </div>
            <Progress value={compliance} className="h-3" />
            <div className="flex justify-between text-xs text-muted-foreground mt-2">
              <span>{visited} visitados</span>
              {openVisits > 0 && <span className="text-amber-600">{openVisits} en curso</span>}
              <span>{planned - visited - openVisits} pendientes</span>
            </div>
          </CardContent>
        </Card>

        {/* Actions by type */}
        {Object.keys(actionsByType).length > 0 && (
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold text-foreground mb-3">Acciones por Tipo</h3>
              <div className="space-y-2">
                {Object.entries(actionsByType).map(([type, count]) => {
                  const cfg = actionTypeLabels[type] || { label: type, icon: ClipboardList };
                  const Icon = cfg.icon;
                  return (
                    <div key={type} className="flex items-center justify-between p-2 rounded-lg bg-muted">
                      <div className="flex items-center gap-2">
                        <Icon size={16} className="text-muted-foreground" />
                        <span className="text-sm text-foreground">{cfg.label}</span>
                      </div>
                      <Badge variant="secondary">{count}</Badge>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Pending items */}
        {pendingItems.length > 0 && (
          <Card className="border-amber-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={18} className="text-amber-600" />
                <h3 className="font-semibold text-foreground">Pendientes Consolidados</h3>
              </div>
              <div className="space-y-2">
                {pendingItems.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2 p-2 rounded-lg bg-amber-50">
                    <CheckCircle2 size={14} className="text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-foreground">{item.reminder}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Status per PDV */}
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold text-foreground mb-3">Detalle por PDV</h3>
            <div className="space-y-2">
              {routeDayPdvs.map((rdp) => {
                const visit = visits.find((v) => v.PdvId === rdp.pdv.PdvId);
                const isClosed = visit?.Status === "CLOSED" || visit?.Status === "COMPLETED";
                const isOpen = visit?.Status === "OPEN";
                return (
                  <div key={rdp.pdv.PdvId} className="flex items-center justify-between p-2 rounded-lg border border-border">
                    <div className="flex items-center gap-2 min-w-0">
                      {isClosed ? (
                        <CheckCircle2 size={16} className="text-green-600 shrink-0" />
                      ) : isOpen ? (
                        <Clock size={16} className="text-amber-500 shrink-0" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-border shrink-0" />
                      )}
                      <span className="text-sm text-foreground truncate">{rdp.pdv.Name}</span>
                    </div>
                    <Badge variant={isClosed ? "secondary" : isOpen ? "default" : "outline"} className="text-xs shrink-0">
                      {isClosed ? "Cerrada" : isOpen ? "En curso" : "Pendiente"}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bottom bar */}
      <div className="sticky bottom-0 bg-card border-t border-border p-3">
        <Button className="w-full h-12 text-base font-semibold" onClick={() => navigate("/")}>
          Volver al Inicio
        </Button>
      </div>
    </div>
  );
}
