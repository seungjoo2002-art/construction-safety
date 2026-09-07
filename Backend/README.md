# 건설사고 예측 모델 — 백엔드 연동 패키지

두 개의 모델이 들어 있습니다. **입력 필드 31개가 완전히 동일**하므로, 한 번 받은 입력으로 두 모델을 같이 돌릴 수 있습니다.

| | 모형 1 — 위험도 | 모형 2 — 사고유형 |
|---|---|---|
| 예측 대상 | 부상 심각도 3분류 | 인적사고 유형 5분류 |
| 최종 모형 | RUS 1:4 + XGB/LGBM/Cat 소프트보팅 | Stacking (base 3종 3-fold OOF → 메타 XGB) |
| 학습 데이터 | 28,057건 | 29,117건 |
| 추론 모듈 | `predict_severity.py` | `predict_accident_type.py` |
| 부가 출력 | 치명 확률의 상대 위험도 | 유형별 상대 발생가능성 |

---

## 1. 파일 구성

```
severity_model/
├── config.py                  상수·매핑·피처목록·등급 컷오프  (수정 시 재학습 필수)
├── preprocessing.py           학습/추론 공통 전처리 (두 모형이 공유)
├── train_severity.py          [모형1] 학습
├── predict_severity.py        [모형1] ★ 백엔드가 import
├── train_accident_type.py     [모형2] 학습
├── predict_accident_type.py   [모형2] ★ 백엔드가 import
├── requirements.txt
└── artifacts/                 (학습 후 생성)
    ├── severity_model_rus4.joblib       모형1 모델 3종 + 전처리 메타   (~10MB)
    ├── fatal_distribution.json          치명 확률 참조분포 + 등급 컷오프
    ├── fatal_dist_reference.npy         정렬된 치명 확률 배열
    ├── fatal_dist_reference.csv
    ├── test_metrics_rus4.json
    ├── accident_type_stacking.joblib    모형2 base 9개 + 메타러너 + 메타 (~45MB)
    ├── type_distribution.json           유형별 확률 참조분포 + 등급 컷오프
    ├── type_dist_reference.npy          (n, 5) 참조분포
    ├── type_dist_reference.csv
    └── test_metrics_type.json
```

> **백엔드 배포 시**: `config.py`, `preprocessing.py`, `predict_*.py`, `artifacts/` 만 있으면 됩니다.
> `train_*.py`, 원본 엑셀, `imbalanced-learn`, `openpyxl` 은 서빙에 불필요합니다.

---

## 2. 학습 (개발자 로컬에서 1회)

```bash
pip install -r requirements.txt

python train_severity.py       --data "C:/.../건설사고 데이터(2026_05_17).xlsx"
python train_accident_type.py  --data "C:/.../건설사고 데이터(2026_05_17).xlsx"
```

| 옵션 | 설명 |
|---|---|
| `--data` | 원본 엑셀 경로 (기본값 `config.DATA_PATH`) |
| `--out` | 산출물 폴더 (기본 `./artifacts`) |
| `--folds` | 참조분포 산출용 OOF fold 수 (기본 5) |
| `--no-oof` | OOF 생략, 테스트셋 예측으로 참조분포 산출 (빠름) |

모형 2는 CatBoost 5분류가 무거워 코어 수에 따라 시간 차가 큽니다. 느리면 `--no-oof`로 먼저 돌리세요.

---

## 3. 모형 1 — 위험도 (부상 심각도 3분류)

| 클래스 | index | 원 4단계 | 건수 |
|---|---|---|---|
| 경+중등도 | 0 | L1(경상)+L2(중등도) | 23,912 (85.2%) |
| 중상 | 1 | L3 | 2,368 (8.4%) |
| 치명 | 2 | L4 | 1,777 (6.3%) |

### 테스트셋 성능 (5,612건)

| 지표 | 값 |
|---|---|
| **Accuracy** | **0.678** |
| **AUROC (치명)** | **0.812** |
| G-mean | 0.626 |
| MAUC (Hand-Till) | 0.805 |

| 클래스 | **Recall** | Precision | F1 |
|---|---|---|---|
| 경+중등도 | **0.693** | 0.923 | 0.792 |
| 중상 | **0.561** | 0.263 | 0.358 |
| 치명 | **0.631** | 0.222 | 0.328 |

치명 355건 중 224건 포착. Precision이 낮은 것은 의도된 설계입니다 — 치명 사고를 놓치지 않는 것(Recall)을 우선한 RUS + balanced weight 구성이라 오탐이 늘어나는 대신 미탐이 줄어듭니다.

### 사용법

```python
from predict_severity import SeverityPredictor
predictor = SeverityPredictor()          # ★ 앱 기동 시 1회만 생성
result = predictor.predict_one({...31개 필드...})
```

```json
{
  "model_version": "severity-rus4-v2",
  "predicted_class": "치명",
  "probabilities": { "경+중등도": 0.367, "중상": 0.261, "치명": 0.371 },
  "fatal_risk": {
    "p_fatal": 0.371, "percentile": 79.77, "top_percent": 20.23,
    "grade": "보통", "grade_description": "평균 수준의 위험",
    "lift_vs_median": 2.17, "reference_n": 22445, "reference_source": "oof_train"
  },
  "input_quality": { "missing_fields": [], "completeness": 1.0 }
}
```

| 필드 | 화면 표기 예 |
|---|---|
| `predicted_class` | "예상 심각도: 치명" |
| `percentile` | 상대 위험도 점수(0~100) — 게이지 |
| `top_percent` | "전체 사고 중 상위 20.2%" |
| `grade` | 배지 (낮음/보통/주의/위험/매우위험) |
| `lift_vs_median` | "평균적 사고보다 2.2배 위험" |

### 치명 확률 참조분포 (학습셋 5-fold OOF, n=22,445)

| 실제 클래스 | n | 평균 | 중앙값 | IQR |
|---|---|---|---|---|
| 경+중등도 | 19,129 | 0.221 | 0.168 | 0.089–0.307 |
| 중상 | 1,894 | 0.140 | 0.077 | 0.021–0.202 |
| 치명 | 1,422 | 0.508 | 0.500 | 0.274–0.751 |

등급 컷오프 (`config.RISK_GRADES`에서 조정 가능):

| 등급 | 백분위 | P(치명) |
|---|---|---|
| 매우위험 | 상위 1% | ≥ 0.867 |
| 위험 | 상위 5% | ≥ 0.654 |
| 주의 | 상위 20% | ≥ 0.374 |
| 보통 | 상위 50% | ≥ 0.171 |
| 낮음 | 나머지 | < 0.171 |

> ⚠️ `p_fatal`은 **보정되지 않은 값**입니다. RUS + balanced weight 때문에 실제 치명 발생률(6.3%)보다 훨씬 크게 나옵니다. **"치명 확률 37%"로 표기하면 안 됩니다.** 백분위·등급·배수(lift) 형태의 상대 지표로만 노출하세요.

---

## 4. 모형 2 — 사고유형 (인적사고 5분류)

원본 `인적사고` 25종 중 15종을 5분류로 매핑, **29,117건** 사용 (기타·분류불능·화재·감전 등 3,852건 제외).

| 클래스 | index | 건수 |
|---|---|---|
| 끼임(Caught-in) | 0 | 3,589 (12.3%) |
| 절단·베임·찔림(Cut) | 1 | 2,995 (10.3%) |
| 추락·압착(Falls) | 2 | 6,963 (23.9%) |
| 물체에 맞음(Struck-by) | 3 | 4,717 (16.2%) |
| 전도·충돌(Trips/Struck-against) | 4 | 10,853 (37.3%) |

### 테스트셋 성능 (5,824건)

| 지표 | 값 |
|---|---|
| **Accuracy** | **0.448** |
| Macro F1 | 0.441 |
| Macro Recall | 0.461 |
| **G-mean** | **0.456** |
| MAUC (Hand-Till) | 0.759 |
| AUROC (macro, OvR) | 0.752 |

| 클래스 | **Recall** | Precision | F1 | AUC |
|---|---|---|---|---|
| 끼임 | 0.400 | 0.262 | 0.316 | 0.715 |
| 절단·베임·찔림 | **0.601** | 0.481 | 0.535 | **0.838** |
| 추락·압착 | 0.462 | 0.507 | 0.484 | 0.756 |
| 물체에 맞음 | 0.416 | 0.314 | 0.358 | 0.719 |
| 전도·충돌 | 0.427 | 0.635 | 0.511 | 0.734 |

혼동행렬 (행=실제, 열=예측)

| | 끼임 | 절단 | 추락 | 맞음 | 전도 |
|---|---|---|---|---|---|
| **끼임** | **287** | 87 | 86 | 148 | 110 |
| **절단** | 52 | **360** | 53 | 80 | 54 |
| **추락** | 189 | 94 | **644** | 226 | 240 |
| **맞음** | 203 | 97 | 121 | **392** | 130 |
| **전도** | 365 | 110 | 366 | 402 | **928** |

5클래스 랜덤 기준선이 0.20이므로 정확도 0.448은 그 2.2배입니다. 사고 발생 **이전**에 알 수 있는 현장 메타데이터만으로 유형을 맞히는 문제라 상한이 낮습니다. 절단·베임(AUC 0.838)이 가장 잘 구분되고, 끼임과 물체에 맞음이 서로 혼동됩니다.

### 사용법

```python
from predict_accident_type import AccidentTypePredictor
predictor = AccidentTypePredictor()      # ★ 앱 기동 시 1회만 생성
result = predictor.predict_one({...31개 필드...})
```

```json
{
  "model_version": "accident-type-stacking-v1",
  "predicted_type": "전도·충돌(Trips/Struck-against)",
  "confidence": 0.296,
  "probabilities": { "끼임(Caught-in)": 0.210, "...": "..." },
  "ranked_types": [ { "type": "...", "probability": 0.296, "percentile": 75.8,
                      "lift_vs_mean": 1.27, "actual_prior": 0.373,
                      "likelihood": "보통" }, "..." ],
  "elevated_types": [ "...백분위 80 이상인 유형만..." ],
  "input_quality": { "missing_fields": [], "completeness": 1.0 }
}
```

**`elevated_types`가 실무적으로 핵심입니다.** 확률 1위만 보면 전체의 37%를 차지하는 '전도·충돌'이 계속 나오기 쉽습니다. "이 현장은 추락 확률이 전체 대비 상위 3%"처럼 **평소보다 유난히 높은 유형**을 짚어줘야 예방조치로 연결됩니다. 임계값은 `predict(data, elevated_percentile=80.0)`으로 조정합니다.

### 유형별 확률 참조분포

| 클래스 | 실제비율 | 평균확률 | 실제일 때 | 아닐 때 | 상위 5% 컷 |
|---|---|---|---|---|---|
| 끼임 | 0.123 | 0.196 | 0.265 | 0.186 | 0.393 |
| 절단·베임·찔림 | 0.103 | 0.160 | **0.468** | 0.125 | 0.615 |
| 추락·압착 | 0.239 | 0.213 | 0.328 | 0.177 | 0.543 |
| 물체에 맞음 | 0.162 | 0.198 | 0.276 | 0.182 | 0.408 |
| 전도·충돌 | 0.373 | 0.234 | 0.320 | 0.182 | 0.622 |

"실제일 때" 확률이 "아닐 때"보다 일관되게 높아 방향성은 맞습니다. 다만 격차가 모형 1의 치명(0.508 vs 0.17)만큼 크지 않아, **단정적 예측보다는 상대적 주의 환기 용도**로 쓰는 게 맞습니다.

등급은 `config.TYPE_LIKELIHOOD_GRADES`: 상위 5% → 매우높음 / 상위 20% → 높음 / 상위 50% → 보통 / 나머지 → 낮음

---

## 5. 입력 명세 (두 모형 공통, 31개)

`config.RAW_INPUT_COLS`. **컬럼명은 아래 문자열 그대로** 써야 합니다.

### 범주형 9개 — 원본 문자열 그대로

`사고객체 - 대분류` · `작업프로세스` · `공종 - 중분류` · `시설물 종류 - 중분류` · `추출된_작업종류` · `시설물 종류 - 대분류` · `안전관리계획` · `설계안전성검토` · `공공/민간 구분`

### 순서형 5개 — ⚠️ 구간 문자열이 매핑표와 **정확히** 일치해야 함

| 필드 | 허용 값 |
|---|---|
| `공정률` | `10% 미만`, `10~19%`, … `90% 이상` (10종) |
| `공사비` | `1,000만원 미만` … `1,000억원 이상`, `분류불능` (17종) |
| `작업자수` | `19인 이하`, `20~49인`, `50~99인`, `100~299인`, `300~499인`, `500인 이상` |
| `낙찰률` | `60% 미만`, `60~64%`, … `90% 이상` (8종) |
| `연령_ord` | 숫자 (0~5) |

물결표는 `~`(U+007E)입니다. `∼`나 `-`를 쓰면 매핑 실패 → 결측 처리됩니다. `config.py`의 `PROGRESS_MAP` / `COST_MAP` / `WORKER_MAP` / `BID_MAP`을 그대로 프론트 드롭다운으로 쓰시면 안전합니다.

### 날짜 4개

`공사시작일` · `공사종료일` · `발생일시` · `사고일시_x` — `YYYY-MM-DD` 또는 `YYYY-MM-DD HH:MM`

### 기상 13개 — 전부 숫자

| 그룹 | 필드 |
|---|---|
| 사고 당일 | `기상상태 - 습도`(%), `평균기온(°C)`, `일강수량(mm)`, `평균 풍속(m/s)` |
| 1일 전 | `기온_D1`, `강수_D1`, `풍속_D1` |
| 2일 전 | `기온_D2`, `강수_D2`, `풍속_D2` |
| 3일 전 | `기온_D3`, `강수_D3`, `풍속_D3` |

기상청 ASOS 관측값 기준. `기상상태 - 기온`(사고 조서 입력값)은 **넣지 않습니다** — 범위가 −83~436°C로 오염돼 있어 피처에서 제외했습니다.

### 결측 처리

**결측 허용**입니다. 없는 필드는 범주형→미지값(−1), 수치형→학습셋 중앙값으로 자동 처리되고, `input_quality.missing_fields`에 어떤 필드가 비었는지 나옵니다. 결측이 많으면 예측이 평균 쪽으로 끌려가니 프론트에서 입력 보완을 유도하는 게 좋습니다.

### 입력 31개 → 모델 피처 32개

```
날짜 4개      →  전체공사일수 · 공사임박도 · 사고_월 · 사고_요일 · 사고_시간  (5개)
작업프로세스   →  작업프로세스_clean  (희소 범주는 '기타'로 통합)
나머지 27개   →  1:1 대응
```

---

## 6. FastAPI 예시 (두 모델 동시)

```python
from fastapi import FastAPI
from pydantic import BaseModel
from typing import Any, Dict
from predict_severity import SeverityPredictor
from predict_accident_type import AccidentTypePredictor

app = FastAPI()
severity = SeverityPredictor()           # 기동 시 1회
acc_type = AccidentTypePredictor()       # 기동 시 1회

class AccidentIn(BaseModel):
    data: Dict[str, Any]

@app.post("/api/predict")
def predict(body: AccidentIn):
    return {
        "severity": severity.predict_one(body.data),
        "accident_type": acc_type.predict_one(body.data),
    }

@app.get("/api/distributions")
def distributions():
    return {
        "severity": severity.distribution_summary(),
        "accident_type": acc_type.distribution_summary(),
    }
```

---

## 7. 원 노트북 대비 변경점

| 항목 | 원본 | 정리본 | 이유 |
|---|---|---|---|
| 모형 선택 | RUS 1~6 루프 / 시각화 셀 | **최종 모형만** | 배포용 |
| 범주형 dtype | `astype('category')` (매번 값에서 추론) | **고정 레벨 목록** | 신규 데이터 1건 넣으면 카테고리가 1개가 되어 학습 때와 다른 코드로 해석됨 → **에러 없이 조용히 틀린 예측** |
| 전처리 파라미터 | 저장 안 함 | joblib에 저장 | 범주 코드·중앙값·희소범주 목록은 학습셋에서 나온 값이라 재현 불가했음 |
| 모델 저장 | 없음 (셀 실행마다 재학습) | joblib 번들 | API 요청마다 학습할 수 없음 |
| 참조분포 | 테스트셋 in-sample | **학습셋 OOF** | 학습 데이터를 그대로 예측하면 확률이 과하게 벌어져 상대 지표가 왜곡 |
| 미지 범주 | 처리 없음 | 코드 −1로 안전 처리 | 신규 데이터에 학습에 없던 공종/작업이 들어올 수 있음 |
| 셀 간 전역변수 | `Xte_c`, `to_cat` 등 암묵 의존 | 함수 인자로 전달 | 파일로 떼내면 `NameError` |
| 사고_시간 결측 | `np.random.choice` 랜덤 대체 | 추론은 중앙값 | 같은 입력 → 같은 출력 보장 |
| 경로/폰트 | 하드코딩, `Malgun Gothic` | 환경변수, 제거 | 리눅스 서버 |
| `공정임박률_c` | 피처 포함 (33개) | **삭제 (32개)** | 원본이 0~1 스케일이 아닌데 `clip(0,1)` → 99.7%가 1.0으로 상수화, 중요도 0.00 |

### 검증 결과

| 확인 항목 | 모형 1 | 모형 2 |
|---|---|---|
| 단건 예측 = 배치 예측 | 최대 오차 **0.0** | 최대 오차 **0.0** |
| 학습에 없던 범주 투입 | 정상 (−1 처리) | 정상 (−1 처리) |
| 학습→저장→재로드→추론 | 통과 | 통과 |

---

## 8. 남은 작업 / 알려진 이슈

- [ ] `기상상태 - 기온` 품질 이슈 (−83 ~ 436°C, 45°C 초과 694건). **현재 두 모형 모두 피처 미포함**이라 영향 없음. 사용하려면 정제 필요
- [ ] `공정임박률` 원자료 산출 근거 확인 (−40,525 ~ 232,900, 계산식 역추적 실패)
- [ ] `config.RISK_GRADES` / `TYPE_LIKELIHOOD_GRADES` 컷오프를 현업 기준에 맞춰 조정할지 검토
- [ ] 재학습 주기·데이터 갱신 정책 결정 (`MODEL_VERSION` 문자열 올리기)
- [ ] 모형 2 번들이 45MB (base 9개 저장). 서버 메모리 여유 확인
