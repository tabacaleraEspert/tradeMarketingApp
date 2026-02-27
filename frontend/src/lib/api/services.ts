import { api } from "./client";

// --- Auth ---
export interface LoginResponse {
  UserId: number;
  Email: string;
  DisplayName: string;
  ZoneId: number | null;
  ZoneName?: string | null;
  Role?: string;
  IsActive: boolean;
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>("/auth/login", { email, password }),
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
  Incident,
  Notification,
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
    ZoneId?: number | null;
    IsActive?: boolean;
  }) => api.post<User>("/users", data),
  update: (
    id: number,
    data: {
      Email?: string;
      DisplayName?: string;
      ZoneId?: number | null;
      IsActive?: boolean;
    }
  ) => api.patch<User>(`/users/${id}`, data),
  delete: (id: number) => api.delete(`/users/${id}`),
  getMonthlyStats: (userId: number) =>
    api.get<{ visits: number; compliance: number; new_pdvs: number }>(
      `/users/${userId}/stats/monthly`
    ),
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
  create: (data: { Name: string; IsActive?: boolean }) =>
    api.post<Distributor>("/distributors", data),
  update: (id: number, data: { Name?: string; IsActive?: boolean }) =>
    api.patch<Distributor>(`/distributors/${id}`, data),
  delete: (id: number) => api.delete(`/distributors/${id}`),
};

// --- Channels ---
export const channelsApi = {
  list: () => api.get<Channel[]>("/channels"),
  listAll: () => api.get<Channel[]>("/channels/all"),
  get: (id: number) => api.get<Channel>(`/channels/${id}`),
  create: (data: { Name: string; IsActive?: boolean }) =>
    api.post<Channel>("/channels", data),
  update: (id: number, data: { Name?: string; IsActive?: boolean }) =>
    api.patch<Channel>(`/channels/${id}`, data),
  delete: (id: number) => api.delete(`/channels/${id}`),
};

// --- SubChannels ---
export const subchannelsApi = {
  list: (channelId?: number) =>
    api.get<SubChannel[]>("/subchannels", channelId ? { channel_id: channelId } : {}),
  listAll: (channelId?: number) =>
    api.get<SubChannel[]>("/subchannels/all", channelId ? { channel_id: channelId } : {}),
  get: (id: number) => api.get<SubChannel>(`/subchannels/${id}`),
  create: (data: { ChannelId: number; Name: string; IsActive?: boolean }) =>
    api.post<SubChannel>("/subchannels", data),
  update: (id: number, data: { ChannelId?: number; Name?: string; IsActive?: boolean }) =>
    api.patch<SubChannel>(`/subchannels/${id}`, data),
  delete: (id: number) => api.delete(`/subchannels/${id}`),
};

// --- PDVs ---
export interface PdvCreateData {
  Code?: string;
  Name: string;
  ChannelId: number;
  SubChannelId?: number;
  Address?: string;
  City?: string;
  ZoneId?: number;
  DistributorId?: number;
  Lat?: number;
  Lon?: number;
  Contacts?: { ContactName: string; ContactPhone?: string; Birthday?: string }[];
  DefaultMaterialExternalId?: string;
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
  update: (id: number, data: Partial<PdvCreateData> & { Contacts?: { ContactName: string; ContactPhone?: string; Birthday?: string }[] }) =>
    api.patch<Pdv>(`/pdvs/${id}`, data),
  delete: (id: number) => api.delete(`/pdvs/${id}`),
};

// --- Routes ---
export const BEJERMAN_ZONES = ["Litoral", "GBA Sur", "GBA Norte", "Patagonia"] as const;

export const routesApi = {
  list: (params?: { skip?: number; limit?: number; created_by?: number }) =>
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
    }
  ) => api.patch<Route>(`/routes/${id}`, data),
  delete: (id: number) => api.delete(`/routes/${id}`),

  // Route PDVs
  listPdvs: (routeId: number) =>
    api.get<RoutePdv[]>(`/routes/${routeId}/pdvs`),
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
  createDay: (routeId: number, data: { WorkDate: string; AssignedUserId: number; Status?: string }) =>
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
};

// --- Forms ---
export const formsApi = {
  list: (params?: { skip?: number; limit?: number }) =>
    api.get<Form[]>("/forms", params as Record<string, number | undefined>),
  get: (id: number) => api.get<Form>(`/forms/${id}`),
  create: (data: { Name: string; Channel?: string; Version: number; IsActive?: boolean }) =>
    api.post<Form>("/forms", data),
  update: (id: number, data: { Name?: string; Channel?: string; Version?: number; IsActive?: boolean }) =>
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
  createOption: (questionId: number, data: { Value: string; Label: string; SortOrder: number }) =>
    api.post<FormOption>(`/forms/questions/${questionId}/options`, {
      ...data,
      QuestionId: questionId,
    }),
  getOption: (optionId: number) =>
    api.get<FormOption>(`/forms/options/${optionId}`),
  updateOption: (optionId: number, data: { Value?: string; Label?: string; SortOrder?: number }) =>
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
  list: (params?: { skip?: number; limit?: number; active_only?: boolean }) =>
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
  }) => api.post<Notification>("/notifications", data),
  update: (id: number, data: Partial<Notification>) =>
    api.patch<Notification>(`/notifications/${id}`, data),
  delete: (id: number) => api.delete(`/notifications/${id}`),
};
