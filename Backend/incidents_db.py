"""
incidents_db.py — 사고 사례 DB(assets/df_db.csv)를 SQLite로 사전 처리해 조회하는 계층
====================================================================================
기존에는 app.py가 서버 시작 시점에 df_db.csv(30MB) 전체를 pandas DataFrame으로
읽어 메모리에 계속 들고 있었고, similarity_service.py도 같은 파일을 독립적으로
또 한 번 읽어(유사도 분석 시) 동일 데이터가 이중으로 상주하는 구조였습니다.

이 모듈은 df_db.csv를 최초 요청 시 딱 1번만 읽어 assets/incidents.db(SQLite)로
변환하고, 이후에는 필요한 조건의 행만 SQL로 조회해서 반환합니다.
  - 서버 시작 시점에는 아무 것도 로드하지 않습니다 (지연 빌드).
  - 빌드된 뒤에는 요청마다 짧게 연결해 LIMIT/OFFSET 쿼리만 실행하므로,
    전체 데이터가 파이썬 프로세스 메모리에 상주하지 않습니다.
"""
import os
import sqlite3
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

import config as CFG

BASE_DIR = Path(__file__).parent
ASSETS_DIR = BASE_DIR / "assets"
CSV_PATH = ASSETS_DIR / "df_db.csv"
DB_PATH = ASSETS_DIR / "incidents.db"

SEARCH_COLS = ["사고명", "사고경위", "시도", "군구", "공종 - 중분류"]

# ── region(시도) 슬러그 매핑 — /api/incidents?region=seoul 같은 영문 슬러그 입력을
#    실제 데이터의 한글 값으로 바꿔주기 위한 표. df_db.csv의 실제 17개 시도 값 기준.
REGION_SLUGS: Dict[str, str] = {
    "서울특별시": "seoul", "부산광역시": "busan", "대구광역시": "daegu",
    "인천광역시": "incheon", "광주광역시": "gwangju", "대전광역시": "daejeon",
    "울산광역시": "ulsan", "세종특별자치시": "sejong", "경기도": "gyeonggi",
    "강원특별자치도": "gangwon", "충청북도": "chungbuk", "충청남도": "chungnam",
    "전북특별자치도": "jeonbuk", "전라남도": "jeonnam", "경상북도": "gyeongbuk",
    "경상남도": "gyeongnam", "제주특별자치도": "jeju",
}
SLUG_TO_REGION: Dict[str, str] = {v: k for k, v in REGION_SLUGS.items()}

# ── industry(공종 - 대분류) 슬러그 매핑. 이 DB는 건설업 사고만 다루므로
#    "manufacturing" 같은 일반 산업분류가 아니라 공종 대분류(7종) 기준입니다.
INDUSTRY_SLUGS: Dict[str, str] = {
    "건축": "building", "토목": "civil", "전기설비": "electrical",
    "기계설비": "mechanical", "산업설비": "industrial", "통신설비": "telecom",
    "기타": "etc",
}
SLUG_TO_INDUSTRY: Dict[str, str] = {v: k for k, v in INDUSTRY_SLUGS.items()}

_INJURY_LEVEL_TO_TAG: Dict[str, str] = {}
for _injury, _level in CFG.LEVEL_MAP.items():
    _INJURY_LEVEL_TO_TAG[_injury] = "치명" if _level == 4 else ("중상" if _level == 3 else "경상")

_build_lock = threading.Lock()


def _hazard_tag(raw) -> str:
    if pd.isna(raw):
        return "기타"
    val = str(raw)
    if "떨어짐" in val or val == "깔림":
        return "추락"
    if "넘어짐" in val or val == "부딪힘":
        return "전도"
    if "물체에 맞음" in val:
        return "낙하"
    if val == "끼임":
        return "끼임"
    if "절단" in val or "베임" in val or "찔림" in val:
        return "베임"
    if "감전" in val:
        return "감전"
    return "기타"


def _severity_tag(injury_type, total_deaths) -> str:
    if pd.notna(injury_type) and str(injury_type) in _INJURY_LEVEL_TO_TAG:
        return _INJURY_LEVEL_TO_TAG[str(injury_type)]
    try:
        deaths = int(total_deaths) if pd.notna(total_deaths) else 0
    except (TypeError, ValueError):
        deaths = 0
    return "치명" if deaths > 0 else "경상"


def _victims_text(deaths, injuries) -> str:
    def _n(v) -> int:
        try:
            return int(v) if pd.notna(v) else 0
        except (TypeError, ValueError):
            return 0

    d, i = _n(deaths), _n(injuries)
    parts = []
    if d:
        parts.append(f"사망 {d}명")
    if i:
        parts.append(f"부상 {i}명")
    return ", ".join(parts) if parts else "인명피해 없음"


def _clean_text_columns(df: pd.DataFrame) -> pd.DataFrame:
    """원본 엑셀→CSV 변환 과정에서 줄바꿈이 '_x000D_' 리터럴로 깨져 들어온 값을 정리."""
    obj_cols = df.select_dtypes(include="object").columns
    for col in obj_cols:
        df[col] = df[col].str.replace("_x000D_", " ", regex=False).str.strip()
    return df


def _build_db() -> None:
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"원본 데이터 파일이 없어요: {CSV_PATH}")

    df = pd.read_csv(CSV_PATH)
    df = _clean_text_columns(df)
    df = df.reset_index().rename(columns={"index": "id"})

    df["year"] = pd.to_datetime(df["발생일시"], errors="coerce").dt.year
    df["hazard_tag"] = df["인적사고"].apply(_hazard_tag)
    df["severity_tag"] = df.apply(
        lambda r: _severity_tag(r.get("추출된_부상유형"), r.get("총사망자수")), axis=1
    )
    df["victims_text"] = df.apply(
        lambda r: _victims_text(r.get("총사망자수"), r.get("총부상자수")), axis=1
    )
    df["search_blob"] = (
        df[SEARCH_COLS].fillna("").astype(str).agg(" ".join, axis=1)
    )

    tmp_path = DB_PATH.with_suffix(".tmp")
    if tmp_path.exists():
        tmp_path.unlink()

    conn = sqlite3.connect(tmp_path)
    try:
        df.to_sql("incidents", conn, index=False, if_exists="replace")
        conn.execute('CREATE INDEX idx_incidents_region ON incidents("시도")')
        conn.execute('CREATE INDEX idx_incidents_industry ON incidents("공종 - 대분류")')
        conn.execute("CREATE INDEX idx_incidents_year ON incidents(year)")
        conn.execute("CREATE INDEX idx_incidents_hazard ON incidents(hazard_tag)")
        conn.commit()
    finally:
        conn.close()

    os.replace(tmp_path, DB_PATH)  # 원자적 교체 — 빌드 도중 읽기와 겹쳐도 반쪽 DB가 보이지 않음
    print(f"[incidents_db.py] SQLite DB 빌드 완료: {DB_PATH} ({len(df)}건)")


def _db_is_stale() -> bool:
    if not DB_PATH.exists():
        return True
    if not CSV_PATH.exists():
        return False  # 원본이 없으면 손댈 수 없음 — 기존 DB라도 그대로 사용
    return CSV_PATH.stat().st_mtime > DB_PATH.stat().st_mtime


def ensure_db() -> None:
    """DB가 없거나 원본 CSV보다 오래된 경우에만, 최초 요청 시점에 1번 빌드/재빌드.
    서버 시작 시점에는 호출되지 않음 — 첫 API 요청이 들어왔을 때만 실행된다."""
    if not _db_is_stale():
        return
    with _build_lock:
        if not _db_is_stale():
            return
        _build_db()


def _connect() -> sqlite3.Connection:
    ensure_db()
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _row_to_summary(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "tags": [row["hazard_tag"], row["severity_tag"]],
        "title": row["사고명"] or "제목 없음",
        "desc": row["사고경위"] or "",
        "date": (row["발생일시"] or "").replace("-", "."),
        "victims": row["victims_text"],
    }


def _row_to_detail(row: sqlite3.Row) -> Dict[str, Any]:
    base = _row_to_summary(row)
    location = " ".join(p for p in [row["시도"] or "", row["군구"] or ""] if p)
    prevention = row["재발방지대책"] or ""
    base.update({
        "location": location or "위치 정보 없음",
        "causes": {
            "direct": row["사고경위"] or "정보 없음",
            "indirect": row["사고원인"] or "정보 없음",
            "root": row["구체적 사고원인"] or "정보 없음",
        },
        "timeline": [row["사고경위"] or "정보 없음"],
        "prevention": [prevention] if prevention else ["등록된 재발방지대책이 없어요."],
    })
    return base


def query_cases(q: str = "", hazard: str = "전체", limit: int = 20, offset: int = 0) -> Tuple[int, List[Dict[str, Any]]]:
    """/api/cases가 쓰는 검색어+사고유형 기반 조회 (offset 페이지네이션)."""
    limit = max(1, min(limit, 50))
    offset = max(0, offset)

    where, params = [], []
    keyword = (q or "").strip()
    if keyword:
        where.append("search_blob LIKE ?")
        params.append(f"%{keyword}%")
    if hazard and hazard != "전체":
        where.append("hazard_tag = ?")
        params.append(hazard)
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""

    conn = _connect()
    try:
        total = conn.execute(f"SELECT COUNT(*) FROM incidents {where_sql}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM incidents {where_sql} ORDER BY id LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
    finally:
        conn.close()

    return total, [_row_to_summary(r) for r in rows]


def get_case(case_id: int) -> Optional[Dict[str, Any]]:
    conn = _connect()
    try:
        row = conn.execute("SELECT * FROM incidents WHERE id = ?", [case_id]).fetchone()
    finally:
        conn.close()
    return _row_to_detail(row) if row is not None else None


def query_incidents(
    region: Optional[str] = None,
    industry: Optional[str] = None,
    year: Optional[int] = None,
    page: int = 1,
    limit: int = 20,
) -> Tuple[int, List[Dict[str, Any]]]:
    """/api/incidents가 쓰는 region/industry/year 기반 조회 (page 페이지네이션).
    region/industry는 이미 한글 원본 값으로 변환되어 전달되어야 함 (app.py에서 슬러그 검증 후 변환)."""
    where, params = [], []
    if region:
        where.append('"시도" = ?')
        params.append(region)
    if industry:
        where.append('"공종 - 대분류" = ?')
        params.append(industry)
    if year is not None:
        where.append("year = ?")
        params.append(year)
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""

    offset = (page - 1) * limit

    conn = _connect()
    try:
        total = conn.execute(f"SELECT COUNT(*) FROM incidents {where_sql}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM incidents {where_sql} ORDER BY id LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
    finally:
        conn.close()

    return total, [_row_to_summary(r) for r in rows]
