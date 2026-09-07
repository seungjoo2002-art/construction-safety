// ============================================================
// profile.js — 내 정보 화면
// session-store.js 보다 나중에 로드되어야 합니다.
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  renderIdentity();
  renderStats();
  renderLanguageSelect();
  renderAccessibilityToggles();
  renderNotificationToggles();
  bindPlaceholderLinks();
  bindLogout();
});

// ── 이름/현장/D-day: 로그인·현장설정에서 실제로 저장된 값 사용
function renderIdentity() {
  const loggedInUsername = localStorage.getItem("logged_in_username");
  const registeredUsers = JSON.parse(localStorage.getItem("registered_users") || "[]");
  const account = registeredUsers.find((u) => u.username === loggedInUsername);

  const displayName = account ? account.name : localStorage.getItem("saved_username");
  document.getElementById("profile-name").textContent = displayName || "사용자";

  const siteSetup = hasSiteSetup() ? getSiteSetup() : null;
  const subEl = document.getElementById("profile-sub");
  const ddayEl = document.getElementById("profile-dday");

  if (siteSetup && siteSetup["공사시작일"]) {
    // 현재 site-setup에는 "현장명/직책" 필드가 없어서, 안전관리계획 정보로 대체 표기
    subEl.textContent = `${siteSetup["공공/민간 구분"] || ""} 현장 · 안전관리자`.trim();

    const start = new Date(siteSetup["공사시작일"]);
    const today = new Date();
    const dday = Math.floor((today - start) / (1000 * 60 * 60 * 24));
    ddayEl.textContent = `📅 D+${Math.max(dday, 0)}일`;
  } else {
    subEl.textContent = "현장 정보가 없어요 — 현장 설정을 먼저 완료해주세요";
    ddayEl.textContent = "📅 D+-";
  }
}

// ── 통계: localStorage에 실제 저장된 분석기록 기반으로 계산
function renderStats() {
  const savedResults = JSON.parse(localStorage.getItem("saved_results") || "[]");
  const savedPhotoResults = JSON.parse(localStorage.getItem("saved_photo_results") || "[]");

  const analysisCount = savedResults.length + savedPhotoResults.length;

  const severityHazardCount = savedResults.filter((r) =>
    ["위험", "매우위험"].includes(r.grade)
  ).length;
  const photoHazardCount = savedPhotoResults.reduce(
    (sum, p) => sum + (p.result?.hazards?.length || 0),
    0
  );
  const hazardCount = severityHazardCount + photoHazardCount;

  document.getElementById("stat-analysis-count").textContent = analysisCount;
  document.getElementById("stat-hazard-count").textContent = hazardCount;

  // 간단한 안전등급 산출 (평균 위험점수 기반) — 정식 산정 기준은 아니고 참고용 표시입니다.
  if (savedResults.length === 0) {
    document.getElementById("stat-grade").textContent = "-";
  } else {
    const avgScore = savedResults.reduce((sum, r) => sum + r.score, 0) / savedResults.length;
    let grade = "C";
    if (avgScore < 30) grade = "A+";
    else if (avgScore < 50) grade = "B+";
    else if (avgScore < 70) grade = "B";
    document.getElementById("stat-grade").textContent = grade;
  }
}

// ── 언어 설정 (선택 상태만 저장 — 실제 다국어 번역은 아직 미구현)
const LANGUAGE_OPTIONS = [
  { code: "ko", label: "🇰🇷 한국어" },
  { code: "en", label: "🇺🇸 English" },
  { code: "zh", label: "🇨🇳 中文" },
  { code: "vi", label: "🇻🇳 Tiếng Việt" },
];

function renderLanguageSelect() {
  const container = document.getElementById("language-select");
  const current = localStorage.getItem("app_language") || "ko";

  container.innerHTML = LANGUAGE_OPTIONS.map(
    (l) => `<button type="button" class="button-select__option${l.code === current ? " is-selected" : ""}" data-code="${l.code}">${l.label}</button>`
  ).join("");

  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".button-select__option");
    if (!btn) return;
    container.querySelectorAll(".button-select__option").forEach((b) => b.classList.remove("is-selected"));
    btn.classList.add("is-selected");
    localStorage.setItem("app_language", btn.dataset.code);
    // TODO: 실제 다국어 지원 시 여기서 i18n 텍스트 전체를 다시 렌더링해야 함
  });
}

// ── 접근성 설정 (즉시 적용 + localStorage 저장 → 다음 페이지부터 accessibility.js가 자동 적용)
function renderAccessibilityToggles() {
  const largeFontToggle = document.getElementById("toggle-large-font");
  const highContrastToggle = document.getElementById("toggle-high-contrast");

  largeFontToggle.checked = localStorage.getItem("a11y_large_font") === "true";
  highContrastToggle.checked = localStorage.getItem("a11y_high_contrast") === "true";

  largeFontToggle.addEventListener("change", () => {
    localStorage.setItem("a11y_large_font", largeFontToggle.checked);
    document.documentElement.classList.toggle("a11y-large-font", largeFontToggle.checked);
  });

  highContrastToggle.addEventListener("change", () => {
    localStorage.setItem("a11y_high_contrast", highContrastToggle.checked);
    document.documentElement.classList.toggle("a11y-high-contrast", highContrastToggle.checked);
  });
}

// ── 알림 설정 (notif_prefs.push가 true면 notifications-realtime.js가 실제 브라우저 알림을 띄움)
function renderNotificationToggles() {
  const prefs = JSON.parse(
    localStorage.getItem("notif_prefs") || '{"push":true,"alert":true}'
  );

  const map = {
    "toggle-notif-push": "push",
    "toggle-notif-alert": "alert",
  };

  Object.entries(map).forEach(([id, key]) => {
    const el = document.getElementById(id);
    el.checked = !!prefs[key];
    el.addEventListener("change", async () => {
      // ── "푸시 알림"을 켜는 순간에는 브라우저 알림 권한이 있어야 실제로 알림이 뜨므로 먼저 요청
      if (key === "push" && el.checked) {
        const permission = await requestNotificationPermission();
        if (permission !== "granted") {
          el.checked = false;
          alert("브라우저 알림 권한이 필요해요");
          return;
        }
      }

      prefs[key] = el.checked;
      localStorage.setItem("notif_prefs", JSON.stringify(prefs));
    });
  });
}

// ── 준비 중인 메뉴(안전인증관리/앱평가/고객지원)
function bindPlaceholderLinks() {
  document.querySelectorAll(".settings-link-row").forEach((row) => {
    row.addEventListener("click", () => {
      alert(`"${row.dataset.name}" 기능은 아직 준비 중이에요.`);
    });
  });
}

// ── 로그아웃 (저장된 아이디/현장정보 등 로컬 데이터 정리 후 로그인 화면으로)
function bindLogout() {
  document.getElementById("logout-btn").addEventListener("click", () => {
    if (!confirm("로그아웃 하시겠어요?")) return;
    clearSiteSetup();
    window.location.href = "login.html";
  });
}