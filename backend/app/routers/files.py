"""
Endpoints para subida/descarga de archivos (fotos de visita, adjuntos, etc).

Las fotos se almacenan en Azure Blob (prod) o disco local (dev). El modelo `File`
guarda el `BlobKey` opaco + la `Url` pública generada al momento de subir.

Endpoints:

  POST   /files/photos/visit/{visit_id}   → sube una foto y la asocia a la visita
  GET    /files/photos/visit/{visit_id}   → lista las fotos de la visita (con URLs firmadas frescas)
  DELETE /files/photos/{visit_photo_id}   → borra una foto (sólo el que la subió o admin)
  GET    /files/{file_id}                 → metadata de un archivo (no el contenido)
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import get_current_user, get_user_role
from ..database import get_db
from ..models import User as UserModel, Visit as VisitModel
from ..models.file import File as FileModel
from ..models.visit import VisitPhoto as VisitPhotoModel
from ..storage import storage, compute_sha256


router = APIRouter(prefix="/files", tags=["Archivos"])


# ============================================================================
# Schemas
# ============================================================================
class FileRead(BaseModel):
    FileId: int
    BlobKey: str
    Url: str | None
    ContentType: str | None
    SizeBytes: int | None
    HashSha256: str | None
    CreatedAt: datetime


class VisitPhotoRead(BaseModel):
    VisitId: int
    FileId: int
    PhotoType: str
    SortOrder: int
    Notes: str | None
    # Metadata del File enriquecida
    url: str
    content_type: str | None
    size_bytes: int | None
    created_at: datetime


# ============================================================================
# Config
# ============================================================================
ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB por foto


def _serialize_photo(vp: VisitPhotoModel, f: FileModel) -> VisitPhotoRead:
    # Generar una URL fresca desde el storage (SAS firmada en Azure, pública en local)
    url = storage.get_url(f.BlobKey) if f.BlobKey else (f.Url or "")
    return VisitPhotoRead(
        VisitId=vp.VisitId,
        FileId=vp.FileId,
        PhotoType=vp.PhotoType,
        SortOrder=vp.SortOrder,
        Notes=vp.Notes,
        url=url,
        content_type=f.ContentType,
        size_bytes=int(f.SizeBytes) if f.SizeBytes else None,
        created_at=f.CreatedAt,
    )


# ============================================================================
# Endpoints
# ============================================================================
@router.post("/photos/visit/{visit_id}", response_model=VisitPhotoRead, status_code=201)
async def upload_visit_photo(
    visit_id: int,
    file: UploadFile = File(...),
    photo_type: str = Form(default="general"),
    sort_order: int = Form(default=1),
    notes: str | None = Form(default=None),
    lat: float | None = Form(default=None),
    lon: float | None = Form(default=None),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Sube una foto y la asocia a la visita indicada."""
    # Validaciones
    visit = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not visit:
        raise HTTPException(status_code=404, detail="Visita no encontrada")

    # Sólo el dueño de la visita o admin puede subir fotos a ella
    role = get_user_role(db, current_user.UserId)
    if visit.UserId != current_user.UserId and role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Sólo el TM Rep que abrió la visita o un admin pueden subir fotos",
        )

    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Tipo de archivo no permitido: {content_type}. Sólo imágenes (jpg, png, webp, heic).",
        )

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Archivo vacío")
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Archivo demasiado grande ({len(data)} bytes). Máximo {MAX_FILE_SIZE // (1024 * 1024)} MB.",
        )

    # Subir al storage
    subdir = f"visits/{visit_id}"
    blob_key = storage.upload_bytes(data=data, content_type=content_type, subdir=subdir)
    url = storage.get_url(blob_key)
    sha = compute_sha256(data)

    # Crear registro File
    file_record = FileModel(
        BlobKey=blob_key,
        Url=url,
        ContentType=content_type,
        SizeBytes=len(data),
        HashSha256=sha,
        TakenAt=datetime.now(timezone.utc),
        Lat=lat,
        Lon=lon,
    )
    db.add(file_record)
    db.flush()

    # Crear VisitPhoto
    vp = VisitPhotoModel(
        VisitId=visit_id,
        FileId=file_record.FileId,
        PhotoType=photo_type or "general",
        SortOrder=sort_order or 1,
        Notes=notes,
    )
    db.add(vp)
    db.commit()
    db.refresh(file_record)
    db.refresh(vp)

    return _serialize_photo(vp, file_record)


@router.get("/photos/visit/{visit_id}", response_model=list[VisitPhotoRead])
def list_visit_photos(
    visit_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    visit = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not visit:
        raise HTTPException(status_code=404, detail="Visita no encontrada")

    rows = (
        db.query(VisitPhotoModel, FileModel)
        .join(FileModel, FileModel.FileId == VisitPhotoModel.FileId)
        .filter(VisitPhotoModel.VisitId == visit_id)
        .order_by(VisitPhotoModel.SortOrder.asc(), VisitPhotoModel.FileId.asc())
        .all()
    )
    return [_serialize_photo(vp, f) for vp, f in rows]


@router.delete("/photos/visit/{visit_id}/{file_id}", status_code=204)
def delete_visit_photo(
    visit_id: int,
    file_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    visit = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not visit:
        raise HTTPException(status_code=404, detail="Visita no encontrada")

    role = get_user_role(db, current_user.UserId)
    if visit.UserId != current_user.UserId and role != "admin":
        raise HTTPException(status_code=403, detail="Sólo el dueño de la visita o admin")

    vp = (
        db.query(VisitPhotoModel)
        .filter(VisitPhotoModel.VisitId == visit_id, VisitPhotoModel.FileId == file_id)
        .first()
    )
    if not vp:
        raise HTTPException(status_code=404, detail="Foto no encontrada")

    # Borrar del storage (best-effort) y después de la DB
    f = db.query(FileModel).filter(FileModel.FileId == file_id).first()
    if f and f.BlobKey:
        storage.delete(f.BlobKey)

    db.delete(vp)
    # Si el File no está referenciado por otras VisitPhoto (no debería, es 1-1), borrarlo también
    other_refs = (
        db.query(VisitPhotoModel).filter(VisitPhotoModel.FileId == file_id).count()
    )
    if other_refs <= 1 and f:
        db.delete(f)
    db.commit()
    return None


@router.get("/{file_id}", response_model=FileRead)
def get_file_metadata(
    file_id: int,
    db: Session = Depends(get_db),
):
    f = db.query(FileModel).filter(FileModel.FileId == file_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    return FileRead(
        FileId=f.FileId,
        BlobKey=f.BlobKey,
        Url=storage.get_url(f.BlobKey) if f.BlobKey else f.Url,
        ContentType=f.ContentType,
        SizeBytes=int(f.SizeBytes) if f.SizeBytes else None,
        HashSha256=f.HashSha256,
        CreatedAt=f.CreatedAt,
    )
