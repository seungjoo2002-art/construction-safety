// ============================================================
// api.js — 백엔드(predict/analyze/analyze-photo/chat) 연동
// ============================================================

// env.js(빌드 시 scripts/generate-env.js가 생성)가 이 파일보다 먼저 로드되어
// window.APP_CONFIG.BACKEND_API_BASE_URL을 채워두면 그 값을 쓰고, 없으면(로컬에서
// 빌드 스크립트 없이 그냥 열어 테스트하는 경우) 로컬 백엔드 기본 주소로 대체합니다.
const API_BASE_URL = (
  (window.APP_CONFIG && window.APP_CONFIG.BACKEND_API_BASE_URL) || "http://127.0.0.1:8000"
).replace(/\/+$/, ""); // 끝의 "/"를 제거 — 안 그러면 아래 `${API_BASE_URL}/api/...`가 "//api/..."가 됨

/**
 * 위험도(심각도) + 사고유형 예측 요청.
 * payload: predict-input.js에서 조립한 payload 객체 (현장설정 + 오늘 입력 + 날씨)
 * @returns { severity, accident_type }
 *
 * 동작: 실제 백엔드(app.py)로 요청하고, 실패하면 목업으로 조용히 대체하지 않고
 *       에러를 그대로 다시 던집니다(rethrow). 호출하는 쪽에서 실패를 명확히 처리해야 합니다.
 */
async function predictRisk(payload) {
  console.log("[api.js] /api/predict 호출 시작: " + API_BASE_URL);
  try {
    // 콜드 스타트(수십 초)를 고려해 2분까지 기다린다
    const data = await _postJson("/api/predict", { data: payload }, 120000);
    console.log("[api.js] /api/predict 성공");
    return data;
  } catch (err) {
    console.error(`[api.js] 실제 백엔드(${API_BASE_URL}) 연결 실패`, err);
    throw err;
  }
}

/**
 * 시간대별 위험도 예측 (작업 시작~종료 시각, 1시간 간격).
 * 백엔드가 시각마다 위험도만 배치 예측하고, p_fatal 최대 시각(동점이면 가장 이른 시각)의
 * 위험도 + 사고유형을 대표 결과로 돌려준다.
 * @param {object} payload predict-input.js에서 조립한 payload(발생일시/사고일시_x 제외)
 * @param {{date: string, startHour: number, endHour: number}} workHours date는 KST "YYYY-MM-DD"
 * @returns { severity, accident_type, hourly } — severity/accident_type은 /api/predict와 같은 형태
 */
async function predictHourlyRisk(payload, workHours) {
  console.log("[api.js] /api/predict-hourly 호출 시작: " + API_BASE_URL);
  try {
    const data = await _postJson(
      "/api/predict-hourly",
      { data: payload, date: workHours.date, start_hour: workHours.startHour, end_hour: workHours.endHour },
      120000
    );
    console.log("[api.js] /api/predict-hourly 성공");
    return data;
  } catch (err) {
    console.error(`[api.js] 실제 백엔드(${API_BASE_URL}) 연결 실패`, err);
    throw err;
  }
}

// ── 백엔드 깨우기: Render 인스턴스가 잠들어 있으면 첫 요청이 수십 초 걸린다(콜드 스타트).
//    입력/촬영 화면에 들어오는 순간 /health를 한 번 찔러두면, 사용자가 입력하는 동안
//    서버가 깨어나 실제 분석 요청이 타임아웃에 걸리지 않는다. 결과는 쓰지 않는다.
function wakeBackend() {
  fetch(`${API_BASE_URL}/health`, { cache: "no-store", signal: AbortSignal.timeout(120000) }).catch(() => {});
}

// 실패 원인을 사용자에게 구분해서 보여주기 위한 에러 (kind: timeout | network | server | client)
class ApiError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status || null;
  }
}

async function _postJson(path, body, timeoutMs) {
  let res;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new ApiError("timeout", `서버 응답이 ${Math.round(timeoutMs / 1000)}초 안에 오지 않았어요.`);
    }
    throw new ApiError("network", "백엔드 서버에 연결할 수 없어요.");
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).detail || "";
    } catch (_) {
      /* 본문이 JSON이 아니면 상태 코드만 보여준다 */
    }
    throw new ApiError(res.status < 500 ? "client" : "server", detail || `서버 오류 (${res.status})`, res.status);
  }
  return res.json();
}

// ============================================================
// 현장 사진 분석 (YOLO 객체탐지 + rules.json 룰 판정 — Backend/safety_yolo_pkg)
// 실패하면 목업으로 대체하지 않고 ApiError를 던진다 — 호출하는 쪽이 오류를 그대로 보여준다.
// (예전에는 실패 시 "점수 87 / HIGH" 목업을 정상 결과처럼 보여줘서, 서버가 잠들어 있던
//  다른 기기에서는 실제 분석이 아니라 고정된 가짜 결과가 나오는 문제가 있었다.)
// ============================================================
async function analyzePhoto(photoDataUrl) {
  // 콜드 스타트 + YOLO 모델 첫 로딩까지 고려해 넉넉히 2분
  return _postJson("/api/analyze-photo", { image: photoDataUrl }, 120000);
}

// ============================================================
// 유사도 분석 (similarity_service.py 연동 — 유사사례 + MDS 산점도)
// ============================================================
/**
 * @param {object} payload predict-input.js에서 조립한 것과 동일한 payload 객체
 * @returns {Promise<{similar_cases, mds_chart_image, is_approximate}|null>} 실패 시 null
 *          (목업으로 대체하지 않는다 — 결과 화면이 "불러오지 못했어요"를 보여준다)
 */
async function getSimilarity(payload) {
  try {
    // 첫 호출은 서버가 임베딩 자산을 내려받느라 오래 걸릴 수 있어 3분까지 기다린다
    return await _postJson("/api/analyze", { data: payload }, 180000);
  } catch (err) {
    console.error(`[api.js] 유사도 분석 실패 (${API_BASE_URL}/api/analyze): ${err.kind} — ${err.message}`);
    return null;
  }
}

// ============================================================
// 해결방안 (advisor.py 연동 — KOSHA 유사사례 검색 + Gemini 안전수칙 생성)
// ============================================================
/**
 * @param {object} payload predict-input.js에서 조립한 것과 동일한 payload 객체
 * @param {string} [상황] 자유 서술(예: "슬래브 콘크리트 타설 중 거푸집 붕괴 위험"). 없으면 서버가 예측 결과로 자동 생성.
 * @returns {Promise<{items, intro, evidence, advice, verification, retrieval}|null>} 실패 시 null
 *          (AI 생성문이라 목업으로 대체하면 실제처럼 보여 부적절 — 실패하면 그냥 섹션을 숨긴다)
 */
async function getSafetyAdvice(payload, 상황) {
  try {
    // 로컬 EXAONE(CPU) 생성은 1건에 ~2분 → 5분까지 기다린다 (템플릿/Gemini면 수 초)
    const data = await _postJson("/api/advise", { data: payload, 상황: 상황 || null }, 300000);
    if (!Array.isArray(data.items) || data.items.length !== 5) {
      // 백엔드가 구버전(schema_version 없음)이거나 비정상 응답 — 이전 포맷을 섞어 보여주지 않는다
      console.error("[api.js] /api/advise 응답 형식 오류 (items 5개 아님)", data);
      return null;
    }
    return data;
  } catch (err) {
    console.error(`[api.js] 해결방안 실패 (${API_BASE_URL}/api/advise): ${err.kind} — ${err.message}`);
    return null;
  }
}

// ============================================================
// 사고 사례 DB 조회 (Hugging Face Dataset Viewer API 직접 호출 — hf-dataset.js)
// 더 이상 Render 백엔드를 거치지 않습니다. mock-cases.js의 MOCK_CASES는 HF 데이터셋이
// 설정되지 않았거나 연결 실패 + IndexedDB에도 저장된 게 없을 때만 최후의 폴백으로
// 사용됩니다. 성공한 조회 결과는 idb-store.js(있으면)를 통해 IndexedDB에 저장해두고,
// 네트워크가 끊기면 그 "최근 데이터"로 화면을 보여줍니다.
// ============================================================

// idb-store.js가 로드되지 않은 페이지(예: 이 함수들을 쓰지 않는 화면)에서도
// api.js 자체는 에러 없이 동작하도록 존재 여부를 먼저 확인합니다.
const _idbAvailable = typeof saveRecentSearch === "function";

/**
 * @param {{q?: string, hazard?: string, limit?: number, offset?: number}} opts limit은 최대 100으로 잘림
 * @returns {Promise<{total: number, cases: object[], _hf?: boolean, _mock?: boolean, _offline?: boolean, _notConfigured?: boolean, _filterUnsupported?: boolean}>}
 */
async function getCases({ q = "", hazard = "전체", limit = 20, offset = 0 } = {}) {
  const queryKey = `q=${q}&hazard=${hazard}&limit=${limit}&offset=${offset}`;

  if (typeof hfConfigReady === "function" && !hfConfigReady()) {
    console.warn("[api.js] HF_DATASET_ID가 설정되지 않아 사례 DB를 조회할 수 없어요.");
    if (_idbAvailable) {
      const cached = (await getRecentSearch("cases", queryKey)) || (offset === 0 ? await getLatestSearch("cases") : null);
      if (cached) return { ...cached, _offline: true };
    }
    return { total: 0, cases: [], _notConfigured: true };
  }

  try {
    const data = await getCasesFromHF({ q, hazard, limit, offset });
    if (_idbAvailable) saveRecentSearch("cases", queryKey, data);
    return data;
  } catch (err) {
    console.warn("[api.js] Hugging Face Dataset Viewer 연결 실패 → 저장된 최근 데이터를 찾습니다.", err);
    if (_idbAvailable) {
      const cached = (await getRecentSearch("cases", queryKey)) || (offset === 0 ? await getLatestSearch("cases") : null);
      if (cached) return { ...cached, _offline: true };
    }
    console.warn("[api.js] 저장된 최근 데이터도 없어 목업으로 대체합니다.");
    return mockCaseList({ q, hazard, limit, offset });
  }
}

function mockCaseList({ q, hazard, limit, offset }) {
  const keyword = (q || "").trim();
  const filtered = MOCK_CASES.filter((c) => {
    const matchesTag = hazard === "전체" || c.tags.includes(hazard);
    const matchesKeyword =
      !keyword || c.title.includes(keyword) || c.desc.includes(keyword) || c.tags.some((t) => t.includes(keyword));
    return matchesTag && matchesKeyword;
  });
  return {
    total: filtered.length,
    cases: filtered.slice(offset, offset + limit),
    _mock: true,
  };
}

/**
 * @param {string|number} caseId HF 데이터셋 행 id (= 원본 df_db.csv 행 인덱스)
 * @returns {Promise<object|null>}
 */
async function getCaseDetail(caseId) {
  if (typeof hfConfigReady === "function" && !hfConfigReady()) {
    if (_idbAvailable) {
      const cached = await getRecentSearch("caseDetail", String(caseId));
      if (cached) return { ...cached, _offline: true };
    }
    const found = MOCK_CASES.find((c) => String(c.id) === String(caseId));
    return found ? { ...found, _mock: true } : null;
  }

  try {
    const data = await getCaseDetailFromHF(caseId);
    if (!data) throw new Error("사례를 찾을 수 없어요.");
    if (_idbAvailable) saveRecentSearch("caseDetail", String(caseId), data);
    return data;
  } catch (err) {
    console.warn("[api.js] Hugging Face Dataset Viewer 연결 실패 → 저장된 최근 데이터를 찾습니다.", err);
    if (_idbAvailable) {
      const cached = await getRecentSearch("caseDetail", String(caseId));
      if (cached) return { ...cached, _offline: true };
    }
    console.warn("[api.js] 저장된 최근 데이터도 없어 목업으로 대체합니다.");
    const found = MOCK_CASES.find((c) => String(c.id) === String(caseId));
    return found ? { ...found, _mock: true } : null;
  }
}