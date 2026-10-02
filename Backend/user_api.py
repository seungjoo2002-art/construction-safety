"""
user_api.py — 인증 + 사용자별 데이터 API (/api/auth/*, /api/me/*)
====================================================================
현재 사용자는 오직 Authorization: Bearer <token> 헤더로만 결정한다(서버가 발급한 세션 토큰).
요청 본문/쿼리로 들어온 user_id 같은 값은 받지도, 쓰지도 않는다.
모든 /api/me/* 핸들러는 current_user_id 의존성을 거치고, user_store의 함수에
그 user_id를 넘겨 `WHERE ... AND user_id = ?`로만 조회/수정/삭제한다.
다른 사용자의 레코드 id로 요청하면 존재 여부도 드러내지 않도록 404로 응답한다.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field

from user_store import UserStore

router = APIRouter()
_store: Optional[UserStore] = None


def get_store() -> UserStore:
    global _store
    if _store is None:
        _store = UserStore()
        print(f"[user_api.py] 사용자 DB 초기화 완료 — {_store.backend}")
    return _store


def _bearer(authorization: Optional[str]) -> Optional[str]:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None
    return None


def current_user_id(authorization: Optional[str] = Header(default=None)) -> str:
    token = _bearer(authorization)
    uid = get_store().user_id_for_token(token) if token else None
    if not uid:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다", headers={"WWW-Authenticate": "Bearer"})
    return uid


def _not_found():
    return HTTPException(status_code=404, detail="기록을 찾을 수 없습니다")


# ── 인증 ───────────────────────────────────────────────────
class SignupIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)
    name: str = Field(default="", max_length=64)
    birthdate: str = Field(default="", max_length=10)
    prefs: Dict[str, Any] = Field(default_factory=dict)


class LoginIn(BaseModel):
    username: str
    password: str


@router.post("/api/auth/signup", status_code=201)
def signup(body: SignupIn):
    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="아이디를 입력하세요")
    prefs = {k: body.prefs[k] for k in ("language", "largeText", "highContrast") if k in body.prefs}
    prefs["setupCompleted"] = False
    user = get_store().create_user(username, body.password, body.name.strip(), body.birthdate, prefs)
    if user is None:
        raise HTTPException(status_code=409, detail="이미 사용 중인 아이디입니다")
    return {"user": user}


@router.post("/api/auth/login")
def login(body: LoginIn):
    store = get_store()
    uid = store.authenticate(body.username.strip(), body.password)
    if not uid:
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 올바르지 않습니다")
    return {"token": store.create_session(uid), "user": store.get_user(uid)}


@router.post("/api/auth/logout", status_code=204)
def logout(authorization: Optional[str] = Header(default=None)):
    token = _bearer(authorization)
    if token:
        get_store().delete_session(token)
    return Response(status_code=204)


# ── 내 정보 / 설정 / 현장 정보 ────────────────────────────────
@router.get("/api/me")
def me(uid: str = Depends(current_user_id)):
    return {"user": get_store().get_user(uid)}


class PrefsIn(BaseModel):
    prefs: Dict[str, Any]


_ALLOWED_PREFS = {"language", "largeText", "highContrast", "setupCompleted", "notifPush", "notifAlert"}


@router.patch("/api/me/prefs")
def update_prefs(body: PrefsIn, uid: str = Depends(current_user_id)):
    partial = {k: v for k, v in body.prefs.items() if k in _ALLOWED_PREFS}
    return {"prefs": get_store().update_prefs(uid, partial)}


class SiteSetupIn(BaseModel):
    data: Dict[str, Any]


@router.get("/api/me/site-setup")
def get_site_setup(uid: str = Depends(current_user_id)):
    return {"data": get_store().get_site_setup(uid)}


@router.put("/api/me/site-setup")
def put_site_setup(body: SiteSetupIn, uid: str = Depends(current_user_id)):
    store = get_store()
    store.set_site_setup(uid, body.data)
    store.update_prefs(uid, {"setupCompleted": True})
    return {"data": body.data}


# ── 위험도 분석 기록 ─────────────────────────────────────────
class AnalysisIn(BaseModel):
    result: Dict[str, Any]
    input: Optional[Dict[str, Any]] = None
    sim: Optional[Dict[str, Any]] = None
    advise: Optional[Dict[str, Any]] = None


class NoteIn(BaseModel):
    note: str = Field(max_length=500)


@router.get("/api/me/analyses")
def list_analyses(limit: int = 50, uid: str = Depends(current_user_id)):
    return {"items": get_store().list_analyses(uid, max(1, min(limit, 200)))}


@router.post("/api/me/analyses", status_code=201)
def create_analysis(body: AnalysisIn, uid: str = Depends(current_user_id)):
    return get_store().add_analysis(uid, body.result, body.input, body.sim, body.advise)


@router.get("/api/me/analyses/{rid}")
def get_analysis(rid: str, uid: str = Depends(current_user_id)):
    row = get_store().get_analysis(uid, rid)
    if not row:
        raise _not_found()
    return row


@router.patch("/api/me/analyses/{rid}")
def patch_analysis(rid: str, body: NoteIn, uid: str = Depends(current_user_id)):
    if not get_store().update_analysis_note(uid, rid, body.note):
        raise _not_found()
    return {"id": rid, "note": body.note}


@router.delete("/api/me/analyses/{rid}", status_code=204)
def delete_analysis(rid: str, uid: str = Depends(current_user_id)):
    if not get_store().delete_analysis(uid, rid):
        raise _not_found()
    return Response(status_code=204)


# ── 사진 분석 기록 ───────────────────────────────────────────
class PhotoIn(BaseModel):
    result: Dict[str, Any]
    thumbnail: Optional[str] = Field(default=None, max_length=400_000)


@router.get("/api/me/photo-analyses")
def list_photos(limit: int = 50, uid: str = Depends(current_user_id)):
    return {"items": get_store().list_photos(uid, max(1, min(limit, 200)))}


@router.post("/api/me/photo-analyses", status_code=201)
def create_photo(body: PhotoIn, uid: str = Depends(current_user_id)):
    return get_store().add_photo(uid, body.result, body.thumbnail)


@router.get("/api/me/photo-analyses/{rid}")
def get_photo(rid: str, uid: str = Depends(current_user_id)):
    row = get_store().get_photo(uid, rid)
    if not row:
        raise _not_found()
    return row


@router.patch("/api/me/photo-analyses/{rid}")
def patch_photo(rid: str, body: NoteIn, uid: str = Depends(current_user_id)):
    if not get_store().update_photo_note(uid, rid, body.note):
        raise _not_found()
    return {"id": rid, "note": body.note}


@router.delete("/api/me/photo-analyses/{rid}", status_code=204)
def delete_photo(rid: str, uid: str = Depends(current_user_id)):
    if not get_store().delete_photo(uid, rid):
        raise _not_found()
    return Response(status_code=204)


# ── 알림: 본인 분석/사진 기록에서만 만든다(고정 예시 알림 없음) ─────────────
@router.get("/api/me/notifications")
def notifications(uid: str = Depends(current_user_id)):
    store = get_store()
    return {
        "analyses": store.list_analyses(uid, 50),
        "photos": store.list_photos(uid, 50),
        "last_seen_at": store.get_notif_last_seen(uid),
    }


@router.post("/api/me/notifications/seen")
def notifications_seen(uid: str = Depends(current_user_id)):
    return {"last_seen_at": get_store().mark_notif_seen(uid)}


# ── 사례 즐겨찾기 ───────────────────────────────────────────
class FavoriteIn(BaseModel):
    data: Dict[str, Any]


@router.get("/api/me/favorites/{case_id}")
def get_favorite(case_id: str, uid: str = Depends(current_user_id)):
    return {"favorite": get_store().is_favorite(uid, case_id)}


@router.put("/api/me/favorites/{case_id}")
def put_favorite(case_id: str, body: FavoriteIn, uid: str = Depends(current_user_id)):
    get_store().set_favorite(uid, case_id, body.data)
    return {"favorite": True}


@router.delete("/api/me/favorites/{case_id}")
def delete_favorite(case_id: str, uid: str = Depends(current_user_id)):
    get_store().delete_favorite(uid, case_id)
    return {"favorite": False}
