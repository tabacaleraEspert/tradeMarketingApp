/** Tipos del "Tablero de control de rutas" (GET /routes/board y panel del día). */

export interface BoardRep {
  userId: number;
  name: string;
  zoneId: number | null;
  zoneName: string | null;
  managerId: number | null;
  managerName: string | null;
  role: string;
  isActive: boolean;
}

export interface BoardDay {
  routeDayId: number;
  routeId: number;
  routeName: string;
  routeType: "regular" | "campaign";
  /** "YYYY-MM-DD" */
  workDate: string;
  userId: number;
  status: string;
  pdvCount: number;
  doneCount: number;
  hasVisits: boolean;
  /** No se puede mover ni borrar: con visitas, empezado o de una fecha pasada. */
  locked: boolean;
}

export interface BoardRoute {
  routeId: number;
  name: string;
  routeType: "regular" | "campaign";
  assignedUserId: number | null;
  zoneId: number | null;
  frequencyType: string | null;
  frequencyConfig: string | null;
  endDate: string | null;
  /** null en rutas no vigentes que solo aparecen por tener días en el rango. */
  pdvCount: number | null;
  isLive: boolean;
}

export interface RouteBoardData {
  dateFrom: string;
  dateTo: string;
  /** Hoy en Argentina según el servidor. */
  today: string;
  reps: BoardRep[];
  days: BoardDay[];
  routes: BoardRoute[];
}

export interface BoardDayPdv {
  pdvId: number;
  name: string;
  address: string | null;
  city: string | null;
  plannedOrder: number;
  executionStatus: string;
  hasVisit: boolean;
}

export interface BoardDayDetail {
  routeDayId: number;
  routeId: number;
  routeName: string;
  routeType: "regular" | "campaign";
  frequencyType: string | null;
  frequencyConfig: string | null;
  endDate: string | null;
  workDate: string;
  userId: number;
  userName: string | null;
  status: string;
  hasVisits: boolean;
  locked: boolean;
  pdvs: BoardDayPdv[];
}

export interface BoardPdvCandidate {
  pdvId: number;
  name: string;
  address: string | null;
  city: string | null;
  inRoute: boolean;
}

export interface ShiftWeekdayResult {
  routeId: number;
  frequencyType: string;
  frequencyConfig: string;
  assignedUserId: number | null;
  /** Días corridos al nuevo día de la semana. */
  moved: number;
  /** Días eliminados (pasaban la fecha de fin o chocaban con otro día de la ruta). */
  removed: number;
  /** Días que no se tocaron (con visitas o ya empezados). */
  kept: number;
}
