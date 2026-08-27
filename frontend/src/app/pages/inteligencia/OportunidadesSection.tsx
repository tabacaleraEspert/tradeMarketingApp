import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import {
  intelligenceApi,
  type IntelOpportunitiesResponse,
  type IntelZona,
} from "@/lib/api";

const PAGE_SIZE = 50;

const PRIORITY_STYLES: Record<string, string> = {
  "Crítica": "bg-red-600 text-white",
  "Alta": "bg-orange-500 text-white",
  "Media": "bg-amber-400 text-amber-950",
};

const TIPOS: Array<{ value: string; label: string }> = [
  { value: "primera_colocacion", label: "PDV sin Espert" },
  { value: "categoria", label: "Categoría sin Espert" },
  { value: "capsulados", label: "Capsulados" },
  { value: "extension_milenio", label: "Extensión Milenio" },
  { value: "franja_precio", label: "Franja descubierta" },
];

export function OportunidadesSection({ zonas }: { zonas: IntelZona[] }) {
  const [data, setData] = useState<IntelOpportunitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [zona, setZona] = useState("");
  const [prioridad, setPrioridad] = useState("");
  const [tipo, setTipo] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    intelligenceApi
      .opportunities({
        zona: zona || undefined,
        prioridad: prioridad || undefined,
        tipo: tipo || undefined,
        page,
        page_size: PAGE_SIZE,
      })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [zona, prioridad, tipo, page]);

  useEffect(() => { load(); }, [load]);

  // Export CSV client-side de TODO lo filtrado (reemplaza el Excel manual).
  const exportCsv = useCallback(() => {
    setExporting(true);
    intelligenceApi
      .opportunities({
        zona: zona || undefined,
        prioridad: prioridad || undefined,
        tipo: tipo || undefined,
        page: 1,
        page_size: 5000,
      })
      .then((full) => {
        const esc = (s: string | number | null) => `"${String(s ?? "").replace(/"/g, '""')}"`;
        const rows = [
          ["PDV", "Zona", "Canal", "Trade", "Prioridad", "Tipo", "Detalle", "Sugerencia"].join(";"),
          ...full.items.map((r) =>
            [r.pdv, r.zona, r.canal, r.trade, r.prioridad, r.tipoLabel, r.detalle, r.sugerencia]
              .map(esc)
              .join(";")
          ),
        ];
        // BOM para que Excel abra el UTF-8 con acentos bien.
        const blob = new Blob(["﻿" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Oportunidades_PDV_Espert_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .finally(() => setExporting(false));
  }, [zona, prioridad, tipo]);

  const selectClass =
    "border border-border rounded-md bg-background text-foreground text-xs px-2 py-1.5";
  const totalPages = data ? Math.max(1, Math.ceil(data.filteredTotal / PAGE_SIZE)) : 1;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <h3 className="font-bold text-foreground text-sm">
            Motor de oportunidades
            {data && <span className="ml-2 text-espert-gold">{data.total.toLocaleString("es-AR")} gaps</span>}
          </h3>
          <button
            onClick={exportCsv}
            disabled={exporting || !data}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-espert-gold hover:underline disabled:opacity-50"
          >
            <Download size={12} /> {exporting ? "Exportando…" : "Exportar CSV"}
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Cinco reglas cruzan el último censo de cada PDV contra el portfolio: primera colocación,
          categoría solo competencia, capsulados, extensión Milenio y franjas de precio descubiertas.
        </p>

        {data && (
          <div className="flex flex-wrap gap-2 mb-3 text-xs">
            {Object.entries(data.porPrioridad).map(([p, n]) => (
              <span key={p} className={`px-2 py-1 rounded-full font-semibold ${PRIORITY_STYLES[p]}`}>
                {p}: {n.toLocaleString("es-AR")}
              </span>
            ))}
            {Object.entries(data.porTipo).map(([t, n]) => (
              <span key={t} className="px-2 py-1 rounded-full bg-muted text-muted-foreground font-medium">
                {t}: {n.toLocaleString("es-AR")}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-3">
          <select value={zona} onChange={(e) => { setZona(e.target.value); setPage(1); }} className={selectClass}>
            <option value="">Todas las zonas</option>
            {zonas.map((z) => <option key={z.zonaId} value={z.zona}>{z.zona}</option>)}
          </select>
          <select value={prioridad} onChange={(e) => { setPrioridad(e.target.value); setPage(1); }} className={selectClass}>
            <option value="">Toda prioridad</option>
            {Object.keys(PRIORITY_STYLES).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={tipo} onChange={(e) => { setTipo(e.target.value); setPage(1); }} className={selectClass}>
            <option value="">Todos los tipos</option>
            {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        {loading && (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-[#A48242] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {error && (
          <div className="text-center py-6 space-y-2">
            <p className="text-sm text-muted-foreground">No se pudieron cargar las oportunidades.</p>
            <button onClick={load} className="inline-flex items-center gap-1.5 text-xs font-semibold text-espert-gold hover:underline">
              <RefreshCw size={12} /> Reintentar
            </button>
          </div>
        )}

        {data && !loading && !error && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    <th className="py-2 pr-3">PDV</th>
                    <th className="py-2 pr-3">Zona</th>
                    <th className="py-2 pr-3">Trade</th>
                    <th className="py-2 pr-3">Prioridad</th>
                    <th className="py-2 pr-3">Detalle</th>
                    <th className="py-2">Sugerencia</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r, i) => (
                    <tr key={`${r.pdvId}-${r.tipo}-${i}`} className="border-b border-border/60 hover:bg-muted/40 align-top">
                      <td className="py-1.5 pr-3 font-medium text-foreground whitespace-nowrap max-w-[180px] truncate">{r.pdv}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{r.zona}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{r.trade}</td>
                      <td className="py-1.5 pr-3">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${PRIORITY_STYLES[r.prioridad]}`}>
                          {r.prioridad}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground min-w-[220px]">{r.detalle}</td>
                      <td className="py-1.5 font-medium text-foreground min-w-[160px]">{r.sugerencia}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.items.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">Sin oportunidades con estos filtros.</p>
              )}
            </div>

            <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
              <span>
                {data.filteredTotal.toLocaleString("es-AR")} resultados · página {data.page} de {totalPages}
              </span>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-2.5 py-1 rounded border border-border disabled:opacity-40 hover:bg-muted"
                >
                  Anterior
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= totalPages}
                  className="px-2.5 py-1 rounded border border-border disabled:opacity-40 hover:bg-muted"
                >
                  Siguiente
                </button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
