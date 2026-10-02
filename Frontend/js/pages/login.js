// ============================================================
// login.js — 로그인 화면 전용 로직
// 서버(/api/auth/login)가 비밀번호를 검증하고 세션 토큰을 발급합니다(auth.js).
// auth.js, user-prefs.js, i18n.js 보다 나중에 로드되어야 합니다.
//
// 예전 버전 계정 이전: 예전에는 계정이 이 브라우저 localStorage("registered_users")에만
// 있었다. 서버에 없는 아이디인데 이 브라우저의 예전 계정 정보(아이디+비밀번호)와 정확히
// 일치하면, 같은 아이디/비밀번호로 서버 계정을 만들고 그 계정 "전용" 키였던
// site_setup_data__<아이디>만 옮긴다. 계정 구분 없이 저장돼 있던 분석기록
// (saved_results / saved_photo_results)은 소유자를 확정할 수 없으므로 옮기지 않는다.
// ============================================================

function _readLegacyAccount(username, password) {
  try {
    const users = JSON.parse(localStorage.getItem("registered_users") || "[]");
    return users.find((u) => u.username === username && u.password === password) || null;
  } catch (e) {
    return null;
  }
}

async function _migrateLegacyAccount(legacy, password) {
  await signupUser({
    username: legacy.username,
    password,
    name: legacy.name || "",
    birthdate: legacy.birthdate || "",
    prefs: legacy.prefs || {},
  });
  await loginUser(legacy.username, password);
  try {
    const raw = localStorage.getItem(`site_setup_data__${legacy.username}`);
    if (raw) await saveSiteSetup(JSON.parse(raw)); // 서버가 setupCompleted=true로 기록 + 캐시 갱신
  } catch (err) {
    console.warn("[login.js] 예전 현장정보 이전 실패(새로 입력하면 됩니다)", err);
  }
  return getCachedUser();
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
  const submitLabel = submitBtn.textContent;

  if (typeof wakeBackend === "function") wakeBackend();

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
  form.addEventListener("submit", async (e) => {
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

    let user;
    try {
      user = await loginUser(username, password);
    } catch (err) {
      const legacy = err.status === 401 ? _readLegacyAccount(username, password) : null;
      if (legacy) {
        try {
          user = await _migrateLegacyAccount(legacy, password);
        } catch (migErr) {
          console.error("[login.js] 예전 계정 이전 실패", migErr);
        }
      }
      if (!user) {
        submitBtn.disabled = false;
        submitBtn.textContent = submitLabel;
        showError(
          err.status === 401
            ? t("login.errorWrongPassword")
            : `${err.message} (${err.kind === "timeout" ? "서버가 깨어나는 중일 수 있어요. 잠시 후 다시 시도해주세요." : "네트워크 상태를 확인해주세요."})`
        );
        return;
      }
    }

    if (rememberCheckbox.checked) {
      localStorage.setItem("saved_username", username);
    } else {
      localStorage.removeItem("saved_username");
    }

    // 로그인 성공 시: 이 계정이 이미 현장 설정을 마쳤으면 대시보드로, 아니면 현장 설정 화면으로.
    window.location.href = user.prefs && user.prefs.setupCompleted ? "dashboard.html" : "site-setup.html";
  });

  ssoBtn.addEventListener("click", () => {
    alert(t("login.ssoNotReady"));
  });
});
