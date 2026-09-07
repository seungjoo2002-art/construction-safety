"""
predict_accident_type.py — [모형 2] 사고유형 5분류 백엔드 연동 모듈
====================================================================
학습 산출물(artifacts/)을 로드해서
  (1) 신규 현장/작업 조건에서 어떤 유형의 사고가 발생할 가능성이 높은지 예측
  (2) 학습 데이터의 유형별 확률 분포 대비 **상대 발생가능성**을 산출
합니다.

사용 예:
    from predict_accident_type import AccidentTypePredictor

    predictor = AccidentTypePredictor()      # 앱 기동 시 1회만 생성
    r = predictor.predict_one({...})

    r["predicted_type"]        # '추락·압착(Falls)'
    r["ranked_types"][0]       # 확률 1위 유형 + 백분위 + 등급
    r["elevated_types"]        # 참조분포 대비 유난히 높은 유형들 (예방조치 대상)

입력 필드는 모형 1(위험도)과 **완전히 동일**합니다 (config.RAW_INPUT_COLS, 31개).
따라서 한 번의 입력으로 두 모델을 같이 돌릴 수 있습니다.
"""
import json
import os
from typing import Any, Dict, List, Optional, Union

import joblib
import numpy as np
import pandas as pd

import config as CFG
import preprocessing as P


class AccidentTypePredictor:
    def __init__(self, artifact_dir: Optional[str] = None):
        self.artifact_dir = artifact_dir or CFG.ARTIFACT_DIR

        bundle_path = os.path.join(self.artifact_dir, CFG.TYPE_MODEL_BUNDLE_FILE)
        if not os.path.exists(bundle_path):
            raise FileNotFoundError(
                f"모델 파일이 없습니다: {bundle_path}\n"
                f"먼저 `python train_accident_type.py` 를 실행하세요."
            )

        bundle = joblib.load(bundle_path)
        self.model_version: str = bundle["model_version"]
        self.class_names: List[str] = bundle["class_names"]
        self.base_order: List[str] = bundle["base_order"]
        self.meta: P.PreprocMeta = bundle["meta"]
        self._base = bundle["models"]["base"]
        self._meta_model = bundle["models"]["meta"]

        with open(os.path.join(self.artifact_dir, CFG.TYPE_DIST_FILE),
                  encoding="utf-8") as f:
            self.dist: Dict[str, Any] = json.load(f)

        ref = np.load(os.path.join(self.artifact_dir, CFG.TYPE_DIST_RAW_FILE))
        self._ref_sorted = np.sort(ref, axis=0)      # 열(클래스)별 정렬
        self._ref_n = self._ref_sorted.shape[0]

    # ------------------------------------------------------------
    # 내부: 스태킹 확률
    # ------------------------------------------------------------
    def _proba(self, df_raw: pd.DataFrame) -> np.ndarray:
        mf, cbf = P.prepare(df_raw, self.meta)
        feats = []
        for name in self.base_order:
            X = cbf if name == "catboost" else mf
            feats.append(np.mean([m.predict_proba(X) for m in self._base[name]], axis=0))
        return self._meta_model.predict_proba(np.hstack(feats))

    # ------------------------------------------------------------
    # 내부: 상대 발생가능성
    # ------------------------------------------------------------
    def _percentile(self, k: int, p: float) -> float:
        col = self._ref_sorted[:, k]
        lo = int(np.searchsorted(col, p, side="left"))
        hi = int(np.searchsorted(col, p, side="right"))
        return float((lo + hi) / 2.0 / self._ref_n * 100.0)

    def _grade(self, k: int, pct: float) -> Dict[str, str]:
        grades = self.dist["per_class"][self.class_names[k]]["likelihood_grades"]
        for g in grades:
            if pct >= g["percentile_from"]:
                return {"likelihood": g["label"], "likelihood_description": g["description"]}
        last = grades[-1]
        return {"likelihood": last["label"], "likelihood_description": last["description"]}

    def _class_detail(self, k: int, p: float) -> Dict[str, Any]:
        c = self.dist["per_class"][self.class_names[k]]
        pct = self._percentile(k, float(p))
        out = {
            "type": self.class_names[k],
            "type_index": k,
            "probability": round(float(p), 6),
            "percentile": round(pct, 2),          # 참조분포 대비 상대 위치
            "top_percent": round(100.0 - pct, 2),
            "lift_vs_mean": round(float(p) / max(c["mean"], 1e-9), 2),
            "reference_mean": round(c["mean"], 6),
            "actual_prior": round(c["prior"], 6),  # 전체 사고 중 이 유형의 실제 비율
        }
        out.update(self._grade(k, pct))
        return out

    # ------------------------------------------------------------
    # 공개 API
    # ------------------------------------------------------------
    def predict(self, data: Union[pd.DataFrame, List[Dict], Dict],
                elevated_percentile: float = 80.0) -> List[Dict[str, Any]]:
        """
        신규 데이터 예측 (배치).
        elevated_percentile : 이 백분위 이상인 유형을 elevated_types로 따로 모음
        """
        if isinstance(data, dict):
            df = pd.DataFrame([data])
        elif isinstance(data, list):
            df = pd.DataFrame(data)
        else:
            df = data.copy()
        df = df.reset_index(drop=True)

        proba = self._proba(df)

        results = []
        for i in range(len(df)):
            details = [self._class_detail(k, proba[i, k])
                       for k in range(len(self.class_names))]
            ranked = sorted(details, key=lambda d: d["probability"], reverse=True)
            elevated = sorted(
                [d for d in details if d["percentile"] >= elevated_percentile],
                key=lambda d: d["percentile"], reverse=True)

            missing = [c for c in CFG.RAW_INPUT_COLS
                       if c not in df.columns or pd.isna(df.iloc[i].get(c))]

            results.append({
                "model_version": self.model_version,
                "predicted_type": ranked[0]["type"],
                "predicted_type_index": ranked[0]["type_index"],
                "confidence": ranked[0]["probability"],
                "probabilities": {d["type"]: d["probability"] for d in details},
                "ranked_types": ranked,
                "elevated_types": elevated,
                "input_quality": {
                    "missing_fields": missing,
                    "completeness": round(1 - len(missing) / len(CFG.RAW_INPUT_COLS), 3),
                },
            })
        return results

    def predict_one(self, record: Dict[str, Any], **kw) -> Dict[str, Any]:
        return self.predict(record, **kw)[0]

    def distribution_summary(self) -> Dict[str, Any]:
        """유형별 참조분포 요약 (그래프 축·기준선 설정용)."""
        return self.dist

    def reference_values(self, type_index: int, max_points: int = 2000) -> List[float]:
        """특정 유형의 참조분포 샘플 (히스토그램용)."""
        col = self._ref_sorted[:, type_index]
        if self._ref_n <= max_points:
            return col.tolist()
        idx = np.linspace(0, self._ref_n - 1, max_points).astype(int)
        return col[idx].tolist()


# ============================================================
# 단독 실행 데모
# ============================================================
if __name__ == "__main__":
    predictor = AccidentTypePredictor()

    sample = {
        "추출된_작업종류": "철근콘크리트공사",
        "공종 - 중분류": "철근콘크리트공사",
        "작업프로세스": "거푸집 설치작업",
        "공공/민간 구분": "민간",
        "시설물 종류 - 대분류": "건축",
        "시설물 종류 - 중분류": "공동주택",
        "사고객체 - 대분류": "가시설",
        "안전관리계획": "대상현장(1/2종)",
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
