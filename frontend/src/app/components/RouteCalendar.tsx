import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { routesApi } from "@/lib/api";
import type { Route } from "@/lib/api/types";

const ROUTE_COLORS = ["#A48242", "#2E86AB", "#22c55e", "#f59e0b", "#dc2626", "#8b5cf6", "#ec4899"];
const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

interface RouteDay {
  RouteDayId: number;
  RouteId: number;
  WorkDate: string;
  AssignedUserId: number;
  Status: string;
}

interface DayCell {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  routes: Array<{ routeId: number; routeName: string; color: string; status: string; pdvCount?: number }>;
}

interface Props {
  userId?: number;
  routes?: Route[];
  compact?: boolean;
}

export function RouteCalendar({ userId, routes: propRoutes, compact = false }: Props) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [allRoutes, setAllRoutes] = useState<Route[]>([]);
  const [allDays, setAllDays] = useState<RouteDay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const fetchData = async () => {
      const routes = propRoutes || await routesApi.list();
      const relevantRoutes = userId
        ? routes.filter((r) => r.AssignedUserId === userId)
        : routes;
      setAllRoutes(relevantRoutes);

      const days: RouteDay[] = [];
      for (const r of relevantRoutes) {
        try {
          const rd = await routesApi.listDays(r.RouteId);
          days.push(...rd);
        } catch { /* skip */ }
      }
      setAllDays(days);
      setLoading(false);
    };
    fetchData();
  }, [userId, currentMonth.getMonth()]);

  const routeColorMap = useMemo(() => {
    const map: Record<number, string> = {};
    allRoutes.forEach((r, i) => {
      map[r.RouteId] = ROUTE_COLORS[i % ROUTE_COLORS.length];
    });
    return map;
  }, [allRoutes]);

  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const cells: DayCell[] = [];

    // Pad start
    const startPad = firstDay.getDay();
    for (let i = startPad - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      cells.push({ date: d, isCurrentMonth: false, isToday: false, routes: [] });
    }

    // Days of month
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const d = new Date(year, month, day);
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dayRoutes = allDays
        .filter((rd) => rd.WorkDate.startsWith(dateStr))
        .map((rd) => {
          const route = allRoutes.find((r) => r.RouteId === rd.RouteId);
          return {
            routeId: rd.RouteId,
            routeName: route?.Name || `Ruta ${rd.RouteId}`,
            color: routeColorMap[rd.RouteId] || "#888",
            status: rd.Status,
          };
        });

      cells.push({
        date: d,
        isCurrentMonth: true,
        isToday: d.getTime() === today.getTime(),
        routes: dayRoutes,
      });
    }

    // Pad end to complete 6 rows
    const remaining = 42 - cells.length;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i);
      cells.push({ date: d, isCurrentMonth: false, isToday: false, routes: [] });
    }

    return cells;
  }, [currentMonth, allDays, allRoutes, routeColorMap]);

  const monthLabel = currentMonth.toLocaleDateString("es-AR", {
    month: "long",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  });

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4 text-center text-muted-foreground text-sm">
          Cargando calendario...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
            className="p-1.5 hover:bg-muted rounded-lg transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <h3 className="font-semibold text-foreground capitalize">{monthLabel}</h3>
          <button
            onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
            className="p-1.5 hover:bg-muted rounded-lg transition-colors"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 gap-px mb-1">
          {DAY_NAMES.map((d) => (
            <div key={d} className="text-center text-[10px] font-semibold text-muted-foreground py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-px">
          {calendarDays.map((cell, i) => (
            <div
              key={i}
              className={`min-h-[${compact ? "36px" : "48px"}] p-0.5 rounded transition-colors ${
                cell.isToday ? "bg-[#A48242]/10 ring-1 ring-[#A48242]" : ""
              } ${!cell.isCurrentMonth ? "opacity-30" : ""}`}
            >
              <div className={`text-[10px] text-center ${cell.isToday ? "font-bold text-[#A48242]" : "text-muted-foreground"}`}>
                {cell.date.getDate()}
              </div>
              <div className="flex flex-wrap justify-center gap-0.5 mt-0.5">
                {cell.routes.map((r, j) => (
                  <div
                    key={j}
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: r.color }}
                    title={r.routeName}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        {allRoutes.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-border">
            {allRoutes.map((r) => (
              <div key={r.RouteId} className="flex items-center gap-1.5">
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: routeColorMap[r.RouteId] }}
                />
                <span className="text-[10px] text-muted-foreground">{r.Name}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
