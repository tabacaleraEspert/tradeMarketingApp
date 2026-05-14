"""
Simple audit logging — call from endpoints after successful operations.

Usage:
    from ..audit_log import audit

    @router.post("/pdvs")
    def create_pdv(..., db: Session = Depends(get_db), current_user = Depends(get_current_user)):
        ...
        audit(db, current_user.UserId, "PDV", pdv.PdvId, "create")
"""
import logging
from sqlalchemy.orm import Session
from .models.audit import AuditEvent

logger = logging.getLogger("audit")


def audit(
    db: Session,
    user_id: int | None,
    entity: str,
    entity_id: int | str,
    action: str,
    detail: str | None = None,
) -> None:
    """Write an audit event. Non-blocking — silently fails on error."""
    try:
        db.add(AuditEvent(
            UserId=user_id,
            Entity=entity[:60],
            EntityId=str(entity_id)[:60],
            Action=action[:20],
            PayloadJson=detail[:4000] if detail else None,
        ))
        # Don't commit — let the caller's commit include it
    except Exception as e:
        logger.debug("Audit log failed: %s", e)
