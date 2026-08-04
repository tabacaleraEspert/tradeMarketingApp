import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { kpiApi, type KpiVariableRow } from "@/lib/api";
import { VariableRing } from "./VariableRing";
import { KpiCard } from "./KpiCard";
import { formatPct, toneFor, toneClasses } from "./resumen-utils";

const MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

interface Props {
  year: number;
  month: number;
  userId: number | null;
  onSelectUser?: (userId: number) => void;
}

export function ResumenTab({ year, month, userId, onSelectUser }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rows, setRows] = useState<KpiVariableRow[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    kpiApi.variable({ year, month, user_id: userId ?? undefined })
      .then(setRows)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [year, month, userId]);

  useEffect(() => { load(); }, [load]);

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
          <p className="text-sm text-muted-foreground">No se pudo cargar el resumen de KPIs.</p>
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

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground text-center py-8">
            Sin datos de KPIs para el período seleccionado.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (userId != null) {
    return <IndividualView row={rows[0]} year={year} month={month} />;
  }

  return <TeamView rows={rows} onSelectUser={onSelectUser} />;
}

function IndividualView({ row, year, month }: { row: KpiVariableRow; year: number; month: number }) {
  const daysInMonth = new Date(year, month, 0).getDate();

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-5 flex-wrap">
            <VariableRing percent={row.variableTotal} />
            <div className="flex-1 min-w-[180px]">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-foreground">{row.name ?? `Usuario #${row.userId}`}</h2>
                {row.partial && (
                  <Badge className="bg-amber-100 text-amber-700 border-0 text-[10px]">Parcial</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {MONTH_NAMES[month - 1]} {year}
                {row.partial && ` · Día ${row.day} de ${daysInMonth}`}
              </p>
            </div>
          </div>
          {row.configWarning && (
            <div className="mt-4 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">{row.configWarning}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {row.kpis.map((k) => <KpiCard key={k.key} kpi={k} />)}
      </div>
    </div>
  );
}

function TeamView({ rows, onSelectUser }: { rows: KpiVariableRow[]; onSelectUser?: (userId: number) => void }) {
  const sorted = [...rows].sort((a, b) => b.variableTotal - a.variableTotal);
  const avg = rows.length ? rows.reduce((s, r) => s + r.variableTotal, 0) / rows.length : 0;
  const highCount = rows.filter((r) => r.variableTotal >= 80).length;
  const lowCount = rows.filter((r) => r.variableTotal < 50).length;
  const kpiHeaders = rows[0]?.kpis.map((k) => ({ key: k.key, name: k.name })) ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-black text-foreground">{formatPct(avg)}%</p>
            <p className="text-xs text-muted-foreground mt-1">Promedio de variable del equipo</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-black text-green-600">{highCount}</p>
            <p className="text-xs text-muted-foreground mt-1">TM Reps con variable ≥80%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-black text-red-600">{lowCount}</p>
            <p className="text-xs text-muted-foreground mt-1">TM Reps con variable &lt;50%</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <h3 className="font-bold text-foreground mb-3">Ranking de variable mensual</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 text-muted-foreground font-semibold">TM Rep</th>
                  <th className="text-center py-2 text-muted-foreground font-semibold">Variable</th>
                  {kpiHeaders.map((k) => (
                    <th key={k.key} className="text-center py-2 text-muted-foreground font-semibold" title={k.name}>
                      {k.name.length > 14 ? `${k.name.slice(0, 12)}…` : k.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const colors = toneClasses[toneFor(r.variableTotal)];
                  return (
                    <tr
                      key={r.userId}
                      onClick={() => onSelectUser?.(r.userId)}
                      className={`border-b border-border last:border-0 ${onSelectUser ? "cursor-pointer hover:bg-muted/30" : ""}`}
                    >
                      <td className="py-2.5 font-medium text-foreground">{r.name ?? `Usuario #${r.userId}`}</td>
                      <td className="py-2.5 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full font-semibold ${colors.pillBg} ${colors.pillText}`}>
                          {formatPct(r.variableTotal)}%
                        </span>
                      </td>
                      {r.kpis.map((k) => (
                        <td
                          key={k.key}
                          className="py-2.5 text-center"
                          title={`${formatPct(k.actual)}% vs meta ${formatPct(k.target)}%`}
                        >
                          {k.achieved ? (
                            <span className="text-green-600 font-bold">✓</span>
                          ) : (
                            <span className="text-red-600 font-bold">✗</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
