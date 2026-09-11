// ============================================================
// login.js — 로그인 화면 전용 로직
// 서버 DB가 없어서 signup.js가 localStorage의 "registered_users"에
// 저장해둔 계정 목록과 대조하는 방식으로 로그인을 검증합니다.
// session-store.js 보다 나중에 로드되어야 합니다.
// ============================================================

const REGISTERED_USERS_KEY = "registered_users";

function getRegisteredUsers() {
  const raw = localStorage.getItem(REGISTERED_USERS_KEY);
  return raw ? JSON.parse(raw) : [];
}

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
      showError("아이디와 비밀번호를 모두 입력해주세요.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "로그인 중...";

    const users = getRegisteredUsers();
    const account = users.find((u) => u.username === username);

    if (!account) {
      alert("가입되지 않은 아이디입니다. 회원가입을 먼저 진행해주세요.");
      window.location.href = "signup.html";
      return;
    }

    if (account.password !== password) {
      alert("아이디 또는 비밀번호가 일치하지 않습니다. 처음부터 다시 입력해주세요.");
      window.location.href = "signup.html";
      return;
    }

    if (rememberCheckbox.checked) {
      localStorage.setItem("saved_username", username);
    } else {
      localStorage.removeItem("saved_username");
    }

    localStorage.setItem("logged_in_username", username);

    // 로그인 성공 시 현장 설정을 이미 마쳤으면 대시보드로, 아니면 현장 설정 화면으로 이동
    window.location.href = hasSiteSetup() ? "dashboard.html" : "site-setup.html";
  });

  ssoBtn.addEventListener("click", () => {
    alert("SSO 로그인은 아직 준비 중입니다.");
  });
});