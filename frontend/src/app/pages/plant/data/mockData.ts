// ============================================================
// Mock Data - Dashboard Planta Productiva de Tabaco
// ============================================================

export interface ProductionOrder {
  id: number;
  brand: string;
  product: string;
  plannedQty: number;
  producedQty: number;
  unit: "cajas" | "packs";
  line: number;
  startTime: string;
  estimatedEnd: string;
  status: "completed" | "in-progress" | "pending" | "delayed";
}

export interface Supply {
  id: number;
  name: string;
  category: "tabaco" | "filtros" | "papel" | "packaging" | "otros";
  currentStock: number;
  unit: string;
  dailyConsumption: number;
  daysRemaining: number;
  minDays: number;
  status: "ok" | "warning" | "critical";
}

export interface PlantAlert {
  id: number;
  type: "line-stop" | "low-stock" | "delay" | "brand-change" | "quality";
  severity: "info" | "warning" | "critical";
  message: string;
  timestamp: string;
  acknowledged: boolean;
  line?: number;
}

export interface DailyProduction {
  day: string;
  dayLabel: string;
  planned: number;
  produced: number;
  efficiency: number;
}

export interface WeeklyProductionSummary {
  weekNumber: number;
  weekLabel: string;
  planned: number;
  produced: number;
  efficiency: number;
  lineStops: number;
  avgEfficiency: number;
}

export type SemaphoreColor = "green" | "yellow" | "red";

export function getSemaphoreColor(value: number, thresholds: { green: number; yellow: number }): SemaphoreColor {
  if (value >= thresholds.green) return "green";
  if (value >= thresholds.yellow) return "yellow";
  return "red";
}

export function getStockSemaphore(daysRemaining: number): SemaphoreColor {
  if (daysRemaining > 3) return "green";
  if (daysRemaining >= 1) return "yellow";
  return "red";
}

export function getStopsSemaphore(stops: number): SemaphoreColor {
  if (stops === 0) return "green";
  if (stops <= 2) return "yellow";
  return "red";
}

// --- Production Orders (Today) ---
export const todayOrders: ProductionOrder[] = [
  {
    id: 1,
    brand: "Jockey Club",
    product: "Jockey Club Suave 20",
    plannedQty: 5000,
    producedQty: 4750,
    unit: "cajas",
    line: 1,
    startTime: "06:00",
    estimatedEnd: "14:00",
    status: "in-progress",
  },
  {
    id: 2,
    brand: "Jockey Club",
    product: "Jockey Club Box 20",
    plannedQty: 3000,
    producedQty: 3100,
    unit: "cajas",
    line: 1,
    startTime: "06:00",
    estimatedEnd: "12:30",
    status: "completed",
  },
  {
    id: 3,
    brand: "Parisiennes",
    product: "Parisiennes Azul 20",
    plannedQty: 4000,
    producedQty: 2800,
    unit: "cajas",
    line: 2,
    startTime: "06:00",
    estimatedEnd: "15:30",
    status: "in-progress",
  },
  {
    id: 4,
    brand: "Viceroy",
    product: "Viceroy Original 20",
    plannedQty: 6000,
    producedQty: 3200,
    unit: "cajas",
    line: 3,
    startTime: "06:00",
    estimatedEnd: "16:00",
    status: "delayed",
  },
  {
    id: 5,
    brand: "Le Mans",
    product: "Le Mans Azul 20",
    plannedQty: 2500,
    producedQty: 0,
    unit: "cajas",
    line: 2,
    startTime: "16:00",
    estimatedEnd: "22:00",
    status: "pending",
  },
  {
    id: 6,
    brand: "Derby",
    product: "Derby Suave 20",
    plannedQty: 3500,
    producedQty: 3500,
    unit: "cajas",
    line: 3,
    startTime: "06:00",
    estimatedEnd: "11:00",
    status: "completed",
  },
  {
    id: 7,
    brand: "Viceroy",
    product: "Viceroy Blue 10",
    plannedQty: 2000,
    producedQty: 0,
    unit: "cajas",
    line: 1,
    startTime: "14:30",
    estimatedEnd: "20:00",
    status: "pending",
  },
];

// --- Supplies ---
export const supplies: Supply[] = [
  { id: 1, name: "Tabaco Virginia", category: "tabaco", currentStock: 12000, unit: "kg", dailyConsumption: 2500, daysRemaining: 4.8, minDays: 3, status: "ok" },
  { id: 2, name: "Tabaco Burley", category: "tabaco", currentStock: 5000, unit: "kg", dailyConsumption: 1800, daysRemaining: 2.8, minDays: 3, status: "warning" },
  { id: 3, name: "Tabaco Oriental", category: "tabaco", currentStock: 800, unit: "kg", dailyConsumption: 900, daysRemaining: 0.9, minDays: 2, status: "critical" },
  { id: 4, name: "Filtros Acetato Std", category: "filtros", currentStock: 500000, unit: "unid", dailyConsumption: 120000, daysRemaining: 4.2, minDays: 3, status: "ok" },
  { id: 5, name: "Filtros Carbón", category: "filtros", currentStock: 80000, unit: "unid", dailyConsumption: 45000, daysRemaining: 1.8, minDays: 2, status: "warning" },
  { id: 6, name: "Papel Cigarrillo", category: "papel", currentStock: 300, unit: "bobinas", dailyConsumption: 50, daysRemaining: 6, minDays: 3, status: "ok" },
  { id: 7, name: "Papel Aluminio", category: "papel", currentStock: 45, unit: "bobinas", dailyConsumption: 20, daysRemaining: 2.3, minDays: 2, status: "warning" },
  { id: 8, name: "Cajillas Jockey Club", category: "packaging", currentStock: 25000, unit: "unid", dailyConsumption: 8000, daysRemaining: 3.1, minDays: 2, status: "ok" },
  { id: 9, name: "Cajillas Viceroy", category: "packaging", currentStock: 5000, unit: "unid", dailyConsumption: 8000, daysRemaining: 0.6, minDays: 2, status: "critical" },
  { id: 10, name: "Film Termocontraíble", category: "packaging", currentStock: 120, unit: "rollos", dailyConsumption: 30, daysRemaining: 4, minDays: 2, status: "ok" },
  { id: 11, name: "Adhesivo Hot Melt", category: "otros", currentStock: 200, unit: "kg", dailyConsumption: 80, daysRemaining: 2.5, minDays: 2, status: "warning" },
  { id: 12, name: "Tinta Impresión", category: "otros", currentStock: 50, unit: "litros", dailyConsumption: 5, daysRemaining: 10, minDays: 3, status: "ok" },
];

// --- Alerts ---
export const initialAlerts: PlantAlert[] = [
  {
    id: 1,
    type: "line-stop",
    severity: "critical",
    message: "Línea 3 detenida - Falla en empaquetadora. Técnico en camino.",
    timestamp: "2026-04-09T10:45:00",
    acknowledged: false,
    line: 3,
  },
  {
    id: 2,
    type: "low-stock",
    severity: "critical",
    message: "Stock crítico: Tabaco Oriental - menos de 1 día de producción.",
    timestamp: "2026-04-09T09:30:00",
    acknowledged: false,
  },
  {
    id: 3,
    type: "low-stock",
    severity: "critical",
    message: "Stock crítico: Cajillas Viceroy - menos de 1 día. Contactar proveedor.",
    timestamp: "2026-04-09T08:15:00",
    acknowledged: true,
  },
  {
    id: 4,
    type: "delay",
    severity: "warning",
    message: "Viceroy Original 20 con retraso de 45 min en Línea 3.",
    timestamp: "2026-04-09T11:00:00",
    acknowledged: false,
    line: 3,
  },
  {
    id: 5,
    type: "brand-change",
    severity: "info",
    message: "Cambio de marca programado Línea 2: Parisiennes → Le Mans a las 16:00.",
    timestamp: "2026-04-09T07:00:00",
    acknowledged: true,
    line: 2,
  },
  {
    id: 6,
    type: "quality",
    severity: "warning",
    message: "Control calidad: lote JC-2026-0409-003 requiere re-inspección.",
    timestamp: "2026-04-09T10:15:00",
    acknowledged: false,
  },
];

// --- Weekly data ---
export const weeklyData: DailyProduction[] = [
  { day: "2026-04-06", dayLabel: "Lun", planned: 24000, produced: 23500, efficiency: 97.9 },
  { day: "2026-04-07", dayLabel: "Mar", planned: 24000, produced: 22800, efficiency: 95.0 },
  { day: "2026-04-08", dayLabel: "Mié", planned: 26000, produced: 24100, efficiency: 92.7 },
  { day: "2026-04-09", dayLabel: "Hoy", planned: 26000, produced: 17350, efficiency: 66.7 },
  { day: "2026-04-10", dayLabel: "Vie", planned: 24000, produced: 0, efficiency: 0 },
  { day: "2026-04-11", dayLabel: "Sáb", planned: 12000, produced: 0, efficiency: 0 },
  { day: "2026-04-12", dayLabel: "Dom", planned: 0, produced: 0, efficiency: 0 },
];

// --- Monthly data ---
export const monthlyData: WeeklyProductionSummary[] = [
  { weekNumber: 14, weekLabel: "Sem 14 (31 Mar-6 Abr)", planned: 136000, produced: 131200, efficiency: 96.5, lineStops: 2, avgEfficiency: 96.5 },
  { weekNumber: 15, weekLabel: "Sem 15 (7-13 Abr)", planned: 136000, produced: 87750, efficiency: 64.5, lineStops: 4, avgEfficiency: 82.1 },
  { weekNumber: 16, weekLabel: "Sem 16 (14-20 Abr)", planned: 140000, produced: 0, efficiency: 0, lineStops: 0, avgEfficiency: 0 },
  { weekNumber: 17, weekLabel: "Sem 17 (21-27 Abr)", planned: 140000, produced: 0, efficiency: 0, lineStops: 0, avgEfficiency: 0 },
];

// --- Chart data: production by brand (today) ---
export function getProductionByBrand(orders: ProductionOrder[]) {
  const brandMap = new Map<string, { planned: number; produced: number }>();
  for (const o of orders) {
    const existing = brandMap.get(o.brand) || { planned: 0, produced: 0 };
    existing.planned += o.plannedQty;
    existing.produced += o.producedQty;
    brandMap.set(o.brand, existing);
  }
  return Array.from(brandMap.entries()).map(([brand, data]) => ({
    brand,
    planned: data.planned,
    produced: data.produced,
  }));
}

// --- KPI calculations ---
export function calculateKPIs(orders: ProductionOrder[], suppliesList: Supply[], alerts: PlantAlert[]) {
  const activeOrders = orders.filter(o => o.status !== "pending");
  const totalPlanned = activeOrders.reduce((s, o) => s + o.plannedQty, 0);
  const totalProduced = activeOrders.reduce((s, o) => s + o.producedQty, 0);
  const productionPct = totalPlanned > 0 ? Math.round((totalProduced / totalPlanned) * 100) : 0;

  const completedOrders = orders.filter(o => o.status === "completed");
  const efficiencyPct = activeOrders.length > 0
    ? Math.round((completedOrders.reduce((s, o) => s + o.producedQty, 0) / completedOrders.reduce((s, o) => s + o.plannedQty, 0)) * 100) || 0
    : 0;

  const minDaysStock = Math.min(...suppliesList.map(s => s.daysRemaining));

  const lineStops = alerts.filter(a => a.type === "line-stop").length;

  return {
    productionPct,
    efficiencyPct: efficiencyPct || 95, // fallback for demo
    minDaysStock: Math.round(minDaysStock * 10) / 10,
    lineStops,
  };
}

// --- Current shift ---
export function getCurrentShift(): { name: string; color: string } {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 14) return { name: "Mañana", color: "bg-amber-400 text-amber-950" };
  if (hour >= 14 && hour < 22) return { name: "Tarde", color: "bg-blue-400 text-blue-950" };
  return { name: "Noche", color: "bg-indigo-600 text-white" };
}
