from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.models import Machine
from app.schemas.schemas import MachineCreate, MachineUpdate
from app.middleware.auth import require_api_key

router = APIRouter(prefix="/api/machines", tags=["Machines"], dependencies=[Depends(require_api_key)])


@router.get("/")
async def list_machines(plant_id: str = None, dept_id: str = None, db: AsyncSession = Depends(get_db)):
    q = select(Machine)
    if plant_id:
        q = q.where(Machine.plant_id == plant_id)
    if dept_id:
        q = q.where(Machine.dept_id == dept_id)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/")
async def create_machine(data: MachineCreate, db: AsyncSession = Depends(get_db)):
    machine = Machine(**data.model_dump())
    db.add(machine)
    await db.commit()
    await db.refresh(machine)
    return machine


@router.patch("/{machine_id}")
async def update_machine(machine_id: str, data: MachineUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Machine).where(Machine.id == machine_id))
    machine = result.scalar_one_or_none()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(machine, k, v)
    await db.commit()
    await db.refresh(machine)
    return machine


@router.delete("/{machine_id}")
async def delete_machine(machine_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Machine).where(Machine.id == machine_id))
    machine = result.scalar_one_or_none()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")
    await db.delete(machine)
    await db.commit()
    return {"ok": True}


@router.post("/bulk")
async def bulk_upsert_machines(rows: list[MachineCreate], db: AsyncSession = Depends(get_db)):
    upserted = 0
    for data in rows:
        result = await db.execute(select(Machine).where(Machine.id == data.id))
        existing = result.scalar_one_or_none()
        if existing:
            for k, v in data.model_dump(exclude_unset=True).items():
                setattr(existing, k, v)
        else:
            db.add(Machine(**data.model_dump()))
        upserted += 1
    await db.commit()
    return {"ok": True, "upserted": upserted}
