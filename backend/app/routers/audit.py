from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.models import Audit
from app.schemas.schemas import AuditCreate

router = APIRouter(prefix="/api/audit", tags=["Audit"])


@router.get("/")
async def list_audit(limit: int = 100, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Audit).order_by(Audit.ts.desc()).limit(limit))
    return result.scalars().all()


@router.post("/")
async def create_audit_entry(data: AuditCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(
        select(Audit).where(
            Audit.action_sn == data.action_sn,
            Audit.level == data.level,
        )
    )
    if existing.scalar_one_or_none():
        return {"ok": True, "skipped": True}
    entry = Audit(**data.model_dump())
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.post("/batch")
async def batch_audit(entries: list[AuditCreate], db: AsyncSession = Depends(get_db)):
    created = 0
    skipped = 0
    for data in entries:
        existing = await db.execute(
            select(Audit).where(
                Audit.action_sn == data.action_sn,
                Audit.level == data.level,
            )
        )
        if existing.scalar_one_or_none():
            skipped += 1
            continue
        entry = Audit(**data.model_dump())
        db.add(entry)
        created += 1
    await db.commit()
    return {"ok": True, "created": created, "skipped": skipped}
