import { Sun, Moon, SunMoon } from "lucide-react";
import { cn } from "./ui/utils";
import { setThemePreference, useThemePreference, type ThemePreference } from "../lib/useArgentinaTheme";

const OPTIONS: { value: ThemePreference; icon: typeof Sun; label: string }[] = [
  { value: "light", icon: Sun, label: "Claro" },
  { value: "auto", icon: SunMoon, label: "Automático" },
  { value: "dark", icon: Moon, label: "Oscuro" },
];

interface ThemeToggleProps {
  className?: string;
}

/** Selector compacto de 3 estados para la preferencia de tema (Claro / Automático / Oscuro). */
export function ThemeToggle({ className }: ThemeToggleProps) {
  const preference = useThemePreference();

  return (
    <div className={cn("flex items-center gap-1 rounded-lg bg-muted p-1", className)}>
      {OPTIONS.map(({ value, icon: Icon, label }) => {
        const isActive = preference === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setThemePreference(value)}
            title={`Tema ${label.toLowerCase()}`}
            aria-label={`Tema ${label.toLowerCase()}`}
            aria-pressed={isActive}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              isActive
                ? "bg-espert-gold/10 text-espert-gold dark:bg-espert-gold/20"
                : "text-muted-foreground hover:bg-background hover:text-foreground"
            )}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}
