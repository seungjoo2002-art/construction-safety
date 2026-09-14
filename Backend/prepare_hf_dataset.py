"""
prepare_hf_dataset.py — assets/df_db.csv를 Hugging Face Dataset Viewer API로 바로
조회 가능한 형태(CSV, 선택적으로 Parquet)로 변환하는 1회성 로컬 스크립트입니다.

⚠️ Render 빌드·실행 중에는 이 스크립트를 절대 호출하지 않습니다. 개발자가 로컬에서
   한 번 실행해서 나온 결과 파일을 Hugging Face에 수동으로 업로드하는 용도입니다.
   업로드 절차는 프로젝트 루트 README.md의 "Hugging Face 데이터셋 준비" 섹션을 보세요.

사용법:
    cd Backend
    python prepare_hf_dataset.py              # hf_dataset_export/incidents.csv 생성
    python prepare_hf_dataset.py --parquet     # incidents.parquet도 함께 생성 (pyarrow 필요)

출력 컬럼 = 기존 assets/df_db.csv의 전체 컬럼 + 아래 5개 파생 컬럼
(구 incidents_db.py가 SQLite 빌드 시 만들던 것과 완전히 동일한 로직):
    id            0-based 행 인덱스
    year          발생일시에서 뽑은 연도
    hazard_tag    추락/전도/낙하/끼임/베임/감전/기타
    severity_tag  치명/중상/경상
    victims_text  "사망 1명, 부상 2명" 형태의 표시용 문자열
    search_blob   사고명+사고경위+시도+군구+공종을 이어붙인 검색용 텍스트

⚠️ id는 반드시 "원본 행 순서 그대로"여야 합니다. similarity_service.py가 반환하는
   similar_cases[].id와 case-detail.html?id=... 링크가 전부 이 행 인덱스를 그대로
   사용하므로, 행을 정렬·필터링·셔플하면 기존 상세보기 링크가 전부 깨집니다.

Frontend/js/common/hf-dataset.js는 이 컬럼명을 그대로 매핑에 사용합니다 — 컬럼명을
바꾸면 hf-dataset.js의 mapHfRowToCaseSummary/mapHfRowToCaseDetail도 같이 고쳐야 합니다.
"""
import argparse
from pathlib import Path

import pandas as pd

import config as CFG

BASE_DIR = Path(__file__).parent
CSV_PATH = BASE_DIR / "assets" / "df_db.csv"
OUT_DIR = BASE_DIR / "hf_dataset_export"

SEARCH_COLS = ["사고명", "사고경위", "시도", "군구", "공종 - 중분류"]

_INJURY_LEVEL_TO_TAG = {}
for _injury, _level in CFG.LEVEL_MAP.items():
    _INJURY_LEVEL_TO_TAG[_injury] = "치명" if _level == 4 else ("중상" if _level == 3 else "경상")


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


def build(parquet: bool = False) -> Path:
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"원본 데이터 파일이 없어요: {CSV_PATH}")

    df = pd.read_csv(CSV_PATH)
    df = _clean_text_columns(df)
    df = df.reset_index().rename(columns={"index": "id"})  # id = 0-based 행 인덱스 (순서 유지 필수)

    df["year"] = pd.to_datetime(df["발생일시"], errors="coerce").dt.year
    df["hazard_tag"] = df["인적사고"].apply(_hazard_tag)
    df["severity_tag"] = df.apply(
        lambda r: _severity_tag(r.get("추출된_부상유형"), r.get("총사망자수")), axis=1
    )
    df["victims_text"] = df.apply(
        lambda r: _victims_text(r.get("총사망자수"), r.get("총부상자수")), axis=1
    )
    df["search_blob"] = df[SEARCH_COLS].fillna("").astype(str).agg(" ".join, axis=1)

    OUT_DIR.mkdir(exist_ok=True)
    csv_out = OUT_DIR / "incidents.csv"
    df.to_csv(csv_out, index=False, encoding="utf-8-sig")
    print(f"[prepare_hf_dataset.py] CSV 생성 완료: {csv_out} ({len(df)}행)")

    if parquet:
        parquet_out = OUT_DIR / "incidents.parquet"
        df.to_parquet(parquet_out, index=False)  # pip install pyarrow 필요
        print(f"[prepare_hf_dataset.py] Parquet 생성 완료: {parquet_out}")

    return csv_out


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--parquet", action="store_true", help="Parquet 파일도 함께 생성 (pyarrow 필요)")
    args = parser.parse_args()
    build(parquet=args.parquet)
