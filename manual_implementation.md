# MCS Action App - Manual Setup & Configuration

## 1. Google Gemini API Setup
The backend parses meeting transcripts using Gemini.
1. Get an API key from [Google AI Studio](https://aistudio.google.com/).
2. The key must be set in the backend environment as `GEMINI_API_KEY`.

## 2. Email Delivery Setup (SMTP)
The app auto-emails "Meeting Insights" every 5 minutes and sends "Escalation Alerts". 
If credentials are not detected, the email engine defaults to **Mock Mode** (prints HTML emails in the backend terminal).

To enable real emails using Gmail:
1. Go to your Google Account Security settings (`myaccount.google.com/security`).
2. Turn on **2-Step Verification**.
3. Search for **App Passwords**.
4. Generate a new password (e.g., name it "MCS App").
5. Save the 16-character password provided.

## 3. Starting the Backend
Open a terminal. You can either use a `.env` file (copied from `.env.example`) or set environment variables manually.

```bash
cd /home/prashant/mcs-app/backend

# OPTION A: Using .env file
# Copy .env.example to .env and fill it, then:
uvicorn main:app --reload --port 8000

# OPTION B: Export Keys Manually
export GEMINI_API_KEY="your-gemini-api-key"
# ... (other exports)
uvicorn main:app --reload --port 8000
```

## 4. Starting the Frontend
Open a new terminal session.
```bash
cd /home/prashant/mcs-app
npm run dev
```

## 5. Google Sheet App Script (Database)
Data is persisted in a Google Sheet. Ensure your `App.jsx` configuration contains the correct deployment URL.
```javascript
const SHEET_SCRIPT_URL = "https://script.google.com/macros/s/YOUR_URL/exec";
const SHEET_ID = "1OR4J17WrhQg9rqFV3uIhLCDG9UDCoQ5lc9-8ZXoNSOo";
```
If script url is invalid, the frontend gracefully falls back to local seed data.
