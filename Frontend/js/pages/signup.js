// ============================================================
// signup.js — 회원가입 화면 전용 로직
// 계정은 서버 DB(/api/auth/signup)에 만들어집니다 — 비밀번호는 서버에서 해시로만 저장.
// auth.js, user-prefs.js, i18n.js 보다 나중에 로드되어야 합니다.
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

  form.addEventListener("submit", async (e) => {
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

    submitBtn.disabled = true;
    try {
      // prefs: 가입 시점에 이미 골라둔(비로그인 guest 상태) 언어를 이어받는다.
      // setupCompleted는 서버가 항상 false로 시작 — 신규 가입자는 site-setup을 한 번은 거친다.
      await signupUser({ username, password, name, birthdate, prefs: { language: getLanguage() } });
    } catch (err) {
      submitBtn.disabled = false;
      showError(err.status === 409 ? t("signup.errorDuplicate") : err.message);
      return;
    }

    alert(t("signup.success"));
    window.location.href = "login.html";
  });
});
