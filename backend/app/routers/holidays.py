from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..auth import require_role
from ..database import get_db
from ..models.holiday import Holiday as HolidayModel
from ..schemas.holiday import Holiday, HolidayCreate, HolidayUpdate


router = APIRouter(prefix="/holidays", tags=["Feriados"])


@router.get("", response_model=list[Holiday])
def list_holidays(
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    active_only: bool = True,
    db: Session = Depends(get_db),
):
    """Lista feriados, opcionalmente filtrados por rango de fechas."""
    q = db.query(HolidayModel)
    if active_only:
        q = q.filter(HolidayModel.IsActive== True)
    if from_date is not None:
        q = q.filter(HolidayModel.Date >= from_date)
    if to_date is not None:
        q = q.filter(HolidayModel.Date <= to_date)
    return q.order_by(HolidayModel.Date.asc()).all()


@router.get("/check/{check_date}")
def check_holiday(check_date: date, db: Session = Depends(get_db)):
    """Devuelve el feriado correspondiente a esa fecha o null."""
    h = db.query(HolidayModel).filter(
        HolidayModel.Date == check_date,
        HolidayModel.IsActive== True,
    ).first()
    if not h:
        return {"date": check_date.isoformat(), "isHoliday": False}
    return {
        "date": check_date.isoformat(),
        "isHoliday": True,
        "name": h.Name,
        "kind": h.Kind,
    }


@router.post("", response_model=Holiday, status_code=201, dependencies=[Depends(require_role("admin"))])
def create_holiday(data: HolidayCreate, db: Session = Depends(get_db)):
    existing = db.query(HolidayModel).filter(HolidayModel.Date == data.Date).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Ya existe un feriado en {data.Date}")
    h = HolidayModel(
        Date=data.Date,
        Name=data.Name,
        Kind=data.Kind,
        IsActive=data.IsActive,
    )
    db.add(h)
    db.commit()
    db.refresh(h)
    return h


@router.patch("/{holiday_id}", response_model=Holiday, dependencies=[Depends(require_role("admin"))])
def update_holiday(holiday_id: int, data: HolidayUpdate, db: Session = Depends(get_db)):
    h = db.query(HolidayModel).filter(HolidayModel.HolidayId == holiday_id).first()
    if not h:
        raise HTTPException(status_code=404, detail="Feriado no encontrado")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(h, k, v)
    db.commit()
    db.refresh(h)
    return h


@router.delete("/{holiday_id}", status_code=204, dependencies=[Depends(require_role("admin"))])
def delete_holiday(holiday_id: int, db: Session = Depends(get_db)):
    h = db.query(HolidayModel).filter(HolidayModel.HolidayId == holiday_id).first()
    if not h:
        raise HTTPException(status_code=404, detail="Feriado no encontrado")
    db.delete(h)
    db.commit()
