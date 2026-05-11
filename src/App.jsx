import React, { useState, useEffect, useRef, useCallback } from "react";

/* ===================== GOOGLE SHEET CONFIG ===================== */
// 1. Deploy Code.gs as a Web App (Apps Script → Deploy → Web App → Anyone)
// 2. Paste the deployment URL below
const SHEET_SCRIPT_URL = import.meta.env.VITE_SHEET_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbzkxOs7ZMiioyG_gJiG_Vfyv0sJCLG_PZHZZm90G8lfqETVqPoPX5LrNvGLa3OxB7PHzA/exec";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://mcs-action.onrender.com";

const SHEET_ID = import.meta.env.VITE_SHEET_ID || "1OR4J17WrhQg9rqFV3uIhLCDG9UDCoQ5lc9-8ZXoNSOo";
const SHEET_ENABLED = SHEET_SCRIPT_URL !== "https://script.google.com/macros/s/AKfycbwA23TKT-62SutIeThFAEBGnDrzSXO5tuhgaUsrIZKXjV5sp0eoP7FvfQnMUdJ1t9Z3uQ/exec";

// CSV read URL (no auth needed for publicly shared sheets)
const csvUrl = (tab) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;

/* ─── Sheet API helpers ─────────────────────────────────────────────────── */
async function sheetGet(tab) {
  const res = await fetch(csvUrl(tab));
  if (!res.ok) throw new Error(`Sheet read failed: ${tab}`);
  const text = await res.text();
  return parseCsv(text);
}

async function sheetPost(action, tab, payload) {
  if (!SHEET_ENABLED) return null;
  const res = await fetch(SHEET_SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({ action, tab, ...payload }),
  });
  return res.json();
}

function parseCsv(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = parseCsvRow(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseCsvRow(line);
    const obj = {};
    headers.forEach((h, i) => {
      let v = vals[i] ?? "";
      // Auto-parse JSON arrays/objects stored in cells
      if (v.startsWith("[") || v.startsWith("{")) {
        try { v = JSON.parse(v); } catch { /* keep as string */ }
      }
      // Booleans
      if (v === "true") v = true;
      if (v === "false") v = false;
      // Numerics (only pure numbers, avoid corrupting IDs like "U01" or "007")
      if (v !== "" && /^-?\d+(\.\d+)?$/.test(v) && typeof v === "string") v = Number(v);
      obj[h] = v;
    });
    return obj;
  }).filter(r => Object.values(r).some(v => v !== "" && v !== null));
}

function parseCsvRow(line) {
  const result = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
    else if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { result.push(cur); cur = ""; }
    else cur += ch;
  }
  result.push(cur);
  return result;
}

/* ─── useSheetDB hook ───────────────────────────────────────────────────── */
// Replaces all hardcoded seeds with live Sheet data.
// Falls back to seeds if Sheet is unavailable.
function useSheetDB({ defaultUsers, defaultPlants, defaultDepts,
  defaultActions, defaultMeetings, defaultProjects, defaultEscMatrix, defaultPermissions, defaultPresets }) {
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState(null);
  const [users, setUsersRaw] = useState(defaultUsers);
  const [plants, setPlantsRaw] = useState(defaultPlants);
  const [depts, setDeptsRaw] = useState(defaultDepts);
  const [actions, setActionsRaw] = useState(defaultActions);
  const [meetings, setMeetingsRaw] = useState(defaultMeetings);
  const [projects, setProjectsRaw] = useState(defaultProjects);
  const [escMatrix, setEscRaw] = useState(defaultEscMatrix);
  const [permissions, setPermsRaw] = useState(defaultPermissions);
  const [mtgPresets, setPresetsRaw] = useState(defaultPresets);

  const fetchData = useCallback(async () => {
    if (!SHEET_ENABLED) { setDbReady(true); return; }
    try {
      const [u, p, d, a, m, pr, em, pm, ps] = await Promise.all([
        sheetGet("Users"),
        sheetGet("Plants"),
        sheetGet("Departments"),
        sheetGet("Actions"),
        sheetGet("Meetings"),
        sheetGet("Projects"),
        sheetGet("EscalationMatrix"),
        sheetGet("Permissions"),
        sheetGet("MeetingPresets"),
      ]);
      const sanitize = (arr, prefix) => (Array.isArray(arr) ? arr : [])
        .filter(x => x && Object.values(x).some(v => v !== "" && v !== null && v !== undefined))
        .map((x, i) => ({ ...x, id: (x.id !== undefined && x.id !== null && String(x.id).trim()) ? x.id : `${prefix}-${i}` }));
      if (u.length) setUsersRaw(sanitize(u, "u"));
      if (p.length) setPlantsRaw(sanitize(p, "p"));
      if (d.length) setDeptsRaw(sanitize(d, "d"));
      if (a.length) setActionsRaw(sanitize(a, "a"));
      if (m.length) setMeetingsRaw(sanitize(m, "m"));
      if (pr.length) setProjectsRaw(sanitize(pr, "pr"));
      if (em.length) setEscRaw(sanitize(em, "e"));
      if (pm.length) {
        const pObj = {};
        pm.forEach(row => { if (row.id) pObj[row.id] = row; });
        setPermsRaw(pObj);
      }
      if (ps.length) {
        const pMap = { attendeeMap: {}, instructions: {} };
        ps.forEach(row => {
          if (row.type) {
            pMap.attendeeMap[row.type] = row.attendees || [];
            pMap.instructions[row.type] = row.instructions || [];
          }
        });
        setPresetsRaw(pMap);
      }
      setDbReady(true);
    } catch (e) {
      console.warn("Sheet load failed, using seeds:", e.message);
      setDbError(e.message);
      setDbReady(true);
    }
  }, []);

  // ── initial load ──
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── write wrappers (side-effect-free updaters) ──
  const setUsers = useCallback((fn) => { setUsersRaw(fn); }, []);
  const setPlants = useCallback((fn) => { setPlantsRaw(fn); }, []);
  const setDepts = useCallback((fn) => { setDeptsRaw(fn); }, []);
  const setActions = useCallback((fn) => { setActionsRaw(fn); }, []);
  const setMeetings = useCallback((fn) => { setMeetingsRaw(fn); }, []);
  const setProjects = useCallback((fn) => { setProjectsRaw(fn); }, []);
  const setEscMatrix = useCallback((fn) => { setEscRaw(fn); }, []);
  const setPermissions = useCallback((fn) => { setPermsRaw(fn); }, []);
  const setMtgPresets = useCallback((fn) => { setPresetsRaw(fn); }, []);

  // ── Sync state changes to sheet via effects (only after initial load) ──
  // fetchDoneRef is set true only after a delay post-load, preventing the
  // sync effects from firing during the same render cycle as fetchData().
  // This stops seed/default data from overwriting the sheet on mount.
  const fetchDoneRef = useRef(false);
  useEffect(() => {
    if (dbReady) {
      const t = setTimeout(() => { fetchDoneRef.current = true; }, 1000);
      return () => clearTimeout(t);
    }
  }, [dbReady]);
  const syncToSheet = useCallback((tab, data) => {
    if (!SHEET_ENABLED || !fetchDoneRef.current) return;
    sheetPost("replace_all", tab, { rows: data });
  }, []);
  useEffect(() => { syncToSheet("Users", users); }, [users, syncToSheet]);
  useEffect(() => { syncToSheet("Plants", plants); }, [plants, syncToSheet]);
  useEffect(() => { syncToSheet("Departments", depts); }, [depts, syncToSheet]);
  useEffect(() => { syncToSheet("Actions", actions); }, [actions, syncToSheet]);
  useEffect(() => { syncToSheet("Meetings", meetings); }, [meetings, syncToSheet]);
  useEffect(() => { syncToSheet("Projects", projects); }, [projects, syncToSheet]);
  useEffect(() => { syncToSheet("EscalationMatrix", escMatrix); }, [escMatrix, syncToSheet]);
  useEffect(() => {
    if (!SHEET_ENABLED || !fetchDoneRef.current) return;
    const rows = Object.values(permissions);
    sheetPost("replace_all", "Permissions", { rows });
  }, [permissions]);
  useEffect(() => {
    if (!SHEET_ENABLED || !fetchDoneRef.current) return;
    const allTypes = Array.from(new Set([...Object.keys(mtgPresets.attendeeMap), ...Object.keys(mtgPresets.instructions)]));
    const rows = allTypes.map(t => ({ type: t, attendees: mtgPresets.attendeeMap[t] || [], instructions: mtgPresets.instructions[t] || [] }));
    sheetPost("replace_all", "MeetingPresets", { rows });
  }, [mtgPresets]);

  return {
    dbReady, dbError, fetchData,
    users, setUsers,
    plants, setPlants,
    depts, setDepts,
    actions, setActions,
    meetings, setMeetings,
    projects, setProjects,
    escMatrix, setEscMatrix,
    permissions, setPermissions,
    mtgPresets, setMtgPresets
  };
}

/* ===================== DATA LAYER ===================== */
// All user/plant/dept/action/meeting data is loaded exclusively from Google Sheets.
// No hardcoded seed data — sheet is the single source of truth.
const DEFAULT_PLANTS = [];
const DEFAULT_DEPTS = [];
const DEFAULT_USERS = [];
const MEETING_TYPES = ["Furnace Daily Review", "Daily Problem-Solving", "Daily Plant Head Review", "Weekly Plant Head", "Safety Review"];
const STATUS_LIST = ["IN PROCESS", "NOT STARTED", "COMPLETED", "DROPPED"];
const PRIORITY_LIST = ["CRITICAL", "WARNING", "NORMAL"];
const SECTIONS = ["Production", "Maintenance", "Quality", "Safety", "Electrical", "Mechanical", "Instrumentation", "Stores & Logistics", "Management", "General"];
const ATTENDEE_MAP = {
  "Furnace Daily Review": ["Anil Kumar", "Meena Joshi", "Amit Tiwari", "Sanjay Mishra"],
  "Daily Problem-Solving": ["Suresh Patel", "Ravi Gupta", "Kavita Rawat", "Neha Yadav"],
  "Safety Review": ["Amit Tiwari", "Meena Joshi", "Priya Singh", "Vijay Pandey"],
  "Daily Plant Head Review": ["Anil Kumar", "Meena Joshi", "Amit Tiwari", "Sanjay Mishra", "Vijay Pandey"],
  "Weekly Plant Head": ["Rajiv Sharma", "Anil Kumar", "Suresh Patel", "Deepak Verma", "Meena Joshi", "Ravi Gupta", "Priya Singh"],
};
const MTG_INSTRUCTIONS = {
  "Furnace Daily Review": ["Review heat-wise production vs target (MPM, Power, Mn)", "Identify deviations from the last 24 hours", "Assign owners and due dates for each gap", "Confirm previous action statuses before closing"],
  "Daily Problem-Solving": ["Present the top 3 problems from yesterday", "Use 5-Why to identify root causes", "Assign corrective actions with clear owners", "Track open actions from prior sessions"],
  "Daily Plant Head Review": ["Plant head to chair — no phones policy", "Review safety first, then production KPIs", "Each HOD presents department status in 3 minutes", "Escalate blockers that need cross-functional resolution"],
  "Weekly Plant Head": ["MD-level review of all three plants", "Compare plant performance using dashboard data", "Close completed strategic actions, escalate long-running ones", "Confirm priorities for the coming week"],
  "Safety Review": ["Start with near-miss and incident recap", "PPE compliance check results", "Assign corrective actions for each unsafe condition observed", "Set next review date before closing"],
};
const SEED_PROJECTS = [];
const SEED_MEETINGS = [];
const SEED_ACTIONS = [];
// Permissions are managed entirely from the Google Sheet (Permissions tab).
// This returns an empty object so the sheet is always the source of truth.
const DEFAULT_PERMISSIONS_SEED = () => ({});

const SAMPLE_TRANSCRIPT_LINES = [
  "Good morning everyone. Let's start with yesterday's production numbers.",
  "Heat 42 showed MPM deviation of 0.8 tonnes below target. Root cause under review.",
  "Action: Amit Tiwari to calibrate pressure sensors on Line 3 by next Tuesday.",
  "Power consumption was 8% above benchmark in Bay 2. Neha to inspect switchboard.",
  "Safety: PPE audit pending for furnace operators. Meena to schedule by end of week.",
  "Previous action ACT-007 — flow meter FM-28 has been closed as design limitation.",
  "Crane availability in bay 3 improved to 94%. Ravi's team acknowledged.",
  "Any other business? Next meeting same time tomorrow.",
];
const todayStr = () => new Date().toISOString().split("T")[0];
const fmt = s => { if (!s) return "—"; const d = new Date(s); return isNaN(d) ? s : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); };
const todayLocal = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const isOverdue = a => { if (!a.due || a.status === "COMPLETED" || a.status === "DROPPED") return false; const due = new Date(a.due + "T23:59:59"); return due < todayLocal(); };
const daysOver = a => { if (!isOverdue(a)) return 0; const due = new Date(a.due + "T23:59:59"); return Math.floor((todayLocal() - due) / 86400000); };
const getU = (name, users = []) => (users || []).find(u => u.name === name) || { initials: (name || "?").slice(0, 2).toUpperCase(), color: "#7C80B0", name: name || "Unknown" };
const nextSN = arr => "ACT-" + String(arr.length + 1).padStart(3, "0");
// Get all superiors of a user walking up the chain
const getSuperiors = (userName, allUsers) => {
  const chain = [];
  let cur = allUsers.find(u => u.name === userName);
  while (cur && cur.superior) {
    const sup = allUsers.find(u => u.name === cur.superior);
    if (!sup || chain.find(x => x.name === sup.name)) break;
    chain.push(sup);
    cur = sup;
  }
  return chain;
};
const DEFAULT_ESC_MATRIX = [
  { id: "E1", level: 1, label: "Level 1 — Supervisor Alert", overdueDays: 0, overdueHrs: 0, target: "Supervisor", notifyMethod: "In-App", priorities: ["CRITICAL", "WARNING", "NORMAL"], applicableTo: "All", color: "#E69903", active: true, description: "Immediate alert when action passes due date" },
  { id: "E2", level: 2, label: "Level 2 — HOD Escalation", overdueDays: 1, overdueHrs: 24, target: "HOD", notifyMethod: "In-App + Email", priorities: ["CRITICAL", "WARNING"], applicableTo: "All", color: "#E67E22", active: true, description: "Escalate to department head after 1 day overdue" },
  { id: "E3", level: 3, label: "Level 3 — Plant Head Review", overdueDays: 3, overdueHrs: 72, target: "Plant Head", notifyMethod: "In-App + Email", priorities: ["CRITICAL", "WARNING"], applicableTo: "All", color: "#C0392B", active: true, description: "Escalate to plant head after 3 days overdue" },
  { id: "E4", level: 4, label: "Level 4 — MD Intervention", overdueDays: 7, overdueHrs: 168, target: "MD", notifyMethod: "In-App + Email", priorities: ["CRITICAL"], applicableTo: "All", color: "#7B241C", active: false, description: "Critical actions unresolved beyond 7 days reach MD" },
];

function runEscalation(actions, setAudit, matrix) {
  const tiers = (matrix || DEFAULT_ESC_MATRIX).filter(t => t.active).sort((a, b) => b.overdueHrs - a.overdueHrs);
  const now = new Date(), alerts = [];
  const emailPayloads = {};

  actions.forEach(a => {
    if (a.status === "COMPLETED" || a.status === "DROPPED" || !a.due) return;
    const hrs = (now - new Date(a.due)) / 3600000;
    if (hrs < 0) return;
    const tier = tiers.find(t => hrs >= t.overdueHrs && t.priorities.includes(a.priority || "NORMAL"));
    if (tier) {
      alerts.push({ id: Date.now() + Math.random(), ts: now.toISOString(), sn: a.sn, text: a.text, level: tier.level, target: tier.target, reason: `${Math.floor(hrs)}h overdue — ${tier.label}` });
      if (tier.notifyMethod.includes("Email")) {
        if (!emailPayloads[tier.level]) emailPayloads[tier.level] = { actions: [], target: tier.target, level: tier.level };
        emailPayloads[tier.level].actions.push(a);
      }
    }
  });
  if (alerts.length) setAudit(p => [...alerts.slice(0, 5), ...p].slice(0, 100));

  Object.values(emailPayloads).forEach(payload => {
    if (payload.actions.length > 0 && API_BASE_URL) {
      fetch(`${API_BASE_URL}/api/email/escalate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).catch(e => console.warn("Escalation email failed", e));
    }
  });
}

/* ===================== DESIGN TOKENS & CSS ===================== */
const T = { navy: "#272262", navyD: "#1A1653", amber: "#E69903", amberL: "#FEF3CD", green: "#1E8449", greenL: "#D5F5E3", red: "#C0392B", redL: "#FADBD8", slate: "#7F8C8D", border: "#E8E8F0", bg: "#F5F5FB", white: "#FFFFFF", text: "#1A1532", text2: "#636E72" };
const SC = { "IN PROCESS": { bg: "#FFF3CD", text: "#856404", dot: "#E69903" }, "NOT STARTED": { bg: "#EAE7F8", text: "#4A3F8C", dot: "#7C80B0" }, "COMPLETED": { bg: "#D5F5E3", text: "#1E6B3C", dot: "#27AE60" }, "DROPPED": { bg: "#F2F3F4", text: "#7F8C8D", dot: "#BDC3C7" }, "PENDING CONFIRM": { bg: "#FEF9E7", text: "#784212", dot: "#F39C12" } };
const PC = { "CRITICAL": { bg: "#FADBD8", text: "#922B21" }, "WARNING": { bg: "#FEF9E7", text: "#784212" }, "NORMAL": { bg: "#EBF5FB", text: "#1A5276" } };
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Sora:wght@700;800&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{background:#F5F5FB;color:#1A1532;font-family:'Inter',sans-serif;font-size:14px;}
input,select,textarea{font-family:'Inter',sans-serif;font-size:13px;background:#fff;border:1.5px solid #E8E8F0;border-radius:8px;padding:8px 12px;color:#1A1532;outline:none;width:100%;transition:border-color .18s;direction:ltr;unicode-bidi:plaintext;}
input:focus,select:focus,textarea:focus{border-color:#272262;box-shadow:0 0 0 3px rgba(39,34,98,.08);}
input::placeholder,textarea::placeholder{color:#B2BEC3;}
::-webkit-scrollbar{width:5px;height:5px;}::-webkit-scrollbar-thumb{background:#CBD5E0;border-radius:3px;}
.card{background:#fff;border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(39,34,98,.05);}
.card-hover{transition:transform .18s,box-shadow .18s;cursor:pointer;}
.card-hover:hover{transform:translateY(-2px);box-shadow:0 6px 24px rgba(39,34,98,.13);}
.btn{border:none;border-radius:8px;cursor:pointer;font-family:'Inter',sans-serif;font-weight:600;font-size:13px;padding:9px 18px;display:inline-flex;align-items:center;gap:6px;transition:all .18s;white-space:nowrap;}
.btn-navy{background:#272262;color:#fff;}.btn-navy:hover{background:#1A1653;}
.btn-amber{background:#E69903;color:#fff;}.btn-amber:hover{background:#CA8500;}
.btn-green{background:#1E8449;color:#fff;}.btn-green:hover{background:#176339;}
.btn-ghost{background:transparent;color:#636E72;border:1.5px solid #E8E8F0;}.btn-ghost:hover{background:#F5F5FB;color:#1A1532;}
.btn-red{background:#C0392B;color:#fff;}.btn-red:hover{background:#A93226;}
.btn-sm{padding:6px 13px;font-size:12px;}.btn:disabled{opacity:.45;cursor:not-allowed;}
table{width:100%;border-collapse:collapse;}thead tr{background:#FAFAFE;}
th{padding:10px 14px;font-size:11px;font-weight:700;color:#636E72;letter-spacing:.5px;text-transform:uppercase;border-bottom:2px solid #E8E8F0;text-align:left;white-space:nowrap;}
td{padding:11px 14px;border-bottom:1px solid #F0F0F8;vertical-align:middle;font-size:13px;}
td.action-text{min-width:260px;max-width:420px;white-space:normal;word-break:break-word;line-height:1.4;}
tbody tr:hover td{background:#FAFAFE;}tbody tr:last-child td{border-bottom:none;}
@keyframes spin{to{transform:rotate(360deg);}}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}}
@keyframes slideUp{from{opacity:0;transform:translateY(24px);}to{opacity:1;transform:none;}}
@keyframes slideInR{from{opacity:0;transform:translateX(60px);}to{opacity:1;transform:none;}}
@keyframes blink{0%,100%{opacity:1;}50%{opacity:.2;}}
@keyframes pulse{0%,100%{transform:scale(1);}50%{transform:scale(1.04);}}
.fade-in{animation:fadeIn .3s ease;}
.overlay{position:fixed;inset:0;background:rgba(26,21,50,.5);z-index:300;display:flex;align-items:center;justify-content:center;padding:20px;}
.modal{background:#fff;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.2);max-height:90vh;overflow-y:auto;animation:slideUp .3s ease;}
.side-panel{position:fixed;top:0;right:0;height:100vh;background:#fff;box-shadow:-8px 0 40px rgba(0,0,0,.12);z-index:350;overflow-y:auto;animation:slideInR .25s ease;}
.fab{position:fixed;bottom:28px;right:28px;width:52px;height:52px;border-radius:50%;background:#272262;color:#fff;border:none;font-size:26px;cursor:pointer;box-shadow:0 6px 24px rgba(39,34,98,.35);display:flex;align-items:center;justify-content:center;z-index:200;transition:all .2s;}
.fab:hover{background:#1A1653;transform:scale(1.08);}
.drag-over{background:#EAE7F8!important;border:2px dashed #272262!important;}
.kanban-card{transition:transform .15s,box-shadow .15s,opacity .15s;}
.kanban-card:active{cursor:grabbing!important;}
.kanban-card.is-dragging{opacity:.45;transform:scale(.97);box-shadow:none!important;}
.kanban-card.is-lifted{transform:rotate(2deg) scale(1.04);box-shadow:0 16px 40px rgba(39,34,98,.22)!important;cursor:grabbing!important;z-index:10;}
.confirm-banner{background:linear-gradient(90deg,#FEF9E7,#FFFDE0);border:1.5px solid #E69903;border-radius:10px;padding:12px 16px;animation:pulse 2s ease-in-out infinite;}
`;
/* ===================== MICRO COMPONENTS ===================== */
function SBadge({ s }) { const c = SC[s] || { bg: "#eee", text: "#333", dot: "#aaa" }; return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 20, background: c.bg, color: c.text, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: c.dot, flexShrink: 0 }} />{s}</span>; }
function PBadge({ p }) { const c = PC[p] || { bg: "#eee", text: "#333" }; return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 20, background: c.bg, color: c.text, fontSize: 11, fontWeight: 600 }}>{p}</span>; }
function Avatar({ name, size = 30, users = [] }) { const u = getU(name, users); return <span title={name} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: "50%", background: u.color + "20", color: u.color, fontSize: size * .34, fontWeight: 700, flexShrink: 0, border: `1.5px solid ${u.color}30` }}>{u.initials}</span>; }
function Lbl({ t, req }) { return <label style={{ fontSize: 11, color: T.text2, display: "block", marginBottom: 5, fontWeight: 600, letterSpacing: .3 }}>{t}{req && <span style={{ color: T.red, marginLeft: 2 }}>*</span>}</label>; }
function HR() { return <div style={{ height: 1, background: T.border, margin: "16px 0" }} />; }
function Spin() { return <span style={{ width: 14, height: 14, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} />; }
function Empty({ icon, title, sub }) { return <div style={{ textAlign: "center", padding: "48px 24px", color: T.text2 }}><div style={{ fontSize: 36, marginBottom: 12 }}>{icon}</div><div style={{ fontWeight: 600, fontSize: 14, color: T.text, marginBottom: 4 }}>{title}</div><div style={{ fontSize: 12 }}>{sub}</div></div>; }
function Chip({ label, color = "#272262" }) { return <span style={{ padding: "2px 9px", borderRadius: 20, background: color + "15", color, fontSize: 11, fontWeight: 600 }}>{label}</span>; }
function KPICard({ icon, value, label, sub, color, onClick, alert: al }) {
  return <div className="card card-hover" onClick={onClick} style={{ padding: "14px 16px", position: "relative" }}>
    {al && <span style={{ position: "absolute", top: 10, right: 10, width: 8, height: 8, borderRadius: "50%", background: T.red, animation: "blink 1.2s ease-in-out infinite" }} />}
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, background: color + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{icon}</div>
      <div style={{ fontFamily: "'Sora',sans-serif", fontSize: 24, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
    </div>
    <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{label}</div>
    {sub && <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>{sub}</div>}
    {onClick && <div style={{ fontSize: 10, color: T.navy, marginTop: 6, fontWeight: 700, letterSpacing: .5, textTransform: "uppercase" }}>View →</div>}
  </div>;
}
function PageHeader({ title, sub, children }) {
  return <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
    <div><h1 style={{ fontFamily: "'Sora',sans-serif", fontSize: 22, fontWeight: 800, color: T.navy, lineHeight: 1.2 }}>{title}</h1>{sub && <p style={{ fontSize: 13, color: T.text2, marginTop: 4 }}>{sub}</p>}</div>
    {children && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{children}</div>}
  </div>;
}
function Sparkbar({ pct, color }) {
  return <div style={{ background: T.border, borderRadius: 4, height: 6, overflow: "hidden", flex: 1 }}>
    <div style={{ height: "100%", borderRadius: 4, background: color, width: `${pct}%`, transition: "width .6s" }} />
  </div>;
}
/* ESC-close hook */
function useEscClose(fn) { useEffect(() => { const h = e => { if (e.key === "Escape") fn(); }; document.addEventListener("keydown", h); return () => document.removeEventListener("keydown", h); }, [fn]); }

/* ===================== LOGIN PAGE ===================== */
function LoginPage({ onLogin }) {
  const [u, setU] = useState(""), pw = useRef(null);
  const [errMsg, setErrMsg] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  // Sheet connection status: "checking" | "connected" | "offline"
  const [connStatus, setConnStatus] = useState("checking");
  const [userCount, setUserCount] = useState(0);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(csvUrl("Users"));
        if (!res.ok) throw new Error("bad response");
        const text = await res.text();
        const rows = parseCsv(text);
        setUserCount(rows.length);
        setConnStatus("connected");
      } catch (e) {
        setConnStatus("offline");
      }
    })();
  }, []);
  const tryLogin = async () => {
    setLoading(true); setErrMsg("");
    try {
      const res = await fetch(csvUrl("Users"));
      if (!res.ok) throw new Error("Sheet unreachable");
      const text = await res.text();
      const sheetUsers = parseCsv(text);
      const uname = u.trim().toLowerCase();
      const pwval = pw.current.value;
      const acc = sheetUsers.find(a =>
        a.username && a.password &&
        String(a.username).trim().toLowerCase() === uname &&
        String(a.password).trim() === pwval
      );
      if (acc) onLogin(acc);
      else setErrMsg("Invalid username or password");
    } catch (err) {
      setErrMsg("Cannot reach Google Sheet. Check your connection or Sheet URL.");
    }
    setLoading(false);
  };
  return (
    <div style={{ minHeight: "100vh", background: `linear-gradient(135deg,${T.navy} 0%,#3D378C 100%)`, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: 420, background: "#fff", borderRadius: 20, padding: 36, boxShadow: "0 24px 80px rgba(0,0,0,.25)" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          {/* Adroit + Signet dual branding */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 22, color: T.navy, letterSpacing: 1 }}>ADROIT</div>
              <div style={{ fontSize: 9, color: T.text2, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase" }}>Industries</div>
            </div>
            <div style={{ width: 1.5, height: 36, background: T.border, borderRadius: 2 }} />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 22, color: T.amber, letterSpacing: 1 }}>SIGNET</div>
              <div style={{ fontSize: 9, color: T.text2, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase" }}>Industries</div>
            </div>
          </div>
          <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 18, color: T.navy, lineHeight: 1.2 }}>Management Control System</div>
          <div style={{ fontSize: 11, color: T.text2, marginTop: 6 }}>Decentralized Work Management Platform</div>
        </div>
        {/* ── Sheet connection indicator ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, marginBottom: 20, padding: "7px 14px", borderRadius: 20, background: connStatus === "connected" ? "#D5F5E3" : connStatus === "offline" ? "#FADBD8" : "#EAE7F8", border: `1px solid ${connStatus === "connected" ? "#27AE6040" : connStatus === "offline" ? "#C0392B40" : "#7C80B040"}` }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: connStatus === "connected" ? "#27AE60" : connStatus === "offline" ? "#C0392B" : "#7C80B0", animation: connStatus === "checking" ? "blink 1.2s ease-in-out infinite" : "none" }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: connStatus === "connected" ? T.green : connStatus === "offline" ? T.red : "#4A3F8C" }}>
            {connStatus === "checking" && "Connecting to Google Sheet…"}
            {connStatus === "connected" && `Sheet connected — ${userCount} user${userCount !== 1 ? "s" : ""} loaded`}
            {connStatus === "offline" && "Sheet offline — using local data"}
          </span>
        </div>
        <div style={{ marginBottom: 14 }}><Lbl t="Username" req /><input value={u} onChange={e => setU(e.target.value)} placeholder="Enter your username" onKeyDown={e => e.key === "Enter" && tryLogin()} /></div>
        <div style={{ marginBottom: 20 }}>
          <Lbl t="Password" req />
          <div style={{ position: "relative" }}>
            <input ref={pw} type={showPw ? "text" : "password"} placeholder="••••••••" onKeyDown={e => e.key === "Enter" && tryLogin()} style={{ paddingRight: 44 }} />
            <button onClick={() => setShowPw(p => !p)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", cursor: "pointer", fontSize: 16, color: T.text2, lineHeight: 1, padding: 0, display: "flex", alignItems: "center" }}>{showPw ? "🙈" : "👁"}</button>
          </div>
        </div>
        {errMsg && <div style={{ background: T.redL, color: T.red, padding: "8px 12px", borderRadius: 8, fontSize: 12, marginBottom: 14, fontWeight: 500 }}>{errMsg}</div>}
        <button className="btn btn-navy" style={{ width: "100%", justifyContent: "center", fontSize: 14, padding: "12px 0" }} onClick={tryLogin} disabled={loading}>
          {loading ? <><Spin /> Signing in…</> : "Sign In"}
        </button>
        <div style={{ textAlign: "center", marginTop: 20, fontSize: 10, color: T.text2 }}>Powered by Adroit × Signet</div>      </div>
    </div>
  );
}

/* ===================== SHELL ===================== */
const NAV = [{ id: 0, icon: "🏠", label: "Home" }, { id: 1, icon: "📋", label: "Work" }, { id: 2, icon: "✅", label: "Actions" }, { id: 3, icon: "📊", label: "Dashboard" }, { id: 4, icon: "🚨", label: "Escalations" }];

/* ============ NOTIFICATION SYSTEM ============ */
// Generates in-app notifications from audit, actions and user context
function useNotifications(actions, audit, user) {
  const [notifs, setNotifs] = useState([]);
  // Track dismissed IDs for this session — cleared notifications won't reappear
  const dismissedIds = useRef(new Set());

  useEffect(() => {
    if (!user) return;
    const newNotifs = [];
    const now = Date.now();

    // 1. Actions where user is mentioned in messages
    actions.forEach(a => {
      (Array.isArray(a.messages) ? a.messages : []).forEach(m => {
        if (m.text && m.text.includes("@" + user.name) && m.author !== user.name) {
          newNotifs.push({
            id: "msg_" + a.id + "_" + m.ts, type: "mention", icon: "💬",
            title: "Mentioned in " + a.sn, body: `${m.author} mentioned you: "${m.text.slice(0, 40)}…"`,
            ts: m.ts || now, read: false, sn: a.sn
          });
        }
      });
    });

    // 2. Actions escalated to user (target matches user role)
    audit.forEach(e => {
      const action = actions.find(a => a.sn === e.sn);
      if (!action) return;
      if (e.target === user.role || e.target === "All") {
        newNotifs.push({
          id: "esc_" + e.id, type: "escalation", icon: "🚨",
          title: "Action Escalated to You", body: `${action.sn} — ${action.text.slice(0, 50)} (L${e.level})`,
          ts: e.ts || now, read: false, sn: action.sn
        });
      }
    });

    // 3. My actions with revised due dates (revisions > 0, and I'm responsible)
    actions.filter(a => a.responsible === user.name && a.revisions > 0).forEach(a => {
      const lastRev = a.revisionHistory?.[a.revisionHistory.length - 1];
      if (lastRev) {
        newNotifs.push({
          id: "rev_" + a.id, type: "revision", icon: "📅",
          title: "Due Date Revised", body: `${a.sn} due date changed from ${lastRev.from} to ${lastRev.to} by ${lastRev.by}`,
          ts: lastRev.date || now, read: false, sn: a.sn
        });
      }
    });

    // 4. My overdue actions
    actions.filter(a => a.responsible === user.name && isOverdue(a)).forEach(a => {
      newNotifs.push({
        id: "over_" + a.id, type: "overdue", icon: "⚠",
        title: "Action Overdue", body: `${a.sn} — ${a.text.slice(0, 50)} was due ${fmt(a.due)}`,
        ts: a.due, read: false, sn: a.sn
      });
    });

    // Deduplicate, exclude dismissed, and limit
    const deduped = Object.values(newNotifs.reduce((acc, n) => { acc[n.id] = n; return acc; }, {}))
      .filter(n => !dismissedIds.current.has(n.id))
      .sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 50);
    setNotifs(deduped);
  }, [actions, audit, user]);

  const unread = notifs.filter(n => !n.read).length;
  const markAllRead = () => {
    // Add all current IDs to dismissed set so they don't come back this session
    notifs.forEach(n => dismissedIds.current.add(n.id));
    setNotifs([]);
  };
  const markRead = (id) => {
    dismissedIds.current.add(id);
    setNotifs(p => p.filter(n => n.id !== id));
  };
  return { notifs, unread, markAllRead, markRead };
}

/* Support message modal */
function SupportModal({ user, onClose }) {
  useEscClose(onClose);
  const [msg, setMsg] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ width: 420, padding: 28 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontFamily: "'Sora',sans-serif", fontSize: 16, fontWeight: 800, color: T.navy }}>💬 Application Support</h2>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 22, color: T.text2 }}>×</button>
        </div>
        {sent ? <div style={{ textAlign: "center", padding: "24px 0" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 8 }}>Message Sent!</div>
          <div style={{ fontSize: 12, color: T.text2 }}>Admin has been notified. You'll receive a response in-app.</div>
          <button className="btn btn-navy" style={{ marginTop: 20 }} onClick={onClose}>Close</button>
        </div> : <>
          <div style={{ marginBottom: 12, fontSize: 12, color: T.text2 }}>Send a message to your system administrator for help, access requests, or issues.</div>
          <Lbl t="Your Message" req />
          <textarea value={msg} onChange={e => setMsg(e.target.value)} placeholder="Describe your issue or request…" style={{ height: 100, resize: "none", marginBottom: 16 }} />
          <div style={{ fontSize: 11, color: T.text2, marginBottom: 16 }}>Sent by: <b>{user?.name}</b> · {user?.role} · {user?.plant}</div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-navy" disabled={!msg.trim()} onClick={() => { if (msg.trim()) setSent(true); }}>Send Message</button>
          </div>
        </>}
      </div>
    </div>
  );
}

/* User Profile Panel */
function UserProfilePanel({ user, users, actions, onClose, onRequestChange }) {
  useEscClose(onClose);
  const [tab, setTab] = useState("profile");
  const [photo, setPhoto] = useState(null);
  const [reqChange, setReqChange] = useState(false);
  const [reqMsg, setReqMsg] = useState("");
  const [reqSent, setReqSent] = useState(false);

  const myActions = actions.filter(a => a.responsible === user?.name);
  const myTeam = users.filter(u => u.superior === user?.name);
  const myOpen = myActions.filter(a => a.status !== "COMPLETED" && a.status !== "DROPPED").length;
  const myOverdue = myActions.filter(isOverdue).length;
  const myDone = myActions.filter(a => a.status === "COMPLETED").length;

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", zIndex: 340 }} onClick={onClose} />
      <div className="side-panel" style={{ width: 420, padding: 0 }}>
        {/* Header with avatar */}
        <div style={{ background: `linear-gradient(135deg,${T.navy},${T.navyD})`, padding: "24px 20px", color: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ fontSize: 10, opacity: .6, letterSpacing: 1, textTransform: "uppercase" }}>My Profile</div>
            <button onClick={onClose} style={{ background: "rgba(255,255,255,.15)", border: "none", color: "#fff", borderRadius: 8, width: 28, height: 28, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ position: "relative" }}>
              {photo
                ? <img src={photo} alt="Profile" style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover", border: "3px solid rgba(255,255,255,.3)" }} />
                : <div style={{ width: 64, height: 64, borderRadius: "50%", background: user?.color || T.amber, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, color: "#fff", border: "3px solid rgba(255,255,255,.3)" }}>{user?.initials || "?"}</div>
              }
              <label style={{ position: "absolute", bottom: 0, right: 0, background: T.amber, borderRadius: "50%", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 11 }} title="Upload photo">
                📷<input type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = ev => setPhoto(ev.target.result); r.readAsDataURL(f); } }} />
              </label>
            </div>
            <div>
              <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 18, lineHeight: 1.1 }}>{user?.name}</div>
              <div style={{ fontSize: 12, opacity: .7, marginTop: 3 }}>{user?.role} · {user?.plant}</div>
              <div style={{ fontSize: 11, opacity: .5, marginTop: 2 }}>{user?.email}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 20, marginTop: 16, borderTop: "1px solid rgba(255,255,255,.1)", paddingTop: 14 }}>
            {[{ l: "Open", v: myOpen, c: T.amber }, { l: "Overdue", v: myOverdue, c: T.red }, { l: "Done", v: myDone, c: T.green }].map(k => (
              <div key={k.l} style={{ textAlign: "center" }}>
                <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 20, color: k.c }}>{k.v}</div>
                <div style={{ fontSize: 10, opacity: .6, marginTop: 2 }}>{k.l}</div>
              </div>
            ))}
          </div>
        </div>
        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${T.border}` }}>
          {[["profile", "👤 Info"], ["team", "👥 My Team"]].map(([id, l]) => (
            <button key={id} onClick={() => setTab(id)} style={{ flex: 1, padding: "10px 0", border: "none", background: "transparent", cursor: "pointer", fontSize: 12, fontWeight: tab === id ? 700 : 400, color: tab === id ? T.navy : T.text2, borderBottom: tab === id ? `2.5px solid ${T.navy}` : "2.5px solid transparent", marginBottom: -1 }}>
              {l}
            </button>
          ))}
        </div>
        <div style={{ padding: 20, overflowY: "auto" }}>
          {tab === "profile" && <>
            <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
              {[["Full Name", user?.name], ["Role", user?.role], ["Plant", user?.plant], ["Department", user?.dept || "—"], ["Reports To", user?.superior || "Top Level"], ["Phone", user?.phone || "—"], ["Email", user?.email || "—"]].map(([l, v]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${T.border}` }}>
                  <span style={{ fontSize: 12, color: T.text2, fontWeight: 600 }}>{l}</span>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{v}</span>
                </div>
              ))}
            </div>
            {reqChange ? <>
              <Lbl t="Request Info Change" />
              <textarea value={reqMsg} onChange={e => setReqMsg(e.target.value)} placeholder="Describe what needs to be changed (e.g., phone number, department, reporting line)…" style={{ height: 80, resize: "none", marginBottom: 10 }} />
              {reqSent ? <div style={{ color: T.green, fontSize: 12, fontWeight: 600 }}>✅ Request sent to admin!</div>
                : <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setReqChange(false); setReqMsg(""); }}>Cancel</button>
                  <button className="btn btn-navy btn-sm" disabled={!reqMsg.trim()} onClick={() => { if (reqMsg.trim()) setReqSent(true); }}>Send Request</button>
                </div>}
            </>
              : <button className="btn btn-ghost btn-sm" onClick={() => setReqChange(true)}>✏ Request Info Change</button>}
          </>}
          {tab === "team" && <>
            <div style={{ fontWeight: 600, fontSize: 13, color: T.navy, marginBottom: 12 }}>Direct Reports ({myTeam.length})</div>
            {myTeam.length === 0 ? <Empty icon="👤" title="No direct reports" sub="No one reports to you in the current org structure." /> :
              myTeam.map(u => {
                const uActions = actions.filter(a => a.responsible === u.name);
                const uOpen = uActions.filter(a => a.status !== "COMPLETED" && a.status !== "DROPPED").length;
                const uOver = uActions.filter(isOverdue).length;
                return (
                  <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${T.border}` }}>
                    <Avatar name={u.name} size={36} users={users} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: T.text2 }}>{u.role} · {u.plant}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: uOver > 0 ? T.red : T.text2 }}>{uOpen} open{uOver > 0 ? `, ${uOver} overdue` : ""}</div>
                    </div>
                  </div>
                );
              })
            }
          </>}
        </div>
      </div>
    </>
  );
}

/* Admin Notifications Manager */
function AdminNotifManager({ users, onClose }) {
  useEscClose(onClose);
  const [notifRules, setNotifRules] = useState([
    { id: 1, label: "Overdue reminder", trigger: "overdue", freq: "daily", target: "responsible", active: true },
    { id: 2, label: "Escalation alert", trigger: "escalation", freq: "immediate", target: "manager", active: true },
    { id: 3, label: "Due date revision", trigger: "revision", freq: "immediate", target: "responsible", active: true },
    { id: 4, label: "Weekly summary", trigger: "weekly_report", freq: "weekly", target: "all_users", active: false },
  ]);
  const toggleRule = id => setNotifRules(p => p.map(r => r.id === id ? { ...r, active: !r.active } : r));
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ width: 500, padding: 28 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ fontFamily: "'Sora',sans-serif", fontSize: 16, fontWeight: 800, color: T.navy }}>🔔 Admin Notification Rules</h2>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 22, color: T.text2 }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: T.text2, marginBottom: 16 }}>Configure system-wide notification triggers. These rules apply to all users.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {notifRules.map(r => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, background: T.bg, border: `1.5px solid ${r.active ? T.navy + "30" : T.border}` }}>
              <button onClick={() => toggleRule(r.id)} style={{ background: r.active ? T.green : "#e2e8f0", border: "none", borderRadius: 12, width: 42, height: 22, cursor: "pointer", transition: "all .2s", position: "relative", flexShrink: 0 }}>
                <span style={{ position: "absolute", top: 2, left: r.active ? 22 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.3)", transition: "all .2s", display: "block" }} />
              </button>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{r.label}</div>
                <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>Frequency: {r.freq} · Target: {r.target.replace(/_/g, " ")}</div>
              </div>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: r.active ? T.greenL : T.border, color: r.active ? T.green : T.text2, fontWeight: 600 }}>{r.active ? "Active" : "Paused"}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
          <button className="btn btn-navy" onClick={onClose}>Save & Close</button>
        </div>
      </div>
    </div>
  );
}
function Shell({ children, page, setPage, user, onLogout, onQuickAdd, pendingCount, auditCount, activeMtg, onResumeActiveMtg, mtgRunning, mtgElapsed, notifications, onMarkAllRead, unreadCount, users, actions, onShowSupport, onShowProfile, onShowAdminNotifs }) {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const isAdmin = user?.role === "Admin";
  const hms = s => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: T.bg }}>
      <aside style={{ width: 228, background: T.navy, color: "#fff", display: "flex", flexDirection: "column", flexShrink: 0, position: "sticky", top: 0, height: "100vh" }}>
        <div style={{ padding: "20px 18px 16px", borderBottom: "1px solid rgba(255,255,255,.1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: T.amber, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 12, flexShrink: 0 }}>MCS</div>
            <div>
              <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 11, lineHeight: 1.1 }}>Management Control System</div>
              <div style={{ fontSize: 9, color: T.amber, letterSpacing: 1.5, textTransform: "uppercase", marginTop: 2, fontWeight: 700 }}>Actions</div>
            </div>
          </div>
        </div>
        <nav style={{ padding: "14px 10px", flex: 1 }}>
          {NAV.map(n => {
            const active = page === n.id; return (
              <button key={n.id} onClick={() => setPage(n.id)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 12px", borderRadius: 10, border: "none", cursor: "pointer", marginBottom: 3, textAlign: "left", fontFamily: "'Inter',sans-serif", fontSize: 13, fontWeight: active ? 600 : 400, background: active ? "rgba(255,255,255,.15)" : "transparent", color: active ? "#fff" : "rgba(255,255,255,.65)", transition: "all .2s", position: "relative" }}>
                <span style={{ fontSize: 16, width: 22, textAlign: "center", flexShrink: 0 }}>{n.icon}</span>
                <span style={{ flex: 1 }}>{n.label}</span>
                {n.id
                  === 2 && pendingCount > 0 && <span style={{ background: T.red, color: "#fff", borderRadius: 10, padding: "1px 7px", fontSize: 10, fontWeight: 700, minWidth: 18, textAlign: "center" }}>{pendingCount}</span>}
                {n.id === 4 && auditCount > 0 && <span style={{ background: T.amber, color: "#fff", borderRadius: 10, padding: "1px 7px", fontSize: 10, fontWeight: 700, minWidth: 18, textAlign: "center" }}>{auditCount}</span>}
                {active && <span style={{ width: 3, height: 20, borderRadius: 2, background: T.amber, position: "absolute", right: 8 }} />}
              </button>
            );
          })}
        </nav>
        <div style={{ borderTop: "1px solid rgba(255,255,255,.1)" }}>
          {/* Notification Bell — fixed in sidebar, no overlap with content area */}
          <div style={{ padding: "8px 18px", borderBottom: "1px solid rgba(255,255,255,.08)", position: "relative" }}>
            <button onClick={() => { setShowNotifPanel(p => !p); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", border: "none", background: showNotifPanel ? "rgba(255,255,255,.12)" : "transparent", cursor: "pointer", borderRadius: 8, padding: "6px 8px", color: "rgba(255,255,255,.75)", fontSize: 12, fontFamily: "'Inter',sans-serif", position: "relative" }}>
              <span style={{ fontSize: 16, width: 22, textAlign: "center", flexShrink: 0 }}>🔔</span>
              <span style={{ flex: 1, textAlign: "left", fontWeight: 500 }}>Notifications</span>
              {unreadCount > 0 && <span style={{ background: T.red, color: "#fff", borderRadius: 10, padding: "1px 7px", fontSize: 10, fontWeight: 700, minWidth: 18, textAlign: "center" }}>{unreadCount}</span>}
            </button>
            {showNotifPanel && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 180 }} onClick={() => setShowNotifPanel(false)} />
                <div style={{ position: "absolute", bottom: "100%", left: 10, right: 10, background: "#fff", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,.2)", padding: 0, zIndex: 190, maxHeight: 380, overflowY: "auto", animation: "slideUp .2s ease" }}>
                  <div style={{ padding: "12px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: "#fff", borderRadius: "12px 12px 0 0" }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: T.navy }}>🔔 Notifications</div>
                    {(notifications || []).length > 0 && <button onClick={e => { e.stopPropagation(); onMarkAllRead && onMarkAllRead(); }} style={{ fontSize: 10, color: T.text2, border: "none", background: "transparent", cursor: "pointer", fontWeight: 600 }}>Mark all read</button>}
                  </div>
                  {(notifications || []).length === 0
                    ? <div style={{ padding: "24px 14px", textAlign: "center", color: T.text2, fontSize: 12 }}>No notifications</div>
                    : (notifications || []).slice(0, 20).map(n => (
                      <div key={n.id} style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, background: n.read ? "transparent" : "#F0F0FF", display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{n.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: n.read ? 500 : 700, fontSize: 12, color: T.text, marginBottom: 2 }}>{n.title}</div>
                          <div style={{ fontSize: 11, color: T.text2, lineHeight: 1.4, wordBreak: "break-word" }}>{n.body}</div>
                        </div>
                        {!n.read && <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.navy, flexShrink: 0, marginTop: 4 }} />}
                      </div>
                    ))
                  }
                </div>
              </>
            )}
          </div>
          {isAdmin && (
            <button onClick={() => setPage(99)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 18px", border: "none", cursor: "pointer", background: page === 99 ? "rgba(255,255,255,.1)" : "transparent", color: "rgba(255,255,255,.45)", fontSize: 12, fontFamily: "'Inter',sans-serif", transition: "all .2s" }}>
              <span style={{ fontSize: 14 }}>⚙</span><span>Master Setup</span>
            </button>
          )}

          <div style={{ padding: "12px 18px", position: "relative" }}>
            <button onClick={() => setShowUserMenu(p => !p)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: user?.color || T.amber, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0, color: "#fff" }}>{user?.initials || "?"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name}</div>
                <div style={{ fontSize: 10, opacity: .5, color: "#fff" }}>{user?.role} · {user?.plant === "All" ? "All Plants" : user?.plant}</div>
              </div>
              <span style={{ color: "rgba(255,255,255,.4)", fontSize: 12 }}>▲</span>
            </button>
            {showUserMenu && (
              <div style={{ position: "absolute", bottom: "100%", left: 10, right: 10, background: "#fff", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,.15)", padding: 8, zIndex: 200 }}>
                <div style={{ padding: "8px 12px", borderBottom: `1px solid ${T.border}`, marginBottom: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{user?.name}</div>
                  <div style={{ fontSize: 11, color: T.text2 }}>{user?.role} — {user?.plant}</div>
                </div>
                {user?.role !== "Guest" && <button onClick={() => { setShowUserMenu(false); onShowProfile && onShowProfile(); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px", border: "none", background: "transparent", cursor: "pointer", color: T.text, fontSize: 13, fontWeight: 600, borderRadius: 8 }}>👤 My Profile</button>}
                {user?.role !== "Guest" && user?.role !== "Admin" && Number(page) !== 3 && Number(page) !== 4 && <button onClick={() => { setShowUserMenu(false); onShowSupport && onShowSupport(); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px", border: "none", background: "transparent", cursor: "pointer", color: T.navy, fontSize: 13, fontWeight: 600, borderRadius: 8 }}>💬 Get Support</button>}
                {isAdmin && Number(page) !== 3 && Number(page) !== 4 && <button onClick={() => { setShowUserMenu(false); onShowAdminNotifs && onShowAdminNotifs(); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px", border: "none", background: "transparent", cursor: "pointer", color: T.amber, fontSize: 13, fontWeight: 600, borderRadius: 8 }}>🔔 Notification Rules</button>}
                <button onClick={() => { setShowUserMenu(false); onLogout(); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px", border: "none", background: "transparent", cursor: "pointer", color: T.red, fontSize: 13, fontWeight: 600, borderRadius: 8 }}>🚪 Sign Out</button>
              </div>
            )}
          </div>
        </div>
      </aside>
      <main style={{ flex: 1, overflow: "auto", minWidth: 0, position: "relative" }}>

        {/* Floating "Meeting Running" pill when away from Work page */}
        {activeMtg && page !== 1 && (
          <div onClick={onResumeActiveMtg} style={{ position: "sticky", top: 0, zIndex: 400, background: `linear-gradient(90deg,${T.red},#C0392B)`, color: "#fff", padding: "8px 20px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", boxShadow: "0 2px 12px rgba(0,0,0,.2)" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#fff", animation: mtgRunning ? "blink 1s infinite" : "none", flexShrink: 0 }} />
            <span style={{ fontWeight: 700, fontSize: 13 }}>Meeting in progress: {activeMtg.type}</span>
            {mtgRunning && <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14, background: "rgba(0,0,0,.2)", padding: "2px 8px", borderRadius: 5 }}>{hms(mtgElapsed || 0)}</span>}
            <span style={{ marginLeft: "auto", background: "rgba(255,255,255,.2)", borderRadius: 6, padding: "3px 12px", fontSize: 12, fontWeight: 700 }}>↩ Return to Meeting</span>
          </div>
        )}

        <div style={{ padding: 28, minHeight: "100vh", paddingTop: 20 }}>{children}</div>
      </main>
      <button className="fab" onClick={onQuickAdd} title="Quick add action">+</button>
    </div>
  );
}

/* ===================== HOME PAGE ===================== */
/* ActionSidePanel — slide-in detail panel used across HomePage */
function ActionSidePanel({ action, onClose, onUpdate, users, plants, depts }) {
  useEscClose(onClose);
  const [editField, setEditField] = useState(null);
  const [fieldVal, setFieldVal] = useState("");
  const [msg, setMsg] = useState("");
  const startEdit = (k, v) => { setEditField(k); setFieldVal(v || ""); };
  const commit = () => { if (onUpdate && editField) onUpdate(action.id, { [editField]: fieldVal }); setEditField(null); };
  const sendMsg = () => { if (!msg.trim()) return; const m = { id: Date.now(), author: "Me", text: msg.trim(), ts: new Date().toLocaleTimeString() }; onUpdate && onUpdate(action.id, { messages: [...(action.messages || []), m] }); setMsg(""); };
  const InlineField = ({ label, k, value, type = "text", opts }) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.text2, textTransform: "uppercase", letterSpacing: .4, marginBottom: 3 }}>{label}</div>
      {editField === k
        ? <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {opts ? <select value={fieldVal} onChange={e => setFieldVal(e.target.value)} style={{ flex: 1, fontSize: 12, padding: "4px 8px" }}>{opts.map(o => <option key={o}>{o}</option>)}</select>
            : <input value={fieldVal} onChange={e => setFieldVal(e.target.value)} autoFocus style={{ flex: 1, fontSize: 12, padding: "4px 8px" }} />}
          <button onClick={commit} style={{ background: T.green, color: "#fff", border: "none", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontSize: 12 }}>✓</button>
          <button onClick={() => setEditField(null)} style={{ background: T.border, color: T.text, border: "none", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontSize: 12 }}>✕</button>
        </div>
        : <div style={{ fontSize: 13, color: T.text, padding: "4px 8px", borderRadius: 6, background: T.bg, cursor: "pointer", border: `1px solid transparent`, transition: "all .15s" }} onClick={() => startEdit(k, value)}
          onMouseEnter={e => e.currentTarget.style.border = `1px solid ${T.border}`}
          onMouseLeave={e => e.currentTarget.style.border = "1px solid transparent"}>
          {value || <span style={{ color: T.text2, fontStyle: "italic" }}>—</span>}
          <span style={{ fontSize: 9, color: T.text2, marginLeft: 6 }}>✏</span>
        </div>
      }
    </div>
  );
  if (!action) return null;
  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", zIndex: 340 }} onClick={onClose} />
      <div className="side-panel" style={{ width: 480, padding: 0, zIndex: 341 }}>
        <div style={{ background: `linear-gradient(135deg,${T.navy},#3D378C)`, padding: "18px 22px", color: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 10, opacity: .6, letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 }}>{action.sn} · {action.src}</div>
              <div style={{ fontFamily: "'Sora',sans-serif", fontSize: 14, fontWeight: 800, lineHeight: 1.4 }}>{action.text}</div>
            </div>
            <button onClick={onClose} style={{ background: "rgba(255,255,255,.15)", border: "none", color: "#fff", borderRadius: 8, width: 30, height: 30, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginLeft: 10 }}>×</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <SBadge s={action.status} /><PBadge p={action.priority} />
            {isOverdue(action) && <span style={{ background: T.red, color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>{daysOver(action)}d overdue</span>}
          </div>
        </div>
        <div style={{ padding: "16px 22px", overflowY: "auto", flex: 1, maxHeight: "calc(100vh - 200px)" }}>
          <InlineField label="Responsible" k="responsible" value={action.responsible} opts={users?.map(u => u.name)} />
          <InlineField label="Due Date" k="due" value={action.due} type="date" />
          <InlineField label="Status" k="status" value={action.status} opts={["NOT STARTED", "IN PROCESS", "COMPLETED", "DROPPED"]} />
          <InlineField label="Priority" k="priority" value={action.priority} opts={["NORMAL", "WARNING", "CRITICAL"]} />
          <InlineField label="Remarks" k="remarks" value={action.remarks} />
          <div style={{ fontSize: 10, fontWeight: 700, color: T.text2, textTransform: "uppercase", letterSpacing: .4, marginBottom: 6 }}>Details</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
            {[["Plant", action.plant], ["Department", action.section], ["Allocated By", action.allocatedBy], ["Date of Action", fmt(action.dateOfAction)]].map(([l, v]) => (
              <div key={l} style={{ background: T.bg, borderRadius: 6, padding: "8px 10px" }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: T.text2, textTransform: "uppercase", marginBottom: 2 }}>{l}</div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{v || "—"}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.text2, textTransform: "uppercase", letterSpacing: .4, marginBottom: 8 }}>Thread</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            {(action.messages || []).map((m, i) => <div key={i} style={{ background: T.bg, borderRadius: 8, padding: "8px 10px", fontSize: 12 }}><span style={{ fontWeight: 600, color: T.navy }}>{m.author}:</span> {m.text}</div>)}
            {(action.messages || []).length === 0 && <div style={{ fontSize: 12, color: T.text2, fontStyle: "italic" }}>No messages yet</div>}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={msg} onChange={e => setMsg(e.target.value)} onKeyDown={e => { if (e.key === "Enter") sendMsg(); }} placeholder="Add a message…" style={{ flex: 1, fontSize: 12, padding: "6px 10px" }} />
            <button onClick={sendMsg} style={{ background: T.navy, color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12 }}>Send</button>
          </div>
        </div>
      </div>
    </>
  );
}

function HomePage({ actions, setActions, user, setPage, users, meetings, plants, depts, setGlobalActiveMtg }) {
  const now = new Date();
  // Scope: my plant OR all
  const myPlantActions = user?.plant === "All" ? actions : actions.filter(a => a.plant === user?.plant);

  // Fix 3: Dashboard scope — actions assigned to me, or assigned to my subordinates, or in my department
  const getSubordinates = (name, allUsers, visited = new Set()) => {
    if (visited.has(name)) return [];
    visited.add(name);
    const directs = allUsers.filter(u => u.superior === name);
    const all = [...directs];
    directs.forEach(d => { all.push(...getSubordinates(d.name, allUsers, visited)); });
    return all;
  };
  const subs = user ? getSubordinates(user.name, users) : [];
  const subNames = subs.map(u => u.name);
  const myDept = user?.dept || "";
  const scopedActions = actions.filter(a =>
    a.responsible === user?.name ||
    subNames.includes(a.responsible) ||
    (myDept && (users.find(u => u.name === a.responsible)?.dept === myDept))
  );

  const total = scopedActions.length;
  const comp = scopedActions.filter(a => a.status === "COMPLETED").length;
  const inProc = scopedActions.filter(a => a.status === "IN PROCESS").length;
  const notStarted = scopedActions.filter(a => a.status === "NOT STARTED").length;
  const over = scopedActions.filter(isOverdue).length;
  const crit = scopedActions.filter(a => a.priority === "CRITICAL" && a.status !== "COMPLETED" && a.status !== "DROPPED").length;

  // Fix 2 & 4: My open actions as Responsible — clickable, opens side panel
  const myOwn = actions.filter(a => a.responsible === user?.name && a.status !== "COMPLETED" && a.status !== "DROPPED")
    .sort((a, b) => {
      if (!a.due && !b.due) return 0;
      if (!a.due) return 1;
      if (!b.due) return -1;
      return new Date(a.due) - new Date(b.due);
    });
  // Fix 2 extra: Unassigned actions
  const unassigned = myPlantActions.filter(a => (!a.responsible || a.responsible.trim() === "") && a.status !== "COMPLETED" && a.status !== "DROPPED");
  const todayStr2 = now.toISOString().split("T")[0]; // "YYYY-MM-DD"

  // ── Compute truly upcoming meetings ────────────────────────────────────────
  const getNextOccurrence = (mtg) => {
    const mtgTimeStr = mtg.time; // "HH:MM"
    if (!mtgTimeStr || !String(mtgTimeStr).includes(":")) return null;
    const [mtgH, mtgM] = String(mtgTimeStr).split(":").map(Number);
    if (isNaN(mtgH) || isNaN(mtgM)) return null;
    const today = new Date();
    const todayDateStr = today.toISOString().split("T")[0];

    // Build a Set of dates this meeting was already completed
    const completedDates = new Set((mtg.completedSessions || []).map(s => s.date));

    // Non-recurring: show only if not completed AND datetime is in future
    if (!mtg.recurring) {
      // If already completed today, don't show
      if (mtg.completedSessions && mtg.completedSessions.some(s => s.date === todayDateStr)) return null;
      const mtgDateTime = new Date(today);
      mtgDateTime.setHours(mtgH, mtgM, 0, 0);
      // If meeting time already passed today, it's not upcoming
      if (mtgDateTime < now) return null;
      return mtgDateTime;
    }

    // Recurring: find next occurrence after today ( skipping completed dates )
    let checkDate = new Date(today);
    // Start from today; if meeting time already passed today, start from tomorrow
    const nowMins = today.getHours() * 60 + today.getMinutes();
    const mtgMins = mtgH * 60 + mtgM;
    if (nowMins >= mtgMins) checkDate.setDate(checkDate.getDate() + 1);

    // Find next date not in completedDates
    const maxDaysAhead = 365; // safety cap
    for (let i = 0; i < maxDaysAhead; i++) {
      const dateStr = checkDate.toISOString().split("T")[0];
      if (!completedDates.has(dateStr)) {
        // Found a date where meeting hasn't been marked complete
        const next = new Date(checkDate);
        next.setHours(mtgH, mtgM, 0, 0);
        return next;
      }
      checkDate.setDate(checkDate.getDate() + 1);
    }
    return null; // no upcoming occurrence found within lookahead
  };

  const upcomingMeetings = (meetings || [])
    .map(m => {
      const next = getNextOccurrence(m);
      return next ? { ...m, _nextDt: next } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a._nextDt - b._nextDt)
    .slice(0, 3);

  // Fix 3: unified action update + single panel state
  const upAction = (id, patch) => setActions && setActions(p => p.map(a => {
    if (a.id !== id) return a;
    if (patch.due && patch.due !== a.due) { const rev = { date: todayStr(), from: a.due, to: patch.due, by: user?.name || "Unknown" }; return { ...a, ...patch, revisions: (a.revisions || 0) + 1, revisionHistory: [...(a.revisionHistory || []), rev] }; }
    return { ...a, ...patch };
  }));

  // State — single unified action detail panel
  const [actionPanel, setActionPanel] = useState(null);

  // State
  const [subModal, setSubModal] = useState(null);
  const [kpiDrill, setKpiDrill] = useState(null);
  const [mtgModal, setMtgModal] = useState(null); // Fix 4: meeting popup
  const [unassignedDrill, setUnassignedDrill] = useState(false);

  // Fix 6: per-bucket counts for subordinates
  const subData = subs.map(u => {
    const mine = actions.filter(a => a.responsible === u.name && a.status !== "COMPLETED" && a.status !== "DROPPED");
    const delayed = mine.filter(isOverdue);
    const today = mine.filter(a => !isOverdue(a) && a.due && Math.floor((new Date(a.due) - now) / 86400000) === 0);
    const soon = mine.filter(a => !isOverdue(a) && a.due && Math.floor((new Date(a.due) - now) / 86400000) > 0 && Math.floor((new Date(a.due) - now) / 86400000) <= 3);
    const later = mine.filter(a => !isOverdue(a) && a.due && Math.floor((new Date(a.due) - now) / 86400000) > 3);
    return { ...u, pending: mine.length, delayed, today, soon, later, actions: mine };
  }).filter(u => u.pending > 0);

  const greeting = now.getHours() < 12 ? "Morning" : now.getHours() < 17 ? "Afternoon" : "Evening";

  const kpiDrillData = {
    total: { title: "All Scoped Actions", rows: scopedActions },
    running: { title: "In Process Actions", rows: scopedActions.filter(a => a.status === "IN PROCESS") },
    critical: { title: "Critical Open Actions", rows: scopedActions.filter(a => a.priority === "CRITICAL" && a.status !== "COMPLETED" && a.status !== "DROPPED") },
    completed: { title: "Completed Actions", rows: scopedActions.filter(a => a.status === "COMPLETED") },
    overdue: { title: "Overdue Actions", rows: scopedActions.filter(isOverdue) },
  };

  // Fix 4: Meeting popup modal
  const MeetingPopup = ({ mtg, onClose, onStart }) => (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ width: 480, padding: 0 }} onClick={e => e.stopPropagation()}>
        <div style={{ background: `linear-gradient(135deg,${T.navy},#3D378C)`, borderRadius: "18px 18px 0 0", padding: "20px 24px", color: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 10, opacity: .6, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Meeting Plan</div>
              <div style={{ fontFamily: "'Sora',sans-serif", fontSize: 16, fontWeight: 800 }}>{mtg.type}</div>
              <div style={{ fontSize: 12, opacity: .8, marginTop: 4 }}>{mtg.plant} · {mtg.time} · {mtg.dur}min</div>
            </div>
            <button onClick={onClose} style={{ background: "rgba(255,255,255,.15)", border: "none", color: "#fff", borderRadius: 8, width: 30, height: 30, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
          </div>
        </div>
        <div style={{ padding: "18px 24px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            {[["Facilitator", mtg.facilitator], ["Plant", mtg.plant], ["Time", mtg.time], ["Duration", `${mtg.dur} min`]].map(([l, v]) => (
              <div key={l} style={{ background: T.bg, borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.text2, textTransform: "uppercase", marginBottom: 3 }}>{l}</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{v || "—"}</div>
              </div>
            ))}
          </div>
          {(mtg.guidelines || []).length > 0 && <div style={{ marginBottom: 14 }}><div style={{ fontSize: 11, fontWeight: 700, color: T.navy, marginBottom: 6 }}>📌 Meeting Guidelines</div><ol style={{ paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>{(mtg.guidelines || []).map((g, i) => <li key={i} style={{ fontSize: 12, color: T.text, lineHeight: 1.5 }}>{g}</li>)}</ol></div>}
          {(mtg.completedSessions || []).length > 0 && <div style={{ marginBottom: 14 }}><div style={{ fontSize: 11, fontWeight: 700, color: T.navy, marginBottom: 6 }}>📊 Past Sessions</div>{(mtg.completedSessions || []).map((s, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", background: T.bg, borderRadius: 6, padding: "6px 10px", fontSize: 12, marginBottom: 4 }}><span>{fmt(s.date)}</span><span style={{ fontWeight: 600 }}>{s.duration} min</span></div>)}</div>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={onClose} className="btn btn-ghost">Close</button>
            <button onClick={() => { onStart && onStart(mtg); onClose(); }} className="btn btn-navy">▶ Start Meeting</button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 12, color: T.text2, marginBottom: 4 }}>Home › Management Control System</div>
          <h1 style={{ fontFamily: "'Sora',sans-serif", fontSize: 22, fontWeight: 800, color: T.navy }}>Good {greeting}, {user && user.name ? user.name.split(" ")[0] : ""} 👋</h1>
          <div style={{ fontSize: 12, color: T.text2, marginTop: 3 }}>{now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
        </div>
      </div>

      {/* KPI tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 14, marginBottom: 24 }}>
        {[
          { n: total, label: "Task Assigned", icon: "📋", color: T.navy, key: "total" },
          { n: unassigned.length, label: "Unassigned", icon: "❓", color: T.slate, key: "unassigned" },
          { n: inProc, label: "In Process", icon: "🏃", color: T.amber, key: "running" },
          { n: crit, label: "Critical Open", icon: "⚠", color: T.red, key: "critical" },
          { n: comp, label: "Completed", icon: "✅", color: T.green, key: "completed" },
        ].map((k, i) => (
          <div key={i} className="card card-hover" style={{ padding: 18, cursor: "pointer" }} onClick={() => k.key === "unassigned" ? setUnassignedDrill(true) : setKpiDrill(k.key)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div><div style={{ fontFamily: "'Sora',sans-serif", fontSize: 32, fontWeight: 800, color: k.color }}>{k.n}</div><div style={{ fontSize: 12, fontWeight: 600, color: T.text, marginTop: 2 }}>{k.label}</div></div>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: k.color + "15", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{k.icon}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Row 2: Open Tasks (full width) */}
      <div style={{ marginBottom: 20 }}>
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: `1.5px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 14, color: T.navy }}>Open Tasks — I am Responsible</div>
            <button onClick={() => setPage(2)} style={{ fontSize: 12, color: T.navy, border: "none", background: "transparent", cursor: "pointer", fontWeight: 600 }}>View All →</button>
          </div>
          <table>
            <thead><tr><th>SN</th><th>Action</th><th>Status</th><th>Due On</th><th>Priority</th><th>Revisions</th></tr></thead>
            <tbody>
              {myOwn.slice(0, 8).map((a, idx) => (
                <tr key={a.id || `home-own-${idx}`} style={{ cursor: "pointer" }} onClick={() => setActionPanel(a)}>
                  <td style={{ fontFamily: "monospace", fontSize: 11, color: T.text2, whiteSpace: "nowrap" }}>{a.sn}</td>
                  <td style={{ fontSize: 12, fontWeight: 500, whiteSpace: "normal", wordBreak: "break-word", maxWidth: 320, lineHeight: 1.4 }}>{a.text}</td>
                  <td><SBadge s={a.status} /></td>
                  <td style={{ fontSize: 12, color: isOverdue(a) ? T.red : T.text, fontWeight: isOverdue(a) ? 600 : 400, whiteSpace: "nowrap" }}>{isOverdue(a) ? `${daysOver(a)}d overdue` : fmt(a.due)}</td>
                  <td><PBadge p={a.priority} /></td>
                  <td style={{ textAlign: "center" }}>{(a.revisions || 0) > 0 ? <span style={{ fontWeight: 700, color: T.amber, fontSize: 12 }}>{a.revisions}</span> : <span style={{ color: T.text2, fontSize: 12 }}>—</span>}</td>
                </tr>
              ))}
              {myOwn.length === 0 && <tr><td colSpan={6}><Empty icon="🎉" title="All clear!" sub="No open actions assigned to you." /></td></tr>}
            </tbody>
          </table>
          {/* Upcoming meetings — Fix 4: clickable */}
          {upcomingMeetings.length > 0 && (
            <div style={{ padding: "12px 20px", borderTop: `1.5px solid ${T.border}`, background: T.bg }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.navy, marginBottom: 8, textTransform: "uppercase", letterSpacing: .4 }}>📅 Upcoming — click to open</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {upcomingMeetings.map((m, idx) => {
                  const isToday = m._nextDt.toISOString().split("T")[0] === todayStr2;
                  return (
                    <div key={m.id || `mtg-${idx}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer", padding: "6px 9px", borderRadius: 7, transition: "background .15s" }}
                      onClick={() => setMtgModal(m)}
                      onMouseEnter={e => e.currentTarget.style.background = T.border}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>

                      {/* Time badge */}
                      <span style={{ background: T.navy + "15", color: T.navy, borderRadius: 6, padding: "2px 8px", fontWeight: 600, minWidth: 48, textAlign: "center" }}>
                        {m.time}
                      </span>

                      {/* Meeting title */}
                      <span style={{ fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {m.type}
                      </span>

                      {/* Plant */}
                      <span style={{ fontSize: 11, color: T.text2 }}>
                        {m.plant}
                      </span>

                      {/* Date indicator (if not today) */}
                      {!isToday && <span style={{ fontSize: 10, color: T.text2, fontWeight: 600 }}>
                        {m._nextDt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </span>}

                      {/* Recurring indicator */}
                      {m.recurring && <span style={{ fontSize: 10, color: T.amber, fontWeight: 700, background: T.amberL, padding: "1px 6px", borderRadius: 4 }}>🔁</span>}

                      {/* Arrow */}
                      <span style={{ fontSize: 10, color: T.navy, fontWeight: 700 }}>Open →</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Row 3: Team Pending (Fix 6) + Escalated Actions (Fix 7) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
        {/* Fix 6: Team Pending with 4 color buckets per person */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 4 }}>Team Pending Actions</div>
          <div style={{ fontSize: 11, color: T.text2, marginBottom: 12 }}>Click any count box to see those actions</div>
          {subData.length === 0
            ? <Empty icon="✅" title="All clear!" sub={subs.length === 0 ? "No subordinates in org chart" : "All team members up to date"} />
            : <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {subData.slice(0, 6).map((u, idx) => (
                <div key={u.id || `sub-${idx}`}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                    <Avatar name={u.name} size={24} users={users} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{u.name}</span>
                    <span style={{ fontSize: 10, color: T.text2 }}>{u.role}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
                    {[
                      { label: "Delayed", count: u.delayed.length, bg: T.redL, border: T.red, color: T.red, actions: u.delayed, tip: "Overdue" },
                      { label: "Today", count: u.today.length, bg: "#FFF3E0", border: "#E65100", color: "#E65100", actions: u.today, tip: "Due today" },
                      { label: "Next 3d", count: u.soon.length, bg: T.amberL, border: T.amber, color: T.amber, actions: u.soon, tip: "Due in 1-3 days" },
                      { label: ">3 Days", count: u.later.length, bg: "#fff", border: T.border, color: T.text2, actions: u.later, tip: "Due after 3 days" },
                    ].map(b => (
                      <div key={b.label} style={{ background: b.bg, border: `1.5px solid ${b.border}`, borderRadius: 8, padding: "6px 8px", textAlign: "center", cursor: b.count > 0 ? "pointer" : "default", opacity: b.count === 0 ? .4 : 1, transition: "all .15s" }}
                        onClick={() => b.count > 0 && setSubModal({ user: u, bucket: b.label, actions: b.actions })}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: b.color }}>{b.count}</div>
                        <div style={{ fontSize: 9, fontWeight: 600, color: b.color, marginTop: 1 }}>{b.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          }
        </div>

        {/* Fix 7: Escalated Actions Summary */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 14, color: T.navy }}>🚨 Escalated Actions</div>
            <button onClick={() => setPage(4)} style={{ fontSize: 11, color: T.red, border: `1px solid ${T.red}`, background: "transparent", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontWeight: 700 }}>View All →</button>
          </div>
          {scopedActions.filter(isOverdue).length === 0
            ? <Empty icon="✅" title="No escalations!" sub="All actions within threshold." />
            : <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 280, overflowY: "auto" }}>
              {scopedActions.filter(isOverdue).sort((a, b) => daysOver(b) - daysOver(a)).slice(0, 5).map((a, idx) => {
                const d = daysOver(a);
                const lvl = d >= 7 ? "L4" : d >= 3 ? "L3" : d >= 1 ? "L2" : "L1";
                const lvlColor = d >= 7 ? T.red : d >= 3 ? "#C0392B" : d >= 1 ? "#E67E22" : T.amber;
                return (
                  <div key={a.id || `esc-${idx}`} style={{ background: T.redL, border: `1.5px solid ${T.red}20`, borderRadius: 10, padding: "10px 14px", cursor: "pointer", display: "flex", gap: 12, alignItems: "flex-start" }} onClick={() => setActionPanel(a)}>
                    <div style={{ background: lvlColor, color: "#fff", borderRadius: 6, padding: "2px 7px", fontSize: 10, fontWeight: 800, flexShrink: 0, marginTop: 2 }}>{lvl}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.4, marginBottom: 3, color: T.text, wordBreak: "break-word" }}>{a.text}</div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: T.text2 }}>{a.responsible}</span>
                        <span style={{ fontSize: 11, color: T.red, fontWeight: 700 }}>{d}d overdue</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          }
        </div>
      </div>

      {/* Unified action detail panel — same as Actions page */}
      {actionPanel && <ActionDetailPanel action={actionPanel} onClose={() => setActionPanel(null)} onUpdate={(id, patch) => { upAction(id, patch); setActionPanel(p => p ? { ...p, ...patch } : p); }} user={user} users={users} allUsers={users} plants={plants} />}

      {/* Fix 6: Team sub modal */}
      {subModal && (
        <div className="overlay" onClick={() => setSubModal(null)}>
          <div className="modal" style={{ width: 620, padding: 0 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: "16px 22px", borderBottom: `1.5px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar name={subModal.user.name} size={34} users={users} />
                <div>
                  <h3 style={{ fontFamily: "'Sora',sans-serif", fontSize: 14, fontWeight: 800, color: T.navy }}>{subModal.user.name}</h3>
                  <div style={{ fontSize: 11, color: T.text2 }}>{subModal.bucket} Actions · {subModal.actions.length} items</div>
                </div>
              </div>
              <button onClick={() => setSubModal(null)} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 22, color: T.text2 }}>×</button>
            </div>
            <div style={{ maxHeight: "65vh", overflowY: "auto" }}>
              {subModal.actions.length === 0
                ? <Empty icon="✅" title="No actions in this bucket" sub="" />
                : <table>
                  <thead><tr><th>SN</th><th>Action</th><th>Due</th><th>Status</th><th>Priority</th></tr></thead>
                  <tbody>{subModal.actions.map((a, idx) => (
                    <tr key={a.id || `sub-act-${idx}`} style={{ cursor: "pointer" }} onClick={() => setActionPanel(a)}>
                      <td style={{ fontFamily: "monospace", fontSize: 11, color: T.text2, whiteSpace: "nowrap" }}>{a.sn}</td>
                      <td style={{ fontSize: 12, fontWeight: 500, whiteSpace: "normal", wordBreak: "break-word", maxWidth: 240, lineHeight: 1.4 }}>{a.text}</td>
                      <td style={{ fontSize: 12, color: isOverdue(a) ? T.red : T.text, fontWeight: isOverdue(a) ? 600 : 400, whiteSpace: "nowrap" }}>{isOverdue(a) ? `${daysOver(a)}d late` : fmt(a.due)}</td>
                      <td><SBadge s={a.status} /></td>
                      <td><PBadge p={a.priority} /></td>
                    </tr>
                  ))}</tbody>
                </table>
              }
            </div>
          </div>
        </div>
      )}


      {/* KPI drill modal */}
      {kpiDrill && kpiDrillData[kpiDrill] && (
        <div className="overlay" onClick={() => setKpiDrill(null)}>
          <div className="modal" style={{ width: 700, padding: 28 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h2 style={{ fontFamily: "'Sora',sans-serif", fontSize: 16, fontWeight: 800, color: T.navy }}>{kpiDrillData[kpiDrill].title} <span style={{ fontSize: 12, color: T.text2, fontWeight: 400 }}>({kpiDrillData[kpiDrill].rows.length})</span></h2>
              <button onClick={() => setKpiDrill(null)} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 22, color: T.text2 }}>×</button>
            </div>
            <table><thead><tr><th>SN</th><th>Action</th><th>Responsible</th><th>Status</th><th>Due</th></tr></thead>
              <tbody>{kpiDrillData[kpiDrill].rows.slice(0, 20).map((a, idx) => (
                <tr key={a.id || `drill-${idx}`} style={{ cursor: "pointer" }} onClick={() => setActionPanel(a)}>
                  <td style={{ fontFamily: "monospace", fontSize: 11, color: T.text2, whiteSpace: "nowrap" }}>{a.sn}</td>
                  <td style={{ fontSize: 12, whiteSpace: "normal", wordBreak: "break-word", maxWidth: 260, lineHeight: 1.4 }}>{a.text}</td>
                  <td style={{ fontSize: 12 }}>{a.responsible}</td>
                  <td><SBadge s={a.status} /></td>
                  <td style={{ fontSize: 12, color: isOverdue(a) ? T.red : T.text, whiteSpace: "nowrap" }}>{fmt(a.due)}</td>
                </tr>
              ))}</tbody></table>
            {kpiDrillData[kpiDrill].rows.length === 0 && <Empty icon="📭" title="No records" sub="Nothing to show." />}
            <div style={{ marginTop: 14, textAlign: "right" }}><button className="btn btn-navy btn-sm" onClick={() => { setKpiDrill(null); setPage(2); }}>Open Actions Register</button></div>
          </div>
        </div>
      )}


      {/* Unassigned drill modal */}
      {unassignedDrill && (
        <div className="overlay" onClick={() => setUnassignedDrill(false)}>
          <div className="modal" style={{ width: 680, padding: 28 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h2 style={{ fontFamily: "'Sora',sans-serif", fontSize: 16, fontWeight: 800, color: T.navy }}>Unassigned Actions <span style={{ fontSize: 12, color: T.text2, fontWeight: 400 }}>({unassigned.length})</span></h2>
              <button onClick={() => setUnassignedDrill(false)} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 22, color: T.text2 }}>×</button>
            </div>
            {unassigned.length === 0 ? <Empty icon="✅" title="All actions have an owner" sub="" /> : <table>
              <thead><tr><th>SN</th><th>Action</th><th>Source</th><th>Status</th><th>Due</th></tr></thead>
              <tbody>{unassigned.map((a, idx) => (<tr key={a.id || `unassigned-${idx}`}><td style={{ fontFamily: "monospace", fontSize: 11, color: T.text2 }}>{a.sn}</td><td style={{ fontSize: 12, whiteSpace: "normal", wordBreak: "break-word", maxWidth: 260, lineHeight: 1.4 }}>{a.text}</td><td style={{ fontSize: 12 }}>{a.src}</td><td><SBadge s={a.status} /></td><td style={{ fontSize: 12, color: isOverdue(a) ? T.red : T.text }}>{fmt(a.due)}</td></tr>))}</tbody>
            </table>}
          </div>
        </div>
      )}

      {/* Fix 4: Meeting popup */}
      {mtgModal && <MeetingPopup mtg={mtgModal} onClose={() => setMtgModal(null)} onStart={(m) => { setGlobalActiveMtg && setGlobalActiveMtg(m); setPage(1); }} />}
    </div>
  );
}

/* ===================== PROJECT CHARTER MODAL ===================== */
function ProjectCharterModal({ pr, onClose, actions, meetings, user, onProjectUpdate, onActionSelect, users: allUsers }) {
  useEscClose(onClose);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState({ ...pr, milestones: [...(Array.isArray(pr.milestones) ? pr.milestones : []).map(m => ({ ...m }))], team: [...((Array.isArray(pr.team) ? pr.team : (typeof pr.team === "string" ? [pr.team] : [])) || [])], risks: pr.risks || "" });
  const canEdit = user?.role === "Admin" || (user?.name === pr.owner) || (user?.name === pr.sponsor);
  const pActions = actions.filter(a => a.project === pr.name);
  const projectMeetings = (meetings || []).filter(m => m.project === pr.name);
  const now = new Date();
  const start = new Date(pr.start), end = new Date(pr.end);
  const done = (editMode ? draft : pr).milestones.filter(m => m.done).length;
  const total = (editMode ? draft : pr).milestones.length;
  const milestonePct = total > 0 ? Math.round(done / total * 100) : 0;
  const isOverdueProject = now > end && pr.status !== "COMPLETED";
  const barColor = pr.status === "COMPLETED" ? T.green : isOverdueProject ? T.red : milestonePct >= 66 ? T.green : milestonePct >= 33 ? T.amber : T.red;
  const current = editMode ? draft : pr;

  const toggleMilestone = (i) => {
    if (!editMode && !canEdit) return;
    setDraft(d => ({ ...d, milestones: d.milestones.map((m, idx) => idx === i ? { ...m, done: !m.done } : m) }));
    if (!editMode) onProjectUpdate({ ...pr, milestones: pr.milestones.map((m, idx) => idx === i ? { ...m, done: !m.done } : m) });
  };
  const save = () => { onProjectUpdate(draft); setEditMode(false); };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ width: 860, padding: 0, maxHeight: "93vh" }} onClick={e => e.stopPropagation()}>
        <div style={{ background: `linear-gradient(135deg,${T.navy},#3D378C)`, borderRadius: "18px 18px 0 0", padding: "24px 28px", color: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 11, opacity: .6, marginBottom: 4, letterSpacing: 1, textTransform: "uppercase" }}>Project Charter</div>
              <h2 style={{ fontFamily: "'Sora',sans-serif", fontSize: 22, fontWeight: 800, marginBottom: 6 }}>{pr.name}</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ padding: "3px 10px", borderRadius: 20, background: "rgba(255,255,255,.15)", fontSize: 11, fontWeight: 600 }}>{pr.plant}</span>
                <span style={{ padding: "3px 10px", borderRadius: 20, background: pr.priority === "CRITICAL" ? T.red + "80" : pr.priority === "WARNING" ? T.amber + "80" : "rgba(255,255,255,.15)", fontSize: 11, fontWeight: 600 }}>{pr.priority}</span>
                <span style={{ padding: "3px 10px", borderRadius: 20, background: "rgba(255,255,255,.15)", fontSize: 11, fontWeight: 600 }}>{pr.status}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {canEdit && !editMode && <button onClick={() => setEditMode(true)} style={{ background: "rgba(255,255,255,.2)", border: "none", color: "#fff", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>✏ Edit</button>}
              {editMode && <><button onClick={save} style={{ background: T.green, border: "none", color: "#fff", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Save</button><button onClick={() => setEditMode(false)} style={{ background: "rgba(255,255,255,.2)", border: "none", color: "#fff", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Cancel</button></>}
              <button onClick={onClose} style={{ background: "rgba(255,255,255,.15)", border: "none", color: "#fff", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>x</button>
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, opacity: .85, marginBottom: 6 }}>
              <span>{fmt(pr.start)}</span>
              <span style={{ fontWeight: 700, color: isOverdueProject ? "#ffaaaa" : barColor === T.green ? "#aaffcc" : "#ffd580" }}>
                {pr.status === "COMPLETED" ? "✓ Completed" : isOverdueProject ? "⚠ Overdue" : milestonePct === 100 ? "All milestones done" : `${done}/${total} milestones`}
              </span>
              <span>{fmt(pr.end)}</span>
            </div>
            <div style={{ background: "rgba(255,255,255,.2)", borderRadius: 6, height: 8 }}>
              <div style={{ height: "100%", borderRadius: 6, background: barColor, width: `${milestonePct}%`, transition: "width .6s" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, opacity: .9 }}>{milestonePct}% complete</span>
            </div>
          </div>
        </div>
        <div style={{ padding: "24px 28px", overflowY: "auto", maxHeight: "calc(93vh - 180px)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 20 }}>
            {[{ l: "Sponsor", k: "sponsor" }, { l: "Project Owner", k: "owner" }, { l: "Budget", k: "budget" }].map(({ l, k }) => (
              <div key={k} className="card" style={{ padding: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.text2, textTransform: "uppercase", letterSpacing: .5, marginBottom: 6 }}>{l}</div>
                {editMode ? <input value={draft[k]} onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} style={{ fontSize: 12, padding: "5px 8px" }} /> : <div style={{ fontWeight: 600, fontSize: 13 }}>{pr[k]}</div>}
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
            {[{ l: "🎯 Objective", k: "objective" }, { l: "🗺 Scope", k: "scope" }].map(({ l, k }) => (
              <div key={k} className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.navy, marginBottom: 8 }}>{l}</div>
                {editMode ? <textarea value={draft[k]} onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} style={{ fontSize: 12, height: 80, resize: "none" }} /> : <div style={{ fontSize: 13, lineHeight: 1.6, color: T.text }}>{pr[k]}</div>}
              </div>
            ))}
          </div>
          <div className="card" style={{ padding: 16, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.navy }}>👥 Project Team</div>
              {editMode && <select defaultValue="" onChange={e => { const v = e.target.value; if (v && !draft.team.includes(v)) setDraft(d => ({ ...d, team: [...d.team, v] })) }}>
                <option value="" disabled>+ Add member</option>
                {(allUsers || []).filter(u => !draft.team.includes(u.name)).map(u => <option key={u.id} value={u.name}>{u.name} ({u.role})</option>)}
              </select>}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {(editMode ? draft : pr).team.map(name => (
                <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, background: T.bg, borderRadius: 8, padding: "6px 12px", position: "relative" }}>
                  <Avatar name={name} size={28} users={allUsers || []} />
                  <div><div style={{ fontSize: 12, fontWeight: 600 }}>{name}</div><div style={{ fontSize: 10, color: T.text2 }}>{(allUsers || []).find(u => u.name === name)?.role || "Member"}</div></div>
                  {editMode && <button onClick={() => setDraft(d => ({ ...d, team: d.team.filter(n => n !== name) }))} style={{ marginLeft: 4, background: "transparent", border: "none", cursor: "pointer", color: T.red, fontSize: 14, lineHeight: 1, padding: "0 2px" }} title="Remove">×</button>}
                </div>
              ))}
              {(editMode ? draft : pr).team.length === 0 && <div style={{ fontSize: 12, color: T.text2, fontStyle: "italic" }}>No team members added</div>}
            </div>
          </div>
          <div className="card" style={{ padding: 16, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.navy }}>📍 Milestones</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11, color: T.text2 }}>{done}/{current.milestones.length} complete</span>
                {editMode && <button onClick={() => setDraft(d => ({ ...d, milestones: [...d.milestones, { name: "New Milestone", due: todayStr(), done: false }] }))} style={{ fontSize: 11, background: T.navy, color: "#fff", border: "none", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>+ Add</button>}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {current.milestones.map((m, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 8, background: m.done ? T.greenL : T.bg, border: `1px solid ${m.done ? T.green + "30" : T.border}`, cursor: canEdit && !editMode ? "pointer" : "default", transition: "all .18s" }} onClick={() => canEdit && !editMode && toggleMilestone(i)}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: m.done ? T.green : T.border, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: `2px solid ${m.done ? T.green : T.border}`, transition: "all .2s", cursor: editMode ? "pointer" : "inherit" }} onClick={editMode ? ev => { ev.stopPropagation(); toggleMilestone(i) } : undefined}>
                    {m.done && <span style={{ color: "#fff", fontSize: 12, lineHeight: 1 }}>✓</span>}
                  </div>
                  {editMode
                    ? <input value={m.name} onChange={e => setDraft(d => ({ ...d, milestones: d.milestones.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x) }))} style={{ flex: 1, fontSize: 12, padding: "3px 8px" }} onClick={ev => ev.stopPropagation()} />
                    : <div style={{ flex: 1, fontSize: 13, fontWeight: m.done ? 400 : 500, color: m.done ? T.text2 : T.text, textDecoration: m.done ? "line-through" : "none" }}>{m.name}</div>
                  }
                  {editMode
                    ? <input type="date" value={m.due} onChange={e => setDraft(d => ({ ...d, milestones: d.milestones.map((x, idx) => idx === i ? { ...x, due: e.target.value } : x) }))} style={{ fontSize: 11, padding: "3px 6px", width: 130 }} onClick={ev => ev.stopPropagation()} />
                    : <div style={{ fontSize: 11, color: T.text2, flexShrink: 0 }}>{fmt(m.due)}</div>
                  }
                  {editMode && <button onClick={ev => { ev.stopPropagation(); setDraft(d => ({ ...d, milestones: d.milestones.filter((_, idx) => idx !== i) })) }} style={{ background: "transparent", border: "none", cursor: "pointer", color: T.red, fontSize: 16, lineHeight: 1, padding: "0 4px" }} title="Remove">×</button>}
                  {canEdit && !editMode && <span style={{ fontSize: 10, color: T.text2, opacity: .5 }}>{m.done ? "click to uncheck" : "click to check"}</span>}
                </div>
              ))}
              {current.milestones.length === 0 && <div style={{ fontSize: 12, color: T.text2, fontStyle: "italic", padding: "8px 0" }}>No milestones yet — click + Add to create one</div>}
            </div>
          </div>
          <div className="card" style={{ padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.navy, marginBottom: 8 }}>⚠ Risks & Constraints</div>
            {editMode ? <textarea value={draft.risks} onChange={e => setDraft(d => ({ ...d, risks: e.target.value }))} style={{ fontSize: 12, height: 64, resize: "none" }} /> : <div style={{ fontSize: 13, lineHeight: 1.6, color: T.text }}>{pr.risks}</div>}
          </div>
          {projectMeetings.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 14 }}>
              <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontWeight: 700, color: T.navy }}>🎙 Related Meetings ({projectMeetings.length})</div>
              <table>
                <thead><tr><th>Type</th><th>Plant</th><th>Time</th><th>Facilitator</th><th>Sessions</th></tr></thead>
                <tbody>{projectMeetings.map(m => (
                  <tr key={m.id}>
                    <td style={{ fontSize: 12, fontWeight: 500 }}>{m.type}</td>
                    <td style={{ fontSize: 12 }}>{m.plant}</td>
                    <td style={{ fontSize: 12 }}>{m.time} · {m.dur}min</td>
                    <td><div style={{ display: "flex", alignItems: "center", gap: 6 }}><Avatar name={m.facilitator} size={22} users={allUsers || []} /><span style={{ fontSize: 12 }}>{m.facilitator}</span></div></td>
                    <td style={{ fontSize: 12, color: T.text2 }}>{(m.completedSessions || []).length} done</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {pActions.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontWeight: 700, color: T.navy }}>Linked Actions ({pActions.length}) — click to open</div>
              <table>
                <thead><tr><th>#</th><th>Action</th><th>Responsible</th><th>Status</th><th>Due</th></tr></thead>
                <tbody>{pActions.map(a => (
                  <tr key={a.id} style={{ cursor: "pointer" }} onClick={() => onActionSelect && onActionSelect(a)}>
                    <td style={{ fontFamily: "monospace", fontSize: 11, color: T.text2 }}>{a.sn}</td>
                    <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.text}</td>
                    <td style={{ fontSize: 12 }}>{a.responsible}</td>
                    <td><SBadge s={a.status} /></td>
                    <td style={{ fontSize: 12, color: isOverdue(a) ? T.red : T.text }}>{fmt(a.due)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ===================== WORK PAGE ===================== */
function WorkPage({ plants, depts, users, onCommitFinal, actions, setActions, user, onProjectUpdate, allProjects, setProjects: setProjectsUp, allMeetings, setMeetings: setMeetingsUp, permissions, setPage, globalActiveMtg, setGlobalActiveMtg, mtgRunning, setMtgRunning, mtgElapsed, mtgTxLines, setMtgTxLines, mtgFastActions, setMtgFastActions, mtgInsights, setMtgInsights, clearMeetingState, mtgPresets }) {
  // activeMtg is now global — WorkPage just reads/writes it
  const activeMtg = globalActiveMtg;
  const setActiveMtg = (m) => { setGlobalActiveMtg(m); if (m) setMtgRunning(true); };
  // Use App-level meetings so they persist across page navigation
  const meetings = allMeetings;
  const setMeetings = setMeetingsUp;
  // Projects: single source of truth from App level
  const projects = allProjects;
  const setProjects = (updater) => {
    setProjectsUp && setProjectsUp(updater);
  };
  const [charter, setCharter] = useState(null);
  const [showAddMtg, setShowAddMtg] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);
  const [charterActionSel, setCharterActionSel] = useState(null);
  const [mtgPlan, setMtgPlan] = useState(null);  // Feature 4: meeting plan view

  const isAdmin = user?.role === "Admin";
  const userPerms = permissions?.[user?.id] || {};
  // Feature 3: can create projects if admin or has permission
  const canCreateProject = isAdmin || userPerms.canCreateProjects || user?.role !== "Guest";
  // Feature 4: can edit meetings if admin or has permission
  const canEditMeetings = isAdmin || userPerms.canEditMeetings;

  const visibleMeetings = (meetings || []).filter(m => user?.plant === "All" ? true : m.plant === user?.plant || m.plant === "All");
  const visibleProjects = (projects || []).filter(p => user?.plant === "All" ? true : p.plant === user?.plant || p.plant === "All");

  // Fix 8: detect time conflicts for current user's meetings
  const timeToMins = (t) => {
    if (!t || typeof t !== 'string') return -1;
    const parts = t.split(":");
    if (parts.length < 2) return -1;
    const [h, m] = parts.map(Number);
    return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
  };
  const userMeetings = visibleMeetings.filter(m =>
    m.facilitator === user?.name ||
    (m.attendees || mtgPresets?.attendeeMap?.[m.type] || []).includes(user?.name)
  );
  const conflictIds = new Set();
  userMeetings.forEach((a, i) => {
    userMeetings.forEach((b, j) => {
      if (i >= j) return;
      const aStart = timeToMins(a.time), bStart = timeToMins(b.time);
      if (aStart === -1 || bStart === -1) return;
      const aEnd = aStart + (a.dur || 60), bEnd = bStart + (b.dur || 60);
      if (aStart < bEnd && aEnd > bStart) { conflictIds.add(a.id); conflictIds.add(b.id); }
    });
  });

  if (activeMtg) return <MeetingRoom mtg={activeMtg} plants={plants} depts={depts} users={users} onCommit={rows => { onCommitFinal(rows); }} onCloseMeeting={() => { clearMeetingState && clearMeetingState(); setPage(0); }} onBack={() => setPage(0)} prevActions={actions} relatedActions={actions.filter(a => {
          // Match by specific meeting instance (srcId) when available, else fall back to type match
          const matchesMeeting = activeMtg.id
            ? (a.srcId === activeMtg.id || (!a.srcId && a.src === activeMtg.type))
            : a.src === activeMtg.type;
          const matchesProject = activeMtg.project && a.project === activeMtg.project;
          return matchesMeeting || matchesProject;
        })} running={mtgRunning} setRunning={setMtgRunning} elapsed={mtgElapsed} txLines={mtgTxLines} setTxLines={setMtgTxLines} fastActions={mtgFastActions} setFastActions={setMtgFastActions} insights={mtgInsights} setInsights={setMtgInsights} currentUser={user} mtgPresets={mtgPresets} setActions={setActions} />;

  return (
    <div className="fade-in">
      <PageHeader title="Work" sub="Projects, meetings and active sessions" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 15, color: T.navy, display: "flex", alignItems: "center", gap: 8 }}>
              🎙 Today's Meetings
              <span style={{ background: T.navy + "15", color: T.navy, borderRadius: 10, padding: "2px 9px", fontSize: 11, fontWeight: 700 }}>{visibleMeetings.length}</span>
            </div>
            {user?.role !== "Guest" && <button className="btn btn-ghost btn-sm" onClick={() => setShowAddMtg(true)}>+ Schedule</button>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {visibleMeetings.map((m, idx) => {
              const attendees = m.attendees || mtgPresets?.attendeeMap?.[m.type] || [];
              const linkedProject = (projects || []).find(p => p.name === m.project);
              const hasConflict = conflictIds.has(m.id);
              return (
                <div key={m.id || `mtg-list-${idx}`} className="card" style={{ padding: 18, border: hasConflict ? `1.5px solid ${T.amber}` : "" }}>
                  {hasConflict && (
                    <div style={{ background: T.amberL, border: `1px solid ${T.amber}`, borderRadius: 7, padding: "5px 12px", marginBottom: 10, display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ fontSize: 14 }}>⚠️</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#7A4500" }}>Time conflict — you have an overlapping meeting at {m.time}</span>
                    </div>
                  )}
                  {m.project && linkedProject && (
                    <div style={{ background: T.navy + "08", border: `1px solid ${T.navy}20`, borderRadius: 8, padding: "6px 12px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setCharter(linkedProject)}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 14 }}>🗂</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: T.navy }}>{m.project}</span>
                      </div>
                      <span style={{ fontSize: 11, color: T.text2 }}>View Charter →</span>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                    <div style={{ background: hasConflict ? T.amber : T.navy, color: "#fff", borderRadius: 10, padding: "8px 10px", textAlign: "center", minWidth: 56, flexShrink: 0, position: "relative" }}>
                      <div style={{ fontFamily: "'Sora',sans-serif", fontSize: 16, fontWeight: 800 }}>{m.time}</div>
                      <div style={{ fontSize: 9, opacity: .7, marginTop: 1 }}>{m.dur}min</div>
                      {hasConflict && <div style={{ position: "absolute", top: -7, right: -7, background: T.red, color: "#fff", borderRadius: "50%", width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, border: "2px solid #fff" }}>!</div>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Feature 4: meeting title clickable to open plan */}
                      <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 3, cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted" }} onClick={() => setMtgPlan(m)}>{m.type}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                        <Chip label={m.plant} color={T.navy} />
                        {m.recurring && <Chip label="Recurring" color={T.slate} />}
                      </div>
                      <div style={{ fontSize: 11, color: T.text2, marginBottom: 6 }}>Facilitated by <b style={{ color: T.text }}>{m.facilitator}</b></div>
                      {attendees.length > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 10, color: T.text2 }}>Attendees:</span>
                          {attendees.slice(0, 5).map((name, i) => <Avatar key={i} name={name} size={20} users={users} />)}
                          {attendees.length > 5 && <span style={{ fontSize: 10, color: T.text2 }}>+{attendees.length - 5}</span>}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                      {/* Feature 4: View Plan button */}
                      <button className="btn btn-ghost btn-sm" onClick={() => setMtgPlan(m)}>📋 Plan</button>
                      {user?.role !== "Guest" && <button className="btn btn-green btn-sm" onClick={() => setActiveMtg(m)}>▶ Start</button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 24 }}>
            <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 15, color: T.navy, display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              ✅ Completed Meetings
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {(meetings || []).flatMap(m => (Array.isArray(m.completedSessions) ? m.completedSessions : []).map(s => ({ ...m, sessionDate: s.date, sessionDur: s.duration })))
                .filter(m => user?.plant === "All" || m.plant === user?.plant || m.plant === "All")
                .sort((a, b) => (b.sessionDate || "").localeCompare(a.sessionDate || ""))
                .slice(0, 5)
                .map((m, i) => (
                  <div key={m.id + "_" + i} className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: T.navy }}>{m.type}</div>
                      <div style={{ fontSize: 11, color: T.text2 }}>{m.plant} · {m.facilitator}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 11, fontWeight: 600 }}>{m.sessionDate}</div>
                      <div style={{ fontSize: 10, color: T.text2 }}>{m.sessionDur} min</div>
                    </div>
                  </div>
                ))}
              {(allMeetings || []).flatMap(m => (Array.isArray(m.completedSessions) ? m.completedSessions : [])).length === 0 && <div style={{ fontSize: 12, color: T.text2, fontStyle: "italic" }}>No completed meetings</div>}
            </div>
          </div>

        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 15, color: T.navy, display: "flex", alignItems: "center", gap: 8 }}>
              🗂 Active Projects
              <span style={{ background: T.amber + "20", color: T.amber, borderRadius: 10, padding: "2px 9px", fontSize: 11, fontWeight: 700 }}>{visibleProjects.filter(p => p.status !== "COMPLETED").length}</span>
            </div>
            {/* Feature 3: Add New Project button - only for those with permission */}
            {canCreateProject && <button className="btn btn-amber btn-sm" onClick={() => setShowAddProject(true)}>+ Add Project</button>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {visibleProjects.map((pr, idx) => {
              const start = new Date(pr.start), end = new Date(pr.end), now2 = new Date();
              const ms = Array.isArray(pr.milestones) ? pr.milestones : [];
              const done = ms.filter(m => m.done).length;
              const total = ms.length;
              const milestonePct = total > 0 ? Math.round(done / total * 100) : 0;
              const isOverdueProject = now2 > end && pr.status !== "COMPLETED";
              const barColor = pr.status === "COMPLETED" ? T.green : isOverdueProject ? T.red : milestonePct >= 66 ? T.green : milestonePct >= 33 ? T.amber : T.red;
              const projMeetings = (allMeetings || []).filter(m => m.project === pr.name);
              return (
                <div key={pr.id || `proj-${idx}`} className="card card-hover" style={{ padding: 18, borderLeft: `4px solid ${pr.priority === "CRITICAL" ? T.red : pr.priority === "WARNING" ? T.amber : T.navy}`, cursor: "pointer" }} onClick={() => setCharter(pr)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: T.text }}>{pr.name}</div>
                      <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>{pr.plant} · <b style={{ color: T.text }}>{pr.owner}</b></div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}><PBadge p={pr.priority} /></div>
                  </div>
                  {/* Feature 5: Milestones directly clickable/editable */}
                  <div style={{ marginBottom: 10 }}>
                    {ms.slice(0, 3).map((m, i) => {
                      const isOwner = user?.name === pr.owner || user?.name === pr.sponsor || isAdmin;
                      return (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }} onClick={ev => { ev.stopPropagation(); if (isOwner) { const updated = { ...pr, milestones: ms.map((x, idx) => idx === i ? { ...x, done: !x.done } : x) }; setProjects(p => p.map(x => x.id === updated.id ? updated : x)); onProjectUpdate(updated); } }}>
                          <span style={{ width: 16, height: 16, borderRadius: "50%", background: m.done ? T.green : T.border, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", flexShrink: 0, cursor: isOwner ? "pointer" : "default", border: `1.5px solid ${m.done ? T.green : T.border}`, transition: "all .2s" }}>{m.done ? "✓" : ""}</span>
                          <span style={{ fontSize: 11, color: m.done ? T.text2 : T.text, textDecoration: m.done ? "line-through" : "none", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                          <span style={{ fontSize: 10, color: T.text2, flexShrink: 0 }}>{fmt(m.due)}</span>
                        </div>
                      );
                    })}
                    {ms.length > 3 && <div style={{ fontSize: 10, color: T.text2, paddingLeft: 24 }}>+{ms.length - 3} more milestones</div>}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                    <div style={{ background: T.border, borderRadius: 6, height: 6, flex: 1, overflow: "hidden" }}><div style={{ height: "100%", borderRadius: 6, width: `${milestonePct}%`, background: barColor, transition: "width .6s" }} /></div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: barColor, minWidth: 36 }}>{milestonePct}%</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: T.text2 }}>
                    <span>{fmt(pr.start)} → {fmt(pr.end)}</span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <span>{done}/{ms.length} milestones</span>
                      {projMeetings.length > 0 && <span>· {projMeetings.length} meeting{projMeetings.length !== 1 ? "s" : ""}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {charter && <ProjectCharterModal pr={charter} onClose={() => { setCharter(null); setCharterActionSel(null); }} actions={actions} meetings={meetings} user={user} users={users} onProjectUpdate={updated => { setProjects(p => p.map(x => x.id === updated.id ? updated : x)); onProjectUpdate(updated); }} onActionSelect={a => setCharterActionSel(a)} />}
      {charterActionSel && <ActionDetailPanel action={charterActionSel} onClose={() => setCharterActionSel(null)} onUpdate={() => { }} user={user} users={users} allUsers={users} plants={plants} />}
      {showAddMtg && <AddMeetingModal plants={plants} users={users} projects={projects} onSave={m => { setMeetings(p => [...p, { ...m, id: "M" + Date.now(), completedSessions: [] }]); setShowAddMtg(false); }} onClose={() => setShowAddMtg(false)} />}
      {/* Feature 3: Add Project Modal */}
      {showAddProject && <AddProjectModal plants={plants} users={users} onSave={p => { setProjects(prev => [...prev, { ...p, id: "PR" + Date.now(), milestones: [], risks: "", team: [] }]); showAddProject && setShowAddProject(false); }} onClose={() => setShowAddProject(false)} />}
      {/* Feature 4: Meeting Plan Side Panel */}
      {mtgPlan && <MeetingPlanPanel key={mtgPlan.id} mtg={mtgPlan} canEdit={canEditMeetings} projects={projects} users={users} plants={plants} onSave={updated => { setMeetings(p => p.map(m => m.id === updated.id ? updated : m)); setMtgPlan(updated); }} onClose={() => setMtgPlan(null)} mtgPresets={mtgPresets} />}
    </div>
  );
}

/* Feature 3: Add Project Modal */
function AddProjectModal({ plants, users, onSave, onClose }) {
  useEscClose(onClose);
  const [f, setF] = useState({ name: "", plant: "", owner: "", start: "", end: "", priority: "NORMAL", status: "NOT STARTED", objective: "", scope: "", budget: "", sponsor: "" });
  const up = (k, v) => setF(x => ({ ...x, [k]: v }));
  const valid = f.name && f.plant && f.owner && f.start && f.end;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ width: 540, padding: 28 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ fontFamily: "'Sora',sans-serif", fontSize: 16, fontWeight: 800, color: T.navy }}>Create New Project</h2>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 22, color: T.text2 }}>×</button>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          <div><Lbl t="Project Name" req /><input value={f.name} onChange={e => up("name", e.target.value)} placeholder="e.g. Safety Drive Q3" /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><Lbl t="Plant" req /><select value={f.plant} onChange={e => up("plant", e.target.value)}><option value="">Select</option><option>All</option>{plants.map(p => <option key={p.id}>{p.name}</option>)}</select></div>
            <div><Lbl t="Priority" /><select value={f.priority} onChange={e => up("priority", e.target.value)}>{PRIORITY_LIST.map(p => <option key={p}>{p}</option>)}</select></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><Lbl t="Owner" req /><select value={f.owner} onChange={e => up("owner", e.target.value)}><option value="">Select</option>{users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}</select></div>
            <div><Lbl t="Sponsor" /><select value={f.sponsor} onChange={e => up("sponsor", e.target.value)}><option value="">Select</option>{users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}</select></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><Lbl t="Start Date" req /><input type="date" value={f.start} onChange={e => up("start", e.target.value)} /></div>
            <div><Lbl t="End Date" req /><input type="date" value={f.end} onChange={e => up("end", e.target.value)} /></div>
          </div>
          <div><Lbl t="Budget" /><input value={f.budget} onChange={e => up("budget", e.target.value)} placeholder="INR 0,00,000" /></div>
          <div><Lbl t="Objective" /><textarea value={f.objective} onChange={e => up("objective", e.target.value)} style={{ height: 64, resize: "none" }} /></div>
          <div><Lbl t="Scope" /><textarea value={f.scope} onChange={e => up("scope", e.target.value)} style={{ height: 64, resize: "none" }} /></div>
        </div>
        <div style={{ marginTop: 20, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-navy" onClick={() => { if (valid) onSave(f); }} disabled={!valid}>Create Project</button>
        </div>
      </div>
    </div>
  );
}

/* Feature 4: Meeting Plan Side Panel */
function MeetingPlanPanel({ mtg, canEdit, projects, users, plants, onSave, onClose, mtgPresets }) {
  useEscClose(onClose);
  const [editMode, setEditMode] = useState(false);
  const defaultInstructions = mtgPresets?.instructions?.[mtg.type] || ["Follow meeting agenda", "Capture all action points", "Assign clear owners and due dates", "Confirm previous actions before closing"];
  const defaultAttendees = mtgPresets?.attendeeMap?.[mtg.type] || [];
  const [draft, setDraft] = useState({
    ...mtg,
    guidelines: mtg.guidelines || [...defaultInstructions],
    attendees: mtg.attendees || [...defaultAttendees],
  });
  const up = (k, v) => setDraft(x => ({ ...x, [k]: v }));
  const guidelines = draft.guidelines;
  const attendees = draft.attendees;
  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", zIndex: 340 }} onClick={onClose} />
      <div className="side-panel" style={{ width: 520, padding: 0 }}>
        <div style={{ background: `linear-gradient(135deg,${T.navy},#3D378C)`, padding: "20px 24px", color: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 10, opacity: .6, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Meeting Plan</div>
              <h2 style={{ fontFamily: "'Sora',sans-serif", fontSize: 17, fontWeight: 800, marginBottom: 4 }}>{editMode ? draft.type : mtg.type}</h2>
              <div style={{ fontSize: 12, opacity: .8 }}>{mtg.plant} · {mtg.time} · {mtg.dur}min</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {canEdit && !editMode && <button onClick={() => setEditMode(true)} style={{ background: "rgba(255,255,255,.2)", border: "none", color: "#fff", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>✏ Edit</button>}
              {editMode && <><button onClick={() => { onSave(draft); setEditMode(false); }} style={{ background: T.green, border: "none", color: "#fff", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Save</button><button onClick={() => { setDraft({ ...mtg, guidelines: mtg.guidelines || [...defaultInstructions], attendees: mtg.attendees || [...defaultAttendees] }); setEditMode(false); }} style={{ background: "rgba(255,255,255,.2)", border: "none", color: "#fff", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Cancel</button></>}
              <button onClick={onClose} style={{ background: "rgba(255,255,255,.15)", border: "none", color: "#fff", borderRadius: 8, width: 30, height: 30, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            </div>
          </div>
        </div>
        <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            {[{ l: "Type", k: "type", opts: MEETING_TYPES, type: "select" }, { l: "Facilitator", k: "facilitator", type: "userselect" }, { l: "Time", k: "time", type: "time" }, { l: "Duration (min)", k: "dur", type: "number" }].map(({ l, k, opts, type }) => (
              <div key={k}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.text2, textTransform: "uppercase", letterSpacing: .4, marginBottom: 4 }}>{l}</div>
                {editMode
                  ? type === "select" ? <select value={draft[k]} onChange={e => up(k, e.target.value)}>{opts.map(o => <option key={o}>{o}</option>)}</select>
                    : type === "userselect" ? <select value={draft[k]} onChange={e => up(k, e.target.value)}>{users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}</select>
                      : <input type={type || "text"} value={draft[k]} onChange={e => up(k, e.target.value)} />
                  : <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{mtg[k]}</div>
                }
              </div>
            ))}
          </div>
          {editMode && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.text2, textTransform: "uppercase", letterSpacing: .4, marginBottom: 4 }}>Linked Project</div>
              <select value={draft.project || ""} onChange={e => up("project", e.target.value || null)}><option value="">None</option>{projects.map(p => <option key={p.id}>{p.name}</option>)}</select>
            </div>
          )}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.navy }}>📌 Meeting Guidelines</div>
              {editMode && <button onClick={() => up("guidelines", [...guidelines, ""])} style={{ fontSize: 11, background: T.navy, color: "#fff", border: "none", borderRadius: 6, padding: "2px 10px", cursor: "pointer" }}>+ Add</button>}
            </div>
            {editMode
              ? <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {guidelines.map((g, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ color: T.text2, fontSize: 12, minWidth: 18 }}>{i + 1}.</span>
                    <input value={g} onChange={e => up("guidelines", guidelines.map((x, idx) => idx === i ? e.target.value : x))} style={{ flex: 1, fontSize: 12, padding: "5px 8px" }} />
                    <button onClick={() => up("guidelines", guidelines.filter((_, idx) => idx !== i))} style={{ background: "transparent", border: "none", cursor: "pointer", color: T.red, fontSize: 16, lineHeight: 1, padding: "0 4px" }}>×</button>
                  </div>
                ))}
                {guidelines.length === 0 && <div style={{ fontSize: 12, color: T.text2, fontStyle: "italic" }}>No guidelines — click + Add</div>}
              </div>
              : <ol style={{ paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
                {guidelines.map((s, i) => <li key={i} style={{ fontSize: 12, color: T.text, lineHeight: 1.5 }}>{s}</li>)}
                {guidelines.length === 0 && <li style={{ fontSize: 12, color: T.text2, fontStyle: "italic", listStyle: "none" }}>No guidelines added yet</li>}
              </ol>
            }
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.navy }}>👥 Expected Attendees</div>
              {editMode && <select defaultValue="" onChange={e => { const v = e.target.value; if (v && !attendees.includes(v)) up("attendees", [...attendees, v]) }}>
                <option value="" disabled>+ Add person</option>
                {users.filter(u => !attendees.includes(u.name)).map(u => <option key={u.id} value={u.name}>{u.name} ({u.role})</option>)}
              </select>}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {attendees.map((name, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, background: T.bg, borderRadius: 8, padding: "5px 10px" }}>
                  <Avatar name={name} size={22} users={users || []} /><span style={{ fontSize: 12 }}>{name}</span>
                  {editMode && <button onClick={() => up("attendees", attendees.filter((_, idx) => idx !== i))} style={{ background: "transparent", border: "none", cursor: "pointer", color: T.red, fontSize: 14, lineHeight: 1, padding: "0 2px", marginLeft: 2 }}>×</button>}
                </div>
              ))}
              {attendees.length === 0 && <div style={{ fontSize: 12, color: T.text2, fontStyle: "italic" }}>No attendees added</div>}
            </div>
          </div>
          {(mtg.completedSessions || []).length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.navy, marginBottom: 8 }}>📊 Past Sessions</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {(mtg.completedSessions || []).map((s, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", background: T.bg, borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
                    <span>{fmt(s.date)}</span><span style={{ fontWeight: 600, color: T.navy }}>{s.duration} min</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ADD MEETING MODAL */
function AddMeetingModal({ plants, users, projects, onSave, onClose }) {
  useEscClose(onClose);
  const [f, setF] = useState({ name: "", type: "Custom", plant: "", time: "09:00", dur: 60, facilitator: "", recurring: false, recurrence: "daily", project: null });
  const [usePreset, setUsePreset] = useState(false);
  const up = (k, v) => setF(x => ({ ...x, [k]: v }));
  const RECURRENCE_OPTS = [
    { v: "daily", l: "Daily" },
    { v: "shift", l: "Per Shift" },
    { v: "weekly", l: "Weekly" },
    { v: "monthly", l: "Monthly" },
    { v: "quarterly", l: "Quarterly" },
    { v: "yearly", l: "Yearly" },
  ];
  const canSave = f.name.trim() && f.plant && f.facilitator && f.time && f.project;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ width: 500, padding: 28 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ fontFamily: "'Sora',sans-serif", fontSize: 16, fontWeight: 800, color: T.navy }}>Schedule New Meeting</h2>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 22, color: T.text2 }}>×</button>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          {/* Meeting name — free text */}
          <div>
            <Lbl t="Meeting Name" req />
            <input value={f.name} onChange={e => up("name", e.target.value)} placeholder="e.g. Furnace Daily Review, Safety Briefing…" />
          </div>
          {/* Optional: pick from preset types */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={usePreset} onChange={e => setUsePreset(e.target.checked)} id="usePreset" style={{ width: 14, cursor: "pointer" }} />
            <label htmlFor="usePreset" style={{ fontSize: 12, cursor: "pointer", color: T.text2 }}>Or choose from standard meeting types:</label>
            {usePreset && <select value={f.type} onChange={e => { up("type", e.target.value); up("name", e.target.value); }} style={{ flex: 1, fontSize: 12 }}>
              {MEETING_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><Lbl t="Plant" req /><select value={f.plant} onChange={e => up("plant", e.target.value)}><option value="">Select</option><option>All</option>{plants.map(p => <option key={p.id}>{p.name}</option>)}</select></div>
            <div><Lbl t="Time" req /><input type="time" value={f.time} onChange={e => up("time", e.target.value)} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><Lbl t="Duration (min)" /><input type="number" value={f.dur} onChange={e => up("dur", +e.target.value)} min={15} max={360} /></div>
            <div><Lbl t="Facilitator" req /><select value={f.facilitator} onChange={e => up("facilitator", e.target.value)}><option value="">Select</option>{users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}</select></div>
          </div>
          {/* Link to Project — mandatory with star */}
          <div>
            <Lbl t="Link to Project" req />
            <select value={f.project || ""} onChange={e => up("project", e.target.value || null)} style={{ borderColor: !f.project ? T.red : T.border }}>
              <option value="">Select project (required)…</option>
              {projects.map(p => <option key={p.id}>{p.name}</option>)}
            </select>
            {!f.project && <div style={{ fontSize: 11, color: T.red, marginTop: 3 }}>Project is required to schedule a meeting.</div>}
          </div>
          {/* Recurring toggle + cadence */}
          <div style={{ background: T.bg, borderRadius: 8, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: f.recurring ? 10 : 0 }}>
              <input type="checkbox" checked={f.recurring} onChange={e => up("recurring", e.target.checked)} id="rec2" style={{ width: 16, cursor: "pointer" }} />
              <label htmlFor="rec2" style={{ fontSize: 13, cursor: "pointer", fontWeight: 600 }}>Recurring meeting</label>
            </div>
            {f.recurring && (
              <div>
                <Lbl t="Recurrence Frequency" />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                  {RECURRENCE_OPTS.map(o => (
                    <button key={o.v} onClick={() => up("recurrence", o.v)} style={{ padding: "5px 12px", borderRadius: 6, border: `1.5px solid ${f.recurrence === o.v ? T.navy : T.border}`, background: f.recurrence === o.v ? T.navy : "transparent", color: f.recurrence === o.v ? "#fff" : T.text, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div style={{ marginTop: 20, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-navy" disabled={!canSave} style={{ opacity: canSave ? 1 : .5, cursor: canSave ? "pointer" : "not-allowed" }} onClick={() => { if (canSave) onSave({ ...f, type: f.name }); }}>Schedule</button>
        </div>
      </div>
    </div>
  );
}

/* ===================== MEETING ROOM ===================== */
function MeetingRoom({ mtg, plants, depts, users, onCommit, onCloseMeeting, onBack, prevActions, relatedActions, running, setRunning, elapsed, txLines, setTxLines, fastActions, setFastActions, insights, setInsights, currentUser, mtgPresets, setActions }) {
  const [phase, setPhase] = useState("live");
  const [showSidePanel, setShowSidePanel] = useState(false);
  const [selAction, setSelAction] = useState(null);
  const [mtgShowMine, setMtgShowMine] = useState(false);
  const [mtgPendingSearch, setMtgPendingSearch] = useState("");
  const [mtgFilters, setMtgFilters] = useState({});
  const [mtgActionView, setMtgActionView] = useState("table");
  const [exitConfirm, setExitConfirm] = useState(false);
  const [sttStatus, setSttStatus] = useState("idle"); // idle | listening | error | unsupported
  const [sttInterim, setSttInterim] = useState("");
  const [analyzingPara, setAnalyzingPara] = useState(false);
  const [sttLang, setSttLang] = useState("hi-IN"); // "en-IN" or "hi-IN" — hi-IN works better for Hinglish/Indian accents
  const [translating, setTranslating] = useState(false);
  const [apiLimitPopup, setApiLimitPopup] = useState(null); // null | "translate" | "insights"
  // Separate fail counters so translate failures don't block Gemini insights
  const translateFailRef = useRef(0);
  const analyzeFailRef = useRef(0);
  const API_FAIL_LIMIT = 3;
  const apiFailCountRef = analyzeFailRef; // alias kept for any other usages

  const txRef = useRef(null);
  const insightsRef = useRef(null);
  const recognitionRef = useRef(null);
  const paraBufferRef = useRef(""); // accumulates words between silences
  // 2-minute batch analysis refs
  const batchTimerRef = useRef(null);
  const lastAnalyzedIdxRef = useRef(0); // tracks which txLines were already analyzed
  const [batchCountdown, setBatchCountdown] = useState(120); // seconds until next analysis
  const batchCountdownRef = useRef(null);
  const instructions = mtgPresets?.instructions?.[mtg.type] || ["Follow meeting agenda", "Capture all action points", "Assign clear owners and due dates", "Confirm previous actions before closing"];
  const attendees = mtgPresets?.attendeeMap?.[mtg.type] || [];

  // Auto-scroll transcript
  useEffect(() => { if (txRef.current) txRef.current.scrollTop = txRef.current.scrollHeight; }, [txLines, sttInterim]);
  // Auto-scroll insights
  useEffect(() => { if (insightsRef.current) insightsRef.current.scrollTop = insightsRef.current.scrollHeight; }, [insights]);

  const latestInsightsRef = useRef(insights);
  useEffect(() => { latestInsightsRef.current = insights; }, [insights]);

  // ── Smart Translate: Only translate if Hindi (Devanagari) text is detected ──
  const translateText = useCallback(async (rawTxt) => {
    if (!rawTxt || rawTxt.trim().length < 2) return rawTxt;

    // Detect if text contains Devanagari (Hindi script) — if yes, translate; if no, keep as-is
    const hasDevanagari = /[\u0900-\u097F]/.test(rawTxt);
    if (!hasDevanagari) {
      // Already in Roman/Latin script (English or Hinglish in Roman), no translation needed
      return rawTxt.trim();
    }

    // Back off if backend repeatedly unavailable (translate-specific counter)
    if (translateFailRef.current >= API_FAIL_LIMIT) {
      if (translateFailRef.current === API_FAIL_LIMIT) setApiLimitPopup("translate");
      return rawTxt.trim();
    }

    if (!API_BASE_URL) return rawTxt.trim();

    try {
      setTranslating(true);
      const res = await fetch(`${API_BASE_URL}/api/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: rawTxt.trim(), source: "hi", target: "en" })
      });
      const data = await res.json();
      setTranslating(false);
      translateFailRef.current = 0; // reset on success
      return data.translated || rawTxt;
    } catch (e) { console.warn("Translation failed (backend offline?):", e); setTranslating(false); translateFailRef.current++; if (translateFailRef.current >= API_FAIL_LIMIT) setApiLimitPopup("translate"); return rawTxt; }
  }, [/* no deps */]);

  // ── Analyze a paragraph via backend Gemini ───────────────────────────────
  const analyzeParagraph = useCallback(async (para) => {
    if (!para || para.trim().length < 20) return;
    if (!API_BASE_URL) { console.warn("Insights skipped: VITE_API_BASE_URL not set in .env"); return; }
    // Back off only if Gemini/analyze endpoint itself is repeatedly failing
    if (analyzeFailRef.current >= API_FAIL_LIMIT) {
      if (analyzeFailRef.current === API_FAIL_LIMIT) setApiLimitPopup("insights");
      console.warn("Insights paused: backend analyze endpoint failed 3 times. Is the server running?");
      return;
    }
    setAnalyzingPara(true);
    try {
      const hasDevanagari = /[\u0900-\u097F]/.test(para);
      const source_lang = hasDevanagari ? "hi" : "en";

      const res = await fetch(`${API_BASE_URL}/api/meetings/analyze-paragraph`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paragraph: para.trim(),
          meeting_type: mtg.type,
          source_lang: source_lang
        })
      });
      const parsed = await res.json();
      analyzeFailRef.current = 0; // reset on success
      const insight = {
        id: Date.now(),
        para: para.trim(),
        ts: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
        actions: (parsed.actions || []).map((a, i) => ({ ...a, id: Date.now() + i, _staged: false })),
        decisions: parsed.decisions || [],
        risks: parsed.risks || [],
        keyPoints: parsed.keyPoints || []
      };
      setInsights(p => {
        const existingActionTexts = p.flatMap(ins => ins.actions.map(a => a.text.toLowerCase()));
        const newActions = insight.actions.filter(a => {
          const txt = a.text.toLowerCase();
          return !existingActionTexts.some(ext => txt.includes(ext) || ext.includes(txt));
        });
        insight.actions = newActions;
        if (insight.actions.length || insight.decisions.length || insight.risks.length || insight.keyPoints.length) {
          return [...p, insight];
        }
        return p;
      });
    } catch (e) {
      analyzeFailRef.current++;
      if (analyzeFailRef.current >= API_FAIL_LIMIT) setApiLimitPopup("insights");
      console.warn(`Insight analysis failed (attempt ${analyzeFailRef.current}/${API_FAIL_LIMIT}). Is the backend running at ${API_BASE_URL}?`, e);
    }
    setAnalyzingPara(false);
  }, [mtg.type, setInsights]);

  // ── Start Chrome STT ──────────────────────────────────────────────────────
  // hi-IN works better for Indian-accented speech and Hinglish (Hindi+English mix)
  const startSTT = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setSttStatus("unsupported"); return; }
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = sttLang;
    r.maxAlternatives = 1;

    r.onstart = () => setSttStatus("listening");
    r.onerror = (e) => {
      if (e.error === "no-speech") return; // benign
      setSttStatus("error");
      console.warn("STT error:", e.error);
    };
    r.onend = () => {
      // Auto-restart if meeting still running
      if (recognitionRef.current && running) {
        try { recognitionRef.current.start(); } catch (ex) { }
      }
    };

    r.onresult = (e) => {
      let interimTxt = "", finalTxt = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalTxt += t + " ";
        else interimTxt += t;
      }
      setSttInterim(interimTxt);

      if (finalTxt.trim()) {
        paraBufferRef.current += finalTxt;
        // Always run translateText — it internally detects script (Devanagari → translate, Roman → return as-is)
        const processTxt = async (rawTxt) => {
          const displayTxt = await translateText(rawTxt);
          return displayTxt;
        };

        // Process text through smart translation — display only, no per-paragraph analysis
        const rawPara = finalTxt.trim();
        processTxt(rawPara).then(processed => {
          setTxLines(p => {
            const last = p[p.length - 1] || "";
            const combined = last + (last ? " " : "") + processed;
            if (combined.length > 150 || /[.!?।]\s*$/.test(processed)) {
              return [...p.slice(0, -1), combined.trim(), ""];
            }
            return p.length === 0 ? [processed] : [...p.slice(0, -1), combined.trim()];
          });
        });
      }
    };

    recognitionRef.current = r;
    try { r.start(); } catch (ex) { setSttStatus("error"); }
  }, [running, analyzeParagraph, setTxLines, sttLang, translateText]);

  // ── Stop STT ──────────────────────────────────────────────────────────────
  const stopSTT = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null; // prevent auto-restart
      try { recognitionRef.current.stop(); } catch (ex) { }
      recognitionRef.current = null;
    }
    setSttStatus("idle");
    setSttInterim("");
    // Analyze any remaining buffer on stop
    if (paraBufferRef.current.trim().length > 10) {
      paraBufferRef.current = "";
    }
  }, []);



  // Latest txLines ref for interval access
  const txLinesRef = useRef(txLines);
  useEffect(() => { txLinesRef.current = txLines; }, [txLines]);

  useEffect(() => {
    if (!running) {
      // Stop batch timer when meeting paused
      clearInterval(batchTimerRef.current);
      clearInterval(batchCountdownRef.current);
      return;
    }
    // Reset countdown
    setBatchCountdown(120);
    lastAnalyzedIdxRef.current = 0;

    // Countdown every second
    batchCountdownRef.current = setInterval(() => {
      setBatchCountdown(c => {
        if (c <= 1) return 120; // reset after triggering
        return c - 1;
      });
    }, 1000);

    // Main 2-minute analysis interval
    batchTimerRef.current = setInterval(() => {
      const lines = txLinesRef.current || [];
      const startIdx = lastAnalyzedIdxRef.current;
      const newLines = lines.slice(startIdx).filter(l => l.trim());
      if (newLines.length > 0) {
        const batchText = newLines.join(" ").trim();
        if (batchText.length >= 20) {
          analyzeParagraph(batchText);
        }
        lastAnalyzedIdxRef.current = lines.length;
      }
      setBatchCountdown(120); // reset countdown
    }, 120000); // 2 minutes

    return () => {
      clearInterval(batchTimerRef.current);
      clearInterval(batchCountdownRef.current);
    };
  }, [running, analyzeParagraph]);

  // When meeting stops, do one final analysis of remaining unanalyzed transcript
  useEffect(() => {
    if (!running && txLines.length > 0) {
      const startIdx = lastAnalyzedIdxRef.current;
      const newLines = txLines.slice(startIdx).filter(l => l.trim());
      if (newLines.length > 0) {
        const batchText = newLines.join(" ").trim();
        if (batchText.length >= 20) {
          analyzeParagraph(batchText);
          lastAnalyzedIdxRef.current = txLines.length;
        }
      }
    }
  }, [running]);// eslint-disable-line

  // Start/stop STT with meeting running state
  useEffect(() => {
    if (running) startSTT();
    else stopSTT();
    return () => stopSTT();
  }, [running]);// eslint-disable-line

  const hms = s => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const triggerManualAnalysis = () => {
    if (analyzingPara) return;
    const lines = txLinesRef.current || [];
    const startIdx = lastAnalyzedIdxRef.current;
    const newLines = lines.slice(startIdx).filter(l => l.trim());
    if (newLines.length > 0) {
      const batchText = newLines.join(" ").trim();
      if (batchText.length >= 20) {
        analyzeParagraph(batchText);
        lastAnalyzedIdxRef.current = lines.length;
        setBatchCountdown(120);
      }
    }
  };

  const exportTranscript = () => {
    if (!txLines || txLines.length === 0) return;
    const text = txLines.map((l, i) => `${i + 1}. ${l}`).join("\n\n");
    const blob = new Blob([`Meeting: ${mtg.type}\nLocation: ${mtg.plant}\nDate: ${new Date().toLocaleDateString()}\n\n--- TRANSCRIPT ---\n\n${text}`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Transcript_${mtg.type.replace(/\s+/g, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stopAndStage = () => {
    stopSTT();
    setRunning(false);
    // Gather all AI-suggested actions from insights
    const aiActions = insights.flatMap(ins =>
      ins.actions.map((a, i) => ({
        id: Date.now() + Math.random(),
        text: a.text,
        responsible: a.responsible || "",
        priority: a.priority || "NORMAL",
        section: a.section || "General",
        src: mtg.type,
        srcId: mtg.id || null,
        plant: mtg.plant,
        status: "IN PROCESS",
        revisions: 0, revisionHistory: [],
        created: todayStr(), closedOn: null,
        dateOfAction: todayStr(),
        fromTranscript: true,
        fromInsights: true,
        project: mtg.project || null,
        messages: [], pendingConfirmation: false,
        due: ""
      }))
    );
    // Also include manually fast-logged actions
    const fromFast = (Array.isArray(fastActions) ? fastActions : []).filter(a => a.text?.trim()).map((a, i) => ({
      ...a, id: Date.now() + 1000 + i, src: mtg.type, srcId: mtg.id || null, plant: mtg.plant,
      section: a.section || "General", status: "IN PROCESS", priority: a.priority || "NORMAL",
      revisions: 0, revisionHistory: [], created: todayStr(), closedOn: null,
      dateOfAction: todayStr(), project: mtg.project || null, messages: [], pendingConfirmation: false
    }));
    setPhase({ fromFast, txActions: aiActions });
  };

  // ── Stage action from insight card ───────────────────────────────────────
  const stageInsightAction = (insId, actId) => {
    setInsights(p => p.map(ins => ins.id === insId ? {
      ...ins,
      actions: ins.actions.map(a => a.id === actId ? { ...a, _staged: true } : a)
    } : ins));
  };

  if (phase !== "live") {
    const { fromFast, txActions } = phase;
    return <StagingArea staged={[...(fromFast || []), ...(txActions || [])]} mtg={mtg} plants={plants} depts={depts} users={users} txLines={txLines} onCommit={rows => { onCommit(rows); onCloseMeeting(); }} onCloseMeeting={onCloseMeeting} onBack={() => setPhase("live")} elapsedSecs={elapsed} />;
  }

  /* ── Paused Meeting Prompt ─────────────────────────────────────── */
  /* When meeting was stopped (running=false) but session data exists, 
     show Resume/Exit choice instead of jumping into live view */
  const hasSessionData = (elapsed || 0) > 0 || txLines.filter(l => l.trim()).length > 0 || (Array.isArray(fastActions) && fastActions.length > 0) || insights.length > 0;
  if (!running && hasSessionData && !exitConfirm) {
    const wordCount = txLines.join(" ").split(" ").filter(Boolean).length;
    const actionCount = insights.reduce((n, ins) => n + ins.actions.length, 0) + (Array.isArray(fastActions) ? fastActions.length : 0);
    return (
      <div className="fade-in" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "70vh" }}>
        <div style={{ width: 520, textAlign: "center" }}>
          <div style={{ width: 80, height: 80, borderRadius: "50%", background: T.amber + "20", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 20px", border: `3px solid ${T.amber}40` }}>⏸</div>
          <h1 style={{ fontFamily: "'Sora',sans-serif", fontSize: 24, fontWeight: 800, color: T.navy, marginBottom: 8 }}>Meeting Paused</h1>
          <div style={{ fontSize: 14, color: T.text2, marginBottom: 24 }}>{mtg.type} · {mtg.plant}</div>

          {/* Session summary */}
          <div className="card" style={{ padding: 20, marginBottom: 24, textAlign: "left" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.text2, textTransform: "uppercase", letterSpacing: .5, marginBottom: 12 }}>Session Summary</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
              {[
                { icon: "⏱", label: "Duration", value: hms(elapsed || 0), color: T.navy },
                { icon: "📝", label: "Words Captured", value: wordCount, color: T.amber },
                { icon: "⚡", label: "Actions Found", value: actionCount, color: T.green },
              ].map(k => (
                <div key={k.label} style={{ textAlign: "center", padding: "10px 0", borderRadius: 10, background: k.color + "08", border: `1px solid ${k.color}20` }}>
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{k.icon}</div>
                  <div style={{ fontFamily: "'Sora',sans-serif", fontSize: 20, fontWeight: 800, color: k.color }}>{k.value}</div>
                  <div style={{ fontSize: 10, color: T.text2, marginTop: 2 }}>{k.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 16 }}>
            <button className="btn btn-navy" style={{ padding: "14px 32px", fontSize: 15, borderRadius: 12 }} onClick={() => setRunning(true)}>
              ▶ Resume Meeting
            </button>
            <button className="btn btn-amber" style={{ padding: "14px 32px", fontSize: 15, borderRadius: 12 }} onClick={stopAndStage}>
              ⏹ Stop & Review Actions
            </button>
          </div>

          {/* Exit option */}
          <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 16, marginTop: 8 }}>
            <button onClick={() => { try { stopSTT(); } catch (e) { } onCloseMeeting && onCloseMeeting(); }} style={{ border: "none", background: "transparent", color: T.red, cursor: "pointer", fontSize: 12, fontWeight: 600, opacity: .7 }}>
              🚪 Exit without saving
            </button>
          </div>
        </div>
      </div>
    );
  }
  // Reset exitConfirm if we get back to running
  if (running && exitConfirm) setExitConfirm(false);

  const pendingRelated = (relatedActions || [])
    .filter(a => a.status !== "COMPLETED" && a.status !== "DROPPED")
    .sort((a, b) => {
      const over_a = isOverdue(a) ? -1 : 0, over_b = isOverdue(b) ? -1 : 0;
      if (over_a !== over_b) return over_a - over_b;
      if (!a.due) return 1; if (!b.due) return -1;
      return new Date(a.due) - new Date(b.due);
    });
  const myPending = pendingRelated.filter(a => a.responsible === currentUser?.name || a.allocatedBy === currentUser?.name);
  const displayPending = mtgShowMine ? myPending : pendingRelated;

  const insightCount = insights.reduce((n, ins) => n + ins.actions.length + ins.decisions.length + ins.risks.length + ins.keyPoints.length, 0);

  return (
    <div className="fade-in">
      {/* API Limit Popup */}
      {apiLimitPopup && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "28px 32px", maxWidth: 400, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,.25)", textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>{apiLimitPopup === "translate" ? "🔇" : "🤖"}</div>
            <div style={{ fontFamily: "'Sora',sans-serif", fontSize: 17, fontWeight: 800, color: T.red, marginBottom: 8 }}>
              {apiLimitPopup === "translate" ? "Translation Limit Reached" : "AI Insights Limit Reached"}
            </div>
            <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.6, marginBottom: 20 }}>
              {apiLimitPopup === "translate"
                ? "The translation service failed 3 times and has been paused. Transcription will continue in the original language. Please check your backend server at"
                : "The AI insights service failed 3 times and has been paused. Transcription will continue without live insights. Please check your backend server at"}
              <br /><b style={{ color: T.navy }}>{API_BASE_URL || "localhost:8000"}</b>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button className="btn btn-ghost" onClick={() => {
                if (apiLimitPopup === "translate") translateFailRef.current = 0;
                else analyzeFailRef.current = 0;
                setApiLimitPopup(null);
              }} style={{ fontSize: 13 }}>🔄 Retry</button>
              <button className="btn btn-navy" onClick={() => setApiLimitPopup(null)} style={{ fontSize: 13 }}>Dismiss</button>
            </div>
          </div>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
          <div>
            <h1 style={{ fontFamily: "'Sora',sans-serif", fontSize: 20, fontWeight: 800, color: T.navy }}>{mtg.type}</h1>
            <div style={{ fontSize: 12, color: T.text2, marginTop: 2 }}>{mtg.plant} · {mtg.time} · Facilitator: <b>{mtg.facilitator}</b>{mtg.project && <> · <b style={{ color: T.amber }}>{mtg.project}</b></>}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* STT Status pill + language indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 20, background: sttStatus === "listening" ? "#D5F5E3" : sttStatus === "error" ? "#FADBD8" : sttStatus === "unsupported" ? "#FEF3CD" : "#F0F0F8", fontSize: 11, fontWeight: 600, color: sttStatus === "listening" ? T.green : sttStatus === "error" ? T.red : sttStatus === "unsupported" ? T.amber : T.slate }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: sttStatus === "listening" ? "#27AE60" : sttStatus === "error" ? "#C0392B" : sttStatus === "unsupported" ? "#E69903" : "#95A5A6", animation: sttStatus === "listening" ? "blink 1s infinite" : "none", flexShrink: 0 }} />
            {sttStatus === "listening" && "🎙 Listening"}
            {sttStatus === "idle" && "⏸ Mic off"}
            {sttStatus === "error" && "⚠ Mic error"}
            {sttStatus === "unsupported" && "⚠ STT not supported"}
          </div>
          {/* Language badge */}
          <div style={{ fontSize: 10, fontWeight: 700, background: sttLang === "hi-IN" ? T.amber : "#E8E8F0", color: sttLang === "hi-IN" ? T.navy : T.text2, padding: "3px 9px", borderRadius: 12, border: `1px solid ${sttLang === "hi-IN" ? T.amber + "60" : T.border}` }}>
            {sttLang === "hi-IN" ? "🇮🇳 Hinglish Mode" : "EN Mode"}
          </div>
          {/* Language toggle — hi-IN recommended for Hinglish/Indian-accented speech */}
          <div style={{ display: "flex", background: T.border, borderRadius: 8, padding: 2, gap: 0 }}>
            <button onClick={() => { if (!running) setSttLang("en-IN"); }} style={{ padding: "5px 12px", borderRadius: 6, border: "none", cursor: running ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 700, background: sttLang === "en-IN" ? T.navy : "transparent", color: sttLang === "en-IN" ? "#fff" : T.text2, transition: "all .15s", opacity: running ? .6 : 1 }} title={running ? "Stop meeting to switch language" : "English only (pure English)"}>EN</button>
            <button onClick={() => { if (!running) setSttLang("hi-IN"); }} style={{ padding: "5px 12px", borderRadius: 6, border: "none", cursor: running ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 700, background: sttLang === "hi-IN" ? T.navy : "transparent", color: sttLang === "hi-IN" ? "#fff" : T.text2, transition: "all .15s", opacity: running ? .6 : 1 }} title={running ? "Stop meeting to switch language" : "Hinglish: Hindi+English mix, Indian accent"}>🇮🇳 HI/EN</button>
          </div>
          {translating && <span style={{ fontSize: 10, color: T.amber, fontWeight: 600, animation: "blink 1s infinite" }}>🔄 Translating…</span>}
          <button className="btn btn-amber" style={{ fontWeight: 700, fontSize: 13 }} onClick={() => setShowSidePanel(true)}>⚡ + Fast Log</button>
          <div style={{ background: running ? T.red : "#636E72", color: "#fff", borderRadius: 10, padding: "8px 16px", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff", flexShrink: 0, animation: running ? "blink 1s infinite" : "none" }} />
            <span style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 800, letterSpacing: 2 }}>{hms(elapsed || 0)}</span>
            {running && <span style={{ fontSize: 9, opacity: .8, fontWeight: 700, letterSpacing: 1 }}>LIVE</span>}
          </div>
          <button className="btn btn-red" style={{ fontWeight: 700 }} onClick={stopAndStage}>⏹ Stop & Review</button>
          <button onClick={() => { try { stopSTT(); } catch (e) { } onCloseMeeting && onCloseMeeting(); }} style={{ border: `1.5px solid ${T.red}`, background: "transparent", color: T.red, borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 12, fontWeight: 700 }} title="Exit meeting immediately">🚪 Exit</button>
        </div>
      </div>

      {/* Pending Actions table — clean Actions Register style ribbon */}
      <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
        {/* Header bar */}
        <div style={{ padding: "12px 16px", borderBottom: `1.5px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: T.navy }}>📋 {mtg.type} — Action Points</span>
            {insights.flatMap(i => i.actions).length > 0 && (
              <span style={{ background: T.amber + "20", color: T.amber, border: `1px solid ${T.amber}40`, borderRadius: 10, padding: "2px 10px", fontSize: 10, fontWeight: 700 }}>
                +{insights.flatMap(i => i.actions).length} from this meeting
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: T.text2 }}>{mtgShowMine ? myPending.length : pendingRelated.length} existing</span>
            {/* All / Mine toggle */}
            <div style={{ display: "flex", background: T.bg, borderRadius: 8, padding: 3, border: `1.5px solid ${T.border}` }}>
              <button onClick={() => setMtgShowMine(false)} style={{ padding: "4px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: !mtgShowMine ? T.navy : "transparent", color: !mtgShowMine ? "#fff" : T.text2, transition: "all .18s" }}>All</button>
              <button onClick={() => setMtgShowMine(true)} style={{ padding: "4px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: mtgShowMine ? T.navy : "transparent", color: mtgShowMine ? "#fff" : T.text2, transition: "all .18s" }}>Mine</button>
            </div>
            {/* View toggle — matches Actions Register */}
            <div style={{ display: "flex", gap: 3, borderLeft: `1px solid ${T.border}`, paddingLeft: 8 }}>
              {[
                { v: "table", icon: "☰", l: "Table" },
                { v: "board", icon: "⊞", l: "Board" },
                { v: "kanban", icon: "▦", l: "Kanban" },
                { v: "timeline", icon: "━", l: "Timeline" },
              ].map(x => (
                <button key={x.v} onClick={() => setMtgActionView(x.v)}
                  style={{ padding: "4px 11px", borderRadius: 7, border: `1.5px solid ${mtgActionView === x.v ? T.navy : T.border}`, background: mtgActionView === x.v ? T.navy : "transparent", color: mtgActionView === x.v ? "#fff" : T.text2, fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, transition: "all .15s" }}>
                  {x.icon} {x.l}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Filter ribbon — matches Actions Register style */}
        <div style={{ padding: "10px 16px", background: "#fff", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <input
              value={mtgPendingSearch || ""}
              onChange={e => setMtgPendingSearch && setMtgPendingSearch(e.target.value)}
              placeholder="🔍 Search actions…"
              style={{ width: 180, fontSize: 12, padding: "5px 10px", border: `1px solid ${T.border}`, borderRadius: 6, outline: "none", fontFamily: "inherit" }}
            />
          </div>
          {[
            { label: "STATUS", key: "mtgStatus", opts: STATUS_LIST },
            { label: "PRIORITY", key: "mtgPriority", opts: PRIORITY_LIST },
            { label: "DEPT", key: "mtgSection", opts: SECTIONS.slice(0, 8) },
          ].map(({ label, key, opts }) => (
            <div key={key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: T.text2, textTransform: "uppercase", letterSpacing: .4 }}>{label}</span>
              <select
                value={(mtgFilters || {})[key] || ""}
                onChange={e => setMtgFilters && setMtgFilters(f => ({ ...f, [key]: e.target.value }))}
                style={{ fontSize: 12, padding: "5px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: "#fff", color: T.text, minWidth: 110, fontFamily: "inherit" }}
              >
                <option value="">{label === "STATUS" ? "All" : label === "PRIORITY" ? "All" : "All"}</option>
                {opts.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          ))}
          {(Object.values(mtgFilters || {}).some(v => v) || mtgPendingSearch) && (
            <button
              onClick={() => { setMtgFilters && setMtgFilters({}); setMtgPendingSearch && setMtgPendingSearch(""); }}
              style={{ alignSelf: "flex-end", fontSize: 12, padding: "5px 14px", background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6, color: T.text2, cursor: "pointer", fontFamily: "inherit" }}
            >✕ Clear</button>
          )}
          <div style={{ marginLeft: "auto", alignSelf: "flex-end", fontSize: 12, color: T.text2, fontWeight: 500 }}>
            {pendingRelated.length}/{pendingRelated.length} shown
          </div>
        </div>
        {/* AI-identified actions from current meeting */}
        {insights.flatMap(ins => ins.actions).length > 0 && (
          <div style={{ padding: "10px 18px", background: T.amber + "10", borderBottom: `1.5px solid ${T.amber}30` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.amber, marginBottom: 6, textTransform: "uppercase", letterSpacing: .4 }}>⚡ Discussed in This Meeting (AI-Identified)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {insights.flatMap(ins => ins.actions).filter((a, idx, arr) => arr.findIndex(x => x.text === a.text) === idx).map((a, i) => (
                <div key={a.id || i} style={{ display: "flex", alignItems: "flex-start", gap: 8, background: a._staged ? T.greenL : "#fff", borderRadius: 7, padding: "6px 10px", border: `1px solid ${a._staged ? T.green + "50" : T.amber + "40"}` }}>
                  <span style={{ fontSize: 11, color: T.amber, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>•</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: T.text }}>{a.text}</div>
                    {a.responsible && <div style={{ fontSize: 10, color: T.text2, marginTop: 1 }}>→ {a.responsible}</div>}
                  </div>
                  <PBadge p={a.priority || "NORMAL"} />
                  {a._staged && <span style={{ fontSize: 10, color: T.green, fontWeight: 700, whiteSpace: "nowrap" }}>✓ Staged</span>}
                </div>
              ))}
            </div>
          </div>
        )}
        {(() => {
          const filteredPending = displayPending.filter(a => {
            if (mtgPendingSearch && ![a.text, a.responsible, a.sn].join(" ").toLowerCase().includes((mtgPendingSearch || "").toLowerCase())) return false;
            if ((mtgFilters || {}).mtgStatus && a.status !== mtgFilters.mtgStatus) return false;
            if ((mtgFilters || {}).mtgPriority && a.priority !== mtgFilters.mtgPriority) return false;
            if ((mtgFilters || {}).mtgSection && a.section !== mtgFilters.mtgSection) return false;
            return true;
          });
          const mtgUpStatus = (id, status) => {
            if (!setActions) return;
            setActions(prev => prev.map(a => String(a.id) === String(id)
              ? { ...a, status, closedOn: status === "COMPLETED" ? todayStr() : null, pendingConfirmation: false }
              : a
            ));
          };
          const mtgUpAction = (id, patch) => {
            if (!setActions) return;
            setActions(prev => prev.map(a => String(a.id) === String(id) ? { ...a, ...patch } : a));
          };
          const canDrag = !!setActions;
          if (filteredPending.length === 0) return (
            <div style={{ padding: "14px 18px", fontSize: 12, color: T.text2 }}>No pending actions linked to this meeting type or project.</div>
          );
          if (mtgActionView === "table") return (
            <div style={{ maxHeight: 280, overflowY: "auto" }}>
              <TableView fa={filteredPending} upStatus={mtgUpStatus} setSel={a => setSelAction(a)} canEdit={canDrag} upAction={mtgUpAction} users={users} />
            </div>
          );
          if (mtgActionView === "board") return (
            <div style={{ maxHeight: 340, overflowY: "auto", padding: 12 }}>
              <BoardView fa={filteredPending} setSel={a => setSelAction(a)} users={users} />
            </div>
          );
          if (mtgActionView === "kanban") return (
            <div style={{ padding: 12, overflowX: "auto" }}>
              <KanbanView fa={filteredPending} upStatus={mtgUpStatus} canEdit={canDrag} users={users} setSel={a => setSelAction(a)} />
            </div>
          );
          if (mtgActionView === "timeline") return (
            <div style={{ maxHeight: 340, overflowY: "auto", padding: 12 }}>
              <TimelineView fa={filteredPending} />
            </div>
          );
          return null;
        })()}
      </div>

      {/* 3-col: Transcript | Insights | Guidelines */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 320px", gap: 14 }}>

        {/* Live Transcript */}
        <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: T.navy }}>🎙 Live Transcript</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button className="btn btn-ghost"
                onClick={exportTranscript}
                disabled={!txLines || txLines.length === 0}
                style={{ padding: "2px 8px", fontSize: 10, height: 22, borderColor: T.border }}>
                📥 Export
              </button>
              {analyzingPara && <span style={{ fontSize: 10, color: T.amber, fontWeight: 600, animation: "blink 1s infinite" }}>⚡ Analyzing…</span>}
              {running && sttStatus === "listening" && <span style={{ fontSize: 10, color: T.green, fontWeight: 600 }}>● REC</span>}
            </div>
          </div>
          <div ref={txRef} style={{ background: T.bg, borderRadius: 8, padding: 12, flex: 1, minHeight: 240, maxHeight: 360, overflowY: "auto", fontSize: 12, lineHeight: 2, color: "#444" }}>
            {txLines.length === 0 && !sttInterim
              ? <span style={{ color: "#B2BEC3" }}>{sttStatus === "unsupported" ? "Chrome STT not supported. Use Fast Log to capture actions manually." : "Microphone ready. Start speaking — transcript appears here in real time."}</span>
              : <>
                {txLines.filter(l => l.trim()).map((l, i) => (
                  <div key={i} style={{ padding: "3px 0", borderBottom: i < txLines.length - 1 ? `1px solid ${T.border}` : "", display: "flex", gap: 8 }}>
                    <span style={{ color: T.text2, fontSize: 10, flexShrink: 0, marginTop: 3 }}>{String(i + 1).padStart(2, "0")}</span>
                    <span style={{ color: l.toLowerCase().includes("action") || l.toLowerCase().includes(" to ") ? T.navy : T.text }}>{l}</span>
                  </div>
                ))}
                {sttInterim && (
                  <div style={{ padding: "3px 0", opacity: .5, fontStyle: "italic", display: "flex", gap: 8 }}>
                    <span style={{ color: T.text2, fontSize: 10, flexShrink: 0, marginTop: 3 }}>…</span>
                    <span>{sttInterim}</span>
                  </div>
                )}
              </>
            }
          </div>
          <div style={{ fontSize: 10, color: T.text2, textAlign: "center" }}>
            {txLines.filter(l => l.trim()).length} paragraphs · {txLines.join(" ").split(" ").filter(Boolean).length} words
          </div>
        </div>

        {/* AI Insights Panel */}
        <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: T.navy }}>⚡ AI Insights</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button className="btn btn-navy btn-sm"
                onClick={triggerManualAnalysis}
                disabled={analyzingPara || !running || (txLines.slice(lastAnalyzedIdxRef.current).filter(l => l.trim()).join("").length < 20)}
                style={{ padding: "2px 8px", fontSize: 10, height: 22 }}>
                {analyzingPara ? <Spin /> : "🧠 Get Insights"}
              </button>
              {insightCount > 0 && <span style={{ background: T.navy, color: "#fff", borderRadius: 20, padding: "1px 8px", fontSize: 10, fontWeight: 700 }}>{insightCount}</span>}
              {analyzingPara && <span style={{ width: 12, height: 12, border: "2px solid #E69903", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} />}
            </div>
          </div>
          {/* 2-min countdown bar */}
          {running && (
            <div style={{ background: T.bg, borderRadius: 8, padding: "8px 12px", border: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: T.text2, textTransform: "uppercase", letterSpacing: .5 }}>Next AI Analysis</span>
                  <span style={{ fontSize: 11, fontWeight: 800, fontFamily: "monospace", color: batchCountdown <= 10 ? T.red : batchCountdown <= 30 ? T.amber : T.navy }}>
                    {Math.floor(batchCountdown / 60)}:{String(batchCountdown % 60).padStart(2, "0")}
                  </span>
                </div>
                <div style={{ background: T.border, borderRadius: 4, height: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 4, background: batchCountdown <= 10 ? T.red : batchCountdown <= 30 ? T.amber : `linear-gradient(90deg,${T.navy},${T.amber})`, width: `${((120 - batchCountdown) / 120) * 100}%`, transition: "width 1s linear" }} />
                </div>
              </div>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: batchCountdown <= 10 ? T.red + "15" : T.navy + "10", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0, animation: batchCountdown <= 10 ? "blink 1s infinite" : "none" }}>
                🧠
              </div>
            </div>
          )}
          <div ref={insightsRef} style={{ flex: 1, minHeight: 240, maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
            {insights.length === 0
              ? <div style={{ textAlign: "center", padding: "32px 12px", color: T.text2 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🧠</div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>AI insights appear here</div>
                <div style={{ fontSize: 11, marginTop: 4 }}>Transcript is analyzed every <b>2 minutes</b> for action items, decisions, and risks.</div>
              </div>
              : insights.map(ins => (
                <div key={ins.id} style={{ background: T.bg, borderRadius: 10, padding: 12, border: `1px solid ${T.border}`, animation: "fadeIn .4s ease" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: T.text2, fontWeight: 600 }}>🕐 {ins.ts}</div>
                    <span style={{ fontSize: 9, background: T.navy + "15", color: T.navy, padding: "1px 7px", borderRadius: 10, fontWeight: 700 }}>2-min batch</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#555", fontStyle: "italic", marginBottom: 8, lineHeight: 1.5, borderLeft: `2px solid ${T.amber}`, paddingLeft: 8 }}>"{ins.para.slice(0, 200)}{ins.para.length > 200 ? "…" : ""}"</div>
                  {ins.actions.length > 0 && (
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: T.navy, marginBottom: 4, textTransform: "uppercase", letterSpacing: .5 }}>Actions</div>
                      {ins.actions.map(a => (
                        <div key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 4, background: a._staged ? "#D5F5E3" : "#fff", borderRadius: 6, padding: "5px 8px", border: `1px solid ${a._staged ? T.green + "40" : T.border}` }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, fontWeight: 500, color: T.text }}>{a.text}</div>
                            {a.responsible && <div style={{ fontSize: 10, color: T.text2, marginTop: 1 }}>→ {a.responsible}</div>}
                          </div>
                          <PBadge p={a.priority || "NORMAL"} />
                          {a._staged
                            ? <span style={{ fontSize: 10, color: T.green, fontWeight: 700, whiteSpace: "nowrap" }}>✓ Staged</span>
                            : <button onClick={() => stageInsightAction(ins.id, a.id)} style={{ border: `1px solid ${T.navy}`, borderRadius: 5, background: T.navy, color: "#fff", cursor: "pointer", fontSize: 10, fontWeight: 700, padding: "2px 7px", whiteSpace: "nowrap" }}>+ Add</button>
                          }
                        </div>
                      ))}
                    </div>
                  )}
                  {ins.decisions.length > 0 && (
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: T.green, marginBottom: 3, textTransform: "uppercase", letterSpacing: .5 }}>✅ Decisions</div>
                      {ins.decisions.map((d, i) => <div key={i} style={{ fontSize: 11, color: T.text, padding: "2px 0", paddingLeft: 8, borderLeft: `2px solid ${T.green}` }}>{d}</div>)}
                    </div>
                  )}
                  {ins.risks.length > 0 && (
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: T.red, marginBottom: 3, textTransform: "uppercase", letterSpacing: .5 }}>⚠ Risks</div>
                      {ins.risks.map((r, i) => <div key={i} style={{ fontSize: 11, color: T.text, padding: "2px 0", paddingLeft: 8, borderLeft: `2px solid ${T.red}` }}>{r}</div>)}
                    </div>
                  )}
                  {ins.keyPoints.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: T.slate, marginBottom: 3, textTransform: "uppercase", letterSpacing: .5 }}>💡 Key Points</div>
                      {ins.keyPoints.map((k, i) => <div key={i} style={{ fontSize: 11, color: T.text, padding: "2px 0", paddingLeft: 8, borderLeft: `2px solid ${T.slate}` }}>{k}</div>)}
                    </div>
                  )}
                </div>
              ))
            }
          </div>
          <div style={{ fontSize: 10, color: T.text2, textAlign: "center" }}>
            {insights.length} batch{insights.length !== 1 ? "es" : ""} analyzed · {insights.reduce((n, i) => n + i.actions.length, 0)} actions found
          </div>
        </div>

        {/* Guidelines */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: T.navy, marginBottom: 8 }}>📌 Meeting Guidelines</div>
          <ol style={{ paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6, margin: 0, marginBottom: 12 }}>
            {instructions.map((s, i) => <li key={i} style={{ fontSize: 12, color: T.text, lineHeight: 1.5 }}>{s}</li>)}
          </ol>
          {attendees.length > 0 && <>
            <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 11, color: T.navy, marginBottom: 5 }}>Expected Attendees</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {attendees.map((name, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, background: T.bg, borderRadius: 6, padding: "2px 7px" }}>
                    <Avatar name={name} size={16} users={users} /><span style={{ fontSize: 11 }}>{name}</span>
                  </div>
                ))}
              </div>
            </div>
          </>}
          {fastActions.length > 0 && <>
            <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 10, paddingTop: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 11, color: T.amber, marginBottom: 5 }}>⚡ Fast Logged ({fastActions.length})</div>
              {fastActions.map((a, i) => <div key={i} style={{ fontSize: 11, color: T.text, padding: "3px 0", borderBottom: `1px solid ${T.border}` }}>{a.text}</div>)}
            </div>
          </>}
          {/* ── Exit Meeting Section ── */}
          <div style={{ borderTop: `1.5px solid ${T.red}30`, marginTop: 16, paddingTop: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 11, color: T.red, marginBottom: 8, textTransform: "uppercase", letterSpacing: .5 }}>🚪 Exit Meeting</div>
            <div style={{ fontSize: 11, color: T.text2, marginBottom: 10, lineHeight: 1.5 }}>Leave this meeting without saving any actions. Use <b>Stop & Review</b> above to save your work first.</div>
            <button onClick={() => { try { stopSTT(); } catch (e) { } onCloseMeeting && onCloseMeeting(); }} className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "center", color: T.red, borderColor: T.red + "50" }}>Exit Meeting</button>
          </div>
        </div>
      </div>

      {showSidePanel && <AddActionPanel users={users} plants={plants} depts={depts} defaultPlant={mtg.plant} defaultSrc={mtg.type} onSave={a => { setFastActions(p => Array.isArray(p) ? [...p, { ...a, id: Date.now() }] : [{ ...a, id: Date.now() }]); setShowSidePanel(false); }} onClose={() => setShowSidePanel(false)} />}
      {selAction && <ActionDetailPanel action={selAction} onClose={() => setSelAction(null)} onUpdate={() => { }} user={null} users={users} allUsers={users} />}
    </div>
  );
}

/* ADD ACTION SIDE PANEL */
function AddActionPanel({ users, plants, depts, defaultPlant, defaultSrc, projects, onSave, onClose, currentUser }) {
  useEscClose(onClose);
  const [f, setF] = useState({ text: "", responsible: "", due: "", section: "General", plant: defaultPlant || "", src: defaultSrc || "", priority: "NORMAL", remarks: "", project: "", reasonOfAction: "", machineName: "" });
  const [reasonSuggestions, setReasonSuggestions] = useState([]);
  const up = (k, v) => setF(x => ({ ...x, [k]: v }));

  // Pull reason suggestions from Google Sheet "Reasons" tab
  useEffect(() => {
    if (!SHEET_ENABLED) return;
    sheetGet("Reasons").then(rows => {
      const reasons = rows.map(r => r.reason || r.Reason || r.text || r.Text || Object.values(r)[0]).filter(Boolean);
      if (reasons.length) setReasonSuggestions(reasons);
    }).catch(() => {/* silently ignore */ });
  }, []);
  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", zIndex: 340 }} onClick={onClose} />
      <div className="side-panel" style={{ width: 420, padding: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ fontFamily: "'Sora',sans-serif", fontSize: 16, fontWeight: 800, color: T.navy }}>Log Action Point</h2>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 22, color: T.text2 }}>x</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div><Lbl t="Action Point" req /><textarea value={f.text} onChange={e => up("text", e.target.value)} style={{ height: 72, resize: "none" }} placeholder="Describe the action…" /></div>
          <div><Lbl t="Responsible Person" req /><select value={f.responsible} onChange={e => up("responsible", e.target.value)}><option value="">Select…</option>{users.map(u => <option key={u.id} value={u.name}>{u.name} ({u.role})</option>)}</select></div>
          <div><Lbl t="Due Date" req /><input type="date" value={f.due} onChange={e => up("due", e.target.value)} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><Lbl t="Department" /><select value={f.section} onChange={e => up("section", e.target.value)}><option value="General">General</option>{(f.plant ? (depts || []).filter(d => (users || []).some(u => u.plant === f.plant && u.dept === d.name)) : (depts || [])).map(d => <option key={d.id} value={d.name}>{d.name}</option>)}{SECTIONS.filter(s => s !== "General" && !(f.plant ? (depts || []).filter(d => (users || []).some(u => u.plant === f.plant && u.dept === d.name)) : (depts || [])).find(d => d.name === s)).map(s => <option key={s}>{s}</option>)}</select></div>
            <div><Lbl t="Plant" /><select value={f.plant} onChange={e => { up("plant", e.target.value); up("section", "General"); }}>{plants.map(p => <option key={p.id}>{p.name}</option>)}</select></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><Lbl t="Priority" /><select value={f.priority} onChange={e => up("priority", e.target.value)}>{PRIORITY_LIST.map(p => <option key={p}>{p}</option>)}</select></div>
            {projects && <div><Lbl t="Link to Project" /><select value={f.project} onChange={e => up("project", e.target.value)}><option value="">None</option>{projects.map(p => <option key={p.id}>{p.name}</option>)}</select></div>}
          </div>
          <div><Lbl t="Reason of Action" /><input value={f.reasonOfAction} onChange={e => up("reasonOfAction", e.target.value)} placeholder="Why is this action needed? (optional)" list="reason-suggestions" />{reasonSuggestions.length > 0 && <datalist id="reason-suggestions">{reasonSuggestions.map((r, i) => <option key={i} value={r} />)}</datalist>}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><Lbl t="Machine Name" /><input value={f.machineName} onChange={e => up("machineName", e.target.value)} placeholder="Machine or equipment (optional)" /></div>
            <div><Lbl t="Remarks" /><input value={f.remarks} onChange={e => up("remarks", e.target.value)} placeholder="Optional notes…" /></div>
          </div>
        </div>
        <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
          <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={onClose}>Cancel</button>
          <button className="btn btn-navy" style={{ flex: 2, justifyContent: "center" }} onClick={() => { if (f.text.trim() && f.responsible && f.due) onSave(f); }}>Save Action</button>
        </div>
      </div>
    </>
  );
}

/* STAGING AREA */
function StagingArea({ staged, mtg, plants, depts, users, txLines, onCommit, onCloseMeeting, onBack, elapsedSecs }) {
  const [draft, setDraft] = useState(() => staged.map((r, i) => ({ ...r, stageSN: "STG-" + String(i + 1).padStart(3, "0"), status: "IN PROCESS", priority: r.priority || "NORMAL", section: r.section || "General", plant: r.plant || mtg.plant })));
  const [analyzingSmart, setAnalyzingSmart] = useState(false);
  const [smartResult, setSmartResult] = useState(null);

  const up = (id, k, v) => setDraft(d => d.map(r => r.id === id ? { ...r, [k]: v } : r));
  const del = id => setDraft(d => d.filter(r => r.id !== id));
  // "valid" = has text + responsible + due — shown as ready
  const valid = draft.filter(r => r.text?.trim() && r.responsible && r.due);
  // All actions with text get committed; missing responsible/due become UNASSIGNED
  const commitAll = () => {
    const all = draft.filter(r => r.text?.trim()).map((r, i) => {
      const isComplete = !!(r.responsible && r.due);
      return {
        ...r, sn: nextSN(Array(i)), id: Date.now() + i, dateOfAction: todayStr(), revisions: 0, revisionHistory: [], created: todayStr(), closedOn: null, pendingConfirmation: false,
        responsible: r.responsible || "UNASSIGNED",
        status: isComplete ? "IN PROCESS" : "IN PROCESS",
        allocatedBy: r.allocatedBy || ""
      };
    });
    onCommit(all);
  };
  const exportTranscript = () => {
    if (!txLines || txLines.length === 0) return;
    const text = txLines.map((l, i) => `${i + 1}. ${l}`).join("\n\n");
    const blob = new Blob([`Meeting: ${mtg.type}\nLocation: ${mtg.plant}\nDate: ${new Date().toLocaleDateString()}\n\n--- TRANSCRIPT ---\n\n${text}`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Transcript_${mtg.type.replace(/\s+/g, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const hms = s => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s % 3600 / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const runSmartSync = async () => {
    if (!txLines || txLines.length === 0) return;
    if (!API_BASE_URL) return;
    setAnalyzingSmart(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/meetings/extract-insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: txLines.join("\n"),
          meeting_type: mtg.type,
          plant: mtg.plant,
          previous_actions: []
        })
      });
      const data = await res.json();
      if (data.actions) {
        setSmartResult(data);
      }
    } catch (e) { console.error("Smart Sync failed", e); }
    setAnalyzingSmart(false);
  };

  const applySmartActions = () => {
    if (!smartResult) return;
    const next = smartResult.actions.map((a, i) => ({
      ...a,
      id: Date.now() + i,
      stageSN: "SMART-" + String(i + 1).padStart(3, "0"),
      status: "IN PROCESS",
      fromTranscript: true,
      fromSmart: true
    }));
    setDraft(next);
  };
  return (
    <div className="fade-in">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back to Meeting</button>
        <div>
          <h1 style={{ fontFamily: "'Sora',sans-serif", fontSize: 20, fontWeight: 800, color: T.navy }}>Review & Commit Actions</h1>
          <div style={{ fontSize: 12, color: T.text2 }}>{mtg.type} · Duration: {hms(elapsedSecs || 0)} · <b style={{ color: T.green }}>{valid.length} ready</b> · {draft.length - valid.length} incomplete (will be saved as Unassigned)</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn btn-navy" onClick={runSmartSync} disabled={analyzingSmart || !txLines?.length}>
            {analyzingSmart ? <Spin /> : "🧠 Smart Sync (Deduplicate)"}
          </button>
          <button className="btn btn-ghost" onClick={exportTranscript} disabled={!txLines || txLines.length === 0} style={{ border: `1px solid ${T.border}` }}>
            📥 Export Transcript
          </button>
          <button className="btn btn-green" onClick={commitAll} disabled={draft.filter(r => r.text?.trim()).length === 0}>
            ✓ Commit {draft.filter(r => r.text?.trim()).length} Action{draft.filter(r => r.text?.trim()).length !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
      {/* Info banner about unassigned */}
      {draft.length > valid.length && draft.filter(r => r.text?.trim()).length > 0 && (
        <div style={{ background: "#FFF8E1", border: `1px solid ${T.amber}30`, borderRadius: 8, padding: "8px 14px", marginBottom: 14, fontSize: 12, color: "#7A5A00" }}>
          ⚠ <b>{draft.filter(r => r.text?.trim() && (!r.responsible || !r.due)).length}</b> action(s) missing responsible / due date will be committed with status <b>UNASSIGNED</b> in the action tracker.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20 }}>
        <div className="card" style={{ padding: 20, height: "fit-content" }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: T.navy, marginBottom: 10 }}>📝 Discussed Points</div>

          {smartResult && (
            <div style={{ marginBottom: 16, padding: 12, background: T.bg, borderRadius: 10, border: `1px solid ${T.navy}30` }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: T.navy, textTransform: "uppercase", marginBottom: 8 }}>📌 Key Topics (AI)</div>
              {smartResult.topics?.map((t, idx) => (
                <div key={idx} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{t.topic}</div>
                  <div style={{ fontSize: 11, color: T.text2, lineHeight: 1.4 }}>{t.summary}</div>
                </div>
              ))}
              <button className="btn btn-navy btn-sm" style={{ width: "100%", marginTop: 8 }} onClick={applySmartActions}>
                Apply AI Deduplication
              </button>
            </div>
          )}

          <div style={{ fontSize: 12, lineHeight: 1.9, color: "#555" }}>
            {txLines.map((l, i) => <div key={i} style={{ padding: "4px 0", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 8 }}><span style={{ color: T.text2, fontSize: 10, flexShrink: 0, marginTop: 2 }}>{i + 1}.</span><span style={{ color: l.toLowerCase().includes("action") ? T.navy : T.text }}>{l}</span></div>)}
            {txLines.length === 0 && <span style={{ color: "#B2BEC3" }}>No transcript available.</span>}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {draft.length === 0 && <div className="card" style={{ padding: 24 }}><Empty icon="📭" title="No actions to stage" sub="Go back and log actions during the meeting." /></div>}
          {draft.map(r => {
            const incomplete = !r.responsible || !r.due;
            return (
              <div key={r.id} className="card" style={{ padding: 18, borderLeft: `4px solid ${r.fromTranscript ? T.amber : incomplete ? T.slate : T.navy}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: T.text2 }}>{r.stageSN}</span>
                    {r.fromTranscript && <Chip label="From Transcript" color={T.amber} />}
                    {incomplete && <Chip label="Will be Unassigned" color={T.slate} />}
                  </div>
                  <button onClick={() => del(r.id)} style={{ border: "none", background: "transparent", cursor: "pointer", color: T.text2, fontSize: 18, lineHeight: 1 }}>×</button>
                </div>
                <div style={{ marginBottom: 10 }}><Lbl t="Action Point" req /><textarea value={r.text || ""} onChange={e => up(r.id, "text", e.target.value)} style={{ resize: "none", height: 52, fontSize: 12 }} /></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <div><Lbl t="Responsible" /><select value={r.responsible || ""} onChange={e => up(r.id, "responsible", e.target.value)} style={{ borderColor: !r.responsible ? T.amber : T.border }}><option value="">Leave Unassigned</option>{users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}</select></div>
                  <div><Lbl t="Due Date" /><input type="date" value={r.due || ""} onChange={e => up(r.id, "due", e.target.value)} style={{ borderColor: !r.due ? T.amber : T.border }} /></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                  <div><Lbl t="Department" /><select value={r.section || "General"} onChange={e => up(r.id, "section", e.target.value)}>{SECTIONS.map(s => <option key={s}>{s}</option>)}</select></div>
                  <div><Lbl t="Priority" /><select value={r.priority} onChange={e => up(r.id, "priority", e.target.value)}>{PRIORITY_LIST.map(p => <option key={p}>{p}</option>)}</select></div>
                  <div><Lbl t="Plant" /><select value={r.plant || ""} onChange={e => up(r.id, "plant", e.target.value)}>{plants.map(p => <option key={p.id}>{p.name}</option>)}</select></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ===================== ACTION DETAIL SIDE PANEL ===================== */
/* Completion workflow: assignee marks done → goes to allocatedBy + their superior for confirmation */
function ActionDetailPanel({ action, onClose, onUpdate, user, users, allUsers, plants: panelPlants }) {
  useEscClose(onClose);
  const [msgText, setMsgText] = useState("");
  const messagesEndRef = useRef(null);
  const msgs = action.messages || [];
  const revHistory = action.revisionHistory || [];
  const isPendingConfirm = action.pendingConfirmation === true;
  // Feature 6: inline edit state (track per-field editing)
  const [editingField, setEditingField] = useState(null);
  const [fieldVal, setFieldVal] = useState("");

  // Determine who can interact/confirm
  const assignee = action.responsible;
  const allocator = action.allocatedBy;
  const allocatorUser = allUsers.find(u => u.name === allocator);
  const allocatorSuperior = allocatorUser?.superior ? allUsers.find(u => u.name === allocatorUser.superior) : null;
  const isAssignee = user?.name === assignee;
  const isAllocator = user?.name === allocator;
  const isAllocatorSuperior = user?.name === allocatorSuperior?.name;
  const isAdmin = user?.role === "Admin";
  const canConfirm = isAllocator || isAllocatorSuperior || isAdmin;
  const canMsg = user?.role !== "Guest";  // anyone who can see the action can comment
  const canEdit = user?.role !== "Guest" && !isPendingConfirm && action.status !== "COMPLETED" && action.status !== "DROPPED";

  useEffect(() => { if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const sendMsg = () => {
    if (!msgText.trim() || !canMsg) return;
    const newMsg = { id: Date.now(), author: user?.name || "Unknown", authorInitials: user?.initials || "?", authorColor: user?.color || T.slate, text: msgText.trim(), ts: new Date().toISOString() };
    onUpdate(action.id, { messages: [...msgs, newMsg] });
    setMsgText("");
  };
  const requestCompletion = () => {
    const sysMsg = { id: Date.now(), author: "System", authorInitials: "SYS", authorColor: T.navy, text: `${user?.name} has marked this action as complete and sent it for confirmation by ${allocator}${allocatorSuperior ? ` and ${allocatorSuperior.name}` : "."}`, ts: new Date().toISOString() };
    onUpdate(action.id, { status: "PENDING CONFIRM", pendingConfirmation: true, messages: [...msgs, sysMsg] });
  };
  const confirmComplete = () => {
    const sysMsg = { id: Date.now(), author: "System", authorInitials: "SYS", authorColor: T.green, text: `${user?.name} has confirmed completion. Action is now COMPLETED.`, ts: new Date().toISOString() };
    onUpdate(action.id, { status: "COMPLETED", pendingConfirmation: false, closedOn: todayStr(), messages: [...msgs, sysMsg] });
  };
  const rejectComplete = () => {
    const sysMsg = { id: Date.now(), author: "System", authorInitials: "SYS", authorColor: T.red, text: `${user?.name} has rejected the completion and reopened this action.`, ts: new Date().toISOString() };
    onUpdate(action.id, { status: "IN PROCESS", pendingConfirmation: false, messages: [...msgs, sysMsg] });
  };
  const startEdit = (field, val) => { setEditingField(field); setFieldVal(val || ""); };
  const commitEdit = (field) => {
    if (field === editingField) {
      const isCompletedStatus = field === "status" && fieldVal === "COMPLETED";
      onUpdate(action.id, {
        [field]: fieldVal,
        closedOn: isCompletedStatus ? todayStr() : action.closedOn,
        ...(isCompletedStatus ? { pendingConfirmation: false } : {})
      });
      setEditingField(null);
    }
  };
  const fmtTime = ts => { const d = new Date(ts); return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + ", " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); };

  // Inline editable field renderer
  const InlineField = ({ label, field, value, type, opts, readonly }) => {
    const isEditing = editingField === field;
    const editable = canEdit && !readonly;
    return (
      <div>
        <div style={{ fontSize: 10, color: T.text2, fontWeight: 700, textTransform: "uppercase", letterSpacing: .4, marginBottom: 3 }}>{label}</div>
        {isEditing
          ? <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {type === "select" ? <select value={fieldVal} onChange={e => setFieldVal(e.target.value)} style={{ fontSize: 12, padding: "4px 8px", flex: 1, border: `1.5px solid ${T.navy}`, borderRadius: 8 }} autoFocus>
              {opts.map(o => <option key={o}>{o}</option>)}
            </select>
              : type === "textarea" ? <textarea value={fieldVal} onChange={e => setFieldVal(e.target.value)} style={{ flex: 1, fontSize: 12, height: 52, resize: "none", border: `1.5px solid ${T.navy}`, borderRadius: 8 }} autoFocus />
                : <input type={type || "text"} value={fieldVal} onChange={e => setFieldVal(e.target.value)} style={{ flex: 1, fontSize: 12, padding: "4px 8px", border: `1.5px solid ${T.navy}`, borderRadius: 8 }} autoFocus />
            }
            <button onClick={() => commitEdit(field)} style={{ background: T.green, border: "none", color: "#fff", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>✓</button>
            <button onClick={() => setEditingField(null)} style={{ background: T.border, border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 11 }}>✕</button>
          </div>
          : <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: editable ? "pointer" : "default", padding: "5px 8px", borderRadius: 6, border: editable ? `1.5px solid ${T.border}` : "1.5px solid transparent", transition: "border-color .15s, background .15s", background: "transparent" }}
            onMouseEnter={e => { if (editable) { e.currentTarget.style.background = T.bg; e.currentTarget.style.borderColor = T.navy; } }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; if (editable) e.currentTarget.style.borderColor = T.border; }}
            onClick={() => { if (editable) startEdit(field, value); }}>
            <span style={{ fontSize: 12, flex: 1 }}>{value || "—"}</span>
            {editable && <span style={{ fontSize: 10, color: T.text2, opacity: .5 }}>✏</span>}
          </div>
        }
      </div>
    );
  };

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", zIndex: 405 }} onClick={onClose} />
      <div className="side-panel" style={{ width: 580, display: "flex", flexDirection: "column", zIndex: 410 }}>
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: `1.5px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
            <div style={{ fontFamily: "monospace", fontSize: 11, color: T.text2 }}>{action.sn}</div>
            <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 22, color: T.text2, lineHeight: 1 }}>×</button>
          </div>
          <h2 style={{ fontFamily: "'Sora',sans-serif", fontSize: 15, fontWeight: 800, color: T.navy, lineHeight: 1.3, marginBottom: 10 }}>{action.text}</h2>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <SBadge s={isPendingConfirm ? "PENDING CONFIRM" : action.status} /><PBadge p={action.priority} />
            {action.project && <Chip label={"🔗 " + action.project} color={T.amber} />}
          </div>
          {isPendingConfirm && (
            <div className="confirm-banner" style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#7A5A00", marginBottom: 6 }}>⏳ Awaiting Completion Confirmation</div>
              <div style={{ fontSize: 11, color: "#7A5A00", marginBottom: canConfirm ? 10 : 0 }}>
                {assignee} has marked this complete. Waiting for {allocator}{allocatorSuperior ? ` or ${allocatorSuperior.name}` : ""} to confirm.
              </div>
              {canConfirm && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-green btn-sm" onClick={confirmComplete} style={{ flex: 1, justifyContent: "center" }}>✓ Confirm Complete</button>
                  <button className="btn btn-red btn-sm" onClick={rejectComplete} style={{ flex: 1, justifyContent: "center" }}>↩ Reopen</button>
                </div>
              )}
              {isAssignee && !canConfirm && <div style={{ fontSize: 11, color: T.text2, fontStyle: "italic" }}>You submitted this. Waiting for allocator's response.</div>}
            </div>
          )}
        </div>

        {/* Feature 6: Single scrollable page - Details + Thread + Revisions stacked */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {/* === DETAILS SECTION === */}
          <div style={{ padding: "16px 24px", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.navy, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>📋 Details {canEdit && <span style={{ fontSize: 10, color: T.text2, fontWeight: 400 }}>(click any field to edit)</span>}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              {/* Read-only fields */}
              <div><div style={{ fontSize: 10, color: T.text2, fontWeight: 700, textTransform: "uppercase", letterSpacing: .4, marginBottom: 3 }}>Date of Action</div><div style={{ fontSize: 12, padding: "3px 6px" }}>{fmt(action.dateOfAction)}</div></div>
              <div><div style={{ fontSize: 10, color: T.text2, fontWeight: 700, textTransform: "uppercase", letterSpacing: .4, marginBottom: 3 }}>Allocated By</div><div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px" }}><Avatar name={action.allocatedBy} size={20} users={allUsers} /><span style={{ fontSize: 12 }}>{action.allocatedBy || "—"}</span></div></div>
              {/* Editable fields */}
              <InlineField label="Source" field="src" value={action.src} type="text" />
              <InlineField label="Department" field="section" value={action.section} type="select" opts={[...(panelPlants ? [] : SECTIONS), ...((panelPlants ? (allUsers || []) : []).length > 0 ? [...new Set(["General", ...(allUsers || []).map(u => u.dept).filter(Boolean)])] : SECTIONS)]} />

              <InlineField label="Plant" field="plant" value={action.plant} type="select" opts={(panelPlants || DEFAULT_PLANTS).map(p => p.name)} />
              <InlineField label="Responsible" field="responsible" value={action.responsible} type="select" opts={allUsers.map(u => u.name)} />
              <InlineField label="Due Date" field="due" value={action.due} type="date" />
              <div><div style={{ fontSize: 10, color: T.text2, fontWeight: 700, textTransform: "uppercase", letterSpacing: .4, marginBottom: 3 }}>Closed On</div><div style={{ fontSize: 12, padding: "3px 6px" }}>{fmt(action.closedOn)}</div></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <InlineField label="Reason of Action" field="reasonOfAction" value={action.reasonOfAction} type="text" />
              <InlineField label="Machine Name" field="machineName" value={action.machineName} type="text" />
            </div>
            <InlineField label="Remarks" field="remarks" value={action.remarks} type="textarea" />
            {/* Actions */}
            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {user?.role !== "Guest" && !isPendingConfirm && action.status !== "COMPLETED" && action.status !== "DROPPED" && (
                <>
                  {isAssignee && <button className="btn btn-green btn-sm" onClick={requestCompletion}>Mark Complete →</button>}
                  {!isAssignee && canMsg && (
                    <select value={action.status} onChange={e => onUpdate(action.id, { status: e.target.value, closedOn: e.target.value === "COMPLETED" ? todayStr() : null })} style={{ fontSize: 12, padding: "5px 8px" }}>
                      {STATUS_LIST.map(s => <option key={s}>{s}</option>)}
                    </select>
                  )}
                </>
              )}
              {(action.status === "COMPLETED" || action.status === "DROPPED") && canMsg && (
                <button className="btn btn-ghost btn-sm" onClick={() => onUpdate(action.id, { status: "IN PROCESS", closedOn: null, pendingConfirmation: false })}>↩ Reopen</button>
              )}
            </div>
          </div>

          {/* === THREAD SECTION === */}
          <div style={{ padding: "16px 24px", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.navy, marginBottom: 12 }}>💬 Thread {msgs.length > 0 && <span style={{ color: T.text2, fontWeight: 400 }}>({msgs.length})</span>}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: canMsg ? 12 : 0 }}>
              {msgs.length === 0 && <div style={{ textAlign: "center", padding: "16px 0", color: T.text2, fontSize: 12 }}>No messages yet.{canMsg ? " Start the conversation below." : ""}</div>}
              {msgs.map(m => {
                const isMe = m.author === user?.name;
                const isSys = m.author === "System";
                if (isSys) return (
                  <div key={m.id} style={{ textAlign: "center", padding: "4px 12px" }}>
                    <span style={{ fontSize: 11, color: T.text2, background: T.bg, padding: "3px 10px", borderRadius: 20, display: "inline-block" }}>{m.text}</span>
                  </div>
                );
                return (
                  <div key={m.id} style={{ display: "flex", flexDirection: isMe ? "row-reverse" : "row", gap: 8, alignItems: "flex-end" }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: m.authorColor + "20", color: m.authorColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flexShrink: 0, border: `1.5px solid ${m.authorColor}30` }}>{m.authorInitials}</div>
                    <div style={{ maxWidth: "72%" }}>
                      <div style={{ fontSize: 10, color: T.text2, marginBottom: 3, textAlign: isMe ? "right" : "left" }}>{m.author}{isMe ? " (You)" : ""} · {fmtTime(m.ts)}</div>
                      <div style={{ background: isMe ? T.navy : T.bg, border: `1px solid ${isMe ? T.navy : T.border}`, borderRadius: isMe ? "12px 12px 2px 12px" : "12px 12px 12px 2px", padding: "9px 13px", fontSize: 13, lineHeight: 1.5, color: isMe ? "#fff" : T.text }}>{m.text}</div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
            {canMsg && (
              <div style={{ display: "flex", gap: 8 }}>
                <textarea value={msgText} onChange={e => setMsgText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); } }} placeholder="Type a message… (Enter to send)" style={{ flex: 1, resize: "none", height: 52, fontSize: 12 }} />
                <button className="btn btn-navy" onClick={sendMsg} disabled={!msgText.trim()} style={{ flexShrink: 0, alignSelf: "flex-end", padding: "8px 14px" }}>Send</button>
              </div>
            )}
          </div>

          {/* === REVISIONS SECTION === */}
          <div style={{ padding: "16px 24px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.navy, marginBottom: 12 }}>📅 Revisions {revHistory.length > 0 && <span style={{ color: T.text2, fontWeight: 400 }}>({revHistory.length} changes)</span>}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div style={{ background: T.bg, borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
                <div style={{ fontFamily: "'Sora',sans-serif", fontSize: 24, fontWeight: 800, color: T.navy }}>{action.revisions || 0}</div>
                <div style={{ fontSize: 11, color: T.text2 }}>Date Revisions</div>
              </div>
              <div style={{ background: T.bg, borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
                <div style={{ fontFamily: "'Sora',sans-serif", fontSize: 18, fontWeight: 800, color: action.status === "COMPLETED" ? T.green : T.amber }}>{action.status}</div>
                <div style={{ fontSize: 11, color: T.text2 }}>Current Status</div>
              </div>
            </div>
            {action.closedOn && <div style={{ background: T.greenL, borderRadius: 8, padding: "8px 14px", marginBottom: 12, fontSize: 12 }}><b style={{ color: T.green }}>Completed on:</b> {fmt(action.closedOn)}</div>}
            {revHistory.length === 0 ? <div style={{ fontSize: 12, color: T.text2, fontStyle: "italic", padding: "8px 0" }}>No date revisions yet.</div> :
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {revHistory.map((r, i) => (
                  <div key={i} style={{ background: T.amberL, borderRadius: 8, padding: "10px 14px", borderLeft: `3px solid ${T.amber}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: T.amber }}>Rev #{i + 1}</span>
                      <span style={{ fontSize: 11, color: T.text2 }}>{fmt(r.date)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: T.text }}>Due changed from <b>{fmt(r.from)}</b> to <b>{fmt(r.to)}</b></div>
                    {r.by && <div style={{ fontSize: 11, color: T.text2, marginTop: 3 }}>by {r.by}</div>}
                  </div>
                ))}
              </div>
            }
          </div>
        </div>
      </div>
    </>
  );
}

/* ===================== ACTIONS PAGE ===================== */
/* Persists last view per user in memory */
const userViewPref = {};
const userSortPref = {};  // persist sort across page changes
const userFilterPref = {}; // persist filters across page changes

function ActionsPage({ actions, setActions, plants, depts, users, user, projects }) {
  const userKey = user?.id || "guest";
  const [view, setView] = useState(userViewPref[userKey] || "table");
  // Multi-select filters: persistent across page changes
  const [filters, setFilters] = useState(userFilterPref[userKey] || { 
    plant: user?.plant && user.plant !== "All" ? [user.plant] : [], 
    section: user?.department ? [user.department] : [], 
    responsible: user?.name ? [user.name] : [], 
    status: [], priority: [], project: [] 
  });
  const [myActionsOnly, setMyActionsOnly] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [openFilter, setOpenFilter] = useState(null);
  const canEdit = user?.role !== "Guest";
  const allProjects = [...new Set(actions.map(a => a.project).filter(Boolean))];

  const changeView = v => { setView(v); userViewPref[userKey] = v; };

  // Scope: current user + all subordinates (recursive)
  const getSubTree = (name, allUsers, visited = new Set()) => {
    if (visited.has(name)) return [];
    visited.add(name);
    const directs = allUsers.filter(u => u.superior === name);
    const all = [name, ...directs.map(d => d.name)];
    directs.forEach(d => { all.push(...getSubTree(d.name, allUsers, visited).filter(n => !all.includes(n))); });
    return all;
  };
  const scopedNames = user ? getSubTree(user.name, users) : [];
  const isAdmin = user?.role === "Admin" || user?.role === "MD" || user?.role === "Plant Head";
  const scoped = isAdmin
    ? (user?.plant === "All" ? actions : actions.filter(a => a.plant === user?.plant || !a.plant))
    : actions.filter(a => scopedNames.includes(a.responsible) || a.responsible === user?.name || a.allocatedBy === user?.name);

  const toggleFilter = (key, val) => {
    setFiltersPersist(f => {
      const cur = f[key];
      return { ...f, [key]: cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val] };
    });
  };
  const clearFilter = (key) => setFiltersPersist(f => ({ ...f, [key]: [] }));
  const clearAll = () => { const empty = { plant: [], section: [], responsible: [], status: [], priority: [], project: [] }; setFilters(empty); userFilterPref[userKey] = empty; };
  // Save filters to persistent store on each change
  const setFiltersPersist = (updater) => {
    setFilters(prev => { const next = typeof updater === "function" ? updater(prev) : updater; userFilterPref[userKey] = next; return next; });
  };

  // My Actions / All Actions scoping
  const displayScope = myActionsOnly
    ? scoped.filter(a => a.responsible === user?.name || a.allocatedBy === user?.name)
    : scoped;

  const fa = displayScope.filter(a => {
    if (filters.plant.length && !filters.plant.includes("All") && !filters.plant.includes(a.plant)) return false;
    if (filters.section.length && !filters.section.includes(a.section)) return false;
    if (filters.responsible.length && !filters.responsible.includes(a.responsible)) return false;
    const aStatus = a.pendingConfirmation && a.status !== "COMPLETED" && a.status !== "DROPPED" ? "PENDING CONFIRM" : a.status;
    if (filters.status.length && !filters.status.includes(aStatus)) return false;
    if (filters.priority.length && !filters.priority.includes(a.priority)) return false;
    const aProj = a.project || "None";
    if (filters.project.length && !filters.project.includes(aProj)) return false;
    if (q && ![a.text, a.responsible, a.sn, a.src, a.section].join(" ").toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const upAction = (id, patch) => setActions(p => p.map(a => {
    if (String(a.id) !== String(id)) return a;
    if (patch.due && patch.due !== a.due) {
      const rev = { date: todayStr(), from: a.due, to: patch.due, by: user?.name || "Unknown" };
      return { ...a, ...patch, revisions: (a.revisions || 0) + 1, revisionHistory: [...(a.revisionHistory || []), rev] };
    }
    return { ...a, ...patch };
  }));
  const upStatus = (id, status) => {
    // If moving a pendingConfirmation action to COMPLETED, clear any
    // PENDING CONFIRM-only status filter so the card stays visible in COMPLETED column.
    if (status === "COMPLETED") {
      setFiltersPersist(f => {
        if (f.status.length > 0 && f.status.includes("PENDING CONFIRM") && !f.status.includes("COMPLETED")) {
          return { ...f, status: [...f.status, "COMPLETED"] };
        }
        return f;
      });
    }
    upAction(id, { status, closedOn: status === "COMPLETED" ? todayStr() : null, pendingConfirmation: false });
  };
  const allSections = [...new Set(scoped.map(a => a.section))].filter(Boolean);
  const allResponsible = [...new Set(scoped.map(a => a.responsible))].filter(Boolean);
  const pendingConf = scoped.filter(a => a.pendingConfirmation && a.status !== "COMPLETED" && a.status !== "DROPPED");

  // Feature 7: Export functions
  const exportCSV = () => {
    const headers = ["SN", "Source", "Department", "Plant", "Date", "Action", "Responsible", "Due Date", "Status", "Priority", "Revisions"];
    const rows = fa.map(a => [a.sn, a.src, a.section, a.plant, a.dateOfAction, `"${a.text.replace(/"/g, '""')}"`, a.responsible, a.due, a.status, a.priority, a.revisions || 0]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a2 = document.createElement("a"); a2.href = url; a2.download = `actions-${todayStr()}.csv`; a2.click(); URL.revokeObjectURL(url);
  };
  const exportPDF = () => {
    const content = `
      <html><head><style>
        body{font-family:Arial,sans-serif;font-size:11px;padding:20px;}
        h2{color:#272262;margin-bottom:4px;}
        p{color:#636E72;font-size:10px;margin-bottom:16px;}
        table{width:100%;border-collapse:collapse;}
        th{background:#272262;color:#fff;padding:8px 10px;text-align:left;font-size:10px;}
        td{padding:7px 10px;border-bottom:1px solid #E8E8F0;font-size:10px;}
        tr:nth-child(even) td{background:#F5F5FB;}
        .status-badge{padding:2px 8px;border-radius:10px;font-weight:600;}
      </style></head><body>
      <h2>Management Control System — Actions Register</h2>
      <p>Exported on ${new Date().toLocaleDateString("en-IN")} · ${fa.length} actions</p>
      <table>
        <tr><th>SN</th><th>Action</th><th>Responsible</th><th>Due Date</th><th>Status</th><th>Priority</th><th>Plant</th></tr>
        ${fa.map(a => `<tr><td>${a.sn}</td><td>${a.text}</td><td>${a.responsible}</td><td>${a.due || "—"}</td><td>${a.status}</td><td>${a.priority}</td><td>${a.plant}</td></tr>`).join("")}
      </table>
      </body></html>`;
    const w = window.open("", "_blank"); w.document.write(content); w.document.close(); w.print();
  };
  const printPage = () => window.print();

  return (
    <div className="fade-in">
      <PageHeader title="Actions Register" sub={`${myActionsOnly ? "My actions" : isAdmin ? "Plant-wide" : "My team"} · ${displayScope.length} actions · ${fa.length} shown`}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {/* My / All toggle */}
          <div style={{ display: "flex", background: T.bg, borderRadius: 8, padding: 3, border: `1.5px solid ${T.border}` }}>
            <button onClick={() => setMyActionsOnly(false)} style={{ padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: !myActionsOnly ? T.navy : "transparent", color: !myActionsOnly ? "#fff" : T.text2, transition: "all .18s" }}>All Actions</button>
            <button onClick={() => setMyActionsOnly(true)} style={{ padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: myActionsOnly ? T.navy : "transparent", color: myActionsOnly ? "#fff" : T.text2, transition: "all .18s" }}>My Actions</button>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={exportCSV} title="Download CSV">📥 CSV</button>
          <button className="btn btn-ghost btn-sm" onClick={exportPDF} title="Download PDF">📄 PDF</button>
          <button className="btn btn-ghost btn-sm" onClick={printPage} title="Print">🖨 Print</button>
        </div>
      </PageHeader>
      {pendingConf.length > 0 && (
        <div className="confirm-banner" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#7A5A00" }}>⏳ {pendingConf.length} action{pendingConf.length !== 1 ? "s" : ""} awaiting your completion confirmation</div>
          <div style={{ fontSize: 12, color: "#7A5A00", marginTop: 2 }}>Click an action to review and confirm or reopen it.</div>
        </div>
      )}
      <div className="card" style={{ padding: "14px 16px", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Search actions…" style={{ width: 200 }} />
          {[
            { label: "Plant", key: "plant", opts: plants.map(p => p.name).filter(n => n !== "All") },
            { label: "Department", key: "section", opts: allSections },
            { label: "Responsible", key: "responsible", opts: allResponsible },
            { label: "Status", key: "status", opts: [...STATUS_LIST, "PENDING CONFIRM"] },
            { label: "Priority", key: "priority", opts: PRIORITY_LIST },
            { label: "Project", key: "project", opts: ["None", ...allProjects] },
          ].map(({ label, key, opts }) => {
            const sel2 = filters[key];
            const isOpen = openFilter === key;
            return (
              <div key={key} style={{ position: "relative" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: T.text2, letterSpacing: .4, textTransform: "uppercase", display: "block", marginBottom: 2 }}>{label}</span>
                <button onClick={() => setOpenFilter(isOpen ? null : key)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", border: `1.5px solid ${sel2.length ? T.navy : T.border}`, borderRadius: 7, background: sel2.length ? "#EEF0FF" : "#fff", color: sel2.length ? T.navy : T.text, cursor: "pointer", fontSize: 12, fontWeight: 500, minWidth: 110, whiteSpace: "nowrap" }}>
                  <span style={{ flex: 1, textAlign: "left" }}>{sel2.length === 0 ? "All" : sel2.length === 1 ? sel2[0] : `${sel2.length} selected`}</span>
                  {sel2.length > 0 && <span onClick={e => { e.stopPropagation(); clearFilter(key); }} style={{ color: T.text2, fontWeight: 700, fontSize: 14, lineHeight: 1 }}>×</span>}
                  <span style={{ fontSize: 9, color: T.text2 }}>{isOpen ? "▲" : "▼"}</span>
                </button>
                {isOpen && (
                  <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 600, marginTop: 4, background: "#fff", border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: "0 4px 20px rgba(0,0,0,.13)", minWidth: 190, maxHeight: 260, overflowY: "auto", padding: 6 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: sel2.length === 0 ? 700 : 400, color: sel2.length === 0 ? T.navy : T.text, marginBottom: 2, borderBottom: `1px solid ${T.border}` }} onClick={() => clearFilter(key)}>
                      <span style={{ width: 14, height: 14, borderRadius: 3, border: `2px solid ${T.border}`, background: "transparent", display: "inline-block" }} />
                      All (clear)
                    </label>
                    {opts.map(o => (
                      <label key={o} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, cursor: "pointer", fontSize: 12, background: sel2.includes(o) ? "#EEF0FF" : "transparent", fontWeight: sel2.includes(o) ? 600 : 400 }}>
                        <input type="checkbox" checked={sel2.includes(o)} onChange={() => toggleFilter(key, o)} style={{ width: 14, height: 14, cursor: "pointer", accentColor: T.navy }} />
                        {o}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end", marginLeft: "auto" }}>
            {Object.values(filters).some(v => v.length > 0) && <button className="btn btn-ghost btn-sm" onClick={clearAll}>Clear All</button>}
            <span style={{ fontSize: 12, color: T.text2, fontWeight: 500, paddingBottom: 3 }}>{fa.length}/{scoped.length}</span>
          </div>
        </div>
        {/* Active filter chips */}
        {Object.entries(filters).some(([, v]) => v.length > 0) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {Object.entries(filters).flatMap(([key, vals]) => vals.map(v => (
              <span key={key + v} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: T.navy + "15", color: T.navy, border: `1px solid ${T.navy}30`, borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 600 }}>
                <span style={{ opacity: .6, fontSize: 10 }}>{key}:</span> {v}
                <button onClick={() => toggleFilter(key, v)} style={{ background: "transparent", border: "none", color: T.navy, cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1, marginLeft: 2, opacity: .6 }}>×</button>
              </span>
            )))}
          </div>
        )}
        <div style={{ display: "flex", gap: 6, borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
          {[{ v: "table", icon: "☰", l: "Table" }, { v: "board", icon: "⊞", l: "Board" }, { v: "kanban", icon: "▦", l: "Kanban" }, { v: "timeline", icon: "━", l: "Timeline" }].map(x => (
            <button key={x.v} onClick={() => changeView(x.v)} style={{ padding: "5px 14px", borderRadius: 7, border: `1.5px solid ${view === x.v ? T.navy : T.border}`, background: view === x.v ? T.navy : "transparent", color: view === x.v ? "#fff" : T.text2, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
              {x.icon} {x.l}
            </button>
          ))}
        </div>
      </div>
      {openFilter && <div style={{ position: "fixed", inset: 0, zIndex: 599 }} onClick={() => setOpenFilter(null)} />}
      {view === "table" && <TableView fa={fa} upStatus={upStatus} setSel={a => { setSel(a); }} canEdit={canEdit} upAction={upAction} sortState={userSortPref[userKey]} onSortChange={s => { userSortPref[userKey] = s; }} users={users} />}
      {view === "board" && <BoardView fa={fa} setSel={setSel} users={users} />}
      {view === "kanban" && <KanbanView fa={fa} upStatus={upStatus} canEdit={canEdit} users={users} setSel={setSel} />}
      {view === "timeline" && <TimelineView fa={fa} />}
      {sel && <ActionDetailPanel action={sel} onClose={() => setSel(null)} onUpdate={(id, patch) => { upAction(id, patch); setSel(p => p ? { ...p, ...patch } : p); }} user={user} users={users} allUsers={users} plants={plants} />}
    </div>
  );
}

function TableView({ fa, upStatus, setSel, canEdit, upAction, sortState, onSortChange, users }) {
  // Use externally-provided sort state if available (for persistence), else local
  const [localSortKey, setLocalSortKey] = useState(sortState?.key || "dateOfAction");
  const [localSortDir, setLocalSortDir] = useState(sortState?.dir || "desc");
  const sortKey = localSortKey, sortDir = localSortDir;
  const toggleSort = k => {
    const newKey = k, newDir = sortKey === k ? (sortDir === "asc" ? "desc" : "asc") : "asc";
    setLocalSortKey(newKey); setLocalSortDir(newDir);
    onSortChange && onSortChange({ key: newKey, dir: newDir });
  };
  const SortIcon = ({ k }) => {
    const active = sortKey === k;
    return (
      <span style={{ marginLeft: 4, opacity: active ? 1 : .3, fontSize: 10, userSelect: "none", display: "inline-flex", flexDirection: "column", lineHeight: 1, gap: 0 }}>
        <span style={{ color: active && sortDir === "asc" ? T.amber : "inherit", lineHeight: 1 }}>▲</span>
        <span style={{ color: active && sortDir === "desc" ? T.amber : "inherit", lineHeight: 1 }}>▼</span>
      </span>
    );
  };
  const TH = ({ k, label, minWidth, style = {} }) => (
    <th style={{ minWidth, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", ...style }} onClick={() => toggleSort(k)}>
      {label}<SortIcon k={k} />
    </th>
  );
  const sorted = [...fa].sort((a, b) => {
    let av = a[sortKey] ?? "", bv = b[sortKey] ?? "";
    if (sortKey === "due" || sortKey === "dateOfAction" || sortKey === "created") {
      av = av ? new Date(av).getTime() : 0; bv = bv ? new Date(bv).getTime() : 0;
    } else if (sortKey === "revisions") { av = a.revisions || 0; bv = b.revisions || 0; }
    else { av = String(av).toLowerCase(); bv = String(bv).toLowerCase(); }
    return sortDir === "asc" ? (av > bv ? 1 : av < bv ? -1 : 0) : (av < bv ? 1 : av > bv ? -1 : 0);
  });
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead><tr>
            <TH k="sn" label="SN" minWidth={70} />
            <TH k="src" label="Source" minWidth={150} />
            <TH k="section" label="Department" minWidth={100} />
            <TH k="plant" label="Plant" minWidth={90} />
            <TH k="dateOfAction" label="Date" minWidth={100} />
            <TH k="text" label="Action Point" minWidth={280} />
            <TH k="responsible" label="Responsible" minWidth={130} />
            <TH k="due" label="Due Date" minWidth={100} />
            <TH k="status" label="Status" minWidth={130} />
            <TH k="revisions" label="Revisions" minWidth={80} style={{ textAlign: "center" }} />
          </tr></thead>
          <tbody>
            {sorted.map((a, idx) => (
              <tr key={a.id || `act-${idx}`} style={{ cursor: "pointer", background: a.pendingConfirmation ? "#FEF9E7" : "" }} onClick={() => setSel(a)}>
                <td style={{ fontFamily: "monospace", fontSize: 11, color: T.text2 }}>{a.sn}</td>
                <td style={{ fontSize: 12, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.src}</td>
                <td style={{ fontSize: 12 }}>{a.section}</td>
                <td style={{ fontSize: 11 }}>{a.plant}</td>
                <td style={{ fontSize: 11, color: T.text2, whiteSpace: "nowrap" }}>{fmt(a.dateOfAction)}</td>
                <td style={{ minWidth: 280, maxWidth: 360 }}>
                  <div style={{ fontWeight: 500, whiteSpace: "normal", wordBreak: "break-word", fontSize: 13, lineHeight: 1.4 }}>{a.text}</div>
                  {isOverdue(a) && <div style={{ fontSize: 10, color: T.red, fontWeight: 600 }}>⚠ {daysOver(a)}d overdue</div>}
                  {a.pendingConfirmation && <div style={{ fontSize: 10, color: T.amber, fontWeight: 600 }}>⏳ Pending confirm</div>}
                </td>
                <td onClick={e => e.stopPropagation()}><div style={{ display: "flex", alignItems: "center", gap: 6 }}><Avatar name={a.responsible} size={24} users={users} /><span style={{ fontSize: 12 }}>{a.responsible}</span></div></td>
                <td style={{ fontSize: 12, color: isOverdue(a) ? T.red : T.text, whiteSpace: "nowrap" }}>{fmt(a.due)}</td>
                <td onClick={e => e.stopPropagation()}><SBadge s={a.pendingConfirmation && a.status !== "COMPLETED" && a.status !== "DROPPED" ? "PENDING CONFIRM" : a.status} /></td>
                <td style={{ textAlign: "center" }}>{(a.revisions || 0) > 0 ? <span style={{ fontWeight: 700, color: T.amber, fontSize: 12 }}>{a.revisions}</span> : <span style={{ color: T.text2, fontSize: 12 }}>—</span>}</td>
              </tr>
            ))}
            {sorted.length === 0 && <tr><td colSpan={10}><Empty icon="📭" title="No actions found" sub="Adjust filters or add actions via Work." /></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BoardView({ fa, setSel, users }) {
  const groups = [...new Set(fa.map(a => a.section))].filter(Boolean);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {groups.map(g => {
        const ga = fa.filter(a => a.section === g), done = ga.filter(a => a.status === "COMPLETED").length;
        return (
          <div key={g} className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "12px 18px", background: T.bg, borderBottom: `1.5px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: T.navy }}>{g}</span>
              <span style={{ fontSize: 11, color: T.text2 }}>{done}/{ga.length} completed</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12, padding: 14 }}>
              {ga.map((a, idx) => (
                <div key={a.id || `board-${idx}`} style={{ background: T.bg, borderRadius: 10, padding: 12, border: `1.5px solid ${a.pendingConfirmation ? T.amber : isOverdue(a) ? T.red : T.border}`, cursor: "pointer" }} onClick={() => setSel(a)}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, gap: 4 }}><SBadge s={a.pendingConfirmation && a.status !== "COMPLETED" && a.status !== "DROPPED" ? "PENDING CONFIRM" : a.status} /><PBadge p={a.priority} /></div>
                  <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.4, marginBottom: 8 }}>{a.text.slice(0, 70)}{a.text.length > 70 ? "…" : ""}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Avatar name={a.responsible} size={22} users={users || []} />
                    <span style={{ fontSize: 10, color: isOverdue(a) ? T.red : T.text2 }}>{fmt(a.due)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanView({ fa, upStatus, canEdit, users, setSel }) {
  const dragIdRef = useRef(null);
  const [overCol, setOverCol] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [heldId, setHeldId] = useState(null);
  const holdTimerRef = useRef(null);

  const HOLD_GLOW = {
    "IN PROCESS":  { border: "#E69903", shadow: "0 0 0 3px rgba(230,153,3,.25), 0 8px 24px rgba(230,153,3,.18)",    bg: "#FFFBEF" },
    "NOT STARTED": { border: "#7C80B0", shadow: "0 0 0 3px rgba(124,128,176,.25), 0 8px 24px rgba(124,128,176,.18)", bg: "#F4F3FB" },
    "COMPLETED":   { border: "#27AE60", shadow: "0 0 0 3px rgba(39,174,96,.25),   0 8px 24px rgba(39,174,96,.18)",   bg: "#F0FBF5" },
    "DROPPED":     { border: "#BDC3C7", shadow: "0 0 0 3px rgba(189,195,199,.25), 0 8px 24px rgba(189,195,199,.18)", bg: "#F8F9FA" },
  };

  const handleDragStart = (e, a) => {
    clearTimeout(holdTimerRef.current);
    setHeldId(null);
    dragIdRef.current = a.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(a.id));
    const ghost = e.currentTarget.cloneNode(true);
    Object.assign(ghost.style, {
      position: "fixed", top: "-1000px", left: "-1000px",
      width: e.currentTarget.offsetWidth + "px",
      transform: "rotate(2deg) scale(1.06)",
      boxShadow: "0 20px 48px rgba(39,34,98,.30)",
      borderRadius: "10px", opacity: "1",
      border: "2px solid #272262",
      background: "#fff", pointerEvents: "none",
    });
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, 28);
    requestAnimationFrame(() => { ghost.remove(); setDraggingId(a.id); });
  };

  const handleMouseDown = (a) => {
    if (!canEdit) return;
    holdTimerRef.current = setTimeout(() => setHeldId(a.id), 120);
  };
  const handleMouseUp = () => { clearTimeout(holdTimerRef.current); setHeldId(null); };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, alignItems: "start" }}>
      {STATUS_LIST.map(col => {
        const c = SC[col] || { bg: "#eee", text: "#333", dot: "#aaa" };
        const glow = HOLD_GLOW[col] || { border: T.navy, shadow: "0 0 0 3px rgba(39,34,98,.2), 0 8px 24px rgba(39,34,98,.15)", bg: "#F4F3FB" };
        const isDragOver = overCol === col;
        const colCards = fa.filter(a => a.status === col);

        return (
          <div key={col}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (overCol !== col) setOverCol(col); }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOverCol(null); }}
            onDrop={e => {
              e.preventDefault();
              const raw = e.dataTransfer.getData("text/plain");
              const id = dragIdRef.current ?? (raw !== "" ? Number(raw) : null);
              if (id != null && !isNaN(id)) upStatus(id, col);
              dragIdRef.current = null;
              setOverCol(null);
            }}
            style={{
              borderRadius: 12,
              border: isDragOver ? `2px dashed ${c.dot}` : "2px solid transparent",
              background: isDragOver ? c.dot + "18" : c.bg,
              transition: "background .18s, border-color .18s",
              minHeight: 220,
            }}>

            {/* Column header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 12px 8px",
              borderBottom: `2px solid ${c.dot}33`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{
                  width: 10, height: 10, borderRadius: "50%", background: c.dot,
                  display: "inline-block", flexShrink: 0,
                  boxShadow: isDragOver ? `0 0 0 3px ${c.dot}44` : "none",
                  transition: "box-shadow .18s",
                }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: c.text, letterSpacing: .3 }}>{col}</span>
              </div>
              <span style={{ background: "#fff", color: c.text, borderRadius: 20, padding: "1px 9px", fontSize: 11, fontWeight: 700 }}>{colCards.length}</span>
            </div>

            {/* Drop indicator when dragging over an empty column */}
            {isDragOver && colCards.length === 0 && (
              <div style={{ margin: "10px 10px 0", padding: "18px 0", borderRadius: 8, border: `2px dashed ${c.dot}88`, textAlign: "center", fontSize: 12, color: c.dot, fontWeight: 600 }}>
                ⬇ Drop here
              </div>
            )}

            {/* Cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 10px 10px" }}>
              {colCards.map((a, idx) => {
                const isDragging = draggingId === a.id;
                const isHeld = heldId === a.id;
                const draggable = canEdit; // pendingConfirmation does not block dragging
                return (
                  <div key={a.id || `kanban-${idx}`}
                    draggable={draggable}
                    onMouseDown={() => handleMouseDown(a)}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onDragStart={e => handleDragStart(e, a)}
                    onDragEnd={e => { dragIdRef.current = null; setOverCol(null); setDraggingId(null); setHeldId(null); }}
                    onClick={() => { if (!isDragging) setSel(a); }}
                    style={{
                      background: isHeld ? glow.bg : "#fff",
                      borderRadius: 10,
                      padding: "10px 12px",
                      cursor: draggable ? (isHeld ? "grabbing" : "grab") : "default",
                      border: isHeld
                        ? `1.5px solid ${glow.border}`
                        : `1.5px solid ${a.pendingConfirmation ? T.amber : isOverdue(a) ? T.red : "transparent"}`,
                      userSelect: "none", WebkitUserSelect: "none",
                      position: "relative",
                      opacity: isDragging ? 0.3 : 1,
                      transform: isDragging ? "scale(0.95)" : isHeld ? "scale(1.025) translateY(-2px)" : "none",
                      boxShadow: isDragging ? "none" : isHeld ? glow.shadow : "0 1px 6px rgba(0,0,0,.07)",
                      transition: "opacity .15s, transform .18s, box-shadow .18s, border-color .15s, background .15s",
                      zIndex: isHeld ? 2 : 1,
                    }}>
                    {/* Hold accent stripe */}
                    {isHeld && (
                      <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 3, borderRadius: "10px 10px 0 0", background: `linear-gradient(90deg,${glow.border},${glow.border}66)` }} />
                    )}
                    <div style={{ fontSize: 11, marginBottom: 5, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontFamily: "monospace", fontSize: 10, color: isHeld ? glow.border : T.text2, fontWeight: isHeld ? 700 : 500, transition: "color .15s" }}>{a.sn}</span>
                      <PBadge p={a.priority} />
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.45, marginBottom: 9, color: T.text }}>{a.text.slice(0, 65)}{a.text.length > 65 ? "…" : ""}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Avatar name={a.responsible} size={20} users={users || []} />
                      <span style={{ fontSize: 10, color: isOverdue(a) ? T.red : T.text2 }}>{fmt(a.due)}</span>
                    </div>
                    {a.pendingConfirmation && <div style={{ fontSize: 10, color: T.amber, marginTop: 5, fontWeight: 600 }}>⏳ Pending</div>}
                    {(a.messages || []).length > 0 && <div style={{ fontSize: 10, color: T.text2, marginTop: 4 }}>💬 {a.messages.length}</div>}
                  </div>
                );
              })}
              {/* Empty column drop zone when not dragging over */}
              {colCards.length === 0 && !isDragOver && (
                <div style={{ textAlign: "center", padding: "24px 0", fontSize: 12, color: c.dot, opacity: .35, border: `2px dashed ${c.dot}44`, borderRadius: 8 }}>
                  Empty
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TimelineView({ fa }) {
  const sorted = [...fa].filter(a => a.due).sort((a, b) => new Date(a.due) - new Date(b.due));
  if (sorted.length === 0) return <div className="card" style={{ padding: 24 }}><Empty icon="📅" title="No actions with due dates" sub="Add due dates to see timeline." /></div>;
  const minD = new Date(sorted[0].due), maxD = new Date(sorted[sorted.length - 1].due);
  const range = Math.max(1, (maxD - minD) / 86400000);
  const pct = d => Math.round((new Date(d) - minD) / 86400000 / range * 100);
  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 20 }}>Timeline — Sorted by Due Date</div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: T.text2, marginBottom: 6 }}><span>{fmt(sorted[0].due)}</span><span style={{ color: T.red, fontWeight: 600 }}>Today</span><span>{fmt(sorted[sorted.length - 1].due)}</span></div>
      <div style={{ position: "relative", background: T.border, height: 2, borderRadius: 2, marginBottom: 20 }}>
        <div style={{ position: "absolute", left: `${pct(todayStr())}%`, top: -4, width: 2, height: 10, background: T.red, borderRadius: 2 }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sorted.map(a => {
          const p = pct(a.due);
          const c = isOverdue(a) ? T.red : a.status === "COMPLETED" ? T.green : T.amber;
          return (
            <div key={a.id} style={{ display: "grid", gridTemplateColumns: "130px 1fr 110px", gap: 12, alignItems: "center" }}>
              <div style={{ fontSize: 11, color: T.text2, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.responsible?.split(" ")[0]}</div>
              <div style={{ position: "relative", height: 22 }}>
                <div style={{ position: "absolute", left: `${Math.min(p, 90)}%`, top: 0, background: c, borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {a.sn}: {a.text.slice(0, 28)}{a.text.length > 28 ? "…" : ""}
                </div>
              </div>
              <div style={{ fontSize: 10, color: c, fontWeight: 600 }}>{fmt(a.due)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ===================== DASHBOARD ===================== */
function DashboardPage({ actions, plants, depts, users, audit, user, meetings, onViewEscalations, refreshData, setActions: setActionsUp }) {
  const [drill, setDrill] = useState(null);
  const [deptDrill, setDeptDrill] = useState(null);
  const [mtgDrill, setMtgDrill] = useState(false);
  const [actionDetail, setActionDetail] = useState(null);
  const [plantF, setPlantF] = useState("All");
  const [deptF, setDeptF] = useState("All");
  useEscClose(useCallback(() => { setDrill(null); setDeptDrill(null); setMtgDrill(false); }, []));

  const allPlants = plants ? plants.map(p => p.name) : [...new Set(actions.map(a => a.plant))];
  let fa = actions;
  if (plantF !== "All") fa = fa.filter(a => a.plant === plantF);
  if (deptF !== "All") fa = fa.filter(a => a.section === deptF);

  const total = fa.length, comp = fa.filter(a => a.status === "COMPLETED").length, ip = fa.filter(a => a.status === "IN PROCESS").length;
  const ns = fa.filter(a => a.status === "NOT STARTED").length, drop = fa.filter(a => a.status === "DROPPED").length;
  const over = fa.filter(isOverdue).length, crit = fa.filter(a => a.priority === "CRITICAL" && a.status !== "COMPLETED" && a.status !== "DROPPED").length;
  const pendingConf = fa.filter(a => a.pendingConfirmation).length;
  const revs = fa.reduce((s, a) => s + (Number(a.revisions) || 0), 0);
  // On-time rate: for each completed action, 100 if closedOn<=due, else 0; then average
  const onT = comp > 0 ? Math.round(fa.filter(a => a.status === "COMPLETED").reduce((sum, a) => {
    if (!a.due || !a.closedOn) return sum + 0;
    return sum + (new Date(a.closedOn) <= new Date(a.due) ? 100 : 0);
  }, 0) / comp) : 0;
  const visibleDepts = deptF !== "All" ? depts.filter(d => d.name === deptF) : (plantF !== "All" ? depts.filter(d => (users || []).some(u => u.plant === plantF && u.dept === d.name) || fa.some(a => a.section === d.name)) : depts);

  const allSessions = (meetings || []).flatMap(m => (Array.isArray(m.completedSessions) ? m.completedSessions : []).map(s => ({ ...s, type: m.type, plant: m.plant })));
  const totalMtgMins = allSessions.reduce((s, x) => s + (x.duration || 0), 0);
  // Deduplicate audit for badge (keep highest level per action SN)
  const dedupedAuditBadge = Object.values(
    (audit || []).reduce((acc, e) => {
      if (!acc[e.sn] || e.level > acc[e.sn].level) acc[e.sn] = e;
      return acc;
    }, {})
  );

  return (
    <div className="fade-in">
      <PageHeader title="Dashboard" sub="Live accountability snapshot">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          {refreshData && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: T.text2, textTransform: "uppercase", letterSpacing: .4 }}>&nbsp;</span>
              <button className="btn btn-ghost" onClick={refreshData} style={{ border: `1px solid ${T.border}`, background: "#fff", fontSize: 13, padding: "6px 14px" }}>🔄 Refresh</button>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.text2, textTransform: "uppercase", letterSpacing: .4 }}>Plant</span>
            <select value={plantF} onChange={e => setPlantF(e.target.value)} style={{ padding: "6px 10px" }}>
              <option value="All">All Plants</option>{allPlants.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.text2, textTransform: "uppercase", letterSpacing: .4 }}>Department</span>
            <select value={deptF} onChange={e => setDeptF(e.target.value)} style={{ padding: "6px 10px" }}>
              <option value="All">All Departments</option>{depts.map(d => <option key={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
      </PageHeader>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 12 }}>
        <KPICard icon="✅" value={total} label="Total Actions" sub="All records" color={T.navy} onClick={() => setDrill("aging")} />
        <KPICard icon="⚠" value={over} label="Overdue" sub="Need attention" color={T.red} alert={over > 0} onClick={() => setDrill("overdue")} />
        <KPICard icon="🔴" value={crit} label="Critical Open" sub="Unresolved" color={T.red} alert={crit > 0} onClick={() => setDrill("critical")} />
        <KPICard icon="🎯" value={`${onT}%`} label="On-Time Rate" sub="Completed on schedule" color={onT >= 80 ? T.green : T.amber} onClick={() => setDrill("ontime")} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
        <KPICard icon="📅" value={revs} label="Date Revisions" sub="Scope creep tracker" color={revs > 5 ? T.amber : T.slate} onClick={() => setDrill("revisions")} />
        <KPICard icon="🚨" value={dedupedAuditBadge.length} label="Escalated Actions" sub="View all →" color={T.red} alert={dedupedAuditBadge.length > 0} onClick={() => setDrill("escalated")} />
        <KPICard icon="⏳" value={pendingConf} label="Pending Confirm" sub="Awaiting approval" color={T.amber} alert={pendingConf > 0} onClick={() => setDrill("pending")} />
        <div className="card card-hover" onClick={() => setMtgDrill(true)} style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: T.navy + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>🎙</div>
            <div style={{ fontFamily: "'Sora',sans-serif", fontSize: 24, fontWeight: 800, color: T.navy, lineHeight: 1 }}>{totalMtgMins}<span style={{ fontSize: 12, fontWeight: 400, color: T.text2, marginLeft: 2 }}>min</span></div>
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>Meetings Ran</div>
          <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>{allSessions.length} sessions · click to see</div>
        </div>
      </div>

      <div className="card" style={{ padding: "14px 24px", marginBottom: 20, display: "flex", gap: 0, alignItems: "center" }}>
        {[{ s: "NOT STARTED", n: ns }, { s: "IN PROCESS", n: ip }, { s: "COMPLETED", n: comp }, { s: "DROPPED", n: drop }].map((k, i, arr) => (
          <div key={k.s} onClick={() => setDrill(k.s.toLowerCase().replace(/ /g, "_"))} style={{ flex: 1, padding: "0 18px", borderRight: i < arr.length - 1 ? `1.5px solid ${T.border}` : "none", cursor: "pointer" }}>
            <div style={{ fontFamily: "'Sora',sans-serif", fontSize: 22, fontWeight: 700, color: SC[k.s]?.dot || T.slate }}>{k.n}</div>
            <div style={{ marginTop: 5 }}><SBadge s={k.s} /></div>
          </div>
        ))}
        <div style={{ flex: 1.8, padding: "0 18px", borderLeft: `1.5px solid ${T.border}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.text2, marginBottom: 6, letterSpacing: .5, textTransform: "uppercase" }}>Completion</div>
          <div style={{ background: T.border, borderRadius: 6, height: 10, overflow: "hidden" }}><div style={{ height: "100%", borderRadius: 6, background: `linear-gradient(90deg,${T.green},${T.amber})`, width: `${total ? Math.round(comp / total * 100) : 0}%`, transition: "width .6s" }} /></div>
          <div style={{ fontSize: 12, color: T.text2, marginTop: 4 }}>{total ? Math.round(comp / total * 100) : 0}% complete</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
        <div style={{ padding: "14px 20px", borderBottom: `1.5px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div><div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 14, color: T.navy }}>Department Accountability Heat Map</div><div style={{ fontSize: 12, color: T.text2, marginTop: 2 }}>Health = Red if any critical open, Amber if any overdue, else Green. Completion % = closed / total actions.</div></div>
          <div style={{ display: "flex", gap: 14, fontSize: 11, color: T.text2 }}>
            {[{ c: T.red, l: "Critical" }, { c: T.amber, l: "Overdue" }, { c: T.green, l: "On track" }].map(x => (
              <span key={x.l} style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: x.c, display: "inline-block" }} />{x.l}</span>
            ))}
          </div>
        </div>
        <table>
          <thead><tr><th>Department</th><th style={{ textAlign: "center" }}>Total</th><th style={{ textAlign: "center" }}>Open</th><th style={{ textAlign: "center" }}>Critical</th><th style={{ textAlign: "center" }}>Overdue</th><th>Completion</th><th style={{ textAlign: "center" }}>Health</th></tr></thead>
          <tbody>{visibleDepts.map(d => {
            const da = fa.filter(a => a.section === d.name);
            const open = da.filter(a => a.status !== "COMPLETED" && a.status !== "DROPPED").length;
            const c = da.filter(a => a.priority === "CRITICAL" && a.status !== "COMPLETED" && a.status !== "DROPPED").length;
            const o = da.filter(isOverdue).length;
            const dn = da.filter(a => a.status === "COMPLETED").length;
            const r = da.length ? Math.round(dn / da.length * 100) : 0;
            const health = da.length === 0 ? "nodata" : c > 0 ? "red" : o > 0 ? "amber" : "green";
            const hc = health === "red" ? T.red : health === "amber" ? T.amber : health === "nodata" ? T.slate : T.green;
            const hb = health === "red" ? T.redL : health === "amber" ? T.amberL : health === "nodata" ? "#F0F0F8" : T.greenL;
            return (
              <tr key={d.id} style={{ cursor: "pointer" }} onClick={() => setDeptDrill(d)}>
                <td><div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: hc, flexShrink: 0 }} /><span style={{ fontSize: 18 }}>{d.icon}</span><div><div style={{ fontWeight: 600, fontSize: 13 }}>{d.name}</div><div style={{ fontSize: 11, color: T.text2 }}>HOD: {d.head}</div></div></div></td>
                <td style={{ textAlign: "center" }}><span style={{ fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 14, color: T.navy }}>{da.length}</span></td>
                <td style={{ textAlign: "center", fontWeight: 600, color: open > 0 ? T.amber : T.green }}>{open}</td>
                <td style={{ textAlign: "center", fontWeight: 700, color: c > 0 ? T.red : T.text2 }}>{c}</td>
                <td style={{ textAlign: "center", fontWeight: 700, color: o > 0 ? T.red : T.text2 }}>{o}</td>
                <td><div style={{ display: "flex", alignItems: "center", gap: 8 }}><Sparkbar pct={r} color={r >= 80 ? T.green : r >= 50 ? T.amber : T.red} /><span style={{ fontSize: 12, fontWeight: 700, color: r >= 80 ? T.green : r >= 50 ? T.amber : T.red, minWidth: 30 }}>{r}%</span></div></td>
                <td style={{ textAlign: "center" }}><span style={{ padding: "3px 10px", borderRadius: 20, background: hb, color: hc, fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>{health}</span></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Feature 8: Clickable Critical & Overdue with slide-in panel */}
        <div className="card card-hover" style={{ padding: 20, cursor: "pointer" }} onClick={() => setDrill("criticalOverdue")}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy }}>Critical and Overdue</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ background: T.redL, color: T.red, padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>{fa.filter(a => (a.priority === "CRITICAL" || isOverdue(a)) && a.status !== "COMPLETED" && a.status !== "DROPPED").length}</span>
              <span style={{ fontSize: 11, color: T.navy, fontWeight: 700 }}>View All →</span>
            </div>
          </div>
          {fa.filter(a => (a.priority === "CRITICAL" || isOverdue(a)) && a.status !== "COMPLETED" && a.status !== "DROPPED").length === 0
            ? <Empty icon="✅" title="All clear" sub="No critical or overdue issues." />
            : fa.filter(a => (a.priority === "CRITICAL" || isOverdue(a)) && a.status !== "COMPLETED" && a.status !== "DROPPED").slice(0, 4).map(a => (
              <div key={a.id} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: `1px solid ${T.border}`, alignItems: "flex-start" }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: a.priority === "CRITICAL" ? T.red : T.amber, marginTop: 4, flexShrink: 0 }} />
                <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.4 }}>{a.text.slice(0, 55)}{a.text.length > 55 ? "…" : ""}</div><div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>{a.section} · {isOverdue(a) ? <span style={{ color: T.red, fontWeight: 600 }}>{daysOver(a)}d late</span> : fmt(a.due)}</div></div>
                <Avatar name={a.responsible} size={24} users={users} />
              </div>
            ))
          }
        </div>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy }}>Escalation Alerts</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ background: T.redL, color: T.red, padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>{dedupedAuditBadge.length} logged</span>
              <button onClick={() => onViewEscalations && onViewEscalations()} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 11, color: T.navy, fontWeight: 700, padding: 0 }}>View All →</button>
            </div>
          </div>
          {audit.length === 0
            ? <Empty icon="🔇" title="No escalations" sub="All within thresholds." />
            : audit.slice(0, 5).map(e => (
              <div key={e.id} style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: `1px solid ${T.border}`, alignItems: "flex-start" }}>
                <span style={{ padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, flexShrink: 0, background: e.level === 3 ? T.redL : e.level === 2 ? "#FDEBD0" : T.amberL, color: e.level === 3 ? T.red : e.level === 2 ? "#884E00" : T.amber }}>L{e.level}</span>
                <div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 500 }}>{e.text.slice(0, 55)}{e.text.length > 55 ? "…" : ""}</div><div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>{e.target} · {e.reason}</div></div>
              </div>
            ))
          }
        </div>
      </div>

      {/* Feature 8: Critical/Overdue slide-in side panel */}
      {drill === "criticalOverdue" && (() => {
        const critOverdue = fa.filter(a => (a.priority === "CRITICAL" || isOverdue(a)) && a.status !== "COMPLETED" && a.status !== "DROPPED").sort((a, b) => daysOver(b) - daysOver(a));
        return (
          <>
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", zIndex: 340 }} onClick={() => setDrill(null)} />
            <div className="side-panel" style={{ width: 480, padding: 0, zIndex: 355 }}>
              <div style={{ background: `linear-gradient(135deg,${T.red},#E74C3C)`, padding: "20px 24px", color: "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 10, opacity: .7, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Dashboard Alert</div>
                    <h2 style={{ fontFamily: "'Sora',sans-serif", fontSize: 18, fontWeight: 800, marginBottom: 4 }}>Critical & Overdue</h2>
                    <div style={{ fontSize: 12, opacity: .8 }}>{critOverdue.length} items requiring immediate attention</div>
                  </div>
                  <button onClick={() => setDrill(null)} style={{ background: "rgba(255,255,255,.2)", border: "none", color: "#fff", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                </div>
              </div>
              <div style={{ overflowY: "auto", flex: 1, padding: 20 }}>
                {critOverdue.length === 0 ? <Empty icon="✅" title="All clear!" sub="No critical or overdue actions." /> :
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {critOverdue.map(a => (
                      <div key={a.id} style={{ background: T.bg, borderRadius: 10, padding: "14px 16px", border: `1.5px solid ${a.priority === "CRITICAL" ? T.red : T.amber}30`, cursor: "pointer", transition: "transform .15s" }} onClick={() => { setDrill(null); setActionDetail(a); }} onMouseEnter={e => e.currentTarget.style.transform = "translateY(-1px)"} onMouseLeave={e => e.currentTarget.style.transform = "none"}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                          <span style={{ fontFamily: "monospace", fontSize: 10, color: T.text2 }}>{a.sn}</span>
                          <div style={{ display: "flex", gap: 6 }}><SBadge s={a.status} /><PBadge p={a.priority} /></div>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, lineHeight: 1.4 }}>{a.text}</div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <Avatar name={a.responsible} size={22} users={users} />
                            <span style={{ fontSize: 12, color: T.text2 }}>{a.responsible}</span>
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: isOverdue(a) ? T.red : T.amber }}>{isOverdue(a) ? `${daysOver(a)}d overdue` : fmt(a.due)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                }
              </div>
            </div>
          </>
        );
      })()}

      {drill && drill !== "criticalOverdue" && (() => {
        const drillData = {
          overdue: { title: "Overdue Actions", icon: "⚠", color: T.red, rows: fa.filter(isOverdue).sort((a, b) => daysOver(b) - daysOver(a)) },
          critical: { title: "Critical Open Actions", icon: "🔴", color: T.red, rows: fa.filter(a => a.priority === "CRITICAL" && a.status !== "COMPLETED" && a.status !== "DROPPED") },
          ontime: { title: "On-Time Closure", icon: "🎯", color: T.green, rows: fa.filter(a => a.status === "COMPLETED") },
          revisions: { title: "Date Revision Actions", icon: "📅", color: T.amber, rows: fa.filter(a => a.revisions > 0).sort((a, b) => b.revisions - a.revisions) },
          pending: { title: "Pending Confirmation", icon: "⏳", color: T.amber, rows: fa.filter(a => a.pendingConfirmation) },
          aging: { title: "All Actions — Aging View", icon: "📊", color: T.navy, rows: fa },
          not_started: { title: "Not Started Actions", icon: "⭕", color: T.slate, rows: fa.filter(a => a.status === "NOT STARTED") },
          in_process: { title: "In Process Actions", icon: "🔄", color: T.amber, rows: fa.filter(a => a.status === "IN PROCESS") },
          dropped: { title: "Dropped Actions", icon: "🚫", color: T.text2, rows: fa.filter(a => a.status === "DROPPED") },
          escalated: { title: "Escalated Actions", icon: "🚨", color: T.red, rows: fa.filter(a => audit.find(e => e.sn === a.sn)) },
        };
        const d = drillData[drill];
        if (!d) return null;
        return (
          <>
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", zIndex: 340 }} onClick={() => setDrill(null)} />
            <div className="side-panel" style={{ width: 520, padding: 0, zIndex: 355 }}>
              <div style={{ background: `linear-gradient(135deg,${d.color},${d.color}CC)`, padding: "20px 24px", color: "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 10, opacity: .7, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Dashboard Drill-Down</div>
                    <h2 style={{ fontFamily: "'Sora',sans-serif", fontSize: 18, fontWeight: 800, marginBottom: 4 }}>{d.icon} {d.title}</h2>
                    <div style={{ fontSize: 12, opacity: .8 }}>{d.rows.length} action{d.rows.length !== 1 ? "s" : ""}</div>
                  </div>
                  <button onClick={() => setDrill(null)} style={{ background: "rgba(255,255,255,.2)", border: "none", color: "#fff", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                </div>
              </div>
              <div style={{ overflowY: "auto", flex: 1, padding: 20 }}>
                {d.rows.length === 0 ? <Empty icon="📭" title="No records" sub="Nothing to show for this filter." /> :
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {d.rows.slice(0, 30).map(a => (
                      <div key={a.id} style={{ background: T.bg, borderRadius: 10, padding: "12px 14px", border: `1.5px solid ${isOverdue(a) ? T.red + "40" : T.border}`, cursor: "pointer", transition: "transform .15s" }} onClick={() => { setDrill(null); setActionDetail(a); }} onMouseEnter={e => e.currentTarget.style.transform = "translateY(-1px)"} onMouseLeave={e => e.currentTarget.style.transform = "none"}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                          <span style={{ fontFamily: "monospace", fontSize: 10, color: T.text2 }}>{a.sn}</span>
                          <div style={{ display: "flex", gap: 5 }}><SBadge s={a.pendingConfirmation && a.status !== "COMPLETED" && a.status !== "DROPPED" ? "PENDING CONFIRM" : a.status} /><PBadge p={a.priority} /></div>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, lineHeight: 1.4 }}>{a.text}</div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <Avatar name={a.responsible} size={22} users={users} />
                            <span style={{ fontSize: 12, color: T.text2 }}>{a.responsible || "Unassigned"}</span>
                          </div>
                          <div style={{ display: "flex", gap: 8, fontSize: 11, color: T.text2 }}>
                            {drill === "revisions" && <span style={{ fontWeight: 700, color: T.amber }}>{a.revisions} revision{a.revisions !== 1 ? "s" : ""}</span>}
                            {drill === "escalated" && <span style={{ fontWeight: 700, color: T.red }}>L{Math.max(...(audit.filter(e => e.sn === a.sn).map(e => e.level || 1)))} escalated</span>}
                            <span style={{ color: isOverdue(a) ? T.red : T.text2, fontWeight: isOverdue(a) ? 700 : 400 }}>{isOverdue(a) ? `${daysOver(a)}d overdue` : fmt(a.due)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                }
              </div>
            </div>
          </>
        );
      })()}

      {mtgDrill && (
        <div className="overlay" onClick={() => setMtgDrill(false)}>
          <div className="modal" style={{ width: 620, padding: 28 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h2 style={{ fontFamily: "'Sora',sans-serif", fontSize: 18, fontWeight: 800, color: T.navy }}>Meeting Duration Summary</h2>
              <button onClick={() => setMtgDrill(false)} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 22, color: T.text2 }}>x</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
              {[{ l: "Total Sessions", v: allSessions.length, c: T.navy }, { l: "Total Minutes", v: totalMtgMins, c: T.amber }, { l: "Avg Duration", v: allSessions.length ? Math.round(totalMtgMins / allSessions.length) + "min" : "—", c: T.green }].map(k => (
                <div key={k.l} style={{ textAlign: "center", background: T.bg, borderRadius: 10, padding: "16px 8px" }}>
                  <div style={{ fontFamily: "'Sora',sans-serif", fontSize: 28, fontWeight: 800, color: k.c }}>{k.v}</div>
                  <div style={{ fontSize: 12, color: T.text2, marginTop: 4 }}>{k.l}</div>
                </div>
              ))}
            </div>
            {meetings.map(m => {
              const sessions = m.completedSessions || [];
              const totalMin = sessions.reduce((s, x) => s + (x.duration || 0), 0);
              return (
                <div key={m.id} style={{ padding: "12px 0", borderBottom: `1px solid ${T.border}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div><div style={{ fontWeight: 600, fontSize: 13 }}>{m.type}</div><div style={{ fontSize: 11, color: T.text2 }}>{m.plant} · {m.project && <span style={{ color: T.amber }}>📎 {m.project}</span>}</div></div>
                    <div style={{ textAlign: "right" }}><div style={{ fontFamily: "'Sora',sans-serif", fontSize: 18, fontWeight: 700, color: T.navy }}>{totalMin}min</div><div style={{ fontSize: 10, color: T.text2 }}>{sessions.length} session{sessions.length !== 1 ? "s" : ""}</div></div>
                  </div>
                  {sessions.length > 0 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{sessions.map((s, i) => <div key={i} style={{ background: T.bg, borderRadius: 6, padding: "4px 10px", fontSize: 11 }}>{fmt(s.date)} — <b>{s.duration}min</b></div>)}</div>}
                  {sessions.length === 0 && <div style={{ fontSize: 11, color: T.text2, fontStyle: "italic" }}>No sessions recorded yet</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {deptDrill && (() => {
        const da = fa.filter(a => a.section === deptDrill.name);
        const dopen = da.filter(a => a.status !== "COMPLETED" && a.status !== "DROPPED").length;
        const dover = da.filter(isOverdue).length, ddone = da.filter(a => a.status === "COMPLETED").length;
        return (
          <div className="overlay" onClick={() => setDeptDrill(null)}>
            <div className="modal" style={{ width: 660, padding: 28 }} onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}><span style={{ fontSize: 28 }}>{deptDrill.icon}</span><div><h2 style={{ fontFamily: "'Sora',sans-serif", fontSize: 17, fontWeight: 800, color: T.navy }}>{deptDrill.name}</h2><div style={{ fontSize: 12, color: T.text2 }}>HOD: {deptDrill.head}</div></div></div>
                <button onClick={() => setDeptDrill(null)} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 22, color: T.text2 }}>x</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, margin: "14px 0" }}>
                {[{ l: "Total", v: da.length, c: T.navy }, { l: "Open", v: dopen, c: T.amber }, { l: "Overdue", v: dover, c: T.red }, { l: "Done", v: ddone, c: T.green }].map(k => (
                  <div key={k.l} style={{ textAlign: "center", background: T.bg, borderRadius: 8, padding: "12px 8px" }}>
                    <div style={{ fontFamily: "'Sora',sans-serif", fontSize: 26, fontWeight: 800, color: k.c }}>{k.v}</div>
                    <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>{k.l}</div>
                  </div>
                ))}
              </div>
              <table><thead><tr><th>SN</th><th>Action</th><th>Reason</th><th>Responsible</th><th>Status</th><th>Due</th></tr></thead>
                <tbody>{da.map(a => (
                  <tr key={a.id} style={{ cursor: "pointer" }} onClick={() => { setActionDetail(a); setDeptDrill(null); }} onMouseEnter={e => { Array.from(e.currentTarget.cells).forEach(c => c.style.background = "#FAFAFE"); }} onMouseLeave={e => { Array.from(e.currentTarget.cells).forEach(c => c.style.background = ""); }}><td style={{ fontFamily: "monospace", fontSize: 11, color: T.text2 }}>{a.sn}</td><td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{a.text}</td><td style={{ maxWidth: 140, fontSize: 11, color: T.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.reasonOfAction || "—"}</td><td><div style={{ display: "flex", alignItems: "center", gap: 6 }}><Avatar name={a.responsible} size={22} users={users} /><span style={{ fontSize: 12 }}>{a.responsible?.split(" ")[0]}</span></div></td><td><SBadge s={a.status} /></td><td style={{ fontSize: 12, color: isOverdue(a) ? T.red : T.text }}>{fmt(a.due)}</td></tr>
                ))}</tbody></table>
              {da.length > 0 && <div style={{ fontSize: 11, color: T.text2, marginTop: 8, fontStyle: "italic" }}>💡 Click any row to open and edit the action</div>}
            </div>
          </div>
        );
      })()}
      {actionDetail && <ActionDetailPanel action={actionDetail} onClose={() => setActionDetail(null)} onUpdate={(id, patch) => { if (setActionsUp) setActionsUp(p => p.map(a => a.id !== id ? a : { ...a, ...patch })); setActionDetail(p => p ? { ...p, ...patch } : p); }} user={user} users={users} allUsers={users} plants={plants} />}
    </div>
  );
}

/* ===================== ESCALATIONS PAGE — Feature 9 ===================== */
function EscalationsPage({ actions, audit, user, setPage, users, plants, setActions: setActionsUp }) {
  const [sel, setSel] = useState(null);
  const [filterMode, setFilterMode] = useState("mine"); // "mine" | "all"
  const [actionDetail, setActionDetail] = useState(null);

  // Get subordinates recursively
  const getSubTree = (name, allUsers, visited = new Set()) => {
    if (visited.has(name)) return [];
    visited.add(name);
    const directs = allUsers.filter(u => u.superior === name);
    const all = [name, ...directs.map(d => d.name)];
    directs.forEach(d => { all.push(...getSubTree(d.name, allUsers, visited).filter(n => !all.includes(n))); });
    return all;
  };
  const mySubTree = user ? getSubTree(user.name, users || []) : [];

  // Deduplicate audit: one entry per action SN (keep highest level)
  const dedupedAudit = Object.values(
    (audit || []).reduce((acc, e) => {
      if (!acc[e.sn] || e.level > acc[e.sn].level) acc[e.sn] = e;
      return acc;
    }, {})
  );

  // Filter based on mode: "mine" = subordinates' escalated actions OR escalated up to user
  const filteredAudit = filterMode === "mine"
    ? dedupedAudit.filter(e => {
      const action = actions.find(a => a.sn === e.sn);
      if (!action) return false;
      // Include if responsible is in my subtree, or if escalated to my level
      const isSubordinate = mySubTree.includes(action.responsible) && action.responsible !== user?.name;
      const escalatedToMe = e.target === user?.role || e.target === "All";
      return isSubordinate || escalatedToMe;
    })
    : dedupedAudit;

  // Group by responsible person (no duplicates per action)
  const byPerson = {};
  filteredAudit.forEach(e => {
    const action = actions.find(a => a.sn === e.sn);
    const responsible = action?.responsible || "Unknown";
    if (!byPerson[responsible]) byPerson[responsible] = { name: responsible, count: 0, escalations: [], actions: [] };
    byPerson[responsible].count++;
    byPerson[responsible].escalations.push(e);
    if (action) byPerson[responsible].actions.push(action); // already deduped above
  });
  const personList = Object.values(byPerson).sort((a, b) => b.count - a.count);
  const resolvedToday = filteredAudit.filter(e => {
    const a = actions.find(x => x.sn === e.sn);
    return a && a.status === "COMPLETED" && a.closedOn === new Date().toISOString().split("T")[0];
  }).length;

  return (
    <div className="fade-in">
      <PageHeader title="Escalation Alerts" sub="Overdue actions escalated by priority level">
        {/* My / All filter toggle */}
        <div style={{ display: "flex", background: T.bg, borderRadius: 8, padding: 3, border: `1.5px solid ${T.border}` }}>
          <button onClick={() => setFilterMode("mine")} style={{ padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: filterMode === "mine" ? T.navy : "transparent", color: filterMode === "mine" ? "#fff" : T.text2, transition: "all .18s" }}>My Scope</button>
          <button onClick={() => setFilterMode("all")} style={{ padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: filterMode === "all" ? T.navy : "transparent", color: filterMode === "all" ? "#fff" : T.text2, transition: "all .18s" }}>All</button>
        </div>
      </PageHeader>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>
        {[
          { label: "Total Escalated", value: filteredAudit.length, icon: "🚨", color: T.red },
          { label: "People Affected", value: personList.length, icon: "👤", color: T.amber },
          { label: "Critical Level", value: filteredAudit.filter(e => e.level >= 3).length, icon: "🔴", color: T.red },
          { label: "Resolved Today", value: resolvedToday, icon: "✅", color: T.green },
        ].map((k, i) => (
          <div key={i} className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: k.color + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{k.icon}</div>
              <div><div style={{ fontFamily: "'Sora',sans-serif", fontSize: 26, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div><div style={{ fontSize: 12, color: T.text2, fontWeight: 600 }}>{k.label}</div></div>
            </div>
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: `1.5px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 14, color: T.navy }}>Escalated Actions by Person</div>
          <div style={{ fontSize: 11, color: T.text2 }}>{filteredAudit.length} unique escalated actions · click to expand</div>
        </div>
        <table>
          <thead><tr><th>Responsible</th><th>Escalations</th><th>Open Actions</th><th>Highest Level</th><th>Reason</th><th></th></tr></thead>
          <tbody>
            {personList.length === 0 && <tr><td colSpan={6}><Empty icon="🔇" title="No escalations in scope" sub="All actions within thresholds, or nothing in your reporting scope." /></td></tr>}
            {personList.map(p => {
              const maxLevel = Math.max(...p.escalations.map(e => e.level || 1));
              const lastEsc = p.escalations[p.escalations.length - 1];
              const levelColor = maxLevel >= 3 ? T.red : maxLevel === 2 ? "#884E00" : T.amber;
              const levelBg = maxLevel >= 3 ? T.redL : maxLevel === 2 ? "#FDEBD0" : T.amberL;
              const isExpanded = sel?.name === p.name;
              return (
                <React.Fragment key={p.name}>
                  <tr style={{ cursor: "pointer", background: isExpanded ? T.bg : "" }} onClick={() => setSel(isExpanded ? null : p)}>
                    <td><div style={{ display: "flex", alignItems: "center", gap: 8 }}><Avatar name={p.name} size={30} users={users || []} /><div><div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div><div style={{ fontSize: 11, color: T.text2 }}>{(users || []).find(u => u.name === p.name)?.role || "—"}</div></div></div></td>
                    <td><span style={{ background: T.redL, color: T.red, padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>{p.count}</span></td>
                    <td style={{ fontWeight: 600, fontSize: 13, color: p.actions.filter(a => a.status !== "COMPLETED" && a.status !== "DROPPED").length > 0 ? T.amber : T.green }}>{p.actions.filter(a => a.status !== "COMPLETED" && a.status !== "DROPPED").length}</td>
                    <td><span style={{ background: levelBg, color: levelColor, padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>Level {maxLevel}</span></td>
                    <td style={{ fontSize: 11, color: T.text2, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lastEsc ? lastEsc.reason : "—"}</td>
                    <td><button style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: T.navy, fontWeight: 600 }}>{isExpanded ? "▲" : "▼"}</button></td>
                  </tr>
                  {isExpanded && (
                    <tr key={p.name + "_detail"}>
                      <td colSpan={6} style={{ padding: 0 }}>
                        <div style={{ padding: "14px 20px", background: T.bg, borderTop: `1px solid ${T.border}` }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {p.escalations.map((e) => {
                              const action = actions.find(a => a.sn === e.sn);
                              return (
                                <div key={e.id || e.sn} style={{ background: "#fff", borderRadius: 8, padding: "10px 14px", border: `1px solid ${T.border}`, display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer", transition: "background .15s" }} onClick={() => { if (action) setActionDetail(action); }} onMouseEnter={ev => ev.currentTarget.style.background = T.bg} onMouseLeave={ev => ev.currentTarget.style.background = "#fff"}>
                                  <span style={{ padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, flexShrink: 0, background: e.level >= 3 ? T.redL : e.level === 2 ? "#FDEBD0" : T.amberL, color: e.level >= 3 ? T.red : e.level === 2 ? "#884E00" : T.amber }}>L{e.level}</span>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{e.sn}</div>
                                    <div style={{ fontSize: 12, color: T.text, marginBottom: 3 }}>{e.text.slice(0, 80)}{e.text.length > 80 ? "…" : ""}</div>
                                    <div style={{ fontSize: 11, color: T.text2 }}>Escalated to: <b>{e.target}</b> · {e.reason}</div>
                                  </div>
                                  <div style={{ textAlign: "right" }}>
                                    {action && <SBadge s={action.status} />}
                                    <div style={{ fontSize: 10, color: T.text2, marginTop: 4 }}>{new Date(e.ts).toLocaleDateString("en-IN")}</div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {actionDetail && <ActionDetailPanel action={actionDetail} onClose={() => setActionDetail(null)} onUpdate={(id, patch) => { if (setActionsUp) setActionsUp(p => p.map(a => a.id !== id ? a : { ...a, ...patch })); setActionDetail(p => p ? { ...p, ...patch } : p); }} user={user} users={users} allUsers={users} plants={plants} />}
    </div>
  );
}

/* ===================== MASTER SETUP ===================== */
/* ===================== ESCALATION MATRIX TAB ===================== */
function EscMatrixTab({ escMatrix, setEscMatrix }) {
  const PRIORITIES = ["CRITICAL", "WARNING", "NORMAL"];
  const TARGETS = ["Supervisor", "HOD", "Plant Head", "MD", "All"];
  const METHODS = ["In-App", "In-App + Email", "Email Only", "SMS + Email"];
  const [editRow, setEditRow] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const upDraft = (k, v) => setEditDraft(d => ({ ...d, [k]: v }));
  const startEdit = (tier) => { setEditRow(tier.id); setEditDraft({ ...tier, priorities: [...tier.priorities] }); };
  const saveEdit = () => { setEscMatrix(m => m.map(t => t.id === editRow ? editDraft : t)); setEditRow(null); setEditDraft(null); };
  const cancelEdit = () => { setEditRow(null); setEditDraft(null); };
  const addTier = () => {
    const matrix = escMatrix || DEFAULT_ESC_MATRIX;
    const maxLvl = Math.max(...matrix.map(t => t.level), 0);
    const newTier = { id: "E" + crypto.randomUUID().slice(0, 8), level: maxLvl + 1, label: `Level ${maxLvl + 1} — New Tier`, overdueDays: maxLvl * 3 + 3, overdueHrs: (maxLvl * 3 + 3) * 24, target: "HOD", notifyMethod: "In-App", priorities: ["CRITICAL"], applicableTo: "All", color: T.slate, active: true, description: "" };
    setEscMatrix(m => [...m, newTier]);
    setEditRow(newTier.id); setEditDraft({ ...newTier, priorities: [...newTier.priorities] });
  };
  const deleteTier = (id) => setEscMatrix(m => m.filter(t => t.id !== id));
  const toggleActive = (id) => setEscMatrix(m => m.map(t => t.id === id ? { ...t, active: !t.active } : t));
  const matrix = (escMatrix || DEFAULT_ESC_MATRIX).slice().sort((a, b) => a.level - b.level);
  return (
    <div>
      {/* Header */}
      <div className="card" style={{ padding: "18px 22px", marginBottom: 14, background: `linear-gradient(135deg,${T.navy},#3D378C)`, color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 16, marginBottom: 4 }}>🚨 Escalation Matrix</div>
            <div style={{ fontSize: 12, opacity: .8 }}>Define when and to whom pending actions are escalated based on overdue duration and priority.</div>
          </div>
          <button onClick={addTier} style={{ background: "rgba(255,255,255,.2)", border: "1px solid rgba(255,255,255,.3)", color: "#fff", borderRadius: 8, padding: "7px 16px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>+ Add Level</button>
        </div>
      </div>

      {/* Flow diagram */}
      <div className="card" style={{ padding: "16px 22px", marginBottom: 14, overflow: "hidden" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.text2, marginBottom: 12, textTransform: "uppercase", letterSpacing: .5 }}>Escalation Flow</div>
        <div style={{ display: "flex", alignItems: "center", gap: 0, overflowX: "auto", paddingBottom: 4 }}>
          {matrix.filter(t => t.active).map((t, i, arr) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
              <div style={{ textAlign: "center", minWidth: 110 }}>
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: t.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 16, margin: "0 auto 6px", boxShadow: `0 0 0 3px ${t.color}30` }}>L{t.level}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.text }}>{t.target}</div>
                <div style={{ fontSize: 10, color: T.text2, marginTop: 2 }}>{t.overdueDays === 0 ? "On due date" : `+${t.overdueDays}d overdue`}</div>
              </div>
              {i < arr.length - 1 && <div style={{ width: 48, height: 2, background: `linear-gradient(90deg,${t.color},${arr[i + 1].color})`, margin: "0 4px", flexShrink: 0, position: "relative" }}>
                <div style={{ position: "absolute", right: -4, top: -4, color: arr[i + 1].color, fontSize: 14 }}>▶</div>
              </div>}
            </div>
          ))}
          {matrix.filter(t => t.active).length === 0 && <div style={{ fontSize: 12, color: T.text2, fontStyle: "italic" }}>No active tiers</div>}
        </div>
      </div>

      {/* Tier cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {matrix.map(tier => {
          const isEditing = editRow === tier.id;
          return (
            <div key={tier.id} className="card" style={{ padding: 0, overflow: "hidden", opacity: tier.active ? 1 : .55, border: `1.5px solid ${isEditing ? tier.color : T.border}`, transition: "all .2s" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: isEditing ? `1px solid ${T.border}` : "none", background: isEditing ? T.bg : "transparent" }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: tier.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14, flexShrink: 0 }}>L{tier.level}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: T.text }}>{tier.label}</div>
                  <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>{tier.description || "No description"}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button onClick={() => toggleActive(tier.id)} title={tier.active ? "Disable" : "Enable"} style={{ background: tier.active ? T.green : "#e2e8f0", border: "none", borderRadius: 12, width: 42, height: 22, cursor: "pointer", transition: "all .2s", position: "relative", flexShrink: 0 }}>
                    <span style={{ position: "absolute", top: 2, left: tier.active ? 22 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.3)", transition: "all .2s", display: "block" }} />
                  </button>
                  <span style={{ fontSize: 10, color: tier.active ? T.green : T.text2, fontWeight: 600, minWidth: 36 }}>{tier.active ? "ON" : "OFF"}</span>
                  {!isEditing && <button onClick={() => startEdit(tier)} style={{ fontSize: 11, background: T.navy, color: "#fff", border: "none", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontWeight: 600 }}>Edit</button>}
                  {!isEditing && <button onClick={() => deleteTier(tier.id)} style={{ fontSize: 11, background: "transparent", color: T.red, border: `1px solid ${T.red}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}>Delete</button>}
                  {isEditing && <button onClick={saveEdit} style={{ fontSize: 11, background: T.green, color: "#fff", border: "none", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontWeight: 600 }}>Save</button>}
                  {isEditing && <button onClick={cancelEdit} style={{ fontSize: 11, background: "transparent", color: T.text2, border: `1px solid ${T.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}>Cancel</button>}
                </div>
              </div>
              {!isEditing && (
                <div style={{ display: "flex", gap: 10, padding: "10px 18px", flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 11, background: T.bg, borderRadius: 6, padding: "4px 10px", color: T.text }}><b>Trigger:</b> {tier.overdueDays === 0 ? "On due date" : `${tier.overdueDays} day${tier.overdueDays !== 1 ? "s" : ""} overdue`}</span>
                  <span style={{ fontSize: 11, background: T.bg, borderRadius: 6, padding: "4px 10px", color: T.text }}><b>Escalate to:</b> {tier.target}</span>
                  <span style={{ fontSize: 11, background: T.bg, borderRadius: 6, padding: "4px 10px", color: T.text }}><b>Notify via:</b> {tier.notifyMethod}</span>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {tier.priorities.map(p => <span key={p} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 10, fontWeight: 700, background: p === "CRITICAL" ? T.redL : p === "WARNING" ? T.amberL : "#E8F4F8", color: p === "CRITICAL" ? T.red : p === "WARNING" ? T.amber : "#1A6B8A" }}>{p}</span>)}
                  </div>
                </div>
              )}
              {isEditing && editDraft && (
                <div style={{ padding: "16px 18px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <div style={{ gridColumn: "1/-1" }}><Lbl t="Tier Label" req /><input value={editDraft.label} onChange={e => upDraft("label", e.target.value)} /></div>
                  <div style={{ gridColumn: "1/-1" }}><Lbl t="Description" /><input value={editDraft.description || ""} onChange={e => upDraft("description", e.target.value)} placeholder="Brief explanation of this escalation level" /></div>
                  <div>
                    <Lbl t="Overdue Days (trigger)" req />
                    <input type="number" min={0} max={365} value={editDraft.overdueDays} onChange={e => { const d = +e.target.value; upDraft("overdueDays", d); upDraft("overdueHrs", d * 24); }} />
                    <div style={{ fontSize: 10, color: T.text2, marginTop: 3 }}>0 = triggers on due date</div>
                  </div>
                  <div>
                    <Lbl t="Escalate To" req />
                    <select value={editDraft.target} onChange={e => upDraft("target", e.target.value)}>
                      {TARGETS.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <Lbl t="Notification Method" />
                    <select value={editDraft.notifyMethod} onChange={e => upDraft("notifyMethod", e.target.value)}>
                      {METHODS.map(m => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <Lbl t="Badge Color" />
                    <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                      {["#E69903", "#E67E22", "#C0392B", "#7B241C", "#1E8449", "#272262", "#7F8C8D"].map(c => (
                        <button key={c} onClick={() => upDraft("color", c)} style={{ width: 24, height: 24, borderRadius: "50%", background: c, border: editDraft.color === c ? "3px solid #000" : "3px solid transparent", cursor: "pointer", padding: 0, outline: "none" }} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <Lbl t="Applies to Priorities" />
                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                      {PRIORITIES.map(p => (
                        <label key={p} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 12 }}>
                          <input type="checkbox" checked={editDraft.priorities.includes(p)} onChange={e => { const arr = e.target.checked ? [...editDraft.priorities, p] : editDraft.priorities.filter(x => x !== p); upDraft("priorities", arr); }} style={{ width: 14, cursor: "pointer" }} />
                          <span style={{ color: p === "CRITICAL" ? T.red : p === "WARNING" ? T.amber : T.text, fontWeight: 600 }}>{p}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div style={{ gridColumn: "1/-1", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: T.amberL, borderRadius: 8 }}>
                    <span style={{ fontSize: 13 }}>⚠</span>
                    <span style={{ fontSize: 12, color: "#7A4500" }}>Changes take effect on the next escalation run. Active actions already escalated won't be re-triggered.</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {matrix.length === 0 && <div className="card" style={{ padding: 32, textAlign: "center", color: T.text2 }}>No escalation tiers defined. Click <b>+ Add Level</b> to create one.</div>}
      </div>
    </div>
  );
}

function MasterPage({ plants, setPlants, depts, setDepts, users, setUsers, permissions, setPermissions, escMatrix, setEscMatrix, mtgPresets, setMtgPresets }) {
  const [tab, setTab] = useState("users");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const COLORS = ["#272262", "#5B56A6", "#E69903", "#7C80B0", "#1E8449", "#C0392B"];
  const openAdd = t => { setModal({ type: t, mode: "add" }); setForm({}); };
  const openEdit = (t, d) => { setModal({ type: t, mode: "edit" }); setForm({ ...d }); };
  const close = () => { setModal(null); setForm({}); };
  useEscClose(close);
  const saveUser = () => {
    if (!form.name || !form.role || !form.plant) return;
    const u = { ...form, id: form.id || "U" + String(users.length + 1).padStart(2, "0"), initials: form.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase(), color: form.color || COLORS[users.length % 6] };
    if (modal.mode === "edit") setUsers(p => p.map(x => x.id === u.id ? u : x)); else setUsers(p => [...p, u]); close();
  };
  const TABS = [["users", "👥 Users"], ["plants", "🏭 Plants"], ["depts", "🗂 Departments"], ["org", "🌳 Org Chart"], ["perms", "🔐 Permissions"], ["escmatrix", "🚨 Escalation Matrix"], ["presets", "🎙 Meeting Presets"]];

  function OrgNode({ name, allUsers, depth }) {
    const u = allUsers.find(x => x.name === name);
    const reports = allUsers.filter(x => x.superior === name);
    const color = u?.color || T.slate;
    if (depth > 5) return null;
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ background: "#fff", border: `2px solid ${color}`, borderRadius: 12, padding: "10px 14px", textAlign: "center", minWidth: 130, maxWidth: 150, boxShadow: "0 2px 8px rgba(0,0,0,.08)" }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: color + "20", color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, margin: "0 auto 6px" }}>{u?.initials || name?.slice(0, 2).toUpperCase()}</div>
          <div style={{ fontWeight: 700, fontSize: 11, color: T.text, lineHeight: 1.3 }}>{name}</div>
          <div style={{ fontSize: 10, color: T.text2, marginTop: 2 }}>{u?.role}</div>
          {u?.dept && u.dept !== "Management" && <div style={{ fontSize: 9, color: T.text2 }}>{u.dept}</div>}
        </div>
        {reports.length > 0 && (
          <>
            <div style={{ width: 2, height: 18, background: T.border }} />
            <div style={{ display: "flex", alignItems: "flex-start", position: "relative" }}>
              <div style={{ position: "absolute", top: 0, left: "50%", height: 2, background: T.border, transform: "translateX(-50%)", width: `${Math.max((reports.length - 1) * 165, 2)}px` }} />
              {reports.map(r => (
                <div key={r.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 8px" }}>
                  <div style={{ width: 2, height: 18, background: T.border }} />
                  <OrgNode name={r.name} allUsers={allUsers} depth={depth + 1} />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  const roots = users.filter(u => !u.superior || !users.find(x => x.name === u.superior));

  return (
    <div className="fade-in">
      <PageHeader title="Master Setup" sub="Admin only — manage organisation structure" />
      <div style={{ borderBottom: `2px solid ${T.border}`, marginBottom: 24, display: "flex", gap: 4 }}>
        {TABS.map(([id, l]) => <button key={id} onClick={() => setTab(id)} style={{ padding: "9px 20px", border: "none", cursor: "pointer", background: "transparent", fontSize: 13, fontWeight: tab === id ? 700 : 400, color: tab === id ? T.navy : T.text2, borderBottom: tab === id ? `3px solid ${T.navy}` : "3px solid transparent", marginBottom: -2, transition: "all .2s" }}>{l}</button>)}
        {tab !== "org" && <button className="btn btn-amber btn-sm" style={{ marginLeft: "auto", alignSelf: "center" }} onClick={() => openAdd(tab)}>+ Add</button>}
      </div>
      {tab === "users" && <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table><thead><tr><th>User</th><th>Role</th><th>Plant</th><th>Department</th><th>Superior</th><th>Phone</th><th>Email</th><th></th></tr></thead>
          <tbody>{users.map(u => <tr key={u.id}>
            <td><div style={{ display: "flex", alignItems: "center", gap: 10 }}><Avatar name={u.name} size={34} users={users} /><div><div style={{ fontWeight: 600 }}>{u.name}</div></div></div></td>
            <td><span style={{ padding: "3px 9px", borderRadius: 20, background: T.navy + "15", color: T.navy, fontSize: 11, fontWeight: 600 }}>{u.role}</span></td>
            <td style={{ fontSize: 12 }}>{u.plant}</td><td style={{ fontSize: 12 }}>{u.dept}</td>
            <td style={{ fontSize: 12, color: T.text2 }}>{u.superior || "—"}</td>
            <td style={{ fontSize: 12, color: T.text2 }}>{u.phone || "—"}</td>
            <td style={{ fontSize: 12, color: T.text2 }}>{u.email || "—"}</td>
            <td><button className="btn btn-ghost btn-sm" onClick={() => openEdit("users", u)}>Edit</button></td>
          </tr>)}</tbody></table>
      </div>}
      {tab === "plants" && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 14 }}>
        {plants.map(p => <div key={p.id} className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><span style={{ fontSize: 26 }}>🏭</span><button className="btn btn-ghost btn-sm" onClick={() => openEdit("plants", p)}>Edit</button></div>
          <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 14, color: T.navy }}>{p.name}</div>
          <div style={{ fontSize: 12, color: T.text2, marginTop: 2 }}>{p.location}</div>
          <HR /><div style={{ fontSize: 12 }}>Head: <b>{p.head}</b></div>
        </div>)}
      </div>}
      {tab === "depts" && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 14 }}>
        {depts.map(d => <div key={d.id} className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><span style={{ fontSize: 26 }}>{d.icon}</span><button className="btn btn-ghost btn-sm" onClick={() => openEdit("depts", d)}>Edit</button></div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{d.name}</div>
          <div style={{ fontSize: 12, color: T.text2, marginTop: 2 }}>HOD: {d.head}</div>
        </div>)}
      </div>}
      {tab === "org" && <div className="card" style={{ padding: 24, overflowX: "auto" }}>
        <div style={{ minWidth: 900, display: "flex", flexDirection: "column", gap: 32, alignItems: "center" }}>
          {roots.map(u => <div key={u.id} style={{ width: "100%", display: "flex", justifyContent: "center" }}><OrgNode name={u.name} allUsers={users} depth={0} /></div>)}
          {roots.length === 0 && <Empty icon="🌳" title="No org structure" sub="Add users with superior relationships to build the organogram." />}
        </div>
      </div>}

      {tab === "perms" && <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 15, color: T.navy }}>Permission Center</div>
            <div style={{ fontSize: 12, color: T.text2, marginTop: 2 }}>Configure access rights for each user. Admin users always have full access.</div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: T.bg }}>
                <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 700, color: T.text2, fontSize: 12, borderBottom: `1px solid ${T.border}` }}>User</th>
                <th style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700, color: T.text2, fontSize: 12, borderBottom: `1px solid ${T.border}` }}>Edit Meetings</th>
                <th style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700, color: T.text2, fontSize: 12, borderBottom: `1px solid ${T.border}` }}>Create Projects</th>
                <th style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700, color: T.text2, fontSize: 12, borderBottom: `1px solid ${T.border}` }}>Edit Actions</th>
                <th style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700, color: T.text2, fontSize: 12, borderBottom: `1px solid ${T.border}` }}>View Dashboard</th>
                <th style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700, color: T.text2, fontSize: 12, borderBottom: `1px solid ${T.border}` }}>Manage Escalations</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => {
                const isAdmin = u.role === "Admin" || u.role === "MD" || u.role === "Plant Head";
                const perms = permissions?.[u.id] || { canEditMeetings: false, canCreateProjects: false, canEditActions: false, canViewDashboard: true, canManageEscalations: false };
                const toggle = (key) => {
                  if (isAdmin) return;
                  setPermissions && setPermissions(p => ({ ...p, [u.id]: { ...perms, [key]: !perms[key] } }));
                };
                const PermToggle = ({ pkey }) => (
                  <td style={{ padding: "10px 12px", textAlign: "center", borderBottom: `1px solid ${T.border}` }}>
                    {isAdmin
                      ? <span style={{ fontSize: 16 }} title="Admin: always granted">✅</span>
                      : <button onClick={() => toggle(pkey)} style={{ background: perms[pkey] ? T.green : "#e2e8f0", border: "none", borderRadius: 12, width: 42, height: 22, cursor: "pointer", transition: "all .2s", position: "relative" }} title={perms[pkey] ? "Enabled — click to disable" : "Disabled — click to enable"}>
                        <span style={{ position: "absolute", top: 2, left: perms[pkey] ? 22 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.3)", transition: "all .2s", display: "block" }} />
                      </button>
                    }
                  </td>
                );
                return (
                  <tr key={u.id} style={{ background: i % 2 === 0 ? "transparent" : T.bg }}>
                    <td style={{ padding: "10px 16px", borderBottom: `1px solid ${T.border}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 34, height: 34, borderRadius: "50%", background: isAdmin ? T.amber : T.navy, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, flexShrink: 0 }}>{u.name.slice(0, 2).toUpperCase()}</div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{u.name}</div>
                          <div style={{ fontSize: 11, color: T.text2 }}>{u.role} · {u.dept || u.plant}</div>
                        </div>
                        {isAdmin && <span style={{ fontSize: 10, background: T.amber, color: "#fff", borderRadius: 4, padding: "2px 6px", fontWeight: 700, marginLeft: 4 }}>ADMIN</span>}
                      </div>
                    </td>
                    <PermToggle pkey="canEditMeetings" />
                    <PermToggle pkey="canCreateProjects" />
                    <PermToggle pkey="canEditActions" />
                    <PermToggle pkey="canViewDashboard" />
                    <PermToggle pkey="canManageEscalations" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>}

      {tab === "escmatrix" && <EscMatrixTab escMatrix={escMatrix} setEscMatrix={setEscMatrix} />}
      {tab === "presets" && <div className="card" style={{ padding: 20 }}>
        <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 15, color: T.navy, marginBottom: 14 }}>Meeting Presets (Attendees & Guidelines)</div>
        <div style={{ display: "grid", gap: 16 }}>
          {MEETING_TYPES.map(type => (
            <div key={type} className="card" style={{ padding: 16, background: T.bg }}>
              <div style={{ fontWeight: 700, color: T.navy, marginBottom: 10, fontSize: 14 }}>{type}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                <div>
                  <Lbl t="Default Attendees" />
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 150, overflowY: "auto", padding: 8, background: "#fff", border: `1px solid ${T.border}`, borderRadius: 8 }}>
                    {users.map(u => (
                      <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
                        <input type="checkbox" checked={(mtgPresets?.attendeeMap?.[type] || []).includes(u.name)}
                          onChange={e => {
                            const cur = mtgPresets?.attendeeMap?.[type] || [];
                            const next = e.target.checked ? [...cur, u.name] : cur.filter(n => n !== u.name);
                            setMtgPresets(prev => ({ ...prev, attendeeMap: { ...prev.attendeeMap, [type]: next } }));
                          }} />
                        {u.name}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <Lbl t="Default Guidelines / Instructions (one per line)" />
                  <textarea value={(mtgPresets?.instructions?.[type] || []).join("\n")}
                    onChange={e => {
                      const next = e.target.value.split("\n").filter(l => l.trim() !== "");
                      setMtgPresets(prev => ({ ...prev, instructions: { ...prev.instructions, [type]: next } }));
                    }}
                    style={{ fontSize: 12, height: 150, resize: "none" }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>}

      {modal && <div className="overlay" onClick={close}><div className="modal" style={{ width: 520, padding: 28 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ fontFamily: "'Sora',sans-serif", fontSize: 16, fontWeight: 800, color: T.navy }}>{modal.mode === "add" ? "Add" : "Edit"} {modal.type === "users" ? "User" : modal.type === "plants" ? "Plant" : "Department"}</h2>
          <button onClick={close} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 22, color: T.text2 }}>x</button>
        </div>
        {modal.type === "users" && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ gridColumn: "1/-1" }}><Lbl t="Full Name" req /><input value={form.name || ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div><Lbl t="Role" req /><select value={form.role || ""} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}><option value="">Select</option>{["MD", "Plant Head", "HOD", "Shift Engineer", "Supervisor", "Operator"].map(r => <option key={r}>{r}</option>)}</select></div>
          <div><Lbl t="Plant" req /><select value={form.plant || ""} onChange={e => setForm(f => ({ ...f, plant: e.target.value }))}><option value="">Select</option><option>All</option>{plants.map(p => <option key={p.id}>{p.name}</option>)}</select></div>
          <div><Lbl t="Department" /><select value={form.dept || ""} onChange={e => setForm(f => ({ ...f, dept: e.target.value }))}><option value="">Select</option>{depts.map(d => <option key={d.id}>{d.name}</option>)}</select></div>
          <div><Lbl t="Superior (Reports To)" /><select value={form.superior || ""} onChange={e => setForm(f => ({ ...f, superior: e.target.value }))}><option value="">None (Top level)</option>{users.filter(u => u.id !== form.id).map(u => <option key={u.id} value={u.name}>{u.name} ({u.role})</option>)}</select></div>
          <div style={{ gridColumn: "1/-1" }}><Lbl t="Phone Number" /><input value={form.phone || ""} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+91-98000-00000" /></div>
          <div style={{ gridColumn: "1/-1" }}><Lbl t="Email Address" /><input type="email" value={form.email || ""} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="name@company.com" /></div>
          <div style={{ gridColumn: "1/-1", display: "flex", gap: 10, justifyContent: "flex-end" }}><button className="btn btn-ghost" onClick={close}>Cancel</button><button className="btn btn-navy" onClick={saveUser}>Save</button></div>
        </div>}
        {modal.type === "plants" && <div style={{ display: "grid", gap: 12 }}>
          <div><Lbl t="Plant Name" req /><input value={form.name || ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div><Lbl t="Location" /><input value={form.location || ""} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} /></div>
          <div><Lbl t="Plant Head" /><input value={form.head || ""} onChange={e => setForm(f => ({ ...f, head: e.target.value }))} /></div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}><button className="btn btn-ghost" onClick={close}>Cancel</button><button className="btn btn-navy" onClick={() => { if (!form.name) return; const p = { ...form, id: form.id || "P" + String(plants.length + 1) }; if (modal.mode === "edit") setPlants(pp => pp.map(x => x.id === p.id ? p : x)); else setPlants(pp => [...pp, p]); close(); }}>Save</button></div>
        </div>}
        {modal.type === "depts" && <div style={{ display: "grid", gap: 12 }}>
          <div><Lbl t="Dept Name" req /><input value={form.name || ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 10 }}>
            <div><Lbl t="Icon" /><input value={form.icon || ""} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} /></div>
            <div><Lbl t="HOD" /><input value={form.head || ""} onChange={e => setForm(f => ({ ...f, head: e.target.value }))} /></div>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}><button className="btn btn-ghost" onClick={close}>Cancel</button><button className="btn btn-navy" onClick={() => { if (!form.name) return; const d = { ...form, id: form.id || "D" + String(depts.length + 1), icon: form.icon || "🔹" }; if (modal.mode === "edit") setDepts(pp => pp.map(x => x.id === d.id ? d : x)); else setDepts(pp => [...pp, d]); close(); }}>Save</button></div>
        </div>}
      </div></div>}
    </div>
  );
}

/* ===================== API BRIDGE ===================== */
/* Minimal REST-like API bridge — exposes actions data via a global object
   that external apps can read/write via postMessage or window.MCS_API.
   Usage:
     window.MCS_API.getActions()         → all current actions
     window.MCS_API.getAction(id)        → specific action
     window.MCS_API.updateAction(id, patch) → update an action
     window.MCS_API.addAction(action)    → add a new action
   
   Via postMessage (iframe integration):
     window.postMessage({type:"MCS_GET_ACTIONS"},"*")
     → response: {type:"MCS_ACTIONS_RESULT",data:[...]}
   
   This satisfies requirement #6 — API/MCP integration option.
*/
function useAPIBridge(actions, setActions, projects) {
  const actionsRef = useRef(actions);
  useEffect(() => { actionsRef.current = actions; }, [actions]);

  useEffect(() => {
    // Expose global API
    window.MCS_API = {
      version: "1.0.0",
      getActions: () => actionsRef.current,
      getAction: (id) => actionsRef.current.find(a => a.id === id || a.sn === id),
      updateAction: (id, patch) => setActions(p => p.map(a => a.id === id ? { ...a, ...patch } : a)),
      addAction: (action) => setActions(p => [...p, { ...action, id: Date.now(), sn: nextSN(p), created: todayStr(), revisionHistory: [], messages: [], pendingConfirmation: false }]),
      getProjects: () => projects,
    };
    // postMessage bridge
    const handler = (e) => {
      if (!e.data || typeof e.data !== "object") return;
      switch (e.data.type) {
        case "MCS_GET_ACTIONS":
          e.source?.postMessage({ type: "MCS_ACTIONS_RESULT", data: actionsRef.current, ok: true }, "*");
          break;
        case "MCS_GET_ACTION":
          e.source?.postMessage({ type: "MCS_ACTION_RESULT", data: actionsRef.current.find(a => a.id === e.data.id), ok: true }, "*");
          break;
        case "MCS_UPDATE_ACTION":
          setActions(p => p.map(a => a.id === e.data.id ? { ...a, ...e.data.patch } : a));
          e.source?.postMessage({ type: "MCS_UPDATE_OK", id: e.data.id, ok: true }, "*");
          break;
        case "MCS_ADD_ACTION":
          const newA = { ...e.data.action, id: Date.now(), sn: nextSN(actionsRef.current), created: todayStr(), revisionHistory: [], messages: [], pendingConfirmation: false };
          setActions(p => [...p, newA]);
          e.source?.postMessage({ type: "MCS_ADD_OK", action: newA, ok: true }, "*");
          break;
        case "MCS_GET_PROJECTS":
          e.source?.postMessage({ type: "MCS_PROJECTS_RESULT", data: projects, ok: true }, "*");
          break;
        default: break;
      }
    };
    window.addEventListener("message", handler);
    return () => { window.removeEventListener("message", handler); delete window.MCS_API; };
  }, [setActions, projects]);
}

/* ===================== ERROR BOUNDARY ===================== */
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#F5F5FB", padding: 20, textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ fontFamily: "'Sora',sans-serif", fontSize: 20, color: "#272262", marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: "#636E72", fontSize: 13, maxWidth: 400, marginBottom: 20, lineHeight: 1.5 }}>{this.state.error?.message || "An unexpected error occurred."}</p>
          <button className="btn btn-navy" onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}>Reload Application</button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ===================== ROOT APP ===================== */
export default function App() {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem("mcs_session_user");
      return saved ? JSON.parse(saved) : null;
    } catch (e) { return null; }
  });
  const [audit, setAudit] = useState([]);
  const [page, setPage] = useState(() => {
    const saved = localStorage.getItem("mcs_session_page");
    return saved ? parseInt(saved, 10) || 0 : 0;
  });
  const [showQuickAdd, setShowQuickAdd] = useState(false);

  // ── Google Sheet live database ──
  const {
    dbReady, dbError, fetchData,
    users, setUsers,
    plants, setPlants,
    depts, setDepts,
    actions, setActions,
    meetings, setMeetings,
    projects, setProjects,
    escMatrix, setEscMatrix,
    permissions, setPermissions,
    mtgPresets, setMtgPresets
  } = useSheetDB({
    defaultUsers: DEFAULT_USERS,
    defaultPlants: DEFAULT_PLANTS,
    defaultDepts: DEFAULT_DEPTS,
    defaultActions: SEED_ACTIONS,
    defaultMeetings: SEED_MEETINGS,
    defaultProjects: SEED_PROJECTS,
    defaultEscMatrix: DEFAULT_ESC_MATRIX,
    defaultPermissions: DEFAULT_PERMISSIONS_SEED(),
    defaultPresets: { attendeeMap: ATTENDEE_MAP, instructions: MTG_INSTRUCTIONS }
  });
  // Global active meeting — persists across page navigation
  const [globalActiveMtg, setGlobalActiveMtg] = useState(null);
  // Global meeting runtime state — persists when user navigates away from Work page
  const [mtgRunning, setMtgRunning] = useState(false);
  const [mtgElapsed, setMtgElapsed] = useState(0);
  const [mtgTxLines, setMtgTxLines] = useState([]);
  const [mtgFastActions, setMtgFastActions] = useState([]);
  const [mtgInsights, setMtgInsights] = useState([]);
  const mtgTxLineNo = useRef(0);
  const mtgTimerRef = useRef(null);
  const mtgTxRef = useRef(null);

  // Persist session
  useEffect(() => {
    if (user) localStorage.setItem("mcs_session_user", JSON.stringify(user));
    else localStorage.removeItem("mcs_session_user");
  }, [user]);
  useEffect(() => {
    localStorage.setItem("mcs_session_page", page);
  }, [page]);

  // Global timer only — transcript now driven by real STT inside MeetingRoom
  useEffect(() => {
    if (mtgRunning && globalActiveMtg) {
      mtgTimerRef.current = setInterval(() => setMtgElapsed(e => e + 1), 1000);
    } else {
      clearInterval(mtgTimerRef.current);
    }
    return () => clearInterval(mtgTimerRef.current);
  }, [mtgRunning, globalActiveMtg]);

  // Reset meeting state when meeting ends
  const clearMeetingState = () => {
    setGlobalActiveMtg(null); setMtgRunning(false); setMtgElapsed(0);
    setMtgTxLines([]); setMtgFastActions([]); setMtgInsights([]); mtgTxLineNo.current = 0;
  };

  useAPIBridge(actions, setActions, projects);

  useEffect(() => {
    const t = setTimeout(() => runEscalation(actions, setAudit, escMatrix), 1500);
    return () => clearTimeout(t);
  }, [actions]);

  const commitFinal = rows => {
    setActions(p => {
      const withSN = rows.map((r, i) => ({ ...r, sn: nextSN([...p, ...rows.slice(0, i)]), id: Date.now() + i, messages: r.messages || [], revisionHistory: r.revisionHistory || [], pendingConfirmation: false, allocatedBy: r.allocatedBy || user?.name || "" }));
      return [...p, ...withSN];
    });
  };
  const updateAction = (id, patch) => setActions(p => p.map(a => {
    if (a.id !== id) return a;
    if (patch.due && patch.due !== a.due) {
      const rev = { date: todayStr(), from: a.due, to: patch.due, by: user?.name || "Unknown" };
      return { ...a, ...patch, revisions: (a.revisions || 0) + 1, revisionHistory: [...(a.revisionHistory || []), rev] };
    }
    return { ...a, ...patch };
  }));

  const pendingForMe = actions.filter(a => {
    if (!a.pendingConfirmation) return false;
    const allocatorU = users.find(u => u.name === a.allocatedBy);
    const allocSuperior = allocatorU?.superior ? users.find(u => u.name === allocatorU.superior) : null;
    return user?.name === a.allocatedBy || user?.name === allocSuperior?.name || user?.role === "Admin";
  }).length;

  // Notification system
  const { notifs, unread: unreadNotifs, markAllRead, markRead } = useNotifications(actions, audit, user);

  // UI modals/panels
  const [showSupport, setShowSupport] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showAdminNotifs, setShowAdminNotifs] = useState(false);

  // Loading screen while sheet initializes
  if (!dbReady) return (
    <ErrorBoundary>
      <style>{CSS}</style>
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: `linear-gradient(135deg,${T.navy} 0%,#3D378C 100%)`, gap: 16 }}>
        <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 22, color: "#fff" }}>Management Control System</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "rgba(255,255,255,.7)", fontSize: 13 }}>
          <span style={{ width: 18, height: 18, border: "2px solid rgba(255,255,255,.5)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} />
          {SHEET_ENABLED ? "Connecting to Google Sheet…" : "Loading…"}
        </div>
        {dbError && <div style={{ fontSize: 11, color: "#FEF3CD", marginTop: 4 }}>⚠ Sheet unavailable — using local data</div>}
      </div>
    </ErrorBoundary>
  );

  if (!user) return (<ErrorBoundary><style>{CSS}</style><LoginPage onLogin={acc => { setUser(acc); setPage(0); }} /></ErrorBoundary>);

  return (
    <ErrorBoundary>
      <style>{CSS}</style>
      <Shell page={page} setPage={setPage} user={user} onLogout={() => { setUser(null); setPage(0); clearMeetingState(); }} onQuickAdd={() => setShowQuickAdd(true)} pendingCount={pendingForMe} auditCount={audit.length} activeMtg={globalActiveMtg} onResumeActiveMtg={() => setPage(1)} mtgRunning={mtgRunning} mtgElapsed={mtgElapsed} notifications={notifs} unreadCount={unreadNotifs} onMarkAllRead={markAllRead} users={users} actions={actions} onShowSupport={() => setShowSupport(true)} onShowProfile={() => setShowProfile(true)} onShowAdminNotifs={() => setShowAdminNotifs(true)}>
        {page === 0 && <HomePage actions={actions} setActions={setActions} user={user} setPage={setPage} users={users} meetings={meetings} plants={plants} depts={depts} setGlobalActiveMtg={m => { setGlobalActiveMtg(m); setMtgRunning(true); }} />}
        {page === 1 && <WorkPage plants={plants} depts={depts} users={users} onCommitFinal={rows => { commitFinal(rows); clearMeetingState(); }} actions={actions} setActions={setActions} user={user} onProjectUpdate={updated => setProjects(p => p.map(x => x.id === updated.id ? updated : x))} allProjects={projects} setProjects={setProjects} allMeetings={meetings} setMeetings={setMeetings} permissions={permissions} setPage={setPage} globalActiveMtg={globalActiveMtg} setGlobalActiveMtg={m => { setGlobalActiveMtg(m); if (m) setMtgRunning(true); }} mtgRunning={mtgRunning} setMtgRunning={setMtgRunning} mtgElapsed={mtgElapsed} mtgTxLines={mtgTxLines} setMtgTxLines={setMtgTxLines} mtgFastActions={mtgFastActions} setMtgFastActions={setMtgFastActions} mtgInsights={mtgInsights} setMtgInsights={setMtgInsights} clearMeetingState={clearMeetingState} />}
        {page === 2 && <ActionsPage actions={actions} setActions={setActions} plants={plants} depts={depts} users={users} user={user} projects={projects} />}
        {page === 3 && <DashboardPage actions={actions} plants={plants} depts={depts} users={users} audit={audit} user={user} meetings={meetings} onViewEscalations={() => setPage(4)} refreshData={fetchData} setActions={setActions} />}
        {page === 4 && <EscalationsPage actions={actions} audit={audit} user={user} setPage={setPage} users={users} plants={plants} setActions={setActions} />}
        {page === 99 && user?.role === "Admin" && <MasterPage plants={plants} setPlants={setPlants} depts={depts} setDepts={setDepts} users={users} setUsers={setUsers} permissions={permissions} setPermissions={setPermissions} escMatrix={escMatrix} setEscMatrix={setEscMatrix} mtgPresets={mtgPresets} setMtgPresets={setMtgPresets} />}
      </Shell>
      {showSupport && <SupportModal user={user} onClose={() => setShowSupport(false)} />}
      {showProfile && <UserProfilePanel user={user} users={users} actions={actions} onClose={() => setShowProfile(false)} />}
      {showAdminNotifs && user?.role === "Admin" && <AdminNotifManager users={users} onClose={() => setShowAdminNotifs(false)} />}
      {showQuickAdd && (
        <AddActionPanel
          users={users} plants={plants} depts={depts}
          defaultPlant={user?.plant === "All" ? "" : user?.plant}
          defaultSrc="Quick Add"
          projects={projects}
          currentUser={user}
          onSave={a => {
            const newAction = { ...a, id: Date.now(), sn: nextSN(actions), dateOfAction: todayStr(), revisions: 0, revisionHistory: [], created: todayStr(), closedOn: null, status: "IN PROCESS", messages: [], pendingConfirmation: false, allocatedBy: user?.name || "" };
            setActions(p => [...p, newAction]);
            setShowQuickAdd(false);
          }}
          onClose={() => setShowQuickAdd(false)}
        />
      )}
    </ErrorBoundary>
  );
}
