// ============================================================
// user-prefs.js — 계정별 사용자 설정(언어 / 접근성 / 현장설정 완료 여부) 통합 관리
// ------------------------------------------------------------
// 왜 필요한가: 로그아웃 시 계정 정보를 지우면 안 되는데(= site-setup 반복 버그의 원인),
// 기존에는 언어(app_language)·접근성(a11y_*) 설정이 계정과 무관한 "브라우저 전역" 키였고,
// site-setup 완료 여부만 계정별(site_setup_done__<username>) 이었습니다. 이 파일은 셋을
// 하나의 구조로 통합해서 signup.js가 만든 registered_users[i] 레코드에 함께 저장합니다
// (별도 서버 사용자 DB가 없는 현재 구조에서 "계정별로 안전하게 분리"할 수 있는 가장
// 확실한 방법 — 이미 존재하는 계정 레코드에 귀속시키는 것).
//
// 로그인하지 않은 상태(guest)에서는 registered_users에 쓸 계정이 없으므로 전역 폴백 키
// (app_language, a11y_large_font, a11y_high_contrast)만 쓰고, 로그인하면 그 값을 계정
// 레코드로 승격합니다.
//
// login.js/signup.js 보다 나중에 정의되어 있어야 하는 건 아니지만, REGISTERED_USERS_KEY
// 상수를 이 파일에서도 독립적으로 정의합니다(다른 페이지들이 이 파일만 로드해도 동작하도록).
// ============================================================

const REGISTERED_USERS_KEY = "registered_users";

// login.js/signup.js도 이 두 함수를 그대로 재사용합니다(계정 목록 저장소가 한 곳이어야
// prefs가 엉뚱한 계정에 붙는 일이 없습니다) — 그래서 이름 앞에 _를 붙이지 않고 공개합니다.
function getRegisteredUsers() {
  try {
    const raw = localStorage.getItem(REGISTERED_USERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveRegisteredUsers(users) {
  localStorage.setItem(REGISTERED_USERS_KEY, JSON.stringify(users));
}

function getCurrentUsername() {
  return localStorage.getItem("logged_in_username") || null;
}

const DEFAULT_USER_PREFS = { language: "ko", largeText: false, highContrast: false, setupCompleted: false };

/**
 * 현재 로그인한 계정의 설정을 반환합니다. 비로그인 상태면 전역(guest) 폴백 값을 반환합니다.
 * 계정에 아직 prefs가 없는 예전 데이터라면, 레거시 전역 키(a11y_large_font 등)와
 * 계정별 site-setup 완료 키(site_setup_done__<username>, session-store.js)로부터
 * 1회 마이그레이션해서 만들어줍니다.
 */
function getUserPrefs() {
  const username = getCurrentUsername();
  const legacy = {
    language: localStorage.getItem("app_language"),
    largeText: localStorage.getItem("a11y_large_font") === "true",
    highContrast: localStorage.getItem("a11y_high_contrast") === "true",
  };

  if (!username) {
    return { ...DEFAULT_USER_PREFS, ...(legacy.language ? { language: legacy.language } : {}),
             largeText: legacy.largeText, highContrast: legacy.highContrast };
  }

  const users = getRegisteredUsers();
  const account = users.find((u) => u.username === username);
  if (!account) {
    return { ...DEFAULT_USER_PREFS, ...(legacy.language ? { language: legacy.language } : {}) };
  }

  if (account.prefs) {
    // setupCompleted가 아직 기록 안 된 예전 계정이면, 기존 site-setup 완료 키로 보강
    if (account.prefs.setupCompleted === undefined) {
      account.prefs.setupCompleted = typeof hasSiteSetup === "function" ? hasSiteSetup() : false;
      saveRegisteredUsers(users);
    }
    return { ...DEFAULT_USER_PREFS, ...account.prefs };
  }

  // 이 계정에 prefs가 아예 없는 경우(예전 가입자) — 레거시 전역 값 + site-setup 완료 키로 1회 생성
  const migrated = {
    language: legacy.language || DEFAULT_USER_PREFS.language,
    largeText: legacy.largeText,
    highContrast: legacy.highContrast,
    setupCompleted: typeof hasSiteSetup === "function" ? hasSiteSetup() : false,
  };
  account.prefs = migrated;
  saveRegisteredUsers(users);
  return migrated;
}

/**
 * 현재 로그인한 계정의 설정 일부를 갱신합니다(병합 저장). 비로그인 상태면 전역 폴백 키에만 저장합니다.
 * @param {Partial<{language:string, largeText:boolean, highContrast:boolean, setupCompleted:boolean}>} partial
 */
function setUserPrefs(partial) {
  const username = getCurrentUsername();

  if (!username) {
    if (partial.language !== undefined) localStorage.setItem("app_language", partial.language);
    if (partial.largeText !== undefined) localStorage.setItem("a11y_large_font", String(partial.largeText));
    if (partial.highContrast !== undefined) localStorage.setItem("a11y_high_contrast", String(partial.highContrast));
    return;
  }

  const users = getRegisteredUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx === -1) return; // 비정상 상태(로그인은 됐는데 계정 레코드가 없음) — 조용히 무시

  users[idx].prefs = { ...DEFAULT_USER_PREFS, ...(users[idx].prefs || {}), ...partial };
  saveRegisteredUsers(users);

  // accessibility.js는 <head>에서 이 파일보다 먼저 실행되며 레거시 전역 키를 읽으므로,
  // 다음 페이지 이동 시에도 깜빡임 없이 바로 적용되도록 전역 키도 함께 미러링해둔다.
  if (partial.language !== undefined) localStorage.setItem("app_language", partial.language);
  if (partial.largeText !== undefined) localStorage.setItem("a11y_large_font", String(partial.largeText));
  if (partial.highContrast !== undefined) localStorage.setItem("a11y_high_contrast", String(partial.highContrast));
}

/** 계정별 html 클래스(a11y-large-font / a11y-high-contrast)를 현재 설정대로 다시 적용 */
function applyA11yClasses() {
  const prefs = getUserPrefs();
  document.documentElement.classList.toggle("a11y-large-font", !!prefs.largeText);
  document.documentElement.classList.toggle("a11y-high-contrast", !!prefs.highContrast);
}
