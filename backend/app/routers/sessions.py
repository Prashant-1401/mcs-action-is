import uuid
import datetime as _dt
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.database import get_db, async_session
from app.models.models import UserSession, User
from app.middleware.auth import require_api_key, get_current_user, decode_token

router = APIRouter(prefix="/api/sessions", tags=["Sessions"], dependencies=[Depends(require_api_key)])

SESSION_TTL_MINUTES = 60 * 24 * 7  # mark sessions stale after 7 days of no activity


def _parse_ua(ua: str):
    ua = ua or ""
    browser = "Unknown"
    if "Edg/" in ua:
        browser = "Edge"
    elif "Chrome/" in ua and "Chromium" not in ua:
        browser = "Chrome"
    elif "Firefox/" in ua:
        browser = "Firefox"
    elif "Safari/" in ua and "Chrome" not in ua:
        browser = "Safari"
    device = "Desktop"
    if "Mobile" in ua or "Android" in ua:
        device = "Mobile"
    elif "Tablet" in ua or "iPad" in ua:
        device = "Tablet"
    return device, browser


async def register_session(request: Request, token: str, username: str):
    """Create / refresh a UserSession row for the given JWT (keyed by its jti)."""
    try:
        payload = decode_token(token)
    except Exception:
        return
    jti = payload.get("jti")
    if not jti:
        return
    async with async_session() as db:
        user_q = await db.execute(select(User).where(User.username == username))
        user = user_q.scalar_one_or_none()
        if not user:
            return
        device, browser = _parse_ua(request.headers.get("user-agent", ""))
        ip = (request.client.host if request.client else None) or request.headers.get("x-forwarded-for", "").split(",")[0].strip() or None
        now = _dt.datetime.now(_dt.timezone.utc)
        sess_q = await db.execute(select(UserSession).where(UserSession.token_jti == jti))
        sess = sess_q.scalar_one_or_none()
        if sess:
            sess.last_seen = now
            sess.ip = ip
        else:
            sess = UserSession(
                id=str(uuid.uuid4()),
                user_id=user.id,
                token_jti=jti,
                device=device,
                browser=browser,
                ip=ip,
                created_at=now,
                last_seen=now,
            )
            db.add(sess)
        await db.commit()


async def touch_session(token: str):
    """Lightweight last_seen heartbeat used by the polling sync endpoint."""
    if not token:
        return
    try:
        payload = decode_token(token)
    except Exception:
        return
    jti = payload.get("jti")
    if not jti:
        return
    async with async_session() as db:
        sess_q = await db.execute(select(UserSession).where(UserSession.token_jti == jti))
        sess = sess_q.scalar_one_or_none()
        if sess:
            sess.last_seen = _dt.datetime.now(_dt.timezone.utc)
            await db.commit()


async def revoke_session(token: str):
    if not token:
        return
    try:
        payload = decode_token(token)
    except Exception:
        return
    jti = payload.get("jti")
    if not jti:
        return
    async with async_session() as db:
        await db.execute(delete(UserSession).where(UserSession.token_jti == jti))
        await db.commit()


@router.get("/mine")
async def list_my_sessions(request: Request, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    if not current_user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    auth = request.headers.get("authorization", "")
    token = auth.replace("Bearer ", "") if auth.lower().startswith("bearer ") else None
    current_jti = None
    if token:
        try:
            current_jti = decode_token(token).get("jti")
        except Exception:
            current_jti = None
    cutoff = _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(minutes=SESSION_TTL_MINUTES)
    result = await db.execute(
        select(UserSession)
        .where(UserSession.user_id == current_user["id"], UserSession.last_seen >= cutoff)
        .order_by(UserSession.last_seen.desc())
    )
    sessions = result.scalars().all()
    return [
        {
            "id": s.id,
            "device": s.device,
            "browser": s.browser,
            "ip": s.ip,
            "location": s.location,
            "created_at": str(s.created_at) if s.created_at else None,
            "last_seen": str(s.last_seen) if s.last_seen else None,
            "is_current": (s.token_jti == current_jti),
        }
        for s in sessions
    ]


@router.delete("/{session_id}")
async def revoke_session_by_id(session_id: str, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    if not current_user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    result = await db.execute(
        select(UserSession).where(UserSession.id == session_id, UserSession.user_id == current_user["id"])
    )
    sess = result.scalar_one_or_none()
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    await db.delete(sess)
    await db.commit()
    return {"ok": True}


@router.delete("/all/others")
async def revoke_other_sessions(request: Request, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    if not current_user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    auth = request.headers.get("authorization", "")
    token = auth.replace("Bearer ", "") if auth.lower().startswith("bearer ") else None
    current_jti = None
    if token:
        try:
            current_jti = decode_token(token).get("jti")
        except Exception:
            current_jti = None
    if current_jti:
        await db.execute(
            delete(UserSession).where(
                UserSession.user_id == current_user["id"],
                UserSession.token_jti != current_jti,
            )
        )
    else:
        await db.execute(delete(UserSession).where(UserSession.user_id == current_user["id"]))
    await db.commit()
    return {"ok": True}


@router.post("/heartbeat")
async def heartbeat(request: Request, current_user: dict = Depends(get_current_user)):
    """Lightweight endpoint the client polls to keep the session alive and
    to let the backend know the user is actively online."""
    if not current_user:
        return {"ok": True}
    auth = request.headers.get("authorization", "")
    token = auth.replace("Bearer ", "") if auth.lower().startswith("bearer ") else None
    try:
        await touch_session(token)
    except Exception:
        pass
    return {"ok": True, "ts": int(_dt.datetime.now(_dt.timezone.utc).timestamp())}
