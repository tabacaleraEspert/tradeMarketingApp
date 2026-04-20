import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface SelectedDateContextValue {
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
  goToToday: () => void;
  isToday: boolean;
}

const SelectedDateContext = createContext<SelectedDateContextValue | undefined>(undefined);

export function SelectedDateProvider({ children }: { children: ReactNode }) {
  const [selectedDate, setSelectedDateState] = useState<Date>(() => new Date());

  const setSelectedDate = useCallback((date: Date) => {
    setSelectedDateState(date);
  }, []);

  const goToToday = useCallback(() => {
    setSelectedDateState(new Date());
  }, []);

  const isToday = selectedDate.toDateString() === new Date().toDateString();

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
