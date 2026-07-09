from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.models import User
from app.schemas.schemas import UserCreate, UserUpdate
from app.services.email_service import send_welcome_email

router = APIRouter(prefix="/api/users", tags=["Users"])


@router.get("/")
async def list_users(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User))
    return result.scalars().all()


@router.get("/{user_id}")
async def get_user(user_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post("/")
async def create_user(data: UserCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.username == data.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already exists")
    user = User(**data.model_dump())
    db.add(user)
    await db.commit()
    await db.refresh(user)
    if user.email:
        send_welcome_email(user.name, user.username, user.email, data.password)
    return user


@router.patch("/{user_id}")
async def update_user(user_id: str, data: UserUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(user, k, v)
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/{user_id}")
async def delete_user(user_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await db.delete(user)
    await db.commit()
    return {"ok": True}


@router.post("/bulk")
async def bulk_upsert_users(rows: list[UserCreate], db: AsyncSession = Depends(get_db)):
    upserted = 0
    for data in rows:
        result = await db.execute(select(User).where(User.id == data.id))
        existing = result.scalar_one_or_none()
        if existing:
            for k, v in data.model_dump(exclude_unset=True).items():
                setattr(existing, k, v)
        else:
            db.add(User(**data.model_dump()))
            if data.email:
                send_welcome_email(data.name, data.username, data.email, data.password)
        upserted += 1
    await db.commit()
    return {"ok": True, "upserted": upserted}
