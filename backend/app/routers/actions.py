from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.models import Action, ActionMessage
from app.schemas.schemas import ActionCreate, ActionUpdate, ActionMessageCreate

router = APIRouter(prefix="/api/actions", tags=["Actions"])


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


@router.get("/{action_id}")
async def get_action(action_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Action).where(Action.id == action_id))
    action = result.scalar_one_or_none()
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")
    return action


@router.post("/")
async def create_action(data: ActionCreate, db: AsyncSession = Depends(get_db)):
    action = Action(**data.model_dump())
    db.add(action)
    await db.commit()
    await db.refresh(action)
    return action


@router.patch("/{action_id}")
async def update_action(action_id: str, data: ActionUpdate, db: AsyncSession = Depends(get_db)):
    import datetime
    result = await db.execute(select(Action).where(Action.id == action_id))
    action = result.scalar_one_or_none()
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")
    update_data = data.model_dump(exclude_unset=True)
    if update_data.get("status") in ("COMPLETED", "DROPPED") and action.status not in ("COMPLETED", "DROPPED"):
        update_data["closed_on"] = datetime.date.today().isoformat()

    current_revisions = action.revisions or 0
    if "revision_history" in update_data:
        current_revisions += 1
        update_data["revisions"] = current_revisions

    for k, v in update_data.items():
        if isinstance(v, str) and k in ("due", "date_of_action", "closed_on", "created"):
            try:
                v = datetime.date.fromisoformat(v)
            except (ValueError, TypeError):
                pass
        setattr(action, k, v)
    await db.commit()
    await db.refresh(action)
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
async def bulk_upsert_actions(rows: list[ActionCreate], db: AsyncSession = Depends(get_db)):
    upserted = 0
    for data in rows:
        result = await db.execute(select(Action).where(Action.id == data.id))
        existing = result.scalar_one_or_none()
        if existing:
            for k, v in data.model_dump(exclude_unset=True).items():
                setattr(existing, k, v)
        else:
            db.add(Action(**data.model_dump()))
        upserted += 1
    await db.commit()
    return {"ok": True, "upserted": upserted}
