import type { WeeklyProductionSummary } from "../data/mockData";
import { getSemaphoreColor, getStopsSemaphore } from "../data/mockData";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend } from "recharts";
import { CalendarDays } from "lucide-react";

interface MonthlyViewProps {
  data: WeeklyProductionSummary[];
}

const semaphoreBg: Record<string, string> = {
  green: "bg-green-500/10 text-green-400",
  yellow: "bg-amber-500/10 text-amber-400",
  red: "bg-red-500/10 text-red-400",
};

export function MonthlyView({ data }: MonthlyViewProps) {
  const activeWeeks = data.filter(w => w.produced > 0);
  const totalPlanned = activeWeeks.reduce((s, w) => s + w.planned, 0);
  const totalProduced = activeWeeks.reduce((s, w) => s + w.produced, 0);
  const avgEfficiency = totalPlanned > 0 ? Math.round((totalProduced / totalPlanned) * 100) : 0;
  const totalStops = activeWeeks.reduce((s, w) => s + w.lineStops, 0);
  const monthPlanned = data.reduce((s, w) => s + w.planned, 0);

  // Cumulative data for the line chart
  const cumulativeData = data.map((w, i) => {
    const cumPlanned = data.slice(0, i + 1).reduce((s, x) => s + x.planned, 0);
    const cumProduced = data.slice(0, i + 1).reduce((s, x) => s + x.produced, 0);
    return {
      label: `Sem ${w.weekNumber}`,
      planned: cumPlanned,
      produced: cumProduced,
    };
  });

  return (
    <div className="space-y-4">
      {/* Monthly KPIs */}
      <div className="grid grid-cols-5 gap-4">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
          <p className="text-3xl font-black">{totalProduced.toLocaleString()}</p>
          <p className="text-xs text-white/40 mt-1">Producido (Mes)</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
          <p className="text-3xl font-black">{monthPlanned.toLocaleString()}</p>
          <p className="text-xs text-white/40 mt-1">Plan Mensual</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
          <p className="text-3xl font-black">{avgEfficiency}%</p>
          <p className="text-xs text-white/40 mt-1">Cumplimiento</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
          <p className="text-3xl font-black">{totalStops}</p>
          <p className="text-xs text-white/40 mt-1">Paradas Totales</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
          <p className="text-3xl font-black">{(monthPlanned - totalProduced).toLocaleString()}</p>
          <p className="text-xs text-white/40 mt-1">Restante Mes</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Cumulative chart */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <CalendarDays size={18} className="text-[#A48242]" />
            <h3 className="text-base font-bold">Producción Acumulada</h3>
          </div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cumulativeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 12 }}
                  axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                  formatter={(value: string) => <span style={{ color: "rgba(255,255,255,0.6)" }}>{value}</span>}
                />
                <Line
                  type="monotone"
                  dataKey="planned"
                  name="Plan Acumulado"
                  stroke="rgba(255,255,255,0.3)"
                  strokeWidth={2}
                  strokeDasharray="8 4"
                  dot={{ r: 4, fill: "rgba(255,255,255,0.3)" }}
                />
                <Line
                  type="monotone"
                  dataKey="produced"
                  name="Producido Acumulado"
                  stroke="#A48242"
                  strokeWidth={3}
                  dot={{ r: 5, fill: "#A48242" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Weekly summary table */}
        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-white/10">
            <h3 className="text-base font-bold">Resumen Semanal</h3>
          </div>
          <div className="grid grid-cols-[1.5fr_1fr_1fr_70px_70px_70px] px-5 py-2 text-xs font-semibold text-white/30 uppercase border-b border-white/5">
            <span>Semana</span>
            <span className="text-right">Plan</span>
            <span className="text-right">Producido</span>
            <span className="text-right">Efic.</span>
            <span className="text-center">Paradas</span>
            <span className="text-center">Estado</span>
          </div>
          {data.map(week => {
            const effSemaphore = week.produced === 0
              ? "yellow"
              : getSemaphoreColor(week.efficiency, { green: 95, yellow: 80 });
            const stopsSemaphore = getStopsSemaphore(week.lineStops);
            const isCurrent = week.weekNumber === 15;

            return (
              <div
                key={week.weekNumber}
                className={`grid grid-cols-[1.5fr_1fr_1fr_70px_70px_70px] px-5 py-3 text-sm border-b border-white/5 items-center ${
                  isCurrent ? "bg-[#A48242]/10" : ""
                }`}
              >
                <span className={`text-xs font-medium ${isCurrent ? "text-[#A48242]" : "text-white/70"}`}>
                  {week.weekLabel}
                </span>
                <span className="text-right font-mono text-xs">{week.planned.toLocaleString()}</span>
                <span className="text-right font-mono text-xs">
                  {week.produced > 0 ? week.produced.toLocaleString() : "—"}
                </span>
                <span className="text-right font-mono text-xs font-bold">
                  {week.produced > 0 ? `${week.efficiency}%` : "—"}
                </span>
                <div className="flex justify-center">
                  {week.produced > 0 ? (
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-md ${semaphoreBg[stopsSemaphore]}`}>
                      {week.lineStops}
                    </span>
                  ) : (
                    <span className="text-[10px] text-white/20">—</span>
                  )}
                </div>
                <div className="flex justify-center">
                  {week.produced > 0 ? (
                    <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-md ${semaphoreBg[effSemaphore]}`}>
                      {effSemaphore === "green" ? "OK" : effSemaphore === "yellow" ? "Alerta" : "Bajo"}
                    </span>
                  ) : (
                    <span className="text-[10px] text-white/20">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
