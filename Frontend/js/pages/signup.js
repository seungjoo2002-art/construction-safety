// ============================================================
// signup.js — 회원가입 화면 전용 로직
// 서버 DB가 없어서 localStorage의 "registered_users" 배열에
// 계정 목록을 저장하는 방식으로 구현합니다.
// user-prefs.js, i18n.js 보다 나중에 로드되어야 합니다.
// (REGISTERED_USERS_KEY / getRegisteredUsers() / saveRegisteredUsers()는
//  user-prefs.js에 정의되어 있습니다 — 계정 저장소를 한 곳으로 유지하기 위함)
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("signup-form");
  const usernameInput = document.getElementById("signup-username");
  const passwordInput = document.getElementById("signup-password");
  const passwordConfirmInput = document.getElementById("signup-password-confirm");
  const nameInput = document.getElementById("signup-name");
  const birthdateInput = document.getElementById("signup-birthdate");
  const errorEl = document.getElementById("signup-error");
  const submitBtn = document.getElementById("signup-submit");

  function showError(message) {
    errorEl.textContent = message;
    errorEl.style.display = "block";
  }

  function clearError() {
    errorEl.style.display = "none";
    errorEl.textContent = "";
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearError();

    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const passwordConfirm = passwordConfirmInput.value;
    const name = nameInput.value.trim();
    const birthdate = birthdateInput.value;

    if (!username || !password || !passwordConfirm || !name || !birthdate) {
      showError(t("signup.errorEmpty"));
      return;
    }

    if (password !== passwordConfirm) {
      showError(t("signup.errorMismatch"));
      return;
    }

    const users = getRegisteredUsers();
    if (users.some((u) => u.username === username)) {
      showError(t("signup.errorDuplicate"));
      return;
    }

    // prefs: 가입 시점에 이미 골라둔(비로그인 guest 상태) 언어가 있으면 그대로 이어받는다.
    // setupCompleted는 반드시 false로 시작 — 신규 가입자는 site-setup을 한 번은 거쳐야 한다.
    users.push({
      username,
      password,
      name,
      birthdate,
      prefs: { language: getLanguage(), largeText: false, highContrast: false, setupCompleted: false },
    });
    saveRegisteredUsers(users);

    alert(t("signup.success"));
    window.location.href = "login.html";
  });
});
