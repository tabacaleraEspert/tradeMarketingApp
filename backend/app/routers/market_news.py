from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.market_news import MarketNews as MarketNewsModel
from ..models import Visit as VisitModel
from ..schemas.market_news import MarketNews, MarketNewsCreate, MarketNewsUpdate

router = APIRouter(prefix="/visits", tags=["Novedades de Mercado"])


@router.get("/{visit_id}/market-news", response_model=list[MarketNews])
def list_market_news(visit_id: int, db: Session = Depends(get_db)):
    return (
        db.query(MarketNewsModel)
        .filter(MarketNewsModel.VisitId == visit_id)
        .order_by(MarketNewsModel.CreatedAt)
        .all()
    )


@router.post("/{visit_id}/market-news", response_model=MarketNews, status_code=201)
def create_market_news(visit_id: int, data: MarketNewsCreate, db: Session = Depends(get_db)):
    visit = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not visit:
        raise HTTPException(status_code=404, detail="Visita no encontrada")
    news = MarketNewsModel(
        VisitId=visit_id,
        PdvId=visit.PdvId,
        Tags=data.Tags,
        Notes=data.Notes,
        CreatedBy=data.CreatedBy,
    )
    db.add(news)
    db.commit()
    db.refresh(news)
    return news


@router.patch("/market-news/{news_id}", response_model=MarketNews)
def update_market_news(news_id: int, data: MarketNewsUpdate, db: Session = Depends(get_db)):
    news = db.query(MarketNewsModel).filter(MarketNewsModel.MarketNewsId == news_id).first()
    if not news:
        raise HTTPException(status_code=404, detail="Novedad no encontrada")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(news, k, v)
    db.commit()
    db.refresh(news)
    return news


@router.delete("/market-news/{news_id}", status_code=204)
def delete_market_news(news_id: int, db: Session = Depends(get_db)):
    news = db.query(MarketNewsModel).filter(MarketNewsModel.MarketNewsId == news_id).first()
    if not news:
        raise HTTPException(status_code=404, detail="Novedad no encontrada")
    db.delete(news)
    db.commit()
