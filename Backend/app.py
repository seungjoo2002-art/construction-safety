"""
app.py — FastAPI 서버: 위험도(severity) + 사고유형(accident_type) 예측 API
==========================================================================
같은 폴더 안에 다음이 전부 있어야 합니다.
  config.py, risk_service.py
  risk_model/  (건설사고예측 배포패키지 31피처 — predict.py, models/ 13개, artifacts/)

실행 방법:
  ⚠️ requirements.txt는 Python 3.12 기준입니다. 컴퓨터에 여러 Python 버전이 설치되어
     있다면(`py -0`으로 확인) 반드시 3.12를 지정해서 설치/실행하세요. 예:
       py -3.12 -m pip install -r requirements.txt
       py -3.12 -m uvicorn app:app --reload --host 0.0.0.0 --port 8000
     (또는 이 폴더의 run_server.bat을 더블클릭 — 3.12로 자동 실행됩니다.)

  1) py -3.12 -m pip install -r requirements.txt
  2) py -3.12 -m uvicorn app:app --reload --host 0.0.0.0 --port 8000
     (버전 지정 없이 그냥 python/uvicorn을 쓰면 다른 버전이 잡혀 모듈이 없다고 뜰 수 있습니다)

  실행되면 터미널에 "Uvicorn running on http://0.0.0.0:8000" 뜹니다.
  프론트 팀원한테 알려줘야 할 주소는 http://127.0.0.1:8000 (같은 컴퓨터에서 테스트) 또는
  같은 와이파이의 다른 기기에서 접속하려면 이 컴퓨터의 로컬 IP(예: 192.168.0.x)로 알려주면 됩니다.

  ※ 유사도 분석(/api/analyze)은 환경변수 OPENAI_API_KEY가 있으면 텍스트 임베딩 기반
     정밀 유사도를, 없으면 카테고리 완전/부분일치 기반 근사 유사도를 자동으로 씁니다.
     둘 다 실제 사고 사례 DB(assets/df_db.csv)를 사용합니다 — 키가 없어도 목업이 아닙니다.
     (자산 파일 자체가 없거나 손상된 경우에만 503을 반환하고 프론트가 목업으로 대체합니다.)

동작 확인:
  브라우저에서 http://127.0.0.1:8000/docs 접속 → FastAPI 자동 생성 테스트 화면에서
  /api/predict을 직접 눌러 테스트해볼 수 있습니다.
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any, Dict, List, Optional
import base64
import binascii
import hashlib
import io
import os
import re
import sys
import threading
import requests
from PIL import Image, ImageOps, UnidentifiedImageError

# ── Windows 콘솔(cp949 등 non-UTF-8 코드페이지)에서 이모지가 섞인 print()가
#    UnicodeEncodeError로 서버 전체를 죽이는 걸 방지 (uvicorn 실행 시 흔히 발생).
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

from risk_service import RiskService
from similarity_service import SimilarityWebService
from download_assets import ensure_large_assets
from user_api import router as user_router, get_store as get_user_store

from pathlib import Path

app = FastAPI(title="AI 건설현장 안전관리 - 예측 API")
# ── FastAPI 문서(/docs, /redoc, /openapi.json)는 기본값 그대로 켜져 있습니다.
#    docs_url/redoc_url을 None으로 끈 적이 없으므로 별도 보안상 이유로 막아둔 게
#    아닙니다 — 위 uvicorn Start Command로 이 앱이 실제로 떠 있기만 하면 항상 열려있습니다.


@app.get("/")
def root():
    """루트 경로. 배포가 정상인지 브라우저로 빠르게 확인하는 용도."""
    return {"service": "AI 건설현장 안전관리 - 예측 API", "docs": "/docs", "health": "/health"}


# ── CORS: 프론트(Render Static Site)가 다른 도메인에서 호출하므로 이 설정이 없으면
#    브라우저가 요청을 막습니다 (개발자도구 콘솔에 CORS 에러로 뜸).
#    ALLOWED_ORIGINS 환경변수(쉼표로 구분, 예: "https://ai-safety-frontend.onrender.com")를
#    등록하면 그 도메인만 허용합니다. 비워두면(로컬 개발 등) 전체 허용("*")으로 동작하므로,
#    운영 배포에서는 반드시 설정하세요 — 값 자체는 공개 정보(프런트 URL)라 비밀값이 아닙니다.
_allowed_origins_raw = os.environ.get("ALLOWED_ORIGINS", "").strip()
# 끝에 "/"를 붙여 등록하는 실수(예: "https://foo.onrender.com/")를 하면 브라우저가 보내는
# Origin 헤더("https://foo.onrender.com", 절대 끝에 "/" 없음)와 문자열이 정확히 일치하지
# 않아 CORS가 조용히 막힌다(프리플라이트는 200이 나오지만 실제 요청은 브라우저가 차단).
# 그래서 여기서 미리 trailing slash를 제거해둔다.
ALLOWED_ORIGINS = [o.strip().rstrip("/") for o in _allowed_origins_raw.split(",") if o.strip()] or ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 계정/사용자별 데이터 API (/api/auth/*, /api/me/*) — user_api.py, user_store.py
#    현재 사용자는 Authorization: Bearer 토큰으로만 식별하고, 모든 조회/수정/삭제는
#    DB 단계에서 user_id 조건으로 제한된다(프런트 필터링에 의존하지 않음).
app.include_router(user_router)
get_user_store()  # 기동 시 스키마 생성 + 어떤 DB를 쓰는지 로그로 남김

# ── 모델은 서버가 켜질 때 딱 1번만 로드합니다 (요청마다 새로 로드하면 매우 느려짐)
risk_service = RiskService()   # 위험도(심각도 3분류) + 사고유형(5분류) — risk_model/ 패키지

# ── 유사도 서비스 (similarity_service.py)
#    OPENAI_API_KEY가 있으면 텍스트 임베딩 기반 정밀 유사도를 쓰고,
#    없으면 카테고리 완전/부분일치 기반 근사 유사도로 자동 대체합니다(둘 다 실제 DB 사용).
#    자산 파일(df_db.csv 등) 로드 자체가 실패하는 경우에만 서비스가 비활성화되고,
#    /api/analyze는 그때만 503을 반환합니다.
#    서버 시작 시점이 아니라 /api/analyze 요청이 처음 들어왔을 때 지연 초기화합니다
#    (초기화 실패/메모리 문제가 위험도 예측·사고유형 예측 엔드포인트에 영향을 주지 않도록).
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
sim_service: Optional[SimilarityWebService] = None


def get_sim_service() -> Optional[SimilarityWebService]:
    """sim_service를 처음 필요할 때 초기화해서 재사용(lazy loading).
    db_v_con/fac/wrk.npy(HF 호스팅, 총 411MB)도 이 시점에 딱 1번만 내려받는다 —
    서버 시작 시점(빌드/기동)에는 절대 다운로드하지 않는다."""
    global sim_service
    if sim_service is None:
        try:
            ensure_large_assets()
            sim_service = SimilarityWebService(openai_api_key=OPENAI_API_KEY or None)
            if OPENAI_API_KEY:
                print("[app.py] 유사도 서비스 초기화 완료 (OpenAI 임베딩 모드)")
            else:
                print("[app.py] ⚠️ OPENAI_API_KEY가 없어 유사도 서비스가 근사(키워드 매칭) 모드로 동작합니다.")
        except Exception as e:
            print(f"[app.py] ⚠️ 유사도 서비스 초기화 실패: {e}")
    return sim_service

# ── 사진 분석 서비스 (safety_yolo_pkg/hazard.py — YOLO 객체탐지 + 룰 기반 위험 판정)
#    ⚠️ Render 무료 Web Service(512MB) 대응 — Hazard()는 ultralytics/torch를 로드하는데
#    실측 결과 그것만으로 +238MB가 듭니다. 위험도·사고유형 모델(측정 당시 구 모형 +222MB)과 similarity_service
#    import(+48MB, matplotlib 등)까지 서버 기동 시점에 전부 합쳐지면 요청 1건도 받기 전에
#    이미 500MB 근처(측정: 약 508MB)라 컨테이너가 기동 자체에 실패(OOM)할 수 있습니다.
#    그래서 sim_service와 동일한 지연 초기화 패턴으로 바꿨습니다 — /api/analyze-photo가
#    처음 호출된 순간에만 로드하고, 그전까지는 서버 기동/health check/다른 엔드포인트에
#    전혀 영향을 주지 않습니다. 로드 실패해도 서버 전체가 죽지 않도록 감싸고, 실패 시
#    /api/analyze-photo가 503을 반환합니다(프론트 api.js는 그때 자동으로 목업으로 대체).
sys.path.insert(0, str(Path(__file__).parent / "safety_yolo_pkg"))
hazard_service = None
_hazard_ref_cids: Dict[str, set] = {}
_hazard_engine: Dict[str, Any] = {}  # 운영 서버가 실제로 어떤 가중치/룰 파일을 쓰는지 응답·로그로 확인하기 위한 지문


def _sha12(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:12]


def get_hazard_service():
    """hazard_service를 처음 필요할 때 초기화해서 재사용(lazy loading)."""
    global hazard_service
    if hazard_service is None:
        try:
            from hazard import Hazard

            hazard_service = Hazard()
            from hazard import MODEL_DIR as _hz_dir
            _hazard_engine.update({
                "weights": "best.pt",
                "weights_sha256": _sha12(_hz_dir / "best.pt"),
                "rules_sha256": _sha12(_hz_dir / "rules.json"),
                "imgsz": hazard_service.imgsz,
                "conf": hazard_service.conf,
                "classes": len(hazard_service.names),
            })
            print(f"[app.py] 사진 분석(YOLO) 서비스 초기화 완료 {_hazard_engine}")

            # rules.json의 각 위험 판정(ref)이 "어떤 탐지 객체(cid) 때문에" 걸렸는지
            # 역으로 찾기 위한 맵. combo_rules는 need 쪽만(=실제로 탐지된 원인) 표시하고,
            # absent 쪽은 애초에 안 찍히므로 제외.
            for _r in hazard_service.danger:
                _hazard_ref_cids[_r["ref"]] = {_r["cid"]}
            for _r in hazard_service.combo:
                _hazard_ref_cids[_r["ref"]] = set(_r["need"])
            for _r in hazard_service.cooccur:
                _hazard_ref_cids[_r["ref"]] = set(_r["a"]) | set(_r["b"])
        except Exception as e:
            print(f"[app.py] ⚠️ 사진 분석(YOLO) 서비스 초기화 실패: {e}")
    return hazard_service


class PredictIn(BaseModel):
    data: Dict[str, Any]  # 프론트 payload (현장설정 + 오늘 입력 + 날씨 + 발생일시) — risk_service.to_model_input이 31피처로 변환


@app.post("/api/predict")
def predict(body: PredictIn):
    """프론트의 predict-input.html에서 조립한 payload를 그대로 받아 두 모델 결과를 함께 반환."""
    r = risk_service.predict_one(body.data)
    return {"severity": r["severity"], "accident_type": r["accident_type"]}


class PredictHourlyIn(BaseModel):
    data: Dict[str, Any]  # /api/predict 와 동일한 필드 (발생일시/사고일시_x는 여기서 시간별로 덮어씀)
    date: str             # 분석 당일 KST 날짜 "YYYY-MM-DD" (프론트가 Asia/Seoul 기준으로 생성)
    start_hour: int       # 작업 시작 시각 (0~23, 정시)
    end_hour: int         # 작업 종료 시각 (start_hour 이상, 당일 23시까지 — 포함)


@app.post("/api/predict-hourly")
def predict_hourly(body: PredictHourlyIn):
    """작업 시작~종료 시각을 1시간 간격으로 배치 예측 → p_fatal 최대 시각을 대표로 선정.
    현장·기상·연령 조건은 모든 시각에 동일하고, 시각에 따라 사고_시간과 근무형태
    (정규 근무시간 밖이면 연장근무, 주말·공휴일이면 휴일근무)가 바뀐다.
    동점(p_fatal 소수 4자리 기준 동일)이면 가장 이른 시각을 대표로 쓴다.
    화면에는 p_fatal이 아니라 percentile/grade를 보여준다(확률이 실제 발생률과 어긋나 있음)."""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", body.date or ""):
        raise HTTPException(status_code=400, detail="date는 YYYY-MM-DD 형식이어야 합니다")
    if not (0 <= body.start_hour <= 23 and 0 <= body.end_hour <= 23):
        raise HTTPException(status_code=400, detail="작업 시각은 0~23시 범위여야 합니다")
    if body.end_hour < body.start_hour:
        raise HTTPException(status_code=400, detail="작업 종료 시각이 시작 시각보다 이를 수 없습니다")

    hours = list(range(body.start_hour, body.end_hour + 1))
    rows = []
    for h in hours:
        dt = f"{body.date} {h:02d}:00"
        rows.append({**body.data, "발생일시": dt, "사고일시_x": dt})

    results = risk_service.predict(rows)  # 시각 수만큼 배치 1회 (심각도 + 사고유형)

    points = [
        {
            "hour": h,
            "datetime": rows[i]["발생일시"],
            "model_input_hour": r["model_input"].get("사고_시간"),  # 실제 모델에 들어간 값 — 검증/로그용
            "shift_type": r["model_input"].get("근무형태"),
            "p_fatal": r["severity"]["fatal_risk"]["p_fatal"],
            "percentile": r["severity"]["fatal_risk"]["percentile"],
            "grade": r["severity"]["fatal_risk"]["grade"],
        }
        for i, (h, r) in enumerate(zip(hours, results))
    ]
    # max()는 동점일 때 처음 나온(=가장 이른) 원소를 돌려준다
    peak = max(range(len(points)), key=lambda i: points[i]["p_fatal"])

    accident_type = results[peak]["accident_type"]
    print(f"[app.py] /api/predict-hourly date={body.date} {body.start_hour:02d}~{body.end_hour:02d}시 "
          f"사고_시간={[p['model_input_hour'] for p in points]} 근무형태={[p['shift_type'] for p in points]} "
          f"peak={points[peak]['hour']:02d}시 p_fatal={points[peak]['p_fatal']} "
          f"백분위={points[peak]['percentile']} 유형={accident_type['predicted_type']}")
    return {
        "severity": results[peak]["severity"],
        "accident_type": accident_type,
        "hourly": {
            "date": body.date,
            "start_hour": body.start_hour,
            "end_hour": body.end_hour,
            "peak_hour": points[peak]["hour"],
            "peak_datetime": points[peak]["datetime"],
            "tie_rule": "earliest",
            "points": points,
        },
    }


# ── 해결방안 서비스 (advisor.py — KOSHA 유사사례 검색 + Gemini 안전수칙 생성)
#    로컬 TF-IDF(가벼움)만 쓰므로 sim_service/hazard_service처럼 메모리 걱정은
#    없지만, 패턴을 통일하기 위해 동일하게 지연 초기화합니다.
advisor_service: Optional["SafetyAdvisor"] = None


def get_advisor_service() -> Optional["SafetyAdvisor"]:
    global advisor_service
    if advisor_service is None:
        try:
            from advisor import SafetyAdvisor

            gemini_api_key = os.environ.get("GEMINI_API_KEY", "")
            advisor_service = SafetyAdvisor(gemini_api_key=gemini_api_key)
            backend = advisor_service.llm_backend
            warn = " ⚠️ GEMINI_API_KEY도 없어 예방 조치 생성이 전부 실패합니다" if backend == "gemini" and not gemini_api_key else ""
            print(f"[app.py] 해결방안 서비스(advisor.py) 초기화 완료 — ADVISOR_LLM={backend}{warn}")
        except Exception as e:
            print(f"[app.py] ⚠️ 해결방안 서비스 초기화 실패: {e}")
    return advisor_service


@app.on_event("startup")
def _warm_up_advisor():
    """ADVISOR_LLM=exaone이면 서버가 뜰 때 백그라운드에서 모델을 미리 올린다
    (첫 요청이 모델 로딩 ~20초까지 떠안지 않도록). Gemini면 아무것도 하지 않는다."""
    if os.environ.get("ADVISOR_LLM", "").strip().lower() != "exaone":
        return

    def _load():
        svc = get_advisor_service()
        if svc is not None:
            try:
                svc.load_exaone()
            except Exception as e:
                print(f"[app.py] ⚠️ EXAONE 사전 로딩 실패 (요청 시 Gemini 폴백): {e}")

    threading.Thread(target=_load, daemon=True).start()


class AdviseIn(BaseModel):
    data: Dict[str, Any]        # /api/predict 와 동일한 payload
    상황: Optional[str] = None  # 자유 서술 (없으면 예측 결과로 자동 생성)


@app.post("/api/advise")
def advise(body: AdviseIn):
    """예측(위험도·사고유형) → KOSHA 유사사례 검색 → Gemini 안전수칙 생성을 한 번에 반환.
    예측 모형은 /api/predict와 동일한 risk_service를 재사용한다(모형을 중복 로드하지 않음)."""
    service = get_advisor_service()
    if service is None:
        raise HTTPException(status_code=503, detail="해결방안 서비스를 초기화하지 못했습니다 (kosha_sif 자산 확인 필요)")

    pred = risk_service.predict_one(body.data)
    severity, accident_type = pred["severity"], pred["accident_type"]
    risk = {
        "injury_top": accident_type["predicted_type"],
        "relative_risk_percentile": severity["fatal_risk"]["percentile"],
    }
    result = service.advise(
        risk,
        body.data.get("공종 - 중분류", ""),
        body.data.get("추출된_작업종류", ""),
        상황=body.상황,
    )
    result["risk"] = {"severity": severity, "accident_type": accident_type}
    llm = result.get("llm") or {}
    print(f"[app.py] /api/advise 공종={body.data.get('공종 - 중분류', '')!r} 작업={body.data.get('추출된_작업종류', '')!r} "
          f"유형={risk['injury_top']} items={len(result.get('items', []))} "
          f"stage={result['retrieval']['filter_stage']} llm={llm.get('used')} err={llm.get('error')}")
    return result


@app.get("/api/distributions")
def distributions():
    """상대 위험도 기준분포 요약·등급 구간·등급별 실제 치명률 — 나중에 통계/차트 화면에서 쓸 수 있음."""
    return risk_service.summary()


# ============================================================
# 사고 사례 DB 조회(구 /api/cases, /api/cases/{id}, /api/incidents)는 제거되었습니다.
# 프런트(similar-cases.html, case-detail.html)는 이제 Hugging Face Dataset Viewer API를
# 브라우저에서 직접 호출합니다 — 이 백엔드가 df_db.csv를 SQLite로 변환해 서빙할 필요가
# 없어졌습니다(구 incidents_db.py, assets/incidents.db 삭제됨). 자세한 내용은 프로젝트
# 루트 README.md와 Backend/prepare_hf_dataset.py를 참고하세요.
# 단, similarity_service.py(아래 /api/analyze)는 df_db.csv를 계속 독립적으로 사용합니다
# (임베딩 기반 유사도 계산 자체가 서버 연산이라 이 마이그레이션 대상이 아님).
# ============================================================


# ============================================================
# 유사도 분석 (similarity_service.py 연동)
# ============================================================
# similarity_service.py는 공정률/작업자수를 "숫자"로 받는데(progress=50.0 등),
# 우리 프론트는 "50~59%", "100~299인" 같은 구간 문자열을 보냅니다.
# 구간의 중간값으로 근사 변환해서 넘겨줍니다.
PROGRESS_BUCKET_TO_PCT = {
    "10% 미만": 5, "10~19%": 15, "20~29%": 25, "30~39%": 35, "40~49%": 45,
    "50~59%": 55, "60~69%": 65, "70~79%": 75, "80~89%": 85, "90% 이상": 95,
}
WORKER_BUCKET_TO_COUNT = {
    "19인 이하": 15, "20~49인": 35, "50~99인": 75,
    "100~299인": 200, "300~499인": 400, "500인 이상": 550,
}


def build_similarity_input(payload: Dict[str, Any]) -> Dict[str, Any]:
    """프론트 payload(/api/predict와 동일) → similarity_service.analyze()가 원하는 형태로 변환."""
    return {
        "facility_text": payload.get("시설물 종류 - 중분류") or payload.get("시설물 종류 - 대분류", ""),
        "construction_text": payload.get("공종 - 중분류", ""),
        "work_text": payload.get("추출된_작업종류", ""),
        "humidity": payload.get("기상상태 - 습도", 50.0),
        "temp": payload.get("평균기온(°C)", 20.0),
        "rain": payload.get("일강수량(mm)", 0.0),
        "wind": payload.get("평균 풍속(m/s)", 2.0),
        "progress": PROGRESS_BUCKET_TO_PCT.get(payload.get("공정률"), 50.0),
        "worker_count": WORKER_BUCKET_TO_COUNT.get(payload.get("작업자수"), 30.0),
    }


class SimilarityIn(BaseModel):
    data: Dict[str, Any]


@app.post("/api/analyze")
def similarity(body: SimilarityIn):
    """
    유사 사고사례 + MDS 2D 산점도 + 재발방지대책을 함께 반환.
    프론트는 predict-input.html에서 조립한 것과 동일한 payload를 그대로 보내면 됩니다.
    """
    service = get_sim_service()
    if service is None:
        raise HTTPException(
            status_code=503,
            detail="유사도 서비스를 초기화하지 못했습니다",
        )
    sim_input = build_similarity_input(body.data)
    try:
        return service.analyze(sim_input)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"유사도 분석 중 오류: {e}")


@app.get("/health")
def health():
    """서버가 살아있는지 확인용 (Render Health Check Path로 사용).
    Render/모니터링 도구가 정확히 이 형태를 기대할 수 있어 {"status": "ok"}만
    반환합니다 — sim_service/hazard_service 초기화 여부 같은 추가 진단 정보는
    필요하면 별도 엔드포인트로 분리하고, 여기서는 무겁게 만들지 않습니다."""
    return {"status": "ok"}


# ============================================================
# 사진 분석 (safety_yolo_pkg/hazard.py 연동 — YOLO 객체탐지 + 룰 기반 위험 판정)
# ============================================================
# safety_yolo_pkg는 { verdict, risks[], objects[], image_size, elapsed_ms } 형태로 응답하는데,
# 프론트(photo-result.js)는 이미 { score, grade, grade_label, boxes[], hazards[] } 형태를 기대하고
# 있으므로(원래 목업 형태), 여기서 서버 쪽에서 변환해 프론트 코드는 건드리지 않습니다.
_PHOTO_GRADE_BY_VERDICT = {
    "위험": ("HIGH", "즉각 조치 필요"),
    "주의": ("MEDIUM", "주의 관찰 필요"),
    "정상": ("LOW", "안전 상태 양호"),
}
_PHOTO_ICON_BY_LEVEL = {"위험": "🚨", "주의": "⚠️"}


def _photo_score(verdict: str, risks: List[Dict[str, Any]]) -> int:
    """모델은 숫자 점수를 안 주고 verdict/risks만 주므로, 프론트의 0~100 점수 UI에 맞춰 근사 환산."""
    danger_count = sum(1 for r in risks if r.get("level") == "위험")
    caution_count = sum(1 for r in risks if r.get("level") == "주의")
    if verdict == "위험":
        return min(97, 70 + danger_count * 6 + caution_count * 2)
    if verdict == "주의":
        return min(69, 40 + caution_count * 6)
    return 8


def _photo_transform(raw: Dict[str, Any]) -> Dict[str, Any]:
    verdict = raw["verdict"]
    risks = raw["risks"]
    objects = raw["objects"]
    img_w, img_h = raw["image_size"]

    # 탐지 객체가 0개면 "안전"이 아니라 "판정 불가"다 — 위험요소 없음(정상) 판정과 구분한다.
    if not objects:
        status, grade, grade_label = "no_objects", "UNKNOWN", "탐지된 객체 없음 — 위험 여부 판정 불가"
    elif not risks:
        status, grade, grade_label = "no_hazard", "LOW", "룰 기준 위험요소 없음"
    else:
        status = "hazard"
        grade, grade_label = _PHOTO_GRADE_BY_VERDICT.get(verdict, ("MEDIUM", "주의 관찰 필요"))

    # 이번 판정에 실제로 관여한 cid만 모아서, 박스 색을 danger/safe로 구분
    highlight_cids: set = set()
    for r in risks:
        highlight_cids |= _hazard_ref_cids.get(r.get("ref"), set())

    boxes = []
    for o in objects:
        x1, y1, x2, y2 = o["box"]
        label = o["name"].split("_", 1)[1] if "_" in o["name"] else o["name"]
        boxes.append({
            "label": label,
            "pct": round(o["conf"] * 100),
            "top": round(y1 / img_h * 100, 1) if img_h else 0,
            "left": round(x1 / img_w * 100, 1) if img_w else 0,
            "width": round((x2 - x1) / img_w * 100, 1) if img_w else 0,
            "height": round((y2 - y1) / img_h * 100, 1) if img_h else 0,
            "color": "danger" if o["cid"] in highlight_cids else "safe",
        })

    hazards = [
        {
            "icon": _PHOTO_ICON_BY_LEVEL.get(r.get("level"), "⚠️"),
            "title": r["message"],
            "severity": r["level"],
            "desc": f"근거 코드 {r['ref']}",
        }
        for r in risks
    ]

    return {
        "status": status,
        "score": _photo_score(verdict, risks) if objects else None,
        "grade": grade,
        "grade_label": grade_label,
        "boxes": boxes,
        "hazards": hazards,
    }


class PhotoAnalyzeIn(BaseModel):
    image: str  # "data:image/jpeg;base64,...." 형태의 dataURL (프론트 canvas.toDataURL / FileReader 결과)


@app.post("/api/analyze-photo")
def analyze_photo(body: PhotoAnalyzeIn):
    """현장 사진 한 장 → YOLO 탐지 + 룰 기반 위험 판정. 프론트가 기대하는 형태로 변환해서 반환."""
    service = get_hazard_service()
    if service is None:
        raise HTTPException(
            status_code=503,
            detail="사진 분석 서비스가 초기화되지 않았어요. 서버에 ultralytics/torch가 설치되어 있는지 확인해주세요.",
        )

    # 1) 이미지 해석 — 여기서 실패하면 서버 오류(500)가 아니라 잘못된 입력(400)으로 명확히 돌려준다
    try:
        b64 = body.image.split(",", 1)[1] if "," in body.image else body.image
        raw_bytes = base64.b64decode(b64, validate=False)
        img = Image.open(io.BytesIO(raw_bytes))
        img = ImageOps.exif_transpose(img)  # 폰 사진은 EXIF로 회전돼 있는 경우가 많음
        img = img.convert("RGB")
    except (binascii.Error, UnidentifiedImageError, OSError, ValueError) as e:
        print(f"[app.py] /api/analyze-photo 400 — 이미지 해석 실패 ({len(body.image)}자): {e}")
        raise HTTPException(status_code=400, detail="이미지를 해석할 수 없어요. JPG 또는 PNG 사진을 보내주세요.")

    # 2) YOLO 탐지 + 룰 판정
    try:
        raw = service.analyze(img)
    except Exception as e:
        print(f"[app.py] /api/analyze-photo 500 — 추론 실패: {e}")
        raise HTTPException(status_code=500, detail=f"사진 분석 중 오류: {e}")

    out = _photo_transform(raw)
    # 탐지 객체 → 적용 룰 → 최종 판정이 서로 맞는지 운영 로그로 검증할 수 있게 한 줄로 남긴다
    # 단계별 추적: RAW(conf>=raw_conf) → threshold 필터 → 룰 → 응답. 어느 단계에서 객체가 빠지는지 로그로 구분한다.
    print(f"[app.py] /api/analyze-photo {img.size[0]}x{img.size[1]} {raw['elapsed_ms']}ms "
          f"raw={len(raw['objects']) + len(raw['below_threshold'])} "
          f"below_conf{raw['conf']}={[(o['name'], o['conf']) for o in raw['below_threshold']]} "
          f"kept={[(o['name'], o['conf']) for o in raw['objects']]} "
          f"rules={[r['ref'] for r in raw['risks']]} verdict={raw['verdict']} status={out['status']} score={out['score']}")
    out["verdict"] = raw["verdict"]
    out["detections"] = [{"cid": o["cid"], "name": o["name"], "conf": o["conf"], "box": o["box"]} for o in raw["objects"]]
    # threshold 미만 후보 — 판정(룰)에는 쓰지 않고 진단용으로만 내려준다
    out["below_threshold"] = [{"name": o["name"], "conf": o["conf"], "box": o["box"]} for o in raw["below_threshold"]]
    out["applied_rules"] = [{"ref": r["ref"], "level": r["level"], "message": r["message"]} for r in raw["risks"]]
    out["engine"] = dict(_hazard_engine, elapsed_ms=raw["elapsed_ms"], image_size=raw["image_size"])
    return out
