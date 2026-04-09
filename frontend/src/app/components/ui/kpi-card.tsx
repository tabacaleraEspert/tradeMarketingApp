interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  color?: "blue" | "green" | "red" | "yellow" | "purple" | "slate";
}

export function KPICard({ title, value, subtitle, icon, trend, color = "blue" }: KPICardProps) {
  const colorClasses = {
    blue: "from-[#A48242] to-[#8B6E38]",
    green: "from-green-500 to-green-600",
    red: "from-red-500 to-red-600",
    yellow: "from-yellow-500 to-yellow-600",
    purple: "from-[#A48242] to-[#8B6E38]",
    slate: "from-[#53565A] to-[#3a3d40]",
  };

  return (
    <div className="bg-white rounded-lg border border-border shadow-sm hover:shadow-md transition-shadow overflow-hidden">
      <div className={`bg-gradient-to-r ${colorClasses[color]} p-4 text-white`}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium opacity-90">{title}</p>
          {icon && <div className="opacity-80">{icon}</div>}
        </div>
        <div className="flex items-end justify-between">
          <p className="text-3xl font-bold">{value}</p>
          {trend && (
            <div className={`flex items-center text-sm font-semibold ${trend.isPositive ? "text-green-100" : "text-red-100"}`}>
              <svg
                className={`w-4 h-4 ${trend.isPositive ? "" : "rotate-180"}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
              <span className="ml-1">{Math.abs(trend.value)}%</span>
            </div>
          )}
        </div>
      </div>
      {subtitle && (
        <div className="px-4 py-3 bg-muted border-t border-border">
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      )}
    </div>
  );
}
