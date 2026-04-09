import type { DailyProduction } from "../data/mockData";
import { getSemaphoreColor } from "../data/mockData";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend, Cell } from "recharts";
import { TrendingUp } from "lucide-react";

interface WeeklyViewProps {
  data: DailyProduction[];
}

const semaphoreBg: Record<string, string> = {
  green: "bg-green-500/10 text-green-400",
  yellow: "bg-amber-500/10 text-amber-400",
  red: "bg-red-500/10 text-red-400",
};

export function WeeklyView({ data }: WeeklyViewProps) {
  const activeDays = data.filter(d => d.produced > 0);
  const totalPlanned = activeDays.reduce((s, d) => s + d.planned, 0);
  const totalProduced = activeDays.reduce((s, d) => s + d.produced, 0);
  const avgEfficiency = totalPlanned > 0 ? Math.round((totalProduced / totalPlanned) * 100) : 0;
  const weekPlanned = data.reduce((s, d) => s + d.planned, 0);

  return (
    <div className="space-y-4">
      {/* Weekly KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
          <p className="text-3xl font-black">{totalProduced.toLocaleString()}</p>
          <p className="text-xs text-white/40 mt-1">Producido (hasta hoy)</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
          <p className="text-3xl font-black">{weekPlanned.toLocaleString()}</p>
          <p className="text-xs text-white/40 mt-1">Plan Semanal Total</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
          <p className="text-3xl font-black">{avgEfficiency}%</p>
          <p className="text-xs text-white/40 mt-1">Eficiencia Promedio</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
          <p className="text-3xl font-black">{(weekPlanned - totalProduced).toLocaleString()}</p>
          <p className="text-xs text-white/40 mt-1">Restante Semana</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Chart */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={18} className="text-[#A48242]" />
            <h3 className="text-base font-bold">Producción Diaria</h3>
          </div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="dayLabel"
                  tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 13, fontWeight: 600 }}
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
                <Bar dataKey="planned" name="Plan" fill="rgba(255,255,255,0.12)" radius={[4, 4, 0, 0]} maxBarSize={36} />
                <Bar dataKey="produced" name="Producido" radius={[4, 4, 0, 0]} maxBarSize={36}>
                  {data.map((entry, i) => {
                    const pct = entry.planned > 0 ? entry.produced / entry.planned : 0;
                    const color = entry.produced === 0 ? "rgba(255,255,255,0.05)" : pct >= 0.95 ? "#22c55e" : pct >= 0.8 ? "#f59e0b" : "#ef4444";
                    return <Cell key={i} fill={color} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-white/10">
            <h3 className="text-base font-bold">Detalle Diario</h3>
          </div>
          {/* Headers */}
          <div className="grid grid-cols-[80px_1fr_1fr_80px_80px] px-5 py-2 text-xs font-semibold text-white/30 uppercase border-b border-white/5">
            <span>Día</span>
            <span className="text-right">Plan</span>
            <span className="text-right">Producido</span>
            <span className="text-right">Efic.</span>
            <span className="text-center">Estado</span>
          </div>
          {data.map(day => {
            const semaphore = day.produced === 0 && day.planned === 0
              ? "green"
              : day.produced === 0
                ? "yellow"
                : getSemaphoreColor(day.efficiency, { green: 95, yellow: 80 });
            const isToday = day.dayLabel === "Hoy";

            return (
              <div
                key={day.day}
                className={`grid grid-cols-[80px_1fr_1fr_80px_80px] px-5 py-3 text-sm border-b border-white/5 items-center ${
                  isToday ? "bg-[#A48242]/10" : ""
                }`}
              >
                <span className={`font-semibold ${isToday ? "text-[#A48242]" : "text-white/70"}`}>
                  {day.dayLabel}
                </span>
                <span className="text-right font-mono">{day.planned.toLocaleString()}</span>
                <span className="text-right font-mono">
                  {day.produced > 0 ? day.produced.toLocaleString() : "—"}
                </span>
                <span className="text-right font-mono font-bold">
                  {day.produced > 0 ? `${day.efficiency}%` : "—"}
                </span>
                <div className="flex justify-center">
                  {day.planned > 0 ? (
                    <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-md ${semaphoreBg[semaphore]}`}>
                      {day.produced === 0 ? "Pend." : semaphore === "green" ? "OK" : semaphore === "yellow" ? "Alerta" : "Bajo"}
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
