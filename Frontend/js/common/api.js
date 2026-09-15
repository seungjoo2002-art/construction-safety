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
 * payload: predict-input.js에서 조립한 RAW_INPUT_COLS 형태의 객체
 * @returns { severity, accident_type }
 *
 * 동작: 실제 백엔드(app.py)로 요청하고, 실패하면 목업으로 조용히 대체하지 않고
 *       에러를 그대로 다시 던집니다(rethrow). 호출하는 쪽에서 실패를 명확히 처리해야 합니다.
 */
async function predictRisk(payload) {
  console.log("[api.js] /api/predict 호출 시작: " + API_BASE_URL);
  try {
    const res = await fetch(`${API_BASE_URL}/api/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: payload }),
      signal: AbortSignal.timeout(40000), // 40초 안에 응답 없으면 실패로 처리
    });
    if (!res.ok) throw new Error(`예측 요청 실패 (${res.status})`);
    const data = await res.json();
    console.log("[api.js] /api/predict 성공");
    return data;
  } catch (err) {
    console.error(`[api.js] 실제 백엔드(${API_BASE_URL}) 연결 실패`, err);
    throw err;
  }
}

function mockSeverityResult() {
  return {
    model_version: "severity-rus4-v2",
    predicted_class: "치명",
    probabilities: { "경+중등도": 0.367, "중상": 0.261, "치명": 0.372 },
    fatal_risk: {
      p_fatal: 0.372,
      percentile: 79.77,
      top_percent: 20.23,
      grade: "보통",
      grade_description: "평균 수준의 위험",
      lift_vs_median: 2.17,
      lift_vs_mean: 1.68,
      reference_median: 0.171,
      reference_mean: 0.221,
      reference_n: 22445,
      reference_source: "oof_train",
    },
    input_quality: { missing_fields: [], completeness: 1.0 },
  };
}

function mockAccidentTypeResult() {
  const ranked = [
    { type: "추락·압착(Falls)", type_index: 2, probability: 0.296, percentile: 75.8, top_percent: 24.2, lift_vs_mean: 1.27, reference_mean: 0.213, actual_prior: 0.239, likelihood: "높음", likelihood_description: "평균보다 뚜렷하게 높음" },
    { type: "물체에 맞음(Struck-by)", type_index: 3, probability: 0.21, percentile: 58.4, top_percent: 41.6, lift_vs_mean: 1.06, reference_mean: 0.198, actual_prior: 0.162, likelihood: "보통", likelihood_description: "평균 수준" },
    { type: "끼임(Caught-in)", type_index: 0, probability: 0.19, percentile: 52.1, top_percent: 47.9, lift_vs_mean: 0.97, reference_mean: 0.196, actual_prior: 0.123, likelihood: "보통", likelihood_description: "평균 수준" },
    { type: "전도·충돌(Trips/Struck-against)", type_index: 4, probability: 0.184, percentile: 39.6, top_percent: 60.4, lift_vs_mean: 0.79, reference_mean: 0.234, actual_prior: 0.373, likelihood: "낮음", likelihood_description: "평균보다 낮음" },
    { type: "절단·베임·찔림(Cut)", type_index: 1, probability: 0.12, percentile: 33.2, top_percent: 66.8, lift_vs_mean: 0.75, reference_mean: 0.160, actual_prior: 0.103, likelihood: "낮음", likelihood_description: "평균보다 낮음" },
  ];

  return {
    model_version: "accident-type-stacking-v1",
    predicted_type: ranked[0].type,
    predicted_type_index: ranked[0].type_index,
    confidence: ranked[0].probability,
    probabilities: Object.fromEntries(ranked.map((r) => [r.type, r.probability])),
    ranked_types: ranked,
    elevated_types: ranked.filter((r) => r.percentile >= 70),
    input_quality: { missing_fields: [], completeness: 1.0 },
  };
}

// ============================================================
// 챗봇 (백엔드 /api/chat → Gemini API)
// ============================================================
/**
 * @param {string} message 사용자가 이번에 입력한 메시지
 * @param {{role: "user"|"model", text: string}[]} history 이전 대화 기록
 * @param {object|null} context 현재 현장정보/최근 분석결과 (챗봇이 참고할 데이터)
 * @returns {Promise<string>} 봇의 답변 텍스트
 */
async function chatWithAI(message, history = [], context = null) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, context }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`챗봇 요청 실패 (${res.status})`);
    const data = await res.json();
    return data.reply;
  } catch (err) {
    console.warn(`[api.js] 챗봇 백엔드(${API_BASE_URL}) 연결 실패 → 목업 답변으로 대체합니다.`, err);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return mockChatReply(message);
  }
}

function mockChatReply(message) {
  if (message.includes("위험도")) {
    return "현재는 백엔드 챗봇 서버가 연결되지 않아 목업 답변을 드리고 있어요. 서버가 연결되면 실제 현장 분석 결과를 바탕으로 답변드릴 수 있어요.";
  }
  if (message.includes("추락")) {
    return "추락 예방을 위해서는 안전난간 설치, 안전대 착용, 강풍 시 고소작업 중단이 기본입니다. (목업 답변)";
  }
  return "죄송해요, 지금은 챗봇 서버가 연결되지 않아 정확한 답변을 드리기 어려워요. (목업 답변)";
}

// ============================================================
// 현장 사진 분석 (컴퓨터비전 객체탐지 — Backend/safety_yolo_pkg의 YOLO 모델 연동)
// 백엔드가 켜져 있고 사진 분석 서비스(ultralytics/torch)가 정상 초기화되어 있으면
// 실제 탐지 결과를 받고, 서버가 꺼져있거나 초기화 실패(503) 시에만 목업으로 대체합니다.
// ============================================================
async function analyzePhoto(photoDataUrl) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/analyze-photo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: photoDataUrl }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`사진 분석 요청 실패 (${res.status})`);
    return await res.json();
  } catch (err) {
    console.warn(`[api.js] 사진분석 백엔드(${API_BASE_URL}) 연결 실패 → 목업 데이터로 대체합니다.`, err);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return mockPhotoAnalysisResult();
  }
}

function mockPhotoAnalysisResult() {
  return {
    score: 87,
    grade: "HIGH",
    grade_label: "즉각 조치 필요",
    boxes: [
      { label: "추락위험", pct: 94, top: 8, left: 60, width: 30, height: 26, color: "danger" },
      { label: "안전모 미착용", pct: 88, top: 38, left: 28, width: 24, height: 22, color: "caution" },
    ],
    hazards: [
      { icon: "⬇️", title: "추락 위험", severity: "위험", desc: "비계 안전난간 미설치" },
      { icon: "🪖", title: "안전모 미착용", severity: "위험", desc: "작업자 2명 안전모 미착용 감지" },
      { icon: "📦", title: "자재 적치 불량", severity: "주의", desc: "자재 적치 규정 불량" },
      { icon: "🪜", title: "사다리 높이 불량", severity: "주의", desc: "사다리 높이와 각도 불량으로 전도 위험" },
    ],
    _mock: true,
  };
}

// ============================================================
// 유사도 분석 (similarity_service.py 연동 — 유사사례 + MDS 산점도 + 재발방지대책)
// ============================================================
/**
 * @param {object} payload predict-input.js에서 조립한 것과 동일한 RAW_INPUT_COLS 형태 객체
 * @returns {Promise<{similar_cases, mds_chart_image, prevention_guidelines}>}
 */
async function getSimilarity(payload) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: payload }),
      signal: AbortSignal.timeout(40000), // 임베딩 호출이 껴서 넉넉히 40초
    });
    if (!res.ok) throw new Error(`유사도 분석 요청 실패 (${res.status})`);
    return await res.json();
  } catch (err) {
    console.warn(`[api.js] 유사도 서비스(${API_BASE_URL}) 연결 실패 → 목업으로 대체합니다.`, err);
    await new Promise((resolve) => setTimeout(resolve, 700));
    return mockSimilarityResult();
  }
}

// 목업용 산점도 이미지 (백엔드 /api/analyze는 실제로 서버에서 렌더링한 PNG를 base64로 내려줌)
const MOCK_MDS_CHART_IMAGE =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">
      <rect width="400" height="200" fill="#F4F6FA"/>
      <text x="200" y="104" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#9AA3B2">산점도 목업 이미지</text>
    </svg>
  `);

function mockSimilarityResult() {
  return {
    _mock: true,
    mds_chart_image: MOCK_MDS_CHART_IMAGE,
    similar_cases: [
      { id: "gangnam-2024-03", title: "강남 오피스텔 추락 사고", summary: "비계 위에서 작업 중 안전난간 미설치로 인한 추락", hazard_type: "추락", similarity_percent: 94 },
      { id: "incheon-2023-11", title: "인천 물류창고 낙하 사고", summary: "상부 적재 자재 불량으로 낙하물 맞음", hazard_type: "낙하", similarity_percent: 87 },
      { id: "busan-2024-01", title: "부산 아파트 추락 사고", summary: "사다리 불안정으로 인한 작업자 추락", hazard_type: "추락", similarity_percent: 81 },
      { id: "daejeon-2024-02", title: "대전 상가 전도 사고", summary: "통로 자재 적치로 인한 전도", hazard_type: "전도", similarity_percent: 74 },
      { id: "gyeonggi-2023-12", title: "경기 공장 끼임 사고", summary: "회전기계 방호장치 미설치로 끼임", hazard_type: "끼임", similarity_percent: 68 },
    ],
    prevention_guidelines: [
      "▶ 추락위험 구역 안전난간 및 개구부 덮개 밀착 설치, 근로자 안전대 상시 체결 체계 감독",
      "▶ 상하 동시 작업 원천 금지 및 하부 출입통제선 구성, 낙하물 방지망 정비 상태 정기 점검",
      "▶ 자재 정리정돈 및 통로 유효 너비 확보, 바닥면 물기 및 기름 소거를 통한 미끄러짐 차단",
    ],
  };
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