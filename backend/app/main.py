from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.config import settings
from app.database import engine, Base
from app.routers import (
    auth, plants, departments, roles, users, machines, reasons,
    actions, projects, meetings, escalation, audit, meetings_ai,
    translate, email_share,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(migrate_schema)
    yield
    await engine.dispose()


def migrate_schema(conn):
    from sqlalchemy import inspect, text
    inspector = inspect(conn)
    columns = {c["name"] for c in inspector.get_columns("escalation_matrix")}
    if "from_role" not in columns:
        conn.execute(text(
            "ALTER TABLE escalation_matrix ADD COLUMN from_role VARCHAR(50)"
        ))
    if "target_role" not in columns:
        conn.execute(text(
            "ALTER TABLE escalation_matrix ADD COLUMN target_role VARCHAR(50)"
        ))
    if "priorities" not in columns:
        conn.execute(text(
            "ALTER TABLE escalation_matrix ADD COLUMN priorities JSONB DEFAULT '[]'::jsonb"
        ))
    if "superiors" not in columns:
        conn.execute(text(
            "ALTER TABLE escalation_matrix ADD COLUMN superiors JSONB DEFAULT '[]'::jsonb"
        ))


app = FastAPI(
    title="MCS Backend API",
    description="Management Control System — Backend API",
    version="2.0.0",
    lifespan=lifespan,
)

origins = [o.strip() for o in settings.allowed_origins.split(",") if o.strip()]
if not origins:
    origins = ["*"]
else:
    known = [
        "https://mcs-control-management.vercel.app",
        "https://mcs-control-management-g9uaoyxl1.vercel.app",
        "http://localhost:5173",
    ]
    for o in known:
        if o not in origins:
            origins.append(o)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=bool(origins and origins != ["*"]),
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "x-api-key"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    print(f"Unhandled error on {request.url.path}: {exc}")
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/")
async def root():
    return {"message": "MCS Backend API is running", "docs": "/docs", "health": "/api/health"}


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "gemini_configured": bool(settings.gemini_api_key),
        "gemini_model": settings.gemini_model,
        "smtp_configured": bool(settings.smtp_user and settings.smtp_password),
        "wacrm_gateway_configured": bool(settings.wacrm_alert_url),
        "api_key_auth_enabled": bool(settings.api_key),
        "cors_locked": bool(origins and origins != ["*"]),
    }


@app.get("/api/ping")
async def ping():
    return {"ok": True, "gemini_ready": bool(settings.gemini_api_key)}


app.include_router(auth.router)
app.include_router(plants.router)
app.include_router(departments.router)
app.include_router(roles.router)
app.include_router(users.router)
app.include_router(machines.router)
app.include_router(reasons.router)
app.include_router(actions.router)
app.include_router(projects.router)
app.include_router(meetings.router)
app.include_router(escalation.router)
app.include_router(audit.router)
app.include_router(meetings_ai.router)
app.include_router(translate.router)
app.include_router(email_share.router)
