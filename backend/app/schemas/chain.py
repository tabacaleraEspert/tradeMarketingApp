from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, field_validator

ChainKind = Literal["cadena", "bandera"]


def _clean_name(v: str | None) -> str | None:
    if v is None:
        return v
    v = " ".join(v.split())
    if not v:
        raise ValueError("El nombre no puede estar vacío")
    return v


def _clean_aliases(v: str | None) -> str | None:
    """Normaliza la lista separada por coma (sin vacíos ni repetidos)."""
    if v is None:
        return v
    seen: list[str] = []
    for part in v.split(","):
        p = " ".join(part.split())
        if p and p.lower() not in {s.lower() for s in seen}:
            seen.append(p)
    return ", ".join(seen) or None


class ChainCreate(BaseModel):
    Name: str = Field(..., max_length=80)
    ChannelId: int
    Kind: ChainKind = "cadena"
    IsKeyAccount: bool = False
    AccountManagerUserId: int | None = None
    StoreCount: int | None = Field(None, ge=0)
    Aliases: str | None = Field(None, max_length=500)
    IsActive: bool = True

    @field_validator("Name")
    @classmethod
    def _v_name(cls, v):
        return _clean_name(v)

    @field_validator("Aliases")
    @classmethod
    def _v_aliases(cls, v):
        return _clean_aliases(v)


class ChainUpdate(BaseModel):
    Name: str | None = Field(None, max_length=80)
    Kind: ChainKind | None = None
    IsKeyAccount: bool | None = None
    AccountManagerUserId: int | None = None
    StoreCount: int | None = Field(None, ge=0)
    Aliases: str | None = Field(None, max_length=500)
    IsActive: bool | None = None

    @field_validator("Name")
    @classmethod
    def _v_name(cls, v):
        return _clean_name(v)

    @field_validator("Aliases")
    @classmethod
    def _v_aliases(cls, v):
        return _clean_aliases(v)


class ChainMerge(BaseModel):
    TargetChainId: int


class ChainPublic(BaseModel):
    """Lo que ve cualquier usuario logueado (selects del alta/edición de PDV): sin
    responsable de cuenta ni cantidades."""
    ChainId: int
    Name: str
    ChannelId: int
    Kind: str
    IsKeyAccount: bool
    Aliases: str | None = None
    IsActive: bool

    class Config:
        from_attributes = True


class Chain(BaseModel):
    ChainId: int
    Name: str
    ChannelId: int
    Kind: str
    IsKeyAccount: bool
    AccountManagerUserId: int | None = None
    StoreCount: int | None = None
    Aliases: str | None = None
    IsActive: bool
    CreatedAt: datetime

    class Config:
        from_attributes = True


class ChainAdmin(Chain):
    """Fila de la gestión de cadenas: + conteos y nombres resueltos."""
    ChannelName: str | None = None
    AccountManagerName: str | None = None
    PdvCount: int = 0          # PDVs activos de la app vinculados a la cadena
    EffectiveStoreCount: int = 0  # StoreCount o, si es NULL, PdvCount
    SizeBucket: str | None = None  # Chica / Mediana / Grande (solo Kind='cadena')
