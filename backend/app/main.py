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
    # Escalation matrix columns
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
    # Backfill NULL from_role / target_role / priorities for existing rows
    conn.execute(text(
        "UPDATE escalation_matrix SET priorities = '[\"CRITICAL\",\"WARNING\",\"NORMAL\"]'::jsonb WHERE priorities IS NULL"
    ))
    conn.execute(text(
        "UPDATE escalation_matrix SET superiors = '[]'::jsonb WHERE superiors IS NULL"
    ))
    # Users table columns
    user_cols = {c["name"] for c in inspector.get_columns("users")}
    if "master_access" not in user_cols:
        conn.execute(text(
            "ALTER TABLE users ADD COLUMN master_access BOOLEAN DEFAULT FALSE"
        ))
    # Seed default escalation matrix if empty
    from app.models.models import EscalationMatrix
    from sqlalchemy import select as sa_select
    # Use raw text to check count since this is a sync conn
    count_row = conn.execute(text("SELECT COUNT(*) FROM escalation_matrix")).scalar()
    if count_row == 0:
        defaults = [
            {"id": "E1-OP", "level": 1, "label": "Level 1 — Operator → Supervisor", "from_role": "Operator", "target_role": "Supervisor", "overdue_hrs": 24, "notify_method": "In-App + Email", "priorities": '["CRITICAL","WARNING","NORMAL"]', "color": "#E69903", "active": True, "description": "Operator overdue → Supervisor"},
            {"id": "E1-SV", "level": 1, "label": "Level 1 — Supervisor → HOD", "from_role": "Supervisor", "target_role": "HOD", "overdue_hrs": 24, "notify_method": "In-App + Email", "priorities": '["CRITICAL","WARNING","NORMAL"]', "color": "#E69903", "active": True, "description": "Supervisor overdue → HOD"},
            {"id": "E1-SE", "level": 1, "label": "Level 1 — Shift Engineer → HOD", "from_role": "Shift Engineer", "target_role": "HOD", "overdue_hrs": 24, "notify_method": "In-App + Email", "priorities": '["CRITICAL","WARNING","NORMAL"]', "color": "#E69903", "active": True, "description": "Shift Engineer overdue → HOD"},
            {"id": "E1-HD", "level": 1, "label": "Level 1 — HOD → Plant Head", "from_role": "HOD", "target_role": "Plant Head", "overdue_hrs": 24, "notify_method": "In-App + Email", "priorities": '["CRITICAL","WARNING","NORMAL"]', "color": "#E69903", "active": True, "description": "HOD overdue → Plant Head"},
            {"id": "E1-PH", "level": 1, "label": "Level 1 — Plant Head → MD", "from_role": "Plant Head", "target_role": "MD", "overdue_hrs": 24, "notify_method": "In-App + Email", "priorities": '["CRITICAL","WARNING","NORMAL"]', "color": "#E69903", "active": True, "description": "Plant Head overdue → MD"},
            {"id": "E2-OP", "level": 2, "label": "Level 2 — Operator → HOD", "from_role": "Operator", "target_role": "HOD", "overdue_hrs": 72, "notify_method": "In-App + Email", "priorities": '["CRITICAL","WARNING"]', "color": "#E67E22", "active": True, "description": "Operator still in process → HOD"},
            {"id": "E2-SV", "level": 2, "label": "Level 2 — Supervisor → Plant Head", "from_role": "Supervisor", "target_role": "Plant Head", "overdue_hrs": 72, "notify_method": "In-App + Email", "priorities": '["CRITICAL","WARNING"]', "color": "#E67E22", "active": True, "description": "Supervisor still in process → Plant Head"},
            {"id": "E2-SE", "level": 2, "label": "Level 2 — Shift Engineer → Plant Head", "from_role": "Shift Engineer", "target_role": "Plant Head", "overdue_hrs": 72, "notify_method": "In-App + Email", "priorities": '["CRITICAL","WARNING"]', "color": "#E67E22", "active": True, "description": "Shift Engineer still in process → Plant Head"},
            {"id": "E2-HD", "level": 2, "label": "Level 2 — HOD → MD", "from_role": "HOD", "target_role": "MD", "overdue_hrs": 72, "notify_method": "In-App + Email", "priorities": '["CRITICAL","WARNING"]', "color": "#E67E22", "active": True, "description": "HOD still in process → MD"},
            {"id": "E3-OP", "level": 3, "label": "Level 3 — Operator → Plant Head", "from_role": "Operator", "target_role": "Plant Head", "overdue_hrs": 168, "notify_method": "In-App + Email", "priorities": '["CRITICAL"]', "color": "#C0392B", "active": True, "description": "Operator unresolved 7 days → Plant Head"},
            {"id": "E3-SV", "level": 3, "label": "Level 3 — Supervisor → MD", "from_role": "Supervisor", "target_role": "MD", "overdue_hrs": 168, "notify_method": "In-App + Email", "priorities": '["CRITICAL"]', "color": "#C0392B", "active": True, "description": "Supervisor unresolved 7 days → MD"},
            {"id": "E3-SE", "level": 3, "label": "Level 3 — Shift Engineer → MD", "from_role": "Shift Engineer", "target_role": "MD", "overdue_hrs": 168, "notify_method": "In-App + Email", "priorities": '["CRITICAL"]', "color": "#C0392B", "active": True, "description": "Shift Engineer unresolved 7 days → MD"},
        ]
        for d in defaults:
            conn.execute(text(
                "INSERT INTO escalation_matrix (id, level, label, from_role, target_role, overdue_hrs, notify_method, priorities, color, active, description) "
                "VALUES (:id, :level, :label, :from_role, :target_role, :overdue_hrs, :notify_method, :priorities::jsonb, :color, :active, :description)"
            ), d)


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
