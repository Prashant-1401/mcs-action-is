import google.generativeai as genai
import os
from dotenv import load_dotenv

load_dotenv()
key = os.environ.get("GEMINI_API_KEY", "")
if not key:
    print("Error: GEMINI_API_KEY not found in environment")
    exit(1)
genai.configure(api_key=key)

try:
    model = genai.GenerativeModel('gemini-1.5-flash') # Try 1.5 flash first as 2.0 might be restricted or newer
    response = model.generate_content("Hello, how are you?")
    print("Gemini 1.5 Success:", response.text)
except Exception as e:
    print("Gemini 1.5 Failed:", e)

try:
    model = genai.GenerativeModel('gemini-2.0-flash')
    response = model.generate_content("Hello, how are you?")
    print("Gemini 2.0 Success:", response.text)
except Exception as e:
    print("Gemini 2.0 Failed:", e)
