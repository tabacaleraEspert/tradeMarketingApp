"""
Storage abstracto para archivos binarios (fotos de visitas, etc).

Dos backends intercambiables:

1. **Azure Blob Storage** (producción): se activa cuando `settings.azure_storage_connection_string`
   está seteado. Sube los blobs al container configurado y devuelve URLs firmadas (SAS) con TTL.

2. **Local filesystem** (dev / fallback): guarda los archivos en `./uploads/` y los sirve
   vía el mount estático de FastAPI. Ideal para desarrollar sin Azure.

API pública:

    from app.storage import storage
    key = storage.upload_bytes(data=..., content_type="image/jpeg", subdir="visits/123")
    # key es un BlobKey único que guardás en la DB (tabla File.BlobKey)
    url = storage.get_url(key)  # URL firmada (Azure) o pública (local)
    storage.delete(key)

El BlobKey es opaco (contiene la ruta dentro del container/directorio).
"""
from __future__ import annotations

import hashlib
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol

from .config import settings


class StorageBackend(Protocol):
    def upload_bytes(self, data: bytes, content_type: str, subdir: str = "") -> str: ...
    def get_url(self, key: str) -> str: ...
    def delete(self, key: str) -> None: ...


# ============================================================================
# Azure Blob backend
# ============================================================================
class AzureBlobStorage:
    def __init__(self, connection_string: str, container_name: str, sas_ttl_seconds: int):
        # Import lazy para que el fallback local funcione sin azure-storage-blob instalado
        from azure.storage.blob import BlobServiceClient  # type: ignore

        self._client = BlobServiceClient.from_connection_string(connection_string)
        self._container_name = container_name
        self._sas_ttl_seconds = sas_ttl_seconds
        self._account_name = self._client.account_name
        self._account_key = self._extract_account_key(connection_string)

        # Asegurar que el container existe
        container = self._client.get_container_client(container_name)
        try:
            container.create_container()
        except Exception:
            pass  # Ya existe, OK

    @staticmethod
    def _extract_account_key(conn_str: str) -> str | None:
        for part in conn_str.split(";"):
            if part.startswith("AccountKey="):
                return part[len("AccountKey="):]
        return None

    def upload_bytes(self, data: bytes, content_type: str, subdir: str = "") -> str:
        key = _build_key(data, content_type, subdir)
        from azure.storage.blob import ContentSettings  # type: ignore

        blob = self._client.get_blob_client(container=self._container_name, blob=key)
        blob.upload_blob(
            data,
            overwrite=True,
            content_settings=ContentSettings(content_type=content_type),
        )
        return key

    def get_url(self, key: str) -> str:
        """Devuelve una URL firmada (SAS) con expiración."""
        from azure.storage.blob import BlobSasPermissions, generate_blob_sas  # type: ignore

        if not self._account_key:
            # Sin account key no podemos firmar. Devolver URL pública (sólo anda si el blob es público).
            return f"https://{self._account_name}.blob.core.windows.net/{self._container_name}/{key}"

        expiry = datetime.now(timezone.utc) + timedelta(seconds=self._sas_ttl_seconds)
        sas = generate_blob_sas(
            account_name=self._account_name,
            container_name=self._container_name,
            blob_name=key,
            account_key=self._account_key,
            permission=BlobSasPermissions(read=True),
            expiry=expiry,
        )
        return (
            f"https://{self._account_name}.blob.core.windows.net/"
            f"{self._container_name}/{key}?{sas}"
        )

    def delete(self, key: str) -> None:
        try:
            blob = self._client.get_blob_client(container=self._container_name, blob=key)
            blob.delete_blob()
        except Exception:
            pass  # Tolerante — ya no existe


# ============================================================================
# Local filesystem backend
# ============================================================================
class LocalStorage:
    def __init__(self, base_dir: str, public_base_url: str):
        self._base = Path(base_dir).resolve()
        self._base.mkdir(parents=True, exist_ok=True)
        self._public_base_url = public_base_url.rstrip("/")

    def upload_bytes(self, data: bytes, content_type: str, subdir: str = "") -> str:
        key = _build_key(data, content_type, subdir)
        path = self._base / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return key

    def get_url(self, key: str) -> str:
        # Las URLs locales se sirven vía el StaticFiles mount en `/uploads/...`
        return f"{self._public_base_url}/uploads/{key}"

    def delete(self, key: str) -> None:
        try:
            (self._base / key).unlink(missing_ok=True)
        except Exception:
            pass

    @property
    def base_dir(self) -> Path:
        return self._base


# ============================================================================
# Helpers
# ============================================================================
_EXTENSION_BY_CONTENT_TYPE = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/heic": ".heic",
    "application/pdf": ".pdf",
}


def _build_key(data: bytes, content_type: str, subdir: str = "") -> str:
    """Genera un BlobKey único con estructura: <subdir>/<YYYY/MM/DD>/<uuid>.<ext>"""
    ext = _EXTENSION_BY_CONTENT_TYPE.get(content_type.lower(), ".bin")
    today = datetime.now(timezone.utc)
    date_path = today.strftime("%Y/%m/%d")
    unique = uuid.uuid4().hex
    parts = [p.strip("/") for p in (subdir, date_path) if p]
    prefix = "/".join(parts)
    return f"{prefix}/{unique}{ext}" if prefix else f"{unique}{ext}"


def compute_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ============================================================================
# Singleton
# ============================================================================
def _build_storage() -> StorageBackend:
    if settings.azure_storage_connection_string:
        try:
            print("[STORAGE] Usando Azure Blob Storage", flush=True)
            return AzureBlobStorage(
                connection_string=settings.azure_storage_connection_string,
                container_name=settings.azure_storage_container,
                sas_ttl_seconds=settings.blob_sas_ttl_seconds,
            )
        except Exception as e:
            print(f"[STORAGE] Error inicializando Azure Blob ({e}), fallback a local", flush=True)
    print(f"[STORAGE] Usando filesystem local: {settings.local_upload_dir}", flush=True)
    return LocalStorage(
        base_dir=settings.local_upload_dir,
        public_base_url=settings.public_base_url,
    )


storage: StorageBackend = _build_storage()


def is_local_backend() -> bool:
    return isinstance(storage, LocalStorage)


def get_local_base_dir() -> Path | None:
    if isinstance(storage, LocalStorage):
        return storage.base_dir
    return None
