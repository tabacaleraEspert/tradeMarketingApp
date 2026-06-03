import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";

interface PaginationBarProps {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
  className?: string;
}

/**
 * Barra de paginación: "< Anterior · Página X de Y · N resultados · Siguiente >"
 * Para listas server-side con Page<T>. No renderiza si total === 0.
 */
export function PaginationBar({
  page,
  totalPages,
  total,
  onPageChange,
  loading = false,
  className = "",
}: PaginationBarProps) {
  if (total === 0) return null;

  const canPrev = page > 1 && !loading;
  const canNext = page < totalPages && !loading;

  return (
    <div className={`flex items-center justify-center gap-3 py-4 ${className}`}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(page - 1)}
        disabled={!canPrev}
        className="gap-1"
      >
        <ChevronLeft size={14} />
        Anterior
      </Button>

      <div className="text-xs text-muted-foreground tabular-nums">
        Página <span className="font-medium text-foreground">{page}</span> de{" "}
        <span className="font-medium text-foreground">{totalPages}</span>
        <span className="mx-2">·</span>
        <span className="font-medium text-foreground">{total.toLocaleString("es-AR")}</span> resultados
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(page + 1)}
        disabled={!canNext}
        className="gap-1"
      >
        Siguiente
        <ChevronRight size={14} />
      </Button>
    </div>
  );
}
