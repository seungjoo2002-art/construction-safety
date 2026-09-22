// ============================================================
// profile.js — 내 정보 화면
// session-store.js, user-prefs.js, i18n.js 보다 나중에 로드되어야 합니다.
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  renderIdentity();
  renderStats();
  renderLanguageSelect();
  renderAccessibilityToggles();
  renderNotificationToggles();
  bindPlaceholderLinks();
  bindLogout();

  // 언어가 바뀌면(이 페이지든 다른 페이지에서든) 동적으로 그린 텍스트도 다시 그린다.
  document.addEventListener("i18n:change", () => {
    renderIdentity();
    renderStats();
  });
});

// ── 이름/현장/D-day: 로그인·현장설정에서 실제로 저장된 값 사용
function renderIdentity() {
  const loggedInUsername = localStorage.getItem("logged_in_username");
  const registeredUsers = JSON.parse(localStorage.getItem("registered_users") || "[]");
  const account = registeredUsers.find((u) => u.username === loggedInUsername);

  const displayName = account ? account.name : localStorage.getItem("saved_username");
  document.getElementById("profile-name").textContent = displayName || t("profile.defaultName");

  const siteSetup = hasSiteSetup() ? getSiteSetup() : null;
  const subEl = document.getElementById("profile-sub");
  const ddayEl = document.getElementById("profile-dday");

  if (siteSetup && siteSetup["공사시작일"]) {
    // 현재 site-setup에는 "현장명/직책" 필드가 없어서, 안전관리계획 정보로 대체 표기
    const pubPrivate = tStatus(siteSetup["공공/민간 구분"] || "");
    subEl.textContent = `${pubPrivate} ${t("profile.siteManagerSuffix")}`.trim();

    const start = new Date(siteSetup["공사시작일"]);
    const today = new Date();
    const dday = Math.floor((today - start) / (1000 * 60 * 60 * 24));
    ddayEl.textContent = `📅 D+${Math.max(dday, 0)}${t("common.daysUnit")}`;
  } else {
    subEl.textContent = t("profile.noSiteInfo");
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

// ── 언어 설정 (i18n.js — 7개 언어, 선택 즉시 앱 전체에 반영 + 계정별 저장)
const LANGUAGE_OPTIONS = [
  { code: "ko", label: "🇰🇷 한국어" },
  { code: "en", label: "🇺🇸 English" },
  { code: "ja", label: "🇯🇵 日本語" },
  { code: "zh", label: "🇨🇳 中文" },
  { code: "vi", label: "🇻🇳 Tiếng Việt" },
  { code: "th", label: "🇹🇭 ภาษาไทย" },
  { code: "id", label: "🇮🇩 Bahasa Indonesia" },
  { code: "ne", label: "🇳🇵 नेपाली" },
];

function renderLanguageSelect() {
  const container = document.getElementById("language-select");
  const current = getLanguage();

  container.setAttribute("data-cols", "2");
  container.innerHTML = LANGUAGE_OPTIONS.map(
    (l) => `<button type="button" class="button-select__option${l.code === current ? " is-selected" : ""}" data-code="${l.code}">${l.label}</button>`
  ).join("");

  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".button-select__option");
    if (!btn) return;
    container.querySelectorAll(".button-select__option").forEach((b) => b.classList.remove("is-selected"));
    btn.classList.add("is-selected");
    setLanguage(btn.dataset.code); // 저장 + 이 페이지 즉시 재적용 + i18n:change 이벤트 발행
  });
}

// ── 접근성 설정 (즉시 적용 + 계정별 저장 → 다음 페이지부터 accessibility.js가 자동 적용)
function renderAccessibilityToggles() {
  const largeFontToggle = document.getElementById("toggle-large-font");
  const highContrastToggle = document.getElementById("toggle-high-contrast");
  const prefs = getUserPrefs();

  largeFontToggle.checked = !!prefs.largeText;
  highContrastToggle.checked = !!prefs.highContrast;

  largeFontToggle.addEventListener("change", () => {
    setUserPrefs({ largeText: largeFontToggle.checked });
    applyA11yClasses();
  });

  highContrastToggle.addEventListener("change", () => {
    setUserPrefs({ highContrast: highContrastToggle.checked });
    applyA11yClasses();
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
          alert(t("profile.notifPermissionNeeded"));
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
      const name = row.dataset.i18nName ? t(row.dataset.i18nName) : row.dataset.name;
      alert(t("profile.placeholderAlert", { name }));
    });
  });
}

// ── 로그아웃
// ⚠️ 예전 구현은 여기서 clearSiteSetup()을 호출해 "현장 설정 완료 여부"까지 지워버렸고,
// 그래서 같은 계정으로 재로그인해도 site-setup 마법사가 매번 다시 떴습니다.
// 로그아웃은 "인증 세션(logged_in_username)"만 끝내야 하고, 계정에 귀속된 설정
// (site-setup 데이터, 언어, 접근성)은 registered_users에 그대로 남아있어야 합니다.
function bindLogout() {
  document.getElementById("logout-btn").addEventListener("click", () => {
    if (!confirm(t("profile.logoutConfirm"))) return;
    localStorage.removeItem("logged_in_username");
    window.location.href = "login.html";
  });
}
