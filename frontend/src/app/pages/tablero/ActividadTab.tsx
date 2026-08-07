import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Users } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "../../components/ui/accordion";
import { kpiApi, type WeeklyActivityResponse } from "@/lib/api";
import { ActividadDayRow } from "./ActividadDayRow";

interface VendorOption {
  userId: number;
  name: string | null;
}

interface Props {
  year: number;
  month: number;
  userId: number | null;
  managerId: number | null;
  userName: string | null;
  vendors: VendorOption[];
  onSelectUser: (userId: number) => void;
}

// /kpi/weekly-activity requiere user_id (igual que /kpi/pdv-scoring), así que esta
// pestaña también pide seleccionar un TM Rep antes de traer datos (DD.visits_semanal
// del prototipo: acordeón por semana con detalle diario de entrada/salida por PDV).
export function ActividadTab({ year, month, userId, managerId, userName, vendors, onSelectUser }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [data, setData] = useState<WeeklyActivityResponse | null>(null);

  const load = useCallback(() => {
    if (userId == null) {
      setData(null);
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    kpiApi.weeklyActivity({ year, month, user_id: userId })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [year, month, userId]);

  useEffect(() => { load(); }, [load]);

  if (userId == null && managerId != null) {
    return (
      <Card>
        <CardContent className="p-10 flex flex-col items-center gap-3 text-center">
          <Users size={28} className="text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">Elegí un vendedor del territorio para ver su actividad.</p>
          {vendors.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-center">
              {vendors.map((v) => (
                <button
                  key={v.userId}
                  onClick={() => onSelectUser(v.userId)}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground hover:bg-muted/70"
                >
                  {v.name ?? `Usuario #${v.userId}`}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (userId == null) {
    return (
      <Card>
        <CardContent className="p-10 flex flex-col items-center gap-2 text-center">
          <Users size={28} className="text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">Seleccioná un TM Rep para ver su actividad semanal</p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-[#A48242] border-t-transparent rounded-full animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-center space-y-3">
          <p className="text-sm text-muted-foreground">No se pudo cargar la actividad semanal.</p>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-espert-gold hover:underline"
          >
            <RefreshCw size={12} /> Reintentar
          </button>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.weeks.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground text-center py-8">
            Sin visitas este mes.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Colapsadas por default salvo la semana más reciente (última del array, ya que
  // el backend las devuelve ordenadas cronológicamente).
  const mostRecentWeekStart = data.weeks[data.weeks.length - 1].weekStart;

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="font-bold text-foreground mb-1">Actividad semanal</h3>
        <p className="text-xs text-muted-foreground mb-3">
          {userName ?? data.name ?? `Usuario #${userId}`}
        </p>
        <Accordion type="multiple" defaultValue={[mostRecentWeekStart]}>
          {data.weeks.map((week) => (
            <AccordionItem key={week.weekStart} value={week.weekStart}>
              <AccordionTrigger>
                <span className="flex items-center gap-3">
                  <span className="font-semibold text-foreground">{week.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {week.totalVisits} visita{week.totalVisits === 1 ? "" : "s"}
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="divide-y divide-border">
                  {week.days.map((day) => (
                    <ActividadDayRow key={day.date} day={day} />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}
