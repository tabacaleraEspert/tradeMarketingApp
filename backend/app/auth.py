"""
Autenticación con JWT.

- `create_access_token(data)` → genera un JWT firmado con expiración configurable
- `decode_token(token)` → valida y devuelve el payload (o levanta HTTPException 401)
- `get_current_user` → dependency de FastAPI que resuelve el User desde el header
  `Authorization: Bearer <token>`
- `require_role(*roles)` → dependency factory para restringir endpoints a ciertos roles

Uso:

    @router.get("/admin-only", dependencies=[Depends(require_role("admin"))])
    def only_admin(current: User = Depends(get_current_user)):
        ...
"""
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import User as UserModel, Role as RoleModel, UserRole as UserRoleModel


# El tokenUrl sólo se usa para la documentación Swagger; el endpoint real es /auth/login
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login", auto_error=False)


# ======================================================================
# Token helpers
# ======================================================================
def create_access_token(
    subject: int | str,
    role: str,
    extra: dict[str, Any] | None = None,
    expires_minutes: int | None = None,
) -> str:
    """Genera un JWT con `sub` = user_id, `role`, `exp`, `iat`, `type`."""
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=expires_minutes or settings.jwt_expire_minutes)
    payload: dict[str, Any] = {
        "sub": str(subject),
        "role": role,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_refresh_token(subject: int | str) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=settings.jwt_refresh_expire_minutes)
    payload = {
        "sub": str(subject),
        "type": "refresh",
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any]:
    """Valida la firma y expiración del token. Levanta 401 si es inválido."""
    try:
        return jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token inválido o expirado",
            headers={"WWW-Authenticate": "Bearer"},
        ) from e


# ======================================================================
# Dependencies
# ======================================================================
def get_user_role(db: Session, user_id: int) -> str:
    """Resuelve el nombre del rol del usuario (o 'vendedor' por default)."""
    ur = db.query(UserRoleModel).filter(UserRoleModel.UserId == user_id).first()
    if not ur:
        return "vendedor"
    r = db.query(RoleModel).filter(RoleModel.RoleId == ur.RoleId).first()
    return r.Name if r else "vendedor"


def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> UserModel:
    """Extrae el usuario autenticado del token JWT en el header Authorization."""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No autenticado",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tipo de token incorrecto",
        )
    sub = payload.get("sub")
    if sub is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token sin subject")
    try:
        user_id = int(sub)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Subject inválido")
    user = db.query(UserModel).filter(UserModel.UserId == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario no encontrado")
    if not user.IsActive:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario inactivo")
    return user


def get_current_user_optional(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> UserModel | None:
    """Igual que get_current_user pero devuelve None si no hay token (para rutas mixtas)."""
    if not token:
        return None
    try:
        return get_current_user(token=token, db=db)
    except HTTPException:
        return None


# ======================================================================
# Role-based access control
# ======================================================================
# Jerarquía: admin > regional_manager > territory_manager > ejecutivo > vendedor (tm_rep)
# Los roles superiores implican los inferiores en cuanto a permisos.
ROLE_HIERARCHY: dict[str, int] = {
    "vendedor": 1,             # TM Rep en la calle
    "ejecutivo": 2,            # Ejecutivo de cuenta (sub-zona)
    "territory_manager": 3,    # Territory Manager (provincia / región)
    "supervisor": 3,           # alias legacy
    "regional_manager": 4,     # Gerente Regional (varias provincias / regiones)
    "admin": 5,                # Director / Directorio
}


def _role_level(role_name: str) -> int:
    return ROLE_HIERARCHY.get(role_name.lower(), 0)


def require_role(*allowed_roles: str, strict: bool = False):
    """Dependency factory que restringe el acceso a ciertos roles.

    - `strict=False` (default): permite el rol exacto O cualquier rol de nivel superior.
      Ej: require_role("ejecutivo") permite también territory_manager y admin.
    - `strict=True`: sólo permite los roles listados, sin jerarquía.
    """
    allowed = {r.lower() for r in allowed_roles}
    min_level = min((_role_level(r) for r in allowed), default=0)

    def checker(
        current_user: UserModel = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> UserModel:
        user_role = get_user_role(db, current_user.UserId)
        user_role_lower = user_role.lower()
        if strict:
            if user_role_lower not in allowed:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Requiere rol {list(allowed)}",
                )
        else:
            if _role_level(user_role_lower) < min_level:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Requiere rol mínimo {list(allowed)}",
                )
        return current_user

    return checker
