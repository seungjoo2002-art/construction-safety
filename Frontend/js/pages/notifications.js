// ============================================================
// notifications.js — 알림 화면
// 목적: "지금 무엇을 확인/조치해야 하는가"를 2~3초 안에 알 수 있게 보여준다.
// 대시보드와 중복되는 통계(전체 위험지수 게이지, 유형별 분포 등)는 보여주지 않고,
// 데이터 가공은 notification-center.js(공유 데이터 계층)에 위임한다.
// constants.js, session-store.js, notification-center.js 보다 나중에 로드되어야 합니다.
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  const items = buildNotificationItems();
  const unreadCount = getUnreadNotificationCount(items);

  document.getElementById("notif-need-count").textContent = unreadCount;

  renderList(items);
  markNotificationsSeen(); // 이 화면을 봤으니 다음 방문부터는 새 항목만 미확인으로 집계
});

function formatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const hm = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `오늘 ${hm}`;
  if (isYesterday) return `어제 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

const NOTIF_IMPORTANCE_LABEL = { urgent: "긴급", caution: "주의", info: "안내" };

// 알림이 "어디서 온 건지" 한눈에 구분되도록 출처별로 섹션을 나눠서 보여준다.
// 정해진 순서(위험도 분석 → 사진 분석 → 기상 정보 → 교육 안내)로 먼저 보여주고,
// 목록에 없는 새로운 출처가 생기면 그 뒤에 자동으로 이어붙인다.
const NOTIF_SOURCE_ORDER = ["위험도 분석", "사진 분석", "기상 정보", "교육 안내"];
const NOTIF_SOURCE_ICON = {
  "위험도 분석": "📊",
  "사진 분석": "📷",
  "기상 정보": "☁️",
  "교육 안내": "📋",
};

// ── 알림 목록을 "출처"별 섹션으로 나눠서 렌더링 (각 섹션 안에서는 최신순 유지)
function renderList(items) {
  const listEl = document.getElementById("notif-list");

  if (items.length === 0) {
    listEl.innerHTML = `<p style="text-align:center; color: var(--color-text-secondary); padding: var(--space-lg) 0;">아직 알림이 없어요.</p>`;
    return;
  }

  const groups = {};
  items.forEach((n) => {
    (groups[n.source] = groups[n.source] || []).push(n);
  });

  const orderedSources = [
    ...NOTIF_SOURCE_ORDER.filter((s) => groups[s]?.length),
    ...Object.keys(groups).filter((s) => !NOTIF_SOURCE_ORDER.includes(s)),
  ];

  listEl.innerHTML = orderedSources
    .map(
      (source) => `
      <div class="notif-source-header">
        <span class="notif-source-header__icon">${NOTIF_SOURCE_ICON[source] || "🔔"}</span>
        <span class="notif-source-header__label">${source}</span>
        <span class="notif-source-header__count">${groups[source].length}건</span>
      </div>
      ${groups[source].map(renderNotifItem).join("")}
    `
    )
    .join("");
}

function renderNotifItem(n) {
  const btnLabel = n.source === "사진 분석" ? "분석 결과 보기" : "상세 보기";
  return `
    <div class="notif-item notif-item--${n.importance}">
      <div class="notif-item__importance">${n.icon} ${NOTIF_IMPORTANCE_LABEL[n.importance]}</div>
      <div class="notif-item__title">${n.title}</div>
      <div class="notif-item__situation">${n.situation}</div>
      <div class="notif-item__action">
        <span class="notif-item__action-label">권장 조치</span>
        <span class="notif-item__action-text">${n.action}</span>
      </div>
      <div class="notif-item__meta">${formatTime(n.time)}</div>
      ${n.href ? `<a href="${n.href}" class="btn btn-outline btn-block notif-item__btn">${btnLabel}</a>` : ""}
    </div>
  `;
}
