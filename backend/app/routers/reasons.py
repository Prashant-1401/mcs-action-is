from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.models import Reason
from app.schemas.schemas import ReasonCreate, ReasonUpdate

router = APIRouter(prefix="/api/reasons", tags=["Reasons"])


@router.get("/")
async def list_reasons(category: str = None, db: AsyncSession = Depends(get_db)):
    q = select(Reason)
    if category:
        q = q.where(Reason.category == category)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/")
async def create_reason(data: ReasonCreate, db: AsyncSession = Depends(get_db)):
    reason = Reason(**data.model_dump())
    db.add(reason)
    await db.commit()
    await db.refresh(reason)
    return reason


@router.patch("/{reason_id}")
async def update_reason(reason_id: str, data: ReasonUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Reason).where(Reason.id == reason_id))
    reason = result.scalar_one_or_none()
    if not reason:
        raise HTTPException(status_code=404, detail="Reason not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(reason, k, v)
    await db.commit()
    await db.refresh(reason)
    return reason


@router.delete("/{reason_id}")
async def delete_reason(reason_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Reason).where(Reason.id == reason_id))
    reason = result.scalar_one_or_none()
    if not reason:
        raise HTTPException(status_code=404, detail="Reason not found")
    await db.delete(reason)
    await db.commit()
    return {"ok": True}
