import { useEffect } from "react";

/**
 * Auto dark/light mode based on Argentina timezone (UTC-3).
 * Day: 7:00 - 19:00 → light
 * Night: 19:00 - 7:00 → dark
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
      const hour = getArgentinaHour();
      const isDark = hour >= 19 || hour < 7;
      if (isDark) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }

    // Apply immediately
    applyTheme();

    // Re-check every minute
    const interval = setInterval(applyTheme, 60_000);
    return () => clearInterval(interval);
  }, []);
}
