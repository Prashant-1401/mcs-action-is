from fastapi import APIRouter, Depends
from app.schemas.schemas import TranslateReq
from app.services.ai_service import translate_text
from app.middleware.auth import require_api_key

router = APIRouter(prefix="/api/translate", tags=["Translate"])


@router.post("/", dependencies=[Depends(require_api_key)])
async def api_translate(req: TranslateReq):
    return translate_text(text=req.text, source=req.source, target=req.target)
