"""
main.py — MCS Backend API  v2 (Integrated with wacrm WhatsApp Gateway)
Uses google-genai SDK v2+ (replaces deprecated google-generativeai).
Run: uvicorn main:app --reload --port 8000
"""
from fastapi import FastAPI, Header, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import os, json, smtplib, datetime, requests
from email.message import EmailMessage
from dotenv import load_dotenv

# Load .env from current dir, script dir, or parent dir
load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
load_dotenv(os.path.join(os.getcwd(), ".env"))

# ── FastAPI app ────────────────────────────────────────────────────────────
app = FastAPI(title="MCS Backend API")

from email_escalation import router as email_router
app.include_router(email_router)

# Origins locked via env var. Wildcard + credentials is invalid and unsafe.
_origins_env = os.environ.get("ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS = [o.strip() for o in _origins_env.split(",") if o.strip()]
if not ALLOWED_ORIGINS:
    print("WARNING: ALLOWED_ORIGINS not set. Falling back to '*' with credentials disabled.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["*"],
    allow_credentials=bool(ALLOWED_ORIGINS),
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API key auth ───────────────────────────────────────────────────────────
API_KEY = os.environ.get("API_KEY", "")

async def require_api_key(x_api_key: Optional[str] = Header(None)):
    if not API_KEY:
        return  # auth disabled if not configured; set API_KEY in Render to enable
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")

# ── Gemini client (NEW SDK: google-genai) ─────────────────────────────────
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
if not GEMINI_API_KEY:
    print("WARNING: GEMINI_API_KEY not set. Gemini calls will fail.")

from google import genai as google_genai
gemini_client = google_genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

# gemini-2.0-flash: best balance of reliability, JSON instruction-following, and free-tier quota
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")

def gemini_generate(prompt: str) -> str:
    """Call Gemini with the new SDK. Falls back to Ollama if unavailable."""
    if not gemini_client:
        return call_ollama_fallback(prompt)
    # Try configured model, then each fallback model, skipping duplicates.
    fallback_models = [m for m in ["gemini-2.0-flash", "gemini-2.0-flash-lite"] if m != GEMINI_MODEL]
    for model_id in [GEMINI_MODEL] + fallback_models:
        try:
            response = gemini_client.models.generate_content(
                model=model_id,
                contents=prompt
            )
            return response.text
        except Exception as e:
            print(f"Gemini failed ({model_id}): {e}")
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
# Standardized on SMTP_HOST/SMTP_PASSWORD (matches email_escalation.py).
# Legacy SMTP_SERVER/SMTP_PASS still read as fallback for existing Render config.
SMTP_SERVER = os.environ.get("SMTP_HOST", os.environ.get("SMTP_SERVER", "smtp.gmail.com"))
SMTP_PORT   = int(os.environ.get("SMTP_PORT", 587))
SMTP_USER   = os.environ.get("SMTP_USER", "")
SMTP_PASS   = os.environ.get("SMTP_PASSWORD", os.environ.get("SMTP_PASS", ""))
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@adroit.in")
TEAM_EMAIL  = os.environ.get("TEAM_EMAIL", "team@adroit.in")

def send_email(to_emails: List[str], subject: str, html_content: str):
    if not SMTP_USER or not SMTP_PASS:
        print(f"WARNING: SMTP not configured — email NOT sent (demo mode). TO: {to_emails} SUBJECT: {subject}")
        return False
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

# ── wacrm WhatsApp Gateway Integration Helper ──────────────────────────────
# URL configuration pointing to your newly created custom automation endpoint
WACRM_ALERT_URL = os.environ.get("WACRM_ALERT_URL", "http://localhost:3000/api/automation/send-alert")

def send_whatsapp_alert(phone: str, message: str) -> bool:
    """Helper to dispatch text alerts directly to your wacrm automation endpoint."""
    if not phone:
        print("Skipping WhatsApp alert: Target phone number is missing.")
        return False
    try:
        payload = {
            "phone": phone,
            "message": message
        }
        headers = {"Content-Type": "application/json"}
        response = requests.post(WACRM_ALERT_URL, json=payload, headers=headers, timeout=10)
        
        if response.status_code == 200:
            print(f"WhatsApp alert successfully dispatched via wacrm gateway to: {phone}")
            return True
        else:
            print(f"wacrm gateway rejected request ({response.status_code}): {response.text}")
            return False
    except Exception as e:
        print(f"Failed to communicate with wacrm WhatsApp gateway: {e}")
        return False

# ── JSON cleaning helper ───────────────────────────────────────────────────
def clean_json_response(text: str) -> str:
    text = text.strip()
    if "```json" in text:
        try:
            start = text.index("```json") + 7
            end   = text.rindex("```")
            return text[start:end].strip()
        except Exception as e:
            print(f"clean_json_response: fenced-json extraction failed: {e}")
    elif "```" in text:
        try:
            start = text.index("```") + 3
            end   = text.rindex("```")
            return text[start:end].strip()
        except Exception as e:
            print(f"clean_json_response: fenced-block extraction failed: {e}")
    try:
        first_obj = text.find('{')
        first_arr = text.find('[')
        last_obj  = text.rfind('}')
        last_arr  = text.rfind(']')
        starts    = [x for x in [first_obj, first_arr] if x != -1]
        ends      = [x for x in [last_obj,  last_arr]  if x != -1]
        if starts and ends:
            return text[min(starts):max(ends)+1].strip()
    except Exception as e:
        print(f"clean_json_response: bracket extraction failed: {e}")
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
    phone: str = "" # Added phone property to extract task owner numbers dynamically

class InsightsShareReq(BaseModel):
    insights: List[Dict[str, Any]]
    meeting_type: str
    plant: str
    recipients: List[str]
    phones: List[str] = [] # Added phone list support for direct text distributions

# ── Routes ─────────────────────────────────────────────────────────────────
@app.api_route("/", methods=["GET", "HEAD"])
async def root():
    return {"message": "MCS Backend API is running", "docs": "/docs", "health": "/api/health"}

@app.api_route("/api/health", methods=["GET", "HEAD"])
async def health():
    return {
        "status": "ok",
        "gemini_configured": bool(GEMINI_API_KEY),
        "gemini_model": GEMINI_MODEL,
        "smtp_configured": bool(SMTP_USER and SMTP_PASS),
        "wacrm_gateway_configured": bool(WACRM_ALERT_URL),
        "api_key_auth_enabled": bool(API_KEY),
        "cors_locked": bool(ALLOWED_ORIGINS)
    }

@app.get("/api/ping")
async def ping():
    return {"ok": True, "gemini_ready": bool(gemini_client)}

# Legacy /api/email/escalate removed — superseded by email_router (email_escalation.py).
# EmailEscalateReq kept only if still referenced by frontend; delete once confirmed unused.

@app.post("/api/email/share-insights", dependencies=[Depends(require_api_key)])
async def email_share_insights(req: InsightsShareReq):
    # 1. Execute standard Email Insights Delivery
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
    
    # 2. Iterate and broadcast clear summaries to phone list
    wa_failed = []
    if req.phones:
        for p in req.phones:
            wa_insights = f"📋 *Real-time Insights Summaries*\n{req.meeting_type} @ {req.plant}\n"
            for ins in req.insights:
                if ins.get('actions'):
                    wa_insights += "\n*Allocated Actions:*\n"
                    for act in ins.get('actions', []):
                        wa_insights += f"• {act.get('text')} (Resp: {act.get('responsible')})\n"
                if ins.get('decisions'):
                    wa_insights += "\n*Key Decisions:*\n"
                    for dec in ins.get('decisions', []):
                        wa_insights += f"• {dec}\n"
            if not send_whatsapp_alert(p, wa_insights):
                wa_failed.append(p)

    return {"status": "ok", "whatsapp_failed": wa_failed}

@app.post("/api/meetings/extract-insights", dependencies=[Depends(require_api_key)])
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
        return {"error": "AI analysis unavailable. Please try again.", "topics": [], "actions": []}
    try:
        result = json.loads(clean_json_response(text))
        result.setdefault("topics", [])
        result.setdefault("actions", [])
        return result
    except Exception as e:
        print(f"Parse failed: {e}\nRaw: {text[:300]}")
        return {"error": f"AI returned unreadable response: {text[:80]}", "topics": [], "actions": []}

@app.post("/api/meetings/analyze-paragraph", dependencies=[Depends(require_api_key)])
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
        return {"actions": [], "decisions": [], "risks": [], "keyPoints": [], "error": "AI analysis unavailable. Please try again."}
    try:
        result = json.loads(clean_json_response(text))
        result.setdefault("actions", [])
        result.setdefault("decisions", [])
        result.setdefault("risks", [])
        result.setdefault("keyPoints", [])
        return result
    except Exception as e:
        print(f"Paragraph parse failed: {e}\nRaw: {text[:300]}")
        return {"actions": [], "decisions": [], "risks": [], "keyPoints": [], "error": f"AI returned unreadable response: {text[:80]}"}

@app.post("/api/translate", dependencies=[Depends(require_api_key)])
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
