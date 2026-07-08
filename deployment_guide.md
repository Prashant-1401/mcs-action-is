# MCS Action IS — Industrial Deployment Guide

> **Stack**: React (Vite) frontend · FastAPI backend · PostgreSQL database

---

## Architecture Overview

```mermaid
graph LR
    Browser -->|HTTPS| Vercel["Frontend\n(Vercel)"]
    Vercel -->|REST API| Render["Backend\n(Render)"]
    Render -->|SQL| DB["PostgreSQL\n(Neon / Supabase)"]
    Render -->|AI| Gemini["Google Gemini API"]
    Render -->|SMTP| Email["Gmail SMTP"]
```

---

## Step 1 — PostgreSQL Database (Free: Neon.tech)

> [!IMPORTANT]
> Do this **first** — you need the database URL before deploying the backend.

1. Go to [neon.tech](https://neon.tech) → **Create Account** → **New Project**
2. Name it `mcs-action-is`, region = nearest to your users
3. Copy the **Connection String** (format below):

```
postgresql+asyncpg://user:password@ep-xxx.aws.neon.tech/neondb?sslmode=require
```

4. Save this — it becomes your `DATABASE_URL` env var.

> [!TIP]
> **Alternative**: [Supabase](https://supabase.com) also gives free Postgres. Use the "Direct Connection" URL, not the pooler URL (asyncpg needs direct).

---

## Step 2 — Backend on Render (Free tier available)

1. Go to [render.com](https://render.com) → **New → Web Service**
2. Connect GitHub → select `Prashant-1401/mcs-action-is`
3. Set these settings:

| Field | Value |
|-------|-------|
| **Root Directory** | `backend` |
| **Runtime** | `Python 3` |
| **Build Command** | `pip install -r requirements.txt` |
| **Start Command** | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| **Plan** | Free (or Starter $7/mo for production) |

4. Under **Environment Variables**, add ALL of these:

```env
DATABASE_URL=postgresql+asyncpg://user:pass@host/dbname?sslmode=require
GEMINI_API_KEY=AIza...your_key...
GEMINI_MODEL=gemini-2.5-flash-lite
SECRET_KEY=<generate: python3 -c "import secrets; print(secrets.token_hex(32))">
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=480
API_KEY=<generate another random string — used as x-api-key header>
ALLOWED_ORIGINS=https://your-vercel-app.vercel.app
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=your_gmail_app_password
ADMIN_EMAIL=admin@yourcompany.com
TEAM_EMAIL=team@yourcompany.com
WACRM_ALERT_URL=
```

> [!WARNING]
> `SECRET_KEY` must be a **random 256-bit string** — never reuse the default. Generate it with:
> ```bash
> python3 -c "import secrets; print(secrets.token_hex(32))"
> ```

5. Click **Deploy** → wait ~3 min → note your backend URL:
   `https://mcs-action-is.onrender.com`

6. Test backend health:
   ```
   https://mcs-action-is.onrender.com/api/health
   ```

---

## Step 3 — Gmail App Password (for Email alerts)

1. Go to [myaccount.google.com/security](https://myaccount.google.com/security)
2. Enable **2-Step Verification** (required)
3. Search **"App Passwords"** → Create one named `MCS Action IS`
4. Copy the 16-char password → use as `SMTP_PASSWORD`

---

## Step 4 — Frontend on Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project**
2. Import `Prashant-1401/mcs-action-is` from GitHub
3. Set **Root Directory** to `/` (project root)
4. Framework: **Vite** (auto-detected)
5. Add **Environment Variables**:

```env
VITE_API_BASE_URL=https://mcs-action-is.onrender.com
VITE_API_KEY=<same API_KEY you set on Render>
VITE_SHEET_SCRIPT_URL=<your Google Apps Script URL if still using sheets>
VITE_SHEET_ID=<your Google Sheet ID if still using sheets>
```

6. Click **Deploy** → your frontend URL:
   `https://mcs-action-is.vercel.app`

---

## Step 5 — Fix CORS (Important!)

After deploying frontend, go back to **Render** → your service → **Environment** and update:

```
ALLOWED_ORIGINS=https://mcs-action-is.vercel.app
```

If you have a **custom domain**, add it too (comma-separated):
```
ALLOWED_ORIGINS=https://mcs-action-is.vercel.app,https://mcs.yourcompany.com
```

Then **Redeploy** the backend.

---

## Step 6 — Custom Domain (Optional but recommended for industry)

### Frontend (Vercel)
1. Vercel → your project → **Settings → Domains**
2. Add `mcs.yourcompany.com`
3. Add CNAME record in your DNS: `mcs → cname.vercel-dns.com`

### Backend (Render)
1. Render → service → **Settings → Custom Domains**
2. Add `api-mcs.yourcompany.com`
3. Add CNAME in DNS: `api-mcs → mcs-action-is.onrender.com`
4. Update `ALLOWED_ORIGINS` and `VITE_API_BASE_URL` accordingly

> [!NOTE]
> Both Vercel and Render handle **SSL/HTTPS certificates automatically** — no manual cert setup needed.

---

## Step 7 — Database Migrations (Alembic)

The app uses SQLAlchemy with `create_all` on startup — tables are auto-created on first boot. No manual migration needed for fresh installs.

For future schema changes, use Alembic:
```bash
cd backend
alembic revision --autogenerate -m "describe change"
alembic upgrade head
```

---

## Post-Deploy Checklist

| Check | How |
|-------|-----|
| ✅ Backend health | `GET /api/health` returns `status: ok` |
| ✅ Gemini configured | `gemini_configured: true` in health response |
| ✅ SMTP configured | `smtp_configured: true` in health response |
| ✅ CORS working | Frontend can fetch from backend (no CORS error in browser) |
| ✅ Login works | Create first user via `/docs` (Swagger UI) |
| ✅ Email alerts | Trigger a test escalation |
| ✅ AI insights | Start a meeting, speak, check AI panel |

---

## Cost Summary

| Service | Free Tier | Production |
|---------|-----------|------------|
| **Vercel** (frontend) | ✅ Free forever | $20/mo Pro |
| **Render** (backend) | ✅ Free (sleeps after 15min idle) | $7/mo Starter (always-on) |
| **Neon** (PostgreSQL) | ✅ Free 512MB | $19/mo Pro |
| **Google Gemini API** | ✅ Free tier | Pay-per-use |
| **Total for production** | $0 (dev/test) | ~$26/mo |

> [!CAUTION]
> Free Render tier **spins down after 15 minutes of inactivity** — first request takes ~30s to wake up. For industrial use, use **Starter** ($7/mo) for always-on.

---

## Security Hardening (Industrial)

- [ ] Set a **strong** `SECRET_KEY` (32+ random bytes)
- [ ] Set a **strong** `API_KEY` header (random UUID works)
- [ ] Restrict `ALLOWED_ORIGINS` to your exact domain (not `*`)
- [ ] Use **Gmail App Password** (not your real password)
- [ ] Enable Neon **IP Allow List** in project settings
- [ ] Rotate `SECRET_KEY` periodically (invalidates all sessions)
