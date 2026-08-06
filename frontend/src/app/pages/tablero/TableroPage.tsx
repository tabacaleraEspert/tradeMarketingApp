import { useCallback, useEffect, useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { kpiApi, type KpiVariableRow } from "@/lib/api";
import { getCurrentUser } from "../../lib/auth";
import { ResumenTab } from "./ResumenTab";
import { RutasTab } from "./RutasTab";
import { PdvsTab } from "./PdvsTab";
import { TableroBreadcrumb } from "./TableroBreadcrumb";
import { NO_MANAGER_ID } from "./resumen-utils";

const MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export function TableroPage() {
  const now = new Date();
  const currentUser = useMemo(() => getCurrentUser(), []);
  // Un territory_manager/supervisor arranca directo en su territorio (su propia
  // gente) y no tiene acceso al nivel General; el resto (admin, regional_manager,
  // ejecutivo) arranca en General y navega hacia abajo. "supervisor" es el rol
  // jerárquico equivalente en instalaciones que no usan "territory_manager"
  // (backend/app/hierarchy.py trata ambos como supervisores).
  const isTerritoryManager = ["territory_manager", "supervisor"].includes(currentUser.role);
  const ownManagerId = Number(currentUser.id) || NO_MANAGER_ID;

  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedManagerId, setSelectedManagerId] = useState<number | null>(isTerritoryManager ? ownManagerId : null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

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
        <div className="flex items-center gap-2">
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>{MONTH_NAMES.map((n, i) => <SelectItem key={i} value={String(i + 1)}>{n}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-[90px]"><SelectValue /></SelectTrigger>
            <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
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
      <Tabs defaultValue="resumen">
        <TabsList>
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="rutas">Rutas</TabsTrigger>
          <TabsTrigger value="pdvs">PDVs</TabsTrigger>
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
      </Tabs>
    </div>
  );
}
