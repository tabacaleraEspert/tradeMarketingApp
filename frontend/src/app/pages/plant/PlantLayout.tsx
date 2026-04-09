import { useState, useEffect } from "react";
import { Outlet } from "react-router";
import { Factory, RefreshCw } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { getCurrentShift } from "./data/mockData";

export function PlantLayout() {
  const [time, setTime] = useState(new Date());
  const shift = getCurrentShift();

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const dateStr = time.toLocaleDateString("es-AR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const timeStr = time.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">
      {/* Header */}
      <header className="bg-[#111] border-b border-white/10 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#A48242] flex items-center justify-center">
              <Factory size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight leading-none">Planta Producción</h1>
              <p className="text-xs text-white/40 leading-none mt-0.5">Monitor Líder de Turno</p>
            </div>
          </div>
          <div className="h-8 w-px bg-white/10 mx-2" />
          <Badge className={`${shift.color} border-0 text-sm px-3 py-1 font-semibold`}>
            Turno {shift.name}
          </Badge>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-2xl font-mono font-bold tracking-wider leading-none">{timeStr}</p>
            <p className="text-xs text-white/40 capitalize mt-0.5">{dateStr}</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="w-12 h-12 rounded-xl bg-white/5 hover:bg-white/10 active:bg-white/20 flex items-center justify-center transition-colors"
          >
            <RefreshCw size={20} className="text-white/60" />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto p-4">
        <Outlet />
      </main>
    </div>
  );
}
