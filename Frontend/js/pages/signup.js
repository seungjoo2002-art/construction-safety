// ============================================================
// signup.js — 회원가입 화면 전용 로직
// 서버 DB가 없어서 localStorage의 "registered_users" 배열에
// 계정 목록을 저장하는 방식으로 구현합니다.
// ============================================================

const REGISTERED_USERS_KEY = "registered_users";

function getRegisteredUsers() {
  const raw = localStorage.getItem(REGISTERED_USERS_KEY);
  return raw ? JSON.parse(raw) : [];
}

function saveRegisteredUsers(users) {
  localStorage.setItem(REGISTERED_USERS_KEY, JSON.stringify(users));
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("signup-form");
  const usernameInput = document.getElementById("signup-username");
  const passwordInput = document.getElementById("signup-password");
  const passwordConfirmInput = document.getElementById("signup-password-confirm");
  const nameInput = document.getElementById("signup-name");
  const nicknameInput = document.getElementById("signup-nickname");
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
    const nickname = nicknameInput.value.trim();
    const birthdate = birthdateInput.value;

    if (!username || !password || !passwordConfirm || !name || !nickname || !birthdate) {
      showError("모든 항목을 입력해주세요.");
      return;
    }

    if (password !== passwordConfirm) {
      showError("비밀번호와 비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    const users = getRegisteredUsers();
    if (users.some((u) => u.username === username)) {
      showError("이미 존재하는 아이디입니다.");
      return;
    }

    users.push({ username, password, name, nickname, birthdate });
    saveRegisteredUsers(users);

    alert("회원가입이 완료되었습니다. 로그인해주세요.");
    window.location.href = "login.html";
  });
});
