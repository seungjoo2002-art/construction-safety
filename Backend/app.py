"""
app.py — FastAPI 서버: 위험도(severity) + 사고유형(accident_type) 예측 API
==========================================================================
같은 폴더 안에 다음이 전부 있어야 합니다.
  config.py
  preprocessing.py
  predict_severity.py
  predict_accident_type.py
  artifacts/  (아래 10개 파일)
    severity_model_rus4.joblib, fatal_distribution.json,
    fatal_dist_reference.npy, fatal_dist_reference.csv, test_metrics_rus4.json,
    accident_type_stacking.joblib, type_distribution.json,
    type_dist_reference.npy, type_dist_reference.csv, test_metrics_type.json

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
import io
import os
import sys
import requests
from PIL import Image, ImageOps

# ── Windows 콘솔(cp949 등 non-UTF-8 코드페이지)에서 이모지가 섞인 print()가
#    UnicodeEncodeError로 서버 전체를 죽이는 걸 방지 (uvicorn 실행 시 흔히 발생).
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

from predict_severity import SeverityPredictor
from predict_accident_type import AccidentTypePredictor
from similarity_service import SimilarityWebService
from download_assets import ensure_large_assets
import incidents_db

from pathlib import Path

app = FastAPI(title="AI 건설현장 안전관리 - 예측 API")

# ── CORS: 프론트가 다른 포트(예: Live Server의 127.0.0.1:5500)에서 호출하므로
#    이 설정이 없으면 브라우저가 요청을 막습니다 (개발자도구 콘솔에 CORS 에러로 뜸).
#    지금은 전체 허용(*)이고, 실제 배포 시에는 프론트 도메인 하나로 좁히는 걸 권장합니다.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 모델은 서버가 켜질 때 딱 1번만 로드합니다 (요청마다 새로 로드하면 매우 느려짐)
severity_predictor = SeverityPredictor()
accident_type_predictor = AccidentTypePredictor()

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
#    ultralytics/torch가 설치되어 있지 않거나 모델 로드에 실패해도 서버 전체가
#    죽지 않도록 감싸고, 실패 시 /api/analyze-photo가 503을 반환합니다
#    (프론트 api.js는 그때 자동으로 목업 데이터로 대체합니다).
sys.path.insert(0, str(Path(__file__).parent / "safety_yolo_pkg"))
hazard_service = None
try:
    from hazard import Hazard

    hazard_service = Hazard()
    print(f"[app.py] 사진 분석(YOLO) 서비스 초기화 완료 (클래스 {len(hazard_service.names)}개)")
except Exception as e:
    print(f"[app.py] ⚠️ 사진 분석(YOLO) 서비스 초기화 실패: {e}")

# rules.json의 각 위험 판정(ref)이 "어떤 탐지 객체(cid) 때문에" 걸렸는지 역으로 찾기 위한 맵.
# combo_rules는 need 쪽만(=실제로 탐지된 원인) 표시하고, absent 쪽은 애초에 안 찍히므로 제외.
_hazard_ref_cids: Dict[str, set] = {}
if hazard_service is not None:
    for _r in hazard_service.danger:
        _hazard_ref_cids[_r["ref"]] = {_r["cid"]}
    for _r in hazard_service.combo:
        _hazard_ref_cids[_r["ref"]] = set(_r["need"])
    for _r in hazard_service.cooccur:
        _hazard_ref_cids[_r["ref"]] = set(_r["a"]) | set(_r["b"])


class PredictIn(BaseModel):
    data: Dict[str, Any]  # 프론트가 보내는 31개 필드 (config.RAW_INPUT_COLS)


@app.post("/api/predict")
def predict(body: PredictIn):
    """프론트의 predict-input.html에서 조립한 payload를 그대로 받아 두 모델 결과를 함께 반환."""
    return {
        "severity": severity_predictor.predict_one(body.data),
        "accident_type": accident_type_predictor.predict_one(body.data),
    }


@app.get("/api/distributions")
def distributions():
    """참조분포 요약 — 나중에 통계/차트 화면에서 쓸 수 있음."""
    return {
        "severity": severity_predictor.distribution_summary(),
        "accident_type": accident_type_predictor.distribution_summary(),
    }


# ============================================================
# 사고 사례 DB 조회 (incidents_db.py — assets/df_db.csv를 SQLite로 사전 처리해 조회)
# ============================================================
# 이 기능은 OpenAI 임베딩이 필요 없는 단순 조회/검색이라 OPENAI_API_KEY 유무와 무관하게
# 항상 동작합니다. SQLite DB는 서버 시작 시점이 아니라 이 아래 엔드포인트가 처음
# 호출된 순간에 1번만 빌드되고(incidents_db.ensure_db), 이후에는 페이지네이션된
# 쿼리 결과만 응답합니다 — df_db.csv 전체를 메모리에 계속 들고 있지 않습니다.

MAX_PAGE_LIMIT = 50


@app.get("/api/cases")
def list_cases(q: str = "", hazard: str = "전체", limit: int = 20, offset: int = 0):
    """검색어/사고유형으로 사고 사례 DB를 조회. 프론트의 사례 검색 탭이 사용."""
    try:
        total, cases = incidents_db.query_cases(q=q, hazard=hazard, limit=limit, offset=offset)
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=f"사고 사례 DB를 불러오지 못했어요: {e}")
    return {"total": total, "cases": cases}


@app.get("/api/cases/{case_id}")
def get_case(case_id: int):
    """사고 사례 상세 조회. case_id는 /api/cases가 내려준 id 그대로."""
    try:
        result = incidents_db.get_case(case_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=f"사고 사례 DB를 불러오지 못했어요: {e}")
    if result is None:
        raise HTTPException(status_code=404, detail="사례를 찾을 수 없어요.")
    return result


@app.get("/api/incidents")
def list_incidents(
    region: Optional[str] = None,
    industry: Optional[str] = None,
    year: Optional[int] = None,
    page: int = 1,
    limit: int = 20,
):
    """region/industry/year 조건 + page 페이지네이션으로 사고 사례 DB를 조회.
    region/industry는 영문 슬러그(예: seoul, building)만 받는다 — incidents_db.REGION_SLUGS,
    incidents_db.INDUSTRY_SLUGS 참고."""
    if page < 1:
        raise HTTPException(status_code=400, detail="page는 1 이상이어야 해요.")
    if limit < 1:
        raise HTTPException(status_code=400, detail="limit은 1 이상이어야 해요.")
    limit = min(limit, MAX_PAGE_LIMIT)

    region_kr = None
    if region:
        region_kr = incidents_db.SLUG_TO_REGION.get(region.lower())
        if region_kr is None:
            valid = ", ".join(sorted(incidents_db.SLUG_TO_REGION))
            raise HTTPException(status_code=400, detail=f"알 수 없는 region이에요. 사용 가능한 값: {valid}")

    industry_kr = None
    if industry:
        industry_kr = incidents_db.SLUG_TO_INDUSTRY.get(industry.lower())
        if industry_kr is None:
            valid = ", ".join(sorted(incidents_db.SLUG_TO_INDUSTRY))
            raise HTTPException(status_code=400, detail=f"알 수 없는 industry예요. 사용 가능한 값: {valid}")

    if year is not None and not (2000 <= year <= 2100):
        raise HTTPException(status_code=400, detail="year 값이 올바르지 않아요 (2000~2100).")

    try:
        total, items = incidents_db.query_incidents(
            region=region_kr, industry=industry_kr, year=year, page=page, limit=limit
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=f"사고 사례 DB를 불러오지 못했어요: {e}")

    return {
        "items": items,
        "page": page,
        "limit": limit,
        "total": total,
        "hasNextPage": page * limit < total,
    }


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
    """프론트가 보내는 RAW_INPUT_COLS 형태 payload → similarity_service.analyze()가 원하는 형태로 변환."""
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
    """서버가 살아있는지 + 모델이 정상 로드됐는지 확인용."""
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

    grade, grade_label = _PHOTO_GRADE_BY_VERDICT.get(verdict, ("LOW", "안전 상태 양호"))

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
        "score": _photo_score(verdict, risks),
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
    if hazard_service is None:
        raise HTTPException(
            status_code=503,
            detail="사진 분석 서비스가 초기화되지 않았어요. 서버에 ultralytics/torch가 설치되어 있는지 확인해주세요.",
        )
    try:
        b64 = body.image.split(",", 1)[1] if "," in body.image else body.image
        img = Image.open(io.BytesIO(base64.b64decode(b64)))
        img = ImageOps.exif_transpose(img)  # 폰 사진은 EXIF로 회전돼 있는 경우가 많음
        raw = hazard_service.analyze(img.convert("RGB"))
        return _photo_transform(raw)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"사진 분석 중 오류: {e}")


# ============================================================
# 챗봇 (Google Gemini API 연동)
# ============================================================
# 키는 환경변수로만 관리합니다. 코드에 직접 쓰지 마세요.
#   Mac/Linux: export GEMINI_API_KEY="발급받은키"
#   Windows(PowerShell): $env:GEMINI_API_KEY="발급받은키"
# 매번 치기 귀찮으면 .env 파일 + python-dotenv 써도 됩니다.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-2.0-flash"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

SYSTEM_PROMPT = """당신은 'AI 건설현장 안전관리 시스템'의 AI 안전 어시스턴트입니다.
건설현장 안전, 위험도 분석 결과 해석, 사고 예방 방법, 안전교육에 관해 친절하고
간결하게 답변하세요. 확실하지 않은 법규나 수치는 단정하지 말고, 현장 안전관리자와
상의하라고 안내하세요. 답변은 한국어로, 2~4문장 정도로 짧게 하세요."""


class ChatMessage(BaseModel):
    role: str  # "user" | "model"
    text: str


class ChatIn(BaseModel):
    message: str
    history: List[ChatMessage] = []
    context: Optional[Dict[str, Any]] = None  # 현재 현장정보/최근 분석결과 (프론트에서 전달)


@app.post("/api/chat")
def chat(body: ChatIn):
    if not GEMINI_API_KEY:
        return {"reply": "⚠️ 서버에 GEMINI_API_KEY가 설정되지 않았어요. 백엔드 환경변수를 확인해주세요.", "error": True}

    contents = []

    # 현재 현장정보/분석결과를 모델이 참고할 수 있도록 대화 맨 앞에 컨텍스트로 삽입
    if body.context:
        contents.append({
            "role": "user",
            "parts": [{"text": f"[참고용 현재 현장 데이터, 사용자에게 직접 보여주지 말고 답변에만 참고하세요]\n{body.context}"}],
        })
        contents.append({"role": "model", "parts": [{"text": "네, 참고하겠습니다."}]})

    for m in body.history:
        contents.append({"role": m.role, "parts": [{"text": m.text}]})

    contents.append({"role": "user", "parts": [{"text": body.message}]})

    try:
        res = requests.post(
            GEMINI_URL,
            params={"key": GEMINI_API_KEY},
            json={
                "contents": contents,
                "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            },
            timeout=15,
        )
        res.raise_for_status()
        data = res.json()
        reply = data["candidates"][0]["content"]["parts"][0]["text"]
        return {"reply": reply, "error": False}
    except Exception as e:
        return {"reply": f"죄송해요, 답변을 가져오지 못했어요. ({e})", "error": True}