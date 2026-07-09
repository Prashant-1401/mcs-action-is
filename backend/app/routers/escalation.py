from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.models import EscalationMatrix
from app.schemas.schemas import EscalationMatrixCreate, EscalationMatrixUpdate
from app.services.email_service import dispatch_escalation_email

router = APIRouter(prefix="/api/escalation", tags=["Escalation"])


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


@router.post("/email/escalate")
async def email_escalate(
    actions: list,
    level: int,
    target: str,
    users: list = [],
    db: AsyncSession = Depends(get_db),
):
    success = dispatch_escalation_email(actions, level, target, users)
    return {"status": "ok" if success else "failed", "level": level, "target": target}
