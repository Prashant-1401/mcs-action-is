from fastapi import APIRouter, Depends
from app.schemas.schemas import InsightsShareReq
from app.services.email_service import share_insights_email
from app.services.whatsapp_service import share_insights_whatsapp
from app.middleware.auth import require_api_key

router = APIRouter(prefix="/api/email", tags=["Email"])


@router.post("/share-insights", dependencies=[Depends(require_api_key)])
async def api_share_insights(req: InsightsShareReq):
    share_insights_email(req.insights, req.meeting_type, req.plant, req.recipients)
    wa_failed = share_insights_whatsapp(req.insights, req.meeting_type, req.plant, req.phones)
    return {"status": "ok", "whatsapp_failed": wa_failed}
