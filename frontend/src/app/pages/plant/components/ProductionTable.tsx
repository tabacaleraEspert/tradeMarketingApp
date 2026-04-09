import { useState } from "react";
import type { ProductionOrder, SemaphoreColor } from "../data/mockData";
import { getSemaphoreColor } from "../data/mockData";
import { Clock, CheckCircle2, AlertTriangle, Pause, ChevronDown, ChevronUp } from "lucide-react";

interface ProductionTableProps {
  orders: ProductionOrder[];
}

const statusConfig: Record<ProductionOrder["status"], { label: string; icon: typeof Clock; textColor: string }> = {
  completed: { label: "Completo", icon: CheckCircle2, textColor: "text-green-400" },
  "in-progress": { label: "En curso", icon: Clock, textColor: "text-blue-400" },
  pending: { label: "Pendiente", icon: Pause, textColor: "text-white/40" },
  delayed: { label: "Retrasado", icon: AlertTriangle, textColor: "text-red-400" },
};

const semaphoreBarColor: Record<SemaphoreColor, string> = {
  green: "bg-green-500",
  yellow: "bg-amber-400",
  red: "bg-red-500",
};

const semaphoreDot: Record<SemaphoreColor, string> = {
  green: "bg-green-500",
  yellow: "bg-amber-400",
  red: "bg-red-500 animate-pulse",
};

export function ProductionTable({ orders }: ProductionTableProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [brandFilter, setBrandFilter] = useState<string>("all");

  const brands = [...new Set(orders.map(o => o.brand))];
  const filtered = brandFilter === "all" ? orders : orders.filter(o => o.brand === brandFilter);

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
        <h3 className="text-base font-bold">Plan de Producción - Hoy</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setBrandFilter("all")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              brandFilter === "all" ? "bg-[#A48242] text-white" : "bg-white/5 text-white/60 active:bg-white/10"
            }`}
          >
            Todas
          </button>
          {brands.map(b => (
            <button
              key={b}
              onClick={() => setBrandFilter(b)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                brandFilter === b ? "bg-[#A48242] text-white" : "bg-white/5 text-white/60 active:bg-white/10"
              }`}
            >
              {b}
            </button>
          ))}
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr_100px_80px_40px] px-5 py-2 text-xs font-semibold text-white/40 uppercase tracking-wider border-b border-white/5">
        <span>Producto</span>
        <span className="text-right">Plan</span>
        <span className="text-right">Producido</span>
        <span className="text-right">Avance</span>
        <span className="text-center">Estado</span>
        <span className="text-center">ETA</span>
        <span />
      </div>

      {/* Rows */}
      {filtered.map(order => {
        const pct = order.plannedQty > 0 ? Math.round((order.producedQty / order.plannedQty) * 100) : 0;
        const semaphore = order.status === "pending"
          ? "yellow" as SemaphoreColor
          : getSemaphoreColor(pct, { green: 95, yellow: 80 });
        const cfg = statusConfig[order.status];
        const StatusIcon = cfg.icon;
        const isExpanded = expandedId === order.id;

        return (
          <div key={order.id}>
            <button
              onClick={() => setExpandedId(isExpanded ? null : order.id)}
              className="w-full grid grid-cols-[2fr_1fr_1fr_1fr_100px_80px_40px] px-5 py-3 items-center text-sm border-b border-white/5 active:bg-white/5 transition-colors text-left"
            >
              {/* Product */}
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${semaphoreDot[semaphore]}`} />
                <div>
                  <p className="font-medium">{order.product}</p>
                  <p className="text-xs text-white/40">Línea {order.line}</p>
                </div>
              </div>

              {/* Plan */}
              <p className="text-right font-mono">{order.plannedQty.toLocaleString()}</p>

              {/* Produced */}
              <p className="text-right font-mono">{order.producedQty.toLocaleString()}</p>

              {/* Progress */}
              <div className="flex flex-col items-end gap-1">
                <span className="font-mono font-bold">{pct}%</span>
                <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${semaphoreBarColor[semaphore]} transition-all duration-500`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </div>

              {/* Status */}
              <div className={`flex items-center justify-center gap-1.5 ${cfg.textColor}`}>
                <StatusIcon size={14} />
                <span className="text-xs font-medium">{cfg.label}</span>
              </div>

              {/* ETA */}
              <p className="text-center text-xs font-mono text-white/60">
                {order.status === "completed" ? "✓" : order.estimatedEnd}
              </p>

              {/* Expand */}
              <div className="flex justify-center text-white/30">
                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
            </button>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="px-5 py-3 bg-white/[0.02] border-b border-white/5 grid grid-cols-4 gap-4 text-xs text-white/50">
                <div>
                  <span className="text-white/30 uppercase">Marca</span>
                  <p className="text-white/80 font-medium mt-0.5">{order.brand}</p>
                </div>
                <div>
                  <span className="text-white/30 uppercase">Inicio</span>
                  <p className="text-white/80 font-medium mt-0.5">{order.startTime}</p>
                </div>
                <div>
                  <span className="text-white/30 uppercase">Unidad</span>
                  <p className="text-white/80 font-medium mt-0.5">{order.unit}</p>
                </div>
                <div>
                  <span className="text-white/30 uppercase">Diferencia</span>
                  <p className={`font-medium mt-0.5 ${order.producedQty >= order.plannedQty ? "text-green-400" : "text-red-400"}`}>
                    {order.producedQty - order.plannedQty > 0 ? "+" : ""}
                    {(order.producedQty - order.plannedQty).toLocaleString()} {order.unit}
                  </p>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
