# Deployment Guide for MCS App

This document outlines the steps required to deploy the Management Control System (MCS) application, which consists of a React (Vite) frontend and a Python (FastAPI) backend.

## 1. Prerequisites
- **Node.js**: v18+ (for building the frontend)
- **Python**: 3.9+ (for running the backend)
- **A process manager**: `pm2` for Node/React (optional) or `systemd` for Python.

---

## 2. Backend Deployment (FastAPI)

The backend handles AI transcript analysis, meeting insights, and email escalations.

### Setup
1. Open the terminal and navigate to the `backend` directory:
   ```bash
   cd backend
   ```
2. Create and activate a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate
   ```
3. Install the dependencies:
   ```bash
   pip install -r requirements.txt
   ```
   *(Note: Ensure you have `fastapi`, `uvicorn`, `google-generativeai`, and `pydantic` installed)*

### Environment Variables
Set the following environment variables (via a `.env` file or export them):
- `GEMINI_API_KEY`: Your Gemini API key for AI features.
- `SMTP_SERVER`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`: For email escalation sending.

### Running the Server
Run the production server using Uvicorn:
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

*(For a daemonized production deployment, consider setting this up as a `systemd` service or running it within a Docker container.)*

---

## 3. Frontend Deployment (React + Vite)

The frontend is a static single-page application (SPA).

### Build for Production
1. Navigate to the root directory:
   ```bash
   cd /home/prashant/mcs-app
   ```
2. Install dependencies (if not already installed):
   ```bash
   npm install
   ```
3. Build the static files:
   ```bash
   npm run build
   ```
   This will generate a `dist/` folder containing the compiled HTML, CSS, and JS.

### Hosting the Frontend
Since the frontend connects to Google Sheets and the FastAPI backend, you simply need to host the `dist/` folder on any static web server:

**Option A: Nginx**
Point your Nginx root directory to the `dist` folder and handle client-side routing.
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    root /path/to/mcs-app/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

**Option B: PM2 with Serve**
```bash
npm install -g serve
pm2 start serve --name "mcs-frontend" -- -s dist -l 5173
```

---

## 4. Final Verification
- **Frontend URL**: Ensure the UI loads without errors.
- **Backend URL**: Ensure the backend is reachable (check `http://<backend-ip>:8000/api/health`).
- **Google Sheets**: Ensure your Google Apps Script URL (`SHEET_SCRIPT_URL` in `src/App.jsx`) is active and accessible.
