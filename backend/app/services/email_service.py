import smtplib
import time
from email.message import EmailMessage
from html import escape as html_escape
from typing import List, Dict, Any
from app.config import settings

# In-memory dedup cache: keys are "sn::level" strings, values are last-sent timestamps.
# Prevents the same action+level from being emailed more than once per DEDUP_WINDOW_SECS.
_escalation_sent: Dict[str, float] = {}
DEDUP_WINDOW_SECS = 4 * 60 * 60  # 4 hours


def _is_duplicate(sn: str, level: int) -> bool:
    key = f"{sn}::{level}"
    now = time.time()
    last = _escalation_sent.get(key)
    if last and (now - last) < DEDUP_WINDOW_SECS:
        return True
    _escalation_sent[key] = now
    # Evict stale entries periodically
    if len(_escalation_sent) > 500:
        stale = [k for k, v in _escalation_sent.items() if (now - v) >= DEDUP_WINDOW_SECS]
        for k in stale:
            del _escalation_sent[k]
    return False


def send_email(to_emails: List[str], subject: str, html_content: str) -> bool:
    if not settings.smtp_user or not settings.smtp_password:
        print(f"SMTP not configured — email NOT sent. TO: {to_emails} SUBJECT: {subject}")
        return False
    try:
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = settings.smtp_user
        msg["To"] = ", ".join(to_emails)
        msg.set_content("Please enable HTML viewing.")
        msg.add_alternative(html_content, subtype="html")
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as server:
            server.starttls()
            server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)
        return True
    except smtplib.SMTPException as e:
        print(f"Email SMTP error: {e}")
        return False
    except Exception as e:
        print(f"Email send failed: {type(e).__name__}: {e}")
        return False


def dispatch_escalation_emails(email_groups: List[Dict[str, Any]]) -> bool:
    """Send escalation emails for all matched matrix tiers.

    Each entry in email_groups has:
      - recipients: list of email addresses
      - level: escalation level
      - target_role: the role being notified
      - actions: list of action dicts (sn, text, due, responsible, priority)
    """
    any_sent = False
    for group in email_groups:
        recipients = group.get("recipients", [])
        level = group.get("level", 1)
        target_role = group.get("target_role", "")
        actions = group.get("actions", [])

        if not recipients or not actions:
            continue

        # Filter out already-sent action+level combos
        fresh = [a for a in actions if not _is_duplicate(a.get("sn", ""), level)]
        if not fresh:
            print(f"All {len(actions)} escalation action(s) already sent for level {level} — skipping")
            continue

        safe_target = html_escape(str(target_role))
        subject = f"MCS Escalation Level {level} — Action Items Requiring Attention"
        body = f"<h2>Escalation Level {level} — {safe_target}</h2><p>The following actions are overdue:</p><ul>"
        for a in fresh:
            sn = html_escape(str(a.get("sn", "")))
            text = html_escape(str(a.get("text", "")))
            due = html_escape(str(a.get("due", "")))
            responsible = a.get("responsible") or "Unassigned"
            responsible = html_escape(str(responsible))
            body += f"<li><b>{sn}:</b> {text} (Due: {due}, Responsible: {responsible})</li>"
        body += "</ul>"

        if send_email(recipients, subject, body):
            any_sent = True

    return any_sent


def send_welcome_email(name: str, username: str, email: str) -> bool:
    safe_name = html_escape(str(name))
    safe_user = html_escape(str(username))
    subject = f"Welcome to MCS — Your Account is Ready"
    body = (
        f"<h2>Welcome, {safe_name}!</h2>"
        f"<p>Your MCS account has been created.</p>"
        f"<p><b>Username:</b> {safe_user}</p>"
        f"<p><a href='{settings.frontend_url}'>Login to MCS</a></p>"
    )
    return send_email([email], subject, body)


def send_actions_email(to_email: str, responsible: str, actions: List[Dict[str, Any]]) -> bool:
    safe_name = html_escape(str(responsible))
    subject = f"MCS — All Actions for {safe_name}"
    rows = ""
    for a in actions:
        sn = html_escape(str(a.get("sn", "")))
        text = html_escape(str(a.get("text", "")))
        due = html_escape(str(a.get("due", "")) or "—")
        status = html_escape(str(a.get("status", "")))
        priority = html_escape(str(a.get("priority", "")))
        rows += (
            f"<tr>"
            f"<td style='padding:6px 10px;border:1px solid #ddd'>{sn}</td>"
            f"<td style='padding:6px 10px;border:1px solid #ddd'>{text}</td>"
            f"<td style='padding:6px 10px;border:1px solid #ddd'>{due}</td>"
            f"<td style='padding:6px 10px;border:1px solid #ddd'>{status}</td>"
            f"<td style='padding:6px 10px;border:1px solid #ddd'>{priority}</td>"
            f"</tr>"
        )
    body = (
        f"<h2>Actions for {safe_name}</h2>"
        f"<p>Total actions: <b>{len(actions)}</b></p>"
        f"<table style='border-collapse:collapse;width:100%'>"
        f"<thead><tr>"
        f"<th style='padding:6px 10px;border:1px solid #ddd;background:#f4f4f4'>SN</th>"
        f"<th style='padding:6px 10px;border:1px solid #ddd;background:#f4f4f4'>Action</th>"
        f"<th style='padding:6px 10px;border:1px solid #ddd;background:#f4f4f4'>Due</th>"
        f"<th style='padding:6px 10px;border:1px solid #ddd;background:#f4f4f4'>Status</th>"
        f"<th style='padding:6px 10px;border:1px solid #ddd;background:#f4f4f4'>Priority</th>"
        f"</tr></thead>"
        f"<tbody>{rows}</tbody></table>"
    )
    return send_email([to_email], subject, body)


def share_insights_email(to_emails: List[str], subject: str, content: str, plant: str = "") -> bool:
    safe_content = html_escape(str(content))
    safe_plant = html_escape(str(plant))
    html_body = f"<h2>MCS Insights Share</h2>"
    if safe_plant:
        html_body += f"<p><b>Plant:</b> {safe_plant}</p>"
    html_body += f"<pre style='white-space:pre-wrap;font-family:sans-serif'>{safe_content}</pre>"
    return send_email(to_emails, subject, html_body)
