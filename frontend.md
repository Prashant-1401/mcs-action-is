# MCS Frontend — Complete Guide

## Overview

The entire frontend lives in a **single file**: `src/App.jsx` (5,921 lines). It is a React 19 SPA built with Vite 6, using inline CSS-in-JS (no Tailwind, no CSS modules, no styled-components). There is no React Router — navigation is managed via a `page` state variable.

**Deployed at:** https://mcs-control-management.vercel.app

---

## Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 19.2.5 | UI framework |
| Vite | 6.2.0 | Build tool + dev server |
| JavaScript (JSX) | ES2022 | No TypeScript |
| Puppeteer | 24.42.0 | PDF/screenshot generation |

---

## File Structure

```
src/
├── main.jsx          # Entry point — StrictMode + createRoot
├── App.jsx           # Entire application (5,921 lines)
├── App.css           # Component styles
└── index.css         # Global CSS + design tokens (light/dark mode)

index.html            # Vite HTML entry
vite.config.js        # Minimal Vite config (React plugin only)
.env                  # VITE_API_BASE_URL + VITE_API_KEY
```

---

## Architecture

### Single-File Monolith

Everything is in `src/App.jsx`:
- 48 React components
- 130 useState hooks
- 22 useEffect hooks
- 18 useCallback hooks
- 24 useRef hooks
- 4 custom hooks
- 378 event handlers
- 1,275 inline style objects
- 56 API calls
- All design tokens, CSS strings, and utility functions

### No Router

Navigation uses a numeric `page` state variable:

```js
const NAV = [
  { id: 0, icon: "🏠", label: "Home" },
  { id: 1, icon: "📋", label: "Work" },
  { id: 2, icon: "✅", label: "Actions" },
  { id: 3, icon: "📊", label: "Dashboard" },
  { id: 4, icon: "🚨", label: "Escalations" }
];
```

Page 99 is `MasterPage` (Admin only, not in nav bar).

---

## Component Tree

```
App (line 5705)
├── ErrorBoundary (line 5683)
├── Shell (line 1003) — sidebar + top bar
│   ├── Sidebar navigation
│   ├── Notifications dropdown
│   └── User profile menu
├── LoginPage (line 646) — when !user
├── HomePage (line 1203) — page 0
│   ├── KPI cards
│   ├── Upcoming meetings
│   ├── Subordinate overview
│   ├── MeetingPopup (line 1345)
│   └── ActionSidePanel (line 1125)
├── WorkPage (line 1806) — page 1
│   ├── Meeting list + Project list
│   ├── AddMeetingModal (line 2181)
│   ├── AddProjectModal (line 2030)
│   ├── MeetingPlanPanel (line 2071)
│   ├── ProjectCharterModal (line 1630)
│   └── MeetingRoom (line 2264) — when meeting active
│       ├── Live transcript (STT)
│       ├── AI insights panel
│       ├── Guidelines panel
│       ├── Action items list
│       └── StagingArea (line 3136) — post-meeting review
├── ActionsPage (line 3569) — page 2
│   ├── 4 view modes: Table, Board, Kanban, Timeline
│   ├── Filters (plant, status, priority, responsible)
│   ├── AddActionPanel (line 3093)
│   ├── ActionDetailPanel (line 3292)
│   └── Email action form
├── DashboardPage (line 4163) — page 3
│   ├── Plant-scoped KPIs
│   ├── Status/priority charts
│   ├── Overdue analysis
│   └── Team performance
├── EscalationsPage (line 4903) — page 4
│   ├── EscMatrixTab (line 4522)
│   ├── TeamPage (line 4788)
│   └── Escalation alerts
└── MasterPage (line 5113) — page 99 (Admin only)
    ├── Plant management
    ├── Department management
    ├── User management
    ├── Role management
    ├── Machine management
    ├── Reason management
    ├── Meeting presets
    └── Escalation matrix
```

---

## Design System

### Color Tokens (defined at line 502)

```js
const T = {
  navy: "#272262",    // Primary brand color
  navyD: "#1A1653",   // Dark navy
  amber: "#E69903",   // Warning/amber
  amberL: "#FEF3CD",  // Light amber background
  green: "#1E8449",   // Success
  greenL: "#D5F5E3",  // Light green background
  red: "#C0392B",     // Error/danger
  redL: "#FADBD8",    // Light red background
  slate: "#7F8C8D",   // Neutral gray
  border: "#E8E8F0",  // Border color
  bg: "#F5F5FB",      // Page background
  white: "#FFFFFF",   // White
  text: "#1A1532",    // Primary text
  text2: "#636E72"    // Secondary text
};
```

### Status Colors

```js
const SC = {
  "NOT STARTED": "#636E72",
  "IN PROCESS": "#272262",
  "COMPLETED": "#1E8449",
  "DROPPED": "#C0392B",
  "PENDING CONFIRM": "#E69903"
};
```

### Priority Colors

```js
const PC = {
  CRITICAL: "#C0392B",
  WARNING: "#E69903",
  NORMAL: "#272262"
};
```

### Fonts

- **Sora** — Headings, KPIs, nav labels
- **Inter** — Body text, tables, forms

Loaded via Google Fonts `@import` inside the CSS string (line 506).

---

## Custom Hooks

### 1. `usePostgresDB` (line 174)

The data layer. Fetches all 12 API endpoints on login via `Promise.all`:

```js
const [rawP, rawD, rawU, rawA, rawM, rawPr, rawEm, rawPs, rawMc, rawRs, rawAu, rawRo] = await Promise.all([
  apiGet("/api/plants/"),
  apiGet("/api/departments/"),
  apiGet("/api/users/"),
  apiGet("/api/actions/"),
  apiGet("/api/meetings/"),
  apiGet("/api/projects/"),
  apiGet("/api/escalation/matrix"),
  apiGet("/api/meetings/presets"),
  apiGet("/api/machines/"),
  apiGet("/api/reasons/"),
  apiGet("/api/audit/"),
  apiGet("/api/roles/")
]);
```

Each response goes through `denormKeys()` (snake→camel) and `resolveForeignKeys()` (ID→name).

Returns 12 state arrays + their setters.

### 2. `useEscClose` (line 635)

Closes modals/panels on Escape key press.

### 3. `useNotifications` (line 748)

Generates in-app notifications from audit trail and action changes. Iterates all actions × messages on every state change.

### 4. `useAPIBridge` (line 5635)

Exposes `window.MCS_API` for external integrations (iframes, postMessage).

---

## API Layer

### Base Configuration (lines 1-48)

```js
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "https://mcs-action-is-1.onrender.com").replace(/\/+$/, "");
const API_KEY = import.meta.env.VITE_API_KEY || "";
let AUTH_TOKEN = localStorage["mcs_token"] || "";
```

### HTTP Helpers

| Helper | Method | Purpose |
|--------|--------|---------|
| `apiFetch(path, options)` | Any | Core: prepends base URL, adds auth headers |
| `apiGet(path, params)` | GET | Builds query string from params |
| `apiPost(path, body)` | POST | Stringifies body as JSON |
| `apiPatch(path, body)` | PATCH | Stringifies body as JSON |
| `apiDelete(path)` | DELETE | No body |
| `apiCreate(resource, data)` | POST `/api/{resource}/` | Fire-and-forget create |
| `apiUpdate(resource, id, data)` | PATCH `/api/{resource}/{id}` | Fire-and-forget update |
| `apiRemove(resource, id)` | DELETE `/api/{resource}/{id}` | Fire-and-forget delete |

### Headers Sent

```js
{
  "Content-Type": "application/json",
  "x-api-key": API_KEY,
  "Authorization": "Bearer <token>"  // if logged in
}
```

### Data Transformation

**`denormKeys(obj)`** (line 50) — Applied to all GET responses:
- `plant_id` → `plantId`
- `dept_id` → `deptId`
- `date_of_action` → `dateOfAction`
- 31 field mappings total

**`normKeys(obj)`** (line 79) — Applied to all POST/PATCH bodies:
- `plantId` → `plant_id`
- `deptId` → `dept_id`
- Reverse of denormKeys

**`resolveRecordIds(record, plants, depts, machines, projects)`** (line 89):
- Converts display names back to FK IDs before sending to backend
- `plant` (name) → `plant_id` (FK)
- `section` (dept name) → `dept_id` (FK)
- `machineName` → `machine_id` (FK)
- `project` (name) → `project_id` (FK)

**`resolveForeignKeys(items, plants, depts, projects)`** (line 144):
- Converts FK IDs to display names on incoming data
- `plantId` → `plant` (name)
- `deptId` → `dept` (name)
- `projectId` → `project` (name)

---

## State Management

All state lives in the root `App` component (line 5705) and is passed down via props. There is no Redux, Zustand, or Context API.

### App-Level State (10 hooks)

| State | Type | Purpose |
|-------|------|---------|
| `user` | object | Logged-in user |
| `page` | number | Current page (0-4, 99) |
| `dbReady` | boolean | Data loaded from API |
| `meetings` | array | All meetings |
| `projects` | array | All projects |
| `globalActiveMtg` | object | Currently active meeting |
| `mtgRunning` | boolean | Meeting timer running |
| `mtgElapsed` | number | Seconds elapsed |
| `mtgTxLines` | array | Transcript lines |
| `mtgFastActions` | array | Quick actions during meeting |
| `mtgInsights` | array | AI-generated insights |

### Optimistic Updates

Every mutation follows this pattern:

```js
// 1. Update local state immediately
setActions(p => [...p, newAction]);

// 2. Fire API call (fire-and-forget)
apiCreate("actions", resolveRecordIds(newAction, plants, depts, machines, projects));
```

Errors are only `console.warn`'d — no rollback on failure.

---

## Pages in Detail

### Page 0: HomePage (line 1203, 424 lines)

- KPI summary cards (total actions, pending, overdue, completed)
- Upcoming meetings with time conflict detection
- Subordinate performance overview (pending/delayed/today/soon/later)
- Meeting popup with "Start Meeting" action
- Action detail side panel for quick edits

### Page 1: WorkPage (line 1806, 221 lines)

- Split view: Meetings (left) + Projects (right)
- Meeting cards with attendees, time, facilitator
- Project cards with progress bars, milestones, team
- Time conflict warnings
- "Start Meeting" → opens MeetingRoom
- "Plan" button → opens MeetingPlanPanel
- Completed meetings section

### MeetingRoom (line 2264, 826 lines) — Largest component

- **Live mode:** Speech-to-text transcript, AI insights (2-min batch analysis), action item creation
- **Paused mode:** Resume/Exit choice with session summary
- **Staging area:** Review and commit actions to database
- Features: Hindi/English translation, paragraph analysis, Smart Sync (full transcript analysis)
- Guidelines panel for meeting instructions

### Page 2: ActionsPage (line 3569, 277 lines)

- 4 view modes: Table, Board (by status), Kanban (by priority), Timeline (by due date)
- Filters: plant, status, priority, responsible, search
- Bulk actions, email to responsible person
- Action detail panel with inline editing, revision history, messages

### Page 3: DashboardPage (line 4163, 358 lines)

- Plant-scoped KPIs
- Status distribution chart
- Priority distribution chart
- Overdue analysis with escalation tiers
- Department-wise breakdown
- Top performers
- Recent activity

### Page 4: EscalationsPage (line 4903, 210 lines)

- Escalation matrix table (tiers, thresholds, notify methods)
- Team page with escalation grouping
- Active escalation alerts
- Email escalation trigger

### Page 99: MasterSetup (line 5113, 507 lines)

- Tabs: Plants, Departments, Users, Roles, Machines, Reasons, Meeting Presets, Escalation Matrix
- CRUD for each entity
- Bulk import
- Org chart visualization

---

## Meeting System

### Meeting Lifecycle

1. **Schedule** → AddMeetingModal creates meeting with type, plant, time, facilitator, attendees
2. **Plan** → MeetingPlanPanel sets guidelines and attendees from presets
3. **Start** → MeetingRoom opens with live transcript and AI analysis
4. **Run** → Speech-to-text captures transcript, AI extracts actions/decisions/risks every 2 minutes
5. **Pause** → Staging area shows session summary with word count and action count
6. **Commit** → Actions are created in database, meeting marked as completed

### Meeting Presets (from DB)

| Type | Attendees | Instructions |
|------|-----------|-------------|
| Furnace Daily Review | Plant-specific | Daily equipment review |
| Daily Problem-Solving | HOD + Plant Head | Issue resolution |
| Daily Plant Head Review | Plant Head + MD | Daily operations review |
| Weekly Plant Head | Plant Head + MD | Weekly summary |
| Safety Review | Safety team | Safety compliance |

### AI Integration

- **Extract Insights** (`POST /api/meetings/extract-insights`) — Full transcript analysis
- **Analyze Paragraph** (`POST /api/meetings/analyze-paragraph`) — Single paragraph analysis
- **Translate** (`POST /api/translate/`) — Hindi ↔ English via Gemini

---

## Escalation System

### How It Works

1. When an action becomes overdue, the frontend calls `POST /api/escalation/email/escalate`
2. Backend checks the escalation matrix for matching tiers
3. Emails are sent to target users based on overdue hours and priority
4. Deduplication prevents re-sending within 4 hours

### Frontend Escalation Logic (line 434)

```js
function runEscalation(actions, setAudit, escMatrix, users) {
  // For each open action:
  //   1. Calculate overdue hours
  //   2. Match against escalation tiers
  //   3. Find target user (superior chain)
  //   4. Create audit entry
  //   5. Send email notification
}
```

Runs on every `actions` state change via `useEffect` with 1.5s debounce.

---

## Styling Approach

### Inline CSS-in-JS

Every component uses inline `style={{}}` objects:

```jsx
<div style={{ background: T.bg, borderRadius: 10, padding: 12, border: `1px solid ${T.border}` }}>
  <div style={{ fontWeight: 700, fontSize: 14, color: T.navy }}>Title</div>
</div>
```

**1,275 inline style objects** across the file. No CSS classes, no CSS modules, no utility framework.

### Global CSS (index.css)

- CSS custom properties for light/dark mode
- Font imports (Sora + Inter)
- Base resets and typography
- `.card`, `.btn`, `.overlay`, `.modal` utility classes

### Reusable Micro-Components (lines 556-633)

```jsx
const SBadge = ({status}) => <span style={{...}}>{status}</span>;
const PBadge = ({p}) => <span style={{...}}>{p}</span>;
const Avatar = ({name, size, users}) => <div style={{...}}>{initials}</div>;
const Lbl = ({children}) => <label style={{...}}>{children}</label>;
const HR = () => <hr style={{...}} />;
const Spin = () => <div style={{...}}>⏳</div>;
const Empty = ({msg}) => <div style={{...}}>{msg}</div>;
const Chip = ({label, color}) => <span style={{...}}>{label}</span>;
const KPICard = ({icon, label, value, color}) => <div style={{...}}>...</div>;
const PageHeader = ({title, sub}) => <div style={{...}}>...</div>;
const Sparkbar = ({data, color}) => <div style={{...}}>...</div>;
```

---

## Authentication

### Login Flow

1. User enters username + password
2. `POST /api/auth/login` with credentials
3. Backend returns JWT token + user object
4. Token stored in `localStorage["mcs_token"]`
5. User object stored in `localStorage["mcs_session_user"]`
6. `AUTH_TOKEN` module variable updated
7. All subsequent API calls include `Authorization: Bearer <token>`

### Master Login (fallback)

If standard login fails, tries `POST /api/auth/master-login` with env-var credentials. No DB lookup — validates against `MASTER_USER` / `MASTER_PASSWORD` env vars.

### Guest Access

Guest users can view data without authentication. The `isGuestRole()` check (line 127) prevents action creation/editing.

---

## Permissions System

Role-based with hierarchy levels:

```js
function getPerms(user) {
  const level = getRoleLevel(user?.role);
  return {
    canCreateActions: level >= 2,
    canEditActions: level >= 3,
    canDeleteActions: level >= 5,
    canCreateMeetings: level >= 3,
    canEditMeetings: level >= 5,
    canManageEscalations: level >= 7,
    canCreateProjects: level >= 5,
    canAccessMaster: level >= 8 || user?.masterAccess,
  };
}
```

| Level | Role | Key Permissions |
|-------|------|-----------------|
| 1 | Guest User | View only |
| 2 | Operator | Create actions |
| 3 | Supervisor | Edit actions, create meetings |
| 4 | Shift Engineer | Department scope |
| 5 | HOD | Delete actions, edit meetings, create projects |
| 6 | Plant Head | Plant-wide scope |
| 7 | MD | Multi-plant, escalation management |
| 8 | Admin | Full access, Master Setup |

---

## Real-Time Features

### Speech-to-Text (MeetingRoom)

Uses browser's `webkitSpeechRecognition` API:

```js
const stt = new webkitSpeechRecognition();
stt.lang = "hi-IN";  // Hindi (better for Indian accents)
stt.continuous = true;
stt.interimResults = true;
```

- Captures live transcript during meetings
- interim results shown in real-time
- Final results added to `txLines` state
- 2-minute batch analysis triggers AI insights

### Meeting Timer

```js
useEffect(() => {
  if (mtgRunning && globalActiveMtg) {
    mtgTimerRef.current = setInterval(() => setMtgElapsed(e => e + 1), 1000);
  }
}, [mtgRunning, globalActiveMtg]);
```

Ticks every second, displayed as `HH:MM:SS` in MeetingRoom header.

---

## Known Frontend Issues

| Issue | Location | Impact |
|-------|----------|--------|
| Single 5,921-line file | `App.jsx` | Hard to maintain |
| No code splitting | `vite.config.js` | 473 KB bundle loads entirely |
| Zero React.memo | Entire file | All children re-render on any state change |
| 1s timer re-renders entire app | Line 5796 | UI jank every second |
| 1,275 inline style objects | Entire file | GC pressure |
| All data loaded at once | Line 191-252 | Slow login |
| No pagination | All list views | Memory growth |
| CSS injected via `<style>` tag | Line 5873 | Re-parsed every render |
| Google Fonts via `@import` | Line 506 | Blocks rendering |
| Optimistic updates with no rollback | All mutations | Data inconsistency on API failure |

---

## Build & Dev Commands

```bash
npm run dev       # Start Vite dev server (port 5173)
npm run build     # Production build → dist/
npm run preview   # Preview production build
npm run lint      # ESLint check
```

---

## Environment Variables

| Variable | Required | Default |
|----------|----------|---------|
| `VITE_API_BASE_URL` | Yes | `https://mcs-action-is-1.onrender.com` |
| `VITE_API_KEY` | Yes | (must match backend API_KEY) |
