import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { todayAR } from "./dateUtils";

/** Create a Date object representing today in Argentina timezone */
function todayDate(): Date {
  return new Date(todayAR() + "T12:00:00");
}

interface SelectedDateContextValue {
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
  goToToday: () => void;
  isToday: boolean;
}

const SelectedDateContext = createContext<SelectedDateContextValue | undefined>(undefined);

export function SelectedDateProvider({ children }: { children: ReactNode }) {
  const [selectedDate, setSelectedDateState] = useState<Date>(() => todayDate());

  const setSelectedDate = useCallback((date: Date) => {
    setSelectedDateState(date);
  }, []);

  const goToToday = useCallback(() => {
    setSelectedDateState(todayDate());
  }, []);

  const toYMD = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const isToday = toYMD(selectedDate) === todayAR();

  return (
    <SelectedDateContext.Provider value={{ selectedDate, setSelectedDate, goToToday, isToday }}>
      {children}
    </SelectedDateContext.Provider>
  );
}

export function useSelectedDate(): SelectedDateContextValue {
  const ctx = useContext(SelectedDateContext);
  if (!ctx) {
    throw new Error("useSelectedDate must be used within a SelectedDateProvider");
  }
  return ctx;
}
