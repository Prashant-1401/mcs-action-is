from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai
import os
import json
import smtplib
from email.message import EmailMessage
from typing import List, Dict, Any
from dotenv import load_dotenv
import requests

# Load environment variables from .env file
# Look in current dir, backend/ dir, and parent dir
load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
load_dotenv(os.path.join(os.getcwd(), ".env"))

# 1. Initialize the FastAPI App
app = FastAPI()

# 2. Add CORS Middleware so React can talk to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. Configure Gemini AI
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
if not GEMINI_API_KEY:
    print("WARNING: GEMINI_API_KEY not found in environment variables.")
genai.configure(api_key=GEMINI_API_KEY)

# 4. Define what data the Frontend will send us
class MeetingReviewReq(BaseModel):
    transcript: str
    meeting_type: str
    plant: str = "Adroit"
    previous_actions: List[Dict[str, Any]] = []

class ParagraphAnalysisReq(BaseModel):
    paragraph: str
    meeting_type: str
    source_lang: str = "en"  # "en" or "hi"

class TranslateReq(BaseModel):
    text: str
    source: str = "hi"  # source language
    target: str = "en"  # target language

class EmailEscalateReq(BaseModel):
    actions: List[Dict[str, Any]]
    level: int
    target: str

class InsightsShareReq(BaseModel):
    insights: List[Dict[str, Any]]
    meeting_type: str
    plant: str
    recipients: List[str]

# 5. Health check
@app.get("/")
async def root():
    return {"message": "MCS Backend API is running", "docs": "/docs", "health": "/api/health"}

@app.get("/api/health")
async def health():
    return {"status": "ok", "gemini_configured": bool(GEMINI_API_KEY)}

# OLLAMA FALLBACK SETUP
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3")

def call_ollama_fallback(prompt: str) -> str:
    print(f"--- FALLBACK Triggered: Routing to local Ollama ({OLLAMA_MODEL}) ---")
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


# EMAIL ENGINE SETUP
SMTP_SERVER = os.environ.get("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", 587))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")

def clean_json_response(text: str) -> str:
    """Extracts JSON from an LLM response robustly."""
    text = text.strip()
    # If wrapped in ```json ... ```, extract it
    if "```json" in text:
        try:
            start = text.index("```json") + 7
            end = text.rindex("```")
            return text[start:end].strip()
        except:
            pass
    # If wrapped in ``` ... ```, extract it
    elif "```" in text:
        try:
            start = text.index("```") + 3
            end = text.rindex("```")
            return text[start:end].strip()
        except:
            pass
    
    # Try to find first { or [ and last } or ]
    try:
        first_obj = text.find('{')
        first_arr = text.find('[')
        last_obj = text.rfind('}')
        last_arr = text.rfind(']')
        
        start = min(x for x in [first_obj, first_arr] if x != -1)
        end = max(x for x in [last_obj, last_arr] if x != -1)
        
        if start != -1 and end != -1:
            return text[start:end+1].strip()
    except:
        pass

    return text

def send_email(to_emails: List[str], subject: str, html_content: str):
    if not SMTP_USER or not SMTP_PASS:
        print("--- DEMO EMAIL ENGINE (NO SMTP CREDS) ---")
        print(f"TO: {to_emails}")
        print(f"SUBJECT: {subject}")
        print(f"BODY:\n{html_content}")
        print("-----------------------------------------")
        return True
    try:
        msg = EmailMessage()
        msg['Subject'] = subject
        msg['From'] = SMTP_USER
        msg['To'] = ", ".join(to_emails)
        msg.set_content("Please enable HTML viewing.", subtype='html')
        msg.add_alternative(html_content, subtype='html')
        
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
        return True
    except Exception as e:
        print(f"Failed to send email: {e}")
        return False

@app.post("/api/email/escalate")
async def email_escalate(req: EmailEscalateReq):
    subject = f"🚨 Escalation Alert Level {req.level} for {req.target}"
    body = f"<h2>Escalated Actions Level {req.level}</h2><ul>"
    for a in req.actions:
        body += f"<li><b>{a.get('sn')}</b>: {a.get('text')} - Overdue! (Priority: {a.get('priority')})</li>"
    body += "</ul>"
    
    recipient = "admin@adroit.in"
    send_email([recipient], subject, body)
    return {"status": "ok"}

@app.post("/api/email/share-insights")
async def email_share_insights(req: InsightsShareReq):
    subject = f"📊 Real-time Insights (5m) - {req.meeting_type} @ {req.plant}"
    body = f"<h2>Meeting Insights</h2>"
    for ins in req.insights:
        body += f"<h3>[Paragraph at {ins.get('ts')}]</h3><ul>"
        for act in ins.get('actions', []):
            body += f"<li><b>Action:</b> {act.get('text')} (Resp: {act.get('responsible')})</li>"
        for dec in ins.get('decisions', []):
            body += f"<li><b>Decision:</b> {dec}</li>"
        for rsk in ins.get('risks', []):
            body += f"<li><b>Risk:</b> {rsk}</li>"
        body += "</ul>"
        
    send_email(req.recipients if req.recipients else ["team@adroit.in"], subject, body)
    return {"status": "ok"}

# 6. Full transcript extraction (existing route)
@app.post("/api/meetings/extract-insights")
async def extract_insights(req: MeetingReviewReq):
    import datetime
    today = datetime.date.today().strftime("%Y-%m-%d")
    
    prompt = f"""
    You are an AI meeting assistant. Task: Analyze transcription and produce a consolidated action log.
    
    Follow these steps precisely:
    1. Identify Key Discussion Topics: Identify and list main topics. Summarize key points for each.
    2. Create an Action Log:
       - De-duplicate: Consolidate multiple mentions of same task.
       - Update Repeated Items: If an action is a repeat/follow-up on an item in 'PREVIOUS ACTIONS', do not create new row. Update its 'remarks' with a summary and date (e.g., "Discussed again on {today}: ...").
       - Fill Columns: Source: "Daily Meeting", Plant: "{req.plant}", Date: "{today}", Status: "IN PROCESS".
    
    Return ONLY a JSON object:
    {{
      "topics": [{{ "topic": "...", "summary": "..." }}],
      "actions": [
        {{
          "text": "...", "responsible": "...", "due": "YYYY-MM-DD", 
          "section": "...", "priority": "...", "remarks": "...", "is_update": true/false
        }}
      ]
    }}
    
    PREVIOUS ACTIONS (context): {json.dumps(req.previous_actions[:20])}
    
    TRANSCRIPT:
    {req.transcript}
    """
    try:
        model = genai.GenerativeModel('gemini-flash-lite-latest')
        res = model.generate_content(prompt)
        text = res.text
    except Exception as e:
        print(f"Extraction failed: {e}")
        text = call_ollama_fallback(prompt)
        if not text: return {"error": "Service unavailable", "actions": []}

    try:
        data = json.loads(clean_json_response(text))
        return data
    except Exception as e:
        print(f"Parse failed: {e}\nRaw: {text}")
        return {"error": "Format error", "actions": []}

# 7. Real-time paragraph analysis (called by frontend during live meeting)
@app.post("/api/meetings/analyze-paragraph")
async def analyze_paragraph(req: ParagraphAnalysisReq):
    # If Hindi input, instruct Gemini to handle Hindi-English mix (Hinglish)
    # Note: With smart frontend, source=hi means text may contain Devanagari OR Hinglish Roman
    lang_note = ""
    if req.source_lang == "hi":
        lang_note = "\nIMPORTANT: The paragraph may be in Hindi (Devanagari) OR Hinglish (Hindi words written in Roman/English letters). Understand the meaning fully and return ALL extracted insights in English only."
    
    prompt = f"""
    You are an expert meeting analyst. Extract structured insights from this meeting transcript paragraph.
    Return ONLY a JSON object with this exact shape — no markdown, no preamble:
    {{
      "actions": [{{"text":"...","responsible":"...","priority":"CRITICAL|WARNING|NORMAL","section":"..."}}],
      "decisions": ["..."],
      "risks": ["..."],
      "keyPoints": ["..."]
    }}
    - actions: concrete tasks assigned to someone (responsible can be empty string if unclear)
    - decisions: things decided/agreed upon
    - risks: concerns, blockers, issues raised
    - keyPoints: important facts or observations
    Keep each item concise (under 15 words). Return empty arrays if nothing found.{lang_note}

    Meeting type: {req.meeting_type}
    Transcript paragraph:
    "{req.paragraph}"
    """

    try:
        model = genai.GenerativeModel('gemini-flash-lite-latest')
        response = model.generate_content(prompt)
        text_resp = response.text
    except Exception as e:
        print(f"Gemini API failed in analyze_paragraph: {e}")
        text_resp = call_ollama_fallback(prompt)
        if not text_resp:
            return {"actions": [], "decisions": [], "risks": [], "keyPoints": []}

    try:
        clean_json = clean_json_response(text_resp)
        parsed = json.loads(clean_json)
        return parsed

    except Exception as e:
        print(f"Paragraph analysis parsing failed: {e}")
        print(f"RAW RESP: {text_resp}")
        return {"actions": [], "decisions": [], "risks": [], "keyPoints": []}

# 8. Hindi to English translation (real-time during meeting)
@app.post("/api/translate")
async def translate_text(req: TranslateReq):
    if not req.text or len(req.text.strip()) < 2:
        return {"translated": req.text, "original": req.text}
    
    lang_names = {"hi": "Hindi", "en": "English", "mr": "Marathi", "gu": "Gujarati", "cg": "Chhattisgarhi"}
    src_name = lang_names.get(req.source, req.source)
    tgt_name = lang_names.get(req.target, req.target)
    
    prompt = f"""Translate the following {src_name} text to {tgt_name}.
Return ONLY the translated text, nothing else. No quotes, no explanation.
If the text is already in {tgt_name} or contains mixed languages, translate only the non-{tgt_name} parts.
Preserve all proper nouns (person names, place names, company names) as-is.

Text: {req.text}"""
    
    try:
        model = genai.GenerativeModel('gemini-flash-lite-latest')
        response = model.generate_content(prompt)
        translated = response.text.strip()
        return {"translated": translated, "original": req.text}
    except Exception as e:
        print(f"Gemini Translation failed: {e}")
        text_resp = call_ollama_fallback(prompt)
        if text_resp:
            return {"translated": text_resp.strip(), "original": req.text}
        return {"translated": req.text, "original": req.text, "error": str(e)}