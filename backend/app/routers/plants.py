from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.models import Plant
from app.schemas.schemas import PlantCreate, PlantUpdate
from app.middleware.auth import require_api_key

router = APIRouter(prefix="/api/plants", tags=["Plants"], dependencies=[Depends(require_api_key)])


@router.get("/")
async def list_plants(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Plant))
    return result.scalars().all()


@router.get("/{plant_id}")
async def get_plant(plant_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Plant).where(Plant.id == plant_id))
    plant = result.scalar_one_or_none()
    if not plant:
        raise HTTPException(status_code=404, detail="Plant not found")
    return plant


@router.post("/")
async def create_plant(data: PlantCreate, db: AsyncSession = Depends(get_db)):
    plant = Plant(**data.model_dump())
    db.add(plant)
    await db.commit()
    await db.refresh(plant)
    return plant


@router.patch("/{plant_id}")
async def update_plant(plant_id: str, data: PlantUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Plant).where(Plant.id == plant_id))
    plant = result.scalar_one_or_none()
    if not plant:
        raise HTTPException(status_code=404, detail="Plant not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(plant, k, v)
    await db.commit()
    await db.refresh(plant)
    return plant



@router.delete("/{plant_id}")
async def delete_plant(plant_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Plant).where(Plant.id == plant_id))
    plant = result.scalar_one_or_none()
    if not plant:
        raise HTTPException(status_code=404, detail="Plant not found")
    await db.delete(plant)
    await db.commit()
    return {"ok": True}


@router.post("/bulk")
async def bulk_upsert_plants(rows: list[PlantCreate], db: AsyncSession = Depends(get_db)):
    upserted = 0
    for data in rows:
        result = await db.execute(select(Plant).where(Plant.id == data.id))
        existing = result.scalar_one_or_none()
        if existing:
            for k, v in data.model_dump(exclude_unset=True).items():
                setattr(existing, k, v)
        else:
            db.add(Plant(**data.model_dump()))
        upserted += 1
    await db.commit()
    return {"ok": True, "upserted": upserted}
