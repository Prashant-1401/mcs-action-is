# MCS Application — Industry-Standard Upgrade Plan

> **App:** Management Control System (MCS) / Industry Management System (IMS)
> **Stack:** FastAPI (Python) · React 19 + Vite · Google GenAI · Google Sheets DB · Render Hosting
> **Prepared:** June 2026

---

## 📑 Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Assessment](#2-current-state-assessment)
3. [Upgrade Roadmap](#3-upgrade-roadmap)
   - [Phase 1 — Security & Hardening](#phase-1--security--hardening-week-12)
   - [Phase 2 — Database Migration](#phase-2--database-migration-week-34)
   - [Phase 3 — Backend Architecture](#phase-3--backend-architecture-week-56)
   - [Phase 4 — Frontend Architecture](#phase-4--frontend-architecture-week-78)
   - [Phase 5 — Observability & DevOps](#phase-5--observability--devops-week-910)
   - [Phase 6 — AI & Intelligence Layer](#phase-6--ai--intelligence-layer-week-1112)
4. [Detailed Change Specifications](#4-detailed-change-specifications)
5. [Risk Register](#5-risk-register)
6. [Dependency Upgrade Table](#6-dependency-upgrade-table)
7. [Definition of Done](#7-definition-of-done)

---

## 1. Executive Summary

The MCS application is a functional MVP with solid AI-powered core logic. To graduate it to **industry-standard production software**, the following critical gaps must be closed:

| Domain | Current State | Target State |
|---|---|---|
| **Database** | Google Sheets (CSV reads) | PostgreSQL with proper ORM |
| **Auth** | No authentication layer | JWT + RBAC with role enforcement |
| **API Security** | CORS `allow_origins=["*"]` | Scoped CORS + rate limiting |
| **Error Handling** | `except: pass` patterns | Structured error handling + Sentry |
| **Tests** | None | ≥80% backend coverage, E2E tests |
| **CI/CD** | Manual deploy | GitHub Actions pipeline |
| **Observability** | `print()` logs | Structured logging + APM |
| **Secrets** | `.env` in repo dir | Vault / managed secrets |

---

## 2. Current State Assessment

### 2.1 Security Vulnerabilities

| Severity | Issue | Location |
|---|---|---|
| 🔴 Critical | `allow_origins=["*"]` with `allow_credentials=True` | `main.py:28` |
| 🔴 Critical | No authentication on any API endpoint | All routes |
| 🔴 Critical | `.env` file committed in `backend/` directory | `backend/.env` |
| 🟠 High | Google Apps Script URL publicly accessible (no token) | `Code.gs` |
| 🟠 High | `except: pass` silently swallows exceptions | `main.py:155-171` |
| 🟠 High | No input length/content validation on AI prompts | `main.py:181-203` |
| 🟡 Medium | No rate limiting — open to prompt injection abuse | All `/api/meetings/*` |
| 🟡 Medium | SMTP credentials in plain environment variables | `main.py:93-96` |

### 2.2 Architecture Weaknesses

- **Google Sheets as database** — no transactions, no referential integrity, no indexing, CSV polling is fragile and slow
- **Monolithic `App.jsx`** — 388KB single file, not scalable, impossible to test
- **No caching layer** — every dashboard load re-fetches entire sheets via CSV
- **Synchronous AI calls** — blocks request thread, no timeout enforcement
- **No background job queue** — escalation emails run inline on HTTP request
- **No API versioning** — breaking changes will break all clients simultaneously

### 2.3 Operational Gaps

- Zero automated tests
- No health check depth (only checks env vars, not actual service connectivity)
- No structured logging or log aggregation
- No deployment rollback strategy
- No database backups (Google Sheets has no automated backup)
- No SLA or uptime monitoring

---

## 3. Upgrade Roadmap

### Phase 1 — Security & Hardening (Week 1–2)

**Goal:** Close all critical/high vulnerabilities. Zero production-ready code ships without this phase.

#### 1.1 Fix CORS Configuration

```python
# BEFORE (main.py:26-32) — INSECURE
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    ...
)

# AFTER — SECURE
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH"],
    allow_headers=["Authorization", "Content-Type"],
)
```

#### 1.2 Add JWT Authentication

- Install: `python-jose[cryptography]`, `passlib[bcrypt]`
- Implement `/api/auth/login` → returns signed JWT (HS256, 8h expiry)
- Add `Depends(get_current_user)` to all protected routes
- Store user roles in JWT claims, validate against DB on each request

```python
# New auth dependency
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

async def get_current_user(token: str = Depends(oauth2_scheme)) -> UserInDB:
    credentials_exception = HTTPException(status_code=401, detail="Could not validate credentials")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    return get_user(username)
```

#### 1.3 Rotate & Vault Secrets

- Add `backend/.env` to `.gitignore` immediately
- Migrate all secrets to **Render Environment Groups** (already using Render)
- For local dev: use `direnv` + `.envrc` (gitignored)
- Document all required env vars in `.env.example`

#### 1.4 Add Rate Limiting

```python
# Install: slowapi
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

@app.post("/api/meetings/analyze-paragraph")
@limiter.limit("30/minute")
async def analyze_paragraph(request: Request, req: ParagraphAnalysisReq):
    ...
```

#### 1.5 Input Validation & Sanitization

```python
class ParagraphAnalysisReq(BaseModel):
    paragraph: str = Field(..., min_length=3, max_length=5000)
    meeting_type: str = Field(..., pattern=r'^[a-zA-Z0-9 _-]+$')
    source_lang: str = Field(default="en", pattern=r'^(en|hi|mr|gu|cg)$')
```

#### 1.6 Secure Google Apps Script

- Add a secret `X-Script-Token` header check in `Code.gs`
- Validate token server-side before processing any mutation

---

### Phase 2 — Database Migration (Week 3–4)

**Goal:** Replace Google Sheets with PostgreSQL for ACID compliance, performance, and real queries.

#### 2.1 Why PostgreSQL

| Feature | Google Sheets | PostgreSQL |
|---|---|---|
| Transactions | ❌ | ✅ |
| Foreign keys | ❌ | ✅ |
| Indexing | ❌ | ✅ |
| Full-text search | ❌ | ✅ |
| Concurrent writes | ❌ (race conditions) | ✅ |
| Backup/restore | Manual | pg_dump / continuous WAL |
| Query complexity | Limited | Unlimited SQL |

#### 2.2 ORM Setup with SQLAlchemy + Alembic

```bash
pip install sqlalchemy[asyncio] asyncpg alembic psycopg2-binary
```

```python
# models.py — Define all tables
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
import uuid
from datetime import datetime

class Base(DeclarativeBase): pass

class Action(Base):
    __tablename__ = "actions"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    plant: Mapped[str] = mapped_column(index=True)
    dept: Mapped[str] = mapped_column(index=True)
    machine: Mapped[str]
    action_text: Mapped[str]
    allocated_to: Mapped[str] = mapped_column(index=True)
    allocated_by: Mapped[str]
    date_of_action: Mapped[datetime]
    due_date: Mapped[datetime] = mapped_column(index=True)
    status: Mapped[str] = mapped_column(default="IN PROCESS", index=True)
    revision_history: Mapped[list] = mapped_column(type_=JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(onupdate=datetime.utcnow)

class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(unique=True, index=True)
    hashed_password: Mapped[str]
    name: Mapped[str]
    role: Mapped[str]  # "admin" | "master" | "om"
    plant: Mapped[str]
    dept: Mapped[str]
    phone: Mapped[str | None]
    email: Mapped[str | None]
    is_active: Mapped[bool] = mapped_column(default=True)
```

#### 2.3 Migration Strategy

```bash
# Initialize migrations
alembic init alembic
alembic revision --autogenerate -m "initial_schema"
alembic upgrade head
```

**Data migration script:**
```python
# scripts/migrate_sheets_to_pg.py
# 1. Fetch all rows from Google Sheets CSV
# 2. Validate and transform each row
# 3. Insert into PostgreSQL via SQLAlchemy
# 4. Verify row counts match
# 5. Run in dry-run mode first
```

#### 2.4 Free/Low-Cost PostgreSQL Options

| Provider | Free Tier | Notes |
|---|---|---|
| **Render PostgreSQL** | 1 GB free | Native Render integration |
| **Supabase** | 500 MB free | REST API included |
| **Neon** | 0.5 GB free | Serverless, branching support |
| **Railway** | $5/mo hobby | Simple deploy |

**Recommendation:** Use **Render PostgreSQL** — already on Render, one-click connect.

#### 2.5 Keep Google Sheets as Read-Only Reporting Layer (Optional)

Use a nightly sync job (Celery beat or GitHub Actions cron) to export PG data → Google Sheets for stakeholder dashboards that already use Sheets.

---

### Phase 3 — Backend Architecture (Week 5–6)

**Goal:** Modular, async, testable, production-grade FastAPI service.

#### 3.1 Project Structure Refactor

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # App factory only
│   ├── config.py            # Pydantic settings
│   ├── database.py          # DB session management
│   ├── models/
│   │   ├── action.py
│   │   ├── user.py
│   │   └── plant.py
│   ├── schemas/             # Pydantic request/response models
│   │   ├── action.py
│   │   └── user.py
│   ├── routers/
│   │   ├── auth.py
│   │   ├── meetings.py
│   │   ├── actions.py
│   │   ├── escalation.py
│   │   └── translate.py
│   ├── services/
│   │   ├── ai_service.py    # Gemini + fallback logic
│   │   ├── email_service.py
│   │   └── whatsapp_service.py
│   ├── workers/             # Background job handlers
│   │   └── escalation_worker.py
│   └── middleware/
│       ├── auth.py
│       └── logging.py
├── alembic/
├── tests/
│   ├── unit/
│   └── integration/
├── requirements.txt
└── Procfile
```

#### 3.2 Async Database Sessions

```python
# database.py
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

DATABASE_URL = os.environ["DATABASE_URL"].replace("postgresql://", "postgresql+asyncpg://")
engine = create_async_engine(DATABASE_URL, pool_size=10, max_overflow=20)

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSession(engine) as session:
        yield session
```

#### 3.3 Background Job Queue — Celery + Redis

Replace inline escalation email dispatch with async queue:

```bash
pip install celery redis
```

```python
# workers/escalation_worker.py
from celery import Celery

celery_app = Celery("mcs", broker=os.environ["REDIS_URL"])

@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_escalation_email(self, action_id: str, level: int):
    try:
        action = db.get_action(action_id)
        email_service.dispatch_escalation(action, level)
    except Exception as exc:
        raise self.retry(exc=exc)
```

#### 3.4 Structured Error Handling

```python
# Replace all `except: pass` with proper handlers
from fastapi import HTTPException
import logging

logger = logging.getLogger(__name__)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception", exc_info=exc, extra={"path": request.url.path})
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})
```

#### 3.5 API Versioning

```python
# Version all endpoints under /api/v1/
from fastapi import APIRouter

v1_router = APIRouter(prefix="/api/v1")
v1_router.include_router(meetings_router, prefix="/meetings", tags=["Meetings"])
v1_router.include_router(actions_router, prefix="/actions", tags=["Actions"])
app.include_router(v1_router)
```

#### 3.6 Pydantic Settings (Type-Safe Config)

```python
# config.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str
    gemini_api_key: str
    redis_url: str = "redis://localhost:6379"
    smtp_server: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_pass: str = ""
    secret_key: str
    allowed_origins: list[str] = ["http://localhost:5173"]
    
    class Config:
        env_file = ".env"

settings = Settings()
```

---

### Phase 4 — Frontend Architecture (Week 7–8)

**Goal:** Break monolithic `App.jsx` (388KB) into maintainable, testable components.

#### 4.1 Component Decomposition

```
src/
├── components/
│   ├── auth/
│   │   ├── LoginForm.jsx
│   │   └── ProtectedRoute.jsx
│   ├── dashboard/
│   │   ├── ActionTable.jsx
│   │   ├── ActionRow.jsx
│   │   └── StatusBadge.jsx
│   ├── meetings/
│   │   ├── SpeechCapture.jsx
│   │   ├── TranscriptPanel.jsx
│   │   └── StagingArea.jsx
│   ├── escalation/
│   │   └── EscalationTimeline.jsx
│   └── shared/
│       ├── Modal.jsx
│       ├── Toast.jsx
│       └── LoadingSpinner.jsx
├── hooks/
│   ├── useAuth.js
│   ├── useActions.js
│   └── useSpeechRecognition.js
├── services/
│   ├── api.js               # Axios instance with interceptors
│   ├── authService.js
│   └── actionService.js
├── store/
│   └── index.js             # Zustand or Redux Toolkit store
├── pages/
│   ├── Dashboard.jsx
│   ├── Meetings.jsx
│   └── Settings.jsx
└── App.jsx                  # Router + layout only
```

#### 4.2 State Management

Replace scattered `useState` calls with **Zustand** (lightweight) or **Redux Toolkit** (enterprise):

```js
// store/actionsStore.js — Zustand
import { create } from 'zustand'

export const useActionsStore = create((set, get) => ({
  actions: [],
  loading: false,
  filters: { status: 'all', plant: '', dept: '' },
  
  fetchActions: async () => {
    set({ loading: true })
    const data = await actionService.getAll(get().filters)
    set({ actions: data, loading: false })
  },
  
  updateAction: (id, updates) => set(state => ({
    actions: state.actions.map(a => a.id === id ? { ...a, ...updates } : a)
  }))
}))
```

#### 4.3 API Client with Auth Interceptor

```js
// services/api.js
import axios from 'axios'

const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL })

api.interceptors.request.use(config => {
  const token = localStorage.getItem('mcs_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('mcs_token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
```

#### 4.4 React Query for Data Fetching

Replace manual CSV polling with **TanStack Query**:

```js
// hooks/useActions.js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export function useActions(filters) {
  return useQuery({
    queryKey: ['actions', filters],
    queryFn: () => actionService.getAll(filters),
    staleTime: 30_000,     // 30s cache
    refetchInterval: 60_000 // poll every 60s
  })
}
```

#### 4.5 Add Testing

```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom @playwright/test
```

```js
// components/dashboard/ActionTable.test.jsx
import { render, screen } from '@testing-library/react'
import ActionTable from './ActionTable'

test('renders action rows', () => {
  const actions = [{ id: '1', action_text: 'Fix motor', status: 'IN PROCESS' }]
  render(<ActionTable actions={actions} />)
  expect(screen.getByText('Fix motor')).toBeInTheDocument()
})
```

---

### Phase 5 — Observability & DevOps (Week 9–10)

**Goal:** Full operational visibility and automated delivery pipeline.

#### 5.1 Structured Logging

```python
# Replace all print() with structured logger
import structlog

logger = structlog.get_logger()

# Usage
logger.info("ai.request.start", model=GEMINI_MODEL, prompt_len=len(prompt))
logger.error("ai.request.failed", model=GEMINI_MODEL, error=str(e))
logger.info("escalation.sent", action_id=action_id, level=level, channel="email")
```

Ship logs to **Datadog**, **Logtail**, or **Render's native log drain**.

#### 5.2 Error Tracking — Sentry

```python
# main.py
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration

sentry_sdk.init(
    dsn=os.environ["SENTRY_DSN"],
    integrations=[FastApiIntegration()],
    traces_sample_rate=0.1,  # 10% performance tracing
    environment=os.environ.get("ENV", "production"),
)
```

```js
// main.jsx — Frontend Sentry
import * as Sentry from "@sentry/react"
Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN, tracesSampleRate: 0.1 })
```

#### 5.3 CI/CD Pipeline — GitHub Actions

```yaml
# .github/workflows/ci.yml
name: CI Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  backend-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install -r backend/requirements.txt
      - run: pytest backend/tests/ --cov=app --cov-report=xml
      - uses: codecov/codecov-action@v4

  frontend-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run lint
      - run: npm run test

  deploy:
    needs: [backend-test, frontend-test]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to Render
        uses: johnbeynon/render-deploy-action@v0.0.8
        with:
          service-id: ${{ secrets.RENDER_SERVICE_ID }}
          api-key: ${{ secrets.RENDER_API_KEY }}
```

#### 5.4 Enhanced Health Checks

```python
@app.get("/api/health/deep")
async def deep_health(db: AsyncSession = Depends(get_db)):
    checks = {}
    
    # DB check
    try:
        await db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as e:
        checks["database"] = f"error: {e}"
    
    # Gemini check
    try:
        gemini_client.models.list()
        checks["gemini"] = "ok"
    except Exception as e:
        checks["gemini"] = f"error: {e}"
    
    # Redis check
    try:
        redis_client.ping()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = f"error: {e}"
    
    is_healthy = all(v == "ok" for v in checks.values())
    return JSONResponse(
        status_code=200 if is_healthy else 503,
        content={"status": "healthy" if is_healthy else "degraded", "checks": checks}
    )
```

#### 5.5 Uptime Monitoring

- **UptimeRobot** (free) — ping `/api/health` every 5 min, alert on failure
- **BetterStack** — real-time incident management
- Configure Render native alerts for restart loops

---

### Phase 6 — AI & Intelligence Layer (Week 11–12)

**Goal:** Make the AI layer robust, auditable, and cost-controlled.

#### 6.1 Prompt Management

Move all prompts out of route handlers into versioned prompt templates:

```python
# services/prompts.py
EXTRACT_INSIGHTS_PROMPT = """
You are an AI meeting assistant for an industrial manufacturing facility.
Analyze the transcript and produce a structured action log.
...
Return ONLY valid JSON matching this exact schema:
{schema}

TRANSCRIPT:
{transcript}
"""

def build_extract_insights_prompt(transcript: str, plant: str, previous_actions: list) -> str:
    schema = json.dumps(INSIGHTS_SCHEMA, indent=2)
    return EXTRACT_INSIGHTS_PROMPT.format(schema=schema, transcript=transcript, ...)
```

#### 6.2 AI Response Validation with Pydantic

```python
from pydantic import BaseModel, field_validator

class AIAction(BaseModel):
    text: str
    responsible: str = ""
    due: str
    section: str = ""
    priority: Literal["CRITICAL", "WARNING", "NORMAL"] = "NORMAL"
    remarks: str = ""
    is_update: bool = False
    
    @field_validator("due")
    @classmethod
    def validate_due_date(cls, v):
        datetime.strptime(v, "%Y-%m-%d")
        return v

class AIInsightsResponse(BaseModel):
    topics: list[dict]
    actions: list[AIAction]
```

#### 6.3 AI Cost Monitoring & Caching

```python
# Cache identical prompts for 5 minutes (prevents duplicate charges)
from functools import lru_cache
import hashlib

@lru_cache(maxsize=100)
def cached_gemini_generate(prompt_hash: str, prompt: str) -> str:
    return gemini_generate(prompt)

def get_cached_response(prompt: str) -> str:
    prompt_hash = hashlib.sha256(prompt.encode()).hexdigest()
    return cached_gemini_generate(prompt_hash, prompt)
```

Track token usage per request and alert on budget threshold via Gemini API usage dashboard.

#### 6.4 Audio Processing Upgrade

Current: Browser Web Speech API (no recording, no multilingual confidence scores)

Target: **Google Cloud Speech-to-Text v2**
- Stores audio recordings for compliance/audit trail
- Higher accuracy for Hinglish/mixed language
- Word-level timestamps
- Speaker diarization (who said what)

```python
# New endpoint
@app.post("/api/meetings/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    from google.cloud import speech
    client = speech.SpeechClient()
    audio_content = await file.read()
    audio = speech.RecognitionAudio(content=audio_content)
    config = speech.RecognitionConfig(
        encoding=speech.RecognitionConfig.AudioEncoding.WEBM_OPUS,
        sample_rate_hertz=48000,
        language_code="hi-IN",
        alternative_language_codes=["en-IN"],
    )
    response = client.recognize(config=config, audio=audio)
    return {"transcript": " ".join(r.alternatives[0].transcript for r in response.results)}
```

#### 6.5 AI Audit Trail

Log every AI call with inputs, outputs, model used, latency, and token count to DB for compliance and debugging:

```python
class AICallLog(Base):
    __tablename__ = "ai_call_logs"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    endpoint: Mapped[str]
    model: Mapped[str]
    prompt_hash: Mapped[str]
    prompt_tokens: Mapped[int | None]
    response_tokens: Mapped[int | None]
    latency_ms: Mapped[int]
    success: Mapped[bool]
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
```

---

## 4. Detailed Change Specifications

### Backend Files

| File | Change | Priority |
|---|---|---|
| `main.py` | Split into `app/routers/`, `app/services/`, `app/models/` | 🔴 High |
| `main.py:28` | Fix CORS wildcard → scoped origins | 🔴 Critical |
| `email_escalation.py` | Move to `app/services/email_service.py` + async | 🟠 High |
| `requirements.txt` | Add: `sqlalchemy`, `alembic`, `asyncpg`, `redis`, `celery`, `pydantic-settings`, `structlog`, `sentry-sdk`, `slowapi`, `python-jose`, `passlib` | 🟠 High |
| *(new)* `alembic/` | Database migration infrastructure | 🔴 High |
| *(new)* `tests/` | pytest test suite — ≥80% coverage | 🟠 High |
| `backend/.env` | Remove from repo, add to `.gitignore` | 🔴 Critical |

### Frontend Files

| File | Change | Priority |
|---|---|---|
| `src/App.jsx` | Decompose into `pages/` + `components/` | 🟠 High |
| *(new)* `src/services/api.js` | Centralized Axios client with auth interceptor | 🔴 Critical |
| *(new)* `src/store/` | Zustand state management | 🟠 High |
| *(new)* `src/hooks/useAuth.js` | JWT auth hook | 🔴 Critical |
| `package.json` | Add: `axios`, `zustand`, `@tanstack/react-query`, `@sentry/react` | 🟠 High |

### Infrastructure Files

| File | Change | Priority |
|---|---|---|
| `render.yaml` | Add PostgreSQL service, Redis service, Celery worker | 🟠 High |
| *(new)* `.github/workflows/ci.yml` | CI/CD pipeline | 🟠 High |
| *(new)* `.env.example` | Document all required env vars | 🟡 Medium |
| *(new)* `docker-compose.yml` | Local dev environment | 🟡 Medium |
| `.gitignore` | Ensure `.env`, `*.pem`, secrets are excluded | 🔴 Critical |

---

## 5. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Google Sheets data loss during migration | Low | Critical | Full CSV export + validation before cutover |
| Gemini API rate limits hit in prod | Medium | High | Implement caching + Redis queue + Ollama fallback |
| Auth breaks existing Google Apps Script integration | Medium | High | Keep GAS write endpoint, add token auth header |
| `App.jsx` decomposition introduces regressions | High | Medium | Feature-flag new components; keep old ones parallel |
| PostgreSQL cost on free tier fills up | Low | Medium | Implement data archiving after 12 months |
| Speech API accuracy drops on upgrade | Medium | Low | A/B test against Web Speech API before switch |

---

## 6. Dependency Upgrade Table

### Backend

| Package | Current | Target | Notes |
|---|---|---|---|
| `fastapi` | latest | `^0.115` | Pin version |
| `uvicorn` | latest | `^0.34` | Add `[standard]` extras |
| `pydantic` | v2 (via FastAPI) | `^2.x` | Use `pydantic-settings` for config |
| `google-genai` | `>=0.8.0` | `>=1.0.0` | Pin to stable major |
| `sqlalchemy` | ❌ | `^2.0` | async-first ORM |
| `alembic` | ❌ | `^1.14` | DB migrations |
| `asyncpg` | ❌ | `^0.30` | Async PostgreSQL driver |
| `celery` | ❌ | `^5.4` | Background job queue |
| `redis` | ❌ | `^5.2` | Celery broker + caching |
| `structlog` | ❌ | `^24.x` | Structured logging |
| `sentry-sdk` | ❌ | `^2.x` | Error tracking |
| `slowapi` | ❌ | `^0.1.9` | Rate limiting |
| `python-jose` | ❌ | `^3.3` | JWT tokens |
| `passlib` | ❌ | `^1.7` | Password hashing |

### Frontend

| Package | Current | Target | Notes |
|---|---|---|---|
| `react` | `^19.2.5` | `^19.x` | Stable, keep |
| `vite` | `^6.2.0` | `^6.x` | Stable, keep |
| `axios` | ❌ | `^1.7` | HTTP client |
| `zustand` | ❌ | `^5.x` | State management |
| `@tanstack/react-query` | ❌ | `^5.x` | Server state / data fetching |
| `@sentry/react` | ❌ | `^8.x` | Frontend error tracking |
| `react-router-dom` | ❌ | `^7.x` | Multi-page routing |
| `vitest` | ❌ | `^2.x` | Unit testing |
| `@playwright/test` | ❌ | `^1.x` | E2E testing |
| `puppeteer` | `^24.42.0` | Remove | Not used in app code |

---

## 7. Definition of Done

Each phase is considered complete when ALL items below pass:

### Security Checklist
- [ ] No wildcard CORS in production
- [ ] All endpoints require valid JWT (except `/api/auth/login`, `/api/health`)
- [ ] `.env` file not in git history (`git filter-branch` or `BFG Repo Cleaner`)
- [ ] All inputs validated with Pydantic `Field()` constraints
- [ ] Rate limits enforced on AI endpoints
- [ ] OWASP Top 10 checklist reviewed and addressed

### Quality Checklist
- [ ] Backend test coverage ≥ 80% (`pytest --cov`)
- [ ] Frontend unit tests for all components
- [ ] At least 3 Playwright E2E tests covering: login, create action, escalation flow
- [ ] ESLint passes with zero errors
- [ ] No `except: pass` anywhere in codebase

### Architecture Checklist
- [ ] `App.jsx` < 500 lines (decomposed into components)
- [ ] All DB operations via SQLAlchemy ORM (no raw CSV reads)
- [ ] All background jobs via Celery (no inline email sends on HTTP request)
- [ ] API versioned under `/api/v1/`
- [ ] Structured logs shipping to log aggregator

### Operational Checklist
- [ ] Deep health check endpoint returns DB + Gemini + Redis status
- [ ] Uptime monitor configured and alerting
- [ ] Sentry capturing errors in both backend and frontend
- [ ] GitHub Actions CI passes on every PR
- [ ] Automated deployment to Render on `main` merge
- [ ] Database backups enabled and tested (restore drill)
- [ ] `render.yaml` documents all required services and env vars

---

*Last updated: June 2026 | Maintainer: MCS Engineering Team*
