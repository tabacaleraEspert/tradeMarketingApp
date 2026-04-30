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
                    "detail": f"Error interno: {type(exc).__name__}: {str(exc)[:500]}",
                    "request_id": rid,
                },
                headers=cors_headers,
            )
        response.headers["X-Request-ID"] = rid
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
