"""Envío de mails vía Azure Communication Services (recurso compartido
`espertcommservice`, dominio Azure-managed — ver `config.acs_email_from`).

Sin `ACS_CONNECTION_STRING` (dev / tests) el mail NO se envía: se loguea y se
guarda en `OUTBOX` para poder inspeccionarlo.
"""
from __future__ import annotations

import logging

from ..config import settings

log = logging.getLogger(__name__)

# Mails "enviados" en modo dev (tests / local). Se vacía a mano.
OUTBOX: list[dict] = []


class MailError(RuntimeError):
    pass


def send_mail(to: str, subject: str, html: str, plain: str, to_name: str | None = None) -> None:
    """Envía un mail y espera la confirmación de ACS. Levanta `MailError` si falla."""
    if not settings.acs_connection_string:
        OUTBOX.append({"to": to, "subject": subject, "html": html, "plain": plain})
        log.info("[DEV EMAIL] to=%s subject=%s", to, subject)
        return

    from azure.communication.email import EmailClient

    message = {
        "senderAddress": settings.acs_email_from,
        "recipients": {"to": [{"address": to, **({"displayName": to_name} if to_name else {})}]},
        "content": {"subject": subject, "plainText": plain, "html": html},
    }
    try:
        client = EmailClient.from_connection_string(settings.acs_connection_string)
        result = client.begin_send(message).result()
    except Exception as e:  # noqa: BLE001 — cualquier error del SDK se reporta igual
        raise MailError(str(e)[:900]) from e
    status = (result or {}).get("status")
    if status != "Succeeded":
        raise MailError(f"ACS status={status} error={(result or {}).get('error')}")
