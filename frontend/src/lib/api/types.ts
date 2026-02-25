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

export interface Pdv {
  PdvId: number;
  Code: string | null;
  Name: string;
  Channel: string;
  Address: string | null;
  City: string | null;
  ZoneId: number | null;
  DistributorId: number | null;
  Lat: number | null;
  Lon: number | null;
  ContactName: string | null;
  ContactPhone: string | null;
  DefaultMaterialExternalId: string | null;
  IsActive: boolean;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface Route {
  RouteId: number;
  Name: string;
  ZoneId: number | null;
  FormId: number | null;
  IsActive: boolean;
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
