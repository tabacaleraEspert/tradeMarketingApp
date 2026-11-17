import { Card } from "../../../components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import type { GerencialFilters } from "@/lib/api";

const ALL = "all";
const LABEL = "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";

export function FilterBar({
  filters,
  months,
  zoneId,
  repId,
  onMonthsChange,
  onZoneChange,
  onRepChange,
  onClear,
}: {
  filters: GerencialFilters;
  months: string[];
  zoneId: number | null;
  repId: number | null;
  onMonthsChange: (months: string[]) => void;
  onZoneChange: (zoneId: number | null) => void;
  onRepChange: (repId: number | null) => void;
  onClear: () => void;
}) {
  const reps = zoneId == null ? filters.reps : filters.reps.filter((r) => r.zoneId === zoneId);

  const toggleMonth = (key: string) => {
    const on = months.includes(key);
    if (on && months.length === 1) return; // siempre queda al menos un mes
    const next = on ? months.filter((m) => m !== key) : [...months, key];
    // Se mantiene el orden cronológico del catálogo.
    onMonthsChange(filters.meses.map((m) => m.key).filter((k) => next.includes(k)));
  };

  return (
    <Card className="gap-0 p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <label className="flex items-center gap-2">
          <span className={LABEL}>País</span>
          <Select value="AR" disabled>
            <SelectTrigger className="h-8 w-[120px]" aria-label="País"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="AR">Argentina</SelectItem></SelectContent>
          </Select>
        </label>

        <label className="flex items-center gap-2">
          <span className={LABEL}>Área</span>
          <Select
            value={zoneId == null ? ALL : String(zoneId)}
            onValueChange={(v) => onZoneChange(v === ALL ? null : Number(v))}
          >
            <SelectTrigger className="h-8 w-[170px]" aria-label="Área"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas</SelectItem>
              {filters.zonas.map((z) => (
                <SelectItem key={z.id} value={String(z.id)}>{z.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex items-center gap-2">
          <span className={LABEL}>TM Rep</span>
          <Select
            value={repId == null ? ALL : String(repId)}
            onValueChange={(v) => onRepChange(v === ALL ? null : Number(v))}
          >
            <SelectTrigger className="h-8 w-[190px]" aria-label="TM Rep"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos</SelectItem>
              {reps.map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <div className="flex items-center gap-2 min-w-0">
          <span className={LABEL}>Período</span>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Meses del período">
            {filters.meses.map((m) => {
              const on = months.includes(m.key);
              return (
                <button
                  key={m.key}
                  type="button"
                  aria-pressed={on}
                  title={on && months.length === 1 ? "Tiene que quedar al menos un mes" : m.key}
                  onClick={() => toggleMonth(m.key)}
                  className={`h-8 rounded-md px-2.5 text-xs font-semibold transition-colors ${
                    on
                      ? "bg-[#4A392B] text-white dark:bg-espert-gold dark:text-black"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={onClear}
          className="ml-auto text-xs font-medium text-espert-gold underline underline-offset-2 hover:opacity-80"
        >
          Limpiar filtros
        </button>
      </div>
    </Card>
  );
}
