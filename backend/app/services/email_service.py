import smtplib
from email.message import EmailMessage
from typing import List, Dict, Any
from app.config import settings


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
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
            server.starttls()
            server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)
        return True
    except Exception as e:
        print(f"Email send failed: {e}")
        return False


def dispatch_escalation_email(actions: List[Dict[str, Any]], level: int, target: str, users: List[Dict[str, Any]]) -> bool:
    target_emails = [u.get("email") for u in users if u.get("role") == target and u.get("email")]
    if not target_emails:
        print(f"No email recipients found for role: {target}")
        return False

    subject = f"MCS Escalation Level {level} — Action Items Requiring Attention"
    body = f"<h2>Escalation Level {level} — {target}</h2><p>The following actions are overdue:</p><ul>"
    for a in actions:
        body += f"<li><b>{a.get('sn', '')}:</b> {a.get('text', '')} (Due: {a.get('due', '')}, Responsible: {a.get('responsible', '')})</li>"
    body += "</ul>"

    return send_email(target_emails, subject, body)


def share_insights_email(insights: List[Dict[str, Any]], meeting_type: str, plant: str, recipients: List[str]) -> bool:
    if not recipients:
        recipients = [settings.team_email]
    subject = f"Real-time Insights — {meeting_type} @ {plant}"
    body = "<h2>Meeting Insights</h2>"
    for ins in insights:
        body += f"<h3>[{ins.get('ts', '')}]</h3><ul>"
        for act in ins.get("actions", []):
            body += f"<li><b>Action:</b> {act.get('text')} (Resp: {act.get('responsible')})</li>"
        for dec in ins.get("decisions", []):
            body += f"<li><b>Decision:</b> {dec}</li>"
        for rsk in ins.get("risks", []):
            body += f"<li><b>Risk:</b> {rsk}</li>"
        body += "</ul>"
    return send_email(recipients, subject, body)
