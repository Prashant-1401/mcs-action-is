from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.models import EscalationMatrix, User, Action
from app.schemas.schemas import EscalationMatrixCreate, EscalationMatrixUpdate
from app.services.email_service import dispatch_escalation_emails
from app.middleware.auth import require_api_key

router = APIRouter(prefix="/api/escalation", tags=["Escalation"], dependencies=[Depends(require_api_key)])


@router.get("/matrix")
async def list_escalation_matrix(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(EscalationMatrix))
    return result.scalars().all()


@router.post("/matrix")
async def create_escalation_tier(data: EscalationMatrixCreate, db: AsyncSession = Depends(get_db)):
    tier = EscalationMatrix(**data.model_dump())
    db.add(tier)
    await db.commit()
    await db.refresh(tier)
    return tier


@router.patch("/matrix/{tier_id}")
async def update_escalation_tier(tier_id: str, data: EscalationMatrixUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(EscalationMatrix).where(EscalationMatrix.id == tier_id))
    tier = result.scalar_one_or_none()
    if not tier:
        raise HTTPException(status_code=404, detail="Escalation tier not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(tier, k, v)
    await db.commit()
    await db.refresh(tier)
    return tier


@router.delete("/matrix/{tier_id}")
async def delete_escalation_tier(tier_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(EscalationMatrix).where(EscalationMatrix.id == tier_id))
    tier = result.scalar_one_or_none()
    if not tier:
        raise HTTPException(status_code=404, detail="Escalation tier not found")
    await db.delete(tier)
    await db.commit()
    return {"ok": True}


@router.post("/matrix/bulk")
async def bulk_upsert_escalation_matrix(rows: list[EscalationMatrixCreate], db: AsyncSession = Depends(get_db)):
    upserted = 0
    for data in rows:
        result = await db.execute(select(EscalationMatrix).where(EscalationMatrix.id == data.id))
        existing = result.scalar_one_or_none()
        if existing:
            for k, v in data.model_dump(exclude_unset=True).items():
                setattr(existing, k, v)
        else:
            db.add(EscalationMatrix(**data.model_dump()))
        upserted += 1
    await db.commit()
    return {"ok": True, "upserted": upserted}


def _norm_priorities(p):
    if isinstance(p, list):
        return p
    if isinstance(p, str) and p.strip():
        return [x.strip() for x in p.split(",") if x.strip()]
    return ["CRITICAL", "WARNING", "NORMAL"]


async def _resolve_escalation_emails(db: AsyncSession):
    """Core logic: query everything from DB, resolve against matrix, return email groups."""
    now = datetime.now(timezone.utc)

    # 1. Load active matrix tiers
    matrix_result = await db.execute(
        select(EscalationMatrix).where(EscalationMatrix.active == True)
    )
    tiers = matrix_result.scalars().all()

    # 2. Load all users — build name -> email lookup
    users_result = await db.execute(select(User))
    all_users = users_result.scalars().all()
    email_by_name = {}
    for u in all_users:
        if u.name and u.email:
            email_by_name[u.name] = u.email

    # 3. Load all open actions (not COMPLETED/DROPPED, must have due date and responsible)
    actions_result = await db.execute(
        select(Action).where(
            Action.status.notin_(["COMPLETED", "DROPPED"]),
            Action.due.isnot(None),
            Action.responsible.isnot(None),
            Action.responsible != "",
        )
    )
    open_actions = actions_result.scalars().all()

    # 4. For each action, match against matrix tiers by user name
    email_groups = {}

    for action in open_actions:
        due = action.due
        if not due:
            continue

        # Calculate hours overdue
        try:
            due_dt = datetime.combine(due, datetime.max.time()).replace(tzinfo=timezone.utc)
            hrs_overdue = (now - due_dt).total_seconds() / 3600
        except (ValueError, TypeError):
            continue

        if hrs_overdue < 0:
            continue

        # Split comma-separated responsible names and check each individually
        resp_names = [n.strip() for n in (action.responsible or "").split(",") if n.strip()]
        if not resp_names:
            continue

        for resp_name in resp_names:
            # Find matching tiers: from_user matches the responsible person's name
            for tier in tiers:
                if (tier.from_user or "").strip() != resp_name:
                    continue
                if hrs_overdue < (tier.overdue_hrs or 0):
                    continue

                tier_priorities = _norm_priorities(tier.priorities)
                if (action.priority or "NORMAL") not in tier_priorities:
                    continue

                # Check notify_method includes Email
                notify = (tier.notify_method or "").lower()
                if "email" not in notify:
                    continue

                target_user = (tier.target_user or "").strip()
                if not target_user:
                    continue

                group_key = f"{target_user}::{tier.level}"

                if group_key not in email_groups:
                    email_groups[group_key] = {
                        "target_user": target_user,
                        "level": tier.level,
                        "label": tier.label or "",
                        "actions": [],
                    }
                email_groups[group_key]["actions"].append({
                    "sn": action.sn,
                    "text": action.text,
                    "due": str(action.due),
                    "responsible": action.responsible or "",
                    "priority": action.priority or "NORMAL",
                })

    # 5. Build final email dispatch list — resolve target_user to email
    emails_to_send = []
    for key, group in email_groups.items():
        target_user = group["target_user"]
        recipient_email = email_by_name.get(target_user)
        if not recipient_email or not group["actions"]:
            continue
        emails_to_send.append({
            "recipients": [recipient_email],
            "level": group["level"],
            "target_user": target_user,
            "actions": group["actions"],
        })

    return emails_to_send


@router.post("/email/escalate", dependencies=[Depends(require_api_key)])
async def email_escalate(bg: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    emails_to_send = await _resolve_escalation_emails(db)

    if not emails_to_send:
        return {"status": "ok", "queued": 0, "reason": "No matching actions or no recipients"}

    bg.add_task(dispatch_escalation_emails, emails_to_send)
    return {"status": "ok", "queued": len(emails_to_send)}
