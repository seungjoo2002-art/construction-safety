// ============================================================
// session-store.js — 사용자 데이터(현장정보 / 위험도 분석 기록 / 사진 분석 기록) 저장·조회
// ------------------------------------------------------------
// 예전에는 전부 localStorage에 있었고, 분석 기록(saved_results / saved_photo_results)은
// 계정과 무관한 브라우저 전역 키라서 같은 브라우저의 다른 계정에도 그대로 보였다.
// 이제 모든 데이터는 백엔드 DB에 로그인 사용자(user_id) 소유로 저장되고, 조회도 서버가
// 토큰의 사용자 것만 돌려준다(Backend/user_api.py). 이 파일의 함수는 전부 async이다.
// auth.js 보다 나중에 로드되어야 합니다.
//
// ※ 예전 버전이 남긴 localStorage 키(saved_results, saved_photo_results,
//   site_setup_data__<아이디>, last_predict_result__<아이디> 등)는 소유자를 확정할 수 없어
//   어떤 계정에도 자동으로 붙이지 않고, 지우지도 않으며, 더 이상 읽지 않는다.
// ============================================================

// ── 현장 정보 ───────────────────────────────────────────────
/** 현장 설정값 저장(현재 로그인 계정). data는 백엔드 입력 필드명을 key로 쓰는 객체. */
async function saveSiteSetup(data) {
  await authRequest("PUT", "/api/me/site-setup", { data });
  const user = getCachedUser();
  if (user) {
    user.prefs = { ...(user.prefs || {}), setupCompleted: true };
    setCachedUser(user);
  }
}

/** 저장된 현장 설정값(현재 로그인 계정). 없으면 null. */
async function getSiteSetup() {
  return (await authRequest("GET", "/api/me/site-setup")).data || null;
}

/** 오늘 날짜(로컬) "YYYY-MM-DD" */
function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── 위험도 분석 기록 ─────────────────────────────────────────
/**
 * /api/advise 응답에서 이력에 남길 부분만 추린다 — 근거 사례 원문 레코드(재해개요 등)는
 * 크기가 커서 화면에 쓰는 필드만 남긴다. 다시 열어봤을 때 분석 당시와 똑같은 5개 예방대책을
 * 보여주기 위해 저장한다(재생성하면 값이 바뀔 수 있어서 재요청하지 않는다).
 */
function compactAdvise(advise) {
  if (!advise || !Array.isArray(advise.items)) return null;
  return {
    schema_version: advise.schema_version || 2,
    items: advise.items,
    intro: advise.intro || "",
    llm: advise.llm || null,
    verification: advise.verification || null,
    evidence: (advise.evidence || []).map((e) => ({
      대책: e.대책,
      점수: e.점수,
      출처: { id: e.출처.id, 공종: e.출처.공종, 작업명: e.출처.작업명, 재해종류: e.출처.재해종류 },
    })),
  };
}

// 서버 레코드 → 화면 코드가 쓰던 모양({id, savedAt, score, grade, topType, result, ...})
function _toAnalysisRecord(row) {
  return {
    id: row.id,
    savedAt: row.created_at,
    score: row.score,
    grade: row.grade,
    topType: row.top_type,
    note: row.note || "",
    result: row.result,
    input: row.input,
    sim: row.sim,
    advise: row.advise,
  };
}

/** 분석 1건을 내 기록에 저장하고 서버가 부여한 id를 반환. */
async function saveAnalysisRecord(result, input, sim, advise) {
  const row = await authRequest("POST", "/api/me/analyses", {
    result,
    input: input || null,
    sim: sim || null,
    advise: compactAdvise(advise),
  });
  return row.id;
}

/** 내 분석 기록 목록(최신순, 가벼운 필드만 — input/sim/advise 제외). */
async function getSavedResults() {
  return (await authRequest("GET", "/api/me/analyses")).items.map(_toAnalysisRecord);
}

/** id로 내 분석 기록 1건 전체 조회. 없거나 남의 기록이면 null(서버가 404). */
async function getSavedResultById(id) {
  try {
    return _toAnalysisRecord(await authRequest("GET", `/api/me/analyses/${encodeURIComponent(id)}`));
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/**
 * 대시보드용 "오늘의 가장 최근 분석" (없으면 null). 날짜가 바뀌면 자연히 빈 상태가 된다.
 * 예전 last_predict_result/last_similarity localStorage 캐시를 대체한다.
 */
async function getLatestTodayAnalysis() {
  const [latest] = (await authRequest("GET", "/api/me/analyses?limit=1")).items;
  if (!latest) return null;
  const d = new Date(latest.created_at);
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (local !== todayDateString()) return null;
  return getSavedResultById(latest.id);
}

// ── 사진 분석 기록 ───────────────────────────────────────────
function _toPhotoRecord(row) {
  return {
    id: row.id,
    savedAt: row.created_at,
    note: row.note || "",
    result: row.result,
    thumbnail: row.thumbnail || null,
  };
}

/** 사진 분석 1건을 내 기록에 저장(원본 대신 작은 썸네일만)하고 id를 반환. */
async function savePhotoAnalysisRecord(result, thumbnail) {
  const row = await authRequest("POST", "/api/me/photo-analyses", { result, thumbnail: thumbnail || null });
  return row.id;
}

async function getSavedPhotoResults() {
  return (await authRequest("GET", "/api/me/photo-analyses")).items.map(_toPhotoRecord);
}

async function getSavedPhotoResultById(id) {
  try {
    return _toPhotoRecord(await authRequest("GET", `/api/me/photo-analyses/${encodeURIComponent(id)}`));
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}
