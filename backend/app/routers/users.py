from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session
import bcrypt

from ..database import get_db
from ..models import User as UserModel, Visit as VisitModel, PDV as PDVModel
from ..models.user import UserRole as UserRoleModel, Role as RoleModel
from ..models.file import File as FileModel
from ..schemas.user import User, UserCreate, UserUpdate
from ..hierarchy import get_all_subordinate_ids, get_direct_subordinates, get_visible_user_ids
from ..auth import get_current_user, require_role, get_user_role as _auth_get_user_role
from ..storage import storage, compute_sha256


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
router = APIRouter(prefix="/users", tags=["Usuarios"])


def _attach_role(user: UserModel, db: Session) -> User:
    """Serializa un User incluyendo el nombre del rol y la URL del avatar."""
    ur = db.query(UserRoleModel).filter(UserRoleModel.UserId == user.UserId).first()
    role_name = None
    if ur:
        r = db.query(RoleModel).filter(RoleModel.RoleId == ur.RoleId).first()
        role_name = r.Name if r else None

    avatar_url = None
    avatar_id = getattr(user, "AvatarFileId", None)
    if avatar_id:
        f = db.query(FileModel).filter(FileModel.FileId == avatar_id).first()
        if f and f.BlobKey:
            try:
                avatar_url = storage.get_url(f.BlobKey)
            except Exception:
                avatar_url = f.Url

    data = {
        "UserId": user.UserId,
        "Email": user.Email,
        "DisplayName": user.DisplayName,
        "ZoneId": user.ZoneId,
        "ManagerUserId": getattr(user, "ManagerUserId", None),
        "IsActive": user.IsActive,
        "MustChangePassword": bool(getattr(user, "MustChangePassword", False)),
        "RoleName": role_name,
        "AvatarUrl": avatar_url,
        "CreatedAt": user.CreatedAt,
        "UpdatedAt": user.UpdatedAt,
    }
    return User.model_validate(data)


def _ensure_role(db: Session, user_id: int, role_name: str) -> None:
    """Upsert del rol del usuario usando el nombre."""
    role = db.query(RoleModel).filter(RoleModel.Name == role_name).first()
    if not role:
        role = RoleModel(Name=role_name)
        db.add(role)
        db.flush()
    ur = db.query(UserRoleModel).filter(UserRoleModel.UserId == user_id).first()
    if ur:
        ur.RoleId = role.RoleId
    else:
        db.add(UserRoleModel(UserId=user_id, RoleId=role.RoleId))


@router.get("", response_model=list[User])
def list_users(
    skip: int = 0,
    limit: int = Query(default=100, le=500),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Lista usuarios. Sub-árbol enforced: cada uno ve sólo los de su jerarquía."""
    role_name = _auth_get_user_role(db, current_user.UserId)
    visible_ids = get_visible_user_ids(db, current_user, role_name)
    q = db.query(UserModel)
    if visible_ids is not None:
        if not visible_ids:
            return []
        q = q.filter(UserModel.UserId.in_(visible_ids))
    users = q.order_by(UserModel.UserId).offset(skip).limit(limit).all()
    return [_attach_role(u, db) for u in users]


@router.get("/{user_id}", response_model=User)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    role_name = _auth_get_user_role(db, current_user.UserId)
    visible_ids = get_visible_user_ids(db, current_user, role_name)
    if visible_ids is not None and user_id not in visible_ids:
        raise HTTPException(status_code=403, detail="No tenés permiso para ver este usuario")
    user = db.query(UserModel).filter(UserModel.UserId == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return _attach_role(user, db)


@router.get("/{user_id}/subordinates")
def list_subordinates(
    user_id: int,
    recursive: bool = True,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Lista los subordinados de un usuario (directos o de todo el sub-árbol)."""
    # Sólo admin o el propio usuario (o alguien arriba de él) pueden pedir sus subordinados
    role_name = _auth_get_user_role(db, current_user.UserId)
    visible_ids = get_visible_user_ids(db, current_user, role_name)
    if visible_ids is not None and user_id not in visible_ids:
        raise HTTPException(status_code=403, detail="No tenés permiso")
    user = db.query(UserModel).filter(UserModel.UserId == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if recursive:
        sub_ids = get_all_subordinate_ids(db, user_id)
        if not sub_ids:
            return []
        subs = db.query(UserModel).filter(UserModel.UserId.in_(sub_ids)).all()
    else:
        subs = get_direct_subordinates(db, user_id)
    return [_attach_role(s, db) for s in subs]


@router.get("/{user_id}/stats/monthly")
def get_user_monthly_stats(user_id: int, db: Session = Depends(get_db)):
    """Estadísticas del mes actual: visitas, cumplimiento, PDV nuevos."""
    user = db.query(UserModel).filter(UserModel.UserId == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    now = datetime.now(timezone.utc)
    first_day = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if now.month == 12:
        last_day = now.replace(day=31, hour=23, minute=59, second=59, microsecond=999999)
    else:
        last_day = (first_day + timedelta(days=32)).replace(day=1) - timedelta(microseconds=1)

    # Visitas del mes (por OpenedAt)
    visits = (
        db.query(VisitModel)
        .filter(
            VisitModel.UserId == user_id,
            VisitModel.OpenedAt >= first_day,
            VisitModel.OpenedAt <= last_day,
        )
        .all()
    )
    total_visits = len(visits)
    completed_visits = sum(
        1 for v in visits if v.Status and v.Status.upper() in ("CLOSED", "COMPLETED")
    )
    compliance = round((completed_visits / total_visits * 100) if total_visits > 0 else 0)

    # PDV nuevos del mes (en la zona del usuario, por CreatedAt)
    pdv_q = db.query(PDVModel).filter(
        PDVModel.CreatedAt >= first_day,
        PDVModel.CreatedAt <= last_day,
    )
    if user.ZoneId:
        pdv_q = pdv_q.filter(PDVModel.ZoneId == user.ZoneId)
    new_pdvs = pdv_q.count()

    return {
        "visits": total_visits,
        "compliance": compliance,
        "new_pdvs": new_pdvs,
    }


@router.post("", response_model=User, status_code=201, dependencies=[Depends(require_role("admin"))])
def create_user(data: UserCreate, db: Session = Depends(get_db)):
    # Validar email único
    existing = db.query(UserModel).filter(UserModel.Email == data.Email).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Ya existe un usuario con el email '{data.Email}'")

    # Validar manager existe (si se pasa)
    if data.ManagerUserId is not None:
        manager = db.query(UserModel).filter(UserModel.UserId == data.ManagerUserId).first()
        if not manager:
            raise HTTPException(status_code=400, detail="ManagerUserId no existe")

    password_hash = None
    if data.Password:
        password_hash = hash_password(data.Password)
    user = UserModel(
        Email=data.Email,
        DisplayName=data.DisplayName,
        ZoneId=data.ZoneId,
        ManagerUserId=data.ManagerUserId,
        MustChangePassword=data.MustChangePassword,
        IsActive=data.IsActive,
        PasswordHash=password_hash,
    )
    db.add(user)
    db.flush()
    if data.RoleName:
        _ensure_role(db, user.UserId, data.RoleName)
    db.commit()
    db.refresh(user)
    return _attach_role(user, db)


@router.patch("/{user_id}", response_model=User, dependencies=[Depends(require_role("admin"))])
def update_user(user_id: int, data: UserUpdate, db: Session = Depends(get_db)):
    user = db.query(UserModel).filter(UserModel.UserId == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    dump = data.model_dump(exclude_unset=True)

    # Validar email único si se está cambiando
    new_email = dump.get("Email")
    if new_email and new_email != user.Email:
        clash = db.query(UserModel).filter(
            UserModel.Email == new_email,
            UserModel.UserId != user_id,
        ).first()
        if clash:
            raise HTTPException(status_code=409, detail=f"Ya existe otro usuario con el email '{new_email}'")

    # Validar manager: existe + no es self + no genera ciclo
    new_manager = dump.get("ManagerUserId")
    if new_manager is not None:
        if new_manager == user_id:
            raise HTTPException(status_code=400, detail="Un usuario no puede ser su propio manager")
        manager = db.query(UserModel).filter(UserModel.UserId == new_manager).first()
        if not manager:
            raise HTTPException(status_code=400, detail="ManagerUserId no existe")
        # Detección de ciclo: el nuevo manager no puede estar en el sub-árbol de este user
        from ..hierarchy import get_all_subordinate_ids
        if new_manager in get_all_subordinate_ids(db, user_id):
            raise HTTPException(
                status_code=400,
                detail="No se puede crear un ciclo en la jerarquía: ese usuario está bajo este",
            )

    if "Password" in dump:
        pwd = dump.pop("Password")
        if pwd:
            user.PasswordHash = hash_password(pwd)
    role_name = dump.pop("RoleName", None)
    for k, v in dump.items():
        setattr(user, k, v)
    if role_name:
        _ensure_role(db, user.UserId, role_name)
    db.commit()
    db.refresh(user)
    return _attach_role(user, db)


@router.delete("/{user_id}", status_code=204, dependencies=[Depends(require_role("admin"))])
def delete_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(UserModel).filter(UserModel.UserId == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    db.delete(user)
    db.commit()


# ── User Role ─────────────────────────────────────────────

@router.get("/{user_id}/role")
def get_user_role(user_id: int, db: Session = Depends(get_db)):
    ur = db.query(UserRoleModel).filter(UserRoleModel.UserId == user_id).first()
    if not ur:
        return {"userId": user_id, "roleId": None, "roleName": None}
    role = db.query(RoleModel).filter(RoleModel.RoleId == ur.RoleId).first()
    return {"userId": user_id, "roleId": ur.RoleId, "roleName": role.Name if role else None}


@router.put("/{user_id}/role", dependencies=[Depends(require_role("admin"))])
def set_user_role(user_id: int, data: dict, db: Session = Depends(get_db)):
    """Payload: { roleId: int }"""
    user = db.query(UserModel).filter(UserModel.UserId == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    role_id = data.get("roleId")
    if not role_id:
        raise HTTPException(status_code=400, detail="roleId requerido")
    # Upsert
    ur = db.query(UserRoleModel).filter(UserRoleModel.UserId == user_id).first()
    if ur:
        ur.RoleId = role_id
    else:
        ur = UserRoleModel(UserId=user_id, RoleId=role_id)
        db.add(ur)
    db.commit()
    role = db.query(RoleModel).filter(RoleModel.RoleId == role_id).first()
    return {"userId": user_id, "roleId": role_id, "roleName": role.Name if role else None}


# ── Avatar (foto de perfil) ─────────────────────────────────
_AVATAR_ALLOWED_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}
_AVATAR_MAX_SIZE = 5 * 1024 * 1024  # 5 MB


@router.post("/{user_id}/avatar", response_model=User)
async def upload_user_avatar(
    user_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Sube/reemplaza el avatar de un usuario.
    Permitido: el propio usuario o un admin.
    """
    user = db.query(UserModel).filter(UserModel.UserId == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    # Permisos: el dueño o un admin
    role = _auth_get_user_role(db, current_user.UserId)
    if user.UserId != current_user.UserId and role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Sólo el propio usuario o un admin pueden cambiar el avatar",
        )

    content_type = (file.content_type or "").lower()
    if content_type not in _AVATAR_ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Tipo no permitido: {content_type}. Sólo jpg/png/webp.",
        )

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Archivo vacío")
    if len(data) > _AVATAR_MAX_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Imagen demasiado grande (máx {_AVATAR_MAX_SIZE // (1024 * 1024)} MB)",
        )

    # Subir al storage
    blob_key = storage.upload_bytes(data=data, content_type=content_type, subdir=f"avatars/{user_id}")
    url = storage.get_url(blob_key)

    # Eliminar el avatar anterior si existía
    old_file_id = getattr(user, "AvatarFileId", None)
    if old_file_id:
        old_file = db.query(FileModel).filter(FileModel.FileId == old_file_id).first()
        if old_file:
            if old_file.BlobKey:
                storage.delete(old_file.BlobKey)
            db.delete(old_file)

    # Crear nuevo File
    new_file = FileModel(
        BlobKey=blob_key,
        Url=url,
        ContentType=content_type,
        SizeBytes=len(data),
        HashSha256=compute_sha256(data),
    )
    db.add(new_file)
    db.flush()

    user.AvatarFileId = new_file.FileId
    db.commit()
    db.refresh(user)
    return _attach_role(user, db)


@router.delete("/{user_id}/avatar", response_model=User)
def delete_user_avatar(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    user = db.query(UserModel).filter(UserModel.UserId == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    role = _auth_get_user_role(db, current_user.UserId)
    if user.UserId != current_user.UserId and role != "admin":
        raise HTTPException(status_code=403, detail="Sólo el dueño o admin")

    file_id = getattr(user, "AvatarFileId", None)
    if file_id:
        f = db.query(FileModel).filter(FileModel.FileId == file_id).first()
        if f:
            if f.BlobKey:
                storage.delete(f.BlobKey)
            db.delete(f)
        user.AvatarFileId = None
        db.commit()
        db.refresh(user)
    return _attach_role(user, db)
