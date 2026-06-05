"""Server-side pagination + search helpers.

Contract: list endpoints accept ``page`` / ``page_size`` / ``q`` query params and
return ``{items, total, page, page_size, has_more}``. See
``docs/pagination-and-search-plan.md`` for the full design.

Legacy ``skip`` / ``limit`` are accepted for back-compat; if both come, the new
``page`` / ``page_size`` win.
"""
from typing import Generic, TypeVar
from fastapi import Query
from pydantic import BaseModel
from sqlalchemy.orm import Query as SqlQuery

T = TypeVar("T")


class PageParams:
    """FastAPI dependency that normalizes pagination + search query params."""

    def __init__(
        self,
        page: int = Query(1, ge=1, description="Página 1-based"),
        page_size: int = Query(50, ge=1, le=200, description="Tamaño de página (max 200)"),
        skip: int | None = Query(None, ge=0, description="[legacy] usar page"),
        limit: int | None = Query(None, ge=1, le=200, description="[legacy] usar page_size"),
        q: str | None = Query(None, max_length=200, description="Búsqueda libre"),
        sort: str | None = Query(None, description="Ej: 'OpenedAt:desc'"),
    ):
        # Legacy skip/limit support: if BOTH are provided and page/page_size were
        # left at defaults, derive page from skip. Otherwise the new params win.
        if skip is not None and limit is not None and page == 1 and page_size == 50:
            self.page = (skip // limit) + 1
            self.page_size = limit
        else:
            self.page = page
            self.page_size = page_size
        self.q = (q or "").strip() or None
        self.sort = sort
        self.skip = (self.page - 1) * self.page_size


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    has_more: bool


def paginate(query: SqlQuery, p: PageParams) -> tuple[list, int]:
    """Run COUNT(*) + offset/limit on a SQLAlchemy query. Returns (items, total)."""
    total = query.count()
    items = query.offset(p.skip).limit(p.page_size).all()
    return items, total


def make_page(items: list, total: int, p: PageParams) -> dict:
    """Build the standard response envelope as a dict (so callers can serialize freely)."""
    return {
        "items": items,
        "total": total,
        "page": p.page,
        "page_size": p.page_size,
        "has_more": p.skip + len(items) < total,
    }
