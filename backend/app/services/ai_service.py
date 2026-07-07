import json
import datetime
from typing import List, Dict, Any
from app.config import settings

GEMINI_API_KEY = settings.gemini_api_key
GEMINI_MODEL = settings.gemini_model

gemini_client = None
if GEMINI_API_KEY:
    from google import genai as google_genai
    gemini_client = google_genai.Client(api_key=GEMINI_API_KEY)


def gemini_generate(prompt: str) -> str:
    if not gemini_client:
        return ""
    models_to_try = [GEMINI_MODEL]
    for m in ["gemini-2.5-flash-lite", "gemini-2.5-flash"]:
        if m not in models_to_try:
            models_to_try.append(m)
    for model_id in models_to_try:
        try:
            response = gemini_client.models.generate_content(
                model=model_id,
                contents=prompt
            )
            return response.text
        except Exception as e:
            print(f"Gemini failed ({model_id}): {e}")
    return ""


def clean_json_response(text: str) -> str:
    text = text.strip()
    if "```json" in text:
        try:
            start = text.index("```json") + 7
            end = text.rindex("```")
            return text[start:end].strip()
        except Exception:
            pass
    elif "```" in text:
        try:
            start = text.index("```") + 3
            end = text.rindex("```")
            return text[start:end].strip()
        except Exception:
            pass
    try:
        first_obj = text.find("{")
        first_arr = text.find("[")
        last_obj = text.rfind("}")
        last_arr = text.rfind("]")
        starts = [x for x in [first_obj, first_arr] if x != -1]
        ends = [x for x in [last_obj, last_arr] if x != -1]
        if starts and ends:
            return text[min(starts):max(ends) + 1].strip()
    except Exception:
        pass
    return text


def extract_insights(transcript: str, meeting_type: str, plant: str, previous_actions: List[Dict[str, Any]]) -> Dict[str, Any]:
    today = datetime.date.today().strftime("%Y-%m-%d")
    prompt = f"""
You are an AI meeting assistant. Analyze this transcript and produce a structured action log.

Steps:
1. Identify main discussion topics with short summaries.
2. Extract concrete action items — de-duplicate, and if an item matches PREVIOUS ACTIONS update its remarks.
   Fill: Source="Daily Meeting", Plant="{plant}", Date="{today}", Status="IN PROCESS"

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

PREVIOUS ACTIONS: {json.dumps(previous_actions[:20])}

TRANSCRIPT:
{transcript}
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


def analyze_paragraph(paragraph: str, meeting_type: str, source_lang: str = "en") -> Dict[str, Any]:
    lang_note = ""
    if source_lang == "hi":
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

Meeting type: {meeting_type}
Paragraph: "{paragraph}"
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


def translate_text(text: str, source: str = "hi", target: str = "en") -> Dict[str, str]:
    if not text or len(text.strip()) < 2:
        return {"translated": text, "original": text}

    lang_names = {
        "hi": "Hindi", "en": "English",
        "mr": "Marathi", "gu": "Gujarati", "cg": "Chhattisgarhi"
    }
    src = lang_names.get(source, source)
    tgt = lang_names.get(target, target)

    prompt = f"""Translate the following {src} text to {tgt}.
Return ONLY the translated text — no quotes, no explanation.
If text is already in {tgt} or mixed, translate only the non-{tgt} parts.
Preserve proper nouns (names, places, brands) as-is.

Text: {text}"""

    result = gemini_generate(prompt)
    if result:
        return {"translated": result.strip(), "original": text}
    return {"translated": text, "original": text, "error": "Translation unavailable"}
