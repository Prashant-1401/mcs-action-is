import uuid
import datetime as _dt
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from app.database import get_db, async_session
from app.models.models import Action, ActionMessage, EscalationMatrix, User
from app.schemas.schemas import ActionCreate, ActionUpdate, ActionMessageCreate, ActionsEmailReq
from app.middleware.auth import require_api_key
from app.services.email_service import dispatch_escalation_emails, send_actions_email, dispatch_daily_digests

router = APIRouter(prefix="/api/actions", tags=["Actions"], dependencies=[Depends(require_api_key)])


async def _generate_sn(db: AsyncSession) -> str:
    result = await db.execute(
        text("SELECT sn FROM actions WHERE sn ~ '^ACT-[0-9]+$' ORDER BY CAST(REPLACE(sn, 'ACT-', '') AS INTEGER) DESC LIMIT 1")
    )
    row = result.fetchone()
    if row and row[0]:
        try:
            max_num = int(row[0].replace("ACT-", ""))
        except ValueError:
            max_num = 0
    else:
        max_num = 0
    return f"ACT-{max_num + 1:03d}"


async def _check_and_dispatch_escalations_with_db(db):
    tiers_q = await db.execute(
        select(EscalationMatrix).where(EscalationMatrix.active == True)
    )
    tiers = tiers_q.scalars().all()
    if not tiers:
        return

    users_q = await db.execute(select(User))
    all_users = users_q.scalars().all()

    email_by_name = {}
    for u in all_users:
        if u.name and u.email:
            email_by_name[u.name] = u.email

    actions_q = await db.execute(
        select(Action).where(
            Action.status.notin_(["COMPLETED", "DROPPED"]),
            Action.due.isnot(None),
            Action.responsible.isnot(None),
            Action.responsible != "",
        )
    )
    open_actions = actions_q.scalars().all()

    now = datetime.now(timezone.utc)
    email_groups = {}

    for action in open_actions:
        try:
            due_dt = datetime.combine(action.due, datetime.max.time()).replace(tzinfo=timezone.utc)
            hrs_overdue = (now - due_dt).total_seconds() / 3600
        except (ValueError, TypeError):
            continue
        if hrs_overdue < 0:
            continue

        resp_names = [n.strip() for n in (action.responsible or "").split(",") if n.strip()]
        for resp_name in resp_names:
            for tier in tiers:
                if (tier.from_user or "").strip() != resp_name:
                    continue
                if hrs_overdue < (tier.overdue_hrs or 0):
                    continue
                tier_priorities = (
                    tier.priorities if isinstance(tier.priorities, list)
                    else [x.strip() for x in tier.priorities.split(",") if x.strip()]
                    if isinstance(tier.priorities, str) and tier.priorities.strip()
                    else ["CRITICAL", "WARNING", "NORMAL"]
                )
                if (action.priority or "NORMAL") not in tier_priorities:
                    continue
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
                        "actions": [],
                    }
                email_groups[group_key]["actions"].append({
                    "sn": action.sn,
                    "text": action.text,
                    "due": str(action.due),
                    "responsible": action.responsible or "",
                    "priority": action.priority or "NORMAL",
                })

    to_send = []
    for group in email_groups.values():
        target_user = group["target_user"]
        recipient_email = email_by_name.get(target_user)
        if not recipient_email or not group["actions"]:
            continue
        to_send.append({
            "recipients": [recipient_email],
            "level": group["level"],
            "target_user": target_user,
            "actions": group["actions"],
        })

    if to_send:
        dispatch_escalation_emails(to_send)


async def _bg_check_escalations():
    try:
        async with async_session() as db:
            await _check_and_dispatch_escalations_with_db(db)
    except Exception as e:
        print(f"[escalation-trigger] background check failed: {e}")


@router.get("/")
async def list_actions(
    plant_id: str = None,
    dept_id: str = None,
    status: str = None,
    priority: str = None,
    responsible: str = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(Action)
    if plant_id:
        q = q.where(Action.plant_id == plant_id)
    if dept_id:
        q = q.where(Action.dept_id == dept_id)
    if status:
        q = q.where(Action.status == status)
    if priority:
        q = q.where(Action.priority == priority)
    if responsible:
        q = q.where(Action.responsible == responsible)
    q = q.order_by(Action.created.desc())
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/send-daily-digests")
async def send_daily_digests_endpoint(bg: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    users_q = await db.execute(select(User))
    all_users = users_q.scalars().all()
    email_by_name = {u.name: u.email for u in all_users if u.name and u.email}

    actions_q = await db.execute(
        select(Action).where(Action.status.notin_(["COMPLETED", "DROPPED"]))
    )
    open_actions = actions_q.scalars().all()

    grouped: dict[str, list] = {}
    for a in open_actions:
        for name in [n.strip() for n in (a.responsible or "").split(",") if n.strip()]:
            grouped.setdefault(name, []).append({
                "sn": a.sn, "text": a.text,
                "due": str(a.due) if a.due else "",
                "status": a.status, "priority": a.priority,
            })

    digest_groups = [
        {"email": email_by_name[name], "name": name, "actions": actions}
        for name, actions in grouped.items()
        if name in email_by_name
    ]

    if not digest_groups:
        return {"status": "ok", "queued": 0, "reason": "No users with open actions and an email on file"}

    bg.add_task(dispatch_daily_digests, digest_groups)
    return {"status": "ok", "queued": len(digest_groups)}


@router.post("/send-to-email")
async def send_actions_to_email(data: ActionsEmailReq, db: AsyncSession = Depends(get_db)):
    q = select(Action).where(Action.responsible == data.responsible)
    if data.status:
        q = q.where(Action.status == data.status)
    q = q.order_by(Action.created.desc())
    result = await db.execute(q)
    actions = result.scalars().all()
    if not actions:
        raise HTTPException(status_code=404, detail="No actions found for this person")
    action_dicts = [
        {"sn": a.sn, "text": a.text, "due": str(a.due) if a.due else "", "status": a.status, "priority": a.priority}
        for a in actions
    ]
    sent = send_actions_email(data.email, data.responsible, action_dicts)
    if not sent:
        raise HTTPException(status_code=500, detail="Failed to send email")
    return {"ok": True, "count": len(action_dicts)}


@router.get("/{action_id}")
async def get_action(action_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Action).where(Action.id == action_id))
    action = result.scalar_one_or_none()
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")
    return action


@router.post("/")
async def create_action(data: ActionCreate, bg: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    payload = data.model_dump()
    payload["id"] = str(uuid.uuid4())
    payload["sn"] = await _generate_sn(db)
    if "project" in payload:
        payload["project_name"] = payload.pop("project")
    for k in ("due", "date_of_action", "created", "closed_on"):
        v = payload.get(k)
        if isinstance(v, str):
            try:
                payload[k] = _dt.date.fromisoformat(v)
            except (ValueError, TypeError):
                pass
    action = Action(**payload)
    db.add(action)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        payload["sn"] = await _generate_sn(db)
        action = Action(**payload)
        db.add(action)
        await db.commit()
    await db.refresh(action)
    bg.add_task(_bg_check_escalations)
    return action


@router.patch("/{action_id}")
async def update_action(action_id: str, data: ActionUpdate, bg: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Action).where(Action.id == action_id).with_for_update()
    )
    action = result.scalar_one_or_none()
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")
    update_data = data.model_dump(exclude_unset=True)
    if "project" in update_data:
        update_data["project_name"] = update_data.pop("project")
    if update_data.get("status") in ("COMPLETED", "DROPPED") and action.status not in ("COMPLETED", "DROPPED"):
        update_data["closed_on"] = _dt.date.today()

    if "revision_history" in update_data:
        incoming_history = update_data.pop("revision_history")
        current_history = action.revision_history or []
        if incoming_history and isinstance(incoming_history, list):
            current_history = current_history + incoming_history
        update_data["revision_history"] = current_history
        update_data["revisions"] = (action.revisions or 0) + 1

    for k, v in update_data.items():
        if isinstance(v, str) and k in ("due", "date_of_action", "closed_on", "created"):
            try:
                v = _dt.date.fromisoformat(v)
            except (ValueError, TypeError):
                pass
        setattr(action, k, v)
    action.version = (action.version or 0) + 1
    await db.commit()
    await db.refresh(action)
    bg.add_task(_bg_check_escalations)
    return action


@router.delete("/{action_id}")
async def delete_action(action_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Action).where(Action.id == action_id))
    action = result.scalar_one_or_none()
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")
    await db.delete(action)
    await db.commit()
    return {"ok": True}


@router.get("/{action_id}/messages")
async def list_action_messages(action_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ActionMessage).where(ActionMessage.action_id == action_id).order_by(ActionMessage.ts)
    )
    return result.scalars().all()


@router.post("/{action_id}/messages")
async def create_action_message(action_id: str, data: ActionMessageCreate, db: AsyncSession = Depends(get_db)):
    msg = ActionMessage(action_id=action_id, **data.model_dump(exclude={"id", "action_id"}))
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    return msg


@router.post("/bulk")
async def bulk_upsert_actions(rows: list[ActionCreate], bg: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    upserted = 0
    for data in rows:
        payload = data.model_dump()
        if "project" in payload:
            payload["project_name"] = payload.pop("project")
        for k in ("due", "date_of_action", "created", "closed_on"):
            v = payload.get(k)
            if isinstance(v, str):
                try:
                    payload[k] = _dt.date.fromisoformat(v)
                except (ValueError, TypeError):
                    pass
        action_id = payload.get("id")
        if action_id:
            result = await db.execute(select(Action).where(Action.id == action_id))
            existing = result.scalar_one_or_none()
            if existing:
                for k, v in payload.items():
                    if k != "id":
                        setattr(existing, k, v)
                upserted += 1
                continue
        if not payload.get("id"):
            payload["id"] = str(uuid.uuid4())
        if not payload.get("sn"):
            payload["sn"] = await _generate_sn(db)
        db.add(Action(**payload))
        upserted += 1
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        for data in rows:
            payload = data.model_dump()
            if "project" in payload:
                payload["project_name"] = payload.pop("project")
            for k in ("due", "date_of_action", "created", "closed_on"):
                v = payload.get(k)
                if isinstance(v, str):
                    try:
                        payload[k] = _dt.date.fromisoformat(v)
                    except (ValueError, TypeError):
                        pass
            action_id = payload.get("id")
            if action_id:
                result = await db.execute(select(Action).where(Action.id == action_id))
                existing = result.scalar_one_or_none()
                if existing:
                    for k, v in payload.items():
                        if k != "id":
                            setattr(existing, k, v)
                    continue
            payload["id"] = str(uuid.uuid4())
            payload["sn"] = await _generate_sn(db)
            db.add(Action(**payload))
        await db.commit()
    bg.add_task(_bg_check_escalations)
    return {"ok": True, "upserted": upserted}
