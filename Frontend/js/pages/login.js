// ============================================================
// login.js — 로그인 화면 전용 로직
// 서버 DB가 없어서 signup.js가 localStorage의 "registered_users"에
// 저장해둔 계정 목록과 대조하는 방식으로 로그인을 검증합니다.
// session-store.js, user-prefs.js, i18n.js 보다 나중에 로드되어야 합니다.
// (REGISTERED_USERS_KEY / getRegisteredUsers()는 user-prefs.js에 정의되어 있습니다 —
//  여기서 다시 선언하면 로그인 여부와 무관하게 계정 목록이 어긋날 수 있어 공유합니다.)
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("login-form");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const toggleBtn = document.getElementById("toggle-password");
  const errorEl = document.getElementById("login-error");
  const submitBtn = document.getElementById("login-submit");
  const rememberCheckbox = document.getElementById("remember-id");
  const ssoBtn = document.getElementById("sso-btn");

  // ── 아이디 저장 기능: 이전에 저장해둔 아이디가 있으면 채워넣기
  const savedId = localStorage.getItem("saved_username");
  if (savedId) {
    usernameInput.value = savedId;
    rememberCheckbox.checked = true;
  }

  // ── 비밀번호 표시/숨기기 토글
  toggleBtn.addEventListener("click", () => {
    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";
    toggleBtn.setAttribute("aria-pressed", String(isPassword));
    toggleBtn.style.opacity = isPassword ? "1" : "0.6";
  });

  function showError(message) {
    errorEl.textContent = message;
    errorEl.style.display = "block";
  }

  function clearError() {
    errorEl.style.display = "none";
    errorEl.textContent = "";
  }

  // ── 폼 제출
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearError();

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
      showError(t("login.errorEmpty"));
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = t("login.loggingIn");

    const users = getRegisteredUsers();
    const account = users.find((u) => u.username === username);

    if (!account) {
      alert(t("login.errorNoAccount"));
      window.location.href = "signup.html";
      return;
    }

    if (account.password !== password) {
      alert(t("login.errorWrongPassword"));
      window.location.href = "signup.html";
      return;
    }

    if (rememberCheckbox.checked) {
      localStorage.setItem("saved_username", username);
    } else {
      localStorage.removeItem("saved_username");
    }

    localStorage.setItem("logged_in_username", username);

    // 로그인 성공 시: 이 계정이 이미 현장 설정(setupCompleted)을 마쳤으면 대시보드로,
    // 아니면(신규 가입 직후 등) 현장 설정 화면으로 이동. getUserPrefs()는 계정 레코드에
    // 귀속된 값이라 로그아웃해도 지워지지 않는다 — 이게 site-setup 반복 버그의 수정 지점.
    window.location.href = getUserPrefs().setupCompleted ? "dashboard.html" : "site-setup.html";
  });

  ssoBtn.addEventListener("click", () => {
    alert(t("login.ssoNotReady"));
  });
});
