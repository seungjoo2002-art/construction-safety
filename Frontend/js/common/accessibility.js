// ============================================================
// accessibility.js — 저장된 접근성 설정을 페이지 로드 시 즉시 적용
// 모든 HTML의 <head>에서 다른 CSS/JS보다 먼저 로드되어야
// 화면이 잠깐 깜빡이지 않습니다. profile.html에서 설정을 바꿉니다.
// ============================================================
(function () {
  try {
    if (localStorage.getItem("a11y_large_font") === "true") {
      document.documentElement.classList.add("a11y-large-font");
    }
    if (localStorage.getItem("a11y_high_contrast") === "true") {
      document.documentElement.classList.add("a11y-high-contrast");
    }
  } catch (e) {
    /* localStorage 접근 불가 환경이면 조용히 무시 (기본 스타일로 표시됨) */
  }
})();