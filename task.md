# Task: Remove Google Sheets → PostgreSQL Primary

## Backend
- [x] Update EscalationMatrix model — add `from_role`, `target_role`, `priorities`, `superiors`
- [x] Update EscalationMatrix schema
- [x] Add `POST /api/plants/bulk`
- [x] Add `POST /api/departments/bulk`
- [x] Add `POST /api/machines/bulk`
- [x] Add `POST /api/roles/bulk`
- [x] Add `POST /api/users/bulk`
- [x] Add `POST /api/reasons/bulk`
- [x] Add `POST /api/actions/bulk`
- [ ] Add `POST /api/escalation/matrix/bulk`
- [ ] Add `POST /api/meetings/presets/bulk`

## Frontend App.jsx
- [x] Remove Sheet config constants (SHEET_ID, SHEET_SCRIPT_URL, SHEET_ENABLED)
- [x] Remove Sheet helpers (sheetGet, sheetPost, parseCsv, parseCsvRow, cleanRow)
- [x] Add API config + helpers (apiGet, apiPost, apiPatch, normKeys, denormKeys)
- [x] Add `usePostgresDB` hook (replaces `useSheetDB`)
- [x] Update `LoginPage` — use `POST /api/auth/login` instead of Sheet CSV
- [x] Update root `App()` — use `usePostgresDB()` instead of `useSheetDB()`
- [x] Update `MasterPage.saveToSheet` → `saveToAPI` (bulk endpoints)
- [x] Update loading screen text
