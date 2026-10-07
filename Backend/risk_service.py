"""
risk_service.py — 위험도(심각도) + 사고유형 예측 연동 모듈
==========================================================
risk_model/ 배포 패키지(31피처, 연령 포함)의 RiskPredictor를 감싸서
  (1) 프론트가 보내는 원본 payload(현장설정 + 오늘 입력 + 날씨 + 발생일시)를
      패키지 입력 31개로 변환하고
  (2) 결과를 앱 응답 형태 { severity, accident_type }로 바꿔 돌려줍니다.

모형이 답하는 것은 "오늘 사고가 날 확률"이 아니라 "이 조건에서 사고가 난다면 얼마나
심각하고 어떤 유형일 것인가"입니다. 심각도 확률은 RUS·class weight로 학습돼 실제
발생률과 어긋나 있으므로 화면에는 p_fatal 대신 백분위(percentile)·등급을 씁니다.

사용 예:
    from risk_service import RiskService
    service = RiskService()                 # 앱 기동 시 1회 (모형 13개 로드)
    r = service.predict_one(payload)
    r["severity"]["fatal_risk"]["percentile"]   # 95.7
    r["severity"]["fatal_risk"]["grade"]        # '매우 높음'
    r["accident_type"]["predicted_type"]        # '끼임(Caught-in)'
"""
import csv
import os
from datetime import date, datetime
from typing import Any, Dict, List, Optional

import config as CFG
from risk_model.predict import RiskPredictor

try:
    import holidays as _holidays_lib
    _KR_HOLIDAYS = _holidays_lib.KR()
except ImportError:  # requirements.txt에 있지만, 없으면 주말만 휴일로 본다
    _KR_HOLIDAYS = None
    print("[risk_service.py] ⚠️ holidays 패키지가 없어 공휴일을 판별하지 못합니다 (주말만 휴일근무로 처리)")


# ============================================================
# 원본 payload → 패키지 입력 31개
# ============================================================
# 프론트 필드명이 패키지 키와 다른 것만 (나머지는 이름이 같아 그대로 전달)
_RENAMED = {
    "사고객체 - 대분류": "사고객체_대분류",
    "시설물 종류 - 중분류": "시설물_중분류",
}
_PASSTHROUGH = [
    "추출된_작업종류", "작업프로세스", "공종 - 중분류", "공공/민간 구분",
    "시설물 종류 - 대분류", "안전관리계획", "설계안전성검토",
    "연령_ord", "연령대", "나이",
    "기상상태 - 습도", "평균기온(°C)", "일강수량(mm)", "평균 풍속(m/s)",
    "기온_D1", "기온_D2", "기온_D3", "강수_D1", "강수_D2", "강수_D3",
    "풍속_D1", "풍속_D2", "풍속_D3",
]


def _blank(v) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "")


def _parse_datetime(v) -> Optional[datetime]:
    if _blank(v):
        return None
    s = str(v).strip().replace("T", " ")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[:19], fmt)
        except ValueError:
            continue
    return None


def _parse_date(v) -> Optional[date]:
    dt = _parse_datetime(v)
    return dt.date() if dt else None


def is_holiday(d: date) -> bool:
    """주말 또는 대한민국 공휴일(대체공휴일 포함)."""
    if d.weekday() >= 5:
        return True
    return _KR_HOLIDAYS is not None and d in _KR_HOLIDAYS


def shift_type(dt: Optional[datetime]) -> str:
    """패키지 README 3-3 규칙. 시각을 모르면 UNKNOWN."""
    if dt is None:
        return "UNKNOWN"
    if is_holiday(dt.date()):
        return "휴일근무"
    if not (CFG.REGULAR_START_HOUR <= dt.hour < CFG.REGULAR_END_HOUR):
        return "연장근무"
    return "정규작업"


def to_model_input(raw: Dict[str, Any]) -> Dict[str, Any]:
    """프론트 payload(현장설정 + 오늘 입력 + 날씨 + 발생일시) → RiskPredictor 입력 dict.
    값이 없는 키는 넣지 않는다 — 패키지가 결측(범주 -1, 수치 중앙값)으로 처리한다."""
    out: Dict[str, Any] = {}
    for k in _PASSTHROUGH:
        if not _blank(raw.get(k)):
            out[k] = raw[k]
    for src, dst in _RENAMED.items():
        v = raw.get(dst, raw.get(src))
        if not _blank(v):
            out[dst] = v

    for src, dst, table in (("공사비", "공사비_ord", CFG.COST_MAP),
                            ("작업자수", "작업자수_ord", CFG.WORKER_MAP),
                            ("낙찰률", "낙찰률_ord", CFG.BID_MAP)):
        if not _blank(raw.get(dst)):
            out[dst] = raw[dst]
        elif raw.get(src) in table:
            out[dst] = table[raw[src]]

    start, end = _parse_date(raw.get("공사시작일")), _parse_date(raw.get("공사종료일"))
    if not _blank(raw.get("전체공사일수")):
        out["전체공사일수"] = raw["전체공사일수"]
    elif start and end:
        out["전체공사일수"] = (end - start).days

    occur = _parse_datetime(raw.get("발생일시")) or _parse_datetime(raw.get("사고일시_x"))
    if occur:
        out["사고_월"] = occur.month
        out["사고_요일"] = occur.weekday()  # 월=0 ~ 일=6
        out["사고_시간"] = occur.hour
    out["근무형태"] = raw["근무형태"] if not _blank(raw.get("근무형태")) else shift_type(occur)
    return out


# ============================================================
# 예측 서비스
# ============================================================
class RiskService:
    def __init__(self, model_dir: Optional[str] = None):
        self.model_dir = model_dir or CFG.RISK_MODEL_DIR
        self.predictor = RiskPredictor(self.model_dir)
        spec, meta = self.predictor.spec, self.predictor.meta
        self.model_version = f"risk-31f-v{spec.get('version', meta.get('version', '?'))}"
        self.ref_n = int(len(self.predictor.ref))

        # 등급별 실제 치명률 검증표 (artifacts/grade_validation.csv, OOF 27,907명)
        self.grade_stats: Dict[str, Dict[str, float]] = {}
        with open(os.path.join(self.model_dir, "artifacts", "grade_validation.csv"),
                  encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                self.grade_stats[row["등급"]] = {
                    "n": int(row["건수"]),
                    "fatal_rate": float(row["실제치명률"]),
                    "lift": float(row["기저대비배수"]),
                }
        total = sum(s["n"] for s in self.grade_stats.values())
        self.base_fatal_rate = round(
            sum(s["n"] * s["fatal_rate"] for s in self.grade_stats.values()) / total, 2)

    # ------------------------------------------------------------
    def _grade_description(self, grade: str) -> str:
        g = next(x for x in self.predictor.grades if x["label"] == grade)
        if g["min"] <= 0:
            return f"사고 발생 시 치명 위험이 하위 {g['max']}% 수준"
        return f"사고 발생 시 치명 위험이 상위 {100 - g['min']}% 이내"

    def _fatal_risk(self, p_fatal: float, pct: float, grade: str) -> Dict[str, Any]:
        stats = self.grade_stats.get(grade, {})
        return {
            "p_fatal": p_fatal,                    # 모형 내부값 — 화면에 그대로 띄우지 않는다
            "percentile": pct,                     # 상대 위험도 점수 (0~100)
            "top_percent": round(100.0 - pct, 1),  # "상위 N%" 표기용
            "grade": grade,                        # 낮음 / 보통 / 높음 / 매우 높음
            "grade_description": self._grade_description(grade),
            "grade_fatal_rate": stats.get("fatal_rate"),  # 이 등급의 실제 치명률(%)
            "lift_vs_base": stats.get("lift"),            # 전체 평균 치명률 대비 배수
            "base_fatal_rate": self.base_fatal_rate,      # 전체 평균 치명률(%) — 5.84
            "reference_n": self.ref_n,
        }

    def predict(self, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """원본 payload 리스트 → [{severity, accident_type, model_input}, ...] (배치 1회 추론)"""
        inputs = [to_model_input(r) for r in rows]
        raw_results = self.predictor.predict_batch(inputs)

        out = []
        for inp, r in zip(inputs, raw_results):
            sev = r["severity"]
            missing = [c for c in self.predictor.feats
                       if c not in inp and not (c == "연령_ord" and ("연령대" in inp or "나이" in inp))
                       and not (c == "작업프로세스_clean" and "작업프로세스" in inp)]
            severity = {
                "model_version": self.model_version,
                "predicted_class": max(sev, key=sev.get),
                "probabilities": sev,
                "fatal_risk": self._fatal_risk(sev["치명"], r["relative_risk_percentile"], r["risk_grade"]),
                "input_quality": {
                    "missing_fields": missing,
                    "completeness": round(1 - len(missing) / len(self.predictor.feats), 3),
                },
            }
            probs = {CFG.TYPE_DISPLAY_NAMES[k]: v for k, v in r["injury_type"].items()}
            ranked = sorted(({"type": k, "probability": v} for k, v in probs.items()),
                            key=lambda d: d["probability"], reverse=True)
            accident_type = {
                "model_version": self.model_version,
                "predicted_type": CFG.TYPE_DISPLAY_NAMES[r["injury_top"]],
                "confidence": ranked[0]["probability"],
                "probabilities": probs,
                "ranked_types": ranked,
            }
            out.append({"severity": severity, "accident_type": accident_type, "model_input": inp})
        return out

    def predict_one(self, raw: Dict[str, Any]) -> Dict[str, Any]:
        return self.predict([raw])[0]

    def summary(self) -> Dict[str, Any]:
        """모형·등급 기준 요약 (/api/distributions)."""
        meta = self.predictor.meta
        return {
            "model_version": self.model_version,
            "relative_risk": meta["relative_risk"],
            "grade_validation": self.grade_stats,
            "base_fatal_rate": self.base_fatal_rate,
            "severity_performance": meta["severity"].get("holdout_performance_notebook"),
            "injury_performance": meta["injury"].get("holdout_performance_notebook"),
        }
