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
import os
import sys
import requests
import pandas as pd

import config as CFG

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
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
sim_service: Optional[SimilarityWebService] = None
try:
    sim_service = SimilarityWebService(openai_api_key=OPENAI_API_KEY or None)
    if OPENAI_API_KEY:
        print("[app.py] 유사도 서비스 초기화 완료 (OpenAI 임베딩 모드)")
    else:
        print("[app.py] ⚠️ OPENAI_API_KEY가 없어 유사도 서비스가 근사(키워드 매칭) 모드로 동작합니다.")
except Exception as e:
    print(f"[app.py] ⚠️ 유사도 서비스 초기화 실패: {e}")


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
# 사고 사례 DB 조회 (similarity_service.py가 쓰는 것과 같은 assets/df_db.csv)
# ============================================================
# 이 기능은 OpenAI 임베딩이 필요 없는 단순 CSV 조회/검색이라
# OPENAI_API_KEY 유무와 무관하게 항상 동작합니다.
CASES_CSV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "df_db.csv")
try:
    cases_df = pd.read_csv(CASES_CSV_PATH)
    print(f"[app.py] 사고 사례 DB 로드 완료: {len(cases_df)}건")
except Exception as e:
    cases_df = None
    print(f"[app.py] ⚠️ 사고 사례 DB(df_db.csv) 로드 실패: {e}")

CASE_HAZARD_TAGS = ["전체", "추락", "낙하", "끼임", "전도", "베임", "감전", "기타"]

# config.py의 부상유형(LEVEL_MAP, 4단계)을 3단계 배지 라벨로 축약해서 재사용
# (모델 학습 때 쓰는 것과 동일한 기준이라 예측 화면의 등급 표현과 일관됩니다)
_INJURY_LEVEL_TO_TAG = {}
for _injury, _level in CFG.LEVEL_MAP.items():
    _INJURY_LEVEL_TO_TAG[_injury] = "치명" if _level == 4 else ("중상" if _level == 3 else "경상")


def _hazard_tag(raw) -> str:
    """원본 '인적사고' 값 → 화면 필터/배지용 축약 사고유형."""
    if pd.isna(raw):
        return "기타"
    val = str(raw)
    if "떨어짐" in val or val == "깔림":
        return "추락"
    if "넘어짐" in val or val == "부딪힘":
        return "전도"
    if "물체에 맞음" in val:
        return "낙하"
    if val == "끼임":
        return "끼임"
    if "절단" in val or "베임" in val or "찔림" in val:
        return "베임"
    if "감전" in val:
        return "감전"
    return "기타"


def _safe_str(v, default: str = "") -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)) or pd.isna(v):
        return default
    # 원본 엑셀 → CSV 변환 과정에서 줄바꿈이 "_x000D_" 리터럴로 깨져 들어온 행이 많음
    return str(v).replace("_x000D_", " ").strip()


def _safe_int(v, default: int = 0) -> int:
    try:
        if pd.isna(v):
            return default
        return int(v)
    except (TypeError, ValueError):
        return default


def _severity_tag(row) -> str:
    injury_type = row.get("추출된_부상유형")
    if pd.notna(injury_type) and str(injury_type) in _INJURY_LEVEL_TO_TAG:
        return _INJURY_LEVEL_TO_TAG[str(injury_type)]
    return "치명" if _safe_int(row.get("총사망자수")) > 0 else "경상"


def _victims_text(row) -> str:
    deaths = _safe_int(row.get("총사망자수"))
    injuries = _safe_int(row.get("총부상자수"))
    parts = []
    if deaths:
        parts.append(f"사망 {deaths}명")
    if injuries:
        parts.append(f"부상 {injuries}명")
    return ", ".join(parts) if parts else "인명피해 없음"


def _case_summary(idx, row) -> Dict[str, Any]:
    return {
        "id": int(idx),
        "tags": [_hazard_tag(row.get("인적사고")), _severity_tag(row)],
        "title": _safe_str(row.get("사고명"), "제목 없음"),
        "desc": _safe_str(row.get("사고경위")),
        "date": _safe_str(row.get("발생일시")).replace("-", "."),
        "victims": _victims_text(row),
    }


def _case_detail(idx, row) -> Dict[str, Any]:
    base = _case_summary(idx, row)
    location = " ".join(p for p in [_safe_str(row.get("시도")), _safe_str(row.get("군구"))] if p)
    prevention = _safe_str(row.get("재발방지대책"))
    base.update({
        "location": location or "위치 정보 없음",
        "causes": {
            "direct": _safe_str(row.get("사고경위"), "정보 없음"),
            "indirect": _safe_str(row.get("사고원인"), "정보 없음"),
            "root": _safe_str(row.get("구체적 사고원인"), "정보 없음"),
        },
        "timeline": [_safe_str(row.get("사고경위"), "정보 없음")],
        "prevention": [prevention] if prevention else ["등록된 재발방지대책이 없어요."],
    })
    return base


@app.get("/api/cases")
def list_cases(q: str = "", hazard: str = "전체", limit: int = 20, offset: int = 0):
    """검색어/사고유형으로 사고 사례 DB를 조회. 프론트의 사례 검색 탭이 사용."""
    if cases_df is None:
        raise HTTPException(status_code=503, detail="사고 사례 DB를 불러오지 못했어요.")

    df = cases_df
    mask = pd.Series(True, index=df.index)

    keyword = q.strip()
    if keyword:
        search_cols = ["사고명", "사고경위", "시도", "군구", "공종 - 중분류"]
        text_mask = pd.Series(False, index=df.index)
        for col in search_cols:
            if col in df.columns:
                text_mask = text_mask | df[col].astype(str).str.contains(keyword, case=False, na=False)
        mask = mask & text_mask

    if hazard and hazard != "전체":
        mask = mask & (df["인적사고"].apply(_hazard_tag) == hazard)

    filtered = df[mask]
    total = len(filtered)
    limit = max(1, min(limit, 50))
    offset = max(0, offset)
    page = filtered.iloc[offset: offset + limit]

    return {
        "total": total,
        "cases": [_case_summary(idx, row) for idx, row in page.iterrows()],
    }


@app.get("/api/cases/{case_id}")
def get_case(case_id: int):
    """사고 사례 상세 조회. case_id는 /api/cases가 내려준 id 그대로."""
    if cases_df is None:
        raise HTTPException(status_code=503, detail="사고 사례 DB를 불러오지 못했어요.")
    if case_id not in cases_df.index:
        raise HTTPException(status_code=404, detail="사례를 찾을 수 없어요.")
    return _case_detail(case_id, cases_df.loc[case_id])


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
    if sim_service is None:
        raise HTTPException(
            status_code=503,
            detail="유사도 서비스가 초기화되지 않았어요. 서버 환경변수 OPENAI_API_KEY를 확인해주세요.",
        )
    sim_input = build_similarity_input(body.data)
    try:
        return sim_service.analyze(sim_input)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"유사도 분석 중 오류: {e}")


@app.get("/health")
def health():
    """서버가 살아있는지 + 모델이 정상 로드됐는지 확인용."""
    return {"status": "ok"}


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