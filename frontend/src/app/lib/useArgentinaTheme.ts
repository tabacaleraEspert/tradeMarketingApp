import { useEffect, useState } from "react";

export type ThemePreference = "light" | "dark" | "auto";

const STORAGE_KEY = "theme-preference";
const CHANGE_EVENT = "theme-preference-change";

/** Lee la preferencia guardada por el usuario. Default "auto" (comportamiento por horario). */
export function getThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "auto";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "auto" ? stored : "auto";
}

/** Persiste la preferencia y dispara la re-aplicación inmediata del tema (sin recargar). */
export function setThemePreference(pref: ThemePreference) {
  window.localStorage.setItem(STORAGE_KEY, pref);
  window.dispatchEvent(new CustomEvent<ThemePreference>(CHANGE_EVENT, { detail: pref }));
}

/** Hook para leer (y reaccionar a cambios de) la preferencia actual, útil para UI como ThemeToggle. */
export function useThemePreference(): ThemePreference {
  const [preference, setPreference] = useState<ThemePreference>(getThemePreference);

  useEffect(() => {
    function onChange(e: Event) {
      setPreference((e as CustomEvent<ThemePreference>).detail);
    }
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);

  return preference;
}

/**
 * Aplica el tema según la preferencia del usuario ("theme-preference" en localStorage).
 * - "light" / "dark": fuerzan la clase correspondiente.
 * - "auto" (default): dark/light automático según horario de Argentina (UTC-3).
 *   Día: 7:00 - 19:00 → light. Noche: 19:00 - 7:00 → dark.
 */
export function useArgentinaTheme() {
  useEffect(() => {
    function getArgentinaHour(): number {
      const now = new Date();
      // Get current hour in Argentina (America/Argentina/Buenos_Aires = UTC-3)
      const argTime = new Date(
        now.toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" })
      );
      return argTime.getHours();
    }

    function applyTheme() {
      const pref = getThemePreference();
      if (pref === "light") {
        document.documentElement.classList.remove("dark");
        return;
      }
      if (pref === "dark") {
        document.documentElement.classList.add("dark");
        return;
      }
      const hour = getArgentinaHour();
      const isDark = hour >= 19 || hour < 7;
      document.documentElement.classList.toggle("dark", isDark);
    }

    // Apply immediately
    applyTheme();

    // Re-check every minute (for "auto") and on manual preference changes
    const interval = setInterval(applyTheme, 60_000);
    window.addEventListener(CHANGE_EVENT, applyTheme);
    return () => {
      clearInterval(interval);
      window.removeEventListener(CHANGE_EVENT, applyTheme);
    };
  }, []);
}
