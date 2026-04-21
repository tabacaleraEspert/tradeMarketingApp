from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .database import engine, Base, get_db
from .models import User as UserModel, UserRole, Role, Zone
from .routers import zones, users, roles, distributors, channels, subchannels, pdvs, routes, forms, visits, incidents, notifications, visit_actions, market_news, reports, mandatory_activities, pdv_notes, files, holidays, user_vacations, route_generator
from .auth import create_access_token, create_refresh_token, decode_token, get_current_user, get_user_role
from .storage import is_local_backend, get_local_base_dir
from .middleware import RequestIdMiddleware, configure_logging
from .observability import init_sentry
from .config import settings

configure_logging()
init_sentry()

# Issue 1.5: Warn loudly if JWT secret is still the default dev value
if settings.jwt_secret_key == "dev-secret-CHANGEME-in-prod-please":
    import logging
    logging.getLogger("app").warning("⚠️  JWT_SECRET_KEY is using the default dev value! Set it in production!")

app = FastAPI(
    title="Trade Marketing API",
    description="API REST para la aplicación de Trade Marketing (MVP)",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin] if settings.frontend_origin else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)
app.add_middleware(RequestIdMiddleware)

# DB bootstrap.
#
# En producción (Azure) las tablas se crean/migran con Alembic (`alembic upgrade head`)
# durante el deploy. En local / SQLite, si la DB no existe, hacemos create_all como
# fallback para no trabar a un dev que arranca por primera vez.
#
# Si querés forzar que main.py NO toque el schema (ej. en CI), seteá AUTO_CREATE_TABLES=0.
import os as _os

_auto_create = _os.getenv("AUTO_CREATE_TABLES", "1") != "0"
_db_url = str(engine.url)
_is_sqlite = "sqlite" in _db_url

if _auto_create and _is_sqlite:
    # SQLite local: create_all es idempotente y rápido. Sigue siendo útil para devs nuevos.
    Base.metadata.create_all(bind=engine)

if _is_sqlite:
    print("[DB] SQLite local (trade_marketing.db)", flush=True)
else:
    print("[DB] Azure SQL — asegurate de correr `alembic upgrade head` durante el deploy", flush=True)

# Routers — todos requieren autenticación (Bearer token). /auth/* y /health quedan públicos.
_auth_dep = [Depends(get_current_user)]
app.include_router(zones.router, dependencies=_auth_dep)
app.include_router(users.router, dependencies=_auth_dep)
app.include_router(roles.router, dependencies=_auth_dep)
app.include_router(distributors.router, dependencies=_auth_dep)
app.include_router(channels.router, dependencies=_auth_dep)
app.include_router(subchannels.router, dependencies=_auth_dep)
app.include_router(pdvs.router, dependencies=_auth_dep)
app.include_router(routes.router, dependencies=_auth_dep)
app.include_router(forms.router, dependencies=_auth_dep)
app.include_router(visits.router, dependencies=_auth_dep)
app.include_router(incidents.router, dependencies=_auth_dep)
app.include_router(notifications.router, dependencies=_auth_dep)
app.include_router(visit_actions.router, dependencies=_auth_dep)
app.include_router(market_news.router, dependencies=_auth_dep)
app.include_router(reports.router, dependencies=_auth_dep)
app.include_router(mandatory_activities.router, dependencies=_auth_dep)
app.include_router(pdv_notes.router, dependencies=_auth_dep)
app.include_router(files.router, dependencies=_auth_dep)
app.include_router(holidays.router, dependencies=_auth_dep)
app.include_router(user_vacations.router, dependencies=_auth_dep)
app.include_router(route_generator.router, dependencies=_auth_dep)

# Servir archivos locales cuando estamos en modo fallback (dev sin Azure).
# En producción con Azure Blob, este mount es inocuo (directory puede no existir).
if is_local_backend():
    _local_dir = get_local_base_dir()
    if _local_dir is not None:
        _local_dir.mkdir(parents=True, exist_ok=True)
        app.mount("/uploads", StaticFiles(directory=str(_local_dir)), name="uploads")


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
    MustChangePassword: bool = False
    # JWT
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # segundos


class RefreshRequest(BaseModel):
    refresh_token: str


class RefreshResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


def _build_login_response(user: UserModel, db: Session) -> LoginResponse:
    role_name = get_user_role(db, user.UserId)

    zone_name = None
    if user.ZoneId:
        z = db.query(Zone).filter(Zone.ZoneId == user.ZoneId).first()
        if z:
            zone_name = z.Name

    from .config import settings
    access = create_access_token(subject=user.UserId, role=role_name)
    refresh = create_refresh_token(subject=user.UserId)

    return LoginResponse(
        UserId=user.UserId,
        Email=user.Email,
        DisplayName=user.DisplayName,
        ZoneId=user.ZoneId,
        ZoneName=zone_name,
        Role=role_name,
        IsActive=user.IsActive,
        MustChangePassword=bool(getattr(user, "MustChangePassword", False)),
        access_token=access,
        refresh_token=refresh,
        expires_in=settings.jwt_expire_minutes * 60,
    )


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

    return _build_login_response(user, db)


@app.post("/auth/refresh", response_model=RefreshResponse, tags=["Auth"])
def refresh_token(data: RefreshRequest, db: Session = Depends(get_db)):
    """Toma un refresh token válido y emite un nuevo access token."""
    payload = decode_token(data.refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="No es un refresh token")
    sub = payload.get("sub")
    if sub is None:
        raise HTTPException(status_code=401, detail="Token sin subject")
    try:
        user_id = int(sub)
    except ValueError:
        raise HTTPException(status_code=401, detail="Subject inválido")
    user = db.query(UserModel).filter(UserModel.UserId == user_id).first()
    if not user or not user.IsActive:
        raise HTTPException(status_code=401, detail="Usuario inválido")

    role_name = get_user_role(db, user.UserId)
    from .config import settings
    access = create_access_token(subject=user.UserId, role=role_name)
    return RefreshResponse(
        access_token=access,
        expires_in=settings.jwt_expire_minutes * 60,
    )


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@app.post("/auth/change-password", tags=["Auth"])
def change_password(
    data: ChangePasswordRequest,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Cambia la contraseña del usuario autenticado y limpia el flag MustChangePassword."""
    import bcrypt

    if not current_user.PasswordHash:
        raise HTTPException(status_code=400, detail="Usuario sin contraseña configurada")
    if not bcrypt.checkpw(data.current_password.encode(), current_user.PasswordHash.encode()):
        raise HTTPException(status_code=400, detail="Contraseña actual incorrecta")

    if len(data.new_password) < 8:
        raise HTTPException(status_code=400, detail="La nueva contraseña debe tener al menos 8 caracteres")

    if bcrypt.checkpw(data.new_password.encode(), current_user.PasswordHash.encode()):
        raise HTTPException(status_code=400, detail="La nueva contraseña debe ser diferente a la actual")

    current_user.PasswordHash = bcrypt.hashpw(data.new_password.encode(), bcrypt.gensalt()).decode()
    current_user.MustChangePassword = False
    db.commit()
    return {"ok": True}


class MeResponse(BaseModel):
    UserId: int
    Email: str
    DisplayName: str
    ZoneId: int | None
    ZoneName: str | None
    Role: str
    IsActive: bool
    MustChangePassword: bool = False


@app.get("/auth/me", response_model=MeResponse, tags=["Auth"])
def me(
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Devuelve el usuario autenticado (validando el JWT)."""
    role_name = get_user_role(db, current_user.UserId)
    zone_name = None
    if current_user.ZoneId:
        z = db.query(Zone).filter(Zone.ZoneId == current_user.ZoneId).first()
        if z:
            zone_name = z.Name
    return MeResponse(
        UserId=current_user.UserId,
        Email=current_user.Email,
        DisplayName=current_user.DisplayName,
        ZoneId=current_user.ZoneId,
        ZoneName=zone_name,
        Role=role_name,
        IsActive=current_user.IsActive,
        MustChangePassword=bool(getattr(current_user, "MustChangePassword", False)),
    )


# ============ ROOT ============
@app.get("/")
def root():
    return {"message": "Trade Marketing API", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok"}
