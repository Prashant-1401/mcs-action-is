import os
from typing import Dict, Any, List, Optional
import gspread
from google.oauth2.service_account import Credentials
from app.config import settings

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

SHEET_HEADERS = ["SN", "Text", "Responsible", "Responsible Email", "Responsible Phone", "Due Date", "Status", "Priority", "Plant", "Department", "Created"]


def _is_configured() -> bool:
    return bool(settings.google_sheets_credentials_path and settings.google_sheets_spreadsheet_id)


def _get_client() -> Optional[gspread.Client]:
    if not _is_configured():
        return None
    creds_path = settings.google_sheets_credentials_path
    if not os.path.exists(creds_path):
        print(f"[google-sheets] Credentials file not found: {creds_path}")
        return None
    try:
        creds = Credentials.from_service_account_file(creds_path, scopes=SCOPES)
        return gspread.authorize(creds)
    except Exception as e:
        print(f"[google-sheets] Auth failed: {e}")
        return None


def _get_worksheet(client: gspread.Client) -> Optional[gspread.Worksheet]:
    try:
        spreadsheet = client.open_by_key(settings.google_sheets_spreadsheet_id)
        try:
            worksheet = spreadsheet.worksheet(settings.google_sheets_worksheet_name)
        except gspread.exceptions.WorksheetNotFound:
            worksheet = spreadsheet.add_worksheet(
                title=settings.google_sheets_worksheet_name,
                rows=1000,
                cols=len(SHEET_HEADERS),
            )
            worksheet.update(range_name="A1", values=[SHEET_HEADERS])
            worksheet.format("A1:K1", {"textFormat": {"bold": True}})
            print(f"[google-sheets] Created worksheet '{settings.google_sheets_worksheet_name}' with headers")
        return worksheet
    except Exception as e:
        print(f"[google-sheets] Failed to get worksheet: {e}")
        return None


def _action_to_row(action: Dict[str, Any]) -> List[str]:
    return [
        str(action.get("sn", "")),
        str(action.get("text", "")),
        str(action.get("responsible", "")),
        str(action.get("responsible_email", "") or ""),
        str(action.get("responsible_phone", "") or ""),
        str(action.get("due", "") or ""),
        str(action.get("status", "")),
        str(action.get("priority", "")),
        str(action.get("plant", "") or ""),
        str(action.get("dept", "") or ""),
        str(action.get("created", "") or ""),
    ]


def _find_row_by_sn(worksheet: gspread.Worksheet, sn: str) -> Optional[int]:
    try:
        sn_cells = worksheet.find(sn)
        if sn_cells:
            return sn_cells.row
    except gspread.exceptions.CellNotFound:
        return None
    return None


def sync_action_to_sheet(action: Dict[str, Any]) -> bool:
    if not _is_configured():
        return False
    client = _get_client()
    if not client:
        return False
    worksheet = _get_worksheet(client)
    if not worksheet:
        return False
    try:
        sn = action.get("sn", "")
        if not sn:
            print("[google-sheets] No SN provided, skipping sync")
            return False
        row_data = _action_to_row(action)
        existing_row = _find_row_by_sn(worksheet, sn)
        if existing_row:
            worksheet.update(range_name=f"A{existing_row}:K{existing_row}", values=[row_data])
            print(f"[google-sheets] Updated row {existing_row} for action {sn}")
        else:
            worksheet.append_row(row_data, value_input_option="USER_ENTERED")
            print(f"[google-sheets] Appended action {sn}")
        return True
    except Exception as e:
        print(f"[google-sheets] Sync failed for action {action.get('sn', '?')}: {e}")
        return False


def sync_all_actions(actions: List[Dict[str, Any]]) -> bool:
    if not _is_configured():
        return False
    client = _get_client()
    if not client:
        return False
    worksheet = _get_worksheet(client)
    if not worksheet:
        return False
    try:
        existing_rows = worksheet.get_all_values()
        if len(existing_rows) > 1:
            worksheet.delete_rows(2, len(existing_rows))
        if not actions:
            print("[google-sheets] No actions to sync")
            return True
        rows = [_action_to_row(a) for a in actions]
        worksheet.update(range_name=f"A2:K{len(rows) + 1}", values=rows)
        print(f"[google-sheets] Full sync completed: {len(rows)} actions")
        return True
    except Exception as e:
        print(f"[google-sheets] Full sync failed: {e}")
        return False
