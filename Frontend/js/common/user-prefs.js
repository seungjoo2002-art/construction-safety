// ============================================================
// user-prefs.js — 계정별 사용자 설정(언어 / 접근성 / 현장설정 완료 여부 / 알림)
// ------------------------------------------------------------
// 설정의 원본은 서버 DB(users.prefs, Backend/user_api.py)입니다. auth.js가 로그인/페이지
// 로드 때 /api/me 응답을 auth_user 캐시에 넣어두고, 여기서는 그 캐시를 동기적으로 읽습니다
// (i18n·접근성이 화면을 그리기 전에 바로 적용되어야 해서). 변경은 캐시를 즉시 고치고
// 서버(PATCH /api/me/prefs)에 저장합니다.
//
// 로그인하지 않은 상태(로그인/회원가입 화면)에서는 전역 폴백 키(app_language,
// a11y_large_font, a11y_high_contrast)만 씁니다.
// auth.js 보다 나중에 로드되어야 합니다.
// ============================================================

const DEFAULT_USER_PREFS = {
  language: "ko",
  largeText: false,
  highContrast: false,
  setupCompleted: false,
  notifPush: true,
  notifAlert: true,
};

function getCurrentUsername() {
  const user = typeof getCachedUser === "function" ? getCachedUser() : null;
  return user ? user.username : null;
}

/** 현재 로그인 계정의 설정. 비로그인 상태면 전역(guest) 폴백 값. */
function getUserPrefs() {
  const user = typeof getCachedUser === "function" ? getCachedUser() : null;
  if (user) return { ...DEFAULT_USER_PREFS, ...(user.prefs || {}) };

  let legacy = {};
  try {
    legacy = {
      language: localStorage.getItem("app_language") || DEFAULT_USER_PREFS.language,
      largeText: localStorage.getItem("a11y_large_font") === "true",
      highContrast: localStorage.getItem("a11y_high_contrast") === "true",
    };
  } catch (e) {
    /* 저장소 접근 불가 */
  }
  return { ...DEFAULT_USER_PREFS, ...legacy };
}

/**
 * 현재 로그인 계정의 설정 일부를 갱신(병합 저장). 비로그인 상태면 전역 폴백 키에만 저장.
 * @param {Partial<typeof DEFAULT_USER_PREFS>} partial
 * @returns {Promise<void>} 서버 저장 완료(실패 시 콘솔 경고만)
 */
function setUserPrefs(partial) {
  // accessibility.js/i18n.js는 비로그인 화면에서 전역 키를 읽으므로 항상 미러링해둔다
  try {
    if (partial.language !== undefined) localStorage.setItem("app_language", partial.language);
    if (partial.largeText !== undefined) localStorage.setItem("a11y_large_font", String(partial.largeText));
    if (partial.highContrast !== undefined) localStorage.setItem("a11y_high_contrast", String(partial.highContrast));
  } catch (e) {
    /* 무시 */
  }

  const user = typeof getCachedUser === "function" ? getCachedUser() : null;
  if (!user) return Promise.resolve();

  user.prefs = { ...DEFAULT_USER_PREFS, ...(user.prefs || {}), ...partial };
  setCachedUser(user);
  return authRequest("PATCH", "/api/me/prefs", { prefs: partial })
    .then(() => undefined)
    .catch((err) => console.warn("[user-prefs.js] 설정 서버 저장 실패", err));
}

/** 계정별 html 클래스(a11y-large-font / a11y-high-contrast)를 현재 설정대로 다시 적용 */
function applyA11yClasses() {
  const prefs = getUserPrefs();
  document.documentElement.classList.toggle("a11y-large-font", !!prefs.largeText);
  document.documentElement.classList.toggle("a11y-high-contrast", !!prefs.highContrast);
}
