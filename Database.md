# 🗄️ Database Integration Roadmap
## MCS / IMS — Google Sheets → Relational Database Migration

> **Current State:** All data persists in Google Sheets via Apps Script HTTP endpoints.  
> **Target State:** PostgreSQL relational database with a proper ORM, migrations, and REST API layer.

---

## 📑 Table of Contents

1. [Why Migrate?](#-why-migrate)
2. [Recommended Stack](#-recommended-stack)V
3. [Relational Schema Design](#-relational-schema-design)
4. [Entity Relationship Diagram](#-entity-relationship-diagram)
5. [Phase Roadmap](#-phase-roadmap)
6. [Backend Integration (FastAPI + SQLAlchemy)](#-backend-integration-fastapi--sqlalchemy)
7. [Frontend Integration Changes](#-frontend-integration-changes)
8. [Environment Configuration](#-environment-configuration)
9. [Migration Strategy (Sheets → PostgreSQL)](#-migration-strategy-sheets--postgresql)
10. [Deployment Guide](#-deployment-guide)
11. [Rollback Plan](#-rollback-plan)

---

## 🔍 Why Migrate?

| Limitation (Google Sheets) | Benefit (Relational DB) |
|---|---|
| No referential integrity | Foreign keys enforce data consistency |
| No concurrent write safety | ACID transactions prevent race conditions |
| ~10 MB cell data limit | Practically unlimited row capacity |
| Slow linear scan in Apps Script | Indexed queries in microseconds |
| No audit trail / row versioning | Trigger-based change logs |
| Public Script URL exposure | Secure server-side connection only |
| Cannot do JOIN queries | Full relational query power |
| Escalation logic done client-side | Background worker + DB scheduler |

---

## 🛠 Recommended Stack

| Layer | Choice | Reason |
|---|---|---|
| **Database** | **PostgreSQL 16** | Industry standard, JSONB for AI payloads, free tier on Render/Supabase |
| **ORM** | **SQLAlchemy 2.x (async)** | Native FastAPI async support, Alembic migrations |
| **Migrations** | **Alembic** | Version-controlled schema history |
| **Connection Pool** | **asyncpg** | High-performance async PostgreSQL driver |
| **Hosting** | **Render PostgreSQL** or **Supabase** | Matches existing Render deployment (`render.yaml`) |

---

## 📐 Relational Schema Design

### Table: `plants`
```sql
CREATE TABLE plants (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(20)  UNIQUE NOT NULL,   -- e.g. "ADR"
    name        VARCHAR(100) NOT NULL,
    location    VARCHAR(200),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### Table: `departments`
```sql
CREATE TABLE departments (
    id          SERIAL PRIMARY KEY,
    plant_id    INT REFERENCES plants(id) ON DELETE CASCADE,
    code        VARCHAR(20) NOT NULL,
    name        VARCHAR(100) NOT NULL,
    UNIQUE (plant_id, code)
);
```

### Table: `machines`
```sql
CREATE TABLE machines (
    id           SERIAL PRIMARY KEY,
    dept_id      INT REFERENCES departments(id) ON DELETE SET NULL,
    name         VARCHAR(100) NOT NULL,
    asset_code   VARCHAR(50),
    location     VARCHAR(200),
    is_active    BOOLEAN DEFAULT TRUE,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
```

### Table: `users`
```sql
CREATE TABLE users (
    id           SERIAL PRIMARY KEY,
    username     VARCHAR(50)  UNIQUE NOT NULL,
    name         VARCHAR(100) NOT NULL,
    role         VARCHAR(20)  NOT NULL CHECK (role IN ('admin','master','om','viewer')),
    plant_id     INT REFERENCES plants(id),
    dept_id      INT REFERENCES departments(id),
    phone        VARCHAR(20),
    email        VARCHAR(150) UNIQUE,
    superior_id  INT REFERENCES users(id),          -- Org hierarchy for escalation
    is_active    BOOLEAN DEFAULT TRUE,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
```

### Table: `permissions`
```sql
CREATE TABLE permissions (
    id           SERIAL PRIMARY KEY,
    role         VARCHAR(20) NOT NULL,
    feature      VARCHAR(100) NOT NULL,            -- e.g. "create_action", "delete_action"
    is_allowed   BOOLEAN DEFAULT TRUE,
    UNIQUE (role, feature)
);
```

### Table: `actions`
```sql
CREATE TABLE actions (
    id               SERIAL PRIMARY KEY,
    sn               VARCHAR(30) UNIQUE NOT NULL,  -- Human-readable serial e.g. "ADR-2026-001"
    plant_id         INT REFERENCES plants(id),
    dept_id          INT REFERENCES departments(id),
    machine_id       INT REFERENCES machines(id),
    action_text      TEXT NOT NULL,
    allocated_to_id  INT REFERENCES users(id),
    allocated_by_id  INT REFERENCES users(id),
    date_of_action   DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date         DATE,
    status           VARCHAR(30) DEFAULT 'IN PROCESS'
                         CHECK (status IN ('IN PROCESS','COMPLETED','CANCELLED','ON HOLD')),
    priority         VARCHAR(20) DEFAULT 'NORMAL'
                         CHECK (priority IN ('CRITICAL','WARNING','NORMAL')),
    source           VARCHAR(50) DEFAULT 'Daily Meeting',
    remarks          TEXT,
    closed_on        TIMESTAMPTZ,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER actions_updated_at
BEFORE UPDATE ON actions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

### Table: `action_revisions`  *(replaces flat `revisionHistory` column)*
```sql
CREATE TABLE action_revisions (
    id          SERIAL PRIMARY KEY,
    action_id   INT REFERENCES actions(id) ON DELETE CASCADE,
    changed_by  INT REFERENCES users(id),
    field_name  VARCHAR(50),
    old_value   TEXT,
    new_value   TEXT,
    changed_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### Table: `action_messages`  *(replaces flat `messages` column)*
```sql
CREATE TABLE action_messages (
    id          SERIAL PRIMARY KEY,
    action_id   INT REFERENCES actions(id) ON DELETE CASCADE,
    author_id   INT REFERENCES users(id),
    message     TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### Table: `escalation_matrix`
```sql
CREATE TABLE escalation_matrix (
    id              SERIAL PRIMARY KEY,
    level           SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 4),
    threshold_hours INT NOT NULL,                  -- 0, 24, 72, 168
    label           VARCHAR(100),
    notify_email    BOOLEAN DEFAULT TRUE,
    notify_whatsapp BOOLEAN DEFAULT FALSE
);

-- Seed data
INSERT INTO escalation_matrix (level, threshold_hours, label, notify_email, notify_whatsapp) VALUES
(1, 0,   'Level 1 — Line Supervisor',   FALSE, FALSE),
(2, 24,  'Level 2 — HOD Review',        TRUE,  FALSE),
(3, 72,  'Level 3 — Plant Head',        TRUE,  FALSE),
(4, 168, 'Level 4 — MD / Board',        TRUE,  TRUE);
```

### Table: `meeting_transcripts`  *(new — persist AI analysis)*
```sql
CREATE TABLE meeting_transcripts (
    id           SERIAL PRIMARY KEY,
    plant_id     INT REFERENCES plants(id),
    meeting_type VARCHAR(50),
    raw_text     TEXT,
    ai_result    JSONB,                            -- Full Gemini JSON response
    created_by   INT REFERENCES users(id),
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 🔗 Entity Relationship Diagram

```mermaid
erDiagram
    plants ||--o{ departments : "has"
    plants ||--o{ users : "belongs to"
    plants ||--o{ actions : "plant of"
    departments ||--o{ machines : "contains"
    departments ||--o{ users : "assigned to"
    departments ||--o{ actions : "dept of"
    machines ||--o{ actions : "related machine"
    users ||--o{ actions : "allocated_to"
    users ||--o{ actions : "allocated_by"
    users }o--o| users : "superior_of"
    actions ||--o{ action_revisions : "has revisions"
    actions ||--o{ action_messages : "has messages"
    escalation_matrix }|..|| actions : "drives escalation"
    meeting_transcripts }o--|| plants : "belongs to"
```

---

## 🚀 Phase Roadmap

### Phase 1 — Foundation & Schema  *(Week 1)*
- [ ] Provision PostgreSQL database on Render (or Supabase)
- [ ] Add `DATABASE_URL` to `.env` and Render environment
- [ ] Install Python deps: `sqlalchemy[asyncio]`, `asyncpg`, `alembic`
- [ ] Write SQLAlchemy models (`backend/models.py`)
- [ ] Write Alembic initial migration (`alembic/versions/001_initial.py`)
- [ ] Run migration: `alembic upgrade head`
- [ ] Seed static lookup data: Plants, Departments, Machines, Users, Permissions, EscMatrix

### Phase 2 — Backend CRUD API  *(Week 2)*
- [ ] Create `backend/database.py` — async engine + session factory
- [ ] Create `backend/crud/` — one module per entity (actions, users, plants …)
- [ ] Add new FastAPI routers: `/api/actions`, `/api/users`, `/api/plants`, `/api/departments`
- [ ] Replace `Code.gs` INSERT/UPDATE calls with direct API calls
- [ ] Add JWT authentication middleware (replace current role-in-sheet approach)
- [ ] Unit test CRUD with `pytest-asyncio` + SQLite in-memory

### Phase 3 — Frontend Refactor  *(Week 3)*
- [ ] Remove `useSheetDB` CSV fetch hooks
- [ ] Replace all `VITE_SHEET_SCRIPT_URL` POST calls → `VITE_API_BASE_URL` REST calls
- [ ] Add `Authorization: Bearer <token>` header to all API requests
- [ ] Update `getPerms` to use `/api/permissions` endpoint instead of sheet
- [ ] Cache user/plant/dept lists with React Query or SWR

### Phase 4 — Escalation Worker Migration  *(Week 4)*
- [ ] Replace frontend timer-based escalation → server-side background job
- [ ] Implement `backend/workers/escalation_worker.py` using `APScheduler` or `celery`
- [ ] Worker queries: `SELECT * FROM actions WHERE status='IN PROCESS' AND due_date < NOW()`
- [ ] Worker calls existing `email_escalation.py` logic
- [ ] Add `escalation_logs` table to track sent alerts and prevent duplicates

### Phase 5 — Migration & Cutover  *(Week 5)*
- [ ] Export all Google Sheets data to CSV
- [ ] Write `backend/scripts/migrate_sheets.py` — CSV → PostgreSQL ingestion script
- [ ] Run migration on staging, validate row counts and data integrity
- [ ] Parallel-run both systems for 1 week (write to both)
- [ ] Hard cutover — disable Apps Script endpoint
- [ ] Archive Google Sheet as read-only backup

### Phase 6 — Hardening  *(Week 6)*
- [ ] Add database connection pooling tuning (`pool_size=10`, `max_overflow=20`)
- [ ] Enable Row-Level Security (RLS) if using Supabase
- [ ] Set up automated daily `pg_dump` backups to cloud storage
- [ ] Add `GET /api/health` DB connection check
- [ ] Performance: add indexes on hot columns (see below)
- [ ] Load test with Locust

---

## 🔧 Backend Integration (FastAPI + SQLAlchemy)

### File: `backend/database.py` *(new)*
```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, DeclarativeBase
import os

DATABASE_URL = os.environ["DATABASE_URL"].replace(
    "postgres://", "postgresql+asyncpg://", 1  # Render uses postgres:// prefix
)

engine = create_async_engine(DATABASE_URL, pool_size=10, max_overflow=20, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
```

### File: `backend/models.py` *(new)*
```python
from sqlalchemy import Column, Integer, String, Text, Boolean, Date, ForeignKey, TIMESTAMP
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from database import Base
import datetime

class Plant(Base):
    __tablename__ = "plants"
    id = Column(Integer, primary_key=True)
    code = Column(String(20), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    departments = relationship("Department", back_populates="plant")
    actions = relationship("Action", back_populates="plant")

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    username = Column(String(50), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    role = Column(String(20), nullable=False)
    email = Column(String(150), unique=True)
    phone = Column(String(20))
    superior_id = Column(Integer, ForeignKey("users.id"))
    superior = relationship("User", remote_side="User.id")

class Action(Base):
    __tablename__ = "actions"
    id = Column(Integer, primary_key=True)
    sn = Column(String(30), unique=True, nullable=False)
    plant_id = Column(Integer, ForeignKey("plants.id"))
    dept_id = Column(Integer, ForeignKey("departments.id"))
    machine_id = Column(Integer, ForeignKey("machines.id"))
    action_text = Column(Text, nullable=False)
    allocated_to_id = Column(Integer, ForeignKey("users.id"))
    allocated_by_id = Column(Integer, ForeignKey("users.id"))
    date_of_action = Column(Date, default=datetime.date.today)
    due_date = Column(Date)
    status = Column(String(30), default="IN PROCESS")
    priority = Column(String(20), default="NORMAL")
    remarks = Column(Text)
    closed_on = Column(TIMESTAMP(timezone=True))
    created_at = Column(TIMESTAMP(timezone=True), default=datetime.datetime.utcnow)
    revisions = relationship("ActionRevision", back_populates="action")
    messages = relationship("ActionMessage", back_populates="action")
```

### File: `backend/routers/actions.py` *(new)*
```python
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import Action

router = APIRouter(prefix="/api/actions", tags=["actions"])

@router.get("/")
async def list_actions(plant_id: int = None, status: str = None, db: AsyncSession = Depends(get_db)):
    q = select(Action)
    if plant_id: q = q.where(Action.plant_id == plant_id)
    if status:   q = q.where(Action.status == status)
    result = await db.execute(q)
    return result.scalars().all()

@router.post("/")
async def create_action(data: dict, db: AsyncSession = Depends(get_db)):
    action = Action(**data)
    db.add(action)
    await db.commit()
    await db.refresh(action)
    return action

@router.patch("/{action_id}")
async def update_action(action_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Action).where(Action.id == action_id))
    action = result.scalar_one_or_404()
    for k, v in data.items():
        setattr(action, k, v)
    await db.commit()
    return action
```

---

## 🖥 Frontend Integration Changes

### Remove (Google Sheets specific)
```diff
- const SHEET_ID = import.meta.env.VITE_SHEET_ID;
- const SCRIPT_URL = import.meta.env.VITE_SHEET_SCRIPT_URL;
- // CSV fetch via public Google Sheets URL
- const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?...`);
```

### Add (REST API calls)
```diff
+ const API = import.meta.env.VITE_API_BASE_URL;
+
+ // Fetch actions
+ const res = await fetch(`${API}/api/actions?plant_id=${plantId}`, {
+   headers: { Authorization: `Bearer ${token}` }
+ });
+
+ // Create action
+ await fetch(`${API}/api/actions`, {
+   method: "POST",
+   headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
+   body: JSON.stringify(actionPayload)
+ });
```

### `useSheetDB` hook → `useActions` hook
```javascript
// NEW: src/hooks/useActions.js
import { useState, useEffect } from "react";

export function useActions(filters = {}) {
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const API = import.meta.env.VITE_API_BASE_URL;

  useEffect(() => {
    const params = new URLSearchParams(filters).toString();
    fetch(`${API}/api/actions?${params}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
    })
      .then(r => r.json())
      .then(data => { setActions(data); setLoading(false); });
  }, [JSON.stringify(filters)]);

  return { actions, loading };
}
```

---

## ⚙️ Environment Configuration

### Backend `.env` additions
```env
# ── Database ───────────────────────────────────────────────
DATABASE_URL=postgresql+asyncpg://user:password@host:5432/mcsdb

# ── JWT Auth ───────────────────────────────────────────────
JWT_SECRET=your-256-bit-random-secret
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=480

# ── Remove (no longer needed after migration) ──────────────
# VITE_SHEET_ID=...
# VITE_SHEET_SCRIPT_URL=...
```

### `render.yaml` additions
```yaml
databases:
  - name: mcs-postgres
    databaseName: mcsdb
    plan: free                  # Upgrade to starter for production

services:
  - type: web
    name: mcs-backend
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: mcs-postgres
          property: connectionString
```

---

## 📦 Migration Strategy (Sheets → PostgreSQL)

### Step 1 — Export Sheets to CSV
```
Google Sheet → File → Download → CSV (one per sheet)
Sheets to export: Actions, Users, Plants, Depts, Machines, Permissions, EscMatrix
```

### Step 2 — Run Migration Script
```python
# backend/scripts/migrate_sheets.py
import csv, asyncio
from database import AsyncSessionLocal
from models import Action, User, Plant

async def migrate_actions(filepath: str):
    async with AsyncSessionLocal() as db:
        with open(filepath) as f:
            for row in csv.DictReader(f):
                action = Action(
                    sn=row["id"],
                    action_text=row["action"],
                    status=row["status"],
                    priority=row.get("priority", "NORMAL"),
                    due_date=row["dueDate"] or None,
                    # ... map all fields
                )
                db.add(action)
        await db.commit()
        print(f"Migrated actions from {filepath}")

asyncio.run(migrate_actions("Actions.csv"))
```

### Step 3 — Validate
```sql
-- Row count check
SELECT COUNT(*) FROM actions;          -- Must match sheet row count

-- Orphan check (no null plant)
SELECT COUNT(*) FROM actions WHERE plant_id IS NULL;

-- Overdue check integrity
SELECT id, due_date, status FROM actions
WHERE due_date < CURRENT_DATE AND status = 'IN PROCESS'
LIMIT 20;
```

---

## 🚢 Deployment Guide

### Install New Dependencies
```bash
pip install "sqlalchemy[asyncio]>=2.0" asyncpg alembic python-jose[cryptography] passlib
pip freeze > requirements.txt
```

### Initialize Alembic
```bash
cd backend
alembic init alembic
# Edit alembic/env.py to import Base from models.py
alembic revision --autogenerate -m "initial_schema"
alembic upgrade head
```

### Recommended Indexes
```sql
-- Hot query paths
CREATE INDEX idx_actions_status       ON actions(status);
CREATE INDEX idx_actions_due_date     ON actions(due_date);
CREATE INDEX idx_actions_plant_id     ON actions(plant_id);
CREATE INDEX idx_actions_allocated_to ON actions(allocated_to_id);
CREATE INDEX idx_users_username       ON users(username);
CREATE INDEX idx_users_email          ON users(email);
```

---

## 🔄 Rollback Plan

> **Warning:** Keep Google Sheets active in read-only mode for 30 days post-cutover.

| Scenario | Action |
|---|---|
| DB connection failure | FastAPI returns 503; frontend falls back to cached local state |
| Data corruption detected | Restore from latest `pg_dump` backup |
| Full rollback needed | Re-enable Apps Script endpoint; point `VITE_SHEET_SCRIPT_URL` back |
| Partial feature rollback | Feature-flag: `USE_DB=false` env var routes calls back to Sheets layer |

---

## ✅ Definition of Done

- [ ] All 7 Google Sheets replaced by PostgreSQL tables
- [ ] Zero direct calls to `VITE_SHEET_SCRIPT_URL` in frontend code
- [ ] All escalation logic runs server-side (no frontend timers)
- [ ] Alembic migration history tracks all schema changes
- [ ] Historical data migrated and validated (row counts match)
- [ ] Automated daily backup configured
- [ ] API response time < 200ms for action list queries

---

*Generated: 2026-06-22 | MCS v2 | Stack: FastAPI + PostgreSQL + SQLAlchemy 2.x + Alembic*
