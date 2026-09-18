// ============================================================
// session-store.js — 현장 설정(site-setup) 데이터 저장/조회
// site-setup.html에서 저장 → predict-input.html에서 불러와
// 매 분석 요청마다 동적 입력값과 합쳐서 백엔드로 전송합니다.
// 로그인한 아이디(logged_in_username)별로 따로 저장됩니다 — 계정이 다르면
// 서로의 현장 설정을 보지 못하고, 새 계정으로 로그인/가입하면 처음부터
// 다시 입력해야 합니다.
// ============================================================

/**
 * 계정별로 분리해서 저장해야 하는 값들(현장설정, 오늘의 위험도 분석 등)에 쓰는
 * storage key 접두어 헬퍼. 로그인 안 된 상태(비정상 접근)면 "guest"로 폴백.
 */
function _accountKey(prefix) {
  const username = localStorage.getItem("logged_in_username") || "guest";
  return `${prefix}__${username}`;
}

const SITE_SETUP_KEY_PREFIX = "site_setup_data";
const SITE_SETUP_DONE_KEY_PREFIX = "site_setup_done";

/**
 * 현장 설정값 저장(현재 로그인한 계정 전용). data는 RAW_INPUT_COLS 필드명을 key로 쓰는 객체.
 * 예: { "공사시작일": "2025-01-01", "공공/민간 구분": "민간", ... }
 */
function saveSiteSetup(data) {
  localStorage.setItem(_accountKey(SITE_SETUP_KEY_PREFIX), JSON.stringify(data));
  localStorage.setItem(_accountKey(SITE_SETUP_DONE_KEY_PREFIX), "true");
}

/** 저장된 현장 설정값 조회(현재 로그인한 계정 전용). 없으면 null. */
function getSiteSetup() {
  const raw = localStorage.getItem(_accountKey(SITE_SETUP_KEY_PREFIX));
  return raw ? JSON.parse(raw) : null;
}

function hasSiteSetup() {
  return localStorage.getItem(_accountKey(SITE_SETUP_DONE_KEY_PREFIX)) === "true";
}

function clearSiteSetup() {
  localStorage.removeItem(_accountKey(SITE_SETUP_KEY_PREFIX));
  localStorage.removeItem(_accountKey(SITE_SETUP_DONE_KEY_PREFIX));
}

// ============================================================
// "가장 최근 위험도 분석 결과" 저장/조회
// 위험도 분석을 할 때마다 자동으로 여기 덮어써지고(수동 저장 버튼과 무관),
// 대시보드가 이 값을 읽어서 채워짐. 없으면 대시보드는 빈 상태로 표시.
// 날짜가 바뀌면(자정 지나 처음 대시보드를 열면) 자동으로 비워집니다.
// 로그인한 아이디별로 따로 저장됩니다 — 계정이 다르면 "오늘 분석했는지" 여부도
// 서로 독립적입니다(A 계정이 분석해도 B 계정 대시보드는 여전히 분석 유도 문구가 뜸).
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
  localStorage.setItem(_accountKey(LAST_PREDICT_RESULT_KEY), JSON.stringify(result));
  localStorage.setItem(_accountKey(LAST_PREDICT_INPUT_KEY), JSON.stringify(input));
  localStorage.setItem(_accountKey(LAST_PREDICT_DATE_KEY), todayDateString());
}

/**
 * 가장 최근 분석 결과(현재 로그인한 계정 전용). 한 번도 분석 안 했으면 null.
 * 저장된 날짜가 오늘과 다르면(자정이 지났으면) 위험도 분석 관련 캐시를
 * 전부 지우고 null을 반환합니다 — 대시보드가 매일 처음엔 빈 상태로 시작하도록.
 */
function getLastPredictResult() {
  const savedDate = localStorage.getItem(_accountKey(LAST_PREDICT_DATE_KEY));
  if (savedDate && savedDate !== todayDateString()) {
    localStorage.removeItem(_accountKey(LAST_PREDICT_RESULT_KEY));
    localStorage.removeItem(_accountKey(LAST_PREDICT_INPUT_KEY));
    localStorage.removeItem(_accountKey(LAST_PREDICT_DATE_KEY));
    localStorage.removeItem(_accountKey(LAST_SIMILARITY_KEY));
    return null;
  }

  const raw = localStorage.getItem(_accountKey(LAST_PREDICT_RESULT_KEY));
  return raw ? JSON.parse(raw) : null;
}

/** 가장 최근 분석에 쓰인 입력값(현재 로그인한 계정 전용, 시간별 위험도 추이 재계산 시 기상값만 바꿔서 재사용) */
function getLastPredictInput() {
  const raw = localStorage.getItem(_accountKey(LAST_PREDICT_INPUT_KEY));
  return raw ? JSON.parse(raw) : null;
}

// ── 가장 최근 유사도 분석 결과(현재 로그인한 계정 전용 — similar_cases / mds_chart_image / prevention_guidelines)
const LAST_SIMILARITY_KEY = "last_similarity_result";

function saveLastSimilarity(simResult) {
  localStorage.setItem(_accountKey(LAST_SIMILARITY_KEY), JSON.stringify(simResult));
}

function getLastSimilarity() {
  const raw = localStorage.getItem(_accountKey(LAST_SIMILARITY_KEY));
  return raw ? JSON.parse(raw) : null;
}

// ============================================================
// 위험도 분석 이력 (알림 화면에서 지난 분석 결과를 다시 열어볼 때 씀)
// 분석이 끝날 때마다(predict-loading.js) 자동으로 여기 쌓입니다 — 수동 저장 버튼과
// 무관하게 "분석했던 결과"는 전부 기록됩니다. profile.html의 "분석 횟수" 통계, 결과
// 화면의 수동 저장 버튼과 같은 "saved_results" localStorage 키를 그대로 씁니다.
// ============================================================
const SAVED_RESULTS_KEY = "saved_results";

/** 분석 1건을 이력에 추가하고, 나중에 다시 찾아올 때 쓸 고유 id를 반환합니다. */
function saveAnalysisRecord(result, input, sim) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const saved = getSavedResults();
  saved.unshift({
    id,
    savedAt: new Date().toISOString(),
    score: Math.round(result.severity.fatal_risk.percentile),
    grade: result.severity.fatal_risk.grade,
    topType: result.accident_type.predicted_type,
    result,
    input,
    sim: sim || null,
  });
  localStorage.setItem(SAVED_RESULTS_KEY, JSON.stringify(saved.slice(0, 50))); // 최근 50건만 보관
  return id;
}

function getSavedResults() {
  const raw = localStorage.getItem(SAVED_RESULTS_KEY);
  return raw ? JSON.parse(raw) : [];
}

/** id로 지난 분석 1건을 다시 조회 (알림 화면 → 분석 결과 화면 재진입용). 없으면 null. */
function getSavedResultById(id) {
  return getSavedResults().find((r) => r.id === id) || null;
}

// ============================================================
// 사진 분석 이력 (분석 기록·알림 화면에서 지난 사진 분석 결과를 다시 열어볼 때 씀)
// photo-analyzing.js가 분석이 끝날 때마다 자동으로 여기 쌓는다. saved_photo_results
// localStorage 키는 기존 photo-result.js의 수동 "저장" 버튼과 공유하지만(하위호환),
// 그 수동 저장 항목엔 id/thumbnail이 없어 상세 재진입은 안 되고 목록 카운트에만 잡힌다.
// 원본 사진(수 MB) 전체를 저장하지 않고, 작게 축소한 thumbnail(dataURL)만 같이 보관한다.
// ============================================================
const SAVED_PHOTO_RESULTS_KEY = "saved_photo_results";

/** 사진 분석 1건을 이력에 추가하고, 나중에 다시 찾아올 때 쓸 고유 id를 반환합니다. */
function savePhotoAnalysisRecord(result, thumbnail) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const saved = getSavedPhotoResults();
  saved.unshift({ id, savedAt: new Date().toISOString(), result, thumbnail: thumbnail || null });
  localStorage.setItem(SAVED_PHOTO_RESULTS_KEY, JSON.stringify(saved.slice(0, 50))); // 최근 50건만 보관
  return id;
}

function getSavedPhotoResults() {
  const raw = localStorage.getItem(SAVED_PHOTO_RESULTS_KEY);
  return raw ? JSON.parse(raw) : [];
}

/** id로 지난 사진 분석 1건을 다시 조회. 없으면 null. */
function getSavedPhotoResultById(id) {
  return getSavedPhotoResults().find((r) => r.id === id) || null;
}