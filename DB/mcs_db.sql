-- ============================================================
--  MCS — Management Control System
--  PostgreSQL schema + seed data
--  Generated from: MCS Action Sheet.xlsx + Code.gs + App.jsx
-- ============================================================
--
--  Source-of-truth tabs (Google Sheets):
--    Users, Plants, Departments, Actions, Meetings, Projects,
--    EscalationMatrix, Permissions, MeetingPresets, Machines,
--    Reasons, Audit, Roles
--
--  Endpoints in original GAS backend:
--    POST  /  action=replace_all  →  truncate + insert
--    POST  /  action=append_all   →  insert skip-dup-on-id
--    GET   /                       →  health check
--
--  In this SQL schema, the equivalent operations are:
--    replace_all(tab)  ≈  TRUNCATE <tab> RESTART IDENTITY CASCADE;
--                        INSERT INTO <tab> ...;
--    append_all(tab)   ≈  INSERT INTO <tab> ... ON CONFLICT (id) DO NOTHING;

DROP TABLE IF EXISTS audit CASCADE;
DROP TABLE IF EXISTS action_messages CASCADE;
DROP TABLE IF EXISTS actions CASCADE;
DROP TABLE IF EXISTS project_milestones CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS meetings CASCADE;
DROP TABLE IF EXISTS meeting_presets CASCADE;
DROP TABLE IF EXISTS escalation_priorities CASCADE;
DROP TABLE IF EXISTS escalation_matrix CASCADE;
DROP TABLE IF EXISTS reasons CASCADE;
DROP TABLE IF EXISTS machines CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS departments CASCADE;
DROP TABLE IF EXISTS plants CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TYPE IF EXISTS action_status CASCADE;
DROP TYPE IF EXISTS action_priority CASCADE;
DROP TYPE IF EXISTS project_status CASCADE;

-- Enums (mirror STATUS_LIST / PRIORITY_LIST / SC in App.jsx)
CREATE TYPE action_status   AS ENUM ('NOT STARTED', 'IN PROCESS', 'COMPLETED', 'DROPPED', 'PENDING CONFIRM');
CREATE TYPE action_priority AS ENUM ('CRITICAL', 'WARNING', 'NORMAL');
CREATE TYPE project_status  AS ENUM ('NOT STARTED', 'IN PROCESS', 'COMPLETED', 'ON HOLD', 'DROPPED');

CREATE TABLE plants (
    id        TEXT PRIMARY KEY,
    name      TEXT UNIQUE NOT NULL,
    location  TEXT,
    head      TEXT
);

CREATE TABLE departments (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    plant_id  TEXT REFERENCES plants(id) ON UPDATE CASCADE ON DELETE SET NULL,
    head      TEXT,
    icon      TEXT,
    UNIQUE (name, plant_id)
);

CREATE TABLE roles (
    id     TEXT PRIMARY KEY,
    name   TEXT UNIQUE NOT NULL,
    level  INTEGER NOT NULL CHECK (level BETWEEN 1 AND 10)
);

CREATE TABLE users (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    username    TEXT UNIQUE NOT NULL,
    password    TEXT,
    role        TEXT,
    plant_id    TEXT REFERENCES plants(id) ON UPDATE CASCADE ON DELETE SET NULL,
    dept_id     TEXT REFERENCES departments(id) ON UPDATE CASCADE ON DELETE SET NULL,
    superior    TEXT,                       -- free text; may not resolve to a user
    phone       TEXT,
    email       TEXT,
    initials    TEXT,
    color       TEXT DEFAULT '#7C80B0'
);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role     ON users(role);

CREATE TABLE machines (
    id        TEXT PRIMARY KEY,
    name      TEXT,
    plant_id  TEXT REFERENCES plants(id) ON UPDATE CASCADE ON DELETE SET NULL,
    dept_id   TEXT REFERENCES departments(id) ON UPDATE CASCADE ON DELETE SET NULL,
    type      TEXT,
    asset_no  TEXT
);

CREATE TABLE reasons (
    id        TEXT PRIMARY KEY,
    text      TEXT NOT NULL,
    category  TEXT
);
CREATE INDEX idx_reasons_category ON reasons(category);

CREATE TABLE projects (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    plant_id     TEXT REFERENCES plants(id) ON UPDATE CASCADE ON DELETE SET NULL,
    dept_id      TEXT REFERENCES departments(id) ON UPDATE CASCADE ON DELETE SET NULL,
    status       project_status,
    owner        TEXT,                          -- free text (e.g. 'Admin', user name)
    sponsor      TEXT,                          -- free text
    start_date   DATE,
    end_date     DATE,
    progress     INTEGER DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    priority     action_priority DEFAULT 'NORMAL',
    objective    TEXT,
    scope        TEXT,
    budget       NUMERIC(14,2) DEFAULT 0,
    description  TEXT,
    risks        JSONB DEFAULT '[]'::jsonb,     -- freeform array
    team         JSONB DEFAULT '[]'::jsonb      -- freeform array (names or ids)
);
CREATE INDEX idx_projects_owner_status ON projects(owner, status);
CREATE INDEX idx_projects_plant        ON projects(plant_id);

CREATE TABLE project_milestones (
    id          BIGSERIAL PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT,
    due         DATE,
    done        BOOLEAN DEFAULT FALSE,
    ord         INTEGER DEFAULT 0
);
CREATE INDEX idx_milestones_project ON project_milestones(project_id);

CREATE TABLE meeting_presets (
    type          TEXT PRIMARY KEY,
    attendees     JSONB DEFAULT '[]'::jsonb,
    instructions  JSONB DEFAULT '[]'::jsonb
);

CREATE TABLE meetings (
    id                  TEXT PRIMARY KEY,
    name                TEXT,
    type                TEXT,
    plant_id            TEXT REFERENCES plants(id) ON UPDATE CASCADE ON DELETE SET NULL,
    date                DATE,
    time                TIME,
    status              TEXT,            -- kept as TEXT; lifecycle not strictly enumerated in source
    attendees           JSONB DEFAULT '[]'::jsonb,
    duration            INTEGER,         -- legacy 'duration' col (mins)
    dur                 INTEGER,         -- newer 'dur' col (mins)
    action_count        INTEGER DEFAULT 0,
    notes               TEXT,
    facilitator         TEXT,
    recurring           BOOLEAN DEFAULT FALSE,
    recurrence          TEXT,
    project_id          TEXT REFERENCES projects(id) ON UPDATE CASCADE ON DELETE SET NULL,
    completed_sessions  JSONB DEFAULT '[]'::jsonb
);
CREATE INDEX idx_meetings_project ON meetings(project_id);
CREATE INDEX idx_meetings_date    ON meetings(date);

CREATE TABLE escalation_matrix (
    id            TEXT PRIMARY KEY,
    level         INTEGER NOT NULL,
    label         TEXT,
    from_role     TEXT,                -- role whose overdue actions trigger this tier
    target_role   TEXT,                -- role that gets notified
    overdue_days  INTEGER DEFAULT 0,
    overdue_hrs   INTEGER DEFAULT 0,
    target        TEXT,                -- legacy: 'Supervisor' | 'Shift Engineer' | 'HOD' | 'Plant Head' | 'MD'
    notify_method TEXT,                -- 'In-App' | 'In-App + Email'
    applicable_to TEXT DEFAULT 'All',
    color         TEXT,
    active        BOOLEAN DEFAULT TRUE,
    description   TEXT,
    priorities    JSONB DEFAULT '[]'::jsonb,
    superiors     JSONB DEFAULT '[]'::jsonb
);
CREATE INDEX idx_esc_level ON escalation_matrix(level);

CREATE TABLE escalation_priorities (
    escalation_id  TEXT NOT NULL REFERENCES escalation_matrix(id) ON DELETE CASCADE,
    priority       action_priority NOT NULL,
    PRIMARY KEY (escalation_id, priority)
);

CREATE TABLE actions (
    id                    TEXT PRIMARY KEY,   -- epoch-ms string from frontend
    sn                    TEXT UNIQUE NOT NULL,
    text                  TEXT NOT NULL,
    responsible_user_id   TEXT REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    responsible           TEXT,                -- original 'responsible' string (may be partial name)
    due                   DATE,
    status                action_status NOT NULL DEFAULT 'NOT STARTED',
    priority              action_priority NOT NULL DEFAULT 'NORMAL',
    section               TEXT,
    source                TEXT,                -- meeting name or 'Quick Add'
    plant_id              TEXT REFERENCES plants(id)        ON UPDATE CASCADE ON DELETE SET NULL,
    dept_id               TEXT REFERENCES departments(id)  ON UPDATE CASCADE ON DELETE SET NULL,
    machine_id            TEXT REFERENCES machines(id)     ON UPDATE CASCADE ON DELETE SET NULL,
    machine_name          TEXT,                -- denormalized for convenience
    reason_id             TEXT REFERENCES reasons(id)      ON UPDATE CASCADE ON DELETE SET NULL,
    reason                TEXT,                -- original 'reason' string ('ALL' etc.)
    reason_of_action      TEXT,
    action_point_type     TEXT,                -- 'Improvement' | 'Preventive Action' | ...
    remarks               TEXT,
    date_of_action        DATE,
    created               DATE,
    closed_on             DATE,
    closed_by             TEXT,                -- free text (e.g. 'Manish')
    allocated_by          TEXT,                -- free text
    project_id            TEXT REFERENCES projects(id)     ON UPDATE CASCADE ON DELETE SET NULL,
    project               TEXT,                -- original 'project' string
    src                   TEXT,                -- legacy 'src' field
    src_id                TEXT REFERENCES meetings(id)     ON UPDATE CASCADE ON DELETE SET NULL,
    meetingid             TEXT REFERENCES meetings(id)     ON UPDATE CASCADE ON DELETE SET NULL,
    meeting_name          TEXT,                -- denormalized linked meeting name
    revisions             INTEGER DEFAULT 0,
    revision_history      JSONB DEFAULT '[]'::jsonb,
    pending_confirmation  BOOLEAN DEFAULT FALSE
);
CREATE INDEX idx_actions_status_priority_due ON actions(status, priority, due);
CREATE INDEX idx_actions_responsible         ON actions(responsible_user_id);
CREATE INDEX idx_actions_plant_dept          ON actions(plant_id, dept_id);
CREATE INDEX idx_actions_project             ON actions(project_id);
CREATE INDEX idx_actions_created             ON actions(created);

CREATE TABLE action_messages (
    id               BIGSERIAL PRIMARY KEY,
    action_id        TEXT NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
    source_msg_id    TEXT,                  -- original 'id' inside JSON (epoch ms)
    author           TEXT,
    author_initials  TEXT,
    author_color     TEXT,
    text             TEXT,
    ts               TIMESTAMPTZ
);
CREATE INDEX idx_action_messages_action ON action_messages(action_id);

CREATE TABLE audit (
    id          TEXT PRIMARY KEY,    -- epoch-ms string
    ts          TIMESTAMPTZ,
    action_sn   TEXT,                -- references actions(sn); stored as text for resilience
    action_id   TEXT REFERENCES actions(id) ON UPDATE CASCADE ON DELETE SET NULL,
    text        TEXT,
    level       INTEGER,
    target      TEXT,
    reason      TEXT,
    UNIQUE (action_sn, level)        -- mirrors the GAS dedup logic (sn + level)
);
CREATE INDEX idx_audit_sn_level ON audit(action_sn, level);
CREATE INDEX idx_audit_ts       ON audit(ts);

-- ── Roles (from App.jsx defaultRoles) ──────────────────────────
INSERT INTO roles (id, name, level) VALUES ('R1', 'Guest User', 1);
INSERT INTO roles (id, name, level) VALUES ('R3', 'Supervisor', 3);
INSERT INTO roles (id, name, level) VALUES ('R4', 'Shift Engineer', 4);
INSERT INTO roles (id, name, level) VALUES ('R5', 'HOD', 5);
INSERT INTO roles (id, name, level) VALUES ('R6', 'Plant Head', 6);
INSERT INTO roles (id, name, level) VALUES ('R7', 'MD', 7);
INSERT INTO roles (id, name, level) VALUES ('R8', 'Admin', 8);

-- ── Plants ─────────────────────────────────────────────────────
INSERT INTO plants (id, name, location, head) VALUES ('P1', 'Signet', 'Pithampur', 'Saurabh Sangla');
INSERT INTO plants (id, name, location, head) VALUES ('P2', 'Adroit', 'Pithampur', 'Saurabh Sangla');
INSERT INTO plants (id, name, location, head) VALUES ('P3`', 'Both', 'Indore', 'Mukesh Sangla');

-- ── Departments ────────────────────────────────────────────────
INSERT INTO departments (id, name, plant_id, head, icon) VALUES ('D1', 'PE', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), 'Saurabh Sangla', '🔹');
INSERT INTO departments (id, name, plant_id, head, icon) VALUES ('D2', 'PVC', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), 'Saurabh Sangla', '🔹');
INSERT INTO departments (id, name, plant_id, head, icon) VALUES ('D3', 'General', (SELECT id FROM plants WHERE name = 'Both' LIMIT 1), 'Saurabh Sangla', '🔹');
INSERT INTO departments (id, name, plant_id, head, icon) VALUES ('D4', 'Overall', (SELECT id FROM plants WHERE name = 'Adroit' LIMIT 1), 'Saurabh Sangla', NULL);

-- ── Users ──────────────────────────────────────────────────────

-- ── Machines ───────────────────────────────────────────────────
INSERT INTO machines (id, name, plant_id, dept_id, type, asset_no) VALUES ('MC01', 'ALL', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'PE' LIMIT 1), 'Manual', 'M/c-1');
INSERT INTO machines (id, name, plant_id, dept_id, type, asset_no) VALUES ('MCO1', 'ALL', (SELECT id FROM plants WHERE name = 'Adroit' LIMIT 1), (SELECT id FROM departments WHERE name = 'ALL' LIMIT 1), 'Hybrid', 'M/c-1');

-- ── Reasons ────────────────────────────────────────────────────
INSERT INTO reasons (id, text, category) VALUES ('R001', 'Machine breakdown / failure', 'Equipment');
INSERT INTO reasons (id, text, category) VALUES ('R002', 'Quality defect observed', 'Quality');
INSERT INTO reasons (id, text, category) VALUES ('R003', 'Safety hazard identified', 'Safety');
INSERT INTO reasons (id, text, category) VALUES ('R004', 'Process deviation found', 'Process');
INSERT INTO reasons (id, text, category) VALUES ('R005', 'Customer complaint follow-up', 'Customer');
INSERT INTO reasons (id, text, category) VALUES ('R006', 'Preventive maintenance due', 'Maintenance');
INSERT INTO reasons (id, text, category) VALUES ('R007', 'Material shortage / delay', 'Supply Chain');
INSERT INTO reasons (id, text, category) VALUES ('R008', 'Operator error / training gap', 'People');
INSERT INTO reasons (id, text, category) VALUES ('R009', 'Tool / die wear or damage', 'Equipment');
INSERT INTO reasons (id, text, category) VALUES ('R010', 'Energy / utility issue', 'Utilities');
INSERT INTO reasons (id, text, category) VALUES ('R011', 'Compliance / audit finding', 'Compliance');
INSERT INTO reasons (id, text, category) VALUES ('R012', 'Yield loss / rework identified', 'Quality');
INSERT INTO reasons (id, text, category) VALUES ('R013', 'New project / improvement initiative', 'Projects');
INSERT INTO reasons (id, text, category) VALUES ('R014', 'Management directive', 'Management');
INSERT INTO reasons (id, text, category) VALUES ('R015', 'Repeat issue — root cause pending', 'Quality');

-- ── Projects ───────────────────────────────────────────────────
INSERT INTO projects (id, name, plant_id, dept_id, status, owner, sponsor, start_date, end_date, progress, priority, objective, scope, budget, description, risks, team) VALUES ('PR1780483280105', 'Testing', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), NULL, 'NOT STARTED'::project_status, 'Admin', 'Admin', '2026-06-30'::date, '2026-07-30'::date, 0, 'NORMAL'::action_priority, 'Testing Purpose', 'Testing', 0, NULL, $json$[]$json$, $json$[]$json$);

-- ── Project milestones (normalized from Projects.milestones JSON) ──
INSERT INTO project_milestones (project_id, name, due, done, ord) VALUES ('PR1780483280105', 'New Milestone', '2026-06-20'::date, FALSE, 0);

-- ── Meeting presets (seeded from App.jsx defaults if Excel is empty) ──
INSERT INTO meeting_presets (type, attendees, instructions) VALUES ('Furnace Daily Review', $json$["Anil Kumar", "Meena Joshi", "Amit Tiwari", "Sanjay Mishra"]$json$, $json$["Review heat-wise production vs target (MPM, Power, Mn)", "Identify deviations from the last 24 hours", "Assign owners and due dates for each gap", "Confirm previous action statuses before closing"]$json$);
INSERT INTO meeting_presets (type, attendees, instructions) VALUES ('Daily Problem-Solving', $json$["Suresh Patel", "Ravi Gupta", "Kavita Rawat", "Neha Yadav"]$json$, $json$["Present the top 3 problems from yesterday", "Use 5-Why to identify root causes", "Assign corrective actions with clear owners", "Track open actions from prior sessions"]$json$);
INSERT INTO meeting_presets (type, attendees, instructions) VALUES ('Daily Plant Head Review', $json$["Anil Kumar", "Meena Joshi", "Amit Tiwari", "Sanjay Mishra", "Vijay Pandey"]$json$, $json$["Plant head to chair — no phones policy", "Review safety first, then production KPIs", "Each HOD presents department status in 3 minutes", "Escalate blockers that need cross-functional resolution"]$json$);
INSERT INTO meeting_presets (type, attendees, instructions) VALUES ('Weekly Plant Head', $json$["Rajiv Sharma", "Anil Kumar", "Suresh Patel", "Deepak Verma", "Meena Joshi", "Ravi Gupta", "Priya Singh"]$json$, $json$["MD-level review of all three plants", "Compare plant performance using dashboard data", "Close completed strategic actions, escalate long-running ones", "Confirm priorities for the coming week"]$json$);
INSERT INTO meeting_presets (type, attendees, instructions) VALUES ('Safety Review', $json$["Amit Tiwari", "Meena Joshi", "Priya Singh", "Vijay Pandey"]$json$, $json$["Start with near-miss and incident recap", "PPE compliance check results", "Assign corrective actions for each unsafe condition observed", "Set next review date before closing"]$json$);

-- ── Meetings ───────────────────────────────────────────────────
INSERT INTO meetings (id, name, type, plant_id, date, time, status, attendees, duration, dur, action_count, notes, facilitator, recurring, recurrence, project_id, completed_sessions) VALUES ('M1780483326652', 'testing', 'testing', (SELECT id FROM plants WHERE name = 'All' LIMIT 1), NULL::date, '10:00:00'::time, NULL, $json$["\""]$json$, NULL, 60, 0, NULL, 'Prashant Singh', FALSE, 'daily', (SELECT id FROM projects WHERE name = 'Testing' LIMIT 1), $json$[]$json$);

-- ── Escalation matrix ──────────────────────────────────────────
INSERT INTO escalation_matrix (id, level, label, from_role, target_role, overdue_days, overdue_hrs, target, notify_method, applicable_to, color, active, description, priorities, superiors) VALUES ('Eae621c7f', 2, 'Level 2 — HOD', 'Supervisor', 'HOD', 3, 72, 'HOD', 'In-App + Email', 'All', '#E67E22', TRUE, 'Supervisor overdue → HOD', '["CRITICAL","WARNING"]'::jsonb, '[]'::jsonb);

-- ── Escalation priorities (normalized from EscalationMatrix.priorities JSON) ──
INSERT INTO escalation_priorities (escalation_id, priority) VALUES ('Eae621c7f', 'CRITICAL'::action_priority) ON CONFLICT DO NOTHING;

-- ── Actions ────────────────────────────────────────────────────
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1781503466825.0', 'ACT-001', 'Testing', (SELECT id FROM users WHERE name = 'Prashant Singh' LIMIT 1), 'Prashant Singh', '2026-06-14'::date, 'IN PROCESS'::action_status, 'NORMAL'::action_priority, 'General', NULL, (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), NULL, NULL, 'ALL', NULL, NULL, NULL, 'Improvement', 'Test', '2026-06-15'::date, '2026-06-15'::date, NULL::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Testing' LIMIT 1), 'Testing', 'Quick Add', 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1781522231331.0', 'ACT-002', 'TESTING2', (SELECT id FROM users WHERE name = 'Prashant Singh' LIMIT 1), 'Prashant Singh', '2026-06-15'::date, 'IN PROCESS'::action_status, 'NORMAL'::action_priority, 'PE', NULL, (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), NULL, NULL, 'ALL', NULL, NULL, NULL, 'Preventive Action', NULL, '2026-06-15'::date, '2026-06-15'::date, NULL::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', 'Quick Add', 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240079.0', 'ACT-018', 'Tank Cap trail to be done', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-04-28'::date, 'COMPLETED'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), NULL, 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', 'Done', '2026-04-25'::date, NULL::date, '2026-05-11'::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240080.0', 'ACT-019', 'Discuss mechanism for the Cap purchase between new plant and Signet', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-04-28'::date, 'COMPLETED'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), NULL, 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', 'Test', 'Preventive Action', NULL, '2026-04-25'::date, NULL::date, '2026-06-01'::date, 'Manish', 'Manish Manjhi', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240081.0', 'ACT-020', 'Show Mr. Saurabh, the clamps issue', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-04-27'::date, 'COMPLETED'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), NULL, 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', 'Test', 'Preventive Action', 'Done', '2026-04-25'::date, NULL::date, '2026-06-02'::date, 'Manish', 'Manish Manjhi', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240082.0', 'ACT-021', 'Purchase stud clamp for the PE moulding area', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-05-08'::date, 'NOT STARTED'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), NULL, 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', 'Sent to Himanshu for purchase', '2026-04-25'::date, NULL::date, NULL::date, 'Manish', 'Manish Manjhi', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240083.0', 'ACT-022', 'Discuss with Mr. Parash for soft PVC moulding material 50 Kg use in the chair', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-04-27'::date, 'IN PROCESS'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), NULL, 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', 'Preventive Action', 'Preventive Action', 'Spoken with Mr. Parash, today they are exploring it. Tomorrow he will confirm', '2026-04-25'::date, NULL::date, NULL::date, 'Manish', 'Manish Manjhi', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240084.0', 'ACT-023', 'Get a new punch for the bend 110x87.5 or take it from old chinese collapsible mould', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-04-27'::date, 'IN PROCESS'::action_status, 'NORMAL'::action_priority, 'Business Excellence', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'Business Excellence' LIMIT 1), NULL, 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', 'Corrective Action', 'Preventive Action', NULL, '2026-04-25'::date, NULL::date, NULL::date, 'Manish', 'Manish Manjhi', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240085.0', 'ACT-024', 'Take written action for the take-up and joiner issue and send it to the vendor if satisfies', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-04-27'::date, 'IN PROCESS'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), NULL, 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', 'Mail shared with Mr. Pandey to confirm, will share it tonight during his Roster time', '2026-04-25'::date, NULL::date, '2026-05-11'::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240086.0', 'ACT-025', 'PP material we found use it by adding 30% CPN and use it on non welding material - Bobbin, elbow, tee', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-04-27'::date, 'IN PROCESS'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), NULL, 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', 'Ongoing in the practice', '2026-04-25'::date, NULL::date, '2026-05-11'::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240087.0', 'ACT-026', 'Add PVC S350 machine for servo work', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-04-27'::date, 'IN PROCESS'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), NULL, 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', 'On 27th Devanshi team visited and we have communicated the same to them, they will share the quotation by Wednesday', '2026-04-25'::date, NULL::date, '2026-05-11'::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240088.0', 'ACT-027', 'Install locating plate on the fast moving mould.', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-05-02'::date, 'IN PROCESS'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), NULL, 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', '1. Getting Thapa for locating ring stand development. 2. Parallely all the locating ring will be segregated by Wednesday. 3. Once ring is identified where it is absent they will put it and as & when a mould is taken out it will go for tapping and drilling to fix it', '2026-04-25'::date, NULL::date, NULL::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240089.0', 'ACT-028', 'Define the MTS for PVC and PE and ensure 45 days once mould is start.', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-04-29'::date, 'IN PROCESS'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), NULL, 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', NULL, '2026-04-25'::date, NULL::date, '2026-05-10'::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240090.0', 'ACT-029', 'Bring Jena and Gyaneshwar for SP 550 and discuss the mech issue.', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-04-28'::date, 'IN PROCESS'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), NULL, 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', NULL, '2026-04-25'::date, NULL::date, NULL::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240091.0', 'ACT-030', 'Share a daily report with Mr. Saurabh on RM consumption and yield losses.', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-04-29'::date, 'IN PROCESS'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), NULL, 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', NULL, '2026-04-25'::date, NULL::date, NULL::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240092.0', 'ACT-031', 'Fix one machine for POM material and use RP and Grinder parallely.', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-04-28'::date, 'IN PROCESS'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), (SELECT id FROM machines WHERE name = 'ALL' LIMIT 1), 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', 'TD 275 II is fixed for POM', '2026-04-25'::date, NULL::date, NULL::date, 'Manish', 'Prashant', NULL, NULL, NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240093.0', 'ACT-032', 'Compressor of Injection Moulding has to be installed', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-04-08'::date, 'IN PROCESS'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), (SELECT id FROM machines WHERE name = 'ALL' LIMIT 1), 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', 'Vendor came on Tuesday (7th). Work in progress, as per Mr. Tiwari, today pressure will be developed and tomorrow they will check if there is any leakage, if everything goes well, on 9th they will start it.', '2026-04-25'::date, NULL::date, '2026-05-11'::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240094.0', 'ACT-033', 'Get the closure of the compressor VFD plan across the plants, and also we have to implement it within 7 days (check pressure transducer idea of Mr. Pandey)', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-05-02'::date, 'IN PROCESS'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), (SELECT id FROM machines WHERE name = 'ALL' LIMIT 1), 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', 'Corrective Action', 'Preventive Action', NULL, NULL::date, NULL::date, NULL::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240095.0', 'ACT-034', 'Get the fixture ready to ensure fitment is control', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-05-09'::date, 'IN PROCESS'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), (SELECT id FROM machines WHERE name = 'ALL' LIMIT 1), 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', 'Develop it', '2026-04-25'::date, NULL::date, NULL::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240096.0', 'ACT-035', 'Check with Mr. Tiwari and Mr. Himanshu on the Servo Work (NP 100 I)', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-04-06'::date, 'COMPLETED'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), (SELECT id FROM machines WHERE name = 'ALL' LIMIT 1), 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', 'Delivery got delayed, it will be dispatched today and by 8th we will get the status from the vendor.', '2026-04-25'::date, NULL::date, '2026-06-01'::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240097.0', 'ACT-036', 'For each Machine create a shadow wall or tool box to keep the machine relevant tools', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-05-09'::date, 'IN PROCESS'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), (SELECT id FROM machines WHERE name = 'ALL' LIMIT 1), 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', 'Will share by 9th Apr.', '2026-04-25'::date, NULL::date, NULL::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240098.0', 'ACT-037', 'Get the team for mechanical maintenance of SP550 and ensure we also want to test of the material which they suggest to install', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-04-06'::date, 'COMPLETED'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), (SELECT id FROM machines WHERE name = 'ALL' LIMIT 1), 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', 'We spoke that despite Servo work, we have to do few mechnical work. For the same Mr. Hemant has shared the details with two of his vendors. They will share the details by 9th Apr.', '2026-04-25'::date, NULL::date, '2026-06-01'::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240099.0', 'ACT-038', 'Confirm whether we are getting D2 material for the grider blade or not with Mr. Pandey and Mr. Himanshu (CPVC)', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-04-06'::date, 'NOT STARTED'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), (SELECT id FROM machines WHERE name = 'ALL' LIMIT 1), 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', 'Indent has been raised for the same, Order will be placed tomorrow (4th), it will take 20 to 25 days.', '2026-04-25'::date, NULL::date, NULL::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240100.0', 'ACT-039', 'Check the availability of runner clipper to ease the operator time and effort in runner cutting', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-04-04'::date, 'DROPPED'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), (SELECT id FROM machines WHERE name = 'ALL' LIMIT 1), 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', 'Not all machine have, they have lost few. With shadow wall and regular review via linewalk it will be controlled.', '2026-04-25'::date, NULL::date, NULL::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240101.0', 'ACT-040', 'Discuss with Mr. Himanshu for grinder payment issue (Rotor) - PE Moulding Big Grinder', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-04-06'::date, 'COMPLETED'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), (SELECT id FROM machines WHERE name = 'ALL' LIMIT 1), 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', 'Amit went to validate the work completion and found some threading work was still pending, hence vendor is completing it today and tomorrow we will get it.', '2026-04-25'::date, NULL::date, '2026-06-01'::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240102.0', 'ACT-041', 'Install temporary green net or permanent sheets for the partition between the CPVC and Moulding plant', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-04-30'::date, 'IN PROCESS'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), (SELECT id FROM machines WHERE name = 'ALL' LIMIT 1), 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', 'Corrective Action', 'Preventive Action', 'The fabrication team is already engaged for fire related work for next 10 to 15 days. Hence we are seeking contractor for the same. Material today approved by Mukesh Sir and Tiwari Ji is planning to get this work done from Mr. Mandal (he is currently making pvc pipe bins along the boundary).', '2026-04-25'::date, NULL::date, NULL::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240103.0', 'ACT-042', 'Photo Sensor - Discuss with the vendor for further rate negotiation', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-04-28'::date, 'DROPPED'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), (SELECT id FROM machines WHERE name = 'ALL' LIMIT 1), 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', NULL, '2026-04-25'::date, NULL::date, NULL::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1777128240104.0', 'ACT-043', 'List of old items for Saurabh Shaktiman (old dump lot) in PVC area and identify material for grinding', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-04-28'::date, 'IN PROCESS'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), (SELECT id FROM machines WHERE name = 'ALL' LIMIT 1), 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', NULL, '2026-04-25'::date, NULL::date, '2026-05-11'::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1778108322577.0', 'ACT-027', 'Test action point for bug hunting.', (SELECT id FROM users WHERE name = 'Prashant' LIMIT 1), 'Prashant', '2026-05-10'::date, 'IN PROCESS'::action_status, 'NORMAL'::action_priority, 'General', 'Mr. Saurabh Review Meeting', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), (SELECT id FROM machines WHERE name = 'ALL' LIMIT 1), 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', NULL, '2026-05-06'::date, NULL::date, NULL::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1778237015324.0', 'ACT-028', 'Testing 1`', (SELECT id FROM users WHERE name = 'Prashant' LIMIT 1), 'Prashant', '2026-05-10'::date, 'IN PROCESS'::action_status, 'CRITICAL'::action_priority, 'General', 'Quick Add', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), (SELECT id FROM machines WHERE name = 'ALL' LIMIT 1), 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', 'Compliance / audit finding', 'Preventive Action', NULL, '2026-05-08'::date, NULL::date, NULL::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1778490244889.0', 'ACT-029', 'testing', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-05-20'::date, 'IN PROCESS'::action_status, 'NORMAL'::action_priority, 'General', 'Quick Add', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), (SELECT id FROM machines WHERE name = 'ALL' LIMIT 1), 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', NULL, '2026-05-11'::date, NULL::date, NULL::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1778508756133.0', 'ACT-030', 'fsdfdsfsdf', (SELECT id FROM users WHERE name = 'Prashant' LIMIT 1), 'Prashant', '2026-05-21'::date, 'COMPLETED'::action_status, 'NORMAL'::action_priority, 'General', 'Quick Add', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), (SELECT id FROM machines WHERE name = 'ALL' LIMIT 1), 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', 'sddssds', 'Preventive Action', 'sdfdsfsdfs', '2026-05-11'::date, NULL::date, '2026-05-11'::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1779824430871.0', 'ACT-031', 'Testing', (SELECT id FROM users WHERE name = 'Prashant' LIMIT 1), 'Prashant', '2026-05-28'::date, 'IN PROCESS'::action_status, 'NORMAL'::action_priority, 'PE', 'Quick Add', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'PE' LIMIT 1), (SELECT id FROM machines WHERE name = 'ALL' LIMIT 1), 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', 'Testing', '2026-05-26'::date, NULL::date, NULL::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1780379533132.0', 'ACT-032', 'Testing', (SELECT id FROM users WHERE name = 'Prashant' LIMIT 1), 'Prashant', '2026-06-20'::date, 'IN PROCESS'::action_status, 'NORMAL'::action_priority, 'PE', 'Quick Add', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'PE' LIMIT 1), (SELECT id FROM machines WHERE name = 'ALL' LIMIT 1), 'ALL', (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, 'Preventive Action', 'Hello', '2026-06-02'::date, NULL::date, NULL::date, 'Manish', 'Prashant', (SELECT id FROM projects WHERE name = 'Mr. Saurabh Signet Work' LIMIT 1), 'Mr. Saurabh Signet Work', NULL, 0, $json$[]$json$, FALSE);
INSERT INTO actions (id, sn, text, responsible_user_id, responsible, due, status, priority, section, source, plant_id, dept_id, machine_id, machine_name, reason_id, reason, reason_of_action, action_point_type, remarks, date_of_action, created, closed_on, closed_by, allocated_by, project_id, project, src, revisions, revision_history, pending_confirmation) VALUES ('1780380063722.0', 'ACT-033', 'Escalation Testing', (SELECT id FROM users WHERE name = 'Manish Manjhi' LIMIT 1), 'Manish Manjhi', '2026-06-10'::date, 'PENDING CONFIRM'::action_status, 'WARNING'::action_priority, 'General', 'Quick Add', (SELECT id FROM plants WHERE name = 'Signet' LIMIT 1), (SELECT id FROM departments WHERE name = 'General' LIMIT 1), (SELECT id FROM machines WHERE name = 'ALL' LIMIT 1), NULL, (SELECT id FROM reasons WHERE text = 'ALL' LIMIT 1), 'ALL', NULL, NULL, 'Test Remark', NULL::date, NULL::date, NULL::date, NULL, NULL, NULL, NULL, NULL, 0, $json$[]$json$, TRUE);

-- ── Action messages (normalized from Actions.messages JSON) ────
INSERT INTO action_messages (action_id, source_msg_id, author, author_initials, author_color, text, ts) VALUES ('1780380063722.0', '1781680538616', 'System', 'SYS', '#272262', 'Manish Manjhi has marked this action as complete and sent it for confirmation by .', '2026-06-17T07:15:38.616Z'::timestamptz);

-- ── Audit ──────────────────────────────────────────────────────
INSERT INTO audit (id, ts, action_sn, action_id, text, level, target, reason) VALUES ('1781503468370.1594', '2026-06-15T06:04:28.370Z'::timestamptz, 'ACT-001', (SELECT id FROM actions WHERE sn = 'ACT-001' LIMIT 1), 'Testing', 1, 'Supervisor', '30h overdue — Level 1 — Supervisor Alert') ON CONFLICT (action_sn, level) DO NOTHING;
INSERT INTO audit (id, ts, action_sn, action_id, text, level, target, reason) VALUES ('1781521172689.5947', '2026-06-15T10:59:32.689Z'::timestamptz, 'ACT-002', (SELECT id FROM actions WHERE sn = 'ACT-002' LIMIT 1), 'testinng2', 3, 'Plant Head', '130h overdue — Level 3 — Plant Head Review') ON CONFLICT (action_sn, level) DO NOTHING;
INSERT INTO audit (id, ts, action_sn, action_id, text, level, target, reason) VALUES ('1781522232855.1584', '2026-06-15T11:17:12.855Z'::timestamptz, 'ACT-002', (SELECT id FROM actions WHERE sn = 'ACT-002' LIMIT 1), 'TESTING2', 1, 'Supervisor', '11h overdue — Level 1 — Supervisor Alert') ON CONFLICT (action_sn, level) DO NOTHING;
INSERT INTO audit (id, ts, action_sn, action_id, text, level, target, reason) VALUES ('1781526266420.5115', '2026-06-15T12:24:26.420Z'::timestamptz, 'ACT-021', (SELECT id FROM actions WHERE sn = 'ACT-021' LIMIT 1), 'Purchase stud clamp for the PE moulding area', 1, 'Supervisor', '924h overdue — Level 1 — Supervisor Alert') ON CONFLICT (action_sn, level) DO NOTHING;
INSERT INTO audit (id, ts, action_sn, action_id, text, level, target, reason) VALUES ('1781526266420.9836', '2026-06-15T12:24:26.420Z'::timestamptz, 'ACT-022', (SELECT id FROM actions WHERE sn = 'ACT-022' LIMIT 1), 'Discuss with Mr. Parash for soft PVC moulding material 50 Kg use in the chair', 1, 'Supervisor', '1188h overdue — Level 1 — Supervisor Alert') ON CONFLICT (action_sn, level) DO NOTHING;
INSERT INTO audit (id, ts, action_sn, action_id, text, level, target, reason) VALUES ('1781526266420.0498', '2026-06-15T12:24:26.420Z'::timestamptz, 'ACT-023', (SELECT id FROM actions WHERE sn = 'ACT-023' LIMIT 1), 'Get a new punch for the bend 110x87.5 or take it from old chinese collapsible mould', 1, 'Supervisor', '1188h overdue — Level 1 — Supervisor Alert') ON CONFLICT (action_sn, level) DO NOTHING;
INSERT INTO audit (id, ts, action_sn, action_id, text, level, target, reason) VALUES ('1781680168754.488', '2026-06-17T07:09:28.751Z'::timestamptz, 'ACT-024', (SELECT id FROM actions WHERE sn = 'ACT-024' LIMIT 1), 'Take written action for the take-up and joiner issue and send it to the vendor if satisfies', 1, 'Supervisor', '1212h overdue — Level 1 — Supervisor Alert') ON CONFLICT (action_sn, level) DO NOTHING;
INSERT INTO audit (id, ts, action_sn, action_id, text, level, target, reason) VALUES ('1781680168754.5059', '2026-06-17T07:09:28.751Z'::timestamptz, 'ACT-025', (SELECT id FROM actions WHERE sn = 'ACT-025' LIMIT 1), 'PP material we found use it by adding 30% CPN and use it on non welding material - Bobbin, elbow, tee', 1, 'Supervisor', '1212h overdue — Level 1 — Supervisor Alert') ON CONFLICT (action_sn, level) DO NOTHING;
INSERT INTO audit (id, ts, action_sn, action_id, text, level, target, reason) VALUES ('1781680168754.4756', '2026-06-17T07:09:28.751Z'::timestamptz, 'ACT-026', (SELECT id FROM actions WHERE sn = 'ACT-026' LIMIT 1), 'Add PVC S350 machine for servo work', 1, 'Supervisor', '1212h overdue — Level 1 — Supervisor Alert') ON CONFLICT (action_sn, level) DO NOTHING;
INSERT INTO audit (id, ts, action_sn, action_id, text, level, target, reason) VALUES ('1781680168754.0872', '2026-06-17T07:09:28.751Z'::timestamptz, 'ACT-027', (SELECT id FROM actions WHERE sn = 'ACT-027' LIMIT 1), 'Install locating plate on the fast moving mould.', 1, 'Supervisor', '1092h overdue — Level 1 — Supervisor Alert') ON CONFLICT (action_sn, level) DO NOTHING;
INSERT INTO audit (id, ts, action_sn, action_id, text, level, target, reason) VALUES ('1781680168754.8787', '2026-06-17T07:09:28.751Z'::timestamptz, 'ACT-028', (SELECT id FROM actions WHERE sn = 'ACT-028' LIMIT 1), 'Define the MTS for PVC and PE and ensure 45 days once mould is start.', 1, 'Supervisor', '1164h overdue — Level 1 — Supervisor Alert') ON CONFLICT (action_sn, level) DO NOTHING;
INSERT INTO audit (id, ts, action_sn, action_id, text, level, target, reason) VALUES ('1781680168754.1667', '2026-06-17T07:09:28.751Z'::timestamptz, 'ACT-029', (SELECT id FROM actions WHERE sn = 'ACT-029' LIMIT 1), 'Bring Jena and Gyaneshwar for SP 550 and discuss the mech issue.', 1, 'Supervisor', '1188h overdue — Level 1 — Supervisor Alert') ON CONFLICT (action_sn, level) DO NOTHING;
INSERT INTO audit (id, ts, action_sn, action_id, text, level, target, reason) VALUES ('1781680168754.1062', '2026-06-17T07:09:28.751Z'::timestamptz, 'ACT-030', (SELECT id FROM actions WHERE sn = 'ACT-030' LIMIT 1), 'Share a daily report with Mr. Saurabh on RM consumption and yield losses.', 1, 'Supervisor', '1164h overdue — Level 1 — Supervisor Alert') ON CONFLICT (action_sn, level) DO NOTHING;
INSERT INTO audit (id, ts, action_sn, action_id, text, level, target, reason) VALUES ('1781680168754.6665', '2026-06-17T07:09:28.751Z'::timestamptz, 'ACT-031', (SELECT id FROM actions WHERE sn = 'ACT-031' LIMIT 1), 'Fix one machine for POM material and use RP and Grinder parallely.', 1, 'Supervisor', '1188h overdue — Level 1 — Supervisor Alert') ON CONFLICT (action_sn, level) DO NOTHING;
INSERT INTO audit (id, ts, action_sn, action_id, text, level, target, reason) VALUES ('1781680168754.7021', '2026-06-17T07:09:28.751Z'::timestamptz, 'ACT-032', (SELECT id FROM actions WHERE sn = 'ACT-032' LIMIT 1), 'Compressor of Injection Moulding has to be installed', 1, 'Supervisor', '1668h overdue — Level 1 — Supervisor Alert') ON CONFLICT (action_sn, level) DO NOTHING;
INSERT INTO audit (id, ts, action_sn, action_id, text, level, target, reason) VALUES ('1781680168754.2297', '2026-06-17T07:09:28.751Z'::timestamptz, 'ACT-034', (SELECT id FROM actions WHERE sn = 'ACT-034' LIMIT 1), 'Get the fixture ready to ensure fitment is control', 1, 'Supervisor', '924h overdue — Level 1 — Supervisor Alert') ON CONFLICT (action_sn, level) DO NOTHING;
INSERT INTO audit (id, ts, action_sn, action_id, text, level, target, reason) VALUES ('1781680168754.4985', '2026-06-17T07:09:28.751Z'::timestamptz, 'ACT-036', (SELECT id FROM actions WHERE sn = 'ACT-036' LIMIT 1), 'For each Machine create a shadow wall or tool box to keep the machine relevant tools', 1, 'Supervisor', '924h overdue — Level 1 — Supervisor Alert') ON CONFLICT (action_sn, level) DO NOTHING;
INSERT INTO audit (id, ts, action_sn, action_id, text, level, target, reason) VALUES ('1781680168754.7947', '2026-06-17T07:09:28.751Z'::timestamptz, 'ACT-038', (SELECT id FROM actions WHERE sn = 'ACT-038' LIMIT 1), 'Confirm whether we are getting D2 material for the grider blade or not with Mr. Pandey and Mr. Himanshu (CPVC)', 1, 'Supervisor', '1716h overdue — Level 1 — Supervisor Alert') ON CONFLICT (action_sn, level) DO NOTHING;
INSERT INTO audit (id, ts, action_sn, action_id, text, level, target, reason) VALUES ('1781680168754.8093', '2026-06-17T07:09:28.751Z'::timestamptz, 'ACT-041', (SELECT id FROM actions WHERE sn = 'ACT-041' LIMIT 1), 'Install temporary green net or permanent sheets for the partition between the CPVC and Moulding plant', 1, 'Supervisor', '1140h overdue — Level 1 — Supervisor Alert') ON CONFLICT (action_sn, level) DO NOTHING;
INSERT INTO audit (id, ts, action_sn, action_id, text, level, target, reason) VALUES ('1781680168754.6204', '2026-06-17T07:09:28.751Z'::timestamptz, 'ACT-043', (SELECT id FROM actions WHERE sn = 'ACT-043' LIMIT 1), 'List of old items for Saurabh Shaktiman (old dump lot) in PVC area and identify material for grinding', 1, 'Supervisor', '1188h overdue — Level 1 — Supervisor Alert') ON CONFLICT (action_sn, level) DO NOTHING;
INSERT INTO audit (id, ts, action_sn, action_id, text, level, target, reason) VALUES ('1781680168754.693', '2026-06-17T07:09:28.751Z'::timestamptz, 'ACT-028', (SELECT id FROM actions WHERE sn = 'ACT-028' LIMIT 1), 'Testing 1`', 4, 'MD', '900h overdue — Level 4 — MD Intervention') ON CONFLICT (action_sn, level) DO NOTHING;
INSERT INTO audit (id, ts, action_sn, action_id, text, level, target, reason) VALUES ('1781680168754.8115', '2026-06-17T07:09:28.751Z'::timestamptz, 'ACT-033', (SELECT id FROM actions WHERE sn = 'ACT-033' LIMIT 1), 'Escalation Testing', 3, 'Plant Head', '156h overdue — Level 3 — Plant Head Review') ON CONFLICT (action_sn, level) DO NOTHING;

-- ── Convenience view: actions with plant/dept/user names ───────
CREATE OR REPLACE VIEW v_actions AS
SELECT a.*,
       p.name  AS plant_name,
       d.name  AS dept_name,
       u.name  AS responsible_name,
       m.name  AS machine_name_ref,
       pr.name AS project_name,
       CASE
         WHEN a.due IS NULL THEN FALSE
         WHEN a.status IN ('COMPLETED','DROPPED') THEN FALSE
         ELSE a.due < CURRENT_DATE
       END AS is_overdue,
       CASE
         WHEN a.due IS NULL THEN 0
         WHEN a.status IN ('COMPLETED','DROPPED') THEN 0
         ELSE GREATEST(CURRENT_DATE - a.due, 0)
       END AS days_overdue
FROM actions a
LEFT JOIN plants       p  ON p.id  = a.plant_id
LEFT JOIN departments  d  ON d.id  = a.dept_id
LEFT JOIN users        u  ON u.id  = a.responsible_user_id
LEFT JOIN machines     m  ON m.id  = a.machine_id
LEFT JOIN projects     pr ON pr.id = a.project_id;

-- ── Convenience view: audit + action text ──────────────────────
CREATE OR REPLACE VIEW v_audit AS
SELECT au.*,
       a.text  AS action_text,
       a.sn    AS action_sn,
       a.status AS action_status,
       a.priority AS action_priority
FROM audit au
LEFT JOIN actions a ON a.id = au.action_id;

