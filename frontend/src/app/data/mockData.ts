// Mock data for the application

export interface User {
  id: string;
  name: string;
  email: string;
  role: "vendedor" | "supervisor" | "admin";
  zone: string;
}

export interface PointOfSale {
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
}

export interface Visit {
  id: string;
  posId: string;
  posName: string;
  userId: string;
  userName: string;
  checkInTime: string;
  checkOutTime?: string;
  duration?: number;
  status: "in-progress" | "completed";
  score?: number;
  observations?: string;
  photos?: Photo[];
  surveyData?: any;
  gpsAccuracy: "ok" | "out-of-range";
}

export interface Photo {
  id: string;
  category: "storefront" | "shelf" | "pop" | "price" | "other";
  url: string;
  timestamp: string;
  synced: boolean;
}

export interface Alert {
  id: string;
  posId: string;
  posName: string;
  type: "stock-out" | "missing-material" | "price-issue" | "closed";
  description: string;
  priority: "high" | "medium" | "low";
  status: "open" | "in-progress" | "resolved";
  createdAt: string;
  resolvedAt?: string;
}

// Mock current user
export const currentUser: User = {
  id: "1",
  name: "Carlos Martínez",
  email: "carlos.martinez@empresa.com",
  role: "admin",
  zone: "Zona Norte - CABA",
};

// Base points of sale
const basePointsOfSale: Omit<PointOfSale, "status" | "priority" | "estimatedTime" | "lastVisit">[] = [
  {
    id: "1",
    name: "Kiosco El Rápido",
    address: "Av. Santa Fe 1234, CABA",
    channel: "Kiosco",
    distributor: "Distribuidora Norte SA",
    contact: "Juan Pérez",
    phone: "+54 11 4567-8901",
    lat: -34.5935,
    lng: -58.4173,
    compliance: 85,
    recentIssues: 1,
  },
  {
    id: "2",
    name: "Autoservicio La Esquina",
    address: "Av. Cabildo 2345, CABA",
    channel: "Autoservicio",
    distributor: "Distribuidora Norte SA",
    contact: "María González",
    phone: "+54 11 4567-8902",
    lat: -34.5629,
    lng: -58.4540,
    compliance: 92,
    recentIssues: 0,
  },
  {
    id: "3",
    name: "Mayorista Central",
    address: "Av. Corrientes 3456, CABA",
    channel: "Mayorista",
    distributor: "Distribuidora Centro SA",
    contact: "Roberto Silva",
    phone: "+54 11 4567-8903",
    lat: -34.6037,
    lng: -58.4116,
    compliance: 78,
    recentIssues: 2,
  },
  {
    id: "4",
    name: "Kiosco Belgrano",
    address: "Av. Cabildo 3567, CABA",
    channel: "Kiosco",
    distributor: "Distribuidora Norte SA",
    contact: "Ana Torres",
    phone: "+54 11 4567-8904",
    lat: -34.5595,
    lng: -58.4573,
    compliance: 88,
    recentIssues: 0,
  },
  {
    id: "5",
    name: "Supermercado Express",
    address: "Av. Las Heras 4678, CABA",
    channel: "Supermercado",
    distributor: "Distribuidora Centro SA",
    contact: "Luis Ramírez",
    phone: "+54 11 4567-8905",
    lat: -34.5879,
    lng: -58.3974,
    compliance: 95,
    recentIssues: 0,
  },
  {
    id: "6",
    name: "Kiosco San Telmo",
    address: "Defensa 567, CABA",
    channel: "Kiosco",
    distributor: "Distribuidora Sur SA",
    contact: "Pedro Gómez",
    phone: "+54 11 4567-8906",
    lat: -34.6217,
    lng: -58.3724,
    compliance: 75,
    recentIssues: 1,
  },
  {
    id: "7",
    name: "Autoservicio Palermo",
    address: "Av. Santa Fe 3890, CABA",
    channel: "Autoservicio",
    distributor: "Distribuidora Norte SA",
    contact: "Laura Díaz",
    phone: "+54 11 4567-8907",
    lat: -34.5881,
    lng: -58.4050,
    compliance: 90,
    recentIssues: 0,
  },
];

// Function to generate points of sale for a specific date
export function getPointsOfSaleForDate(date: Date): PointOfSale[] {
  const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
  const dateStr = date.toISOString().split('T')[0];
  
  // Different routes for different days
  if (dayOfWeek === 0) {
    // Sunday - no visits
    return [];
  }
  
  if (dayOfWeek === 1) {
    // Monday - 5 visits
    return [
      { ...basePointsOfSale[0], status: "pending", priority: "high", estimatedTime: "09:00", lastVisit: "2026-02-18" },
      { ...basePointsOfSale[1], status: "pending", priority: "medium", estimatedTime: "11:00", lastVisit: "2026-02-20" },
      { ...basePointsOfSale[2], status: "completed", priority: "low", estimatedTime: "14:00", lastVisit: dateStr },
      { ...basePointsOfSale[3], status: "pending", priority: "medium", estimatedTime: "16:00", lastVisit: "2026-02-19" },
      { ...basePointsOfSale[4], status: "in-progress", priority: "high", estimatedTime: "10:30", lastVisit: "2026-02-17" },
    ];
  }
  
  if (dayOfWeek === 2) {
    // Tuesday - 4 visits
    return [
      { ...basePointsOfSale[1], status: "completed", priority: "high", estimatedTime: "09:30", lastVisit: dateStr },
      { ...basePointsOfSale[3], status: "completed", priority: "medium", estimatedTime: "11:30", lastVisit: dateStr },
      { ...basePointsOfSale[5], status: "pending", priority: "high", estimatedTime: "14:00", lastVisit: "2026-02-16" },
      { ...basePointsOfSale[6], status: "pending", priority: "low", estimatedTime: "16:30", lastVisit: "2026-02-18" },
    ];
  }
  
  if (dayOfWeek === 3) {
    // Wednesday - 6 visits
    return [
      { ...basePointsOfSale[0], status: "completed", priority: "medium", estimatedTime: "08:30", lastVisit: dateStr },
      { ...basePointsOfSale[2], status: "pending", priority: "high", estimatedTime: "10:00", lastVisit: "2026-02-19" },
      { ...basePointsOfSale[4], status: "pending", priority: "high", estimatedTime: "12:00", lastVisit: "2026-02-20" },
      { ...basePointsOfSale[5], status: "pending", priority: "medium", estimatedTime: "14:30", lastVisit: "2026-02-17" },
      { ...basePointsOfSale[6], status: "pending", priority: "low", estimatedTime: "16:00", lastVisit: "2026-02-18" },
      { ...basePointsOfSale[1], status: "not-visited", priority: "low", estimatedTime: "17:30", lastVisit: "2026-02-21" },
    ];
  }
  
  if (dayOfWeek === 4) {
    // Thursday - 5 visits
    return [
      { ...basePointsOfSale[2], status: "completed", priority: "high", estimatedTime: "09:00", lastVisit: dateStr },
      { ...basePointsOfSale[4], status: "completed", priority: "high", estimatedTime: "11:00", lastVisit: dateStr },
      { ...basePointsOfSale[0], status: "pending", priority: "medium", estimatedTime: "13:30", lastVisit: "2026-02-20" },
      { ...basePointsOfSale[3], status: "pending", priority: "medium", estimatedTime: "15:30", lastVisit: "2026-02-19" },
      { ...basePointsOfSale[6], status: "pending", priority: "low", estimatedTime: "17:00", lastVisit: "2026-02-18" },
    ];
  }
  
  if (dayOfWeek === 5) {
    // Friday - 4 visits
    return [
      { ...basePointsOfSale[1], status: "completed", priority: "medium", estimatedTime: "09:00", lastVisit: dateStr },
      { ...basePointsOfSale[5], status: "completed", priority: "high", estimatedTime: "11:30", lastVisit: dateStr },
      { ...basePointsOfSale[6], status: "pending", priority: "medium", estimatedTime: "14:00", lastVisit: "2026-02-19" },
      { ...basePointsOfSale[0], status: "pending", priority: "low", estimatedTime: "16:00", lastVisit: "2026-02-21" },
    ];
  }
  
  // Saturday - 3 visits
  return [
    { ...basePointsOfSale[0], status: "completed", priority: "high", estimatedTime: "09:00", lastVisit: dateStr },
    { ...basePointsOfSale[3], status: "pending", priority: "medium", estimatedTime: "11:00", lastVisit: "2026-02-20" },
    { ...basePointsOfSale[4], status: "pending", priority: "low", estimatedTime: "13:00", lastVisit: "2026-02-18" },
  ];
}

// Function to get alerts for a specific date
export function getAlertsForDate(date: Date): Alert[] {
  const dayOfWeek = date.getDay();
  const dateStr = date.toISOString().split('T')[0];
  
  if (dayOfWeek === 0) return [];
  
  if (dayOfWeek === 1) {
    return [
      {
        id: "a1",
        posId: "1",
        posName: "Kiosco El Rápido",
        type: "stock-out",
        description: "Quiebre de stock en Marlboro Red Box",
        priority: "high",
        status: "open",
        createdAt: `${dateStr}T10:00:00`,
      },
      {
        id: "a2",
        posId: "3",
        posName: "Mayorista Central",
        type: "missing-material",
        description: "Falta material POP - Display de mostrador",
        priority: "medium",
        status: "in-progress",
        createdAt: `${dateStr}T14:30:00`,
      },
      {
        id: "a3",
        posId: "2",
        posName: "Autoservicio La Esquina",
        type: "price-issue",
        description: "Precio fuera de acuerdo comercial",
        priority: "high",
        status: "open",
        createdAt: `${dateStr}T08:00:00`,
      },
    ];
  }
  
  if (dayOfWeek === 2) {
    return [
      {
        id: "a4",
        posId: "5",
        posName: "Kiosco San Telmo",
        type: "missing-material",
        description: "Cartelería de precios deteriorada",
        priority: "medium",
        status: "open",
        createdAt: `${dateStr}T11:00:00`,
      },
    ];
  }
  
  if (dayOfWeek === 3) {
    return [
      {
        id: "a5",
        posId: "2",
        posName: "Mayorista Central",
        type: "stock-out",
        description: "Falta de stock en Lucky Strike",
        priority: "high",
        status: "open",
        createdAt: `${dateStr}T09:30:00`,
      },
      {
        id: "a6",
        posId: "4",
        posName: "Supermercado Express",
        type: "price-issue",
        description: "Descuento no aplicado correctamente",
        priority: "medium",
        status: "open",
        createdAt: `${dateStr}T13:00:00`,
      },
    ];
  }
  
  if (dayOfWeek === 4) {
    return [];
  }
  
  if (dayOfWeek === 5) {
    return [
      {
        id: "a7",
        posId: "6",
        posName: "Autoservicio Palermo",
        type: "closed",
        description: "Punto de venta cerrado en horario planificado",
        priority: "high",
        status: "open",
        createdAt: `${dateStr}T14:30:00`,
      },
    ];
  }
  
  return [];
}

// Original exports for backward compatibility (default to Feb 23, 2026)
export const pointsOfSale: PointOfSale[] = getPointsOfSaleForDate(new Date(2026, 1, 23));
export const alerts: Alert[] = getAlertsForDate(new Date(2026, 1, 23));

// Mock visits
export const visits: Visit[] = [
  {
    id: "v1",
    posId: "3",
    posName: "Mayorista Central",
    userId: "1",
    userName: "Carlos Martínez",
    checkInTime: "2026-02-21T14:15:00",
    checkOutTime: "2026-02-21T14:45:00",
    duration: 30,
    status: "completed",
    score: 85,
    observations: "Stock completo, falta material POP en entrada",
    gpsAccuracy: "ok",
    photos: [
      {
        id: "p1",
        category: "storefront",
        url: "https://images.unsplash.com/photo-1604719312566-8912e9227c6a",
        timestamp: "2026-02-21T14:20:00",
        synced: true,
      },
      {
        id: "p2",
        category: "shelf",
        url: "https://images.unsplash.com/photo-1578916171728-46686eac8d58",
        timestamp: "2026-02-21T14:25:00",
        synced: true,
      },
    ],
  },
  {
    id: "v2",
    posId: "5",
    posName: "Supermercado Express",
    userId: "1",
    userName: "Carlos Martínez",
    checkInTime: "2026-02-23T10:35:00",
    status: "in-progress",
    gpsAccuracy: "ok",
  },
  {
    id: "v3",
    posId: "1",
    posName: "Kiosco El Rápido",
    userId: "1",
    userName: "Carlos Martínez",
    checkInTime: "2026-02-18T09:10:00",
    checkOutTime: "2026-02-18T09:35:00",
    duration: 25,
    status: "completed",
    score: 90,
    observations: "Excelente exhibición, precios correctos",
    gpsAccuracy: "ok",
    photos: [
      {
        id: "p3",
        category: "storefront",
        url: "https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a",
        timestamp: "2026-02-18T09:15:00",
        synced: true,
      },
    ],
  },
];

// Sync status
export const syncStatus = {
  lastSync: "2026-02-23T08:00:00",
  pendingRecords: 3,
  pendingPhotos: 2,
  isOnline: true,
};