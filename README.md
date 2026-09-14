# AI 건설현장 안전관리 시스템 — 배포 가이드

이 문서는 프런트엔드를 **Render Static Site**로, 사고 사례 검색 데이터를
**Hugging Face Dataset Viewer API**로 서빙하도록 전환한 아키텍처를 설명합니다.

## 무엇이 바뀌었나

| 기능 | 이전 | 이후 |
|---|---|---|
| 프런트엔드 배포 | Render Web Service (없어도 되는데 백엔드와 묶여 있었음) | **Render Static Site** (`Frontend/`만 정적 배포) |
| 사고 사례 검색·상세 (`similar-cases.html`, `case-detail.html`) | 백엔드가 `assets/df_db.csv`(30MB)를 요청 시 SQLite로 변환해 서빙 (`incidents_db.py`, `/api/cases*`, `/api/incidents`) | **브라우저가 Hugging Face Dataset Viewer API를 직접 호출** — 백엔드 경유 없음 |

`incidents_db.py`와 `assets/incidents.db`(빌드 산출물)는 삭제했습니다. Render는 더
이상 이 기능을 위해 대용량 CSV를 내려받거나 SQLite로 변환·파싱하지 않습니다.

## 무엇이 바뀌지 않았나 (그대로 Render Web Service에 남음)

아래 4개는 **실제 서버 연산**이라 Hugging Face Dataset Viewer API(행 조회 전용)로
대체할 수 없습니다. `Backend/`는 계속 별도 Render Web Service로 배포해야 합니다.

| 엔드포인트 | 이유 |
|---|---|
| `POST /api/predict` | 학습된 ML 모델(joblib) 실시간 추론 |
| `POST /api/analyze` | 임베딩 기반 코사인 유사도 계산 + MDS 산점도 렌더링 + 재발방지대책 생성 |
| `POST /api/analyze-photo` | YOLO 객체탐지 모델 추론 |
| `POST /api/chat` | Gemini API 키를 서버에서만 보관(브라우저에 노출 금지) |

`similarity_service.py`(`/api/analyze`)는 `assets/df_db.csv`를 독자적으로 계속
사용합니다 — 사고 사례 검색 기능과는 별개의 코드 경로라 이번 마이그레이션 대상이
아닙니다. **이 4개 엔드포인트의 입출력/동작은 전혀 바뀌지 않았습니다** — 단,
Render 무료 Web Service(512MB)에서 실제로 돌아가도록 `similarity_service.py`와
`app.py`의 **메모리 수명 관리**만 고쳤습니다(2번 섹션 참고). 결과값은 기존과
100% 동일합니다.

---

## 1. Render Static Site 설정 (프런트엔드)

Render 대시보드에서 **New → Static Site**로 이 저장소를 연결하고 아래 값을 입력하세요.

| 항목 | 값 |
|---|---|
| Build Command | `node scripts/generate-env.js` |
| Publish Directory | `Frontend` |
| Root Directory | (비워둠 — 저장소 루트) |

### 환경변수 (Static Site → Environment 탭)

전부 **공개 정보**입니다(토큰 아님). `render.yaml`을 쓰면 대시보드에서 값만 채우면
됩니다.

| 이름 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `HF_DATASET_ID` | ✅ | (없음) | 3번에서 만든 Hugging Face 데이터셋 repo id. 예: `your-username/construction-incidents` |
| `HF_DATASET_CONFIG` | – | `default` | 데이터셋 config 이름 (CSV 하나만 올리면 보통 `default`) |
| `HF_DATASET_SPLIT` | – | `train` | 데이터셋 split 이름 |
| `HF_API_BASE` | – | `https://datasets-server.huggingface.co` | 변경할 일 거의 없음 |
| `BACKEND_API_BASE_URL` | ✅ | `http://127.0.0.1:8000` | 아래 2번에서 배포한 Backend Web Service의 실제 URL. 예: `https://ai-safety-backend.onrender.com` (predict/analyze/analyze-photo/chat이 이 값을 씀) |

`HF_DATASET_ID`를 비워두면 빌드는 성공하지만, 사례 검색 화면에 "Hugging Face
데이터셋이 아직 설정되지 않았어요" 상태가 표시됩니다(에러로 죽지 않음).

### 왜 Vite의 `VITE_*` 규칙을 안 썼나

이 프로젝트는 Vite/React/Next.js가 아니라 **번들러 없는 순수 정적 HTML/CSS/JS**
앱입니다(`Frontend/html/*.html` + `Frontend/js/**/*.js`, 전부 `<script>` 태그로 직접
로드). `import.meta.env`처럼 번들러가 값을 주입해줄 방법이 없어서, 대신
`scripts/generate-env.js`(Node 내장 모듈만 사용, npm install 불필요)가 Build
Command로 실행되어 `Frontend/js/common/env.js`를 직접 생성합니다. 이 파일이
`window.APP_CONFIG`를 정의하고, `hf-dataset.js`가 이 값을 읽습니다. 그래서 환경변수
이름은 `VITE_HF_DATASET_ID`가 아니라 `HF_DATASET_ID`입니다.

빌드 스크립트는 그 외에 저장소 루트의 `pictures/`를 `Frontend/pictures/`로도
복사합니다 — Publish Directory가 `Frontend` 하나뿐이라, 그 바깥에 있는 아이콘
파일까지 함께 배포되게 하기 위함입니다(로컬 저장소의 `pictures/`는 원래 위치 그대로
둡니다).

---

## 2. Render Web Service 설정 (백엔드 — `Backend/app.py`)

| 항목 | 값 |
|---|---|
| Root Directory | `Backend` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn app:app --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/health` |

`PORT`는 Render가 서비스마다 자동으로 주입하는 환경변수라 직접 등록할 필요는
없습니다(Start Command에서 `$PORT`로 그대로 참조하면 됩니다). `requirements.txt`는
`Backend/requirements.txt`에 있고, Root Directory를 `Backend`로 잡으면 Build
Command에서 상대경로 `requirements.txt`만으로 정확히 그 파일을 가리킵니다.

### 환경변수 (Web Service → Environment 탭)

| 이름 | 필수 | 비밀값? | 설명 |
|---|---|---|---|
| `OPENAI_API_KEY` | 선택 | ✅ 비밀 | 있으면 `/api/analyze`가 임베딩 기반 정밀 유사도 사용. 없으면 카테고리 근사 유사도로 자동 대체(에러 아님) |
| `GEMINI_API_KEY` | 선택 | ✅ 비밀 | 없으면 `/api/chat`이 "설정 안 됨" 안내만 반환(서버는 안 죽음) |
| `HF_TOKEN` | 선택 | ✅ 비밀 | 임베딩 자산(`db_v_*.npy`) 데이터셋을 비공개(gated)로 바꾼 경우에만 필요 |
| `ALLOWED_ORIGINS` | 권장 | 공개 정보 | 프런트 Static Site 실제 URL. 쉼표로 여러 개 가능. 예: `https://ai-safety-frontend.onrender.com`. 비워두면 전체 허용(`*`)으로 동작(로컬 개발엔 편하지만 운영에선 좁히는 걸 권장) |

### 512MB 메모리 제한 대응 — 직접 측정하고 고친 내용

**결론부터: 기존 코드는 512MB에서 OOM이 확정적으로 났을 것이고(측정치: 요청 1회 처리 중
peak **719MB**, idle 기동 시점도 이미 **~508MB** 추정), 두 군데를 고쳐서 idle
기동 **~286MB**, 요청 처리 중 peak **약 450~470MB**(512MB 대비 약 45~60MB/9~12%
여유)로 낮췄습니다.** `mmap_mode='r'`이 "그냥 안전하다"고 가정하지 않고, 실제
`Backend/assets/db_v_*.npy`(각 137MB, 총 411MB)와 실제 joblib 모델을 그대로
로드해 `psutil`로 RSS를 직접 측정하며 검증했습니다.

**문제 1 — 임베딩 3개를 서비스 생애주기 내내 들고 있었음.**
`similarity_service.py`가 `__init__`에서 `db_v_fac/con/wrk.npy`를 `mmap_mode='r'`로
열어 `self.db_v_*`로 계속 들고 있었습니다. mmap은 여는 순간엔 가볍지만(+1MB),
**`cosine_similarity(query, self.db_v_fac)`처럼 배열 전체를 훑는 연산을 하면 그
순간 파일 크기만큼 그대로 RSS에 반영됨을 실측으로 확인**했습니다(파일당 +131MB,
mmap 여부와 무관). 3개를 전부 인스턴스 속성으로 들고 있었기 때문에, 유사도 분석
요청 1번만 처리해도 3개가 전부 상주해 719MB까지 쌓였습니다.

→ **고친 내용**: `self.db_v_fac/con/wrk`를 없애고 **경로만** 저장한 뒤,
`_channel_similarity()`/`_channel_rows()`가 채널 하나씩만 그때그때 열었다가
`del` + `gc.collect()`로 바로 해제하도록 `similarity_service.py`를 수정했습니다
(`_text_channels_embedding()`). 계산 결과(코사인 유사도 값)는 완전히 동일하고,
메모리에 머무는 시간만 바뀝니다. 재측정 결과 peak가 **719MB → 약 450~470MB**로
떨어졌습니다.

**문제 2 — 사진 분석(YOLO/torch)이 서버 기동 시점에 항상 로드되고 있었음.**
`app.py`가 모듈 임포트 시점에 `hazard_service = Hazard()`를 즉시 실행했는데,
`Hazard()` 생성자 안의 `from ultralytics import YOLO`가 torch를 끌어옵니다. 실측
결과 **`Hazard()` 생성 하나만으로 +238MB**가 들었습니다. 위험도·사고유형 모델
로드(+222MB)와 `similarity_service` 모듈 임포트(+48MB, matplotlib 등)까지 합치면
**요청을 1건도 받기 전, 서버가 켜지는 순간부터 이미 약 508MB**로 추정되어 컨테이너
기동 자체가 OOM으로 실패할 수 있습니다.

→ **고친 내용**: 기존에 `/api/analyze`용으로 이미 쓰던 지연 초기화 패턴
(`get_sim_service()`)을 그대로 사진 분석에도 적용해 `get_hazard_service()`를
추가했습니다 — `/api/analyze-photo`가 처음 호출될 때만 torch/YOLO를 로드합니다.
실제로 `app.py`를 통째로 import해서 측정한 결과, **idle 기동 RSS가 286.0MB**로
줄었고(`/health`도 정상 응답, `sim_service`/`hazard_service` 둘 다 아직 `None`
상태로 지연 유지됨을 확인), `/api/predict`처럼 이 둘을 안 쓰는 요청들에는 전혀
영향이 없습니다.

**남은 마진에 대한 솔직한 평가.** 약 45~60MB(9~12%) 여유는 "확실히 안전"이라고
말하기엔 넉넉하지 않습니다. 이 수치는 uvicorn 1 워커·순차 요청 1건 기준이고,
동시 요청이나 장시간 운영 중 메모리 단편화까지 고려하면 여유가 더 줄어들 수
있습니다. 참고로 `OPENAI_API_KEY`를 설정하지 않은 폴백 모드(카테고리 근사 유사도)는
임베딩 파일을 아예 건드리지 않아 idle 기동(286MB)에서 거의 늘지 않는, 훨씬 안전한
경로입니다.

**그래도 OOM이 계속 나면 — 다음 단계 (이번 범위 밖, 구현하지 않음)**
- **최소 추가 변경**: `db_v_*.npy`를 float32 → float16으로 다운캐스트해서 재생성/재업로드
  (채널당 파일 크기 137MB → 약 68.5MB, peak를 한 번 더 줄일 수 있음). 정밀도가 약간
  낮아지지만 top-20 순위 매기기 용도라 영향은 작을 것으로 예상 — 실측/검증 필요.
- **더 견고한 방법(권장)**: 임베딩 유사도 계산을 이 프로세스 밖으로 분리 — 예를 들어
  Qdrant Cloud/Pinecone 같은 관리형 벡터 DB에 `db_v_fac/con/wrk`를 인덱싱해두고,
  `/api/analyze`는 그 벡터 DB에 검색 API로 질의만 하도록 바꾸는 방식입니다. 이러면
  Render Web Service 프로세스는 임베딩 파일을 아예 들고 있지 않아도 되어 메모리
  마진이 훨씬 넉넉해집니다. 새 외부 서비스 계정/데이터 업로드가 필요해 이번
  세션에서는 구현하지 않았고, 설계만 제시합니다.

### CORS

`ALLOWED_ORIGINS` 환경변수(쉼표 구분)로 허용 도메인을 좁힐 수 있게 `app.py`를
고쳤습니다. 비워두면 기존처럼 전체 허용(`*`)으로 동작해 로컬 개발은 그대로
편합니다 — 운영 배포에서는 프런트 Static Site URL로 좁히는 걸 권장합니다.

### `/health`

Render의 Health Check Path로 그대로 씁니다. 위험도·사고유형 모델은 서버 기동
시점에 항상 로드되므로(실패하면 `/health` 자체가 응답 못 함) 별도 표시가 필요
없고, 대신 `similarity_service_initialized`/`photo_analysis_initialized`(둘 다
지연 초기화라 아직 `false`일 수 있음)를 가볍게 같이 보여주도록 확장했습니다 —
이 값을 확인하려고 헬스체크가 무거운 초기화를 유발하지는 않습니다.

---

## 3. Hugging Face 데이터셋 준비 (필수, 1회)

사례 검색이 동작하려면 **당신이 직접** 데이터셋을 Hugging Face에 올려야 합니다.
이 저장소는 그 데이터셋을 만드는 스크립트만 제공하고, 실제 업로드는 하지 않습니다.

### 2-1. 변환 스크립트 실행 (로컬)

```bash
cd Backend
pip install pandas   # 이미 requirements.txt에 있으면 생략
python prepare_hf_dataset.py
# → Backend/hf_dataset_export/incidents.csv 생성
```

이 스크립트는 `assets/df_db.csv`(22,325건)에 구 `incidents_db.py`와 동일한 파생
컬럼 5개를 추가합니다: `id`(0-based 행 인덱스), `year`, `hazard_tag`(추락/전도/
낙하/끼임/베임/감전/기타), `severity_tag`(치명/중상/경상), `victims_text`,
`search_blob`(검색용 텍스트).

> ⚠️ **`id`는 원본 행 순서와 정확히 같아야 합니다.** `similarity_service.py`가
> `/api/analyze` 응답의 `similar_cases[].id`로, 그리고 `case-detail.html?id=...`
> 링크가 이 값을 그대로 씁니다. 업로드 전에 행을 정렬·필터링·셔플하면 기존 상세보기
> 링크가 전부 깨집니다.

### 2-2. Hugging Face에 데이터셋으로 업로드

```bash
pip install huggingface_hub
huggingface-cli login   # 발급받은 토큰 입력 (쓰기 권한)

python - <<'PY'
from huggingface_hub import HfApi
api = HfApi()
repo_id = "your-username/construction-incidents"   # 원하는 이름으로 변경
api.create_repo(repo_id, repo_type="dataset", private=False, exist_ok=True)
api.upload_file(
    path_or_fileobj="Backend/hf_dataset_export/incidents.csv",
    path_in_repo="incidents.csv",
    repo_id=repo_id,
    repo_type="dataset",
)
PY
```

**필요한 파일 구조**: 데이터셋 repo 루트에 CSV(또는 Parquet) 파일 1개만 있으면
충분합니다. Hugging Face가 업로드 후 자동으로 Parquet으로 변환해 Dataset Viewer
API(행 조회/필터)를 켜줍니다 — 보통 파일 크기에 따라 수 분~수십 분 걸립니다.
CSV 대신 직접 Parquet을 올리고 싶다면 `python prepare_hf_dataset.py --parquet`으로
`incidents.parquet`도 함께 만든 뒤 그 파일을 올리세요(`pip install pyarrow` 필요) —
변환 대기 시간을 줄일 수 있습니다.

**반드시 Public(공개) 데이터셋으로 만드세요.** 브라우저가 토큰 없이 직접 호출하는
구조라, 비공개(private/gated)로 두면 Dataset Viewer API가 401/403을 반환합니다.

### 2-3. 준비 확인

1. `https://huggingface.co/datasets/<repo_id>`에 접속해 "Data Studio"(Viewer) 탭이
   행을 정상적으로 보여주는지 확인합니다.
2. 아래 명령으로 실제 API 응답을 확인합니다(비밀값 없음, 그대로 실행 가능):
   ```bash
   curl "https://datasets-server.huggingface.co/rows?dataset=<repo_id>&config=default&split=train&offset=0&length=1"
   ```
3. Render Static Site의 `HF_DATASET_ID` 환경변수에 `<repo_id>`를 넣고 재배포합니다.

---

## 4. 검색/필터 API 사용 방식과 한계

`Frontend/js/common/hf-dataset.js`가 다음 두 엔드포인트를 씁니다.

- **행 조회**: `GET /rows?dataset=...&config=...&split=...&offset=...&length=...`
  (`length` 기본 50, 최대 100 — `_hfClampLength()`가 강제로 자릅니다)
- **검색/필터**: `GET /filter?...&where="hazard_tag"='추락' AND "search_blob" LIKE '%키워드%'`
  (컬럼명은 반드시 큰따옴표로 감싸야 합니다 — HF 공식 예시로 직접 검증한 문법입니다)

### 필터가 항상 보장되지는 않습니다

`/filter`는 데이터셋마다 **서버 측 duckdb 인덱스**가 준비되어 있어야 동작합니다.
데이터셋을 막 만들었거나 오랫동안 조회가 없었으면 `"the dataset index is loading"`
같은 일시적 오류가 날 수 있습니다(실제 API로 직접 확인한 현상입니다). 이런 경우
`hf-dataset.js`는 **자동으로 필터 없는 `/rows` 호출로 전환**하고,
`_filterUnsupported: true`를 반환합니다. 프런트(`similar-cases.js`)는 이 플래그를
받으면 목록을 필터가 적용된 것처럼 조용히 보여주지 않고, 화면에
**"⚠️ 지금은 서버 측 검색/필터가 지원되지 않아 전체 목록을 보여드리고 있어요"**라고
명시합니다.

### 향후 검색이 계속 불안정하다면

`/filter`가 이 데이터셋 규모·구조에서 지속적으로 불안정하다고 판단되면, 검색만
전담하는 가벼운 서버리스 함수(예: Render Web Service 없이 Cloudflare
Workers/Vercel Functions 등)나 별도 검색 인덱스(Algolia, Meilisearch 등) 도입을
검토하세요. 이번 마이그레이션 범위에는 포함하지 않았습니다.

---

## 5. PWA / 오프라인 동작

- `Frontend/sw.js`는 앱 셸(HTML/CSS/JS/아이콘/manifest/오프라인 화면)만 precache
  합니다. Hugging Face URL이나 대용량 원본 파일은 **절대 precache하지 않습니다**
  (`isLargeRawDataRequest()`가 `*.huggingface.co` 도메인 전체를 서비스워커 캐시
  대상에서 제외).
- 사례 검색/상세 조회 결과는 `idb-store.js`를 통해 IndexedDB에 저장됩니다(최근
  검색 결과 kind별 최대 20개, 즐겨찾기는 무제한). 원본 데이터 전체는 저장하지
  않습니다.
- 요청 흐름은 **Network First**입니다: HF API를 먼저 시도하고, 실패하면
  IndexedDB에 저장된 마지막 결과를 보여주면서 화면에 **"저장된 최근 데이터"**
  배지를 명시합니다(`api.js`의 `getCases`/`getCaseDetail`). 캐시도 없으면 최후의
  수단으로 `mock-cases.js`의 목업 6건을 보여주고 "MOCK"으로 표시합니다.

---

## 6. 검증 결과 (이번 작업에서 직접 확인함)

1. **빌드**: `HF_DATASET_ID` 유무 양쪽 모두 `node scripts/generate-env.js`가
   오류 없이 끝나고, `env.js`가 올바르게 생성됨을 확인했습니다.
2. **결과물 크기 점검**: 빌드 후 `Frontend/` 전체가 약 **813KB**이며,
   `*.csv`/`*.xlsx`/`*.db`/`*.sqlite`/`*.parquet`/`*.joblib`/`*.npy` 등 대용량
   원본 확장자를 가진 파일이 **하나도 없음**을 확인했습니다.
3. **HF API 실제 호출 검증** (비밀값 없이, 공개 데이터셋으로 테스트):
   - `GET /rows`: 공개 데이터셋(`rajpurkar/squad`)으로 실제 호출해 응답 형태
     (`rows[].row`, `num_rows_total`, `partial`)가 `hf-dataset.js`의 파싱 로직과
     정확히 일치함을 확인했습니다.
   - `GET /filter`: 컬럼명을 따옴표 없이 보내면 422 오류가 남을 실제로 확인해서
     `"컬럼명"` 형태로 코드를 수정했고, 수정 후 문법 오류는 사라짐을 확인했습니다
     (해당 테스트 데이터셋의 인덱스가 아직 준비 중이라 "index is loading" 500이
     남았는데, 이건 4번에서 설명한 정상적인 일시 상태이며 코드가 자동으로 `/rows`
     폴백으로 처리합니다).
4. **백엔드 메모리 실측** (`Backend/assets/`의 실제 137MB×3 임베딩 파일 + 실제
   joblib 모델로 `psutil` RSS를 직접 측정, 로컬 Windows 환경):
   - 수정 전: idle 기동 baseline 약 326.5MB(예측 모델만 기준) → `hazard_service`
     eager 로드까지 포함하면 약 508MB로 추정, `/api/analyze` 1회 처리 중 peak
     **719.3MB** (512MB 초과 확정적).
   - 수정 후: `import app` 실행 시 실제 RSS **286.0MB**(위험도·사고유형 모델
     로드 완료, `hazard_service`/`sim_service`는 지연 상태), `/health` 200 정상
     응답 확인. `/api/analyze` 1회 처리 중 peak **약 450~470MB**로 하락(채널별
     +131MB 순간 피크는 여전하지만 채널 간 누적되지 않음을 `del`+`gc.collect()`
     전후 RSS로 직접 확인).
   - `python -m py_compile`/`ast.parse` 상당의 문법 검증과 `FastAPI TestClient`로
     `/health` 실제 호출까지 확인했습니다. Render 컨테이너(Linux/cgroup) 자체에는
     배포해보지 못했으므로, 실배포 후 로그의 실제 메모리 그래프로 한 번 더
     확인하는 걸 권장합니다.
5. Render 대시보드 실제 배포/HF 실데이터셋 업로드는 이 세션에서 수행할 수 없어
   대시보드/HF 쪽 체크리스트는 아래 7번에 남겨둡니다.

---

## 7. 체크리스트

### 이번에 변경된 파일

- **신규**: `render.yaml`, `.env.example`, `scripts/generate-env.js`,
  `Frontend/index.html`, `Frontend/js/common/env.js`, `Frontend/js/common/hf-dataset.js`,
  `Backend/prepare_hf_dataset.py`
- **수정**:
  - `Backend/app.py` — 사례 조회 3개 엔드포인트 제거, `ALLOWED_ORIGINS` 환경변수로
    CORS 도메인 제한 가능하게 변경, `/health` 응답 확장, `hazard_service`
    (YOLO/torch) 지연 초기화로 전환(512MB 대응)
  - `Backend/similarity_service.py` — `db_v_fac/con/wrk`를 인스턴스에 상주시키지
    않고 채널 단위로 열었다 바로 해제하도록 변경(512MB 대응, 계산 결과는 동일)
  - `Backend/.gitignore`
  - `Frontend/js/common/api.js` — 사례 조회를 HF 기반으로 교체,
    `API_BASE_URL`을 `BACKEND_API_BASE_URL` 환경변수로 설정 가능하게 변경
  - `Frontend/js/pages/similar-cases.js`(이전/다음 페이지네이션 + 오류/설정필요 상태)
  - `Frontend/html/similar-cases.html`, `Frontend/html/case-detail.html`,
    `Frontend/html/dashboard.html`, `Frontend/html/predict-loading.html`,
    `Frontend/html/photo-analyzing.html`(`env.js` 스크립트 태그 추가)
  - `Frontend/css/pages.css`(페이지네이션 스타일), `Frontend/sw.js`(주석/캐시 목록 정리)
  - `render.yaml`, `.env.example`, `scripts/generate-env.js`(`BACKEND_API_BASE_URL` 추가)
  - `.gitignore`
- **삭제**: `Backend/incidents_db.py`, `Backend/assets/incidents.db`(빌드 산출물)

### Render 대시보드에서 당신이 할 일

- [ ] **Static Site** 새로 생성 — Build Command `node scripts/generate-env.js`,
      Publish Directory `Frontend` (또는 `render.yaml` 커밋 후 Blueprint로 생성)
- [ ] Static Site Environment 탭에 `HF_DATASET_ID`(아래 HF 작업 완료 후),
      `BACKEND_API_BASE_URL`(Backend Web Service 실제 URL) 등록
- [ ] **Web Service**(Backend) 새로 생성 또는 기존 서비스 설정 갱신 — Root
      Directory `Backend`, Build Command `pip install -r requirements.txt`,
      Start Command `uvicorn app:app --host 0.0.0.0 --port $PORT`,
      Health Check Path `/health`
- [ ] Web Service Environment 탭에 `OPENAI_API_KEY`/`GEMINI_API_KEY`/`HF_TOKEN`
      (기존 값 그대로 유지) + `ALLOWED_ORIGINS`(신규, 프런트 Static Site URL) 등록
- [ ] 배포 후 인스턴스 메모리 사용량 그래프에서 idle/요청 처리 중 피크가
      512MB 아래인지 실제로 확인 (README 6번의 로컬 실측치와 비교)
- [ ] 이번에 제거된 3개 엔드포인트(`/api/cases*`, `/api/incidents`)를 실제로
      호출하는 곳이 없는지 재배포 후 로그로 확인 권장

### Hugging Face에서 당신이 할 일

- [ ] `cd Backend && python prepare_hf_dataset.py` 실행
- [ ] `huggingface-cli login` 후 데이터셋 repo 생성 + `incidents.csv` 업로드
      (반드시 **Public**)
- [ ] Data Studio 탭에서 행이 정상적으로 보이는지 확인
- [ ] `HF_DATASET_ID`를 Render Static Site 환경변수에 등록하고 재배포
