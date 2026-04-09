import type { PlantAlert } from "../data/mockData";
import { AlertTriangle, XCircle, Info, Bell, CheckCircle2 } from "lucide-react";

interface AlertsPanelProps {
  alerts: PlantAlert[];
  onAcknowledge: (id: number) => void;
}

const severityConfig = {
  critical: {
    icon: XCircle,
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    iconColor: "text-red-400",
    pulse: "animate-pulse",
  },
  warning: {
    icon: AlertTriangle,
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    iconColor: "text-amber-400",
    pulse: "",
  },
  info: {
    icon: Info,
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    iconColor: "text-blue-400",
    pulse: "",
  },
};

const typeLabels: Record<PlantAlert["type"], string> = {
  "line-stop": "Parada Línea",
  "low-stock": "Stock Bajo",
  delay: "Retraso",
  "brand-change": "Cambio Marca",
  quality: "Calidad",
};

export function AlertsPanel({ alerts, onAcknowledge }: AlertsPanelProps) {
  const unacknowledged = alerts.filter(a => !a.acknowledged);
  const acknowledged = alerts.filter(a => a.acknowledged);

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell size={18} className="text-[#A48242]" />
          <h3 className="text-base font-bold">Alarmas y Alertas</h3>
        </div>
        {unacknowledged.length > 0 && (
          <span className="flex items-center gap-1.5 text-xs bg-red-500/20 text-red-400 px-3 py-1.5 rounded-lg animate-pulse font-bold">
            {unacknowledged.length} sin atender
          </span>
        )}
      </div>

      {/* Alert list */}
      <div className="max-h-[300px] overflow-auto">
        {unacknowledged.map(alert => {
          const cfg = severityConfig[alert.severity];
          const Icon = cfg.icon;
          const time = new Date(alert.timestamp).toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit",
          });

          return (
            <div
              key={alert.id}
              className={`px-5 py-3 border-b border-white/5 flex items-start gap-3 ${cfg.bg} ${cfg.pulse}`}
            >
              <Icon size={20} className={`${cfg.iconColor} shrink-0 mt-0.5`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-[10px] font-semibold uppercase ${cfg.iconColor}`}>
                    {typeLabels[alert.type]}
                  </span>
                  {alert.line && (
                    <span className="text-[10px] text-white/30">L{alert.line}</span>
                  )}
                  <span className="text-[10px] text-white/30 ml-auto">{time}</span>
                </div>
                <p className="text-sm text-white/80">{alert.message}</p>
              </div>
              <button
                onClick={() => onAcknowledge(alert.id)}
                className="shrink-0 px-3 py-2 rounded-lg bg-white/10 active:bg-white/20 text-xs font-medium text-white/60 transition-colors min-w-[80px]"
              >
                Acusar
              </button>
            </div>
          );
        })}

        {acknowledged.length > 0 && (
          <>
            <div className="px-5 py-2 text-[10px] font-semibold text-white/20 uppercase tracking-wider bg-white/[0.02]">
              Atendidas
            </div>
            {acknowledged.map(alert => {
              const cfg = severityConfig[alert.severity];
              const Icon = cfg.icon;
              const time = new Date(alert.timestamp).toLocaleTimeString("es-AR", {
                hour: "2-digit",
                minute: "2-digit",
              });

              return (
                <div
                  key={alert.id}
                  className="px-5 py-2.5 border-b border-white/5 flex items-start gap-3 opacity-40"
                >
                  <CheckCircle2 size={16} className="text-green-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] font-semibold uppercase text-white/40">
                        {typeLabels[alert.type]}
                      </span>
                      <span className="text-[10px] text-white/20 ml-auto">{time}</span>
                    </div>
                    <p className="text-xs text-white/50 line-through">{alert.message}</p>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {alerts.length === 0 && (
          <div className="px-5 py-8 text-center text-white/20">
            <CheckCircle2 size={32} className="mx-auto mb-2 text-green-500/30" />
            <p className="text-sm">Sin alertas activas</p>
          </div>
        )}
      </div>
    </div>
  );
}
