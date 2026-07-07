/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  MCS — Google Apps Script (Code.gs)
 *  Management Control System — Sheet Backend
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Deployment:
 *    1. Open Google Sheet → Extensions → Apps Script
 *    2. Paste this entire file into Code.gs
 *    3. Deploy → New Deployment → Web App
 *       - Execute as: Me
 *       - Who has access: Anyone
 *    4. Copy the deployment URL → paste into VITE_SHEET_SCRIPT_URL in .env
 *
 *  Supported Actions (sent via POST from frontend):
 *    • replace_all  — Clears the target tab and writes all rows fresh
 *    • append_all   — Appends rows to the target tab (deduplicates by id)
 *
 *  Request body shape:
 *    { action: "replace_all"|"append_all", tab: "TabName", rows: [...] }
 *
 *  All 13 tabs supported:
 *    Users, Plants, Departments, Actions, Meetings, Projects,
 *    EscalationMatrix, Permissions, MeetingPresets, Machines, Reasons, Audit, Roles
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ── Configuration ─────────────────────────────────────────────────────────
// All valid tab names the frontend can write to
const ALLOWED_TABS = [
  "Users", "Plants", "Departments", "Actions", "Meetings",
  "Projects", "EscalationMatrix", "Permissions", "MeetingPresets",
  "Machines", "Reasons", "Audit", "Roles"
];

// ── Entry Points ──────────────────────────────────────────────────────────

/**
 * doPost — Handles all write requests from the MCS frontend.
 * Content-Type from frontend is "text/plain" (to avoid CORS preflight).
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const tab    = body.tab;
    const rows   = body.rows;

    // Validate tab name
    if (!tab || !ALLOWED_TABS.includes(tab)) {
      return jsonResponse({ ok: false, error: "Invalid or missing tab: " + tab });
    }

    // Validate rows
    if (!rows) {
      return jsonResponse({ ok: false, error: "Missing 'rows' in request body" });
    }

    // Route to action handler
    switch (action) {
      case "replace_all":
        return handleReplaceAll(tab, rows);
      case "append_all":
        return handleAppendAll(tab, rows);
      default:
        return jsonResponse({ ok: false, error: "Unknown action: " + action });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: "Server error: " + err.message });
  }
}

/**
 * doGet — Simple health check (also required for Web App deployment).
 */
function doGet(e) {
  return jsonResponse({
    ok: true,
    message: "MCS Google Apps Script is running",
    tabs: ALLOWED_TABS,
    timestamp: new Date().toISOString()
  });
}

// ── Action Handlers ───────────────────────────────────────────────────────

/**
 * replace_all — Clears all data rows in the tab, then writes fresh rows.
 * Preserves the header row. If rows is an object (Permissions), converts
 * to array first.
 */
function handleReplaceAll(tab, rows) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(tab);

  // Auto-create tab if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet(tab);
  }

  // Normalise: if rows is an object (e.g. Permissions keyed by id), convert to array
  let rowArray = rows;
  if (!Array.isArray(rows)) {
    rowArray = Object.values(rows);
  }

  // Filter out empty/null rows
  rowArray = rowArray.filter(r => r && typeof r === "object" && Object.keys(r).length > 0);

  if (rowArray.length === 0) {
    // Clear data but keep header
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, sheet.getMaxColumns()).clearContent();
    }
    return jsonResponse({ ok: true, action: "replace_all", tab: tab, rowsWritten: 0 });
  }

  // Build unified header from all rows (union of all keys across all rows)
  // Preserve existing header order if present, append new columns at end
  const existingHeaders = getExistingHeaders(sheet);
  const allKeys = buildUnifiedHeaders(existingHeaders, rowArray);

  // Build 2D data array
  const dataMatrix = rowArray.map(row => {
    return allKeys.map(key => {
      const val = row[key];
      if (val === undefined || val === null) return "";
      // Stringify arrays/objects for storage in cells
      if (typeof val === "object") return JSON.stringify(val);
      return val;
    });
  });

  // Clear entire sheet and rewrite
  sheet.clearContents();

  // Write header row
  sheet.getRange(1, 1, 1, allKeys.length).setValues([allKeys]);
  // Bold + freeze header
  sheet.getRange(1, 1, 1, allKeys.length).setFontWeight("bold");
  sheet.setFrozenRows(1);

  // Write data rows
  if (dataMatrix.length > 0) {
    sheet.getRange(2, 1, dataMatrix.length, allKeys.length).setValues(dataMatrix);
  }

  return jsonResponse({ ok: true, action: "replace_all", tab: tab, rowsWritten: dataMatrix.length });
}

/**
 * append_all — Appends rows to a tab, skipping rows whose 'id' already
 * exists. Used for Audit trail (never lose history).
 *
 * Deduplication: compares incoming row.id against existing ids in column A
 * (or whichever column is headed "id"). Rows with matching id are skipped.
 * Rows without an id field are always appended.
 */
function handleAppendAll(tab, rows) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(tab);

  // Auto-create tab if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet(tab);
  }

  let rowArray = Array.isArray(rows) ? rows : Object.values(rows);
  rowArray = rowArray.filter(r => r && typeof r === "object" && Object.keys(r).length > 0);

  if (rowArray.length === 0) {
    return jsonResponse({ ok: true, action: "append_all", tab: tab, rowsAppended: 0, skipped: 0 });
  }

  // Get existing headers or create them
  let existingHeaders = getExistingHeaders(sheet);
  const allKeys = buildUnifiedHeaders(existingHeaders, rowArray);

  // If sheet is empty (no headers), write header row first
  if (existingHeaders.length === 0) {
    sheet.getRange(1, 1, 1, allKeys.length).setValues([allKeys]);
    sheet.getRange(1, 1, 1, allKeys.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  } else if (allKeys.length > existingHeaders.length) {
    // New columns discovered — extend header row
    sheet.getRange(1, 1, 1, allKeys.length).setValues([allKeys]);
  }

  // Build set of existing IDs for deduplication
  const existingIds = getExistingIds(sheet, allKeys);

  // Filter out rows with duplicate IDs
  const newRows = [];
  let skipped = 0;
  rowArray.forEach(row => {
    // For Audit, deduplicate by sn + level combo
    const rowId = row.id !== undefined && row.id !== null && String(row.id).trim()
      ? String(row.id).trim()
      : null;
    const snLevel = (row.sn && row.level !== undefined) ? row.sn + "_" + row.level : null;

    if (rowId && existingIds.has(rowId)) {
      skipped++;
    } else if (snLevel && existingIds.has(snLevel)) {
      skipped++;
    } else {
      newRows.push(row);
      if (rowId) existingIds.add(rowId);
      if (snLevel) existingIds.add(snLevel);
    }
  });

  if (newRows.length === 0) {
    return jsonResponse({ ok: true, action: "append_all", tab: tab, rowsAppended: 0, skipped: skipped });
  }

  // Build data matrix for new rows
  const dataMatrix = newRows.map(row => {
    return allKeys.map(key => {
      const val = row[key];
      if (val === undefined || val === null) return "";
      if (typeof val === "object") return JSON.stringify(val);
      return val;
    });
  });

  // Append after last row
  const lastRow = Math.max(sheet.getLastRow(), 1);
  sheet.getRange(lastRow + 1, 1, dataMatrix.length, allKeys.length).setValues(dataMatrix);

  return jsonResponse({ ok: true, action: "append_all", tab: tab, rowsAppended: dataMatrix.length, skipped: skipped });
}

// ── Utility Functions ─────────────────────────────────────────────────────

/**
 * Get existing header row from sheet. Returns empty array if sheet is empty.
 */
function getExistingHeaders(sheet) {
  if (sheet.getLastRow() < 1) return [];
  const headerRange = sheet.getRange(1, 1, 1, sheet.getLastColumn());
  const headers = headerRange.getValues()[0];
  return headers.map(h => String(h).trim()).filter(h => h !== "");
}

/**
 * Build a unified header array from existing headers + all keys in new rows.
 * Preserves existing column order, appends new keys at end.
 */
function buildUnifiedHeaders(existingHeaders, rowArray) {
  const ordered = [...existingHeaders];
  const seen = new Set(existingHeaders.map(h => h.toLowerCase()));

  rowArray.forEach(row => {
    Object.keys(row).forEach(key => {
      const trimmed = key.trim();
      if (trimmed && !seen.has(trimmed.toLowerCase())) {
        ordered.push(trimmed);
        seen.add(trimmed.toLowerCase());
      }
    });
  });

  return ordered;
}

/**
 * Get all existing IDs from a sheet for deduplication.
 * Checks both "id" column values and "sn"+"level" combos (for Audit).
 */
function getExistingIds(sheet, headers) {
  const ids = new Set();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return ids;

  // Find column indices
  const idCol   = headers.indexOf("id");
  const snCol   = headers.indexOf("sn");
  const lvlCol  = headers.indexOf("level");

  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  data.forEach(row => {
    // By id
    if (idCol >= 0) {
      const val = String(row[idCol] || "").trim();
      if (val) ids.add(val);
    }
    // By sn + level combo
    if (snCol >= 0 && lvlCol >= 0) {
      const sn  = String(row[snCol] || "").trim();
      const lvl = String(row[lvlCol] || "").trim();
      if (sn && lvl) ids.add(sn + "_" + lvl);
    }
  });

  return ids;
}

/**
 * Return a JSON ContentService response (required for GAS Web App).
 */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Setup Helper (run once manually) ──────────────────────────────────────

/**
 * Run this function once (manually in Apps Script editor) to create
 * all 12 tabs with their header rows. Safe to re-run — won't overwrite
 * existing tabs that already have data.
 */
function setupAllTabs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const TAB_HEADERS = {
    "Users":            ["id", "name", "username", "password", "role", "plant", "dept", "superior", "phone", "email", "initials", "color"],
    "Plants":           ["id", "name", "location", "head"],
    "Departments":      ["id", "name", "plant", "head", "icon"],
    "Actions":          ["id", "sn", "text", "responsible", "due", "status", "priority", "section", "source", "plant", "dept", "machine", "reason", "remarks", "dateOfAction", "created", "closedOn", "closedBy", "revisions", "revisionHistory", "messages", "pendingConfirmation", "allocatedBy", "project", "src", "reasonOfAction", "machineName", "actionPointType"],
    "Meetings":         ["id", "type", "plant", "date", "status", "attendees", "duration", "actionCount", "notes", "name", "time", "dur", "facilitator", "recurring", "recurrence", "project", "completedSessions"],
    "Projects":         ["id", "name", "plant", "dept", "status", "owner", "startDate", "endDate", "progress", "description", "start", "end", "priority", "objective", "scope", "budget", "sponsor", "milestones", "risks", "team"],
    "EscalationMatrix": ["id", "level", "label", "overdueDays", "overdueHrs", "target", "hierarchyOffset", "notifyMethod", "priorities", "applicableTo", "color", "active", "description"],
    "Permissions":      ["id", "name", "canEditMeetings", "canCreateProjects", "canEditActions", "canViewDashboard", "canManageEscalations"],
    "MeetingPresets":   ["type", "attendees", "instructions"],
    "Machines":         ["id", "name", "plant", "dept", "type", "assetNo"],
    "Reasons":          ["id", "text", "category"],
    "Audit":            ["id", "ts", "sn", "text", "level", "target", "reason"],
    "Roles":            ["id", "name", "level"]
  };

  Object.keys(TAB_HEADERS).forEach(tabName => {
    let sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      Logger.log("Created tab: " + tabName);
    }

    // Only write headers if the sheet is empty
    if (sheet.getLastRow() === 0) {
      const headers = TAB_HEADERS[tabName];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
      sheet.setFrozenRows(1);
      Logger.log("Headers written for: " + tabName);
    } else {
      Logger.log("Skipped (already has data): " + tabName);
    }
  });

  Logger.log("✅ Setup complete — all 13 tabs ready.");
}
