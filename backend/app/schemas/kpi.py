"""Schemas del tablero TMR â€” CRUD de configuraciÃ³n (docs/tablero-tmr-plan-fase1.md T3).

Los endpoints de solo lectura que calculan KPIs (`/kpi/variable`, `/kpi/pdv-scoring`,
`/kpi/route-summary`, `/kpi/config/resolved`) devuelven dicts camelCase construidos a
mano en el router (siguiendo el contrato JSON del plan y el estilo de `dashboard.py`),
no schemas de acÃ¡. Estos schemas son para el CRUD de configuraciÃ³n, que sigue la
convenciÃ³n PascalCase del resto de los schemas del repo (ver `schemas/supplier_type.py`).
"""
from datetime import date, datetime
from pydantic import BaseModel, ConfigDict, Field


class KpiDefinitionOut(BaseModel):
    KpiDefinitionId: int
    KpiKey: str
    Name: str
    Description: str | None
    IsActive: bool

    model_config = ConfigDict(from_attributes=True)


class KpiConfigCreate(BaseModel):
    KpiDefinitionId: int
    Weight: int = Field(..., ge=0, le=100)
    Target: float = Field(..., ge=0, le=100)
    ScopeType: str  # global | zone | user
    ScopeId: int | None = None


class KpiConfigBulkItem(BaseModel):
    KpiDefinitionId: int
    Weight: int = Field(..., ge=0, le=100)
    Target: float = Field(..., ge=0, le=100)


class KpiConfigBulkCreate(BaseModel):
    ScopeType: str  # global | zone | user
    ScopeId: int | None = None
    items: list[KpiConfigBulkItem]


class KpiConfigOut(BaseModel):
    KpiConfigId: int
    KpiDefinitionId: int
    Weight: int
    Target: float
    ScopeType: str
    ScopeId: int | None
    ValidFrom: date
    ValidTo: date | None
    CreatedByUserId: int | None
    CreatedAt: datetime

    model_config = ConfigDict(from_attributes=True)


class ScoringCoverageRuleCreate(BaseModel):
    Brand: str
    Level: str
    MinSkus: int
    ScopeType: str
    ScopeId: int | None = None


class ScoringCoverageRuleOut(BaseModel):
    RuleId: int
    Brand: str
    Level: str
    MinSkus: int
    ScopeType: str
    ScopeId: int | None
    ValidFrom: date
    ValidTo: date | None
    CreatedByUserId: int | None
    CreatedAt: datetime

    model_config = ConfigDict(from_attributes=True)


class ScoringCommunicationRuleCreate(BaseModel):
    MaterialType: str
    Level: str
    Required: bool | None = None
    MinElements: int | None = None
    ScopeType: str
    ScopeId: int | None = None


class ScoringCommunicationRuleOut(BaseModel):
    RuleId: int
    MaterialType: str
    Level: str
    Required: bool | None
    MinElements: int | None
    ScopeType: str
    ScopeId: int | None
    ValidFrom: date
    ValidTo: date | None
    CreatedByUserId: int | None
    CreatedAt: datetime

    model_config = ConfigDict(from_attributes=True)
