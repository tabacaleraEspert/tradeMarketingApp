import { cn } from "../../../lib/utils";

export type StatusChipType = "pending" | "in-progress" | "completed" | "not-synced" | "alert" | "open" | "resolved";

interface StatusChipProps {
  status: StatusChipType;
  label?: string;
  size?: "sm" | "md" | "lg";
}

export function StatusChip({ status, label, size = "md" }: StatusChipProps) {
  const getStatusConfig = () => {
    switch (status) {
      case "pending":
        return {
          color: "bg-yellow-100 text-yellow-800 border-yellow-200",
          label: label || "Pendiente",
        };
      case "in-progress":
        return {
          color: "bg-espert-gold/10 text-espert-gold border-espert-gold/30",
          label: label || "En Curso",
        };
      case "completed":
        return {
          color: "bg-green-100 text-green-800 border-green-200",
          label: label || "Completa",
        };
      case "not-synced":
        return {
          color: "bg-muted text-foreground border-border",
          label: label || "Sin Sync",
        };
      case "alert":
        return {
          color: "bg-red-100 text-red-800 border-red-200",
          label: label || "Alerta",
        };
      case "open":
        return {
          color: "bg-orange-100 text-orange-800 border-orange-200",
          label: label || "Abierta",
        };
      case "resolved":
        return {
          color: "bg-green-100 text-green-800 border-green-200",
          label: label || "Resuelta",
        };
    }
  };

  const sizeClasses = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-2.5 py-1 text-sm",
    lg: "px-3 py-1.5 text-base",
  };

  const config = getStatusConfig();

  return (
    <span
      className={cn(
        "inline-flex items-center font-semibold rounded-full border",
        config.color,
        sizeClasses[size]
      )}
    >
      {config.label}
    </span>
  );
}