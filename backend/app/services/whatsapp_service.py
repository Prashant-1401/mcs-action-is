import requests
from typing import List, Dict, Any
from app.config import settings


def send_whatsapp_alert(phone: str, message: str) -> bool:
    if not phone:
        print("Skipping WhatsApp alert: Target phone number is missing.")
        return False
    if not settings.wacrm_alert_url:
        print("Skipping WhatsApp alert: WACRM_ALERT_URL not configured.")
        return False
    try:
        payload = {"phone": phone, "message": message}
        headers = {"Content-Type": "application/json"}
        response = requests.post(settings.wacrm_alert_url, json=payload, headers=headers, timeout=15)
        if response.status_code == 200:
            print(f"WhatsApp alert sent to: {phone}")
            return True
        else:
            print(f"wacrm gateway rejected ({response.status_code}): {response.text[:200]}")
            return False
    except requests.Timeout:
        print(f"wacrm gateway timeout for phone: {phone}")
        return False
    except requests.ConnectionError as e:
        print(f"wacrm gateway connection error: {e}")
        return False
    except Exception as e:
        print(f"wacrm gateway error: {type(e).__name__}: {e}")
        return False


def share_insights_whatsapp(insights: List[Dict[str, Any]], meeting_type: str, plant: str, phones: List[str]) -> List[str]:
    failed = []
    for p in phones:
        message = f"*Real-time Insights*\n{meeting_type} @ {plant}\n"
        for ins in insights:
            if ins.get("actions"):
                message += "\n*Actions:*\n"
                for act in ins["actions"]:
                    message += f"• {act.get('text')} (Resp: {act.get('responsible')})\n"
            if ins.get("decisions"):
                message += "\n*Decisions:*\n"
                for dec in ins["decisions"]:
                    message += f"• {dec}\n"
        if not send_whatsapp_alert(p, message):
            failed.append(p)
    return failed
