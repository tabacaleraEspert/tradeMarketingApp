"""
Simple audit logging — call from endpoints after successful operations.
Uses a SEPARATE database session so failures never break the main transaction.
"""
import logging
from .database import SessionLocal

logger = logging.getLogger("audit")


def audit(
    db,  # ignored — kept for API compat, we use our own session
    user_id: int | None,
    entity: str,
    entity_id: int | str,
    action: str,
    detail: str | None = None,
) -> None:
    """Write an audit event. Fully isolated — never breaks the caller."""
    try:
        from .models.audit import AuditEvent
        session = SessionLocal()
        try:
            session.add(AuditEvent(
                UserId=user_id,
                Entity=entity[:60],
                EntityId=str(entity_id)[:60],
                Action=action[:20],
                PayloadJson=detail[:4000] if detail else None,
            ))
            session.commit()
        except Exception:
            session.rollback()
        finally:
            session.close()
    except Exception as e:
        logger.debug("Audit log failed: %s", e)
