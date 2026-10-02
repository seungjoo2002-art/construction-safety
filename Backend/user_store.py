"""
user_store.py — 계정 + 사용자별 데이터 저장소 (서버 DB)
==========================================================
예전에는 계정·분석기록·사진분석기록·알림 상태가 전부 브라우저 localStorage에 있었고,
분석 기록(saved_results / saved_photo_results)은 계정과 무관한 "브라우저 전역" 키라서
같은 브라우저에서 다른 계정으로 로그인하면 이전 계정의 기록·알림이 그대로 보였다.

이 모듈은 그 데이터를 서버 DB로 옮기고, 모든 사용자 데이터 테이블에 user_id(소유자)를
NOT NULL로 둔다. 조회/수정/삭제 함수는 전부 user_id를 필수 인자로 받아
`WHERE ... AND user_id = ?`로만 접근한다 — 소유자 조건 없이 레코드를 읽는 함수는 없다.

DB 선택:
  - DATABASE_URL이 postgres://… / postgresql://… 이면 PostgreSQL (psycopg 3 필요)
  - 아니면 SQLite 파일 (USER_DB_PATH, 기본 Backend/data/users.db)
  ⚠️ Render 무료 Web Service의 디스크는 재배포/재시작 때마다 초기화된다. 운영에서는
     반드시 DATABASE_URL(영구 Postgres)을 설정하거나 Persistent Disk에 USER_DB_PATH를 둘 것.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

SESSION_TTL_DAYS = 30
PBKDF2_ITERATIONS = 200_000
MAX_RECORDS_PER_USER = 200  # 사용자별 분석 기록 보관 상한(오래된 것부터 정리)

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        birthdate TEXT NOT NULL DEFAULT '',
        prefs TEXT NOT NULL DEFAULT '{}',
        site_setup TEXT,
        notif_last_seen_at TEXT,
        created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS analyses (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        score INTEGER,
        grade TEXT,
        top_type TEXT,
        note TEXT NOT NULL DEFAULT '',
        result TEXT NOT NULL,
        input TEXT,
        sim TEXT,
        advise TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS photo_analyses (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        grade TEXT,
        note TEXT NOT NULL DEFAULT '',
        result TEXT NOT NULL,
        thumbnail TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS favorites (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        case_id TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, case_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_analyses_user ON analyses(user_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_photo_user ON photo_analyses(user_id, created_at)",
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_password(password: str, salt: Optional[bytes] = None) -> str:
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt_hex, dk_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iters))
        return algo == "pbkdf2_sha256" and hmac.compare_digest(dk.hex(), dk_hex)
    except Exception:
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _dumps(v: Any) -> Optional[str]:
    return None if v is None else json.dumps(v, ensure_ascii=False)


def _loads(v: Optional[str]) -> Any:
    return None if v is None else json.loads(v)


class UserStore:
    def __init__(self, database_url: Optional[str] = None, sqlite_path: Optional[str] = None):
        url = (database_url if database_url is not None else os.environ.get("DATABASE_URL", "")).strip()
        self.is_pg = url.startswith(("postgres://", "postgresql://"))
        self._lock = threading.Lock()
        if self.is_pg:
            import psycopg  # requirements.txt: psycopg[binary]

            self._pg_url = url
            self.backend = "postgres"
        else:
            path = sqlite_path or os.environ.get("USER_DB_PATH") or str(Path(__file__).parent / "data" / "users.db")
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            self._sqlite_path = path
            self.backend = f"sqlite:{path}"
        self._init_schema()

    # ── 연결/쿼리 헬퍼: SQL은 '?' 플레이스홀더로 쓰고 Postgres일 때만 '%s'로 바꾼다
    def _connect(self):
        if self.is_pg:
            import psycopg

            return psycopg.connect(self._pg_url)
        conn = sqlite3.connect(self._sqlite_path, timeout=10)
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _run(self, sql: str, params: tuple = (), fetch: str = "none"):
        if self.is_pg:
            sql = sql.replace("?", "%s")
        with self._lock:
            conn = self._connect()
            try:
                cur = conn.cursor()
                cur.execute(sql, params)
                cols = [d[0] for d in cur.description] if cur.description else []
                if fetch == "one":
                    row = cur.fetchone()
                    out = dict(zip(cols, row)) if row else None
                elif fetch == "all":
                    out = [dict(zip(cols, r)) for r in cur.fetchall()]
                else:
                    out = cur.rowcount
                conn.commit()
                return out
            finally:
                conn.close()

    def _init_schema(self):
        for stmt in SCHEMA:
            self._run(stmt)

    # ── 계정 ───────────────────────────────────────────────
    def create_user(self, username: str, password: str, name: str = "", birthdate: str = "",
                    prefs: Optional[dict] = None) -> Optional[Dict[str, Any]]:
        """새 계정 생성. 아이디가 이미 있으면 None."""
        uid = uuid.uuid4().hex
        try:
            self._run(
                "INSERT INTO users (id, username, password_hash, name, birthdate, prefs, created_at) VALUES (?,?,?,?,?,?,?)",
                (uid, username, _hash_password(password), name, birthdate, _dumps(prefs or {}), _now()),
            )
        except Exception as e:  # UNIQUE 위반 (sqlite3.IntegrityError / psycopg.errors.UniqueViolation)
            if "unique" in str(e).lower() or "duplicate" in str(e).lower():
                return None
            raise
        return self.get_user(uid)

    def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        row = self._run("SELECT id, username, name, birthdate, prefs, created_at FROM users WHERE id = ?",
                        (user_id,), "one")
        if row:
            row["prefs"] = _loads(row["prefs"]) or {}
        return row

    def authenticate(self, username: str, password: str) -> Optional[str]:
        """아이디/비밀번호가 맞으면 user_id, 아니면 None. (아이디 존재 여부는 호출자에게 구분해 주지 않는다)"""
        row = self._run("SELECT id, password_hash FROM users WHERE username = ?", (username,), "one")
        if row and _verify_password(password, row["password_hash"]):
            return row["id"]
        return None

    def update_prefs(self, user_id: str, partial: dict) -> dict:
        user = self.get_user(user_id)
        prefs = {**(user["prefs"] if user else {}), **partial}
        self._run("UPDATE users SET prefs = ? WHERE id = ?", (_dumps(prefs), user_id))
        return prefs

    # ── 세션(토큰) ─────────────────────────────────────────
    def create_session(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc)
        self._run(
            "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)",
            (_token_hash(token), user_id, now.isoformat(), (now + timedelta(days=SESSION_TTL_DAYS)).isoformat()),
        )
        return token

    def user_id_for_token(self, token: str) -> Optional[str]:
        row = self._run("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?", (_token_hash(token),), "one")
        if not row:
            return None
        if datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc):
            self.delete_session(token)
            return None
        return row["user_id"]

    def delete_session(self, token: str) -> None:
        self._run("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))

    # ── 현장 정보 / 알림 읽음 시각 (users 행에 귀속 — 본인 행만 갱신) ──
    def get_site_setup(self, user_id: str) -> Optional[dict]:
        row = self._run("SELECT site_setup FROM users WHERE id = ?", (user_id,), "one")
        return _loads(row["site_setup"]) if row else None

    def set_site_setup(self, user_id: str, data: dict) -> None:
        self._run("UPDATE users SET site_setup = ? WHERE id = ?", (_dumps(data), user_id))

    def get_notif_last_seen(self, user_id: str) -> Optional[str]:
        row = self._run("SELECT notif_last_seen_at FROM users WHERE id = ?", (user_id,), "one")
        return row["notif_last_seen_at"] if row else None

    def mark_notif_seen(self, user_id: str) -> str:
        now = _now()
        self._run("UPDATE users SET notif_last_seen_at = ? WHERE id = ?", (now, user_id))
        return now

    # ── 위험도 분석 기록 ───────────────────────────────────
    def add_analysis(self, user_id: str, result: dict, input: Optional[dict], sim: Optional[dict],
                     advise: Optional[dict]) -> Dict[str, Any]:
        rid = uuid.uuid4().hex
        fr = (result.get("severity") or {}).get("fatal_risk") or {}
        score = round(fr["percentile"]) if isinstance(fr.get("percentile"), (int, float)) else None
        self._run(
            "INSERT INTO analyses (id, user_id, created_at, score, grade, top_type, result, input, sim, advise) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (rid, user_id, _now(), score, fr.get("grade"),
             (result.get("accident_type") or {}).get("predicted_type"),
             _dumps(result), _dumps(input), _dumps(sim), _dumps(advise)),
        )
        self._prune("analyses", user_id)
        return self.get_analysis(user_id, rid)

    def list_analyses(self, user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        # 목록은 가벼운 필드만(유사도 산점도 이미지·예방대책 원문 제외) — 알림/기록/통계 화면용
        rows = self._run(
            "SELECT id, created_at, score, grade, top_type, note, result FROM analyses "
            "WHERE user_id = ? ORDER BY created_at DESC LIMIT ?", (user_id, limit), "all")
        for r in rows:
            r["result"] = _loads(r["result"])
        return rows

    def get_analysis(self, user_id: str, rid: str) -> Optional[Dict[str, Any]]:
        row = self._run("SELECT * FROM analyses WHERE id = ? AND user_id = ?", (rid, user_id), "one")
        if row:
            for k in ("result", "input", "sim", "advise"):
                row[k] = _loads(row[k])
            row.pop("user_id", None)
        return row

    def update_analysis_note(self, user_id: str, rid: str, note: str) -> bool:
        return self._run("UPDATE analyses SET note = ? WHERE id = ? AND user_id = ?", (note, rid, user_id)) > 0

    def delete_analysis(self, user_id: str, rid: str) -> bool:
        return self._run("DELETE FROM analyses WHERE id = ? AND user_id = ?", (rid, user_id)) > 0

    # ── 사진 분석 기록 ─────────────────────────────────────
    def add_photo(self, user_id: str, result: dict, thumbnail: Optional[str]) -> Dict[str, Any]:
        rid = uuid.uuid4().hex
        self._run(
            "INSERT INTO photo_analyses (id, user_id, created_at, grade, result, thumbnail) VALUES (?,?,?,?,?,?)",
            (rid, user_id, _now(), result.get("grade"), _dumps(result), thumbnail),
        )
        self._prune("photo_analyses", user_id)
        return self.get_photo(user_id, rid)

    def list_photos(self, user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        rows = self._run(
            "SELECT id, created_at, grade, note, result FROM photo_analyses "
            "WHERE user_id = ? ORDER BY created_at DESC LIMIT ?", (user_id, limit), "all")
        for r in rows:
            r["result"] = _loads(r["result"])
        return rows

    def get_photo(self, user_id: str, rid: str) -> Optional[Dict[str, Any]]:
        row = self._run("SELECT * FROM photo_analyses WHERE id = ? AND user_id = ?", (rid, user_id), "one")
        if row:
            row["result"] = _loads(row["result"])
            row.pop("user_id", None)
        return row

    def update_photo_note(self, user_id: str, rid: str, note: str) -> bool:
        return self._run("UPDATE photo_analyses SET note = ? WHERE id = ? AND user_id = ?", (note, rid, user_id)) > 0

    def delete_photo(self, user_id: str, rid: str) -> bool:
        return self._run("DELETE FROM photo_analyses WHERE id = ? AND user_id = ?", (rid, user_id)) > 0

    # ── 사례 즐겨찾기 ─────────────────────────────────────
    def set_favorite(self, user_id: str, case_id: str, data: dict) -> None:
        self._run(
            "INSERT INTO favorites (user_id, case_id, data, created_at) VALUES (?,?,?,?) "
            "ON CONFLICT (user_id, case_id) DO UPDATE SET data = excluded.data",
            (user_id, case_id, _dumps(data), _now()),
        )

    def is_favorite(self, user_id: str, case_id: str) -> bool:
        return self._run("SELECT 1 AS x FROM favorites WHERE user_id = ? AND case_id = ?", (user_id, case_id), "one") is not None

    def delete_favorite(self, user_id: str, case_id: str) -> bool:
        return self._run("DELETE FROM favorites WHERE user_id = ? AND case_id = ?", (user_id, case_id)) > 0

    def _prune(self, table: str, user_id: str) -> None:
        self._run(
            f"DELETE FROM {table} WHERE user_id = ? AND id NOT IN ("
            f"SELECT id FROM {table} WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)",
            (user_id, user_id, MAX_RECORDS_PER_USER),
        )
