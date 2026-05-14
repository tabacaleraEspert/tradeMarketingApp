"""
Middlewares para la app.

- **RequestIdMiddleware**: asigna un ID único a cada request entrante. Si el cliente
  ya mandó `X-Request-ID`, lo respetamos; si no, generamos uno nuevo.
  El ID queda disponible en `request.state.request_id` y se echoes en el response
  header. También se incluye en los logs de errores 500 para trazabilidad.

- **ErrorEnvelopeMiddleware**: captura excepciones no manejadas y devuelve un JSON
  consistente con `detail` + `request_id`. Así el frontend puede mostrar siempre:
  "Error del servidor. Código: abc-123"
"""
import logging
import traceback
import uuid

from fastapi import Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


logger = logging.getLogger("app")


def _short_id() -> str:
    """ID corto legible por humanos: 8 caracteres."""
    return uuid.uuid4().hex[:8]


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        rid = request.headers.get("X-Request-ID") or _short_id()
        request.state.request_id = rid

        # Adjuntar el request_id al scope de Sentry (si está activo)
        try:
            from .observability import capture_request_id
            capture_request_id(rid)
        except Exception:
            pass

        try:
            response = await call_next(request)
        except Exception as exc:
            # Error no capturado por el endpoint. Logueamos con stack completo.
            logger.error(
                "Unhandled exception | rid=%s | path=%s | method=%s | %s",
                rid,
                request.url.path,
                request.method,
                exc,
            )
            logger.error("Traceback: %s", traceback.format_exc())

            # Build CORS headers so the browser can read the error response
            cors_headers: dict[str, str] = {"X-Request-ID": rid}
            origin = request.headers.get("origin")
            if origin:
                from .config import settings
                allowed = [o.strip() for o in settings.frontend_origin.split(",") if o.strip()] if settings.frontend_origin else []
                if not allowed or origin in allowed:
                    cors_headers["Access-Control-Allow-Origin"] = origin
                    cors_headers["Access-Control-Allow-Credentials"] = "true"

            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={
                    "detail": "Error interno del servidor",
                    "request_id": rid,
                },
                headers=cors_headers,
            )
        response.headers["X-Request-ID"] = rid
        return response


class AuditMiddleware(BaseHTTPMiddleware):
    """Logs all write operations (POST/PUT/PATCH/DELETE) to AuditEvent table."""

    # Paths to skip (health checks, auth, static files)
    SKIP_PREFIXES = ("/docs", "/openapi", "/static", "/auth/refresh")
    WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

    async def dispatch(self, request: Request, call_next):
        method = request.method
        path = request.url.path

        # Only audit write operations
        if method not in self.WRITE_METHODS or any(path.startswith(p) for p in self.SKIP_PREFIXES):
            return await call_next(request)

        # Execute the request first (don't read body — it breaks downstream)
        response = await call_next(request)

        # Derive payload info from content-type (don't read body to avoid consuming it)
        content_type = request.headers.get("content-type", "")
        payload_str = None
        if "multipart" in content_type:
            payload_str = '{"_type": "file_upload"}'

        # Only log successful writes
        if response.status_code >= 200 and response.status_code < 300:
            try:
                # Extract user from JWT token
                user_id = None
                auth_header = request.headers.get("authorization", "")
                if auth_header.startswith("Bearer "):
                    token = auth_header[7:]
                    try:
                        from .auth import decode_token
                        payload = decode_token(token)
                        user_id = payload.get("sub")
                    except Exception:
                        pass

                # Derive entity and entity_id from path
                # Examples: /pdvs/123 → entity=PDV, entityId=123
                #           /routes/42/pdvs → entity=RoutePdv, entityId=42
                #           /visits/100/actions → entity=VisitAction, entityId=100
                parts = [p for p in path.strip("/").split("/") if p]
                entity = parts[0] if parts else "unknown"
                entity_id = parts[1] if len(parts) > 1 else "0"
                if len(parts) > 2:
                    entity = f"{parts[0]}_{parts[2]}"
                    entity_id = parts[1]

                # Map action from HTTP method
                action_map = {"POST": "create", "PUT": "update", "PATCH": "update", "DELETE": "delete"}
                action = action_map.get(method, method.lower())

                # Special cases
                if path == "/auth/login":
                    entity, action = "session", "login"
                    entity_id = str(user_id or 0)
                    payload_str = None  # Don't log passwords

                from .database import SessionLocal
                from .models.audit import AuditEvent
                db = SessionLocal()
                try:
                    ev = AuditEvent(
                        UserId=int(user_id) if user_id else None,
                        Entity=entity[:60],
                        EntityId=str(entity_id)[:60],
                        Action=action[:20],
                        PayloadJson=payload_str[:4000] if payload_str else None,
                    )
                    db.add(ev)
                    db.commit()
                except Exception as exc:
                    logger.debug("Audit write failed: %s", exc)
                    db.rollback()
                finally:
                    db.close()
            except Exception as exc:
                logger.debug("Audit middleware error: %s", exc)

        return response


def configure_logging() -> None:
    """Logging estructurado básico: timestamp | level | logger | message."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    # Bajar ruido de sqlalchemy/uvicorn access a WARN
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
