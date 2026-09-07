// ============================================================
// chatbot.js — AI 안전 어시스턴트 (규칙 기반, 외부 LLM API 미사용)
// constants.js, weather.js, mock-cases.js, session-store.js 보다
// 나중에 로드되어야 합니다.
//
// 왜 외부 LLM 대신 규칙 기반으로 만들었나:
//  - Gemini/OpenAI 같은 외부 API는 키 발급·과금·서버 연결 등
//    변수가 많아서 발표 당일 갑자기 안 될 위험이 있음
//  - 대신 버튼(quick reply) 몇 개로 질문 범위를 좁히고,
//    이미 갖고 있는 실제 데이터(날씨/분석결과/예방수칙/사례)로
//    답변을 만들면 100% 로컬에서, 항상 안정적으로 동작함
// ============================================================

const QUICK_REPLIES = ["오늘 현장 위험도는?", "추락 예방 방법", "안전교육 일정", "사고 사례 검색"];

// 자유 텍스트 입력 시 사용할 키워드 → 사고유형 매핑 (constants.js의 ACCIDENT_TYPE_TIPS 재사용)
const KEYWORD_TO_TYPE = {
  "추락": "추락·압착(Falls)", "낙하": "추락·압착(Falls)", "떨어짐": "추락·압착(Falls)", "고소": "추락·압착(Falls)",
  "끼임": "끼임(Caught-in)", "협착": "끼임(Caught-in)",
  "절단": "절단·베임·찔림(Cut)", "베임": "절단·베임·찔림(Cut)", "찔림": "절단·베임·찔림(Cut)",
  "맞음": "물체에 맞음(Struck-by)", "낙하물": "물체에 맞음(Struck-by)",
  "전도": "전도·충돌(Trips/Struck-against)", "충돌": "전도·충돌(Trips/Struck-against)", "넘어짐": "전도·충돌(Trips/Struck-against)", "미끄러": "전도·충돌(Trips/Struck-against)",
};

document.addEventListener("DOMContentLoaded", () => {
  const messagesEl = document.getElementById("chat-messages");
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send-btn");
  const quickReplyRow = document.getElementById("quick-reply-row");
  const scrollArea = document.getElementById("chat-scroll-area");

  document.getElementById("chat-date").textContent = new Date().toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric",
  });

  function scrollToBottom() {
    scrollArea.scrollTop = scrollArea.scrollHeight;
  }

  function appendBubble(role, text, { typing = false } = {}) {
    const row = document.createElement("div");
    row.className = `chat-msg-row${role === "user" ? " is-user" : ""}`;
    const time = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

    row.innerHTML = `
      ${role === "model" ? `<img src="../../pictures/logo.png" class="chat-msg-row__avatar" alt="">` : ""}
      <div class="chat-bubble-col">
        <div class="chat-bubble is-${role === "user" ? "user" : "bot"}${typing ? " is-typing" : ""}">${text}</div>
        ${typing ? "" : `<span class="chat-msg-time">${time}</span>`}
      </div>
    `;
    messagesEl.appendChild(row);
    scrollToBottom();
    return row;
  }

  function renderQuickReplies() {
    quickReplyRow.innerHTML = QUICK_REPLIES.map(
      (q) => `<button type="button" class="quick-reply-chip">${q}</button>`
    ).join("");
  }

  quickReplyRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".quick-reply-chip");
    if (!btn) return;
    sendMessage(btn.textContent);
  });

  async function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    appendBubble("user", escapeHtml(trimmed));
    input.value = "";
    sendBtn.disabled = true;

    const typingRow = appendBubble("model", "입력 중...", { typing: true });
    const reply = await generateReply(trimmed);

    typingRow.remove();
    appendBubble("model", escapeHtml(reply));
    sendBtn.disabled = false;
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
    if (!confirm("대화 내용을 초기화할까요?")) return;
    messagesEl.innerHTML = "";
    showGreeting();
  });

  function showGreeting() {
    appendBubble(
      "model",
      "안녕하세요! 저는 AI 건설현장 안전관리 시스템의 AI 어시스턴트입니다. 😊\n\n현장 안전, 위험도 분석, 사고 예방에 관해 무엇이든 질문해 주세요!"
    );
  }

  renderQuickReplies();
  showGreeting();
});

// ============================================================
// 답변 생성 라우터 — 키워드로 의도를 판단해 알맞은 응답 함수 호출
// ============================================================
async function generateReply(message) {
  if (message.includes("위험도") || message.includes("위험 지수")) {
    return await respondRiskToday();
  }
  if (message.includes("교육") || message.includes("일정")) {
    return respondEducation();
  }
  if (message.includes("사례") || message.includes("검색") || message.includes("사고")) {
    return respondCaseSearch();
  }
  const hasPreventionKeyword = Object.keys(KEYWORD_TO_TYPE).some((kw) => message.includes(kw));
  if (hasPreventionKeyword || message.includes("예방") || message.includes("안전수칙")) {
    return respondPrevention(message);
  }
  return respondFallback();
}

// ── "오늘 현장 위험도는?" — 실제 최근 분석결과 + 실시간 날씨 조합
async function respondRiskToday() {
  const lastResultRaw = sessionStorage.getItem("predict_result");

  if (!lastResultRaw) {
    return "아직 위험도 분석 기록이 없어요. '위험도 분석' 탭에서 현장 정보를 입력하고 분석해보시면, 그 결과를 바탕으로 답변드릴 수 있어요.";
  }

  const result = JSON.parse(lastResultRaw);
  const fr = result.severity.fatal_risk;
  const topType = result.accident_type.predicted_type;
  const shortType = (typeof ACCIDENT_TYPE_SHORT_LABEL !== "undefined" && ACCIDENT_TYPE_SHORT_LABEL[topType]) || topType;

  let weatherLine = "";
  try {
    const { current } = await getWeatherSnapshot();
    weatherLine = `\n오늘 날씨는 ${current.description}, 기온 ${Math.round(current.temp)}°C, 풍속 ${current.windSpeed}m/s예요.`;
  } catch (err) {
    // 날씨 조회 실패해도 위험도 답변은 그대로 드림
  }

  const actionLine =
    fr.grade === "매우위험" || fr.grade === "위험"
      ? "\n\n⚠️ 즉각적인 안전점검을 권장드려요."
      : fr.grade === "주의"
      ? "\n\n평소보다 주의가 필요한 수준이에요."
      : "\n\n평소와 비슷한 수준이니 기본 안전수칙을 잘 지켜주세요.";

  return `최근 분석 기준, 현장의 종합 위험도는 ${Math.round(fr.percentile)}점으로 '${fr.grade}' 수준입니다.\n예측되는 주요 사고 유형은 '${shortType}'이에요.${weatherLine}${actionLine}`;
}

// ── 예방 수칙 — constants.js의 ACCIDENT_TYPE_TIPS 재사용
function respondPrevention(message) {
  let matchedType = null;
  for (const [kw, type] of Object.entries(KEYWORD_TO_TYPE)) {
    if (message.includes(kw)) {
      matchedType = type;
      break;
    }
  }
  if (!matchedType) matchedType = "추락·압착(Falls)"; // 기본값 (버튼 "추락 예방 방법" 클릭 시 등)

  const tips = (typeof ACCIDENT_TYPE_TIPS !== "undefined" && ACCIDENT_TYPE_TIPS[matchedType]) || [];
  const label = (typeof ACCIDENT_TYPE_SHORT_LABEL !== "undefined" && ACCIDENT_TYPE_SHORT_LABEL[matchedType]) || matchedType;

  if (tips.length === 0) {
    return "죄송해요, 해당 유형의 예방수칙을 아직 준비하지 못했어요.";
  }

  const tipLines = tips.map((t, i) => `${i + 1}. ${t.title} — ${t.desc}`).join("\n");
  return `${label} 예방을 위한 안전수칙이에요.\n\n${tipLines}`;
}

// ── 안전교육 일정 (⚠️ 실제 교육일정 연동 시스템 없음, 고정 예시)
function respondEducation() {
  return (
    "이번 주 목요일 오전 8시에 추락·낙하 예방 안전교육이 예정되어 있어요.\n\n" +
    "⚠️ 아직 실제 교육일정 관리 시스템과 연동되지 않아, 지금은 예시 정보예요. 정확한 일정은 안전관리자에게 확인해주세요."
  );
}

// ── 사고 사례 검색 — mock-cases.js의 목업 데이터 TOP3
function respondCaseSearch() {
  if (typeof MOCK_CASES === "undefined") {
    return "사례 데이터를 불러오지 못했어요.";
  }
  const top = MOCK_CASES.slice(0, 3);
  const lines = top.map((c, i) => `${i + 1}. ${c.title} (유사 ${c.similarity}%)`).join("\n");
  return `최근 유사 사고사례 TOP3이에요.\n\n${lines}\n\n하단 '사례 검색' 탭에서 더 자세히 볼 수 있어요.`;
}

// ── 이해 못한 질문 처리
function respondFallback() {
  return "죄송해요, 아직 그 질문엔 답변드리기 어려워요. 아래 버튼 중에서 골라주시거나, 위험도·예방·교육·사례 관련해서 다시 질문해주세요!";
}