import type { Pdv } from "./types";
import type { RouteDayPdvWithDetails } from "./hooks";
import type { IncidentWithPdvName } from "./hooks";
import type { Notification } from "./types";

/** Convierte Pdv del API a formato UI (para Buscar PDV) */
export function pdvToPointOfSaleUI(p: Pdv): PointOfSaleUI {
  const primaryContact = p.Contacts?.[0];
  return {
    id: String(p.PdvId),
    name: p.Name,
    address: p.Address || p.City || "Sin dirección",
    channel: p.ChannelName || p.Channel || "-",
    subChannel: p.SubChannelName || undefined,
    distributor: p.DistributorId ? `Distribuidor #${p.DistributorId}` : "-",
    contact: primaryContact?.ContactName || p.ContactName || "-",
    phone: primaryContact?.ContactPhone || p.ContactPhone || "-",
    lat: p.Lat ?? 0,
    lng: p.Lon ?? 0,
    status: "pending",
    priority: "medium",
    compliance: 0,
    recentIssues: 0,
    isActive: p.IsActive,
  };
}

/** Formato de PDV para la UI (Home, RouteList) */
export interface PointOfSaleUI {
  id: string;
  name: string;
  address: string;
  channel: string;
  subChannel?: string;
  distributor: string;
  contact: string;
  phone: string;
  lat: number;
  lng: number;
  lastVisit?: string;
  status: "pending" | "in-progress" | "completed" | "not-visited";
  priority: "high" | "medium" | "low";
  estimatedTime?: string;
  compliance?: number;
  recentIssues?: number;
  isActive?: boolean;
  /** RouteDayId cuando viene de Ruta Foco del Día (para Relevamiento) */
  routeDayId?: number;
  /** Nombre de la ruta (para Home/Agenda) */
  routeName?: string;
}

/** Formato de Alerta para la UI */
export interface AlertUI {
  id: string;
  posId: string;
  posName: string;
  type: string;
  description: string;
  priority: "high" | "medium" | "low";
  status: "open" | "in-progress" | "resolved";
  createdAt: string;
  resolvedAt?: string;
}

const execStatusToUI: Record<string, PointOfSaleUI["status"]> = {
  PENDING: "pending",
  IN_PROGRESS: "in-progress",
  COMPLETED: "completed",
  DONE: "completed",
  NOT_VISITED: "not-visited",
  SKIPPED: "not-visited",
};

const priorityToUI: Record<number, PointOfSaleUI["priority"]> = {
  1: "high",
  2: "medium",
  3: "low",
};

export function routeDayPdvToPointOfSaleUI(
  rdp: RouteDayPdvWithDetails
): PointOfSaleUI {
  const p = rdp.pdv;
  const status =
    execStatusToUI[rdp.ExecutionStatus?.toUpperCase()] || "pending";
  const priority = priorityToUI[rdp.Priority] || "medium";
  const timeFrom = rdp.PlannedWindowFrom;
  const estimatedTime = timeFrom
    ? timeFrom.slice(0, 5)
    : undefined;

  const primaryContact = p.Contacts?.[0];
  return {
    id: String(p.PdvId),
    name: p.Name,
    address: p.Address || p.City || "Sin dirección",
    channel: p.ChannelName || p.Channel || "-",
    subChannel: p.SubChannelName || undefined,
    distributor: p.DistributorId ? `Distribuidor #${p.DistributorId}` : "-",
    contact: primaryContact?.ContactName || p.ContactName || "-",
    phone: primaryContact?.ContactPhone || p.ContactPhone || "-",
    lat: p.Lat ?? 0,
    lng: p.Lon ?? 0,
    status,
    priority,
    estimatedTime,
    compliance: 0,
    recentIssues: 0,
    isActive: p.IsActive,
    routeDayId: rdp.RouteDayId,
    routeName: rdp.routeName,
  };
}

const incidentStatusToUI: Record<string, AlertUI["status"]> = {
  OPEN: "open",
  IN_PROGRESS: "in-progress",
  RESOLVED: "resolved",
  CLOSED: "resolved",
};

const incidentPriorityToUI: Record<number, AlertUI["priority"]> = {
  1: "high",
  2: "medium",
  3: "low",
};

export function incidentToAlertUI(inc: IncidentWithPdvName): AlertUI {
  const status =
    incidentStatusToUI[inc.Status?.toUpperCase()] || "open";
  const priority: AlertUI["priority"] =
    (incidentPriorityToUI[inc.Priority] as AlertUI["priority"]) ?? "medium";

  return {
    id: String(inc.IncidentId),
    posId: inc.PdvId ? String(inc.PdvId) : "",
    posName: inc.posName || `PDV #${inc.PdvId}`,
    type: inc.Type,
    description: inc.Notes || inc.Type,
    priority,
    status,
    createdAt: inc.CreatedAt,
  };
}

const notificationPriorityToUI: Record<number, AlertUI["priority"]> = {
  1: "high",
  2: "medium",
  3: "low",
};

export function notificationToAlertUI(n: Notification): AlertUI {
  const priority: AlertUI["priority"] =
    (notificationPriorityToUI[n.Priority] as AlertUI["priority"]) ?? "medium";
  return {
    id: `notification-${n.NotificationId}`,
    posId: "",
    posName: n.Title,
    type: n.Type || "notification",
    description: n.Message,
    priority,
    status: n.IsActive ? "open" : "resolved",
    createdAt: n.CreatedAt,
  };
}
