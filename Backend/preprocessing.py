"""
preprocessing.py — 학습/추론 공통 전처리
=========================================
핵심 원칙: **학습에서 결정된 값은 전부 meta에 저장하고, 추론은 meta만 보고 재현한다.**

저장되는 것(PreprocMeta):
  - cat_levels : 범주형 컬럼별 '문자열 → 정수코드' 사전 (미지값은 -1)
  - medians    : 수치형 결측 대체용 학습셋 중앙값
  - keep_procs : 작업프로세스 중 유지할 범주 목록 (나머지는 '기타')

원 노트북(_common_add_3class.py)의 전처리를 그대로 따르되,
서빙에서 재현 가능하도록 파라미터를 외부화한 버전입니다.
"""
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

import config as CFG


# ============================================================
# 전처리 메타 (학습 시 fit → joblib에 저장 → 추론 시 로드)
# ============================================================
@dataclass
class PreprocMeta:
    cat_levels: Dict[str, List[str]] = field(default_factory=dict)
    medians: Dict[str, float] = field(default_factory=dict)
    keep_procs: List[str] = field(default_factory=list)
    features: List[str] = field(default_factory=lambda: list(CFG.FEATURES))
    nominal_cols: List[str] = field(default_factory=lambda: list(CFG.NOMINAL_COLS))

    def code_levels(self, col: str) -> List[int]:
        """category dtype에 고정할 정수 코드 목록 (-1 = 미지/결측)."""
        return [-1] + list(range(len(self.cat_levels[col])))


# ============================================================
# 1. 원본 엑셀 로드 + 타깃 생성 (학습 전용)
# ============================================================
def load_raw(path: str = None) -> pd.DataFrame:
    path = path or CFG.DATA_PATH
    return pd.read_excel(path)


def build_target(df: pd.DataFrame) -> pd.DataFrame:
    """추출된_부상유형 → Target_Y(1~4) 생성 후 대상 외 행 제거."""
    df = df[~df["추출된_부상유형"].isin(CFG.EXCLUDE_INJURY)].copy()
    df["Target_Y"] = df["추출된_부상유형"].map(CFG.LEVEL_MAP)
    df = df[df["Target_Y"].notna()].copy()
    df["Target_Y"] = df["Target_Y"].astype(int)
    return df


def to_three_class(target_y: np.ndarray) -> np.ndarray:
    """4단계(1~4) → 3분류(0,1,2). L1+L2→0, L3→1, L4→2"""
    y4 = np.asarray(target_y) - 1                      # 0~3
    return np.where(y4 <= 1, 0, np.where(y4 == 2, 1, 2))


def build_type_target(df: pd.DataFrame) -> pd.DataFrame:
    """
    [모형 2] 원본 '인적사고' → 5분류 카테고리 생성 후 매핑 불가 행 제거.
    제외되는 값: 기타, 분류불능, 화재, 없음, 폭발·파열, 감전, 질식, 무너짐, 온열질환 등
    """
    out = df.copy()
    out["인적사고_cat"] = out["인적사고"].map(CFG.TYPE_MAPPING)
    out = out[out["인적사고_cat"].notna()].copy().reset_index(drop=True)
    out["Type_Y"] = out["인적사고_cat"].map(CFG.TYPE_TO_Y).astype(int)
    return out


# ============================================================
# 2. 피처 엔지니어링 (학습/추론 공통)
# ============================================================
def _as_str(s: pd.Series) -> pd.Series:
    """범주형 문자열화. 결측은 'nan' 이라는 하나의 범주로 취급(원 코드와 동일 동작)."""
    return s.astype(object).where(s.notna(), "nan").astype(str).str.strip()


def fit_process_categories(df: pd.DataFrame, min_count: int = 10) -> List[str]:
    """작업프로세스 중 min_count 이상 등장한 범주만 유지 (나머지는 '기타')."""
    vc = df["작업프로세스"].value_counts()
    return sorted(vc[vc >= min_count].index.astype(str).tolist())


def build_features(
    df: pd.DataFrame,
    keep_procs: List[str],
    impute_hour: bool = False,
) -> pd.DataFrame:
    """
    원본 컬럼 → 모델 피처(CFG.FEATURES) DataFrame 생성.
    범주형은 문자열, 수치형은 float (결측은 NaN 그대로 — 이후 medians로 대체).

    impute_hour=True : 학습 시에만. 사고_시간 결측을 학습셋 시간분포에서 확률 대체(seed 42).
                       추론 시에는 False → 결측이면 중앙값 대체 경로를 탐.
    """
    df = df.copy()
    out = pd.DataFrame(index=df.index)

    def col(name):
        return df[name] if name in df.columns else pd.Series(np.nan, index=df.index)

    # ── 사고 시간
    hour = pd.to_datetime(col("사고일시_x"), errors="coerce").dt.hour
    if impute_hour:
        dist = hour.value_counts().sort_index()
        if len(dist) > 0:
            mask = hour.isna()
            if mask.sum() > 0:
                rng = np.random.RandomState(CFG.RANDOM_STATE)
                hour.loc[mask] = rng.choice(
                    dist.index.tolist(),
                    size=int(mask.sum()),
                    p=(dist / dist.sum()).tolist(),
                    replace=True,
                )
    out["사고_시간"] = pd.to_numeric(hour, errors="coerce")

    # ── 날짜 파생
    start = pd.to_datetime(col("공사시작일"), errors="coerce")
    end = pd.to_datetime(col("공사종료일"), errors="coerce")
    occur = pd.to_datetime(col("발생일시"), errors="coerce")

    total_days = (end - start).dt.days
    elapsed = (occur - start).dt.days
    out["전체공사일수"] = total_days
    out["공사임박도"] = np.where(total_days > 0, elapsed / total_days, np.nan)
    out["공사임박도"] = pd.Series(out["공사임박도"], index=df.index).clip(0, 1)
    out["사고_월"] = occur.dt.month
    out["사고_요일"] = occur.dt.dayofweek

    # ── 순서형 인코딩
    out["공정률_ord"] = col("공정률").map(CFG.PROGRESS_MAP)
    out["공사비_ord"] = col("공사비").map(CFG.COST_MAP).fillna(-1)
    out["작업자수_ord"] = col("작업자수").map(CFG.WORKER_MAP)
    out["낙찰률_ord"] = col("낙찰률").map(CFG.BID_MAP)
    out["연령_ord"] = pd.to_numeric(col("연령_ord"), errors="coerce")

    # ── 연속형 (원본 그대로)
    passthrough = [
        "기상상태 - 습도", "평균기온(°C)", "일강수량(mm)", "평균 풍속(m/s)",
        "기온_D1", "기온_D2", "기온_D3", "강수_D1", "강수_D2", "강수_D3",
        "풍속_D1", "풍속_D2", "풍속_D3",
    ]
    for c in passthrough:
        out[c] = pd.to_numeric(col(c), errors="coerce")

    # ── 범주형
    out["추출된_작업종류"] = _as_str(col("추출된_작업종류"))
    out["공종 - 중분류"] = _as_str(col("공종 - 중분류"))
    out["시설물 종류 - 대분류"] = _as_str(col("시설물 종류 - 대분류"))
    out["안전관리계획"] = _as_str(col("안전관리계획"))
    out["설계안전성검토"] = _as_str(col("설계안전성검토"))
    out["사고객체_대분류"] = _as_str(col("사고객체 - 대분류"))
    out["시설물_중분류"] = _as_str(col("시설물 종류 - 중분류"))

    # 공공/민간: 0/1 매핑 후 문자열 범주
    out["공공/민간 구분"] = _as_str(col("공공/민간 구분").map(CFG.PUBLIC_PRIVATE_MAP))

    # 작업프로세스: 희소 범주 → '기타'
    proc = _as_str(col("작업프로세스"))
    keep = set(keep_procs)
    out["작업프로세스_clean"] = proc.apply(lambda x: x if x in keep else "기타")

    return out[CFG.FEATURES]


# ============================================================
# 3. fit / transform
# ============================================================
def fit_cat_levels(feat_df: pd.DataFrame) -> Dict[str, List[str]]:
    """범주형 컬럼별 정렬된 범주 목록 확정 (코드 = 목록 내 위치)."""
    return {c: sorted(_as_str(feat_df[c]).unique().tolist()) for c in CFG.NOMINAL_COLS}


def encode(feat_df: pd.DataFrame, meta: PreprocMeta) -> pd.DataFrame:
    """
    범주형 → 정수 코드(미지값 -1), 수치형 → float.
    결측 대체는 아직 하지 않음(fill_missing에서 처리).
    """
    out = feat_df.copy()
    for c in CFG.NOMINAL_COLS:
        cats = meta.cat_levels[c]
        out[c] = pd.Categorical(_as_str(out[c]), categories=cats).codes.astype("int32")
    for c in CFG.ORDINAL_COLS + CFG.CONTINUOUS_COLS:
        out[c] = pd.to_numeric(out[c], errors="coerce").astype("float64")
    return out[meta.features]


def fit_medians(encoded_train: pd.DataFrame) -> Dict[str, float]:
    """수치형 컬럼의 학습셋 중앙값 (범주형은 -1 코드가 있으므로 제외)."""
    med = {}
    for c in CFG.ORDINAL_COLS + CFG.CONTINUOUS_COLS:
        v = encoded_train[c].median()
        med[c] = float(v) if pd.notna(v) else 0.0
    return med


def fill_missing(encoded: pd.DataFrame, meta: PreprocMeta) -> pd.DataFrame:
    out = encoded.copy()
    for c, v in meta.medians.items():
        if c in out.columns:
            out[c] = out[c].fillna(v)
    return out


def to_model_frame(encoded: pd.DataFrame, meta: PreprocMeta) -> pd.DataFrame:
    """
    XGBoost/LightGBM 입력용. 범주형을 **고정 카테고리 목록**의 category dtype으로 변환.
    ★ 학습·추론이 동일한 카테고리 목록을 쓰도록 강제하는 부분 (원 노트북 to_cat의 버그 수정).
    """
    out = encoded.copy()
    for c in meta.nominal_cols:
        out[c] = pd.Categorical(out[c].astype("int32"), categories=meta.code_levels(c))
    return out[meta.features]


def to_catboost_frame(model_frame: pd.DataFrame, meta: PreprocMeta) -> pd.DataFrame:
    """CatBoost 입력용. 범주형 코드를 문자열로 변환 (원 코드와 동일)."""
    out = model_frame.copy()
    for c in meta.nominal_cols:
        out[c] = out[c].astype(str).fillna("U")
    return out


def prepare(df_raw: pd.DataFrame, meta: PreprocMeta):
    """
    추론 진입점: 원본 컬럼 DataFrame → (model_frame, catboost_frame)
    """
    feat = build_features(df_raw, meta.keep_procs, impute_hour=False)
    enc = fill_missing(encode(feat, meta), meta)
    mf = to_model_frame(enc, meta)
    return mf, to_catboost_frame(mf, meta)
