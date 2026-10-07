# -*- coding: utf-8 -*-
"""
건설사고 위험 예측 — 추론 모듈 (31피처, 연령 포함)
==================================================
사용법:
    from predict import RiskPredictor
    p = RiskPredictor()                    # 모형/사양 로드 (프로세스당 1회)
    result = p.predict(payload_dict)       # 단일 예측
    results = p.predict_batch([d1, d2])    # 배치 예측

payload는 feature_spec.json의 feature_order에 있는 키를 담은 dict.
누락된 키는 자동으로 결측 처리(범주형 -1, 수치형 중앙값)되지만,
daily_input 3개 · 근무형태 · 연령은 반드시 채워야 예측이 의미 있다.

연령은 다음 중 하나로 넣는다.
    "연령_ord": 0~5          (0=10대 ... 5=60대 이상)
    "연령대":   "50대"        (10대 / 20대 / 30대 / 40대 / 50대 / 60대 이상)
    "나이":     54           (만 나이 → 연령대로 자동 변환)
"""
import os
import json
import numpy as np
import pandas as pd

BASE = os.path.dirname(os.path.abspath(__file__))

SEV_NAMES = ["경+중등도", "중상", "치명"]
INJ_NAMES = ["끼임", "절단·베임·찔림", "추락·압착", "물체에 맞음", "전도·충돌"]
PUBLIC = {"공공": 0, "민간": 1}


def _load_lgb(path):
    """LightGBM의 C라이브러리는 비ASCII 경로를 열지 못하므로 파이썬으로 읽어 문자열로 전달"""
    import lightgbm as lgb
    with open(path, encoding="utf-8") as f:
        return lgb.Booster(model_str=f.read())


def _age_to_ord(p):
    if p.get("연령_ord") is not None:
        return float(p["연령_ord"])
    if p.get("연령대") is not None:
        s = str(p["연령대"]).replace(" ", "")
        table = {"10대": 0, "20대": 1, "30대": 2, "40대": 3, "50대": 4, "60대이상": 5, "60대": 5}
        return float(table[s]) if s in table else np.nan
    if p.get("나이") is not None:
        a = int(p["나이"])
        return float(min(max(a // 10 - 1, 0), 5))
    return np.nan


class RiskPredictor:
    def __init__(self, base_dir=None):
        b = base_dir or BASE
        self.models_dir = os.path.join(b, "models")
        with open(os.path.join(b, "artifacts", "feature_spec.json"), encoding="utf-8") as f:
            self.spec = json.load(f)
        with open(os.path.join(b, "artifacts", "metadata.json"), encoding="utf-8") as f:
            self.meta = json.load(f)
        self.ref = np.load(os.path.join(b, "artifacts", "ref_distribution.npy"))

        self.feats = self.spec["feature_order"]
        self.cats = self.spec["categorical_features"]
        self.nums = self.spec["numeric_features"]
        self.catmap = self.spec["category_mapping"]
        self.catidx = {c: {v: i for i, v in enumerate(vs)} for c, vs in self.catmap.items()}
        self.median = self.spec["numeric_median_fill"]
        self.valid_proc = set(self.spec["valid_work_process_raw"])
        self.grades = self.meta["relative_risk"]["grades"]

        self._load_models()

    # ---------------- 모형 로드 ----------------
    def _load_models(self):
        import xgboost as xgb
        from catboost import CatBoostClassifier

        m = self.models_dir
        self.sev_xgb = xgb.XGBClassifier()
        self.sev_xgb.load_model(os.path.join(m, "severity_xgb.json"))
        self.sev_lgb = _load_lgb(os.path.join(m, "severity_lgb.txt"))
        self.sev_cat = CatBoostClassifier()
        self.sev_cat.load_model(os.path.join(m, "severity_cat.cbm"))

        self.inj_base = {"xgb": [], "lgb": [], "cat": []}
        for f in (1, 2, 3):
            x = xgb.XGBClassifier(); x.load_model(os.path.join(m, f"injury_base_xgb_fold{f}.json"))
            self.inj_base["xgb"].append(x)
            self.inj_base["lgb"].append(_load_lgb(os.path.join(m, f"injury_base_lgb_fold{f}.txt")))
            c = CatBoostClassifier(); c.load_model(os.path.join(m, f"injury_base_cat_fold{f}.cbm"))
            self.inj_base["cat"].append(c)
        self.inj_meta = xgb.XGBClassifier()
        self.inj_meta.load_model(os.path.join(m, "injury_meta_xgb.json"))

    # ---------------- 전처리 ----------------
    def _cat_code(self, col, v):
        """범주 문자열 → category_mapping 순번. 0 / 0.0 같은 숫자 표기 차이도 맞춰 준다"""
        idx = self.catidx[col]
        if v is None or (isinstance(v, float) and np.isnan(v)):
            v = "nan"                      # 학습 데이터의 결측 범주와 동일하게 처리
        if col == "공공/민간 구분" and v in PUBLIC:
            v = PUBLIC[v]
        cands = [str(v)]
        try:
            fv = float(v)
            cands += [str(fv), str(int(fv))]
        except (TypeError, ValueError):
            pass
        for s in cands:
            if s in idx:
                return idx[s]
        return -1

    def _encode(self, payloads):
        """dict 리스트 → 순번 인코딩된 DataFrame (feature_order 순서)"""
        rows = []
        for p in payloads:
            p = dict(p)
            if "작업프로세스_clean" not in p and "작업프로세스" in p:
                v = str(p["작업프로세스"])
                p["작업프로세스_clean"] = v if v in self.valid_proc else "기타"
            p["연령_ord"] = _age_to_ord(p)
            rows.append(p)

        out = pd.DataFrame(index=range(len(rows)))
        for c in self.feats:
            if c in self.cats:
                out[c] = [self._cat_code(c, r.get(c)) for r in rows]
                out[c] = out[c].astype("int32")
            else:
                col = pd.to_numeric(pd.Series([r.get(c) for r in rows], dtype=object), errors="coerce")
                out[c] = col.fillna(self.median[c]).astype(float)
        return out[self.feats]

    def _as_cat(self, X):
        """순번을 category_mapping 길이로 고정한 category.
        행마다 따로 category로 바꾸면 XGBoost가 순번을 다르게 읽어 예측이 틀어진다."""
        d = X.copy()
        for c in self.cats:
            d[c] = pd.Categorical(d[c].astype("int32"), categories=range(len(self.catmap[c])))
        return d

    def _as_str(self, X):
        d = self._as_cat(X)
        for c in self.cats:
            d[c] = d[c].astype(str)
        return d

    # ---------------- 예측 ----------------
    def _severity_proba(self, X):
        A, As = self._as_cat(X), self._as_str(X)
        p1 = self.sev_xgb.predict_proba(A)
        p2 = np.asarray(self.sev_lgb.predict(A)).reshape(len(X), -1)   # Booster.predict는 확률 반환
        p3 = self.sev_cat.predict_proba(As)
        return (p1 + p2 + p3) / 3

    def _injury_proba(self, X):
        A, As = self._as_cat(X), self._as_str(X)
        blocks = []
        for name in ("xgb", "lgb", "cat"):
            acc = np.zeros((len(X), 5))
            for m in self.inj_base[name]:
                if name == "lgb":
                    acc += np.asarray(m.predict(A)).reshape(len(X), -1) / 3
                elif name == "cat":
                    acc += m.predict_proba(As) / 3
                else:
                    acc += m.predict_proba(A) / 3
            blocks.append(acc)
        return self.inj_meta.predict_proba(np.hstack(blocks))

    def relative_risk(self, p_fatal):
        """P(치명) → 기준분포상 백분위 (0~100)"""
        return np.searchsorted(self.ref, p_fatal, side="right") / len(self.ref) * 100

    def grade(self, pct):
        for g in self.grades:
            if g["min"] <= pct < g["max"]:
                return g["label"]
        return self.grades[-1]["label"]

    def predict_batch(self, payloads):
        X = self._encode(payloads)
        ps = self._severity_proba(X)
        pi = self._injury_proba(X)
        pct = self.relative_risk(ps[:, 2])
        out = []
        for i in range(len(X)):
            out.append({
                "severity": {SEV_NAMES[k]: round(float(ps[i, k]), 4) for k in range(3)},
                "injury_type": {INJ_NAMES[k]: round(float(pi[i, k]), 4) for k in range(5)},
                "injury_top": INJ_NAMES[int(pi[i].argmax())],
                "relative_risk_percentile": round(float(pct[i]), 1),
                "risk_grade": self.grade(float(pct[i])),
            })
        return out

    def predict(self, payload):
        return self.predict_batch([payload])[0]


DEMO = {
    # 매일 입력 (3)
    "사고객체_대분류": "건설기계",
    "작업프로세스": "굴착작업",
    "추출된_작업종류": "굴착/토공사",
    # 작업자 정보 (1)
    "연령대": "50대",
    # 근무형태 (1)
    "근무형태": "정규작업",
    # 자동 수집 예시
    "사고_월": 9, "사고_요일": 1, "사고_시간": 13,
    "평균기온(°C)": 24.0, "일강수량(mm)": 0.0, "평균 풍속(m/s)": 2.1, "기상상태 - 습도": 65.0,
    # 현장 등록 예시
    "공종 - 중분류": "토공사", "공공/민간 구분": "공공",
    "시설물 종류 - 대분류": "토목", "시설물_중분류": "도로",
    "안전관리계획": "대상현장(1/2종)", "설계안전성검토": "대상",
    "공사비_ord": 9, "작업자수_ord": 1, "낙찰률_ord": 7, "전체공사일수": 700,
}

if __name__ == "__main__":
    import pprint
    p = RiskPredictor()
    print("피처 수:", len(p.feats))
    print("기준분포 크기:", len(p.ref))
    pprint.pprint(p.predict(DEMO))
