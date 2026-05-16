"""
main.py — MCS Backend API  v2
Uses google-genai SDK v2+ (replaces deprecated google-generativeai).
Run: uvicorn main:app --reload --port 8000
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any
import os, json, smtplib, datetime, requests
from email.message import EmailMessage
from dotenv import load_dotenv

# Load .env from current dir, script dir, or parent dir
load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
load_dotenv(os.path.join(os.getcwd(), ".env"))

# ── FastAPI app ────────────────────────────────────────────────────────────
app = FastAPI(title="MCS Backend API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Gemini client (NEW SDK: google-genai) ─────────────────────────────────
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
if not GEMINI_API_KEY:
    print("WARNING: GEMINI_API_KEY not set. Gemini calls will fail.")

from google import genai as google_genai
gemini_client = google_genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

# Best model to use — flash-lite is fast and cheap for real-time use
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash-lite")

def gemini_generate(prompt: str) -> str:
    """Call Gemini with the new SDK. Falls back to Ollama if unavailable."""
    if not gemini_client:
        return call_ollama_fallback(prompt)
    try:
        response = gemini_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt
        )
        return response.text
    except Exception as e:
        print(f"Gemini failed ({GEMINI_MODEL}): {e}")
        # Try fallback model before giving up
        try:
            response = gemini_client.models.generate_content(
                model="gemini-1.5-flash",
                contents=prompt
            )
            return response.text
        except Exception as e2:
            print(f"Gemini fallback also failed: {e2}")
            return call_ollama_fallback(prompt)

# ── Ollama local fallback ──────────────────────────────────────────────────
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3")

def call_ollama_fallback(prompt: str) -> str:
    print(f"FALLBACK: Routing to local Ollama ({OLLAMA_MODEL})")
    try:
        response = requests.post("http://localhost:11434/api/generate", json={
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False
        }, timeout=45)
        response.raise_for_status()
        return response.json().get("response", "")
    except Exception as e:
        print(f"Ollama fallback failed: {e}")
        return ""

# ── Email setup ────────────────────────────────────────────────────────────
SMTP_SERVER = os.environ.get("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT   = int(os.environ.get("SMTP_PORT", 587))
SMTP_USER   = os.environ.get("SMTP_USER", "")
SMTP_PASS   = os.environ.get("SMTP_PASS", "")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@adroit.in")
TEAM_EMAIL  = os.environ.get("TEAM_EMAIL", "team@adroit.in")

def send_email(to_emails: List[str], subject: str, html_content: str):
    if not SMTP_USER or not SMTP_PASS:
        # Demo mode — print to console
        print(f"\n--- DEMO EMAIL ---\nTO: {to_emails}\nSUBJECT: {subject}\n{html_content}\n---")
        return True
    try:
        msg = EmailMessage()
        msg['Subject'] = subject
        msg['From']    = SMTP_USER
        msg['To']      = ", ".join(to_emails)
        msg.set_content("Please enable HTML viewing.")
        msg.add_alternative(html_content, subtype='html')
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
        return True
    except Exception as e:
        print(f"Email send failed: {e}")
        return False

# ── JSON cleaning helper ───────────────────────────────────────────────────
def clean_json_response(text: str) -> str:
    """Extract JSON from an LLM response that may have markdown fences."""
    text = text.strip()
    if "```json" in text:
        try:
            start = text.index("```json") + 7
            end   = text.rindex("```")
            return text[start:end].strip()
        except: pass
    elif "```" in text:
        try:
            start = text.index("```") + 3
            end   = text.rindex("```")
            return text[start:end].strip()
        except: pass
    try:
        first_obj = text.find('{')
        first_arr = text.find('[')
        last_obj  = text.rfind('}')
        last_arr  = text.rfind(']')
        starts    = [x for x in [first_obj, first_arr] if x != -1]
        ends      = [x for x in [last_obj,  last_arr]  if x != -1]
        if starts and ends:
            return text[min(starts):max(ends)+1].strip()
    except: pass
    return text

# ── Request models ─────────────────────────────────────────────────────────
class MeetingReviewReq(BaseModel):
    transcript: str
    meeting_type: str
    plant: str = "Adroit"
    previous_actions: List[Dict[str, Any]] = []

class ParagraphAnalysisReq(BaseModel):
    paragraph: str
    meeting_type: str
    source_lang: str = "en"

class TranslateReq(BaseModel):
    text: str
    source: str = "hi"
    target: str = "en"

class EmailEscalateReq(BaseModel):
    actions: List[Dict[str, Any]]
    level: int
    target: str

class InsightsShareReq(BaseModel):
    insights: List[Dict[str, Any]]
    meeting_type: str
    plant: str
    recipients: List[str]

# ── Routes ─────────────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return {"message": "MCS Backend API is running", "docs": "/docs", "health": "/api/health"}

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "gemini_configured": bool(GEMINI_API_KEY),
        "gemini_model": GEMINI_MODEL,
        "smtp_configured": bool(SMTP_USER and SMTP_PASS),
    }

@app.get("/api/ping")
async def ping():
    """Lightweight wakeup endpoint — called by frontend on meeting start to warm up the Render instance."""
    return {"ok": True, "gemini_ready": bool(gemini_client)}

@app.post("/api/email/escalate")
async def email_escalate(req: EmailEscalateReq):
    subject = f"Escalation Alert Level {req.level} — {req.target}"
    body = f"<h2>Escalated Actions — Level {req.level}</h2><ul>"
    for a in req.actions:
        body += f"<li><b>{a.get('sn')}</b>: {a.get('text')} (Priority: {a.get('priority')})</li>"
    body += "</ul>"
    send_email([ADMIN_EMAIL], subject, body)
    return {"status": "ok"}

@app.post("/api/email/share-insights")
async def email_share_insights(req: InsightsShareReq):
    subject = f"Real-time Insights — {req.meeting_type} @ {req.plant}"
    body = "<h2>Meeting Insights</h2>"
    for ins in req.insights:
        body += f"<h3>[{ins.get('ts')}]</h3><ul>"
        for act in ins.get('actions', []):
            body += f"<li><b>Action:</b> {act.get('text')} (Resp: {act.get('responsible')})</li>"
        for dec in ins.get('decisions', []):
            body += f"<li><b>Decision:</b> {dec}</li>"
        for rsk in ins.get('risks', []):
            body += f"<li><b>Risk:</b> {rsk}</li>"
        body += "</ul>"
    send_email(req.recipients or [TEAM_EMAIL], subject, body)
    return {"status": "ok"}

@app.post("/api/meetings/extract-insights")
async def extract_insights(req: MeetingReviewReq):
    today = datetime.date.today().strftime("%Y-%m-%d")
    prompt = f"""
You are an AI meeting assistant. Analyze this transcript and produce a structured action log.

Steps:
1. Identify main discussion topics with short summaries.
2. Extract concrete action items — de-duplicate, and if an item matches PREVIOUS ACTIONS update its remarks.
   Fill: Source="Daily Meeting", Plant="{req.plant}", Date="{today}", Status="IN PROCESS"

Return ONLY valid JSON (no markdown fences, no preamble):
{{
  "topics": [{{"topic": "...", "summary": "..."}}],
  "actions": [
    {{
      "text": "...", "responsible": "...", "due": "YYYY-MM-DD",
      "section": "...", "priority": "CRITICAL|WARNING|NORMAL",
      "remarks": "...", "is_update": false
    }}
  ]
}}

PREVIOUS ACTIONS: {json.dumps(req.previous_actions[:20])}

TRANSCRIPT:
{req.transcript}
"""
    text = gemini_generate(prompt)
    if not text:
        return {"error": "Service unavailable", "actions": []}
    try:
        return json.loads(clean_json_response(text))
    except Exception as e:
        print(f"Parse failed: {e}\nRaw: {text[:300]}")
        return {"error": "Format error", "actions": []}

@app.post("/api/meetings/analyze-paragraph")
async def analyze_paragraph(req: ParagraphAnalysisReq):
    lang_note = ""
    if req.source_lang == "hi":
        lang_note = "\nIMPORTANT: Input may be Hindi (Devanagari) or Hinglish (Hindi in Roman letters). Return ALL insights in English."

    prompt = f"""You are an expert meeting analyst. Extract structured insights from this paragraph.
Return ONLY valid JSON — no markdown, no extra text:
{{
  "actions": [{{"text":"...","responsible":"...","priority":"CRITICAL|WARNING|NORMAL","section":"..."}}],
  "decisions": ["..."],
  "risks": ["..."],
  "keyPoints": ["..."]
}}
Rules:
- actions = concrete tasks assigned to someone (responsible="" if unclear)
- decisions = things agreed upon
- risks = blockers or concerns raised
- keyPoints = important observations
- Keep each item under 15 words. Return empty arrays if nothing found.{lang_note}

Meeting type: {req.meeting_type}
Paragraph: "{req.paragraph}"
"""
    text = gemini_generate(prompt)
    if not text:
        return {"actions": [], "decisions": [], "risks": [], "keyPoints": []}
    try:
        return json.loads(clean_json_response(text))
    except Exception as e:
        print(f"Paragraph parse failed: {e}\nRaw: {text[:300]}")
        return {"actions": [], "decisions": [], "risks": [], "keyPoints": []}

@app.post("/api/translate")
async def translate_text(req: TranslateReq):
    if not req.text or len(req.text.strip()) < 2:
        return {"translated": req.text, "original": req.text}

    lang_names = {
        "hi": "Hindi", "en": "English",
        "mr": "Marathi", "gu": "Gujarati", "cg": "Chhattisgarhi"
    }
    src = lang_names.get(req.source, req.source)
    tgt = lang_names.get(req.target, req.target)

    prompt = f"""Translate the following {src} text to {tgt}.
Return ONLY the translated text — no quotes, no explanation.
If text is already in {tgt} or mixed, translate only the non-{tgt} parts.
Preserve proper nouns (names, places, brands) as-is.

Text: {req.text}"""

    text = gemini_generate(prompt)
    if text:
        return {"translated": text.strip(), "original": req.text}
    return {"translated": req.text, "original": req.text, "error": "Translation unavailable"}
