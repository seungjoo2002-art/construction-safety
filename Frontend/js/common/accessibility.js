// ============================================================
// accessibility.js — 저장된 접근성/언어 설정을 페이지 로드 시 즉시 적용
// 모든 HTML의 <head>에서 다른 CSS/JS보다 먼저 로드되어야 화면이 잠깐
// 깜빡이지 않습니다(FOUC 방지) — 그래서 user-prefs.js에 의존하지 않고
// 이 파일 안에서 registered_users를 직접 동기적으로 읽습니다.
// 실제 값 변경은 profile.html(user-prefs.js + i18n.js)에서 이뤄집니다.
// ============================================================
(function () {
  try {
    const username = localStorage.getItem("logged_in_username");
    let prefs = null;

    if (username) {
      const users = JSON.parse(localStorage.getItem("registered_users") || "[]");
      const account = users.find((u) => u.username === username);
      prefs = account && account.prefs;
    }

    const largeText = prefs && prefs.largeText !== undefined
      ? !!prefs.largeText
      : localStorage.getItem("a11y_large_font") === "true";
    const highContrast = prefs && prefs.highContrast !== undefined
      ? !!prefs.highContrast
      : localStorage.getItem("a11y_high_contrast") === "true";
    const language = (prefs && prefs.language) || localStorage.getItem("app_language") || "ko";

    document.documentElement.classList.toggle("a11y-large-font", largeText);
    document.documentElement.classList.toggle("a11y-high-contrast", highContrast);
    document.documentElement.setAttribute("lang", language);
  } catch (e) {
    /* localStorage 접근 불가 환경이면 조용히 무시 (기본 스타일/한국어로 표시됨) */
  }
})();
