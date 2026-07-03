"""
email_escalation.py  —  MCS Action Log · Escalation Email Route
================================================================
Mount this in your main FastAPI app:

    from email_escalation import router as email_router
    app.include_router(email_router)

Required environment variables (set in Render dashboard or .env):
    SMTP_HOST       e.g. smtp.gmail.com  /  smtp.office365.com
    SMTP_PORT       587  (STARTTLS)  or  465  (SSL)
    SMTP_USER       sender address   e.g. mcs-alerts@yourcompany.com
    SMTP_PASSWORD   app password (Gmail) or account password (Outlook)
    SMTP_FROM_NAME  display name     e.g. "MCS Action System"  [optional]
    ADMIN_EMAILS    comma-separated admin CC list  e.g. admin@co.com,md@co.com
"""

import os
import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Config ────────────────────────────────────────────────────────────────────
SMTP_HOST      = os.getenv("SMTP_HOST", os.getenv("SMTP_SERVER", "smtp.gmail.com"))
SMTP_PORT      = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER      = os.getenv("SMTP_USER", "")
SMTP_PASSWORD  = os.getenv("SMTP_PASSWORD", os.getenv("SMTP_PASS", ""))
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "MCS Action System")
ADMIN_EMAILS   = [e.strip() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()]

# Shares the same API_KEY as main.py — set once in Render env.
API_KEY = os.getenv("API_KEY", "")

async def require_api_key(x_api_key: Optional[str] = Header(None)):
    if not API_KEY:
        return
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


# ── Pydantic schemas ──────────────────────────────────────────────────────────
class ActionItem(BaseModel):
    sn:          str  = ""
    text:        str  = ""
    responsible: str  = ""
    due:         str  = ""
    priority:    str  = "NORMAL"
    status:      str  = ""
    plant:       str  = ""
    dept:        str  = ""
    section:     str  = ""

class UserInfo(BaseModel):
    name:     str = ""
    email:    str = ""
    role:     str = ""
    superior: str = ""

class EscalatePayload(BaseModel):
    level:        int
    target:       str
    tierLabel:    str  = ""
    actions:      list[ActionItem]
    # Users list — passed from React so we can resolve emails server-side
    users:        list[UserInfo] = []
    # Admin CC list override (optional, falls back to env var)
    adminEmails:  list[str] = []


# ── Helpers ───────────────────────────────────────────────────────────────────
LEVEL_COLORS = {1: "#E69903", 2: "#E67E22", 3: "#C0392B", 4: "#7B241C"}
LEVEL_LABELS = {1: "Level 1", 2: "Level 2", 3: "Level 3 — Plant Head", 4: "Level 4 — MD"}
PRIORITY_COLORS = {"CRITICAL": "#C0392B", "WARNING": "#E67E22", "NORMAL": "#1A6B8A"}


def get_superior_chain_emails(responsible_name: str, users: list[UserInfo]) -> list[str]:
    """Walk the superior chain of `responsible_name` and collect email addresses."""
    user_map = {u.name: u for u in users}
    emails = []
    visited = set()
    cur = user_map.get(responsible_name)
    # Start from the responsible person's direct superior (not themselves)
    if cur:
        cur = user_map.get(cur.superior, None)
    while cur and cur.name not in visited:
        visited.add(cur.name)
        if cur.email:
            emails.append(cur.email)
        cur = user_map.get(cur.superior, None)
    return emails


def build_html(payload: EscalatePayload) -> str:
    level_color = LEVEL_COLORS.get(payload.level, "#636E72")
    level_label = payload.tierLabel or LEVEL_LABELS.get(payload.level, f"Level {payload.level}")
    rows_html = ""
    for a in payload.actions:
        pri_color = PRIORITY_COLORS.get(a.priority, "#636E72")
        rows_html += f"""
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;color:#636E72;white-space:nowrap">{a.sn}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:13px;max-width:320px">{a.text}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:12px;white-space:nowrap">{a.responsible or "—"}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:12px;white-space:nowrap;color:#C0392B;font-weight:600">{a.due or "—"}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eee">
            <span style="background:{pri_color}22;color:{pri_color};padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700">{a.priority}</span>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:12px;color:#636E72">{a.plant or a.dept or a.section or "—"}</td>
        </tr>"""

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F5FB;font-family:'Inter',Arial,sans-serif">
  <div style="max-width:680px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#272262,#3D378C);padding:28px 32px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
        <div style="width:40px;height:40px;border-radius:50%;background:{level_color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;flex-shrink:0">L{payload.level}</div>
        <div>
          <div style="font-size:11px;color:rgba(255,255,255,.6);letter-spacing:1px;text-transform:uppercase;margin-bottom:2px">Escalation Alert</div>
          <div style="font-size:18px;font-weight:800;color:#fff">{level_label}</div>
        </div>
      </div>
      <div style="font-size:13px;color:rgba(255,255,255,.7);margin-top:10px">
        {len(payload.actions)} action{"s" if len(payload.actions) != 1 else ""} {"require" if len(payload.actions) != 1 else "requires"} your attention · escalated to <b style="color:#fff">{payload.target}</b>
      </div>
    </div>

    <!-- Body -->
    <div style="padding:24px 32px">
      <p style="margin:0 0 18px;font-size:14px;color:#1A1532;line-height:1.6">
        The following actions have passed their due dates and have been escalated.
        Please review and take appropriate action.
      </p>

      <!-- Table -->
      <div style="overflow-x:auto;border-radius:10px;border:1.5px solid #E8E8F0">
        <table style="width:100%;border-collapse:collapse;min-width:520px">
          <thead>
            <tr style="background:#FAFAFE">
              <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#636E72;text-align:left;border-bottom:2px solid #E8E8F0;white-space:nowrap">SN</th>
              <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#636E72;text-align:left;border-bottom:2px solid #E8E8F0">Action</th>
              <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#636E72;text-align:left;border-bottom:2px solid #E8E8F0;white-space:nowrap">Responsible</th>
              <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#636E72;text-align:left;border-bottom:2px solid #E8E8F0;white-space:nowrap">Due Date</th>
              <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#636E72;text-align:left;border-bottom:2px solid #E8E8F0">Priority</th>
              <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#636E72;text-align:left;border-bottom:2px solid #E8E8F0">Plant / Dept</th>
            </tr>
          </thead>
          <tbody>{rows_html}</tbody>
        </table>
      </div>

      <div style="margin-top:22px;padding:14px 16px;background:#FEF3CD;border-radius:10px;border:1px solid #F5C84240;font-size:12px;color:#7A4500">
        ⚠ These actions remain open. Log in to the Management Control System to update status or reassign ownership.
      </div>
    </div>

    <!-- Footer -->
    <div style="padding:16px 32px;border-top:1.5px solid #E8E8F0;display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:11px;color:#B2BEC3">Adroit × Signet · Management Control System</div>
      <div style="font-size:11px;color:#B2BEC3">This is an automated escalation alert</div>
    </div>

  </div>
</body>
</html>"""


def send_email(to: list[str], cc: list[str], subject: str, html: str) -> None:
    """Send via SMTP STARTTLS (port 587) or SSL (port 465)."""
    if not SMTP_USER or not SMTP_PASSWORD:
        raise RuntimeError("SMTP credentials not configured (SMTP_USER / SMTP_PASSWORD env vars missing)")

    to_clean  = [e for e in to  if e and "@" in e]
    cc_clean  = [e for e in cc  if e and "@" in e]
    all_recip = list(dict.fromkeys(to_clean + cc_clean))  # dedup, preserve order

    if not all_recip:
        logger.warning("No valid recipient emails — skipping send")
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"{SMTP_FROM_NAME} <{SMTP_USER}>"
    msg["To"]      = ", ".join(to_clean)
    if cc_clean:
        msg["Cc"]  = ", ".join(cc_clean)
    msg.attach(MIMEText(html, "html", "utf-8"))

    if SMTP_PORT == 465:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT) as s:
            s.login(SMTP_USER, SMTP_PASSWORD)
            s.sendmail(SMTP_USER, all_recip, msg.as_string())
    else:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
            s.ehlo()
            s.starttls()
            s.login(SMTP_USER, SMTP_PASSWORD)
            s.sendmail(SMTP_USER, all_recip, msg.as_string())


# ── Route ─────────────────────────────────────────────────────────────────────
@router.post("/api/email/escalate", dependencies=[Depends(require_api_key)])
async def escalate_email(payload: EscalatePayload):
    if not payload.actions:
        return {"ok": False, "error": "No actions in payload"}

    # Collect TO: responsible persons' superior chains (per action)
    to_emails: set[str] = set()
    for action in payload.actions:
        chain = get_superior_chain_emails(action.responsible, payload.users)
        to_emails.update(chain)

    # CC: admin list (payload override takes priority, else env var)
    cc_emails = list(dict.fromkeys(
        (payload.adminEmails if payload.adminEmails else ADMIN_EMAILS)
    ))

    level_label = payload.tierLabel or LEVEL_LABELS.get(payload.level, f"Level {payload.level}")
    subject = (
        f"[MCS Escalation] {level_label} — "
        f"{len(payload.actions)} Action{'s' if len(payload.actions) != 1 else ''} Overdue"
    )

    html = build_html(payload)

    try:
        send_email(list(to_emails), cc_emails, subject, html)
        logger.info(
            "Escalation email sent | level=%d | to=%s | cc=%s | actions=%d",
            payload.level, list(to_emails), cc_emails, len(payload.actions)
        )
        return {"ok": True, "to": list(to_emails), "cc": cc_emails}
    except Exception as e:
        logger.error("Escalation email failed: %s", e, exc_info=True)
        return {"ok": False, "error": str(e)}
