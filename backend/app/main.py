from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from app.config import settings
from app.database import engine, Base
from app.routers import (
    auth, plants, departments, roles, users, machines, reasons,
    actions, projects, meetings, escalation, audit, meetings_ai,
    translate, email_share,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await conn.run_sync(migrate_schema)
        print("[lifespan] Database schema initialized successfully")
    except Exception as e:
        print(f"[lifespan] Database initialization warning: {e}")
        print("[lifespan] Server will continue — some tables may need manual creation")
    yield
    await engine.dispose()


def migrate_schema(conn):
    from sqlalchemy import inspect, text
    inspector = inspect(conn)
    existing_tables = set(inspector.get_table_names())

    # Escalation matrix columns
    if "escalation_matrix" in existing_tables:
        try:
            columns = {c["name"] for c in inspector.get_columns("escalation_matrix")}
            if "from_user" not in columns:
                conn.execute(text(
                    "ALTER TABLE escalation_matrix ADD COLUMN from_user VARCHAR(100)"
                ))
            if "target_user" not in columns:
                conn.execute(text(
                    "ALTER TABLE escalation_matrix ADD COLUMN target_user VARCHAR(100)"
                ))
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
            # Backfill NULL priorities for existing rows
            conn.execute(text(
                "UPDATE escalation_matrix SET priorities = '[\"CRITICAL\",\"WARNING\",\"NORMAL\"]'::jsonb WHERE priorities IS NULL"
            ))
            # Seed default escalation matrix if empty
            count_row = conn.execute(text("SELECT COUNT(*) FROM escalation_matrix")).scalar()
            if count_row == 0:
                # Build default tiers from actual users in the database
                user_rows = conn.execute(text("SELECT name, role FROM users WHERE is_active = true")).fetchall()
                user_by_role = {}
                for row in user_rows:
                    user_by_role.setdefault(row[1], []).append(row[0])

                defaults = []
                tier_id = 1

                # Level 1 (24h): each user escalates to their direct superior
                escalation_chains = [
                    ("Operator", "Supervisor"),
                    ("Supervisor", "HOD"),
                    ("Shift Engineer", "HOD"),
                    ("HOD", "Plant Head"),
                    ("Plant Head", "MD"),
                ]
                for from_role, to_role in escalation_chains:
                    for from_name in user_by_role.get(from_role, []):
                        for to_name in user_by_role.get(to_role, []):
                            defaults.append({
                                "id": f"E1-{tier_id}",
                                "level": 1,
                                "label": f"L1: {from_name} → {to_name}",
                                "from_user": from_name,
                                "target_user": to_name,
                                "from_role": from_role,
                                "target_role": to_role,
                                "overdue_hrs": 24,
                                "notify_method": "In-App + Email",
                                "priorities": '["CRITICAL","WARNING","NORMAL"]',
                                "color": "#E69903",
                                "active": True,
                                "description": f"{from_name} overdue 24h → escalate to {to_name}",
                            })
                            tier_id += 1

                # Level 2 (72h): skip one level up
                escalation_chains_l2 = [
                    ("Operator", "HOD"),
                    ("Supervisor", "Plant Head"),
                    ("Shift Engineer", "Plant Head"),
                    ("HOD", "MD"),
                ]
                for from_role, to_role in escalation_chains_l2:
                    for from_name in user_by_role.get(from_role, []):
                        for to_name in user_by_role.get(to_role, []):
                            defaults.append({
                                "id": f"E2-{tier_id}",
                                "level": 2,
                                "label": f"L2: {from_name} → {to_name}",
                                "from_user": from_name,
                                "target_user": to_name,
                                "from_role": from_role,
                                "target_role": to_role,
                                "overdue_hrs": 72,
                                "notify_method": "In-App + Email",
                                "priorities": '["CRITICAL","WARNING"]',
                                "color": "#E67E22",
                                "active": True,
                                "description": f"{from_name} overdue 72h → escalate to {to_name}",
                            })
                            tier_id += 1

                # Level 3 (168h): two levels up
                escalation_chains_l3 = [
                    ("Operator", "Plant Head"),
                    ("Supervisor", "MD"),
                    ("Shift Engineer", "MD"),
                ]
                for from_role, to_role in escalation_chains_l3:
                    for from_name in user_by_role.get(from_role, []):
                        for to_name in user_by_role.get(to_role, []):
                            defaults.append({
                                "id": f"E3-{tier_id}",
                                "level": 3,
                                "label": f"L3: {from_name} → {to_name}",
                                "from_user": from_name,
                                "target_user": to_name,
                                "from_role": from_role,
                                "target_role": to_role,
                                "overdue_hrs": 168,
                                "notify_method": "In-App + Email",
                                "priorities": '["CRITICAL"]',
                                "color": "#C0392B",
                                "active": True,
                                "description": f"{from_name} overdue 7d → escalate to {to_name}",
                            })
                            tier_id += 1

                for d in defaults:
                    conn.execute(text(
                        "INSERT INTO escalation_matrix (id, level, label, from_user, target_user, from_role, target_role, overdue_hrs, notify_method, priorities, color, active, description) "
                        "VALUES (:id, :level, :label, :from_user, :target_user, :from_role, :target_role, :overdue_hrs, :notify_method, :priorities::jsonb, :color, :active, :description)"
                    ), d)
        except Exception as e:
            print(f"[migrate] escalation_matrix migration skipped: {e}")

    # Users table columns
    if "users" in existing_tables:
        try:
            user_cols = {c["name"] for c in inspector.get_columns("users")}
            if "master_access" not in user_cols:
                conn.execute(text(
                    "ALTER TABLE users ADD COLUMN master_access BOOLEAN DEFAULT FALSE"
                ))
        except Exception as e:
            print(f"[migrate] users column migration skipped: {e}")

    # Meetings table columns
    if "meetings" in existing_tables:
        try:
            mtg_cols = {c["name"] for c in inspector.get_columns("meetings")}
            if "guidelines" not in mtg_cols:
                conn.execute(text(
                    "ALTER TABLE meetings ADD COLUMN guidelines JSONB DEFAULT '[]'::jsonb"
                ))
        except Exception as e:
            print(f"[migrate] meetings column migration skipped: {e}")

    # Actions table columns
    if "actions" in existing_tables:
        try:
            action_cols = {c["name"] for c in inspector.get_columns("actions")}
            if "version" not in action_cols:
                conn.execute(text(
                    "ALTER TABLE actions ADD COLUMN version INTEGER DEFAULT 1"
                ))
        except Exception as e:
            print(f"[migrate] actions column migration skipped: {e}")


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


@app.exception_handler(IntegrityError)
async def integrity_error_handler(request: Request, exc: IntegrityError):
    print(f"IntegrityError on {request.url.path}: {exc.orig}")
    return JSONResponse(
        status_code=409,
        content={"detail": "Data conflict — a record with this value already exists. Please refresh and try again."},
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    print(f"Unhandled error on {request.url.path}: {type(exc).__name__}: {exc}")
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
