from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .database import engine, Base, get_db
from .models import User as UserModel, UserRole, Role, Zone
from .routers import zones, users, roles, distributors, pdvs, routes, forms, visits, incidents

app = FastAPI(
    title="Trade Marketing API",
    description="API REST para la aplicación de Trade Marketing (MVP)",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)

# Log qué base de datos se usa
_db_url = str(engine.url)
if "sqlite" in _db_url:
    print("[DB] Usando SQLite local (trade_marketing.db) - NO es Azure SQL", flush=True)
else:
    print("[DB] Usando Azure SQL", flush=True)

# Routers
app.include_router(zones.router)
app.include_router(users.router)
app.include_router(roles.router)
app.include_router(distributors.router)
app.include_router(pdvs.router)
app.include_router(routes.router)
app.include_router(forms.router)
app.include_router(visits.router)
app.include_router(incidents.router)


# ============ AUTH ============
class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    UserId: int
    Email: str
    DisplayName: str
    ZoneId: int | None
    ZoneName: str | None
    Role: str
    IsActive: bool


@app.post("/auth/login", response_model=LoginResponse, tags=["Auth"])
def login(data: LoginRequest, db: Session = Depends(get_db)):
    import bcrypt

    user = db.query(UserModel).filter(UserModel.Email == data.email).first()
    if not user:
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    if not user.PasswordHash:
        raise HTTPException(status_code=401, detail="Usuario sin contraseña configurada.")
    if not bcrypt.checkpw(data.password.encode(), user.PasswordHash.encode()):
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    if not user.IsActive:
        raise HTTPException(status_code=401, detail="Usuario inactivo")

    role_name = "vendedor"
    ur = db.query(UserRole).filter(UserRole.UserId == user.UserId).first()
    if ur:
        r = db.query(Role).filter(Role.RoleId == ur.RoleId).first()
        if r:
            role_name = r.Name

    zone_name = None
    if user.ZoneId:
        z = db.query(Zone).filter(Zone.ZoneId == user.ZoneId).first()
        if z:
            zone_name = z.Name

    return LoginResponse(
        UserId=user.UserId,
        Email=user.Email,
        DisplayName=user.DisplayName,
        ZoneId=user.ZoneId,
        ZoneName=zone_name,
        Role=role_name,
        IsActive=user.IsActive,
    )


# ============ ROOT ============
@app.get("/")
def root():
    return {"message": "Trade Marketing API", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok"}
