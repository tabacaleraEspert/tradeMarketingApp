import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend, Cell } from "recharts";
import type { ProductionOrder } from "../data/mockData";
import { getProductionByBrand } from "../data/mockData";
import { BarChart3 } from "lucide-react";

interface ProductionChartProps {
  orders: ProductionOrder[];
}

export function ProductionChart({ orders }: ProductionChartProps) {
  const data = getProductionByBrand(orders);

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2">
        <BarChart3 size={18} className="text-[#A48242]" />
        <h3 className="text-base font-bold">Producción vs Plan por Marca</h3>
      </div>

      {/* Chart */}
      <div className="flex-1 p-4 min-h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={4} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis
              dataKey="brand"
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
            <Bar dataKey="planned" name="Plan" radius={[4, 4, 0, 0]} maxBarSize={40}>
              {data.map((_, i) => (
                <Cell key={i} fill="rgba(255,255,255,0.15)" />
              ))}
            </Bar>
            <Bar dataKey="produced" name="Producido" radius={[4, 4, 0, 0]} maxBarSize={40}>
              {data.map((entry, i) => {
                const pct = entry.planned > 0 ? entry.produced / entry.planned : 0;
                const color = pct >= 0.95 ? "#22c55e" : pct >= 0.8 ? "#f59e0b" : "#ef4444";
                return <Cell key={i} fill={color} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
