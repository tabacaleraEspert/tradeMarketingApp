from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import get_current_user
from ..models.visit_coverage import VisitCoverage as CoverageModel
from ..models.product import Product as ProductModel
from ..models.visit import Visit as VisitModel
from ..models.user import User as UserModel
from ..schemas.visit_coverage import VisitCoverageRead, VisitCoverageBulk, CoverageDiff
from ._visit_auth import check_visit_ownership

router = APIRouter(prefix="/visits/{visit_id}/coverage", tags=["Cobertura y Precios"])


@router.get("/requirements")
def coverage_requirements(visit_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    """Returns whether own and competitor coverage is required for this visit."""
    visit = _get_visit_checked(visit_id, current_user, db)

    from ..routers.app_settings import get_setting
    n_str = get_setting(db, "competitor_coverage_every_n_visits")
    n = int(n_str) if n_str.isdigit() else 4

    closed_count = (
        db.query(VisitModel)
        .filter(
            VisitModel.PdvId == visit.PdvId,
            VisitModel.VisitId != visit_id,
            VisitModel.Status.in_(["CLOSED", "COMPLETED"]),
        )
        .count()
    )
    visit_number = closed_count + 1
    competitor_due = (visit_number % n) == 0 or visit_number == 1

    return {
        "ownRequired": True,
        "competitorRequired": competitor_due,
        "competitorEveryN": n,
        "visitNumber": visit_number,
        "nextCompetitorAt": n - (visit_number % n) if not competitor_due else 0,
    }


def _get_visit_checked(visit_id: int, current_user: UserModel, db: Session) -> VisitModel:
    visit = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not visit:
        raise HTTPException(404, "Visita no encontrada")
    check_visit_ownership(visit, current_user, db)
    return visit


@router.get("", response_model=list[VisitCoverageRead])
def list_coverage(visit_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_visit_checked(visit_id, current_user, db)
    return db.query(CoverageModel).filter(CoverageModel.VisitId == visit_id).all()


@router.put("", response_model=list[VisitCoverageRead])
def bulk_save_coverage(visit_id: int, data: VisitCoverageBulk, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    """Bulk save: replace all coverage items for a visit."""
    visit = _get_visit_checked(visit_id, current_user, db)
    if visit.Status in ("CLOSED", "COMPLETED"):
        raise HTTPException(400, "No se puede modificar una visita cerrada")

    # Delete existing
    db.query(CoverageModel).filter(CoverageModel.VisitId == visit_id).delete()

    # Insert new
    for item in data.items:
        db.add(CoverageModel(
            VisitId=visit_id,
            ProductId=item.ProductId,
            Works=item.Works,
            Price=item.Price if item.Works else None,
            Availability=item.Availability if item.Works else None,
        ))
    db.commit()
    return db.query(CoverageModel).filter(CoverageModel.VisitId == visit_id).all()


@router.get("/diff", response_model=list[CoverageDiff])
def coverage_with_diff(visit_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return current coverage with diff vs previous visit for the same PDV."""
    visit = _get_visit_checked(visit_id, current_user, db)

    # Find previous visit for same PDV
    prev_visit = (
        db.query(VisitModel)
        .filter(
            VisitModel.PdvId == visit.PdvId,
            VisitModel.VisitId != visit_id,
            VisitModel.Status.in_(["CLOSED", "COMPLETED"]),
        )
        .order_by(VisitModel.ClosedAt.desc())
        .first()
    )

    # Build previous coverage map
    prev_map = {}
    if prev_visit:
        prev_rows = db.query(CoverageModel).filter(CoverageModel.VisitId == prev_visit.VisitId).all()
        prev_map = {r.ProductId: r for r in prev_rows}

    # Current coverage
    current_rows = db.query(CoverageModel).filter(CoverageModel.VisitId == visit_id).all()
    current_map = {r.ProductId: r for r in current_rows}

    # Get all products involved
    product_ids = set(current_map.keys()) | set(prev_map.keys())
    products = {p.ProductId: p for p in db.query(ProductModel).filter(ProductModel.ProductId.in_(product_ids)).all()} if product_ids else {}

    result = []
    for pid in sorted(product_ids):
        prod = products.get(pid)
        if not prod:
            continue
        cur = current_map.get(pid)
        prev = prev_map.get(pid)
        result.append(CoverageDiff(
            ProductId=pid,
            ProductName=prod.Name,
            Category=prod.Category,
            Manufacturer=prod.Manufacturer,
            Works=cur.Works if cur else False,
            Price=cur.Price if cur else None,
            Availability=cur.Availability if cur else None,
            PrevWorks=prev.Works if prev else None,
            PrevPrice=prev.Price if prev else None,
            PrevAvailability=prev.Availability if prev else None,
        ))
    return result
