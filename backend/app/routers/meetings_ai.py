from fastapi import APIRouter, Depends
from app.schemas.schemas import MeetingReviewReq, ParagraphAnalysisReq
from app.services.ai_service import extract_insights, analyze_paragraph
from app.middleware.auth import require_api_key

router = APIRouter(prefix="/api/meetings", tags=["Meeting AI"])


@router.post("/extract-insights", dependencies=[Depends(require_api_key)])
async def api_extract_insights(req: MeetingReviewReq):
    return extract_insights(
        transcript=req.transcript,
        meeting_type=req.meeting_type,
        plant=req.plant,
        previous_actions=req.previous_actions,
    )


@router.post("/analyze-paragraph", dependencies=[Depends(require_api_key)])
async def api_analyze_paragraph(req: ParagraphAnalysisReq):
    return analyze_paragraph(
        paragraph=req.paragraph,
        meeting_type=req.meeting_type,
        source_lang=req.source_lang,
    )
