from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import datetime
from app.database import get_db
from app.models.models import Project
from app.schemas.schemas import ProjectCreate, ProjectUpdate
from app.middleware.auth import require_api_key

router = APIRouter(prefix="/api/projects", tags=["Projects"], dependencies=[Depends(require_api_key)])

DATE_FIELDS = {"start_date", "end_date"}


@router.get("/")
async def list_projects(plant_id: str = None, status: str = None, db: AsyncSession = Depends(get_db)):
    q = select(Project)
    if plant_id:
        q = q.where(Project.plant_id == plant_id)
    if status:
        q = q.where(Project.status == status)
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/{project_id}")
async def get_project(project_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.post("/")
async def create_project(data: ProjectCreate, db: AsyncSession = Depends(get_db)):
    payload = data.model_dump()
    for k in DATE_FIELDS:
        if k in payload and isinstance(payload[k], str):
            try:
                payload[k] = datetime.date.fromisoformat(payload[k])
            except (ValueError, TypeError):
                payload[k] = None
    project = Project(**payload)
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


@router.patch("/{project_id}")
async def update_project(project_id: str, data: ProjectUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        if k in DATE_FIELDS and isinstance(v, str):
            try:
                v = datetime.date.fromisoformat(v)
            except (ValueError, TypeError):
                v = None
        setattr(project, k, v)
    await db.commit()
    await db.refresh(project)
    return project


@router.delete("/{project_id}")
async def delete_project(project_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    await db.delete(project)
    await db.commit()
    return {"ok": True}
