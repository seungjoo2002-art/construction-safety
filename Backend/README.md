# 건설사고 예측 모형 — 백엔드 연동

최종 모형은 **`risk_model/`** (건설사고예측 배포패키지, 31피처 · 연령 포함)입니다.
모형 구조·성능·입력 31개·등급 기준은 패키지 문서 **[`risk_model/README.md`](risk_model/README.md)** 를 보세요.
이 문서는 앱이 그 패키지를 어떻게 쓰는지만 설명합니다.

| | 위험도 (심각도 3분류) | 사고유형 (5분류) |
|---|---|---|
| 클래스 | 경+중등도 / 중상 / 치명 | 끼임 / 절단·베임·찔림 / 추락·압착 / 물체에 맞음 / 전도·충돌 |
| 구조 | RUS 1:3 + XGB·LGBM·CatBoost 소프트보팅 | base 3종 × 3-fold → 메타 XGBoost |
| 앱 출력 | 치명 위험 **백분위**·등급 | 유형별 확률·1위 유형 |

> 모형은 **"이 조건에서 사고가 난다면 얼마나 심각하고 어떤 유형일까"** 에 답합니다. "오늘 사고가 날 확률"이 아닙니다.
> 심각도 확률(`p_fatal`)은 언더샘플링·가중치 때문에 실제 치명률과 어긋나 있으므로 화면에는 띄우지 않고
> 백분위(`percentile`)와 등급(`grade`)만 씁니다.

---

## 1. 파일 구성

```
Backend/
├── app.py              FastAPI — /api/predict, /api/predict-hourly, /api/advise, /api/distributions
├── risk_service.py     ★ 앱 payload → 패키지 입력 31개 변환 + 응답 형태 변환
├── config.py           공사비/작업자수/낙찰률 매핑, 정규 근무시간, 사고유형 표시명
└── risk_model/         배포 패키지 (수정하지 않고 그대로 둠)
    ├── README.md
    ├── predict.py                  RiskPredictor (risk_service.py가 import)
    ├── models/                     13개 (심각도 3 + 사고유형 base 9 + 메타 1, 약 55MB)
    └── artifacts/
        ├── feature_spec.json       피처 순서 · 범주 순번 · 결측 대체값 · 드롭다운 값
        ├── metadata.json           성능 · 등급 구간 · 패키지 버전
        ├── ref_distribution.npy    상대위험도 기준분포 (OOF 27,907명)
        ├── grade_validation.csv    등급별 실제 치명률 (응답의 grade_fatal_rate / lift_vs_base)
        └── oof_probabilities_rus3.csv  OOF 확률 원본 (서빙에는 안 씀)
```

패키지 버전: xgboost 3.0.0 · lightgbm 4.6.0 · catboost 1.2.10 (`requirements.txt`에 고정).
메이저 버전이 다르면 모형 로드가 실패할 수 있습니다.

---

## 2. 입력 변환 (`risk_service.to_model_input`)

프론트는 현장설정(site-setup) + 오늘 입력(predict-input) + 날씨를 합친 payload를 보내고,
백엔드가 패키지 입력 31개로 바꿉니다. 없는 값은 넣지 않으며 패키지가 결측(범주 −1, 수치 중앙값)으로 처리합니다.

| 패키지 입력 | 앱 payload에서 |
|---|---|
| `사고객체_대분류` | `사고객체 - 대분류` (작업 대상물) |
| `시설물_중분류` | `시설물 종류 - 중분류` |
| `작업프로세스_clean` | `작업프로세스` (목록에 없으면 패키지가 `기타`로 치환) |
| `연령_ord` | `연령_ord` (0=10대 … 5=60대 이상, site-setup에서 입력) |
| `공사비_ord` · `작업자수_ord` · `낙찰률_ord` | `공사비` · `작업자수` · `낙찰률` 구간 문자열 → `config.py`의 COST_MAP / WORKER_MAP / BID_MAP |
| `전체공사일수` | `공사종료일 − 공사시작일` (일) |
| `사고_월` · `사고_요일`(월=0) · `사고_시간` | `발생일시` (없으면 `사고일시_x`) |
| `근무형태` | `발생일시`로 자동 판정 — 아래 |
| 나머지 (작업종류·공종·공공/민간·시설물 대분류·안전관리계획·설계안전성검토·기상 4개·기상 지연항 9개) | 같은 이름 그대로 |

**근무형태 자동 판정** (패키지 README 3-3):

```
주말 또는 대한민국 공휴일(holidays 패키지, 대체공휴일 포함)  → 휴일근무
정규 근무시간(config.REGULAR_START_HOUR~REGULAR_END_HOUR, 08~18시) 밖 → 연장근무
그 외                                                          → 정규작업
발생일시가 없으면                                              → UNKNOWN
```

`기온_D1~D3` · `강수_D1~D3` · `풍속_D1~D3`(1~3일 전 기상)은 무료 날씨 API로 조회할 수 없어 항상 결측입니다.
`공정률`은 모형 입력이 아니고 유사도 분석(`/api/analyze`)에만 쓰입니다.

---

## 3. 응답 형태

`/api/predict` (그리고 `/api/predict-hourly`의 `severity` · `accident_type`):

```jsonc
{
  "severity": {
    "model_version": "risk-31f-v2.0.0",
    "predicted_class": "치명",
    "probabilities": {"경+중등도": 0.2516, "중상": 0.0787, "치명": 0.6697},
    "fatal_risk": {
      "p_fatal": 0.6697,          // 모형 내부값 — 화면에 띄우지 않음
      "percentile": 94.7,         // 상대 위험도 점수 (0~100) = 화면의 "종합 위험도"
      "top_percent": 5.3,
      "grade": "매우 높음",        // 낮음 0~50 / 보통 50~75 / 높음 75~90 / 매우 높음 90~100
      "grade_description": "사고 발생 시 치명 위험이 상위 10% 이내",
      "grade_fatal_rate": 24.47,  // 이 등급의 실제 치명률(%) — grade_validation.csv
      "lift_vs_base": 4.19,       // 전체 평균 치명률 대비 배수
      "base_fatal_rate": 5.84,
      "reference_n": 27907
    },
    "input_quality": {"missing_fields": ["기온_D1", "..."], "completeness": 0.71}
  },
  "accident_type": {
    "predicted_type": "끼임(Caught-in)",
    "confidence": 0.3689,
    "probabilities": {"끼임(Caught-in)": 0.3689, "...": 0.0},
    "ranked_types": [{"type": "끼임(Caught-in)", "probability": 0.3689}, "..."]
  }
}
```

- 사고유형 이름은 패키지 출력(`끼임` 등)을 `config.TYPE_DISPLAY_NAMES`로 바꿔 예전과 같은 이름(`끼임(Caught-in)` 등)을 씁니다.
  프론트·advisor.py·저장된 분석 기록이 이 이름을 키로 씁니다.
- `/api/predict-hourly`는 작업 시작~종료 시각을 1시간 간격으로 한 번에 배치 예측하고, `p_fatal`이 가장 큰 시각(동점이면 가장 이른 시각)을 대표로 고릅니다.
  `hourly.points[]`에 시각별 `percentile` · `grade` · `shift_type`(근무형태)이 들어 있습니다.

---

## 4. 확인한 것

- 패키지 데모(`python risk_model/predict.py`)가 패키지 README의 출력과 같은 값을 냄 (치명 0.6997 · 백분위 95.7 · 매우 높음).
- `/api/predict` · `/api/predict-hourly` · `/api/distributions`를 FastAPI TestClient로 호출해 정상 응답 확인.
  평일 08~17시 → 정규작업, 06·07·18시 이후 → 연장근무, 2026-10-09(한글날)·토요일 → 휴일근무로 판정됨.
- 프론트 선택지(constants.js)가 `feature_spec.json`의 `category_mapping`에 모두 들어 있음 (`질병`만 선택지에 없음).
- 로컬 Windows에서 `import app` 직후 RSS 약 313MB (예전 joblib 모형 기준 약 286MB).
