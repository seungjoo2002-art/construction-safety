// ============================================================
// session-store.js — 현장 설정(site-setup) 데이터 저장/조회
// site-setup.html에서 저장 → predict-input.html에서 불러와
// 매 분석 요청마다 동적 입력값과 합쳐서 백엔드로 전송합니다.
// ============================================================

const SITE_SETUP_KEY = "site_setup_data";
const SITE_SETUP_DONE_KEY = "site_setup_done";

/**
 * 현장 설정값 저장. data는 RAW_INPUT_COLS 필드명을 key로 쓰는 객체.
 * 예: { "공사시작일": "2025-01-01", "공공/민간 구분": "민간", ... }
 */
function saveSiteSetup(data) {
  localStorage.setItem(SITE_SETUP_KEY, JSON.stringify(data));
  localStorage.setItem(SITE_SETUP_DONE_KEY, "true");
}

/** 저장된 현장 설정값 조회. 없으면 null. */
function getSiteSetup() {
  const raw = localStorage.getItem(SITE_SETUP_KEY);
  return raw ? JSON.parse(raw) : null;
}

function hasSiteSetup() {
  return localStorage.getItem(SITE_SETUP_DONE_KEY) === "true";
}

function clearSiteSetup() {
  localStorage.removeItem(SITE_SETUP_KEY);
  localStorage.removeItem(SITE_SETUP_DONE_KEY);
}

// ============================================================
// "가장 최근 위험도 분석 결과" 저장/조회
// 위험도 분석을 할 때마다 자동으로 여기 덮어써지고(수동 저장 버튼과 무관),
// 대시보드가 이 값을 읽어서 채워짐. 없으면 대시보드는 빈 상태로 표시.
// 날짜가 바뀌면(자정 지나 처음 대시보드를 열면) 자동으로 비워집니다.
// ============================================================
const LAST_PREDICT_RESULT_KEY = "last_predict_result";
const LAST_PREDICT_INPUT_KEY = "last_predict_input";
const LAST_PREDICT_DATE_KEY = "last_predict_date";

/** 오늘 날짜를 "YYYY-MM-DD" 형태로 반환 */
function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

/** 분석 완료 시점(predict-loading.js)에 호출 — 결과+입력값을 최신으로 덮어씀 */
function saveLastPredictResult(result, input) {
  localStorage.setItem(LAST_PREDICT_RESULT_KEY, JSON.stringify(result));
  localStorage.setItem(LAST_PREDICT_INPUT_KEY, JSON.stringify(input));
  localStorage.setItem(LAST_PREDICT_DATE_KEY, todayDateString());
}

/**
 * 가장 최근 분석 결과. 한 번도 분석 안 했으면 null.
 * 저장된 날짜가 오늘과 다르면(자정이 지났으면) 위험도 분석 관련 캐시를
 * 전부 지우고 null을 반환합니다 — 대시보드가 매일 처음엔 빈 상태로 시작하도록.
 */
function getLastPredictResult() {
  const savedDate = localStorage.getItem(LAST_PREDICT_DATE_KEY);
  if (savedDate && savedDate !== todayDateString()) {
    localStorage.removeItem(LAST_PREDICT_RESULT_KEY);
    localStorage.removeItem(LAST_PREDICT_INPUT_KEY);
    localStorage.removeItem(LAST_PREDICT_DATE_KEY);
    localStorage.removeItem(LAST_SIMILARITY_KEY);
    return null;
  }

  const raw = localStorage.getItem(LAST_PREDICT_RESULT_KEY);
  return raw ? JSON.parse(raw) : null;
}

/** 가장 최근 분석에 쓰인 입력값 (시간별 위험도 추이 재계산 시 기상값만 바꿔서 재사용) */
function getLastPredictInput() {
  const raw = localStorage.getItem(LAST_PREDICT_INPUT_KEY);
  return raw ? JSON.parse(raw) : null;
}

// ── 가장 최근 유사도 분석 결과 (similar_cases / mds_chart_image / prevention_guidelines)
const LAST_SIMILARITY_KEY = "last_similarity_result";

function saveLastSimilarity(simResult) {
  localStorage.setItem(LAST_SIMILARITY_KEY, JSON.stringify(simResult));
}

function getLastSimilarity() {
  const raw = localStorage.getItem(LAST_SIMILARITY_KEY);
  return raw ? JSON.parse(raw) : null;
}