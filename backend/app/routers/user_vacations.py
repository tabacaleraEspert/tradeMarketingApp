"""CRUD de vacaciones / licencias de usuarios.

Endpoints:
    GET  /users/{user_id}/vacations          → lista las vacaciones
    POST /users/{user_id}/vacations          → crea un período (admin/territory_manager+)
    DELETE /users/vacations/{vacation_id}     → borra un período (admin)

Usado por `reports.py` para excluir días de vacaciones del cálculo de cumplimiento.
"""
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from ..auth import require_role, get_current_user
from ..database import get_db
from ..models import User as UserModel
from ..models.user_vacation import UserVacation as VacationModel


router = APIRouter(prefix="/users", tags=["Vacaciones"])


class VacationCreate(BaseModel):
    FromDate: date
    ToDate: date
    Reason: str | None = None

    @field_validator("ToDate")
    @classmethod
    def _v_dates(cls, v, info):
        from_d = info.data.get("FromDate")
        if from_d and v < from_d:
            raise ValueError("ToDate debe ser >= FromDate")
        return v


class VacationRead(BaseModel):
    UserVacationId: int
    UserId: int
    FromDate: date
    ToDate: date
    Reason: str | None
    CreatedAt: str

    class Config:
        from_attributes = True


def _serialize(v: VacationModel) -> VacationRead:
    return VacationRead(
        UserVacationId=v.UserVacationId,
        UserId=v.UserId,
        FromDate=v.FromDate,
        ToDate=v.ToDate,
        Reason=v.Reason,
        CreatedAt=v.CreatedAt.isoformat() if v.CreatedAt else "",
    )


@router.get("/{user_id}/vacations", response_model=list[VacationRead])
def list_vacations(
    user_id: int,
    year: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _current: UserModel = Depends(get_current_user),
):
    q = db.query(VacationModel).filter(VacationModel.UserId == user_id)
    if year:
        q = q.filter(
            VacationModel.FromDate <= date(year, 12, 31),
            VacationModel.ToDate >= date(year, 1, 1),
        )
    rows = q.order_by(VacationModel.FromDate.desc()).all()
    return [_serialize(r) for r in rows]


@router.post(
    "/{user_id}/vacations",
    response_model=VacationRead,
    status_code=201,
    dependencies=[Depends(require_role("territory_manager"))],
)
def create_vacation(user_id: int, data: VacationCreate, db: Session = Depends(get_db)):
    user = db.query(UserModel).filter(UserModel.UserId == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    # Check overlap
    overlap = (
        db.query(VacationModel)
        .filter(
            VacationModel.UserId == user_id,
            VacationModel.FromDate <= data.ToDate,
            VacationModel.ToDate >= data.FromDate,
        )
        .first()
    )
    if overlap:
        raise HTTPException(
            status_code=409,
            detail=f"Ya existe un período que se superpone ({overlap.FromDate} – {overlap.ToDate})",
        )
    v = VacationModel(
        UserId=user_id,
        FromDate=data.FromDate,
        ToDate=data.ToDate,
        Reason=data.Reason,
    )
    db.add(v)
    db.commit()
    db.refresh(v)
    return _serialize(v)


@router.delete(
    "/vacations/{vacation_id}",
    status_code=204,
    dependencies=[Depends(require_role("admin"))],
)
def delete_vacation(vacation_id: int, db: Session = Depends(get_db)):
    v = db.query(VacationModel).filter(VacationModel.UserVacationId == vacation_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Vacación no encontrada")
    db.delete(v)
    db.commit()
