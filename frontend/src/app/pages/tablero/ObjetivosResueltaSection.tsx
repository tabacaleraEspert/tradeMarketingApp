import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, Users } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { kpiApi, usersApi, type ResolvedKpiConfig, type User } from "@/lib/api";

const SCOPE_LABELS: Record<string, string> = {
  global: "Global",
  zone: "Zona",
  user: "Usuario",
};

export function ObjetivosResueltaSection() {
  const [users, setUsers] = useState<User[]>([]);
  const [userId, setUserId] = useState<number | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [data, setData] = useState<ResolvedKpiConfig | null>(null);

  useEffect(() => {
    usersApi.list().then(setUsers).catch(() => setUsers([]));
  }, []);

  const load = useCallback(() => {
    if (userId == null) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(false);
    kpiApi.resolvedConfig({ user_id: userId })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const totalWeight = useMemo(
    () => data?.configs.reduce((sum, c) => sum + c.weight, 0) ?? 0,
    [data]
  );
  const weightMismatch = data != null && data.configs.length > 0 && totalWeight !== 100;

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">Config resuelta por usuario</h3>
          <p className="text-xs text-muted-foreground">Peso y meta efectivos que aplica el motor de KPIs, con el alcance de donde salió cada valor.</p>
        </div>

        <Select value={userId != null ? String(userId) : ""} onValueChange={(v) => setUserId(Number(v))}>
          <SelectTrigger className="w-[260px]"><SelectValue placeholder="Elegí un usuario" /></SelectTrigger>
          <SelectContent>
            {[...users].sort((a, b) => a.DisplayName.localeCompare(b.DisplayName)).map((u) => (
              <SelectItem key={u.UserId} value={String(u.UserId)}>{u.DisplayName}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {userId == null && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Users size={28} className="text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Seleccioná un usuario para ver su configuración resuelta.</p>
          </div>
        )}

        {userId != null && loading && (
          <div className="flex items-center justify-center h-24">
            <div className="w-5 h-5 border-2 border-[#A48242] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {userId != null && !loading && error && (
          <div className="text-center space-y-2 py-4">
            <p className="text-sm text-muted-foreground">No se pudo cargar la configuración resuelta.</p>
            <button onClick={load} className="inline-flex items-center gap-1.5 text-xs font-semibold text-espert-gold hover:underline">
              <RefreshCw size={12} /> Reintentar
            </button>
          </div>
        )}

        {userId != null && !loading && !error && data && (
          <>
            {(data.configWarning || weightMismatch) && (
              <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3 text-amber-800 text-xs">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{data.configWarning ?? `La suma de pesos resuelta es ${totalWeight}%, no 100%.`}</span>
              </div>
            )}
            {data.configs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Sin configuración vigente para este usuario.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 text-muted-foreground font-semibold">KPI</th>
                      <th className="text-center py-2 text-muted-foreground font-semibold">Peso (%)</th>
                      <th className="text-center py-2 text-muted-foreground font-semibold">Meta (%)</th>
                      <th className="text-left py-2 text-muted-foreground font-semibold">Alcance aplicado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.configs.map((c) => (
                      <tr key={c.kpiDefinitionId} className="border-b border-border last:border-0">
                        <td className="py-2.5 font-medium text-foreground">{c.name}</td>
                        <td className="py-2.5 text-center">{c.weight}</td>
                        <td className="py-2.5 text-center">{c.target}</td>
                        <td className="py-2.5">
                          <Badge variant="outline">{SCOPE_LABELS[c.scopeApplied] ?? c.scopeApplied}</Badge>
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td className="py-2.5 font-semibold text-foreground">Total</td>
                      <td className={`py-2.5 text-center font-semibold ${weightMismatch ? "text-amber-700" : "text-foreground"}`}>{totalWeight}</td>
                      <td colSpan={2} />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
