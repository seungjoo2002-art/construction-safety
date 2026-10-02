// ============================================================
// auth.js — 서버 인증 세션 + 사용자 데이터 API 호출 공통 계층
// 모든 HTML에서 accessibility.js, env.js 바로 다음(다른 공통 JS보다 먼저)에 로드합니다.
//
// 계정·분석기록·사진분석기록·알림 상태·현장정보는 이제 브라우저가 아니라 백엔드 DB에
// 사용자(user_id)별로 저장됩니다(Backend/user_api.py). 브라우저에는 다음 두 개만 남습니다.
//   - auth_token : 서버가 발급한 세션 토큰 (요청마다 Authorization: Bearer 로 전송)
//   - auth_user  : 현재 로그인 사용자의 /api/me 응답 사본(이름·언어·접근성 설정 등) —
//                  <head>에서 동기적으로 언어/접근성을 적용하기 위한 캐시일 뿐, 데이터의 원본이 아님.
// 다른 사용자의 데이터는 서버가 애초에 내려주지 않으므로, 이 캐시를 조작해도 볼 수 없습니다.
// ============================================================

const AUTH_API_BASE = (
  (window.APP_CONFIG && window.APP_CONFIG.BACKEND_API_BASE_URL) || "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const AUTH_TOKEN_KEY = "auth_token";
const AUTH_USER_KEY = "auth_user";
const AUTH_PUBLIC_PAGES = ["login.html", "signup.html", "offline.html", "Qr-generator.html"];

class AuthApiError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.name = "AuthApiError";
    this.kind = kind; // timeout | network | auth | client | server
    this.status = status || null;
  }
}

function _isPublicPage() {
  const page = window.location.pathname.split("/").pop() || "";
  return AUTH_PUBLIC_PAGES.includes(page);
}

function getAuthToken() {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch (e) {
    return null;
  }
}

/** 현재 로그인 사용자 캐시({id, username, name, prefs}) — 없으면 null */
function getCachedUser() {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function setCachedUser(user) {
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

/**
 * 계정 종속 브라우저 데이터 정리 — 로그아웃/세션 만료/다른 계정 로그인 직전에 호출.
 * (보안의 기본은 서버 격리이고, 이건 화면에 이전 사용자의 흔적이 남지 않게 하는 보조 조치)
 * 예전 버전이 남긴 계정 무관 레거시 키(saved_results 등)는 실제 사용자 데이터일 수 있어
 * 지우지 않는다 — 대신 어떤 코드도 더 이상 읽지 않는다.
 */
function clearUserScopedClientData() {
  try {
    [AUTH_TOKEN_KEY, AUTH_USER_KEY, "logged_in_username"].forEach((k) =>
      localStorage.removeItem(k)
    );
    sessionStorage.clear(); // 방금 분석한 결과/촬영 사진/유사도 결과 등 화면 간 임시 전달값
  } catch (e) {
    /* 저장소 접근 불가 환경 — 무시 */
  }
  try {
    // 사례 검색 오프라인 캐시(IndexedDB) — 공개 데이터지만 이전 사용자의 검색 흔적이므로 비운다
    if ("indexedDB" in window) indexedDB.deleteDatabase("ai-safety-app");
  } catch (e) {
    /* 무시 */
  }
}

function redirectToLogin() {
  clearUserScopedClientData();
  if (!_isPublicPage()) window.location.replace("login.html");
}

/**
 * 인증이 필요한 백엔드 호출. 401이면 세션을 정리하고 로그인 화면으로 보낸다.
 * @returns 응답 JSON (204면 null)
 */
async function authRequest(method, path, body, timeoutMs = 120000) {
  const token = getAuthToken();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(`${AUTH_API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new AuthApiError("timeout", `서버 응답이 ${Math.round(timeoutMs / 1000)}초 안에 오지 않았어요.`);
    }
    throw new AuthApiError("network", "백엔드 서버에 연결할 수 없어요.");
  }

  if (res.status === 401 && path !== "/api/auth/login") {
    redirectToLogin();
    throw new AuthApiError("auth", "로그인이 필요합니다", 401);
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).detail || "";
    } catch (_) {
      /* JSON 아님 */
    }
    throw new AuthApiError(res.status < 500 ? "client" : "server", detail || `서버 오류 (${res.status})`, res.status);
  }
  return res.status === 204 ? null : res.json();
}

async function loginUser(username, password) {
  const data = await authRequest("POST", "/api/auth/login", { username, password });
  clearUserScopedClientData(); // 이전 계정의 흔적을 지운 뒤 새 세션 저장
  localStorage.setItem(AUTH_TOKEN_KEY, data.token);
  setCachedUser(data.user);
  return data.user;
}

async function signupUser(fields) {
  return (await authRequest("POST", "/api/auth/signup", fields)).user;
}

async function logoutUser() {
  try {
    await authRequest("POST", "/api/auth/logout", undefined, 15000);
  } catch (err) {
    console.warn("[auth.js] 서버 로그아웃 실패(토큰은 브라우저에서 삭제합니다)", err);
  }
  clearUserScopedClientData();
}

/** 서버 기준 현재 사용자로 캐시를 갱신 (페이지마다 1회). */
async function refreshCurrentUser() {
  const data = await authRequest("GET", "/api/me");
  setCachedUser(data.user);
  return data.user;
}

// ── 페이지 가드: 로그인 안 된 상태로 보호 화면에 들어오면 즉시 로그인 화면으로
if (!_isPublicPage() && !getAuthToken()) {
  redirectToLogin();
}

// 보호 화면은 서버에 세션이 유효한지 확인(만료/폐기된 토큰이면 authRequest가 로그인 화면으로 보냄)
window.authReady = _isPublicPage() || !getAuthToken()
  ? Promise.resolve(getCachedUser())
  : refreshCurrentUser().catch((err) => {
      console.warn("[auth.js] 사용자 정보 갱신 실패", err);
      return getCachedUser();
    });
