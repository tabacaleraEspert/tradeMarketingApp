import { useState, useCallback } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { SemaphoreCard } from "./components/SemaphoreCard";
import { ProductionTable } from "./components/ProductionTable";
import { StockPanel } from "./components/StockPanel";
import { ProductionChart } from "./components/ProductionChart";
import { AlertsPanel } from "./components/AlertsPanel";
import { WeeklyView } from "./components/WeeklyView";
import { MonthlyView } from "./components/MonthlyView";
import {
  todayOrders,
  supplies,
  initialAlerts,
  weeklyData,
  monthlyData,
  calculateKPIs,
  getSemaphoreColor,
  getStockSemaphore,
  getStopsSemaphore,
} from "./data/mockData";
import {
  Factory,
  Gauge,
  Package,
  AlertTriangle,
} from "lucide-react";

export function PlantDashboard() {
  const [alerts, setAlerts] = useState(initialAlerts);

  const handleAcknowledge = useCallback((id: number) => {
    setAlerts(prev => prev.map(a => (a.id === id ? { ...a, acknowledged: true } : a)));
  }, []);

  const kpis = calculateKPIs(todayOrders, supplies, alerts);

  const productionSemaphore = getSemaphoreColor(kpis.productionPct, { green: 95, yellow: 80 });
  const efficiencySemaphore = getSemaphoreColor(kpis.efficiencyPct, { green: 90, yellow: 75 });
  const stockSemaphore = getStockSemaphore(kpis.minDaysStock);
  const stopsSemaphore = getStopsSemaphore(kpis.lineStops);

  return (
    <Tabs defaultValue="today" className="space-y-4">
      {/* Tab selector - big touch targets */}
      <TabsList className="bg-white/5 border border-white/10 p-1 rounded-xl h-auto">
        <TabsTrigger
          value="today"
          className="px-8 py-3 text-base font-bold rounded-lg data-[state=active]:bg-[#A48242] data-[state=active]:text-white data-[state=active]:shadow-lg"
        >
          HOY
        </TabsTrigger>
        <TabsTrigger
          value="week"
          className="px-8 py-3 text-base font-bold rounded-lg data-[state=active]:bg-[#A48242] data-[state=active]:text-white data-[state=active]:shadow-lg"
        >
          SEMANA
        </TabsTrigger>
        <TabsTrigger
          value="month"
          className="px-8 py-3 text-base font-bold rounded-lg data-[state=active]:bg-[#A48242] data-[state=active]:text-white data-[state=active]:shadow-lg"
        >
          MES
        </TabsTrigger>
      </TabsList>

      {/* ==================== TODAY ==================== */}
      <TabsContent value="today" className="space-y-4 mt-0">
        {/* ROW 1: KPI Semaphores */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SemaphoreCard
            title="Producción vs Plan"
            value={`${kpis.productionPct}%`}
            subtitle={`${todayOrders.filter(o => o.status === "completed").length}/${todayOrders.length} órdenes`}
            icon={<Factory size={24} />}
            color={productionSemaphore}
            trend="up"
          />
          <SemaphoreCard
            title="Eficiencia Línea"
            value={`${kpis.efficiencyPct}%`}
            subtitle="Rendimiento actual"
            icon={<Gauge size={24} />}
            color={efficiencySemaphore}
            trend="stable"
          />
          <SemaphoreCard
            title="Stock Insumos"
            value={`${kpis.minDaysStock}d`}
            subtitle="Insumo más crítico"
            icon={<Package size={24} />}
            color={stockSemaphore}
            trend="down"
          />
          <SemaphoreCard
            title="Paradas de Línea"
            value={`${kpis.lineStops}`}
            subtitle="En el turno actual"
            icon={<AlertTriangle size={24} />}
            color={stopsSemaphore}
          />
        </div>

        {/* ROW 2: Production Table */}
        <ProductionTable orders={todayOrders} />

        {/* ROW 3: Stock + Chart */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ minHeight: 350 }}>
          <StockPanel supplies={supplies} />
          <ProductionChart orders={todayOrders} />
        </div>

        {/* ROW 4: Alerts */}
        <AlertsPanel alerts={alerts} onAcknowledge={handleAcknowledge} />
      </TabsContent>

      {/* ==================== WEEK ==================== */}
      <TabsContent value="week" className="mt-0">
        <WeeklyView data={weeklyData} />
      </TabsContent>

      {/* ==================== MONTH ==================== */}
      <TabsContent value="month" className="mt-0">
        <MonthlyView data={monthlyData} />
      </TabsContent>
    </Tabs>
  );
}
