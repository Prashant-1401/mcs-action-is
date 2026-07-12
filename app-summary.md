# MCS (Management Control System) — Complete Application Summary

## 1. Project Identity

| Field | Value |
|-------|-------|
| **Name** | MCS — Management Control System |
| **Tagline** | Decentralized Work Management Platform |
| **Brands** | Adroit Industries × Signet Industries |
| **Version** | 0.0.0 |
| **Repository** | https://github.com/Prashant-1401/mcs-action-is |
| **Frontend** | https://mcs-control-management.vercel.app |
| **Backend** | https://mcs-action-is-1.onrender.com |

---

## 2. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | React + Vite | React 19.2.5, Vite 6.2.0 |
| **Backend** | Python FastAPI | >=0.115.0 |
| **Database** | PostgreSQL (async) | asyncpg >=0.30.0 |
| **ORM** | SQLAlchemy 2.0 (async) | >=2.0.0 |
| **Auth** | JWT (PyJWT) + bcrypt + API key | PyJWT >=2.8.0, bcrypt 4.0.1 |
| **AI** | Google Gemini | gemini-2.5-flash-lite |
| **Email** | SMTP (Gmail) | smtplib |
| **WhatsApp** | External WACRM gateway | requests |
| **Deployment** | Render (backend) + Vercel (frontend) | — |

---

## 3. Codebase Metrics

| Metric | Count |
|--------|-------|
| **Frontend lines** | 5,921 (single `App.jsx`) |
| **Backend lines** | 3,215 (across 37 Python files) |
| **Total lines of code** | **9,136** |
| **Git commits** | 20+ on main branch |
| **Test files** | 0 (pytest in requirements but no tests written) |

---

## 4. Frontend Architecture

### 4.1 Component Inventory (48 components)

| Category | Count | Examples |
|----------|-------|---------|
| **Page components** | 6 | HomePage, WorkPage, ActionsPage, DashboardPage, EscalationsPage, MasterPage |
| **Feature components** | 14 | MeetingRoom, StagingArea, ActionDetailPanel, ProjectCharterModal, etc. |
| **Modal/Panel components** | 11 | SupportModal, AddMeetingModal, AddActionPanel, MeetingPlanPanel, etc. |
| **Micro/Primitive** | 12 | SBadge, PBadge, Avatar, Lbl, HR, Spin, Empty, Chip, KPICard, PageHeader, Sparkbar, MultiUserSelect |
| **Root/HOC** | 2 | App, ErrorBoundary |
| **Inline arrows** | 3 | MeetingPopup, InlineField (×2) |

### 4.2 React Hooks Usage

| Hook Type | Count |
|-----------|-------|
| `useState` | **130** |
| `useEffect` | **22** |
| `useCallback` | **18** |
| `useRef` | **24** |
| Custom hooks | **4** (usePostgresDB, useEscClose, useNotifications, useAPIBridge) |

### 4.3 Event Handlers

| Type | Count |
|------|-------|
| `onClick` | 239 |
| `onChange` | 116 |
| `onMouseEnter/Leave` | 15 |
| `onKeyDown` | 6 |
| **Total** | **378** |

### 4.4 Styling

| Metric | Count |
|--------|-------|
| Inline `style={{}}` objects | **1,275** |
| Design token references | **~913** |
| Design tokens defined | 14 (`T.navy`, `T.red`, `T.amber`, `T.green`, `T.slate`, `T.border`, `T.bg`, `T.text`, `T.text2`, `T.navyD`, `T.redL`, `T.amberL`, `T.greenL`, `T.white`) |

### 4.5 API Calls

| Type | Count |
|------|-------|
| Wrapper calls (apiGet/apiPost/apiPatch/apiDelete/apiCreate/apiUpdate/apiRemove) | 50 |
| Direct `fetch()` calls | 6 |
| **Total API invocations** | **56** |

### 4.6 Navigation

| Page ID | Label | Component |
|---------|-------|-----------|
| 0 | Home | `HomePage` |
| 1 | Work | `WorkPage` (→ `MeetingRoom` sub-view) |
| 2 | Actions | `ActionsPage` (4 view modes: Table, Board, Kanban, Timeline) |
| 3 | Dashboard | `DashboardPage` |
| 4 | Escalations | `EscalationsPage` |
| 99 | Master Setup | `MasterPage` (Admin only) |

---

## 5. Backend Architecture

### 5.1 API Endpoints (72 total)

| Router | Endpoints | Methods |
|--------|-----------|---------|
| `actions.py` | 9 | GET×2, POST×3, PATCH, DELETE, GET messages, POST messages |
| `meetings.py` | 10 | GET×2, POST×3, PATCH×2, DELETE×2, GET presets |
| `meetings_ai.py` | 2 | POST×2 |
| `escalation.py` | 6 | GET, POST×3, PATCH, DELETE |
| `departments.py` | 6 | GET×2, POST, PATCH, DELETE, POST bulk |
| `users.py` | 6 | GET×2, POST, PATCH, DELETE, POST bulk |
| `plants.py` | 6 | GET×2, POST, PATCH, DELETE, POST bulk |
| `machines.py` | 5 | GET, POST, PATCH, DELETE, POST bulk |
| `reasons.py` | 5 | GET, POST, PATCH, DELETE, POST bulk |
| `roles.py` | 5 | GET, POST, PATCH, DELETE, POST bulk |
| `projects.py` | 5 | GET×2, POST, PATCH, DELETE |
| `audit.py` | 3 | GET, POST, POST batch |
| `auth.py` | 2 | POST login, POST master-login |
| `email_share.py` | 1 | POST share-insights |
| `translate.py` | 1 | POST translate |
| **Total** | **72** | GET: 16, POST: 36, PATCH: 12, DELETE: 8 |

### 5.2 Database Models (15 models, 143 columns, 28 relationships)

| Model | Table | Columns | Relationships |
|-------|-------|---------|---------------|
| `Plant` | plants | 4 | 5 |
| `Department` | departments | 5 | 4 |
| `Role` | roles | 3 | 0 |
| `User` | users | 14 | 2 |
| `Machine` | machines | 7 | 3 |
| `Reason` | reasons | 3 | 0 |
| `Project` | projects | 17 | 5 |
| `ProjectMilestone` | project_milestones | 6 | 1 |
| `MeetingPreset` | meeting_presets | 3 | 0 |
| `Meeting` | meetings | 18 | 2 |
| `EscalationMatrix` | escalation_matrix | 15 | 0 |
| `EscalationPriority` | escalation_priorities | 2 | 0 |
| `Action` | actions | 30 | 5 |
| `ActionMessage` | action_messages | 8 | 1 |
| `Audit` | audit | 8 | 0 |

### 5.3 Database Tables (15 tables + 3 enums + 2 views)

**Enums:** `action_status`, `action_priority`, `project_status`
**Views:** `v_actions`, `v_audit`
**Indexes:** 14 indexes defined in SQL schema

### 5.4 Services

| Service | Lines | Purpose |
|---------|-------|---------|
| `ai_service.py` | 163 | Gemini AI: extract_insights, analyze_paragraph, translate_text |
| `email_service.py` | 151 | SMTP: escalation emails, welcome emails, action sharing |
| `whatsapp_service.py` | 49 | WhatsApp alerts via external gateway |
| `password.py` | 12 | bcrypt hash + verify |

### 5.5 Middleware

| Middleware | Purpose |
|-----------|---------|
| `require_api_key` | Validates `x-api-key` header |
| `require_auth` | Validates JWT Bearer token |
| `CORSMiddleware` | Cross-origin requests |

---

## 6. Configuration

### 6.1 Frontend Environment

| Variable | Value |
|----------|-------|
| `VITE_API_BASE_URL` | `https://mcs-action-is-1.onrender.com` |
| `VITE_API_KEY` | `0114cccb4238d3faa118e312dbe75abe` |

### 6.2 Backend Environment (18 settings)

| Setting | Default |
|---------|---------|
| `DATABASE_URL` | `postgresql+asyncpg://...` |
| `GEMINI_API_KEY` | (from env) |
| `GEMINI_MODEL` | `gemini-2.5-flash-lite` |
| `SECRET_KEY` | (from env) |
| `JWT_ALGORITHM` | `HS256` |
| `JWT_EXPIRE_MINUTES` | `480` (8 hours) |
| `ALLOWED_ORIGINS` | `*` |
| `API_KEY` | (from env) |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` / `SMTP_PASSWORD` | (from env) |
| `ADMIN_EMAIL` | `admin@adroit.in` |
| `TEAM_EMAIL` | `team@adroit.in` |
| `WACRM_ALERT_URL` | (from env) |
| `FRONTEND_URL` | Vercel URL |
| `MASTER_USER` / `MASTER_PASSWORD` | (from env) |

### 6.3 Database Connection Pool

| Setting | Value |
|---------|-------|
| `pool_size` | 5 |
| `max_overflow` | 10 |
| `pool_recycle` | 300s |
| `pool_pre_ping` | True |
| `command_timeout` | 15s |

---

## 7. Business Logic

### 7.1 Role Hierarchy (8 levels)

| Level | Role | Permissions |
|-------|------|-------------|
| 1 | Guest User | View only |
| 2 | Operator | Basic action management |
| 3 | Supervisor | Action assignment |
| 4 | Shift Engineer | Department actions |
| 5 | HOD | Edit meetings, manage department |
| 6 | Plant Head | Plant-wide management |
| 7 | MD | Multi-plant, escalation management |
| 8 | Admin | Full access, Master Setup |

### 7.2 Core Features

| Feature | Description |
|---------|-------------|
| **Action Tracking** | Create, assign, track, escalate action items from meetings |
| **Meeting Management** | Schedule, run, and record meeting sessions |
| **AI Meeting Analysis** | Gemini-powered transcript analysis → auto-extract actions/decisions/risks |
| **Escalation System** | 3-level auto-escalation (24h → 72h → 7d) with email alerts |
| **Project Tracking** | Milestones, budgets, team management |
| **Dashboard Analytics** | KPIs, charts, plant-scoped analytics |
| **Master Setup** | Admin panel for plants, departments, users, machines, roles |
| **Real-time Translation** | Hindi↔English via Gemini |
| **Email Integration** | Action status emails, escalation alerts, insight sharing |
| **WhatsApp Alerts** | Escalation notifications via WACRM gateway |

### 7.3 Data Flow

```
Frontend (React SPA)
  ↓ 12 parallel API calls on login
  ↓ denormKeys (snake_case → camelCase)
  ↓ resolveForeignKeys (ID → display name)
  ↓ useState (React state)

User Action
  ↓ Optimistic local update
  ↓ normKeys (camelCase → snake_case)
  ↓ resolveRecordIds (display name → FK ID)
  ↓ apiCreate/apiUpdate/apiRemove (fire-and-forget)

Backend (FastAPI)
  ↓ API key / JWT auth
  ↓ Pydantic schema validation
  ↓ SQLAlchemy async query
  ↓ PostgreSQL (asyncpg)
```

---

## 8. Deployment

### 8.1 Frontend (Vercel)

| Aspect | Value |
|--------|-------|
| Build tool | Vite 6.2.0 |
| Bundle size | 473 KB (140 KB gzipped) |
| Output | `dist/` folder |
| Auto-deploy | On push to main |

### 8.2 Backend (Render)

| Aspect | Value |
|--------|-------|
| Server | Uvicorn (1 worker) |
| Port | `$PORT` (Render assigned) |
| Procfile | `web: uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Auto-deploy | On push to main |

### 8.3 Database (PostgreSQL)

| Aspect | Value |
|--------|-------|
| Driver | asyncpg (async) |
| Schema management | Auto `create_all` + ad-hoc `migrate_schema()` |
| Tables | 15 |
| Enums | 3 |
| Views | 2 |
| Indexes | 14 |

---

## 9. Known Issues & Scalability

### 9.1 Current Limitations

| Issue | Severity | Impact |
|-------|----------|--------|
| Single-file monolith (5,921 lines) | High | Hard to maintain, no code splitting |
| 130 useState hooks in one file | High | Re-render cascade |
| No React.memo / useMemo | High | Unnecessary re-renders |
| 1,275 inline style objects | Medium | GC pressure, no style reuse |
| All data loaded at once (12 API calls) | High | Slow login, wasted bandwidth |
| No pagination on list endpoints | High | Memory growth with data |
| DB pool max 15 connections | Critical | Bottleneck at 50+ users |
| Single uvicorn worker | Critical | CPU bottleneck |
| Synchronous blocking calls (SMTP, bcrypt, Gemini) | High | Event loop blocking |
| No test files | High | No regression safety |
| No rate limiting | Medium | DoS vulnerability |

### 9.2 Scalability Capacity

| User Count | Status |
|------------|--------|
| 1-20 | Works well |
| 20-50 | Minor slowdowns |
| 50-100 | Needs pool/worker tuning |
| 100-300 | Needs pagination, async fixes |
| 300-500 | Needs architecture changes |
| 500+ | Not supported without major refactor |

---

## 10. File Structure

```
MCS ACTION IS/
├── .env                          # Frontend env (API URL + key)
├── index.html                    # Vite entry
├── package.json                  # NPM config
├── vite.config.js                # Vite config
├── App.jsx                       # Root-level copy (5,994 lines)
├── src/
│   ├── main.jsx                  # React entry point
│   ├── App.jsx                   # Main SPA (5,921 lines)
│   ├── App.css                   # Styles
│   └── index.css                 # Global CSS + design tokens
├── backend/
│   ├── Procfile                  # Render deployment
│   ├── start.sh                  # Local dev start
│   ├── requirements.txt          # Python dependencies
│   ├── .env.example              # Backend env template
│   ├── app/
│   │   ├── main.py               # FastAPI app + CORS + migration
│   │   ├── config.py             # Pydantic Settings (18 vars)
│   │   ├── database.py           # Async SQLAlchemy engine
│   │   ├── models/models.py      # 15 ORM models (240 lines)
│   │   ├── schemas/schemas.py    # 25 Pydantic schemas (404 lines)
│   │   ├── middleware/auth.py    # JWT + API key auth
│   │   ├── routers/              # 15 API routers (72 endpoints)
│   │   └── services/             # AI, email, WhatsApp, password
│   └── scripts/                  # Migration utilities
├── DB/
│   ├── mcs_db.sql                # Full SQL schema + seed data
│   └── Code.gs                   # Legacy Google Apps Script
├── public/                       # Static assets
└── dist/                         # Built frontend output
```

---

## 11. Dependencies

### 11.1 Frontend (NPM)

| Package | Version | Type |
|---------|---------|------|
| react | ^19.2.5 | Production |
| react-dom | ^19.2.5 | Production |
| puppeteer | ^24.42.0 | Production |
| vite | ^6.2.0 | Dev |
| @vitejs/plugin-react | ^4.3.4 | Dev |
| eslint | ^9.39.4 | Dev |
| eslint-plugin-react-hooks | ^7.1.1 | Dev |
| eslint-plugin-react-refresh | ^0.5.2 | Dev |
| @types/react | ^19.2.14 | Dev |
| @types/react-dom | ^19.2.3 | Dev |
| @eslint/js | ^9.39.4 | Dev |
| globals | ^17.5.0 | Dev |

### 11.2 Backend (pip)

| Package | Version | Purpose |
|---------|---------|---------|
| fastapi | >=0.115.0 | Web framework |
| uvicorn[standard] | >=0.34.0 | ASGI server |
| sqlalchemy[asyncio] | >=2.0.0 | ORM |
| asyncpg | >=0.30.0 | PostgreSQL driver |
| alembic | >=1.14.0 | Migrations (unused) |
| google-genai | >=1.0.0 | Gemini AI |
| python-dotenv | >=1.0.0 | Env vars |
| pydantic-settings | >=2.0.0 | Config |
| pyjwt[cryptography] | >=2.8.0 | JWT auth |
| passlib[bcrypt] | ==1.7.4 | Password hashing |
| bcrypt | ==4.0.1 | Password hashing |
| httpx | >=0.28.0 | HTTP client |
| psycopg2-binary | >=2.9.0 | PostgreSQL (sync) |
| pytest | >=8.0.0 | Testing (unused) |
| pytest-asyncio | >=0.24.0 | Async testing (unused) |
| python-multipart | >=0.0.7 | Form parsing |
| requests | >=2.31.0 | HTTP client |

---

## 12. Git History (Recent 20 Commits)

```
1bf3899 fix: defensive guards for milestones/team in ProjectCharterModal
7b72c13 fix: meeting page crashes and data persistence issues
707cfb9 fix: missing mtgPresets/machines props to WorkPage
e2c7d8f fix: projects/meetings not visible (plantId vs plant name mismatch)
75f10eb fix: rebuild escalation matrix with user-based tiers
6e0429a fix: compound responsible name splitting
71cad31 fix: isAssignee for compound names
71e5ff2 feat: user-based escalation matrix
ee80956 fix: userNameLower crash in ActionsPage
99ec400 fix: bcrypt compat, DB pool, migration safety
4f91daf fix: don't require password when editing user
2ab0472 fix: point frontend to Render backend URL
46c9230 fix: Master Setup access, DB models, escalation seed
a6163d9 feat: email actions to responsible person
67e818b fix: Homepage shows only user's own actions
4b5d3f3 fix: non-admin users see all plant-scoped actions
eb4cefe fix: complete responsible name matching overhaul
b43d46e fix: smart name matching for responsible fields
368e93e fix: non-admin scoping for Homepage & Actions page
93a4192 fix: show all actions on Home page for Admin/MD/Plant Head
```

---

## 13. Summary Statistics

| Category | Count |
|----------|-------|
| Total source files | 42 |
| Total lines of code | 9,136 |
| React components | 48 |
| React hooks (total) | 194 |
| API endpoints | 72 |
| Database models | 15 |
| Database columns | 143 |
| Database relationships | 28 |
| Database tables | 15 |
| Design tokens | 14 |
| Event handlers | 378 |
| Inline styles | 1,275 |
| Environment variables | 20 |
| NPM dependencies | 12 |
| Python dependencies | 17 |
| Git commits | 20+ |
| Test files | 0 |
