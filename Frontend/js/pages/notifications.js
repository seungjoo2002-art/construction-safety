// ============================================================
// notifications.js — 알림 화면
// 위험도 분석 완료 / 사진 분석 완료 알림은 localStorage에 실제
// 저장된 기록을 사용합니다. 기상특보/안전교육 안내는 실제 트리거
// 시스템이 없어서 고정 예시로 채워둔 항목입니다 (⚠️ 표시 아래 주석 참고).
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  const savedResults = JSON.parse(localStorage.getItem("saved_results") || "[]");
  const savedPhotoResults = JSON.parse(localStorage.getItem("saved_photo_results") || "[]");

  renderHero(savedResults);
  const items = buildNotificationItems(savedResults, savedPhotoResults);
  renderList(items);
  updateUnreadBadge(items);
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

// ── 상단 히어로 카드: 가장 최근 저장된 위험도 분석 결과 사용 (없으면 목업)
function renderHero(savedResults) {
  const latest = savedResults[0];

  const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  document.getElementById("notif-date").textContent = `${today} · 오늘의 위험지수`;

  let score, grade, breakdown;

  if (latest) {
    score = latest.score;
    grade = latest.grade;
    const probs = latest.result?.accident_type?.probabilities || {};
    breakdown = Object.entries(probs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([label, p]) => ({
        label: (ACCIDENT_TYPE_SHORT_LABEL && ACCIDENT_TYPE_SHORT_LABEL[label]) || label,
        pct: Math.round(p * 100),
      }));
  } else {
    // 저장된 분석 기록이 없을 때 보여줄 예시 값 (MOCK)
    score = 82;
    grade = "위험";
    breakdown = [
      { label: "추락", pct: 57 },
      { label: "충돌", pct: 21 },
      { label: "낙하", pct: 14 },
      { label: "기타", pct: 8 },
    ];
  }

  document.getElementById("notif-score").textContent = `${score} / 100`;
  document.getElementById("notif-badge").textContent =
    grade === "매우위험" || grade === "위험" ? "⚠️ 위험 · 즉각 조치 필요" : `${grade} 수준`;

  const r = 42;
  const circumference = 2 * Math.PI * r;
  const ring = document.getElementById("notif-ring");
  ring.style.strokeDasharray = `${circumference}`;
  ring.style.strokeDashoffset = `${circumference - (circumference * score) / 100}`;
  document.getElementById("notif-ring-num").textContent = score;

  document.getElementById("notif-chips").innerHTML = breakdown
    .map(
      (b) => `
      <div class="notif-hero__chip">
        <div class="notif-hero__chip-pct">${b.pct}%</div>
        <div class="notif-hero__chip-label">${b.label}</div>
      </div>
    `
    )
    .join("");
}

// ── 알림 리스트 구성
function buildNotificationItems(savedResults, savedPhotoResults) {
  const items = [];

  if (savedResults[0]) {
    const latest = savedResults[0];
    items.push({
      type: "danger",
      icon: "⚠️",
      title: `오늘의 위험지수: ${latest.score}점`,
      desc: `현장의 종합 위험도가 '${latest.grade}' 수준입니다. 즉각적인 안전점검이 필요합니다.`,
      badge: "위험",
      time: latest.savedAt,
    });
  }

  savedResults.slice(0, 3).forEach((r) => {
    items.push({
      type: "safe",
      icon: "✅",
      title: "위험도 분석 완료",
      desc: `요청하신 위험도 분석이 완료되었습니다. 종합 위험도 ${r.score}점(${r.grade}).`,
      badge: "완료",
      time: r.savedAt,
    });
  });

  savedPhotoResults.slice(0, 2).forEach((p) => {
    items.push({
      type: "info",
      icon: "📷",
      title: "사진 분석 완료",
      desc: `촬영한 현장 사진 분석이 완료되었습니다. 위험요소 ${p.result?.hazards?.length ?? 0}건이 탐지되었습니다.`,
      badge: "완료",
      time: p.savedAt,
    });
  });

  // ⚠️ 아래 2개는 실제 트리거(기상특보 API 연동, 교육일정 DB)가 아직 없어 고정 예시입니다.
  const now = Date.now();
  items.push({
    type: "info",
    icon: "☁️",
    title: "기상 특보 발령",
    desc: "내일 오전 강수량 52mm 예보. 고소작업 및 야외작업 안전에 각별히 주의하세요.",
    badge: "기상",
    time: new Date(now - 18 * 60 * 60 * 1000).toISOString(),
  });
  items.push({
    type: "purple",
    icon: "📋",
    title: "안전교육 일정 안내",
    desc: "이번 주 목요일 오전 8시 추락·낙하 예방 교육이 예정되어 있습니다.",
    badge: "교육",
    time: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
  });

  return items.sort((a, b) => new Date(b.time) - new Date(a.time));
}

function renderList(items) {
  const listEl = document.getElementById("notif-list");
  listEl.innerHTML = items
    .map(
      (n) => `
      <div class="notif-item notif-item--${n.type}">
        <span class="notif-item__icon">${n.icon}</span>
        <div class="notif-item__body">
          <div class="notif-item__title-row">
            <span class="notif-item__title">${n.title}</span>
            <span class="badge ${n.type === "danger" ? "badge--danger" : n.type === "safe" ? "badge--safe" : "badge--caution"}">${n.badge}</span>
          </div>
          <div class="notif-item__desc">${n.desc}</div>
          <div class="notif-item__time">${formatTime(n.time)}</div>
        </div>
      </div>
    `
    )
    .join("");
}

// ── 미확인 개수: 마지막으로 이 화면을 본 시점 이후의 항목 수를 셈
function updateUnreadBadge(items) {
  const lastSeen = localStorage.getItem("notifications_last_seen");
  const lastSeenTime = lastSeen ? new Date(lastSeen).getTime() : 0;

  const unreadCount = items.filter((n) => new Date(n.time).getTime() > lastSeenTime).length;
  document.getElementById("unread-badge").textContent = `미확인 ${unreadCount}`;

  // 이 화면을 봤으니 지금 시각으로 갱신 (다음 방문부터는 새 항목만 미확인으로 집계)
  localStorage.setItem("notifications_last_seen", new Date().toISOString());
}