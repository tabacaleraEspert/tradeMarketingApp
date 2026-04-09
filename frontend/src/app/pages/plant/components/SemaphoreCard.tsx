import type { ReactNode } from "react";
import type { SemaphoreColor } from "../data/mockData";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface SemaphoreCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: ReactNode;
  color: SemaphoreColor;
  trend?: "up" | "down" | "stable";
}

const colorMap: Record<SemaphoreColor, { bg: string; border: string; dot: string; glow: string }> = {
  green: {
    bg: "bg-green-950/40",
    border: "border-green-500/30",
    dot: "bg-green-500",
    glow: "",
  },
  yellow: {
    bg: "bg-amber-950/40",
    border: "border-amber-500/30",
    dot: "bg-amber-400",
    glow: "",
  },
  red: {
    bg: "bg-red-950/40",
    border: "border-red-500/40",
    dot: "bg-red-500",
    glow: "animate-pulse",
  },
};

export function SemaphoreCard({ title, value, subtitle, icon, color, trend }: SemaphoreCardProps) {
  const c = colorMap[color];

  return (
    <div className={`${c.bg} border ${c.border} rounded-2xl p-5 flex flex-col gap-3 relative overflow-hidden`}>
      {/* Semaphore dot */}
      <div className="flex items-center justify-between">
        <div className="text-white/60">{icon}</div>
        <div className={`w-4 h-4 rounded-full ${c.dot} ${c.glow} shadow-lg`} />
      </div>

      {/* Value */}
      <div>
        <p className="text-4xl font-black tracking-tight leading-none">{value}</p>
        {subtitle && <p className="text-sm text-white/50 mt-1">{subtitle}</p>}
      </div>

      {/* Title + trend */}
      <div className="flex items-center justify-between mt-auto">
        <p className="text-sm font-medium text-white/70">{title}</p>
        {trend && (
          <div className="text-white/40">
            {trend === "up" && <TrendingUp size={16} className="text-green-400" />}
            {trend === "down" && <TrendingDown size={16} className="text-red-400" />}
            {trend === "stable" && <Minus size={16} className="text-white/30" />}
          </div>
        )}
      </div>
    </div>
  );
}
