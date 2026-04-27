"""Visit indicators: effectiveness and completeness (paso 16).

Visita Efectiva:
  - Al menos 1 acción de ejecución completada (POP, canje, promo, juego)
  - Formulario de cobertura completado (≥1 item)

Completitud:
  - % de pasos completados sobre el total.
  - Pasos obligatorios: proveedor (distributors), cobertura (coverage), POP (pop)
  - Pasos opcionales: sueltos, acciones, novedades
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import get_current_user
from ..models.visit import Visit as VisitModel
from ..models.visit_action import VisitAction as ActionModel
from ..models.visit_coverage import VisitCoverage as CoverageModel
from ..models.visit_pop import VisitPOPItem as POPModel
from ..models.visit_loose import VisitLooseSurvey as LooseModel
from ..models.market_news import MarketNews as NewsModel
from ..models.pdv import PDV as PDVModel
from ..models.user import User as UserModel
from ._visit_auth import check_visit_ownership

router = APIRouter(prefix="/visits/{visit_id}/indicators", tags=["Indicadores de Visita"])

# Execution action types that count toward "Visita Efectiva"
_EXECUTION_TYPES = {"pop", "canje_sueltos", "promo", "juego_ludico"}


class StepStatus(BaseModel):
    name: str
    label: str
    done: bool
    mandatory: bool


class VisitIndicators(BaseModel):
    effective: bool
    completeness: float  # 0.0 – 1.0
    steps: list[StepStatus]
    missing_for_close: list[str]  # human-readable list of blocking items


@router.get("", response_model=VisitIndicators)
def get_visit_indicators(visit_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    visit = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not visit:
        raise HTTPException(404, "Visita no encontrada")
    check_visit_ownership(visit, current_user, db)

    pdv = db.query(PDVModel).filter(PDVModel.PdvId == visit.PdvId).first()

    # --- Gather data ---
    actions = db.query(ActionModel).filter(ActionModel.VisitId == visit_id).all()
    coverage_count = db.query(CoverageModel).filter(CoverageModel.VisitId == visit_id).count()
    pop_count = db.query(POPModel).filter(POPModel.VisitId == visit_id).count()
    loose = db.query(LooseModel).filter(LooseModel.VisitId == visit_id).first()
    news_count = db.query(NewsModel).filter(NewsModel.VisitId == visit_id).count()

    has_distributors = pdv is not None and pdv.DistributorId is not None

    # Execution actions completed
    done_actions = [a for a in actions if a.Status == "DONE" and a.ActionType in _EXECUTION_TYPES]
    has_execution = len(done_actions) > 0

    # --- Build steps ---
    steps = [
        StepStatus(name="distributor", label="Proveedor de cigarrillos", done=has_distributors, mandatory=True),
        StepStatus(name="coverage", label="Cobertura y precios", done=coverage_count > 0, mandatory=True),
        StepStatus(name="pop", label="Censo de materiales POP", done=pop_count > 0, mandatory=True),
        StepStatus(name="loose", label="Relevamiento de sueltos", done=loose is not None, mandatory=False),
        StepStatus(name="actions", label="Acciones ejecutadas", done=has_execution, mandatory=False),
        StepStatus(name="news", label="Novedades de mercado", done=news_count > 0, mandatory=False),
    ]

    # --- Effectiveness ---
    # Effective = at least 1 execution action done + coverage completed
    effective = has_execution and coverage_count > 0

    # --- Completeness ---
    total = len(steps)
    done_count = sum(1 for s in steps if s.done)
    completeness = done_count / total if total > 0 else 0.0

    # --- Missing for close (mandatory steps not done) ---
    missing_for_close = [s.label for s in steps if s.mandatory and not s.done]

    return VisitIndicators(
        effective=effective,
        completeness=round(completeness, 2),
        steps=steps,
        missing_for_close=missing_for_close,
    )
