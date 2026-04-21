import { useState, useEffect, useMemo } from "react";
import { X, Calendar, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { Button } from "./ui/button";
import { api } from "@/lib/api/client";
import { getCurrentUser } from "../lib/auth";

interface DateSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
}

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const DAYS_FULL = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const MONTHS_LOWER = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function DateSelector({ isOpen, onClose, selectedDate, onDateSelect }: DateSelectorProps) {
  const today = useMemo(() => new Date(), []);
  const [viewMonth, setViewMonth] = useState(selectedDate.getMonth());
  const [viewYear, setViewYear] = useState(selectedDate.getFullYear());
  const [routeDays, setRouteDays] = useState<Set<string>>(new Set());

  const currentUser = getCurrentUser();

  // Load route days for the visible month
  useEffect(() => {
    if (!isOpen) return;
    // Fetch route days to show which days have routes
    const userId = Number(currentUser.id) || undefined;
    if (!userId) return;

    api.get<any[]>("/routes").then((routes) => {
      // Get all route days
      const promises = routes.map((r: any) =>
        api.get<any[]>(`/routes/${r.RouteId}/days`).catch(() => [])
      );
      Promise.all(promises).then((allDays) => {
        const daySet = new Set<string>();
        allDays.flat().forEach((rd: any) => {
          if (rd.AssignedUserId === userId || !userId) {
            daySet.add(rd.WorkDate); // "2026-04-09"
          }
        });
        setRouteDays(daySet);
      });
    }).catch(() => {});
  }, [isOpen, viewMonth, viewYear, currentUser.id]);

  // Reset view to selected date when opening
  useEffect(() => {
    if (isOpen) {
      setViewMonth(selectedDate.getMonth());
      setViewYear(selectedDate.getFullYear());
    }
  }, [isOpen, selectedDate]);

  if (!isOpen) return null;

  // Calendar grid
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();

  const cells: { day: number; month: number; year: number; current: boolean }[] = [];

  // Previous month fill
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const m = viewMonth === 0 ? 11 : viewMonth - 1;
    const y = viewMonth === 0 ? viewYear - 1 : viewYear;
    cells.push({ day: d, month: m, year: y, current: false });
  }
  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, month: viewMonth, year: viewYear, current: true });
  }
  // Next month fill
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    const m = viewMonth === 11 ? 0 : viewMonth + 1;
    const y = viewMonth === 11 ? viewYear + 1 : viewYear;
    cells.push({ day: d, month: m, year: y, current: false });
  }

  const isToday = (d: number, m: number, y: number) =>
    d === today.getDate() && m === today.getMonth() && y === today.getFullYear();

  const isSelected = (d: number, m: number, y: number) =>
    d === selectedDate.getDate() && m === selectedDate.getMonth() && y === selectedDate.getFullYear();

  const hasRoute = (d: number, m: number, y: number) => {
    const key = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return routeDays.has(key);
  };

  const handleSelect = (d: number, m: number, y: number) => {
    onDateSelect(new Date(y, m, d));
    onClose();
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };

  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const goToday = () => {
    setViewMonth(today.getMonth());
    setViewYear(today.getFullYear());
    onDateSelect(new Date(today));
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      <div className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-2xl animate-slide-up max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Calendar size={18} className="text-[#A48242]" />
            <h3 className="text-base font-bold text-foreground">Calendario</h3>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={goToday} className="text-xs font-medium text-[#A48242] px-2 py-1 rounded hover:bg-[#A48242]/10">
              Hoy
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Month navigation */}
        <div className="flex items-center justify-between px-4 py-2.5 shrink-0">
          <button onClick={prevMonth} className="p-1.5 hover:bg-muted rounded-lg">
            <ChevronLeft size={20} />
          </button>
          <p className="text-sm font-bold text-foreground">
            {MONTHS[viewMonth]} {viewYear}
          </p>
          <button onClick={nextMonth} className="p-1.5 hover:bg-muted rounded-lg">
            <ChevronRight size={20} />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 px-3 shrink-0">
          {DAYS.map((d) => (
            <div key={d} className="text-center text-[10px] font-semibold text-muted-foreground py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 px-3 pb-3 shrink-0">
          {cells.map((cell, i) => {
            const todayCell = isToday(cell.day, cell.month, cell.year);
            const selected = isSelected(cell.day, cell.month, cell.year);
            const route = cell.current && hasRoute(cell.day, cell.month, cell.year);

            const cellDate = new Date(cell.year, cell.month, cell.day);
            const dayLabel = `${DAYS_FULL[cellDate.getDay()]} ${cell.day} de ${MONTHS_LOWER[cell.month]}`;

            return (
              <button
                key={i}
                onClick={() => handleSelect(cell.day, cell.month, cell.year)}
                aria-label={dayLabel}
                className={`relative flex flex-col items-center justify-center h-11 rounded-lg text-sm transition-colors ${
                  selected
                    ? "bg-[#A48242] text-white font-bold"
                    : todayCell
                    ? "bg-[#A48242]/10 text-[#A48242] font-bold"
                    : cell.current
                    ? "text-foreground hover:bg-muted"
                    : "text-muted-foreground/40"
                }`}
              >
                {cell.day}
                {/* Route indicator dot */}
                {route && (
                  <span className={`absolute bottom-1 w-1 h-1 rounded-full ${
                    selected ? "bg-white" : "bg-[#A48242]"
                  }`} />
                )}
              </button>
            );
          })}
        </div>

        {/* Selected date info */}
        <div className="px-4 py-3 border-t border-border bg-muted/30 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Seleccionado</p>
              <p className="text-sm font-bold text-foreground">
                {DAYS[selectedDate.getDay()]} {selectedDate.getDate()} {MONTHS[selectedDate.getMonth()]}
              </p>
            </div>
            {hasRoute(selectedDate.getDate(), selectedDate.getMonth(), selectedDate.getFullYear()) && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#A48242]/10 rounded-lg">
                <MapPin size={12} className="text-[#A48242]" />
                <span className="text-xs font-medium text-[#A48242]">Ruta asignada</span>
              </div>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="px-4 py-2 border-t border-border flex items-center justify-center gap-4 text-[10px] text-muted-foreground shrink-0">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#A48242]" />
            Con ruta
          </span>
          <span className="flex items-center gap-1">
            <span className="w-4 h-4 rounded bg-[#A48242]/10 text-[#A48242] text-[8px] font-bold flex items-center justify-center">9</span>
            Hoy
          </span>
          <span className="flex items-center gap-1">
            <span className="w-4 h-4 rounded bg-[#A48242] text-white text-[8px] font-bold flex items-center justify-center">9</span>
            Seleccionado
          </span>
        </div>
      </div>

      <style>{`
        @keyframes slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
      `}</style>
    </>
  );
}
