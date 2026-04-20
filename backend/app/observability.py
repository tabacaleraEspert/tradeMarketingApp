"""
Inicialización de Sentry y observabilidad.

- Si `settings.sentry_dsn` está seteado → activa Sentry SDK con integración FastAPI
  + SQLAlchemy. Captura excepciones no manejadas, errores 500 y los enriquece con
  el `request_id` que ya generamos en el middleware del día 6.
- Si NO está seteado → no se activa nada (la app sigue logueando localmente con
  el formato estructurado del día 6). Esto es ideal para dev local sin cuenta Sentry.

Para activarlo en producción, sólo seteá las env vars:

    SENTRY_DSN=https://abc123@o12345.ingest.sentry.io/67890
    SENTRY_ENVIRONMENT=production
    APP_RELEASE=v1.0.0  # idealmente el git sha del deploy

Crea una cuenta gratis en https://sentry.io/signup/ (free tier: 5K events/mes).
"""
import logging

from .config import settings


logger = logging.getLogger("app.observability")


def init_sentry() -> bool:
    """Activa Sentry si hay DSN configurado. Devuelve True si quedó activo."""
    if not settings.sentry_dsn:
        logger.info("Sentry desactivado (sin SENTRY_DSN)")
        return False

    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
        from sentry_sdk.integrations.logging import LoggingIntegration
    except ImportError:
        logger.warning("sentry-sdk no instalado. Corré: pip install 'sentry-sdk[fastapi]'")
        return False

    def _before_send(event, hint):
        """Hook para limpiar info sensible antes de mandar a Sentry."""
        # Eliminar passwords del request body si por error vinieron en el evento
        request = event.get("request") or {}
        data = request.get("data")
        if isinstance(data, dict):
            for sensitive in ("password", "Password", "current_password", "new_password"):
                if sensitive in data:
                    data[sensitive] = "[REDACTED]"
        # Quitar el header Authorization (contiene el JWT)
        headers = request.get("headers") or {}
        if isinstance(headers, dict):
            for k in list(headers.keys()):
                if k.lower() in ("authorization", "cookie"):
                    headers[k] = "[REDACTED]"
        return event

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        release=settings.app_release,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,  # NO mandar headers/cookies/IPs a menos que lo activemos explícito
        integrations=[
            StarletteIntegration(),
            FastApiIntegration(),
            SqlalchemyIntegration(),
            LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
        ],
        before_send=_before_send,
    )
    logger.info(
        "Sentry inicializado | environment=%s release=%s",
        settings.sentry_environment,
        settings.app_release,
    )
    return True


def capture_request_id(request_id: str, user_id: int | None = None) -> None:
    """Adjunta el request_id (y opcionalmente el user_id) al scope actual de Sentry,
    para que cualquier excepción capturada incluya estos tags."""
    try:
        import sentry_sdk
    except ImportError:
        return
    sentry_sdk.set_tag("request_id", request_id)
    if user_id is not None:
        sentry_sdk.set_user({"id": str(user_id)})
