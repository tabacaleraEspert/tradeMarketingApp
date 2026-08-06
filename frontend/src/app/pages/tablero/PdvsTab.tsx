import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, Users } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { kpiApi, type PdvScoringResponse } from "@/lib/api";
import { formatDateCompact } from "../../lib/dateUtils";
import { PdvsScoreDonut } from "./PdvsScoreDonut";
import { levelLabel, levelStyle } from "./pdvs-utils";

interface VendorOption {
  userId: number;
  name: string | null;
}

interface Props {
  year: number;
  month: number;
  userId: number | null;
  managerId: number | null;
  vendors: VendorOption[];
  onSelectUser: (userId: number) => void;
}

const PAGE_SIZE = 50;

// /kpi/pdv-scoring requiere user_id (no soporta "Todos" a nivel backend), así que
// esta pestaña pide seleccionar un TM Rep antes de traer datos.
export function PdvsTab({ year, month, userId, managerId, vendors, onSelectUser }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [data, setData] = useState<PdvScoringResponse | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    if (userId == null) {
      setData(null);
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    kpiApi.pdvScoring({ year, month, user_id: userId, page, page_size: PAGE_SIZE })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [year, month, userId, page]);

  useEffect(() => { setPage(1); }, [year, month, userId]);
  useEffect(() => { load(); }, [load]);

  if (userId == null && managerId != null) {
    return (
      <Card>
        <CardContent className="p-10 flex flex-col items-center gap-3 text-center">
          <Users size={28} className="text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">Elegí un vendedor del territorio para ver sus PDVs.</p>
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
          <p className="text-sm text-muted-foreground">Seleccioná un TM Rep para ver el detalle de PDVs</p>
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
          <p className="text-sm text-muted-foreground">No se pudo cargar el detalle de PDVs.</p>
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

  if (!data || data.total === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground text-center py-8">
            Sin PDVs para el período seleccionado.
          </p>
        </CardContent>
      </Card>
    );
  }

  const from = (data.page - 1) * data.pageSize + 1;
  const to = Math.min(data.page * data.pageSize, data.total);
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5">
          <div className="flex gap-6 flex-wrap">
            <PdvsScoreDonut title="Calificación de cobertura" dist={data.scoreDist.coverage} />
            <PdvsScoreDonut title="Calificación de comunicación" dist={data.scoreDist.communication} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 text-muted-foreground font-semibold">PDV</th>
                  <th className="text-left py-2 text-muted-foreground font-semibold">Ruta</th>
                  <th className="text-center py-2 text-muted-foreground font-semibold">Cobertura</th>
                  <th className="text-center py-2 text-muted-foreground font-semibold">Comunicación</th>
                  <th className="text-center py-2 text-muted-foreground font-semibold">Última visita</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => {
                  const cov = levelStyle(item.coverageScore);
                  const com = levelStyle(item.communicationScore);
                  return (
                    <tr key={item.pdvId} className="border-b border-border last:border-0">
                      <td className="py-2.5 font-medium text-foreground">{item.name}</td>
                      <td className="py-2.5 text-muted-foreground">{item.route ?? "—"}</td>
                      <td className="py-2.5 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full font-semibold ${cov.pillBg} ${cov.pillText}`}>
                          {levelLabel(item.coverageScore)}
                        </span>
                      </td>
                      <td className="py-2.5 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full font-semibold ${com.pillBg} ${com.pillText}`}>
                          {levelLabel(item.communicationScore)}
                        </span>
                      </td>
                      <td className="py-2.5 text-center text-muted-foreground">
                        {item.lastVisit ? formatDateCompact(item.lastVisit) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              {from}–{to} de {data.total}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={data.page <= 1}
                className="inline-flex items-center gap-1 text-xs font-semibold text-foreground disabled:text-muted-foreground/40 disabled:cursor-not-allowed hover:text-espert-gold"
              >
                <ChevronLeft size={14} /> Anterior
              </button>
              <span className="text-xs text-muted-foreground">Página {data.page} de {totalPages}</span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={data.page >= totalPages}
                className="inline-flex items-center gap-1 text-xs font-semibold text-foreground disabled:text-muted-foreground/40 disabled:cursor-not-allowed hover:text-espert-gold"
              >
                Siguiente <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
