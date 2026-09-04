import { api } from "./client";
import { getAccessToken } from "./auth-storage";

// --- Dashboard (aggregated Home endpoint) ---
export interface DashboardHomeData {
  routeDayPdvs: any[];
  openVisit: { VisitId: number; PdvId: number; PdvName: string; Status: string } | null;
  monthlyStats: { visits: number; compliance: number; new_pdvs: number };
  alertCount: number;
}

export const dashboardApi = {
  home: (date: string) => api.get<DashboardHomeData>("/dashboard/home", { date }),
};

// --- Auth ---
export interface LoginResponse {
  UserId: number;
  Email: string;
  DisplayName: string;
  ZoneId: number | null;
  ZoneName?: string | null;
  ManagerUserId?: number | null;
  Role?: string;
  IsActive: boolean;
  MustChangePassword?: boolean;
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface MeResponse {
  UserId: number;
  Email: string;
  DisplayName: string;
  ZoneId: number | null;
  ZoneName?: string | null;
  Role: string;
  IsActive: boolean;
  MustChangePassword?: boolean;
}

// `/auth/me` lo piden varios lugares en el mismo tick del arranque (App.tsx para
// MustChangePassword, AdminLayout.tsx para el rol) — sin esto son 2 requests
// idénticos en paralelo, y contra Azure SQL cada uno cuesta ~2s.
// Se cachea por token: un login, un logout o un "ingresar como" cambian el
// access token y por lo tanto invalidan la entrada sin necesitar limpieza manual.
const ME_CACHE_TTL_MS = 30_000;
let meCache: { token: string; at: number; promise: Promise<MeResponse> } | null = null;

function fetchMe(force = false): Promise<MeResponse> {
  const token = getAccessToken() ?? "";
  const now = Date.now();
  if (!force && meCache && meCache.token === token && now - meCache.at < ME_CACHE_TTL_MS) {
    return meCache.promise;
  }
  const promise = api.get<MeResponse>("/auth/me");
  meCache = { token, at: now, promise };
  // Un /auth/me fallado no se cachea: el próximo intento tiene que volver a pegarle.
  promise.catch(() => {
    if (meCache?.promise === promise) meCache = null;
  });
  return promise;
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>("/auth/login", { email, password }),
  /** @param force ignora el cache de 30s (usar tras cambiar rol/zona del propio usuario). */
  me: (force = false) => fetchMe(force),
  /** Descarta el `/auth/me` cacheado. El cambio de token ya invalida solo; esto
   *  es para el logout (deja el cache limpio) y para los tests. */
  invalidateMe: () => { meCache = null; },
  changePassword: (current_password: string, new_password: string) =>
    api.post<{ ok: boolean }>("/auth/change-password", { current_password, new_password }),
  /** Admin-only: obtiene una sesión como otro usuario (impersonation). */
  impersonate: (userId: number) =>
    api.post<LoginResponse>(`/auth/impersonate/${userId}`, {}),
  /** Autologin con ticket firmado del Command Center Espert. */
  sso: (ticket: string) => api.post<LoginResponse>("/auth/sso", { ticket }),
};

// --- Visit Photos ---
export interface VisitPhotoRead {
  VisitId: number;
  FileId: number;
  PhotoType: string;
  SortOrder: number;
  Notes: string | null;
  url: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

export const visitPhotosApi = {
  list: (visitId: number) =>
    api.get<VisitPhotoRead[]>(`/files/photos/visit/${visitId}`),
  upload: async (
    visitId: number,
    file: Blob,
    opts: { photoType?: string; sortOrder?: number; notes?: string; lat?: number; lon?: number } = {}
  ) => {
    const form = new FormData();
    form.append("file", file, `photo-${Date.now()}.jpg`);
    if (opts.photoType) form.append("photo_type", opts.photoType);
    if (opts.sortOrder != null) form.append("sort_order", String(opts.sortOrder));
    if (opts.notes) form.append("notes", opts.notes);
    if (opts.lat != null) form.append("lat", String(opts.lat));
    if (opts.lon != null) form.append("lon", String(opts.lon));
    return api.upload<VisitPhotoRead>(`/files/photos/visit/${visitId}`, form);
  },
  delete: (visitId: number, fileId: number) =>
    api.delete<void>(`/files/photos/visit/${visitId}/${fileId}`),
};
import type {
  Zone,
  User,
  Role,
  Distributor,
  Pdv,
  PdvContact,
  Channel,
  SubChannel,
  Route,
  RouteStats,
  RoutePdv,
  RouteFormWithForm,
  RouteFormRead,
  RouteDay,
  RouteDayPdv,
  Form,
  FormQuestion,
  FormOption,
  Visit,
  VisitAnswer,
  VisitAction,
  MarketNews,
  ValidateCloseResult,
  DaySummary,
  Incident,
  Notification,
  MandatoryActivity,
  PdvNote,
  Holiday,
  UserVacation,
  Product,
  PdvProductCategory,
  VisitCoverageItem,
  CoverageDiff,
  VisitPOPItem,
  VisitLooseSurvey,
  VisitIndicators,
  SupplierType,
  SupplierProductType,
  PdvSupplier,
} from "./types";

// --- Zones ---
export const zonesApi = {
  list: (params?: { skip?: number; limit?: number }) =>
    api.get<Zone[]>("/zones", params as Record<string, number | undefined>),
  get: (id: number) => api.get<Zone>(`/zones/${id}`),
  create: (data: { Name: string }) => api.post<Zone>("/zones", data),
  update: (id: number, data: { Name?: string }) =>
    api.patch<Zone>(`/zones/${id}`, data),
  delete: (id: number) => api.delete(`/zones/${id}`),
};

// --- Users ---
export const usersApi = {
  list: (params?: { skip?: number; limit?: number }) =>
    api.get<User[]>("/users", params as Record<string, number | undefined>),
  get: (id: number) => api.get<User>(`/users/${id}`),
  create: (data: {
    Email: string;
    DisplayName: string;
    DNI?: string | null;
    Password?: string;
    ZoneId?: number | null;
    IsActive?: boolean;
  }) => api.post<User>("/users", data),
  update: (
    id: number,
    data: {
      Email?: string;
      DisplayName?: string;
      DNI?: string | null;
      Password?: string;
      ZoneId?: number | null;
      IsActive?: boolean;
    }
  ) => api.patch<User>(`/users/${id}`, data),
  delete: (id: number) => api.delete(`/users/${id}`),
  // Vacaciones
  listVacations: (userId: number, year?: number) =>
    api.get<UserVacation[]>(`/users/${userId}/vacations`, year ? { year } : undefined),
  createVacation: (userId: number, data: { FromDate: string; ToDate: string; Reason?: string }) =>
    api.post<UserVacation>(`/users/${userId}/vacations`, data),
  deleteVacation: (vacationId: number) =>
    api.delete(`/users/vacations/${vacationId}`),
  uploadAvatar: (userId: number, file: Blob) => {
    const form = new FormData();
    form.append("file", file, `avatar-${userId}.jpg`);
    return api.upload<User>(`/users/${userId}/avatar`, form);
  },
  deleteAvatar: (userId: number) => api.delete<User>(`/users/${userId}/avatar`),
  getMonthlyStats: (userId: number) =>
    api.get<{ visits: number; compliance: number; new_pdvs: number }>(
      `/users/${userId}/stats/monthly`
    ),
  getRole: (userId: number) =>
    api.get<{ userId: number; roleId: number | null; roleName: string | null }>(
      `/users/${userId}/role`
    ),
  setRole: (userId: number, roleId: number) =>
    api.put(`/users/${userId}/role`, { roleId }),
};

// --- Roles ---
export const rolesApi = {
  list: (params?: { skip?: number; limit?: number }) =>
    api.get<Role[]>("/roles", params as Record<string, number | undefined>),
  get: (id: number) => api.get<Role>(`/roles/${id}`),
  create: (data: { Name: string }) => api.post<Role>("/roles", data),
  update: (id: number, data: { Name?: string }) =>
    api.patch<Role>(`/roles/${id}`, data),
  delete: (id: number) => api.delete(`/roles/${id}`),
};

// --- Distributors ---
export const distributorsApi = {
  list: (params?: { skip?: number; limit?: number }) =>
    api.get<Distributor[]>("/distributors", params as Record<string, number | undefined>),
  get: (id: number) => api.get<Distributor>(`/distributors/${id}`),
  create: (data: { Name: string; Phone?: string; DistributorType?: string; SupplierSource?: string; IsActive?: boolean }) =>
    api.post<Distributor>("/distributors", data),
  update: (id: number, data: { Name?: string; Phone?: string; DistributorType?: string; SupplierSource?: string; IsActive?: boolean }) =>
    api.patch<Distributor>(`/distributors/${id}`, data),
  delete: (id: number) => api.delete(`/distributors/${id}`),
};

// --- Channels ---
export const channelsApi = {
  list: () => api.get<Channel[]>("/channels"),
  listAll: () => api.get<Channel[]>("/channels/all"),
  get: (id: number) => api.get<Channel>(`/channels/${id}`),
  create: (data: { Name: string; Description?: string; IsActive?: boolean }) =>
    api.post<Channel>("/channels", data),
  update: (id: number, data: { Name?: string; Description?: string; IsActive?: boolean }) =>
    api.patch<Channel>(`/channels/${id}`, data),
  delete: (id: number) => api.delete(`/channels/${id}`),
  hardDelete: (id: number) => api.delete(`/channels/${id}?hard=true`),
};

// --- Products ---
export const productsApi = {
  list: (params?: { category?: string; active_only?: boolean }) =>
    api.get<Product[]>("/products", params),
  get: (id: number) => api.get<Product>(`/products/${id}`),
  create: (data: {
    Name: string;
    Category: string;
    Manufacturer?: string | null;
    IsOwn?: boolean;
    IsActive?: boolean;
    SortOrder?: number;
  }) => api.post<Product>("/products", data),
  update: (id: number, data: {
    Name?: string;
    Category?: string;
    Manufacturer?: string | null;
    IsOwn?: boolean;
    IsActive?: boolean;
    SortOrder?: number;
  }) => api.patch<Product>(`/products/${id}`, data),
  delete: (id: number) => api.delete(`/products/${id}`),
};

// --- PDV Product Categories ---
export const pdvProductCategoriesApi = {
  list: (pdvId: number) =>
    api.get<PdvProductCategory[]>(`/pdvs/${pdvId}/product-categories`),
  bulkUpsert: (pdvId: number, categories: Array<{ Category: string; Status: string }>) =>
    api.put<PdvProductCategory[]>(`/pdvs/${pdvId}/product-categories`, { categories }),
  update: (pdvId: number, categoryId: number, data: { Status: string }) =>
    api.patch<PdvProductCategory>(`/pdvs/${pdvId}/product-categories/${categoryId}`, data),
};

// --- Visit Coverage ---
export const visitCoverageApi = {
  list: (visitId: number) =>
    api.get<VisitCoverageItem[]>(`/visits/${visitId}/coverage`),
  bulkSave: (visitId: number, items: Array<{ ProductId: number; Works: boolean; Price?: number; Availability?: string }>) =>
    api.put<VisitCoverageItem[]>(`/visits/${visitId}/coverage`, { items }),
  diff: (visitId: number) =>
    api.get<CoverageDiff[]>(`/visits/${visitId}/coverage/diff`),
  requirements: (visitId: number) =>
    api.get<{
      ownRequired: boolean;
      competitorRequired: boolean;
      competitorEveryN: number;
      visitNumber: number;
      nextCompetitorAt: number;
    }>(`/visits/${visitId}/coverage/requirements`),
};

// --- Visit POP ---
export const visitPOPApi = {
  list: (visitId: number) =>
    api.get<VisitPOPItem[]>(`/visits/${visitId}/pop`),
  bulkSave: (visitId: number, items: Array<{ MaterialType: string; MaterialName: string; Company?: string; Present: boolean; HasPrice?: boolean }>) =>
    api.put<VisitPOPItem[]>(`/visits/${visitId}/pop`, { items }),
};

// --- Visit Loose Survey ---
export const visitLooseApi = {
  get: (visitId: number) =>
    api.get<VisitLooseSurvey | null>(`/visits/${visitId}/loose-survey`),
  save: (visitId: number, data: { SellsLoose: boolean; ProductsJson?: string; ExchangeJson?: string }) =>
    api.put<VisitLooseSurvey>(`/visits/${visitId}/loose-survey`, data),
};

// --- Visit Indicators ---
export const visitIndicatorsApi = {
  get: (visitId: number) =>
    api.get<VisitIndicators>(`/visits/${visitId}/indicators`),
};

// --- SubChannels ---
export const subchannelsApi = {
  list: (channelId?: number) =>
    api.get<SubChannel[]>("/subchannels", channelId ? { channel_id: channelId } : {}),
  listAll: (channelId?: number) =>
    api.get<SubChannel[]>("/subchannels/all", channelId ? { channel_id: channelId } : {}),
  get: (id: number) => api.get<SubChannel>(`/subchannels/${id}`),
  create: (data: { ChannelId: number; Name: string; Description?: string; IsActive?: boolean }) =>
    api.post<SubChannel>("/subchannels", data),
  update: (id: number, data: { ChannelId?: number; Name?: string; Description?: string; IsActive?: boolean }) =>
    api.patch<SubChannel>(`/subchannels/${id}`, data),
  delete: (id: number) => api.delete(`/subchannels/${id}`),
};

// --- PDVs ---
// --- PDV Photos ---
export interface PdvPhotoRead {
  PdvId: number;
  FileId: number;
  PhotoType: string;
  SortOrder: number;
  Notes: string | null;
  url: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

export const pdvPhotosApi = {
  list: (pdvId: number) =>
    api.get<PdvPhotoRead[]>(`/files/photos/pdv/${pdvId}`),
  upload: async (
    pdvId: number,
    file: Blob,
    opts: { photoType?: string; sortOrder?: number; notes?: string; lat?: number; lon?: number } = {}
  ) => {
    const form = new FormData();
    form.append("file", file, `pdv-photo-${Date.now()}.jpg`);
    if (opts.photoType) form.append("photo_type", opts.photoType);
    if (opts.sortOrder != null) form.append("sort_order", String(opts.sortOrder));
    if (opts.notes) form.append("notes", opts.notes);
    if (opts.lat != null) form.append("lat", String(opts.lat));
    if (opts.lon != null) form.append("lon", String(opts.lon));
    return api.upload<PdvPhotoRead>(`/files/photos/pdv/${pdvId}`, form);
  },
  delete: (pdvId: number, fileId: number) =>
    api.delete<void>(`/files/photos/pdv/${pdvId}/${fileId}`),
};

export interface PdvCreateData {
  Code?: string;
  Name: string;
  ChannelId: number;
  SubChannelId?: number;
  Address?: string;
  City?: string;
  ZoneId?: number;
  DistributorId?: number;
  DistributorIds?: number[];
  Lat?: number;
  Lon?: number;
  Contacts?: { ContactName: string; ContactPhone?: string; ContactRole?: string; DecisionPower?: string; Birthday?: string }[];
  DefaultMaterialExternalId?: string;
  AssignedUserId?: number | null;
  IsActive?: boolean;
  WorksEspertProducts?: boolean | null;
  SellsLooseCigarettes?: boolean | null;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  skip: number;
  limit: number;
}

const PDV_PAGE_SIZE = 500;
// Máximo de páginas pedidas a la vez. Sin esto, un padrón grande dispara
// todas las páginas en un solo Promise.all y satura el backend (cada request
// recalcula visibilidad jerárquica).
const PDV_PAGE_CONCURRENCY = 3;

export const pdvsApi = {
  /** Fetches all PDVs matching filters, auto-paginating in chunks of 500. */
  list: async (params?: {
    skip?: number;
    limit?: number;
    zone_id?: number;
    distributor_id?: number;
  }): Promise<Pdv[]> => {
    const { zone_id, distributor_id } = params ?? {};
    const first = await api.get<PaginatedResponse<Pdv>>("/pdvs", {
      skip: 0, limit: PDV_PAGE_SIZE, zone_id, distributor_id,
    });
    const all: Pdv[] = [...first.items];
    if (first.total > PDV_PAGE_SIZE) {
      const remaining = Math.ceil((first.total - PDV_PAGE_SIZE) / PDV_PAGE_SIZE);
      for (let start = 0; start < remaining; start += PDV_PAGE_CONCURRENCY) {
        const batch = Array.from(
          { length: Math.min(PDV_PAGE_CONCURRENCY, remaining - start) },
          (_, i) =>
            api.get<PaginatedResponse<Pdv>>("/pdvs", {
              skip: (start + i + 1) * PDV_PAGE_SIZE, limit: PDV_PAGE_SIZE, zone_id, distributor_id,
            })
        );
        for (const page of await Promise.all(batch)) all.push(...page.items);
      }
    }
    return all;
  },
  /** Fetches a single page (for UIs that want explicit pagination). */
  listPage: (params: {
    skip?: number;
    limit?: number;
    zone_id?: number;
    distributor_id?: number;
  }) => api.get<PaginatedResponse<Pdv>>("/pdvs", params),
  get: (id: number) => api.get<Pdv>(`/pdvs/${id}`),
  create: (data: PdvCreateData) => api.post<Pdv>("/pdvs", data),
  update: (id: number, data: Partial<PdvCreateData> & { Contacts?: { ContactName: string; ContactPhone?: string; ContactRole?: string; DecisionPower?: string; Birthday?: string }[] }) =>
    api.patch<Pdv>(`/pdvs/${id}`, data),
  delete: (id: number) => api.delete(`/pdvs/${id}`),
};

// --- Holidays ---
export const holidaysApi = {
  list: (params?: { from?: string; to?: string; active_only?: boolean }) =>
    api.get<Holiday[]>("/holidays", params as Record<string, string | boolean | undefined>),
  check: (date: string) =>
    api.get<{ date: string; isHoliday: boolean; name?: string; kind?: string }>(`/holidays/check/${date}`),
  create: (data: { Date: string; Name: string; Kind?: string; IsActive?: boolean }) =>
    api.post<Holiday>("/holidays", data),
  update: (id: number, data: Partial<{ Date: string; Name: string; Kind: string; IsActive: boolean }>) =>
    api.patch<Holiday>(`/holidays/${id}`, data),
  delete: (id: number) => api.delete(`/holidays/${id}`),
};

// --- PDV Notes ---
export const pdvNotesApi = {
  list: (pdvId: number, openOnly = false) =>
    api.get<PdvNote[]>(`/pdvs/${pdvId}/notes`, openOnly ? { open_only: true } : undefined),
  create: (pdvId: number, data: { Content: string; CreatedByUserId?: number; VisitId?: number }) =>
    api.post<PdvNote>(`/pdvs/${pdvId}/notes`, data),
  update: (noteId: number, data: { Content?: string; IsResolved?: boolean; ResolvedByUserId?: number }) =>
    api.patch<PdvNote>(`/pdvs/notes/${noteId}`, data),
  delete: (noteId: number) => api.delete(`/pdvs/notes/${noteId}`),
};

// --- Routes ---
export const BEJERMAN_ZONES = ["Litoral", "GBA Sur", "GBA Norte", "Patagonia"] as const;

export const routesApi = {
  /** Fetches all routes matching filters, auto-paginating (backend caps at 500/página). */
  list: async (params?: { created_by?: number; assigned_user_id?: number }): Promise<Route[]> => {
    const PAGE = 500;
    const all: Route[] = [];
    for (let skip = 0; ; skip += PAGE) {
      const page = await api.get<Route[]>("/routes", { ...params, skip, limit: PAGE });
      all.push(...page);
      if (page.length < PAGE) break;
    }
    return all;
  },
  get: (id: number) => api.get<Route>(`/routes/${id}`),
  /** Totales para las cards de admin (no requiere traer todas las rutas). */
  stats: () => api.get<RouteStats>("/routes/stats"),
  getBejermanZones: () => api.get<{ zones: string[] }>("/routes/bejerman-zones"),
  create: (data: {
    Name: string;
    ZoneId?: number;
    FormId?: number;
    IsActive?: boolean;
    CreatedByUserId?: number;
    BejermanZone?: string;
    FrequencyType?: string;
    FrequencyConfig?: string;
    EstimatedMinutes?: number;
    AssignedUserId?: number;
    IsFocus?: boolean;
  }) => api.post<Route>("/routes", data),
  update: (
    id: number,
    data: {
      Name?: string;
      ZoneId?: number;
      FormId?: number;
      IsActive?: boolean;
      BejermanZone?: string;
      FrequencyType?: string | null;
      FrequencyConfig?: string | null;
      EstimatedMinutes?: number;
      AssignedUserId?: number | null;
      IsOptimized?: boolean;
      IsFocus?: boolean;
    }
  ) => api.patch<Route>(`/routes/${id}`, data),
  delete: (id: number) => api.delete(`/routes/${id}`),

  // Route PDVs
  listPdvs: (routeId: number) =>
    api.get<RoutePdv[]>(`/routes/${routeId}/pdvs`),
  listPdvAssignments: () =>
    api.get<{ pdvId: number; routeId: number }[]>(`/routes/pdv-assignments`),
  addPdv: (routeId: number, data: { PdvId: number; SortOrder: number; Priority?: number }) =>
    api.post<RoutePdv>(`/routes/${routeId}/pdvs`, data),
  removePdv: (routeId: number, pdvId: number) =>
    api.delete(`/routes/${routeId}/pdvs/${pdvId}`),

  // Route Forms (múltiples por ruta)
  listForms: (routeId: number) =>
    api.get<RouteFormWithForm[]>(`/routes/${routeId}/forms`),
  addForm: (routeId: number, data: { FormId: number; SortOrder?: number }) =>
    api.post<RouteFormRead>(`/routes/${routeId}/forms`, data),
  removeForm: (routeId: number, formId: number) =>
    api.delete(`/routes/${routeId}/forms/${formId}`),

  // Route Day Forms (para Relevamiento)
  listDayForms: (routeDayId: number) =>
    api.get<RouteFormWithForm[]>(`/routes/days/${routeDayId}/forms`),

  // Route Days
  listDays: (routeId: number) =>
    api.get<RouteDay[]>(`/routes/${routeId}/days`),
  createDay: (routeId: number, data: { WorkDate: string; AssignedUserId?: number; Status?: string }) =>
    api.post<RouteDay>(`/routes/${routeId}/days`, data),
  getDay: (routeDayId: number) =>
    api.get<RouteDay>(`/routes/days/${routeDayId}`),
  updateDay: (routeDayId: number, data: { Status?: string }) =>
    api.patch<RouteDay>(`/routes/days/${routeDayId}`, data),
  deleteDay: (routeDayId: number) =>
    api.delete(`/routes/days/${routeDayId}`),

  // Route Day PDVs
  listDayPdvs: (routeDayId: number) =>
    api.get<RouteDayPdv[]>(`/routes/days/${routeDayId}/pdvs`),
  addDayPdv: (
    routeDayId: number,
    data: {
      PdvId: number;
      PlannedOrder: number;
      PlannedWindowFrom?: string;
      PlannedWindowTo?: string;
      Priority?: number;
      ExecutionStatus?: string;
    }
  ) => api.post<RouteDayPdv>(`/routes/days/${routeDayId}/pdvs`, data),
  updateDayPdv: (routeDayId: number, pdvId: number, data: { ExecutionStatus?: string }) =>
    api.patch<RouteDayPdv>(`/routes/days/${routeDayId}/pdvs/${pdvId}`, data),

  // Reorder PDVs
  reorderPdvs: (routeId: number, pdvIds: number[]) =>
    api.put<RoutePdv[]>(`/routes/${routeId}/pdvs/reorder`, pdvIds),

  // Overlap detection
  checkOverlap: (routeId: number) =>
    api.get<{
      overlaps: Array<{ routeId: number; routeName: string; overlapDates: string[]; overlapCount: number }>;
      hasOverlap: boolean;
    }>(`/routes/${routeId}/check-overlap`),

  // Route Generation
  generateProposal: (data: {
    pdv_ids: number[];
    max_routes?: number;
    min_pdvs_per_route?: number;
    max_pdvs_per_route?: number;
    route_name_prefix?: string;
  }) => api.post<{
    routes: {
      index: number;
      name: string;
      pdvs: { PdvId: number; Name: string; Address: string | null; Lat: number | null; Lon: number | null; SortOrder: number }[];
      total_distance_km: number;
      estimated_minutes: number;
    }[];
    unassigned_pdv_ids: number[];
  }>("/routes/generate-proposal", data),
};

// --- Forms ---
export const formsApi = {
  list: (params?: { skip?: number; limit?: number }) =>
    api.get<Form[]>("/forms", params as Record<string, number | undefined>),
  get: (id: number) => api.get<Form>(`/forms/${id}`),
  create: (data: { Name: string; Channel?: string; Version: number; IsActive?: boolean; Frequency?: string | null; FrequencyConfig?: string | null }) =>
    api.post<Form>("/forms", data),
  update: (id: number, data: { Name?: string; Channel?: string; Version?: number; IsActive?: boolean; Frequency?: string | null; FrequencyConfig?: string | null }) =>
    api.patch<Form>(`/forms/${id}`, data),
  delete: (id: number) => api.delete(`/forms/${id}`),

  // Asignación a rutas (bidireccional)
  getRoutesWithForm: (formId: number) =>
    api.get<{ route_ids: number[] }>(`/forms/${formId}/routes`),
  bulkAssignToRoutes: (
    formId: number,
    data: { route_ids?: number[]; assign_to_all?: boolean }
  ) => api.post<{ assigned: number; skipped: number }>(`/forms/${formId}/routes/bulk`, data),
  removeFromRoute: (formId: number, routeId: number) =>
    api.delete(`/forms/${formId}/routes/${routeId}`),

  // Questions
  listQuestions: (formId: number) =>
    api.get<FormQuestion[]>(`/forms/${formId}/questions`),
  createQuestion: (
    formId: number,
    data: {
      FormVersion?: number;
      SortOrder: number;
      KeyName: string;
      Label: string;
      QType: string;
      IsRequired?: boolean;
      RulesJson?: string;
    }
  ) => api.post<FormQuestion>(`/forms/${formId}/questions`, data),
  getQuestion: (questionId: number) =>
    api.get<FormQuestion>(`/forms/questions/${questionId}`),
  updateQuestion: (
    questionId: number,
    data: { SortOrder?: number; Label?: string; QType?: string; IsRequired?: boolean; RulesJson?: string }
  ) => api.patch<FormQuestion>(`/forms/questions/${questionId}`, data),
  deleteQuestion: (questionId: number) =>
    api.delete(`/forms/questions/${questionId}`),

  // Options
  listOptions: (questionId: number) =>
    api.get<FormOption[]>(`/forms/questions/${questionId}/options`),
  createOption: (questionId: number, data: { Value: string; Label: string; SortOrder: number; ImageUrl?: string }) =>
    api.post<FormOption>(`/forms/questions/${questionId}/options`, {
      ...data,
      QuestionId: questionId,
    }),
  getOption: (optionId: number) =>
    api.get<FormOption>(`/forms/options/${optionId}`),
  updateOption: (optionId: number, data: { Value?: string; Label?: string; SortOrder?: number; ImageUrl?: string }) =>
    api.patch<FormOption>(`/forms/options/${optionId}`, data),
  deleteOption: (optionId: number) =>
    api.delete(`/forms/options/${optionId}`),
};

// --- Visits ---
export const visitsApi = {
  list: (params?: {
    skip?: number;
    limit?: number;
    user_id?: number;
    pdv_id?: number;
    route_day_id?: number;
    status?: string;
  }) => api.get<Visit[]>("/visits", params),
  get: (id: number) => api.get<Visit>(`/visits/${id}`),
  create: (data: {
    PdvId: number;
    UserId: number;
    RouteDayId?: number;
    Status?: string;
    FormId?: number;
    FormVersion?: number;
    FormStatus?: string;
    MaterialExternalId?: string;
    CloseReason?: string;
  }) => api.post<Visit>("/visits", data),
  update: (id: number, data: Partial<Visit>) =>
    api.patch<Visit>(`/visits/${id}`, data),
  delete: (id: number) => api.delete(`/visits/${id}`),

  // Answers
  listAnswers: (visitId: number) =>
    api.get<VisitAnswer[]>(`/visits/${visitId}/answers`),
  saveAnswers: (visitId: number, answers: Array<{
    QuestionId: number;
    ValueText?: string | null;
    ValueNumber?: number | null;
    ValueBool?: boolean | null;
    OptionId?: number | null;
    ValueJson?: string | null;
  }>) => api.post<VisitAnswer[]>(`/visits/${visitId}/answers`, { answers }),

  // Validate close
  validateClose: (visitId: number) =>
    api.post<ValidateCloseResult>(`/visits/${visitId}/validate-close`, {}),

  // GPS Checks (check-in / check-out)
  listChecks: (visitId: number) =>
    api.get<Array<{
      VisitCheckId: number;
      CheckType: string;
      Ts: string | null;
      Lat: number | null;
      Lon: number | null;
      AccuracyMeters: number | null;
      DistanceToPdvM: number | null;
    }>>(`/visits/${visitId}/checks`),
  createCheck: (visitId: number, data: {
    CheckType: "IN" | "OUT";
    Lat?: number | null;
    Lon?: number | null;
    AccuracyMeters?: number | null;
    DistanceToPdvM?: number | null;
  }) => api.post(`/visits/${visitId}/checks`, data),

  // Form times (tracking - no UI display, stored for supervisor analytics)
  listFormTimes: (visitId: number) =>
    api.get<Array<{ FormId: number; ElapsedSeconds: number }>>(`/visits/${visitId}/form-times`),
  saveFormTimes: (visitId: number, formTimes: Array<{ FormId: number; ElapsedSeconds: number }>) =>
    api.post<{ ok: boolean }>(`/visits/${visitId}/form-times`, { form_times: formTimes }),
};

// --- Visit Actions ---
export const visitActionsApi = {
  list: (visitId: number) =>
    api.get<VisitAction[]>(`/visits/${visitId}/actions`),
  create: (visitId: number, data: {
    ActionType: string;
    Description?: string;
    DetailsJson?: string;
    PhotoRequired?: boolean;
    PhotoTaken?: boolean;
  }) => api.post<VisitAction>(`/visits/${visitId}/actions`, data),
  update: (actionId: number, data: {
    Description?: string;
    DetailsJson?: string;
    PhotoRequired?: boolean;
    PhotoTaken?: boolean;
  }) => api.patch<VisitAction>(`/visits/actions/${actionId}`, data),
  delete: (actionId: number) => api.delete(`/visits/actions/${actionId}`),
};

// --- Market News ---
export const marketNewsApi = {
  list: (visitId: number) =>
    api.get<MarketNews[]>(`/visits/${visitId}/market-news`),
  create: (visitId: number, data: {
    Tags?: string;
    Notes: string;
    CreatedBy?: number;
  }) => api.post<MarketNews>(`/visits/${visitId}/market-news`, data),
  update: (newsId: number, data: { Tags?: string; Notes?: string }) =>
    api.patch<MarketNews>(`/visits/market-news/${newsId}`, data),
  delete: (newsId: number) => api.delete(`/visits/market-news/${newsId}`),
};

// --- Incidents ---
export const incidentsApi = {
  list: (params?: {
    skip?: number;
    limit?: number;
    pdv_id?: number;
    visit_id?: number;
    status?: string;
  }) => api.get<Incident[]>("/incidents", params),
  get: (id: number) => api.get<Incident>(`/incidents/${id}`),
  create: (data: {
    VisitId?: number;
    PdvId?: number;
    Type: string;
    Status?: string;
    Priority?: number;
    Notes?: string;
    CreatedBy?: number;
  }) => api.post<Incident>("/incidents", data),
  update: (id: number, data: { Status?: string; Priority?: number; Notes?: string }) =>
    api.patch<Incident>(`/incidents/${id}`, data),
  delete: (id: number) => api.delete(`/incidents/${id}`),
};

// --- Notifications ---
export const notificationsApi = {
  list: (params?: { skip?: number; limit?: number; active_only?: boolean; for_user?: number }) =>
    api.get<Notification[]>("/notifications", params),
  get: (id: number) => api.get<Notification>(`/notifications/${id}`),
  create: (data: {
    Title: string;
    Message: string;
    Type?: string;
    Priority?: number;
    IsActive?: boolean;
    ExpiresAt?: string | null;
    CreatedBy?: number | null;
    TargetUserId?: number | null;
  }) => api.post<Notification>("/notifications", data),
  update: (id: number, data: Partial<Notification>) =>
    api.patch<Notification>(`/notifications/${id}`, data),
  delete: (id: number) => api.delete(`/notifications/${id}`),
};

// --- Mandatory Activities ---
export const mandatoryActivitiesApi = {
  list: (params?: { channel_id?: number; route_id?: number; active_only?: boolean }) =>
    api.get<MandatoryActivity[]>("/mandatory-activities", params as Record<string, string | number | boolean | undefined>),
  get: (id: number) => api.get<MandatoryActivity>(`/mandatory-activities/${id}`),
  create: (data: {
    Name: string;
    ActionType: string;
    Description?: string;
    DetailsJson?: string;
    PhotoRequired?: boolean;
    ChannelId?: number | null;
    RouteId?: number | null;
    FormId?: number | null;
    IsActive?: boolean;
  }) => api.post<MandatoryActivity>("/mandatory-activities", data),
  update: (id: number, data: Partial<MandatoryActivity>) =>
    api.patch<MandatoryActivity>(`/mandatory-activities/${id}`, data),
  delete: (id: number) => api.delete(`/mandatory-activities/${id}`),
};

// --- Reports ---
export const reportsApi = {
  summary: (params?: { year?: number; month?: number }) =>
    api.get<{
      year: number;
      month: number;
      totalVisits: number;
      closedVisits: number;
      totalPdvs: number;
      pdvsVisited: number;
      coverage: number;
      visitsWithGps: number;
      visitsWithPhoto: number;
      avgDurationMin: number;
    }>("/reports/summary", params),
  vendorRanking: (params?: { year?: number; month?: number }) =>
    api.get<Array<{
      rank: number;
      userId: number;
      name: string;
      zone: string;
      visits: number;
      planned: number;
      closed: number;
      pdvsVisited: number;
      compliance: number;
      withGps: number;
      withPhoto: number;
      avgTimeMin: number;
    }>>("/reports/vendor-ranking", params),
  channelCoverage: (params?: { year?: number; month?: number }) =>
    api.get<Array<{
      channelId: number;
      channel: string;
      total: number;
      visited: number;
      coverage: number;
      gps: number;
      photo: number;
    }>>("/reports/channel-coverage", params),
  avgTimeByTmPdv: (params?: { user_id?: number; pdv_id?: number; days?: number }) =>
    api.get<Array<{
      userId: number;
      userName: string;
      pdvId: number;
      pdvName: string;
      visitCount: number;
      avgMinutes: number;
    }>>("/reports/avg-time-by-tm-pdv", params as Record<string, number | undefined>),
  gpsAlerts: (params?: { days?: number; user_id?: number }) =>
    api.get<Array<{
      visitId: number;
      pdvId: number;
      pdvName: string;
      userId: number;
      userName: string;
      openedAt: string | null;
      status: string;
      alertType: "no_gps" | "out_of_range";
      distanceM: number | null;
      perimeterM: number;
    }>>("/reports/gps-alerts", params as Record<string, number | undefined>),
  formTimes: (params?: { year?: number; month?: number }) =>
    api.get<Array<{
      formId: number;
      avgSeconds: number;
      count: number;
      totalSeconds: number;
    }>>("/reports/form-times", params),
  perfectStore: () =>
    api.get<{
      summary: { avgScore: number; perfect: number; good: number; needsWork: number; critical: number; total: number };
      byChannel: Array<{ channel: string; avgScore: number; count: number }>;
      pdvs: Array<{ pdvId: number; name: string; channel: string; zone: string; score: number; components: { coverage: number; frequency: number; gps: number; dataQuality: number }; visits30d: number; planned30d: number }>;
    }>("/reports/perfect-store"),
  trending: (params?: { months?: number }) =>
    api.get<Array<{
      month: string; monthNum: number; year: number; visits: number; closed: number; coverage: number; pdvsVisited: number; gpsRate: number; avgDuration: number;
    }>>("/reports/trending", params),
  smartAlerts: () =>
    api.get<{
      total: number; high: number; medium: number; low: number;
      alerts: Array<{ type: string; severity: string; title: string; detail: string; pdvId?: number; userId?: number; channel?: string }>;
    }>("/reports/smart-alerts"),
  productAnalytics: () =>
    api.get<{
      byProduct: Array<{
        ProductId: number; Name: string; Category: string; IsOwn: boolean; Manufacturer: string | null;
        pdvCount: number; worksCount: number;
        avgPrice: number | null; medianPrice: number | null; minPrice: number | null; maxPrice: number | null; stdDev: number | null;
        availableCount: number; outOfStockCount: number; lastSeen: string | null;
      }>;
      byCategory: Array<{ Category: string; productCount: number; avgCoverage: number }>;
      totalPdvsWithCoverage: number; totalVisitsWithCoverage: number;
    }>("/reports/product-analytics"),
  supplierAnalytics: () =>
    api.get<{
      totalSuppliers: number; totalPdvsWithSuppliers: number;
      byType: Array<{ type: string; count: number }>;
      byZone: Array<{ zone: string; count: number }>;
      byProduct: Array<{ product: string; count: number }>;
      topSuppliers: Array<{ name: string; phone: string; type: string; pdvCount: number }>;
    }>("/reports/supplier-analytics"),
  routeAnalytics: () =>
    api.get<{
      totalRoutes: number; totalPdvsInRoutes: number; avgCompliance: number;
      routes: Array<{
        RouteId: number; Name: string; Zone: string; AssignedUser: string; FrequencyType: string;
        pdvCount: number; totalDays30d: number; completedDays30d: number; compliance30d: number;
        futurePlannedDays: number; visits30d: number;
      }>;
    }>("/reports/route-analytics"),
  pdvAnalytics: () =>
    api.get<{
      total: number; active: number; inactive: number; withCoords: number; assigned: number;
      visited30d: number; neverVisited: number;
      byChannel: Array<{ channel: string; count: number }>;
      byZone: Array<{ zone: string; count: number }>;
      byCategory: Array<{ category: string; count: number }>;
    }>("/reports/pdv-analytics"),
};

// --- KPI / Tablero TMR ---
export interface KpiItem {
  key: string;
  name: string;
  actual: number;
  target: number;
  weight: number;
  achieved: boolean;
  numerator: number;
  denominator: number;
  scopeApplied: string;
}

export interface KpiVariableRow {
  userId: number;
  name: string | null;
  managerUserId: number | null;
  managerName: string | null;
  partial: boolean;
  day: number;
  kpis: KpiItem[];
  variableTotal: number;
  configWarning: string | null;
}

export interface PdvScoringItem {
  pdvId: number;
  name: string;
  route: string | null;
  coverageScore: string;
  communicationScore: string;
  lastVisit: string | null;
}

export interface PdvScoringResponse {
  items: PdvScoringItem[];
  total: number;
  page: number;
  pageSize: number;
  scoreDist: {
    coverage: Record<string, number>;
    communication: Record<string, number>;
  };
}

export interface RouteSummaryRow {
  routeId: number;
  name: string;
  userId: number;
  userName: string | null;
  pdvs: number;
  planned: number;
  visited: number;
  effectiveness: number;
  actions: number;
  withMaterial: number;
  sellsLoose: number;
  withExchange: number;
}

export interface WeeklyActivityVisit {
  pdvId: number;
  pdvName: string;
  openedAt: string;
  closedAt: string | null;
  status: string;
  effective: boolean;
}

export interface WeeklyActivityDay {
  date: string;
  dayLabel: string;
  count: number;
  firstOpen: string;
  lastClose: string | null;
  avgDurationMin: number | null;
  visits: WeeklyActivityVisit[];
}

export interface WeeklyActivityWeek {
  weekStart: string;
  label: string;
  totalVisits: number;
  days: WeeklyActivityDay[];
}

export interface WeeklyActivityResponse {
  userId: number;
  name: string | null;
  weeks: WeeklyActivityWeek[];
}

export interface PriceMatrixItem {
  productId: number;
  productName: string;
  groupId: number;
  groupName: string;
  userId: number;
  avg: number;
  min: number;
  max: number;
  n: number;
}

export interface SuspiciousPriceItem {
  productName: string;
  price: number;
  medianPrice: number;
  pdvId: number;
  pdvName: string | null;
  userId: number;
  userName: string | null;
  date: string;
}

export interface ClosedMonth {
  year: number;
  month: number;
  snapshots: number;
  users: number;
  frozenAt: string | null;
  usersWithRoutes: number;
  complete: boolean;
}

export interface CloseMonthResult {
  year: number;
  month: number;
  usersClosed: number;
  snapshotsCreated: number;
  forced: boolean;
  usersSkipped: number[];
  usersCompleted: number[];
}

// --- Config del ABM de KPIs (pestaña Objetivos, PascalCase igual que backend/app/schemas/kpi.py) ---
export interface KpiDefinition {
  KpiDefinitionId: number;
  KpiKey: string;
  Name: string;
  Description: string | null;
  IsActive: boolean;
}

export interface KpiConfig {
  KpiConfigId: number;
  KpiDefinitionId: number;
  Weight: number;
  Target: number;
  ScopeType: string; // global | zone | user
  ScopeId: number | null;
  ValidFrom: string;
  ValidTo: string | null;
  CreatedByUserId: number | null;
  CreatedAt: string;
}

export interface KpiConfigCreate {
  KpiDefinitionId: number;
  Weight: number;
  Target: number;
  ScopeType: string;
  ScopeId?: number | null;
}

export interface KpiConfigBulkItem {
  KpiDefinitionId: number;
  Weight: number;
  Target: number;
}

export interface KpiConfigBulkCreate {
  ScopeType: string;
  ScopeId?: number | null;
  items: KpiConfigBulkItem[];
}

export interface ScoringCoverageRule {
  RuleId: number;
  Brand: string;
  Level: string;
  MinSkus: number;
  ScopeType: string;
  ScopeId: number | null;
  ValidFrom: string;
  ValidTo: string | null;
  CreatedByUserId: number | null;
  CreatedAt: string;
}

export interface ScoringCoverageRuleCreate {
  Brand: string;
  Level: string;
  MinSkus: number;
  ScopeType: string;
  ScopeId?: number | null;
}

export interface ScoringCommunicationRule {
  RuleId: number;
  MaterialType: string;
  Level: string;
  Required: boolean | null;
  MinElements: number | null;
  ScopeType: string;
  ScopeId: number | null;
  ValidFrom: string;
  ValidTo: string | null;
  CreatedByUserId: number | null;
  CreatedAt: string;
}

export interface ScoringCommunicationRuleCreate {
  MaterialType: string;
  Level: string;
  Required?: boolean | null;
  MinElements?: number | null;
  ScopeType: string;
  ScopeId?: number | null;
}

export interface ResolvedKpiConfigItem {
  kpiDefinitionId: number;
  kpiKey: string;
  name: string;
  weight: number;
  target: number;
  scopeApplied: string;
}

export interface ResolvedKpiConfig {
  userId: number;
  year: number;
  month: number;
  configs: ResolvedKpiConfigItem[];
  configWarning: string | null;
}

export const kpiApi = {
  variable: (params: { year: number; month: number; user_id?: number }) =>
    api.get<KpiVariableRow[]>("/kpi/variable", params as Record<string, number | undefined>),
  pdvScoring: (params: { year: number; month: number; user_id: number; route_id?: number; page?: number; page_size?: number }) =>
    api.get<PdvScoringResponse>("/kpi/pdv-scoring", params as Record<string, number | undefined>),
  routeSummary: (params: { year: number; month: number; user_id?: number }) =>
    api.get<RouteSummaryRow[]>("/kpi/route-summary", params as Record<string, number | undefined>),
  weeklyActivity: (params: { year: number; month: number; user_id: number }) =>
    api.get<WeeklyActivityResponse>("/kpi/weekly-activity", params as Record<string, number | undefined>),
  priceMatrix: (params: { year: number; month: number; group_by: "route" | "user"; user_id?: number }) =>
    api.get<PriceMatrixItem[]>("/kpi/price-matrix", params as Record<string, string | number | undefined>),
  suspiciousPrices: (params: { year: number; month: number; user_id?: number }) =>
    api.get<SuspiciousPriceItem[]>("/kpi/suspicious-prices", params as Record<string, number | undefined>),
  // --- Cierre mensual (T5) ---
  closedMonths: () => api.get<ClosedMonth[]>("/kpi/closed-months"),
  closeMonth: (params: { year: number; month: number; force?: boolean; only_missing?: boolean }) => {
    const qs = new URLSearchParams({ year: String(params.year), month: String(params.month) });
    if (params.force) qs.set("force", "true");
    if (params.only_missing) qs.set("only_missing", "true");
    return api.post<CloseMonthResult>(`/kpi/close-month?${qs.toString()}`, {});
  },
  // --- Config (ABM de KPIs, pestaña Objetivos) ---
  definitions: () => api.get<KpiDefinition[]>("/kpi/definitions"),
  config: (params?: { scope_type?: string; scope_id?: number }) =>
    api.get<KpiConfig[]>("/kpi/config", params as Record<string, string | number | undefined>),
  createConfig: (data: KpiConfigCreate) => api.post<KpiConfig>("/kpi/config", data),
  createConfigBulk: (data: KpiConfigBulkCreate) => api.post<KpiConfig[]>("/kpi/config/bulk", data),
  deleteConfig: (configId: number) => api.delete<void>(`/kpi/config/${configId}`),
  resolvedConfig: (params: { user_id?: number; year?: number; month?: number }) =>
    api.get<ResolvedKpiConfig>("/kpi/config/resolved", params as Record<string, number | undefined>),
  scoringRules: (type: "coverage" | "communication") =>
    api.get<Array<ScoringCoverageRule | ScoringCommunicationRule>>("/kpi/scoring-rules", { type }),
  createScoringRule: (
    type: "coverage" | "communication",
    data: ScoringCoverageRuleCreate | ScoringCommunicationRuleCreate
  ) => api.post<ScoringCoverageRule | ScoringCommunicationRule>(`/kpi/scoring-rules?type=${type}`, data),
  deleteScoringRule: (type: "coverage" | "communication", ruleId: number) =>
    api.delete<void>(`/kpi/scoring-rules/${ruleId}?type=${type}`),
};

// --- Inteligencia Comercial (/intelligence) ---
export interface IntelZona {
  zonaId: number;
  zona: string;
  pdvs: number;
  censados: number;
  conEspert: number;
  cobertura: number;
  skusPromEspert: number;
  visitas30d: number;
  trades30d: number;
  sueltosPct: number; // % que vende sueltos, sobre los PDVs con dato
  sueltosConDato: number;
}

export interface IntelTrade {
  userId: number;
  nombre: string;
  zona: string;
  reportaA: string;
  cartera: number;
  censados: number;
  pctCensado: number;
  conEspert: number;
  skusProm: number;
  visitas30d: number;
  gps: number;
  foto: number;
  ultimaVisita: string | null;
}

export interface IntelAlerta {
  tipo: string;
  severidad: "critica" | "alta" | "media";
  titulo: string;
  detalle: string;
}

export interface IntelPortfolioRow {
  producto: string;
  categoria: string;
  pdvs: number;
  pct: number;
  precioProm: number | null;
  porZona: Record<string, number>;
}

export interface IntelOverview {
  generadoEl: string;
  datosDesde: string | null; // "YYYY-MM" del primer mes con visitas
  mesesDeDatos: number;
  resumen: {
    pdvsActivos: number;
    censados: number;
    conEspert: number;
    cobertura: number;
    pctCensado: number;
    relevamientos: number;
    visitas: number;
  };
  visitasPorMes: Array<{ mes: string; visitas: number; trades: number; promPorTrade: number }>;
  zonas: IntelZona[];
  competencia: Record<string, { pdvsCig: number; presencia: Record<string, number> }>;
  precioFab: Record<string, { prom: number; n: number }>;
  portfolio: IntelPortfolioRow[];
  gondola: {
    familias: Array<{
      marca: string;
      pdvs: number;
      pct: number;
      skusActivos: number;
      skusPromPorPdv: number;
      precioProm: number | null;
    }>;
    rivales: Array<{
      sku: string;
      precio: number;
      pct: number;
      rivales: Array<{ producto: string; fabricante: string; precio: number; pct: number }>;
    }>;
  };
  trades: IntelTrade[];
  alertas: IntelAlerta[];
}

export interface IntelOpportunity {
  pdvId: number;
  pdv: string;
  zona: string;
  canal: string;
  tradeId: number | null;
  trade: string;
  tipo: string;
  tipoLabel: string;
  prioridad: "Crítica" | "Alta" | "Media";
  detalle: string;
  sugerencia: string;
}

export interface IntelOpportunitiesResponse {
  items: IntelOpportunity[];
  filteredTotal: number;
  page: number;
  pageSize: number;
  total: number;
  porTipo: Record<string, number>;
  porZona: Record<string, Record<string, number>>;
  porTrade: Record<string, number>;
  porPrioridad: Record<string, number>;
}

export interface IntelMapResponse {
  zonas: Record<string, string>;
  rutas: Record<string, string>;
  // [pdvId, lat, lon, zoneId, status, rutaId, nombre]
  // status: 2 Espert · 1 censado sin · 0 sin censo · rutaId 0 = sin ruta
  puntos: Array<[number, number, number, number, number, number, string]>;
  counts: { espert: number; censadoSin: number; sinCenso: number };
}

// Fila de /kpi/tmr/team (actividad del mes por trade — misma data que el
// Tablero TMR estático; acá se cruza con el censo en la sección Equipo).
export interface TmrTeamRow {
  id: number;
  n: string;
  zona: string;
  tot: number; // visitas del mes
  vis: number; // PDVs del universo foco visitados
  pdvs: number; // universo foco
  plan: number;
  vis_plan: number;
  ef_pct: number;
  gps: number;
  foto: number;
  dur: number; // duración promedio (min)
  accion_pct: number;
  tot_ent: number;
  ent: Record<string, number>;
}

export interface TmrTeamResponse {
  periodo_label: string;
  fecha_datos: string;
  res: { vis: number; ent: number; foto: number; ef: number; acc: number };
  trades: TmrTeamRow[];
}

// Fila de la matriz producto x PDV de /kpi/tmr/pdvs (por vendedor).
export interface TmrPdvRow {
  id?: number; // PdvId (puede faltar en responses cacheados viejos)
  n: string;
  loc: string;
  canal: string;
  vis: number;
  ha: boolean;
  at: string[];
  vs: string;
  score: string | null;
  // 1 trabaja · 0 no trabaja · null no relevado, indexado contra espert_prods
  pr: Array<number | null>;
  ruta: string;
}

export interface TmrPdvsResponse {
  tmr_pdvs: Record<string, TmrPdvRow[]>;
  quick_wins: Array<{
    n: string; loc: string; canal: string; vis: number;
    gaps: number; missing: string[]; ruta: string; trade: string; zona: string;
  }>;
  espert_prods: string[];
}

// Ruta foco de /kpi/tmr/routes (por vendedor): cobertura y precios por producto.
export interface TmrRutaRow {
  nombre: string;
  trade: string;
  user_id: number;
  zona: string;
  pdvs: number;
  relevados: number;
  buenos: number;
  vis_pdvs_jul: number; // PDVs visitados en el mes
  vis_plan: number;
  planned_mes: number;
  vende_sueltos: number;
  con_canje: number;
  con_promo: number;
  con_material: number;
  ef_jul: number; // efectividad del mes (%)
  cob_score_pct: number;
  freq: string;
  score_dist: Record<string, number>;
  prod_cob?: Record<string, number>;
  precios_ruta?: Record<string, { avg: number; min: number; max: number; n: number }>;
}

export interface TmrCatalogResponse {
  espert_prods: string[];
  all_prods: string[];
  prod_fab_groups: Record<string, string[]>;
  precios: { prod: Record<string, { avg: number; min: number; max: number; n: number }> };
}

// Ficha completa de un PDV (último nivel de drill de Inteligencia).
export interface IntelPdvDetail {
  info: {
    pdvId: number;
    nombre: string;
    codigo: string | null;
    direccion: string;
    canal: string;
    zona: string;
    trade: string;
    tradeId: number | null;
    sueltos: boolean | null;
    volumenMensual: number | null;
    categoria: string | null;
    horario: string | null;
  };
  contactos: Array<{
    nombre: string;
    telefono: string | null;
    rol: string | null;
    decision: string | null;
    notas: string | null;
  }>;
  proveedores: Array<{
    nombre: string;
    telefono: string | null;
    tipo: string | null;
    productos: string[];
  }>;
  skusEspertHoy: string[];
  censo: Array<{
    producto: string;
    fabricante: string;
    esEspert: boolean;
    categoria: string;
    trabaja: boolean;
    precio: number | null;
    disponibilidad: string | null;
    fecha: string;
  }>;
  evolucion: Array<{ mes: string; visitas: number; skusEspert: number }>;
  visitas: Array<{
    visitId: number;
    fecha: string;
    trade: string;
    duracionMin: number | null;
    fotos: number;
    gps: boolean;
    estado: string | null;
  }>;
  totalVisitas: number;
  fotos: Array<{ visitId: number; url: string; tipo: string; fecha: string | null }>;
}

// Ventana de los recursos /kpi/tmr/*: year/month (mes calendario) o, con
// date_from/date_to (yyyy-mm-dd), un rango arbitrario que la reemplaza.
export interface TmrQueryPeriod {
  year: number;
  month: number;
  date_from?: string;
  date_to?: string;
}

export interface IntelSupplierRow {
  nombre: string;
  telefono: string | null;
  tipo: string | null;
  productos: string[];
  pdvs: number;
  pdvNombres: string[];
}

export const intelligenceApi = {
  pdvDetail: (pdvId: number) => api.get<IntelPdvDetail>(`/intelligence/pdv/${pdvId}`),
  suppliers: (params: { user_id: number; ruta?: string }) =>
    api.get<{ items: IntelSupplierRow[]; total: number }>(
      "/intelligence/suppliers",
      params as Record<string, string | number | undefined>
    ),
  tmrTeam: (params: TmrQueryPeriod) =>
    api.get<TmrTeamResponse>("/kpi/tmr/team", { ...params } as Record<string, number | string | undefined>),
  tmrPdvs: (params: TmrQueryPeriod & { user_id: number }) =>
    api.get<TmrPdvsResponse>("/kpi/tmr/pdvs", { ...params } as Record<string, number | string | undefined>),
  tmrRoutes: (params: TmrQueryPeriod & { user_id: number }) =>
    api.get<{ rutas: TmrRutaRow[] }>("/kpi/tmr/routes", { ...params } as Record<string, number | string | undefined>),
  tmrCatalog: (params: TmrQueryPeriod) =>
    api.get<TmrCatalogResponse>("/kpi/tmr/catalog", { ...params } as Record<string, number | string | undefined>),
  overview: () => api.get<IntelOverview>("/intelligence/overview"),
  opportunities: (params?: {
    zona?: string;
    trade_id?: number;
    prioridad?: string;
    tipo?: string;
    page?: number;
    page_size?: number;
  }) =>
    api.get<IntelOpportunitiesResponse>(
      "/intelligence/opportunities",
      params as Record<string, string | number | undefined>
    ),
  map: () => api.get<IntelMapResponse>("/intelligence/map"),
};

// --- Supplier Types (admin lookup) ---
export const supplierTypesApi = {
  list: () => api.get<SupplierType[]>("/supplier-types"),
  listAll: () => api.get<SupplierType[]>("/supplier-types/all"),
  create: (data: { Name: string; IsActive?: boolean }) =>
    api.post<SupplierType>("/supplier-types", data),
  update: (id: number, data: { Name?: string; IsActive?: boolean }) =>
    api.patch<SupplierType>(`/supplier-types/${id}`, data),
  delete: (id: number) => api.delete(`/supplier-types/${id}`),
};

// --- Supplier Product Types (admin lookup) ---
export const supplierProductTypesApi = {
  list: () => api.get<SupplierProductType[]>("/supplier-product-types"),
  listAll: () => api.get<SupplierProductType[]>("/supplier-product-types/all"),
  create: (data: { Name: string; IsActive?: boolean }) =>
    api.post<SupplierProductType>("/supplier-product-types", data),
  update: (id: number, data: { Name?: string; IsActive?: boolean }) =>
    api.patch<SupplierProductType>(`/supplier-product-types/${id}`, data),
  delete: (id: number) => api.delete(`/supplier-product-types/${id}`),
};

// --- PDV Suppliers (censo proveedores) ---
export const pdvSuppliersApi = {
  list: (pdvId: number) => api.get<PdvSupplier[]>(`/pdvs/${pdvId}/suppliers`),
  create: (pdvId: number, data: { Name: string; Phone: string; SupplierTypeId?: number; ZoneId?: number; Products?: string[] }) =>
    api.post<PdvSupplier>(`/pdvs/${pdvId}/suppliers`, data),
  update: (pdvId: number, supplierId: number, data: { Name?: string; Phone?: string; SupplierTypeId?: number; ZoneId?: number; Products?: string[]; IsActive?: boolean }) =>
    api.patch<PdvSupplier>(`/pdvs/${pdvId}/suppliers/${supplierId}`, data),
  delete: (pdvId: number, supplierId: number) =>
    api.delete(`/pdvs/${pdvId}/suppliers/${supplierId}`),
  searchZone: (pdvId: number, phone?: string) =>
    api.get<PdvSupplier[]>(`/pdvs/${pdvId}/suppliers/search-zone`, phone ? { phone } : undefined),
};
