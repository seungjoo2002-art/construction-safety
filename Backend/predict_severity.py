"""
predict_severity.py — 백엔드 연동용 추론 모듈
==============================================
학습 산출물(artifacts/)을 로드해서
  (1) 신규 사고 데이터의 심각도 3분류 예측
  (2) 학습 데이터의 '치명' 확률 분포 대비 **상대 위험도** 산출
를 수행합니다.

사용 예:
    from predict_severity import SeverityPredictor

    predictor = SeverityPredictor()          # 프로세스 시작 시 1회만 생성
    result = predictor.predict_one({
        "추출된_작업종류": "철근콘크리트공사",
        "공종 - 중분류": "철근콘크리트공사",
        "작업프로세스": "거푸집 설치작업",
        "공공/민간 구분": "민간",
        ...
    })
    result["predicted_class"]           # '중상'
    result["fatal_risk"]["percentile"]  # 92.4  → 전체 사고 중 상위 7.6%
    result["fatal_risk"]["grade"]       # '주의'

주의:
  - SeverityPredictor는 **애플리케이션 기동 시 1회만 생성**하세요 (모델 로딩 비용).
  - 스레드 안전(read-only)이지만, 여러 워커에서 각자 생성해도 무방합니다.
"""
import json
import os
from typing import Any, Dict, List, Optional, Union

import joblib
import numpy as np
import pandas as pd

import config as CFG
import preprocessing as P


class SeverityPredictor:
    def __init__(self, artifact_dir: Optional[str] = None):
        self.artifact_dir = artifact_dir or CFG.ARTIFACT_DIR

        bundle_path = os.path.join(self.artifact_dir, CFG.MODEL_BUNDLE_FILE)
        if not os.path.exists(bundle_path):
            raise FileNotFoundError(
                f"모델 파일이 없습니다: {bundle_path}\n"
                f"먼저 `python train_severity.py` 를 실행해 artifacts를 생성하세요."
            )

        bundle = joblib.load(bundle_path)
        self.model_version: str = bundle["model_version"]
        self.class_names: List[str] = bundle["class_names"]
        self.meta: P.PreprocMeta = bundle["meta"]
        self.models: Dict[str, Any] = bundle["models"]

        with open(os.path.join(self.artifact_dir, CFG.FATAL_DIST_FILE),
                  encoding="utf-8") as f:
            self.fatal_dist: Dict[str, Any] = json.load(f)

        self._ref_sorted: np.ndarray = np.load(
            os.path.join(self.artifact_dir, CFG.FATAL_DIST_RAW_FILE))
        self._ref_n = len(self._ref_sorted)
        self._ref_median = float(self.fatal_dist["median"])
        self._ref_mean = float(self.fatal_dist["mean"])

    # ------------------------------------------------------------
    # 내부: 확률 예측
    # ------------------------------------------------------------
    def _proba(self, df_raw: pd.DataFrame) -> np.ndarray:
        mf, cbf = P.prepare(df_raw, self.meta)
        p1 = self.models["xgb"].predict_proba(mf)
        p2 = self.models["lgbm"].predict_proba(mf)
        p3 = self.models["catboost"].predict_proba(cbf)
        return (p1 + p2 + p3) / 3.0

    # ------------------------------------------------------------
    # 내부: 상대 위험도
    # ------------------------------------------------------------
    def _percentile(self, p_fatal: float) -> float:
        """참조분포에서 p_fatal이 차지하는 백분위(0~100). 동점은 midrank 처리."""
        lo = int(np.searchsorted(self._ref_sorted, p_fatal, side="left"))
        hi = int(np.searchsorted(self._ref_sorted, p_fatal, side="right"))
        return float((lo + hi) / 2.0 / self._ref_n * 100.0)

    def _grade(self, percentile: float) -> Dict[str, str]:
        for g in self.fatal_dist["risk_grades"]:
            if percentile >= g["percentile_from"]:
                return {"grade": g["label"], "grade_description": g["description"]}
        last = self.fatal_dist["risk_grades"][-1]
        return {"grade": last["label"], "grade_description": last["description"]}

    def _fatal_risk(self, p_fatal: float) -> Dict[str, Any]:
        pct = self._percentile(float(p_fatal))
        out = {
            "p_fatal": round(float(p_fatal), 6),
            "percentile": round(pct, 2),              # 상대 위험도 점수 (0~100)
            "top_percent": round(100.0 - pct, 2),     # "상위 N%" 표기용
            "lift_vs_median": round(float(p_fatal) / max(self._ref_median, 1e-9), 2),
            "lift_vs_mean": round(float(p_fatal) / max(self._ref_mean, 1e-9), 2),
            "reference_median": round(self._ref_median, 6),
            "reference_mean": round(self._ref_mean, 6),
            "reference_n": self._ref_n,
            "reference_source": self.fatal_dist.get("source"),
        }
        out.update(self._grade(pct))
        return out

    # ------------------------------------------------------------
    # 내부: 입력 완성도 점검
    # ------------------------------------------------------------
    @staticmethod
    def _completeness(df_raw: pd.DataFrame) -> List[Dict[str, Any]]:
        rows = []
        for i in range(len(df_raw)):
            missing = [c for c in CFG.RAW_INPUT_COLS
                       if c not in df_raw.columns or pd.isna(df_raw.iloc[i].get(c))]
            rows.append({
                "missing_fields": missing,
                "completeness": round(1 - len(missing) / len(CFG.RAW_INPUT_COLS), 3),
            })
        return rows

    # ------------------------------------------------------------
    # 공개 API
    # ------------------------------------------------------------
    def predict(self, data: Union[pd.DataFrame, List[Dict], Dict]) -> List[Dict[str, Any]]:
        """
        신규 데이터 예측 (배치).
        data: DataFrame | dict 리스트 | dict 1건  — 컬럼명은 CFG.RAW_INPUT_COLS 기준
        """
        if isinstance(data, dict):
            df = pd.DataFrame([data])
        elif isinstance(data, list):
            df = pd.DataFrame(data)
        else:
            df = data.copy()
        df = df.reset_index(drop=True)

        proba = self._proba(df)
        comp = self._completeness(df)

        results = []
        for i in range(len(df)):
            k = int(proba[i].argmax())
            results.append({
                "model_version": self.model_version,
                "predicted_class": self.class_names[k],
                "predicted_class_index": k,
                "probabilities": {
                    n: round(float(proba[i, j]), 6)
                    for j, n in enumerate(self.class_names)
                },
                "fatal_risk": self._fatal_risk(proba[i, CFG.FATAL_IDX]),
                "input_quality": comp[i],
            })
        return results

    def predict_one(self, record: Dict[str, Any]) -> Dict[str, Any]:
        """단건 예측. 반환 형식은 predict()의 원소 1개와 동일."""
        return self.predict(record)[0]

    def distribution_summary(self) -> Dict[str, Any]:
        """
        프론트에서 '내 사고가 분포 어디에 있는지' 그릴 때 쓸 참조분포 요약.
        (전체 원본 배열이 필요하면 self.reference_values() 사용)
        """
        return {
            "source": self.fatal_dist.get("source"),
            "n": self.fatal_dist["n"],
            "mean": self.fatal_dist["mean"],
            "median": self.fatal_dist["median"],
            "std": self.fatal_dist["std"],
            "min": self.fatal_dist["min"],
            "max": self.fatal_dist["max"],
            "quantiles": self.fatal_dist["quantiles"],
            "risk_grades": self.fatal_dist["risk_grades"],
            "by_true_class": self.fatal_dist["by_true_class"],
        }

    def reference_values(self, max_points: int = 2000) -> List[float]:
        """히스토그램/KDE 그리기용 참조분포 샘플 (정렬된 배열을 균등 추출)."""
        if self._ref_n <= max_points:
            return self._ref_sorted.tolist()
        idx = np.linspace(0, self._ref_n - 1, max_points).astype(int)
        return self._ref_sorted[idx].tolist()


# ============================================================
# 단독 실행 데모
# ============================================================
if __name__ == "__main__":
    predictor = SeverityPredictor()

    sample = {
        "추출된_작업종류": "철근콘크리트공사",
        "공종 - 중분류": "철근콘크리트공사",
        "작업프로세스": "거푸집 설치작업",
        "공공/민간 구분": "민간",
        "시설물 종류 - 대분류": "건축",
        "시설물 종류 - 중분류": "공동주택",
        "사고객체 - 대분류": "가설구조물",
        "안전관리계획": "대상",
        "설계안전성검토": "대상",
        "공정률": "50~59%",
        "공사비": "300억 ~ 500억원 미만",
        "작업자수": "100~299인",
        "낙찰률": "80~84%",
        "연령_ord": 4,
        "공사시작일": "2023-03-01",
        "공사종료일": "2025-06-30",
        "발생일시": "2024-07-15 14:00",
        "사고일시_x": "2024-07-15 14:00",
        "기상상태 - 습도": 75,
        "평균기온(°C)": 28.4, "일강수량(mm)": 0.0, "평균 풍속(m/s)": 1.8,
        "기온_D1": 27.9, "기온_D2": 28.1, "기온_D3": 26.5,
        "강수_D1": 0.0, "강수_D2": 3.5, "강수_D3": 0.0,
        "풍속_D1": 2.0, "풍속_D2": 1.6, "풍속_D3": 2.2,
    }

    r = predictor.predict_one(sample)
    print(json.dumps(r, ensure_ascii=False, indent=2))
