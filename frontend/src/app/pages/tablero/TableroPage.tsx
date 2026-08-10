import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { kpiApi, type KpiVariableRow, type ClosedMonth } from "@/lib/api";
import { getCurrentUser } from "../../lib/auth";
import { ResumenTab } from "./ResumenTab";
import { RutasTab } from "./RutasTab";
import { PdvsTab } from "./PdvsTab";
import { ActividadTab } from "./ActividadTab";
import { PreciosTab } from "./PreciosTab";
import { ObjetivosTab } from "./ObjetivosTab";
import { TableroBreadcrumb } from "./TableroBreadcrumb";
import { TableroMonthStatus } from "./TableroMonthStatus";
import { NO_MANAGER_ID } from "./resumen-utils";

const MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const TABLERO_TABS = ["resumen", "rutas", "pdvs", "objetivos", "precios", "actividad"] as const;
type TableroTab = (typeof TABLERO_TABS)[number];
function isTableroTab(v: string | null): v is TableroTab {
  return !!v && (TABLERO_TABS as readonly string[]).includes(v);
}

export function TableroPage() {
  const now = new Date();
  const currentUser = useMemo(() => getCurrentUser(), []);
  // Un territory_manager/supervisor arranca directo en su territorio (su propia
  // gente) y no tiene acceso al nivel General; el resto (admin, regional_manager,
  // ejecutivo) arranca en General y navega hacia abajo. "supervisor" es el rol
  // jerárquico equivalente en instalaciones que no usan "territory_manager"
  // (backend/app/hierarchy.py trata ambos como supervisores).
  const isTerritoryManager = ["territory_manager", "supervisor"].includes(currentUser.role);
  const isAdmin = currentUser.role === "admin";
  const ownManagerId = Number(currentUser.id) || NO_MANAGER_ID;

  const [searchParams, setSearchParams] = useSearchParams();

  // Estado inicial: desde la URL si trae params válidos, si no los defaults de siempre.
  const initialYear = (() => {
    const n = Number(searchParams.get("year"));
    return Number.isInteger(n) && n > 0 ? n : now.getFullYear();
  })();
  const initialMonth = (() => {
    const n = Number(searchParams.get("month"));
    return Number.isInteger(n) && n >= 1 && n <= 12 ? n : now.getMonth() + 1;
  })();
  const initialTab = isTableroTab(searchParams.get("tab")) ? (searchParams.get("tab") as TableroTab) : "resumen";
  const initialManagerId = (() => {
    // El territory_manager/supervisor no puede navegar fuera de su propio territorio.
    if (isTerritoryManager) return ownManagerId;
    const raw = searchParams.get("manager");
    if (raw === "none") return NO_MANAGER_ID;
    if (raw != null) {
      const n = Number(raw);
      if (Number.isInteger(n)) return n;
    }
    return null;
  })();
  const initialUserId = (() => {
    const n = Number(searchParams.get("user"));
    return Number.isInteger(n) ? n : null;
  })();

  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const [tab, setTab] = useState<TableroTab>(initialTab);
  const [selectedManagerId, setSelectedManagerId] = useState<number | null>(initialManagerId);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(initialUserId);

  // Cada cambio de mes/año, pestaña o drill-down se refleja en la URL (sin apilar historial).
  useEffect(() => {
    const params = new URLSearchParams();
    params.set("year", String(year));
    params.set("month", String(month));
    params.set("tab", tab);
    if (selectedManagerId != null) {
      params.set("manager", selectedManagerId === NO_MANAGER_ID ? "none" : String(selectedManagerId));
    }
    if (selectedUserId != null) {
      params.set("user", String(selectedUserId));
    }
    setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, tab, selectedManagerId, selectedUserId]);

  const [rows, setRows] = useState<KpiVariableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const years = Array.from({ length: 3 }, (_, i) => now.getFullYear() - i);

  // Único fetch de /kpi/variable por mes: se comparte a las 3 tabs por props,
  // el drill-down (General → Territorio → Vendedor) es filtrado client-side.
  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    kpiApi.variable({ year, month })
      .then(setRows)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  // Meses ya cerrados (todos los años, T5): se piden una sola vez y se filtran
  // client-side por año/mes donde hagan falta (badge de estado, indicador en el
  // selector de mes).
  const [closedMonths, setClosedMonths] = useState<ClosedMonth[]>([]);
  const loadClosedMonths = useCallback(() => {
    kpiApi.closedMonths().then(setClosedMonths).catch(() => {});
  }, []);
  useEffect(() => { loadClosedMonths(); }, [loadClosedMonths]);

  const handleMonthClosed = () => {
    load();
    loadClosedMonths();
  };

  const closedMonthNumbersInYear = useMemo(
    () => new Set(closedMonths.filter((cm) => cm.year === year).map((cm) => cm.month)),
    [closedMonths, year]
  );

  // partial/day del mes seleccionado (mismo criterio que backend/app/services/kpi_engine.py:
  // partial=True solo si (year, month) es el mes calendario actual); con fallback
  // client-side si rows viene vacío (sin usuarios visibles para ese período).
  const partial = rows[0]?.partial ?? (year === now.getFullYear() && month === now.getMonth() + 1);
  const day = rows[0]?.day ?? now.getDate();

  const handleSelectManager = (managerId: number) => {
    if (isTerritoryManager) return; // no puede navegar fuera de su propio territorio
    setSelectedManagerId(managerId);
    setSelectedUserId(null);
  };

  const handleSelectGeneral = () => {
    if (isTerritoryManager) return;
    setSelectedManagerId(null);
    setSelectedUserId(null);
  };

  const handleSelectUser = (userId: number) => {
    setSelectedUserId(userId);
  };

  const managerName = useMemo(() => {
    if (selectedManagerId == null) return null;
    if (selectedManagerId === NO_MANAGER_ID) return "Sin territorio asignado";
    return rows.find((r) => r.managerUserId === selectedManagerId)?.managerName ?? currentUser.name;
  }, [rows, selectedManagerId, currentUser.name]);

  const userName = useMemo(() => {
    if (selectedUserId == null) return null;
    return rows.find((r) => r.userId === selectedUserId)?.name ?? null;
  }, [rows, selectedUserId]);

  // Vendedores del territorio seleccionado, para el atajo de selección en Rutas/PDVs.
  const territoryVendors = useMemo(() => {
    if (selectedManagerId == null) return [];
    return rows
      .filter((r) => (r.managerUserId ?? NO_MANAGER_ID) === selectedManagerId)
      .map((r) => ({ userId: r.userId, name: r.name }));
  }, [rows, selectedManagerId]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1">Objetivos TMR</h1>
          <p className="text-muted-foreground text-sm">Seguimiento de KPIs y variable de TM Reps</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTH_NAMES.map((n, i) => (
                <SelectItem key={i} value={String(i + 1)}>
                  <span className="flex items-center gap-1.5">
                    {n}
                    {closedMonthNumbersInYear.has(i + 1) && (
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" aria-label="Mes cerrado" />
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-[90px]"><SelectValue /></SelectTrigger>
            <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
          <TableroMonthStatus
            year={year}
            month={month}
            closedMonths={closedMonths}
            partial={partial}
            day={day}
            isAdmin={isAdmin}
            onClosed={handleMonthClosed}
          />
        </div>
      </div>

      <TableroBreadcrumb
        showGeneral={!isTerritoryManager}
        managerId={selectedManagerId}
        managerName={managerName}
        userId={selectedUserId}
        userName={userName}
        onSelectGeneral={handleSelectGeneral}
        onSelectManager={() => setSelectedUserId(null)}
      />

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TableroTab)}>
        <TabsList>
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="rutas">Rutas</TabsTrigger>
          <TabsTrigger value="pdvs">PDVs</TabsTrigger>
          <TabsTrigger value="actividad">Actividad</TabsTrigger>
          <TabsTrigger value="precios">Precios</TabsTrigger>
          <TabsTrigger value="objetivos">Objetivos</TabsTrigger>
        </TabsList>
        <TabsContent value="resumen">
          <ResumenTab
            rows={rows}
            loading={loading}
            error={error}
            onRetry={load}
            year={year}
            month={month}
            managerId={selectedManagerId}
            userId={selectedUserId}
            onSelectManager={handleSelectManager}
            onSelectUser={handleSelectUser}
          />
        </TabsContent>
        <TabsContent value="rutas">
          <RutasTab
            year={year}
            month={month}
            userId={selectedUserId}
            managerId={selectedManagerId}
            vendors={territoryVendors}
            onSelectUser={handleSelectUser}
          />
        </TabsContent>
        <TabsContent value="pdvs">
          <PdvsTab
            year={year}
            month={month}
            userId={selectedUserId}
            managerId={selectedManagerId}
            vendors={territoryVendors}
            onSelectUser={handleSelectUser}
          />
        </TabsContent>
        <TabsContent value="actividad">
          <ActividadTab
            year={year}
            month={month}
            userId={selectedUserId}
            managerId={selectedManagerId}
            userName={userName}
            vendors={territoryVendors}
            onSelectUser={handleSelectUser}
          />
        </TabsContent>
        <TabsContent value="precios">
          <PreciosTab
            year={year}
            month={month}
            userId={selectedUserId}
            userName={userName}
            managerId={selectedManagerId}
            vendors={territoryVendors}
          />
        </TabsContent>
        <TabsContent value="objetivos">
          <ObjetivosTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
