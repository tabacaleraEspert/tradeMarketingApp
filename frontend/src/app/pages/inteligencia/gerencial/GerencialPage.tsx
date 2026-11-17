import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { Card, CardContent } from "../../../components/ui/card";
import { Skeleton } from "../../../components/ui/skeleton";
import {
  intelligenceApi,
  type GerencialEquipo,
  type GerencialFilters,
  type GerencialRepRow,
  type GerencialUniverso,
} from "@/lib/api";
import { FilterBar } from "./FilterBar";
import { UniversoTab } from "./UniversoTab";
import { EquipoTab, EQUIPO_SUBTABS, type EquipoSubtab } from "./EquipoTab";
import { nf } from "./format";
import { SectionTitle } from "./parts";

const TABS = ["universo", "equipo"] as const;
type GerencialTab = (typeof TABS)[number];

function oneOf<T extends string>(list: readonly T[], v: string | null, fallback: T): T {
  return v != null && (list as readonly string[]).includes(v) ? (v as T) : fallback;
}

// Ojo: Number(null) y Number("") dan 0 — por eso el guard explícito.
function positiveInt(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const DEFAULT_MONTHS = 3;

/**
 * Vista gerencial de Inteligencia Comercial: universo (embudo rastrillado →
 * en ruta foco → visitados → efectivos) y performance de equipo por TM Rep,
 * contra /intelligence/gerencial/*. Todo el estado vive en la URL.
 */
export function GerencialPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [tab, setTab] = useState<GerencialTab>(() => oneOf(TABS, searchParams.get("tab"), "universo"));
  const [subtab, setSubtab] = useState<EquipoSubtab>(() => oneOf(EQUIPO_SUBTABS, searchParams.get("sub"), "actividad"));
  const [zoneId, setZoneId] = useState<number | null>(() => positiveInt(searchParams.get("zone")));
  const [repId, setRepId] = useState<number | null>(() => positiveInt(searchParams.get("rep")));
  // null hasta que llega el catálogo de meses: recién ahí se validan los de la
  // URL o se toma el default (los últimos 3).
  const [months, setMonths] = useState<string[] | null>(null);

  const [filters, setFilters] = useState<GerencialFilters | null>(null);
  const [filtersError, setFiltersError] = useState(false);

  const loadFilters = useCallback(() => {
    setFiltersError(false);
    intelligenceApi
      .gerencialFilters()
      .then((f) => {
        setFilters(f);
        const keys = f.meses.map((m) => m.key);
        const fromUrl = (searchParams.get("months") ?? "").split(",").filter(Boolean);
        const valid = keys.filter((k) => fromUrl.includes(k));
        setMonths(valid.length ? valid : keys.slice(-DEFAULT_MONTHS));
        // Un link viejo puede traer una zona o un rep que ya no existen.
        setZoneId((z) => (z != null && f.zonas.some((x) => x.id === z) ? z : null));
        setRepId((r) => (r != null && f.reps.some((x) => x.id === r) ? r : null));
      })
      .catch(() => setFiltersError(true));
    // Solo al montar / reintentar: los months de la URL se leen una vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { loadFilters(); }, [loadFilters]);

  // Cada cambio de solapa o filtro se refleja en la URL (sin apilar historial).
  useEffect(() => {
    if (months == null) return; // todavía no se resolvió el período: no pisar la URL
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (tab === "equipo") params.set("sub", subtab);
    params.set("months", months.join(","));
    if (zoneId != null) params.set("zone", String(zoneId));
    if (repId != null) params.set("rep", String(repId));
    setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, subtab, months, zoneId, repId]);

  const [universo, setUniverso] = useState<GerencialUniverso | null>(null);
  const [equipo, setEquipo] = useState<GerencialEquipo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Si los filtros cambian rápido, solo vale la respuesta del último pedido.
  const requestSeq = useRef(0);

  const monthsKey = months?.join(",") ?? "";
  useEffect(() => {
    if (!monthsKey) return;
    const seq = ++requestSeq.current;
    const query = {
      months: monthsKey.split(","),
      zone_id: zoneId ?? undefined,
      user_id: repId ?? undefined,
    };
    setLoading(true);
    setError(false);
    // Pequeña espera: al tocar varios meses seguidos sale un solo pedido.
    const timer = setTimeout(() => {
    // Las dos solapas se piden siempre: las tarjetas de arriba usan un número de cada una.
    Promise.all([intelligenceApi.gerencialUniverso(query), intelligenceApi.gerencialEquipo(query)])
      .then(([u, e]) => {
        if (seq !== requestSeq.current) return;
        setUniverso(u);
        setEquipo(e);
      })
      .catch(() => {
        if (seq === requestSeq.current) setError(true);
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [monthsKey, zoneId, repId, reloadKey]);

  const handleZoneChange = (id: number | null) => {
    setZoneId(id);
    // Un TM Rep de otra área no puede quedar seleccionado.
    if (id != null && repId != null) {
      const rep = filters?.reps.find((r) => r.id === repId);
      if (!rep || rep.zoneId !== id) setRepId(null);
    }
  };

  const handleRepChange = (id: number | null) => {
    setRepId(id);
    if (id != null) {
      const rep = filters?.reps.find((r) => r.id === id);
      if (rep?.zoneId != null) setZoneId(rep.zoneId);
    }
  };

  const handleSelectRepRow = (rep: GerencialRepRow) => {
    setRepId(rep.id);
    setZoneId(rep.zoneId);
  };

  const handleClear = () => {
    setZoneId(null);
    setRepId(null);
    if (filters) setMonths(filters.meses.map((m) => m.key).slice(-DEFAULT_MONTHS));
  };

  const context = useMemo(() => {
    const zona = zoneId == null ? null : filters?.zonas.find((z) => z.id === zoneId)?.name;
    const rep = repId == null ? null : filters?.reps.find((r) => r.id === repId)?.name;
    const periodo = (tab === "universo" ? universo?.periodoLabel : equipo?.periodoLabel) ?? "";
    return ["Argentina", zona, rep ?? "todos los TM Reps", periodo].filter(Boolean).join(" · ");
  }, [filters, zoneId, repId, tab, universo, equipo]);

  const tabCards: Array<{ key: GerencialTab | null; title: string; value: string; label: string }> = [
    { key: "universo", title: "Universo", value: universo ? nf(universo.embudo.enRutaFoco) : "—", label: "PDVs en ruta foco" },
    { key: null, title: "Performance de marcas", value: "—", label: "Próximamente" },
    { key: "equipo", title: "Performance de equipo", value: equipo ? nf(equipo.cards.realizadas) : "—", label: "visitas realizadas" },
    { key: null, title: "Producto", value: "—", label: "Próximamente" },
  ];

  const hasData = universo != null && equipo != null;

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-[1240px] mx-auto">
      <header>
        <Link
          to="/inteligencia"
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> Volver a Inteligencia
        </Link>
        <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-espert-gold">
          Trade Marketing · Vista gerencial
        </p>
        <h1 className="text-2xl font-bold text-foreground mt-1">Inteligencia Comercial</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Vista gerencial del país. Elegí una solapa y filtrá por área o TM Rep.
          {filters && <span> Datos al {filters.fechaDatos}.</span>}
        </p>
      </header>

      {filtersError && (
        <ErrorCard text="No se pudieron cargar los filtros de la vista gerencial." onRetry={loadFilters} />
      )}

      {!filters && !filtersError && <Skeleton className="h-14 w-full rounded-xl" />}

      {filters && months && (
        <FilterBar
          filters={filters}
          months={months}
          zoneId={zoneId}
          repId={repId}
          onMonthsChange={setMonths}
          onZoneChange={handleZoneChange}
          onRepChange={handleRepChange}
          onClear={handleClear}
        />
      )}

      {!filtersError && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" role="tablist" aria-label="Solapas de la vista gerencial">
          {tabCards.map((c) => {
            const active = c.key != null && c.key === tab;
            const disabled = c.key == null;
            return (
              <button
                key={c.title}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={disabled}
                onClick={() => c.key && setTab(c.key)}
                className={`min-w-0 rounded-xl border p-4 text-left transition-colors ${
                  active
                    ? "border-transparent bg-[#4A392B] text-white dark:bg-[#5A4532]"
                    : disabled
                      ? "border-border bg-card text-card-foreground opacity-60 cursor-not-allowed"
                      : "border-border bg-card text-card-foreground hover:border-espert-gold/60"
                }`}
              >
                <p className={`text-[10px] font-semibold uppercase tracking-wider ${active ? "text-white/75" : "text-muted-foreground"}`}>
                  {c.title}
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{c.value}</p>
                <p className={`mt-1 text-xs ${active ? "text-white/75" : "text-muted-foreground"}`}>{c.label}</p>
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <ErrorCard text="No se pudo cargar la vista gerencial." onRetry={() => setReloadKey((k) => k + 1)} />
      )}

      {!error && !filtersError && !hasData && (
        <div className="space-y-4" aria-busy="true" aria-label="Cargando">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      )}

      {!error && hasData && (
        <section className={`space-y-4 transition-opacity ${loading ? "opacity-50 pointer-events-none" : ""}`} aria-busy={loading}>
          <SectionTitle title={tab === "universo" ? "Universo" : "Performance de equipo"} context={context} />
          {tab === "universo" ? (
            <UniversoTab data={universo} onSelectZone={handleZoneChange} />
          ) : (
            <EquipoTab data={equipo} subtab={subtab} onSubtabChange={setSubtab} onSelectRep={handleSelectRepRow} />
          )}
        </section>
      )}
    </div>
  );
}

function ErrorCard({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <Card>
      <CardContent className="p-6 text-center space-y-3">
        <p className="text-sm text-muted-foreground">{text}</p>
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-espert-gold hover:underline"
        >
          <RefreshCw size={12} /> Reintentar
        </button>
      </CardContent>
    </Card>
  );
}
