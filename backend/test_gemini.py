"""
test_gemini.py — verifies your Gemini API key and model availability.
Uses the NEW google-genai SDK (v2+). Run: python test_gemini.py
"""
import os
from dotenv import load_dotenv

load_dotenv()

key = os.environ.get("GEMINI_API_KEY", "")
if not key:
    print("Error: GEMINI_API_KEY not found in environment / .env file")
    exit(1)

print(f"API key found: {key[:8]}...")

# Use the NEW SDK
try:
    from google import genai
except ImportError:
    print("google-genai package not installed. Run: pip install google-genai")
    exit(1)

client = genai.Client(api_key=key)

MODELS_TO_TEST = [
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
]

print("\n-- Testing models --")
for model_id in MODELS_TO_TEST:
    try:
        response = client.models.generate_content(
            model=model_id,
            contents="Reply with exactly three words: API is working"
        )
        print(f"  OK  {model_id}: {response.text.strip()}")
    except Exception as e:
        err = str(e)
        if "404" in err or "not found" in err.lower():
            print(f"  FAIL {model_id}: Model not found / not available on your key")
        elif "403" in err or "permission" in err.lower():
            print(f"  FAIL {model_id}: Permission denied")
        elif "429" in err:
            print(f"  WARN {model_id}: Rate limited")
        else:
            print(f"  FAIL {model_id}: {err[:120]}")

print("\n-- Models available on your key --")
try:
    for m in client.models.list():
        if "gemini" in m.name.lower():
            print(f"  {m.name}")
except Exception as e:
    print(f"  Could not list models: {e}")
