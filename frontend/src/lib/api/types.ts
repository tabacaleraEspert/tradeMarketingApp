/**
 * Tipos que coinciden con los schemas del backend (PascalCase)
 */

export interface Zone {
  ZoneId: number;
  Name: string;
}

export interface User {
  UserId: number;
  Email: string;
  DisplayName: string;
  ZoneId: number | null;
  IsActive: boolean;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface Role {
  RoleId: number;
  Name: string;
  CreatedAt: string;
}

export interface Distributor {
  DistributorId: number;
  Name: string;
  IsActive: boolean;
}

export interface PdvContact {
  PdvContactId: number;
  PdvId: number;
  ContactName: string;
  ContactPhone: string | null;
  ContactRole: string | null;       // dueño, empleado, encargado
  DecisionPower: string | null;     // alto, medio, bajo
  Birthday: string | null;
  CreatedAt: string;
}

export interface PdvDistributorInfo {
  DistributorId: number;
  Name: string;
}

export interface Pdv {
  PdvId: number;
  Code: string | null;
  Name: string;
  Channel: string | null;
  ChannelId: number | null;
  SubChannelId: number | null;
  ChannelName: string | null;
  SubChannelName: string | null;
  Address: string | null;
  City: string | null;
  ZoneId: number | null;
  DistributorId: number | null;
  Lat: number | null;
  Lon: number | null;
  ContactName: string | null;
  ContactPhone: string | null;
  Contacts: PdvContact[];
  Distributors: PdvDistributorInfo[];
  DefaultMaterialExternalId: string | null;
  IsActive: boolean;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface Channel {
  ChannelId: number;
  Name: string;
  IsActive: boolean;
  CreatedAt: string;
}

export interface SubChannel {
  SubChannelId: number;
  ChannelId: number;
  Name: string;
  IsActive: boolean;
  CreatedAt: string;
}

export interface Route {
  RouteId: number;
  Name: string;
  ZoneId: number | null;
  FormId: number | null;
  IsActive: boolean;
  BejermanZone: string | null;
  FrequencyType: string | null;
  FrequencyConfig: string | null;
  EstimatedMinutes: number | null;
  AssignedUserId: number | null;
  AssignedUserName: string | null;
  CreatedByUserId: number | null;
  PdvCount: number;
  CreatedAt: string;
}

export interface RoutePdv {
  RouteId: number;
  PdvId: number;
  SortOrder: number;
  Priority: number;
}

export interface RouteFormWithForm {
  RouteId: number;
  FormId: number;
  SortOrder: number;
  Form: Form;
}

export interface RouteFormRead {
  RouteId: number;
  FormId: number;
  SortOrder: number;
}

export interface RouteDay {
  RouteDayId: number;
  RouteId: number;
  WorkDate: string;
  AssignedUserId: number;
  Status: string;
  CreatedAt: string;
}

export interface RouteDayPdv {
  RouteDayId: number;
  PdvId: number;
  PlannedOrder: number;
  PlannedWindowFrom: string | null;
  PlannedWindowTo: string | null;
  Priority: number;
  ExecutionStatus: string;
}

export interface Form {
  FormId: number;
  Name: string;
  Channel: string | null;
  Version: number;
  IsActive: boolean;
  CreatedAt: string;
}

export interface FormQuestion {
  QuestionId: number;
  FormId: number;
  FormVersion: number;
  SortOrder: number;
  KeyName: string;
  Label: string;
  QType: string;
  IsRequired: boolean;
  RulesJson: string | null;
}

export interface FormOption {
  OptionId: number;
  QuestionId: number;
  Value: string;
  Label: string;
  SortOrder: number;
  ImageUrl: string | null;
}

export interface Visit {
  VisitId: number;
  PdvId: number;
  UserId: number;
  RouteDayId: number | null;
  Status: string;
  FormId: number | null;
  FormVersion: number | null;
  FormStatus: string;
  MaterialExternalId: string | null;
  CloseReason: string | null;
  OpenedAt: string;
  ClosedAt: string | null;
  SubmittedAt: string | null;
}

export interface Incident {
  IncidentId: number;
  VisitId: number | null;
  PdvId: number | null;
  Type: string;
  Status: string;
  Priority: number;
  Notes: string | null;
  CreatedBy: number | null;
  CreatedAt: string;
}

export interface Notification {
  NotificationId: number;
  Title: string;
  Message: string;
  Type: string;
  Priority: number;
  IsActive: boolean;
  CreatedAt: string;
  CreatedBy: number | null;
  ExpiresAt: string | null;
}

export interface VisitAnswer {
  AnswerId: number;
  VisitId: number;
  QuestionId: number;
  ValueText: string | null;
  ValueNumber: number | null;
  ValueBool: boolean | null;
  OptionId: number | null;
  ValueJson: string | null;
  CreatedAt: string;
}

export interface VisitAction {
  VisitActionId: number;
  VisitId: number;
  ActionType: string;        // cobertura, pop, canje_sueltos, promo, otra
  Description: string | null;
  DetailsJson: string | null;
  PhotoRequired: boolean;
  PhotoTaken: boolean;
  IsMandatory: boolean;
  MandatoryActivityId: number | null;
  Status: string;            // PENDING, DONE, BACKLOG
  CreatedAt: string;
}

export interface MandatoryActivity {
  MandatoryActivityId: number;
  Name: string;
  ActionType: string;
  Description: string | null;
  DetailsJson: string | null;
  PhotoRequired: boolean;
  ChannelId: number | null;
  RouteId: number | null;
  IsActive: boolean;
  CreatedAt: string | null;
}

export interface MarketNews {
  MarketNewsId: number;
  VisitId: number;
  PdvId: number;
  Tags: string | null;
  Notes: string;
  CreatedBy: number | null;
  CreatedAt: string;
}

export interface ValidateCloseResult {
  valid: boolean;
  missing: Array<{
    questionId?: number;
    actionId?: number;
    label: string;
    formId?: number;
  }>;
}

export interface DaySummary {
  date: string;
  planned: number;
  visited: number;
  completed: number;
  compliance: number;
  avgDuration: number;
  actionsByType: Record<string, number>;
  pendingItems: Array<{ pdvName: string; description: string }>;
}
