"""Generate new passwords for all users and send welcome emails with credentials.
Uses synchronous psycopg2 to avoid async connection issues."""

import random
import string
import sys
import os
import smtplib
from email.message import EmailMessage

import psycopg2
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

import bcrypt


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def generate_password(length=10):
    chars = string.ascii_letters + string.digits + "!@#$%&*"
    while True:
        pw = (
            random.choice(string.ascii_uppercase)
            + random.choice(string.ascii_lowercase)
            + random.choice(string.digits)
            + random.choice("!@#$%&*")
            + "".join(random.choices(chars, k=length - 4))
        )
        if any(c.isupper() for c in pw) and any(c.islower() for c in pw) and any(c.isdigit() for c in pw):
            return pw


def send_welcome_email(to_email, name, username, password):
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_pass = os.getenv("SMTP_PASSWORD", "").strip('"')
    frontend_url = os.getenv("FRONTEND_URL", "https://mcs-control-management.vercel.app")

    msg = EmailMessage()
    msg["Subject"] = "Welcome to MCS — Your Account Credentials"
    msg["From"] = smtp_user
    msg["To"] = to_email
    msg.set_content(f"Your MCS credentials — Username: {username}, Password: {password}")
    html = f"""
    <html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
    <div style="background:#1a237e;color:#fff;padding:20px;text-align:center;">
        <h1 style="margin:0;">MCS — Management Control System</h1>
    </div>
    <div style="padding:30px;background:#f5f5f5;">
        <h2 style="color:#1a237e;">Welcome, {name}!</h2>
        <p>Your MCS account has been created. Here are your login credentials:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
            <tr><td style="padding:8px;font-weight:700;color:#555;">Username</td><td style="padding:8px;font-size:16px;">{username}</td></tr>
            <tr><td style="padding:8px;font-weight:700;color:#555;">Password</td><td style="padding:8px;font-size:16px;font-family:monospace;background:#fff;border:1px solid #ddd;">{password}</td></tr>
        </table>
        <p style="color:#e65100;font-weight:600;">⚠ Please change your password after first login.</p>
        <p><a href="{frontend_url}" style="display:inline-block;background:#1a237e;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;">Login to MCS</a></p>
    </div>
    <div style="text-align:center;padding:10px;color:#888;font-size:11px;">
        <p>This is an automated email from MCS. Do not share these credentials.</p>
    </div>
    </body></html>"""
    msg.add_alternative(html, subtype="html")
    try:
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)
        return True
    except Exception as e:
        print(f"  FAILED to send to {to_email}: {e}")
        return False


def main():
    db_url = os.getenv("DATABASE_URL", "")
    # Convert async URL to sync and fix ssl=require for psycopg2
    sync_url = db_url.replace("postgresql+asyncpg://", "postgresql://").strip('"')
    sync_url = sync_url.replace("?ssl=require", "")
    if "ssl" not in sync_url:
        sync_url += "?sslmode=require"

    conn = psycopg2.connect(sync_url)
    cur = conn.cursor()

    # Optional: filter to specific users via CLI args
    filter_usernames = sys.argv[1:] if len(sys.argv) > 1 else None

    if filter_usernames:
        cur.execute("SELECT id, name, username, email FROM users WHERE username = ANY(%s) ORDER BY name", (filter_usernames,))
    else:
        cur.execute("SELECT id, name, username, email FROM users ORDER BY name")
    users = cur.fetchall()

    print(f"{'='*60}")
    print(f"  MCS Password Reset & Welcome Email")
    print(f"  {len(users)} user(s) to process")
    print(f"{'='*60}\n")

    updated = 0
    emailed = 0
    results = []

    for uid, name, username, email in users:
        new_pw = generate_password()
        hashed = hash_password(new_pw)

        cur.execute("UPDATE users SET password = %s WHERE id = %s", (hashed, uid))
        conn.commit()

        print(f"  {name} ({username})")
        print(f"    Password: {new_pw}")

        if email:
            ok = send_welcome_email(email, name, username, new_pw)
            if ok:
                print(f"    Email: sent to {email}")
                emailed += 1
            else:
                print(f"    Email: FAILED")
        else:
            print(f"    Email: no email on file — skipped")

        results.append({"name": name, "username": username, "password": new_pw, "email": email or "—"})
        updated += 1
        print()

    print(f"{'='*60}")
    print(f"  Done! {updated} passwords reset, {emailed} emails sent.")
    print(f"{'='*60}")

    # Print summary table
    print(f"\n{'Name':<25} {'Username':<20} {'Password':<15} {'Email'}")
    print("-" * 85)
    for r in results:
        print(f"  {r['name']:<23} {r['username']:<20} {r['password']:<15} {r['email']}")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
