import { X, Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";

interface DateSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
}

export function DateSelector({ isOpen, onClose, selectedDate, onDateSelect }: DateSelectorProps) {
  if (!isOpen) return null;

  const today = new Date(2026, 1, 23); // Feb 23, 2026 (months are 0-indexed)
  
  // Generate dates for the week (7 days back and 7 days forward)
  const dates: Date[] = [];
  for (let i = -7; i <= 7; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    dates.push(date);
  }

  const formatDate = (date: Date) => {
    const days = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    
    return {
      dayName: days[date.getDay()],
      day: date.getDate(),
      month: months[date.getMonth()],
      year: date.getFullYear(),
      fullDate: `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`,
    };
  };

  const isToday = (date: Date) => {
    return date.toDateString() === today.toDateString();
  };

  const isSelected = (date: Date) => {
    return date.toDateString() === selectedDate.toDateString();
  };

  const handleDateSelect = (date: Date) => {
    onDateSelect(date);
    onClose();
  };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-2xl animate-slide-up max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <Calendar size={20} className="text-blue-600" />
            <h3 className="text-lg font-bold text-slate-900">Seleccionar Fecha</h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0"
          >
            <X size={20} />
          </Button>
        </div>

        {/* Current Selection */}
        <div className="p-4 bg-blue-50 border-b border-blue-100 shrink-0">
          <p className="text-sm text-slate-600 mb-1">Fecha seleccionada</p>
          <p className="text-lg font-bold text-blue-900">
            {formatDate(selectedDate).fullDate}, {formatDate(selectedDate).year}
          </p>
        </div>

        {/* Date List */}
        <div className="overflow-y-auto flex-1 p-4 space-y-2">
          {dates.map((date, index) => {
            const formatted = formatDate(date);
            const today = isToday(date);
            const selected = isSelected(date);

            return (
              <Card
                key={index}
                className={`cursor-pointer transition-all ${
                  selected
                    ? "bg-blue-600 border-blue-600 shadow-md"
                    : today
                    ? "bg-blue-50 border-blue-200 hover:bg-blue-100"
                    : "hover:bg-slate-50"
                }`}
                onClick={() => handleDateSelect(date)}
              >
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div
                      className={`text-center ${
                        selected ? "text-white" : today ? "text-blue-600" : "text-slate-700"
                      }`}
                    >
                      <p className="text-xs font-medium uppercase">
                        {formatted.dayName}
                      </p>
                      <p className="text-2xl font-bold">{formatted.day}</p>
                      <p className="text-xs font-medium">{formatted.month}</p>
                    </div>
                    <div className={selected ? "text-white" : "text-slate-900"}>
                      {today && (
                        <span
                          className={`text-xs font-semibold px-2 py-1 rounded ${
                            selected
                              ? "bg-blue-500"
                              : "bg-blue-600 text-white"
                          }`}
                        >
                          HOY
                        </span>
                      )}
                    </div>
                  </div>
                  {selected && (
                    <div className="bg-white text-blue-600 rounded-full p-1">
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 shrink-0">
          <Button
            onClick={onClose}
            variant="outline"
            className="w-full"
          >
            Cerrar
          </Button>
        </div>
      </div>

      <style>{`
        @keyframes slide-up {
          from {
            transform: translateY(100%);
          }
          to {
            transform: translateY(0);
          }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
      `}</style>
    </>
  );
}
