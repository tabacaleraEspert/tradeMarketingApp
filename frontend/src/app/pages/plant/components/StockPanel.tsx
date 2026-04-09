import { useState } from "react";
import type { Supply } from "../data/mockData";
import { Package, AlertTriangle } from "lucide-react";

interface StockPanelProps {
  supplies: Supply[];
}

const categoryLabels: Record<Supply["category"], string> = {
  tabaco: "Tabaco",
  filtros: "Filtros",
  papel: "Papel",
  packaging: "Packaging",
  otros: "Otros",
};

const statusColor = {
  ok: { bar: "bg-green-500", text: "text-green-400", dot: "bg-green-500" },
  warning: { bar: "bg-amber-400", text: "text-amber-400", dot: "bg-amber-400" },
  critical: { bar: "bg-red-500", text: "text-red-400", dot: "bg-red-500 animate-pulse" },
};

export function StockPanel({ supplies }: StockPanelProps) {
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const categories = [...new Set(supplies.map(s => s.category))];
  const filtered = categoryFilter === "all" ? supplies : supplies.filter(s => s.category === categoryFilter);

  const criticalCount = supplies.filter(s => s.status === "critical").length;
  const warningCount = supplies.filter(s => s.status === "warning").length;

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package size={18} className="text-[#A48242]" />
          <h3 className="text-base font-bold">Stock Insumos</h3>
        </div>
        <div className="flex items-center gap-2">
          {criticalCount > 0 && (
            <span className="flex items-center gap-1 text-xs bg-red-500/20 text-red-400 px-2 py-1 rounded-lg animate-pulse">
              <AlertTriangle size={12} />
              {criticalCount} crítico{criticalCount > 1 ? "s" : ""}
            </span>
          )}
          {warningCount > 0 && (
            <span className="flex items-center gap-1 text-xs bg-amber-500/20 text-amber-400 px-2 py-1 rounded-lg">
              {warningCount} bajo{warningCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Category filter */}
      <div className="px-5 py-2 flex gap-1.5 border-b border-white/5 overflow-x-auto">
        <button
          onClick={() => setCategoryFilter("all")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-colors ${
            categoryFilter === "all" ? "bg-[#A48242] text-white" : "bg-white/5 text-white/50 active:bg-white/10"
          }`}
        >
          Todos
        </button>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-colors ${
              categoryFilter === cat ? "bg-[#A48242] text-white" : "bg-white/5 text-white/50 active:bg-white/10"
            }`}
          >
            {categoryLabels[cat]}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        {filtered
          .sort((a, b) => a.daysRemaining - b.daysRemaining)
          .map(supply => {
            const sc = statusColor[supply.status];
            const pct = Math.min((supply.daysRemaining / Math.max(supply.minDays * 2, 1)) * 100, 100);

            return (
              <div
                key={supply.id}
                className="px-5 py-3 border-b border-white/5 flex items-center gap-4"
              >
                {/* Semaphore dot */}
                <div className={`w-3 h-3 rounded-full shrink-0 ${sc.dot}`} />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium truncate">{supply.name}</p>
                    <span className={`text-xs font-mono font-bold ${sc.text}`}>
                      {supply.daysRemaining.toFixed(1)}d
                    </span>
                  </div>
                  {/* Stock bar */}
                  <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${sc.bar} transition-all duration-500`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-white/30">
                      {supply.currentStock.toLocaleString()} {supply.unit}
                    </span>
                    <span className="text-[10px] text-white/30">
                      {supply.dailyConsumption.toLocaleString()}/{supply.unit === "unid" ? "día" : `${supply.unit}/día`}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
