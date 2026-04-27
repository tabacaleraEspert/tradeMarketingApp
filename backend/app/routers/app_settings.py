from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import require_role
from ..models.app_setting import AppSetting

router = APIRouter(prefix="/settings", tags=["Configuración"])


class SettingRead(BaseModel):
    Key: str
    Value: str
    Description: str | None = None

    class Config:
        from_attributes = True


class SettingUpdate(BaseModel):
    Value: str


# Default settings
DEFAULTS = {
    "competitor_coverage_every_n_visits": ("4", "Cada cuántas visitas es obligatoria la cobertura de competencia"),
}


def get_setting(db: Session, key: str) -> str:
    """Get a setting value, returning default if not set."""
    row = db.query(AppSetting).filter(AppSetting.Key == key).first()
    if row:
        return row.Value
    default = DEFAULTS.get(key)
    return default[0] if default else ""


@router.get("", response_model=list[SettingRead])
def list_settings(db: Session = Depends(get_db)):
    """List all settings (includes defaults for missing keys)."""
    existing = {s.Key: s for s in db.query(AppSetting).all()}
    result = []
    for key, (default_val, desc) in DEFAULTS.items():
        if key in existing:
            result.append(existing[key])
        else:
            result.append(SettingRead(Key=key, Value=default_val, Description=desc))
    # Also include any custom settings not in DEFAULTS
    for s in existing.values():
        if s.Key not in DEFAULTS:
            result.append(s)
    return result


@router.get("/{key}", response_model=SettingRead)
def get_setting_endpoint(key: str, db: Session = Depends(get_db)):
    row = db.query(AppSetting).filter(AppSetting.Key == key).first()
    if row:
        return row
    default = DEFAULTS.get(key)
    if default:
        return SettingRead(Key=key, Value=default[0], Description=default[1])
    raise HTTPException(404, "Setting no encontrado")


@router.put("/{key}", response_model=SettingRead, dependencies=[Depends(require_role("territory_manager"))])
def update_setting(key: str, data: SettingUpdate, db: Session = Depends(get_db)):
    row = db.query(AppSetting).filter(AppSetting.Key == key).first()
    if row:
        row.Value = data.Value
    else:
        desc = DEFAULTS.get(key, (None, None))[1]
        row = AppSetting(Key=key, Value=data.Value, Description=desc)
        db.add(row)
    db.commit()
    db.refresh(row)
    return row
