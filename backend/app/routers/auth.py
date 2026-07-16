from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from app.models.models import User
from app.schemas.schemas import LoginRequest
from app.middleware.auth import create_token
from app.services.password import verify_password
from app.config import settings

router = APIRouter(prefix="/api/auth", tags=["Auth"])


@router.post("/login")
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(User).where(func.lower(User.username) == req.username.strip().lower())
    )
    user = result.scalar_one_or_none()
    if not user or not user.password or not verify_password(req.password, user.password):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    user_data = {
        "id": user.id,
        "name": user.name,
        "username": user.username,
        "role": user.role,
        "plant": user.plant_id,
        "dept": user.dept_id,
        "initials": user.initials or user.name[:2].upper(),
        "color": user.color or "#7C80B0",
        "phone": user.phone,
        "email": user.email,
        "superior": user.superior,
        "masterAccess": getattr(user, 'master_access', False),
    }
    token = create_token({"sub": user.username, "role": user.role, "id": user.id})
    return {"token": token, "user": user_data}
