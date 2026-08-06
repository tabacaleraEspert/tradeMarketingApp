import { ChevronRight } from "lucide-react";

interface Segment {
  label: string;
  onClick?: () => void;
}

interface Props {
  showGeneral: boolean;
  managerId: number | null;
  managerName: string | null;
  userId: number | null;
  userName: string | null;
  onSelectGeneral: () => void;
  onSelectManager: () => void;
}

// Breadcrumb del drill-down General → Territorio → Vendedor. El último segmento
// (posición actual) no es clickeable; los anteriores sí, para volver de nivel.
export function TableroBreadcrumb({
  showGeneral,
  managerId,
  managerName,
  userId,
  userName,
  onSelectGeneral,
  onSelectManager,
}: Props) {
  const segments: Segment[] = [];

  if (showGeneral) {
    segments.push({ label: "General", onClick: managerId != null ? onSelectGeneral : undefined });
  }
  if (managerId != null) {
    segments.push({
      label: `Territorio de ${managerName ?? "—"}`,
      onClick: userId != null ? onSelectManager : undefined,
    });
  }
  if (userId != null) {
    segments.push({ label: userName ?? `Usuario #${userId}` });
  }

  if (segments.length === 0) return null;

  return (
    <nav className="flex items-center gap-1.5 text-sm flex-wrap" aria-label="breadcrumb">
      {segments.map((seg, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight size={14} className="text-muted-foreground/50" />}
          {seg.onClick ? (
            <button onClick={seg.onClick} className="text-espert-gold font-semibold hover:underline">
              {seg.label}
            </button>
          ) : (
            <span className={i === segments.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground"}>
              {seg.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
