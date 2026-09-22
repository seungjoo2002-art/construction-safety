// ============================================================
// chatbot.js — AI 안전 어시스턴트 (실제 백엔드 EXAONE/Gemini 연동)
// ------------------------------------------------------------
// 이전 버전은 규칙 기반(키워드 매칭)으로만 동작했지만, 이제 api.js의
// chatWithAI()를 통해 실제 백엔드(/api/chat → EXAONE 로컬 모델 또는
// Gemini, Backend/app.py 참고)를 호출합니다.
//
// - 현재 현장의 분석 결과(위험도/사고유형, 유사도 분석)가 있으면 context로
//   함께 보내 챗봇이 참고하게 합니다. 없으면 절대 지어내지 않고 그냥 생략합니다.
// - 현재 앱 언어(getLanguage())를 매 요청마다 locale로 함께 보내 그 언어로
//   답하도록 요청합니다(app.py가 system prompt에 반영).
// - 응답 생성 중에는 "답변을 생성하고 있습니다..." 로딩 표시를 보여주고,
//   백엔드 연결이 실패하면 mock 답변을 정상 답변처럼 보여주지 않고
//   "현재 AI 연결이 원활하지 않습니다..." 라고 명확히 표시합니다.
//
// constants.js, weather.js, mock-cases.js, session-store.js, api.js, i18n.js
// 보다 나중에 로드되어야 합니다.
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  const messagesEl = document.getElementById("chat-messages");
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send-btn");
  const quickReplyRow = document.getElementById("quick-reply-row");
  const scrollArea = document.getElementById("chat-scroll-area");

  // 백엔드에 보낼 대화 이력 (api.js의 chatWithAI 형식: {role: "user"|"model", text})
  let history = [];

  function renderDate() {
    document.getElementById("chat-date").textContent = new Date().toLocaleDateString(
      getLanguage() === "ko" ? "ko-KR" : getLanguage(),
      { year: "numeric", month: "long", day: "numeric" }
    );
  }
  renderDate();

  function scrollToBottom() {
    scrollArea.scrollTop = scrollArea.scrollHeight;
  }

  function appendBubble(role, text, { typing = false, isError = false } = {}) {
    const row = document.createElement("div");
    row.className = `chat-msg-row${role === "user" ? " is-user" : ""}`;
    const time = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

    row.innerHTML = `
      ${role === "model" ? `<img src="../../pictures/logo.png" class="chat-msg-row__avatar" alt="">` : ""}
      <div class="chat-bubble-col">
        <div class="chat-bubble is-${role === "user" ? "user" : "bot"}${typing ? " is-typing" : ""}${isError ? " is-error" : ""}">${text}</div>
        ${typing ? "" : `<span class="chat-msg-time">${time}</span>`}
      </div>
    `;
    messagesEl.appendChild(row);
    scrollToBottom();
    return row;
  }

  function renderQuickReplies() {
    const QUICK_REPLIES = [
      t("chatbot.quick1"),
      t("chatbot.quick2"),
      t("chatbot.quick3"),
      t("chatbot.quick4"),
    ];
    quickReplyRow.innerHTML = QUICK_REPLIES.map(
      (q) => `<button type="button" class="quick-reply-chip">${escapeHtml(q)}</button>`
    ).join("");
  }

  quickReplyRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".quick-reply-chip");
    if (!btn) return;
    sendMessage(btn.textContent);
  });

  // ── 현재 화면에서 참고할 수 있는 "실제" 데이터만 context로 구성 (지어내지 않음)
  function buildContext() {
    const context = {};
    const lastResult = typeof getLastPredictResult === "function" ? getLastPredictResult() : null;
    const lastSimilarity = typeof getLastSimilarity === "function" ? getLastSimilarity() : null;
    if (lastResult) context.last_risk_analysis = lastResult;
    if (lastSimilarity && lastSimilarity.similar_cases) {
      context.last_similar_cases = lastSimilarity.similar_cases.slice(0, 3);
    }
    return Object.keys(context).length > 0 ? context : null;
  }

  async function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    appendBubble("user", escapeHtml(trimmed));
    input.value = "";
    sendBtn.disabled = true;

    const typingRow = appendBubble("model", escapeHtml(t("chatbot.generating")), { typing: true });
    // 로컬 EXAONE(CPU)은 답변 생성에 1~3분 걸릴 수 있다 — 8초 넘게 기다리는 중이면
    // "느린 게 아니라 멈춘 것"으로 오해하지 않도록 안내 문구를 덧붙인다.
    const slowHintTimer = setTimeout(() => {
      const bubble = typingRow.querySelector(".chat-bubble");
      if (bubble) bubble.textContent = t("chatbot.generatingSlow");
    }, 8000);

    try {
      const reply = await chatWithAI(trimmed, history, buildContext(), getLanguage());
      typingRow.remove();
      appendBubble("model", escapeHtml(reply));
      history.push({ role: "user", text: trimmed });
      history.push({ role: "model", text: reply });
      // 이력이 너무 길어지면(=요청 페이로드/토큰 낭비) 최근 10턴(20개)만 유지
      if (history.length > 20) history = history.slice(-20);
    } catch (err) {
      console.error("[chatbot.js] /api/chat 호출 실패:", err);
      typingRow.remove();
      // 타임아웃(응답이 너무 오래 걸려 중단됨)과 그 외 연결 실패를 구분해서 보여준다 —
      // 로컬 EXAONE(CPU)은 /api/advise와 모델을 공유해서, 방금 위험도 분석을 했다면
      // 그 생성이 끝날 때까지 챗봇 요청이 대기열에 걸려 타임아웃 날 수 있다.
      const msg = err.isTimeout ? t("chatbot.timeoutError") : t("chatbot.connectionError");
      appendBubble("model", escapeHtml(msg), { isError: true });
      // 실패한 턴은 이력에 남기지 않는다 — 다음 요청에서 다시 자연스럽게 이어지도록
    } finally {
      clearTimeout(slowHintTimer);
      sendBtn.disabled = false;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  sendBtn.addEventListener("click", () => sendMessage(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage(input.value);
  });

  document.getElementById("reset-chat-btn").addEventListener("click", () => {
    if (!confirm(t("chatbot.resetConfirm"))) return;
    messagesEl.innerHTML = "";
    history = [];
    showGreeting();
  });

  function showGreeting() {
    appendBubble("model", escapeHtml(t("chatbot.greeting")).replace(/\n/g, "<br>"));
  }

  renderQuickReplies();
  showGreeting();

  // 언어가 바뀌면 날짜 표기/빠른답장 버튼을 다시 그린다.
  // (이미 나눈 대화 내용은 그 시점 언어 그대로 남아있는 게 자연스러워 다시 번역하지 않는다.)
  document.addEventListener("i18n:change", () => {
    renderDate();
    renderQuickReplies();
  });
});
