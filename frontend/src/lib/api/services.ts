import { api } from "./client";

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

export const authApi = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>("/auth/login", { email, password }),
  me: () => api.get<MeResponse>("/auth/me"),
  changePassword: (current_password: string, new_password: string) =>
    api.post<{ ok: boolean }>("/auth/change-password", { current_password, new_password }),
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
    Password?: string;
    ZoneId?: number | null;
    IsActive?: boolean;
  }) => api.post<User>("/users", data),
  update: (
    id: number,
    data: {
      Email?: string;
      DisplayName?: string;
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
}

export const pdvsApi = {
  list: (params?: {
    skip?: number;
    limit?: number;
    zone_id?: number;
    distributor_id?: number;
  }) => api.get<Pdv[]>("/pdvs", params),
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
  list: (params?: { skip?: number; limit?: number; created_by?: number; assigned_user_id?: number }) =>
    api.get<Route[]>("/routes", params as Record<string, number | undefined>),
  get: (id: number) => api.get<Route>(`/routes/${id}`),
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
  }) => api.post<Route>("/routes", data),
  update: (
    id: number,
    data: {
      Name?: string;
      ZoneId?: number;
      FormId?: number;
      IsActive?: boolean;
      BejermanZone?: string;
      FrequencyType?: string;
      FrequencyConfig?: string;
      EstimatedMinutes?: number;
      AssignedUserId?: number | null;
      IsOptimized?: boolean;
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
};
