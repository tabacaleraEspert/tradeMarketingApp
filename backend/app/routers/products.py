from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import require_role
from ..models.product import Product as ProductModel
from ..schemas.product import Product, ProductCreate, ProductUpdate

router = APIRouter(prefix="/products", tags=["Productos"])


@router.get("", response_model=list[Product])
def list_products(
    category: str | None = None,
    active_only: bool = True,
    skip: int = 0,
    limit: int = Query(default=500, le=1000),
    db: Session = Depends(get_db),
):
    q = db.query(ProductModel)
    if active_only:
        q = q.filter(ProductModel.IsActive == True)
    if category:
        q = q.filter(ProductModel.Category == category)
    return q.order_by(ProductModel.Category, ProductModel.SortOrder, ProductModel.Name).offset(skip).limit(limit).all()


@router.get("/{product_id}", response_model=Product)
def get_product(product_id: int, db: Session = Depends(get_db)):
    p = db.query(ProductModel).filter(ProductModel.ProductId == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return p


@router.post("", response_model=Product, status_code=201, dependencies=[Depends(require_role("territory_manager"))])
def create_product(data: ProductCreate, db: Session = Depends(get_db)):
    p = ProductModel(**data.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@router.patch("/{product_id}", response_model=Product, dependencies=[Depends(require_role("territory_manager"))])
def update_product(product_id: int, data: ProductUpdate, db: Session = Depends(get_db)):
    p = db.query(ProductModel).filter(ProductModel.ProductId == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return p


@router.delete("/{product_id}", status_code=204, dependencies=[Depends(require_role("territory_manager"))])
def delete_product(product_id: int, db: Session = Depends(get_db)):
    p = db.query(ProductModel).filter(ProductModel.ProductId == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    p.IsActive = False
    db.commit()
