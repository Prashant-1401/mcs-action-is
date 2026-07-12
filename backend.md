# MCS Backend — Complete Guide

## Overview

Python FastAPI backend with async PostgreSQL (Neon cloud). Handles authentication, CRUD for 15 entities, AI-powered meeting analysis, email escalation alerts, and WhatsApp notifications.

**Deployed at:** https://mcs-action-is-1.onrender.com

---

## Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| FastAPI | >=0.115.0 | Async web framework |
| Uvicorn | >=0.34.0 | ASGI server |
| SQLAlchemy 2.0 | >=2.0.0 | Async ORM |
| asyncpg | >=0.30.0 | PostgreSQL async driver |
| Pydantic Settings | >=2.0.0 | Config management |
| PyJWT | >=2.8.0 | JWT authentication |
| bcrypt | 4.0.1 | Password hashing |
| Google Gemini AI | >=1.0.0 | Meeting transcript analysis |
| httpx | >=0.28.0 | HTTP client |
| requests | >=2.31.0 | WhatsApp gateway |

---

## File Structure

```
backend/
├── Procfile                    # Render: uvicorn app.main:app --host 0.0.0.0 --port $PORT
├── start.sh                    # Local dev: venv/bin/uvicorn ...
├── requirements.txt            # 17 Python dependencies
├── .env.example                # Environment variable template
├── reset_and_email.py          # Utility: reset passwords + send welcome emails
├── update_roles.py             # Utility: bulk update roles + insert users
├── seed_esc_matrix.py          # Utility: seed escalation matrix from user superior chains
├── app/
│   ├── __init__.py
│   ├── main.py                 # FastAPI app lifecycle, CORS, router mounting (257 lines)
│   ├── config.py               # Pydantic Settings — 18 env vars (32 lines)
│   ├── database.py             # SQLAlchemy async engine + session factory (24 lines)
│   ├── models/
│   │   ├── __init__.py
│   │   └── models.py           # 15 SQLAlchemy ORM models (240 lines)
│   ├── schemas/
│   │   ├── __init__.py
│   │   └── schemas.py          # 25 Pydantic request/response schemas (404 lines)
│   ├── middleware/
│   │   ├── __init__.py
│   │   └── auth.py             # JWT + API key auth middleware (54 lines)
│   ├── routers/                # 15 API routers (72 endpoints total)
│   │   ├── auth.py             # Login + master login (60 lines)
│   │   ├── plants.py           # CRUD plants (74 lines)
│   │   ├── departments.py      # CRUD departments (76 lines)
│   │   ├── roles.py            # CRUD roles (64 lines)
│   │   ├── users.py            # CRUD users (144 lines)
│   │   ├── machines.py         # CRUD machines (69 lines)
│   │   ├── reasons.py          # CRUD reasons (66 lines)
│   │   ├── actions.py          # CRUD actions + messages + bulk + escalation triggers (289 lines)
│   │   ├── projects.py         # CRUD projects (77 lines)
│   │   ├── meetings.py         # CRUD meetings + presets (134 lines)
│   │   ├── meetings_ai.py      # AI meeting analysis endpoints (25 lines)
│   │   ├── escalation.py       # Escalation matrix + email escalation (192 lines)
│   │   ├── audit.py            # Audit log CRUD (53 lines)
│   │   ├── translate.py        # Hindi/English translation (11 lines)
│   │   └── email_share.py      # Email insights sharing (21 lines)
│   └── services/
│       ├── __init__.py
│       ├── ai_service.py       # Gemini API: extract_insights, analyze_paragraph, translate (163 lines)
│       ├── email_service.py    # SMTP: escalation, welcome, action emails (151 lines)
│       ├── whatsapp_service.py # WhatsApp alerts via WACRM gateway (49 lines)
│       └── password.py         # bcrypt hash + verify (12 lines)
└── scripts/
    ├── __init__.py
    └── migrate_from_sheets.py  # CSV-to-PostgreSQL migration from legacy Google Sheets (109 lines)
```

**Total backend lines:** 3,215 across 37 Python files

---

## Configuration

### Environment Variables (18 settings in config.py)

```python
class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/mcsdb"

    # AI (Gemini)
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash-lite"

    # Auth
    secret_key: str = "change-me-to-a-random-secret"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480  # 8 hours

    # CORS
    allowed_origins: str = "*"

    # API Key
    api_key: str = ""

    # Email (SMTP)
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    admin_email: str = "admin@adroit.in"
    team_email: str = "team@adroit.in"

    # WhatsApp
    wacrm_alert_url: str = ""

    # Frontend
    frontend_url: str = "https://mcs-control-management.vercel.app"

    # Master Login
    master_user: str = ""
    master_password: str = ""
```

### Database Connection Pool (database.py)

```python
engine = create_async_engine(
    DATABASE_URL,
    pool_size=5,           # Persistent connections
    max_overflow=10,       # Burst connections
    pool_recycle=300,      # Recycle every 5 min
    pool_pre_ping=True,    # Health check before use
    connect_args={"command_timeout": 15}
)
```

---

## Application Lifecycle (main.py)

### On Server Start

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)  # Create missing tables
        await conn.run_sync(migrate_schema)            # Add missing columns
    yield
    await engine.dispose()
```

### Schema Migration (ad-hoc, no Alembic)

```python
def migrate_schema(conn):
    # 1. Add missing columns to escalation_matrix
    #    from_user, target_user, from_role, target_role, priorities

    # 2. Add missing columns to users
    #    master_access BOOLEAN DEFAULT FALSE

    # 3. Add missing columns to meetings
    #    guidelines JSONB DEFAULT '[]'

    # 4. Backfill NULL priorities in escalation_matrix

    # 5. Seed default escalation matrix if empty
```

### CORS Configuration

```python
origins = [
    "https://mcs-control-management.vercel.app",
    "https://mcs-control-management-g9uaoyxl1.vercel.app",
    "http://localhost:5173"
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "x-api-key"],
)
```

---

## Authentication System

### Dual-Mode Auth (middleware/auth.py)

The `require_api_key` dependency works in two modes:

**Mode 1: API Key (active)**
```python
async def require_api_key(request: Request):
    if settings.api_key:
        key = request.headers.get("x-api-key")
        if key == settings.api_key:
            return None  # Pass — API key is sufficient
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
    # Fall through to JWT if no API key configured
```

**Mode 2: JWT Bearer (fallback)**
```python
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    return payload
```

### Login Flow

```
POST /api/auth/login
  → Query users table by username
  → Verify bcrypt password hash
  → Generate JWT token (HS256, 480 min expiry)
  → Return { token, user }

POST /api/auth/master-login
  → Validate against MASTER_USER / MASTER_PASSWORD env vars
  → No database lookup
  → Return { token, user }
```

### Password Hashing (services/password.py)

```python
from passlib.context import CryptContext
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(plain: str) -> str:
    return pwd.hash(plain)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd.verify(plain, hashed)
```

---

## Database Schema

### 15 Tables + 3 Enums + 2 Views

#### Enums

```sql
CREATE TYPE action_status AS ENUM ('NOT STARTED', 'IN PROCESS', 'COMPLETED', 'DROPPED', 'PENDING CONFIRM');
CREATE TYPE action_priority AS ENUM ('CRITICAL', 'WARNING', 'NORMAL');
CREATE TYPE project_status AS ENUM ('NOT STARTED', 'IN PROCESS', 'COMPLETED', 'ON HOLD', 'DROPPED');
```

#### Views

```sql
CREATE VIEW v_actions AS SELECT ...  -- Actions with resolved names
CREATE VIEW v_audit AS SELECT ...   -- Audit with action details
```

### Tables

#### 1. `plants` — Manufacturing plants

| Column | Type | Constraints |
|--------|------|-------------|
| id | VARCHAR | PRIMARY KEY |
| name | VARCHAR(100) | UNIQUE, NOT NULL |
| location | VARCHAR(200) | |
| head | VARCHAR(100) | |

**Seed data:** Signet Industries (Pithampur), Adroit Industries (Dewas), Adroit Driveshaft (Pithampur), ALL (Indore)

#### 2. `departments` — Departments within plants

| Column | Type | Constraints |
|--------|------|-------------|
| id | VARCHAR | PRIMARY KEY |
| name | VARCHAR(100) | NOT NULL |
| plant_id | VARCHAR | FK → plants.id |
| head | VARCHAR(100) | |
| icon | VARCHAR(10) | |

**Unique constraint:** (name, plant_id)

#### 3. `roles` — Role definitions with hierarchy

| Column | Type | Constraints |
|--------|------|-------------|
| id | VARCHAR | PRIMARY KEY |
| name | VARCHAR(50) | UNIQUE, NOT NULL |
| level | INTEGER | NOT NULL, CHECK 1-10 |

**Seed data:** Guest User(1), Operator(2), Supervisor(3), Shift Engineer(4), HOD(5), Plant Head(6), MD(7), Admin(8)

#### 4. `users` — System users

| Column | Type | Constraints |
|--------|------|-------------|
| id | VARCHAR | PRIMARY KEY |
| name | VARCHAR(100) | NOT NULL |
| username | VARCHAR(50) | UNIQUE, NOT NULL |
| password | VARCHAR(200) | bcrypt hash |
| role | VARCHAR(50) | FK → roles.name |
| plant_id | VARCHAR | FK → plants.id |
| dept_id | VARCHAR | FK → departments.id |
| superior | VARCHAR(100) | Name of direct superior |
| phone | VARCHAR(20) | |
| email | VARCHAR(150) | |
| initials | VARCHAR(10) | |
| color | VARCHAR(20) | Default: #7C80B0 |
| is_active | BOOLEAN | Default: TRUE |
| master_access | BOOLEAN | Default: FALSE |

#### 5. `machines` — Industrial machines

| Column | Type | Constraints |
|--------|------|-------------|
| id | VARCHAR | PRIMARY KEY |
| name | VARCHAR(100) | |
| plant_id | VARCHAR | FK → plants.id |
| dept_id | VARCHAR | FK → departments.id |
| type | VARCHAR(50) | |
| asset_no | VARCHAR(50) | |
| is_active | BOOLEAN | Default: TRUE |

#### 6. `reasons` — Predefined action reasons

| Column | Type | Constraints |
|--------|------|-------------|
| id | VARCHAR | PRIMARY KEY |
| text | VARCHAR(200) | NOT NULL |
| category | VARCHAR(50) | |

**Categories:** Equipment, Quality, Safety, Process, Customer, Maintenance, Supply Chain, People, Utilities, Compliance, Projects, Management

#### 7. `projects` — Project tracking

| Column | Type | Constraints |
|--------|------|-------------|
| id | VARCHAR | PRIMARY KEY |
| name | VARCHAR(200) | NOT NULL |
| plant_id | VARCHAR | FK → plants.id |
| dept_id | VARCHAR | FK → departments.id |
| status | VARCHAR(30) | Default: NOT STARTED |
| owner | VARCHAR(100) | |
| sponsor | VARCHAR(100) | |
| start_date | DATE | |
| end_date | DATE | |
| progress | INTEGER | CHECK 0-100 |
| priority | VARCHAR(20) | Default: NORMAL |
| objective | TEXT | |
| scope | TEXT | |
| budget | NUMERIC(14,2) | |
| description | TEXT | |
| risks | JSONB | Default: [] |
| team | JSONB | Default: [] |

#### 8. `project_milestones` — Milestone sub-items

| Column | Type | Constraints |
|--------|------|-------------|
| id | BIGSERIAL | PRIMARY KEY |
| project_id | VARCHAR | FK → projects.id, CASCADE DELETE |
| name | VARCHAR(200) | |
| due | DATE | |
| done | BOOLEAN | Default: FALSE |
| ord | INTEGER | Default: 0 |

#### 9. `meeting_presets` — Meeting type templates

| Column | Type | Constraints |
|--------|------|-------------|
| type | VARCHAR(50) | PRIMARY KEY |
| attendees | JSONB | Default: [] |
| instructions | JSONB | Default: [] |

#### 10. `meetings` — Meeting records

| Column | Type | Constraints |
|--------|------|-------------|
| id | VARCHAR | PRIMARY KEY |
| name | VARCHAR(200) | |
| type | VARCHAR(50) | |
| plant_id | VARCHAR | FK → plants.id |
| date | DATE | |
| time | VARCHAR(10) | |
| status | VARCHAR(30) | |
| attendees | JSONB | Default: [] |
| duration | INTEGER | |
| dur | INTEGER | |
| action_count | INTEGER | Default: 0 |
| notes | TEXT | |
| facilitator | VARCHAR(100) | |
| recurring | BOOLEAN | Default: FALSE |
| recurrence | VARCHAR(30) | |
| project_id | VARCHAR | FK → projects.id |
| completed_sessions | JSONB | Default: [] |
| guidelines | JSONB | Default: [] |

#### 11. `escalation_matrix` — Escalation tier definitions

| Column | Type | Constraints |
|--------|------|-------------|
| id | VARCHAR | PRIMARY KEY |
| level | INTEGER | NOT NULL |
| label | VARCHAR(200) | |
| from_user | VARCHAR(100) | |
| target_user | VARCHAR(100) | |
| from_role | VARCHAR(50) | |
| target_role | VARCHAR(50) | |
| overdue_days | INTEGER | Default: 0 |
| overdue_hrs | INTEGER | Default: 0 |
| notify_method | VARCHAR(50) | |
| applicable_to | VARCHAR(50) | Default: All |
| priorities | JSONB | Default: [] |
| color | VARCHAR(20) | |
| active | BOOLEAN | Default: TRUE |
| description | TEXT | |

#### 12. `escalation_priorities` — Normalized priority mappings

| Column | Type | Constraints |
|--------|------|-------------|
| escalation_id | VARCHAR | FK → escalation_matrix.id, CASCADE DELETE |
| priority | VARCHAR(20) | |

**Composite PK:** (escalation_id, priority)

#### 13. `actions` — Core action items (largest table)

| Column | Type | Constraints |
|--------|------|-------------|
| id | VARCHAR | PRIMARY KEY |
| sn | VARCHAR(30) | UNIQUE, NOT NULL |
| text | TEXT | NOT NULL |
| responsible_user_id | VARCHAR | FK → users.id |
| responsible | VARCHAR(100) | Display name |
| due | DATE | |
| status | VARCHAR(30) | Default: NOT STARTED |
| priority | VARCHAR(20) | Default: NORMAL |
| section | VARCHAR(50) | Department name |
| source | VARCHAR(100) | Meeting type or "Quick Add" |
| plant_id | VARCHAR | FK → plants.id |
| dept_id | VARCHAR | FK → departments.id |
| machine_id | VARCHAR | FK → machines.id |
| machine_name | VARCHAR(100) | Display name |
| reason_id | VARCHAR | FK → reasons.id |
| reason | VARCHAR(100) | Display name |
| reason_of_action | VARCHAR(100) | |
| action_point_type | VARCHAR(50) | |
| remarks | TEXT | |
| date_of_action | DATE | |
| created | DATE | Default: today |
| closed_on | DATE | |
| closed_by | VARCHAR(100) | |
| allocated_by | VARCHAR(100) | |
| project_id | VARCHAR | FK → projects.id |
| project_name | VARCHAR(100) | Display name |
| src | VARCHAR(50) | Source meeting type |
| revisions | INTEGER | Default: 0 |
| revision_history | JSONB | Default: [] |
| pending_confirmation | BOOLEAN | Default: FALSE |

#### 14. `action_messages` — In-app discussion messages

| Column | Type | Constraints |
|--------|------|-------------|
| id | BIGSERIAL | PRIMARY KEY |
| action_id | VARCHAR | FK → actions.id, CASCADE DELETE |
| source_msg_id | VARCHAR | |
| author | VARCHAR(100) | |
| author_initials | VARCHAR(10) | |
| author_color | VARCHAR(20) | |
| text | TEXT | |
| ts | TIMESTAMP | |

#### 15. `audit` — Escalation audit trail

| Column | Type | Constraints |
|--------|------|-------------|
| id | VARCHAR | PRIMARY KEY |
| ts | TIMESTAMP | |
| action_sn | VARCHAR(30) | |
| action_id | VARCHAR | FK → actions.id |
| text | TEXT | |
| level | INTEGER | |
| target | VARCHAR(50) | |
| reason | TEXT | |

**Unique constraint:** (action_sn, level)

### Indexes (14 total)

```sql
-- Users
idx_users_username ON users(username)
idx_users_role ON users(role)

-- Reasons
idx_reasons_category ON reasons(category)

-- Projects
idx_projects_owner_status ON projects(owner, status)
idx_projects_plant ON projects(plant_id)

-- Milestones
idx_milestones_project ON project_milestones(project_id)

-- Meetings
idx_meetings_project ON meetings(project_id)
idx_meetings_date ON meetings(date)

-- Escalation
idx_esc_level ON escalation_matrix(level)

-- Actions (5 indexes — most queried table)
idx_actions_status_priority_due ON actions(status, priority, due)
idx_actions_responsible ON actions(responsible)
idx_actions_plant_dept ON actions(plant_id, dept_id)
idx_actions_project ON actions(project_id)
idx_actions_created ON actions(created)

-- Action Messages
idx_action_messages_action ON action_messages(action_id)

-- Audit
idx_audit_sn_level ON audit(action_sn, level)
idx_audit_ts ON audit(ts)
```

### Entity Relationships

```
plants ──1:N── departments
plants ──1:N── users
plants ──1:N── machines
plants ──1:N── actions
plants ──1:N── meetings
plants ──1:N── projects

departments ──1:N── users
departments ──1:N── machines
departments ──1:N── actions

users ──1:N── actions (as responsible)
users ──1:N── actions (as allocated_by)

machines ──1:N── actions

reasons ──1:N── actions

projects ──1:N── project_milestones
projects ──1:N── actions
projects ──1:N── meetings

meetings ──N:1── plants
meetings ──N:1── projects

actions ──1:N── action_messages
actions ──N:1── plants
actions ──N:1── departments
actions ──N:1── machines
actions ──N:1── reasons
actions ──N:1── projects

escalation_matrix ──1:N── escalation_priorities

audit ──N:1── actions
```

---

## API Endpoints (72 total)

### Auth (2 endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | None | Username/password login → JWT |
| POST | `/api/auth/master-login` | None | Env-var fallback login |

### Plants (6 endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/plants/` | API Key | List all plants |
| GET | `/api/plants/{id}` | API Key | Get single plant |
| POST | `/api/plants/` | API Key | Create plant |
| PATCH | `/api/plants/{id}` | API Key | Update plant |
| DELETE | `/api/plants/{id}` | API Key | Delete plant |
| POST | `/api/plants/bulk` | API Key | Bulk upsert plants |

### Departments (6 endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/departments/` | API Key | List all (optional plant_id filter) |
| GET | `/api/departments/{id}` | API Key | Get single |
| POST | `/api/departments/` | API Key | Create |
| PATCH | `/api/departments/{id}` | API Key | Update |
| DELETE | `/api/departments/{id}` | API Key | Delete |
| POST | `/api/departments/bulk` | API Key | Bulk upsert |

### Roles (5 endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/roles/` | API Key | List all |
| POST | `/api/roles/` | API Key | Create |
| PATCH | `/api/roles/{id}` | API Key | Update |
| DELETE | `/api/roles/{id}` | API Key | Delete |
| POST | `/api/roles/bulk` | API Key | Bulk upsert |

### Users (6 endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users/` | API Key | List all (password excluded) |
| GET | `/api/users/{id}` | API Key | Get single |
| POST | `/api/users/` | API Key | Create (optional welcome email) |
| PATCH | `/api/users/{id}` | API Key | Update |
| DELETE | `/api/users/{id}` | API Key | Delete |
| POST | `/api/users/bulk` | API Key | Bulk upsert (optional emails) |

### Machines (5 endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/machines/` | API Key | List all (optional plant_id/dept_id filters) |
| POST | `/api/machines/` | API Key | Create |
| PATCH | `/api/machines/{id}` | API Key | Update |
| DELETE | `/api/machines/{id}` | API Key | Delete |
| POST | `/api/machines/bulk` | API Key | Bulk upsert |

### Reasons (5 endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/reasons/` | API Key | List all (optional category filter) |
| POST | `/api/reasons/` | API Key | Create |
| PATCH | `/api/reasons/{id}` | API Key | Update |
| DELETE | `/api/reasons/{id}` | API Key | Delete |
| POST | `/api/reasons/bulk` | API Key | Bulk upsert |

### Actions (9 endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/actions/` | API Key | List all (multi-filter: plant, dept, status, priority, responsible) |
| GET | `/api/actions/{id}` | API Key | Get single |
| POST | `/api/actions/` | API Key | Create (+ background escalation check) |
| PATCH | `/api/actions/{id}` | API Key | Update (+ auto closed_on, revision tracking) |
| DELETE | `/api/actions/{id}` | API Key | Delete |
| GET | `/api/actions/{id}/messages` | API Key | List action messages |
| POST | `/api/actions/{id}/messages` | API Key | Create action message |
| POST | `/api/actions/bulk` | API Key | Bulk upsert (+ escalation check) |
| POST | `/api/actions/send-to-email` | API Key | Email action status to responsible person |

### Projects (5 endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/projects/` | API Key | List all (optional plant_id/status filters) |
| GET | `/api/projects/{id}` | API Key | Get single |
| POST | `/api/projects/` | API Key | Create |
| PATCH | `/api/projects/{id}` | API Key | Update |
| DELETE | `/api/projects/{id}` | API Key | Delete |

### Meetings (10 endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/meetings/presets` | API Key | List meeting presets |
| POST | `/api/meetings/presets` | API Key | Create preset |
| PATCH | `/api/meetings/presets/{type}` | API Key | Update preset |
| DELETE | `/api/meetings/presets/{type}` | API Key | Delete preset |
| POST | `/api/meetings/presets/bulk` | API Key | Bulk upsert presets |
| GET | `/api/meetings/` | API Key | List all (optional plant_id filter, ordered by date desc) |
| GET | `/api/meetings/{id}` | API Key | Get single |
| POST | `/api/meetings/` | API Key | Create |
| PATCH | `/api/meetings/{id}` | API Key | Update |
| DELETE | `/api/meetings/{id}` | API Key | Delete |

### Meeting AI (2 endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/meetings/extract-insights` | API Key | Full transcript → actions/decisions/risks via Gemini |
| POST | `/api/meetings/analyze-paragraph` | API Key | Single paragraph analysis via Gemini |

### Escalation (6 endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/escalation/matrix` | API Key | List all tiers |
| POST | `/api/escalation/matrix` | API Key | Create tier |
| PATCH | `/api/escalation/matrix/{id}` | API Key | Update tier |
| DELETE | `/api/escalation/matrix/{id}` | API Key | Delete tier |
| POST | `/api/escalation/matrix/bulk` | API Key | Bulk upsert tiers |
| POST | `/api/escalation/email/escalate` | API Key | Trigger escalation emails for overdue actions |

### Audit (3 endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/audit/` | API Key | List audit entries (limit=100 default) |
| POST | `/api/audit/` | API Key | Create audit entry (dedup by sn+level) |
| POST | `/api/audit/batch` | API Key | Batch create audit entries |

### Translate (1 endpoint)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/translate/` | API Key | Hindi/English translation via Gemini |

### Email Share (1 endpoint)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/email/share-insights` | API Key | Share AI insights via email + WhatsApp |

### Health (3 endpoints — no auth)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | None | API banner |
| GET | `/api/health` | None | Service status (Gemini, SMTP, CORS) |
| GET | `/api/ping` | None | Liveness probe |

---

## Services

### AI Service (services/ai_service.py — 163 lines)

Uses Google Gemini API for three operations:

#### 1. Extract Insights (full transcript)

```python
def extract_insights(transcript: str, meeting_type: str, plant: str, previous_actions: list):
    prompt = f"""Analyze this {meeting_type} meeting transcript from {plant}.
    Extract: action items, decisions made, risks identified, key points.
    Return JSON with: actions[], decisions[], risks[], keyPoints[]"""
    response = gemini_client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
    return parsed_json
```

#### 2. Analyze Paragraph (single paragraph)

```python
def analyze_paragraph(paragraph: str, meeting_type: str, source_lang: str):
    prompt = f"""Analyze this paragraph from a {meeting_type} meeting.
    Extract: action items, decisions, risks, key points.
    Source language: {source_lang}"""
    response = gemini_client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
    return parsed_json
```

#### 3. Translate Text

```python
def translate_text(text: str, source: str = "hi", target: str = "en"):
    prompt = f"Translate from {source} to {target}: {text}"
    response = gemini_client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
    return translated_text
```

### Email Service (services/email_service.py — 151 lines)

Uses SMTP (Gmail) for four email types:

| Email Type | Trigger | Content |
|-----------|---------|---------|
| **Escalation** | Action overdue | Action details + escalation level + target user |
| **Welcome** | New user created | Login credentials + setup instructions |
| **Action Status** | Manual send | Action status update to responsible person |
| **Insight Sharing** | Manual share | AI meeting insights to recipients |

**Deduplication:** In-memory dict `_escalation_sent` prevents re-sending within 4 hours.

```python
def send_escalation_email(action, level, target_user, target_email):
    # Build HTML email with action details
    # Send via SMTP with 30s timeout
    # Record in dedup cache
```

### WhatsApp Service (services/whatsapp_service.py — 49 lines)

Sends alerts via external WACRM gateway:

```python
def send_whatsapp_alert(phone: str, message: str):
    requests.post(settings.wacrm_alert_url, json={"phone": phone, "message": message}, timeout=15)
```

---

## Escalation System

### How It Works

1. **Trigger:** Action create/update/bulk → `_bg_check_escalations` background task
2. **Query:** Load all active escalation tiers + all users + all open overdue actions
3. **Match:** For each overdue action, find matching tier by:
   - Responsible person matches `from_user` or `from_role`
   - Overdue hours exceed tier threshold
   - Priority matches tier's priority list
4. **Notify:** Send email to `target_user` via SMTP
5. **Audit:** Create audit entry with deduplication (sn + level)

### Escalation Tiers (auto-seeded on first run)

| Level | Overdue | Priorities | Notification |
|-------|---------|------------|--------------|
| L1 | 24 hours | CRITICAL, WARNING, NORMAL | Email to direct superior |
| L2 | 72 hours | CRITICAL, WARNING | Email to skip-level superior |
| L3 | 168 hours (7 days) | CRITICAL | Email to top management (MD) |

### Background Task Pattern

```python
def _bg_check_escalations():
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(_run())
    finally:
        loop.close()

# Triggered via BackgroundTasks on every action write
BackgroundTasks().add_task(_bg_check_escalations)
```

---

## Bulk Upsert Pattern

All `/bulk` endpoints follow the same pattern:

```python
@router.post("/bulk")
async def bulk_upsert(rows: List[ModelCreate], db: AsyncSession = Depends(get_db)):
    results = []
    for data in rows:
        existing = await db.execute(select(Model).where(Model.id == data.id))
        obj = existing.scalar_one_or_none()
        if obj:
            for k, v in data.dict(exclude_unset=True).items():
                setattr(obj, k, v)
        else:
            obj = Model(**data.dict())
            db.add(obj)
        results.append(obj)
    await db.commit()
    return results
```

**Note:** Does N individual SELECT queries (one per row). Not optimized for large batches.

---

## Schema Migration Strategy

No Alembic — uses ad-hoc `ALTER TABLE` in `migrate_schema()`:

```python
def migrate_schema(conn):
    inspector = inspect(conn)
    existing_tables = set(inspector.get_table_names())

    # 1. Create tables via Base.metadata.create_all (if not exists)

    # 2. Add missing columns via ALTER TABLE
    if "escalation_matrix" in existing_tables:
        columns = {c["name"] for c in inspector.get_columns("escalation_matrix")}
        if "from_user" not in columns:
            conn.execute(text("ALTER TABLE escalation_matrix ADD COLUMN from_user VARCHAR(100)"))
        # ... more columns

    if "users" in existing_tables:
        user_cols = {c["name"] for c in inspector.get_columns("users")}
        if "master_access" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN master_access BOOLEAN DEFAULT FALSE"))

    if "meetings" in existing_tables:
        mtg_cols = {c["name"] for c in inspector.get_columns("meetings")}
        if "guidelines" not in mtg_cols:
            conn.execute(text("ALTER TABLE meetings ADD COLUMN guidelines JSONB DEFAULT '[]'::jsonb"))

    # 3. Seed default data if empty
    count = conn.execute(text("SELECT COUNT(*) FROM escalation_matrix")).scalar()
    if count == 0:
        # Build escalation tiers from user superior chains
        # Insert default tiers
```

---

## Known Backend Issues

| Issue | Severity | Location | Impact |
|-------|----------|----------|--------|
| Single uvicorn worker | Critical | Procfile | CPU bottleneck |
| DB pool max 15 connections | Critical | database.py:7-8 | Connection exhaustion |
| No pagination on list endpoints | High | All routers | Memory growth |
| Synchronous blocking calls | High | email_service.py, password.py, ai_service.py | Event loop blocked |
| Nested event loop in background tasks | High | actions.py:15-30 | Event loop corruption risk |
| Bulk upsert does N individual SELECTs | Medium | All /bulk routers | N+1 query overhead |
| No rate limiting | Medium | config.py | DoS vulnerability |
| In-memory dedup cache unbounded | Medium | email_service.py:10 | Memory leak |
| No Alembic migrations | Medium | main.py | Schema drift risk |
| JWT expiry too long (480 min) | Low | config.py | Security risk |

---

## Deployment

### Render (Backend)

```bash
# Procfile
web: uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}

# start.sh (local dev)
cd backend && exec venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Local Development

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # Edit with your values
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### API Docs

- Swagger UI: https://mcs-action-is-1.onrender.com/docs
- ReDoc: https://mcs-action-is-1.onrender.com/redoc

---

## Summary Statistics

| Category | Count |
|----------|-------|
| Total Python files | 37 |
| Total backend lines | 3,215 |
| API endpoints | 72 |
| Database models | 15 |
| Database tables | 15 |
| Database columns | 143 |
| Database relationships | 28 |
| Database indexes | 14 |
| Database enums | 3 |
| Database views | 2 |
| Pydantic schemas | 25 |
| Environment variables | 18 |
| Python dependencies | 17 |
| Services | 4 (AI, Email, WhatsApp, Password) |
| Middleware | 3 (API Key, JWT, CORS) |
