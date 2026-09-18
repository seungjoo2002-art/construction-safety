// ============================================================
// notification-center.js — 알림 데이터 계층 (알림 화면 + 대시보드 헤더 배지가 공유)
// constants.js, session-store.js 보다 나중에 로드되어야 합니다.
//
// "알림"의 목적은 통계 재노출이 아니라 "지금 무엇을 확인/조치해야 하는가"이므로,
// 여기서는 저장된 분석 결과를 사람이 읽는 행동 중심 문장(situation/action)으로
// 변환하는 로직만 담당한다. 화면 렌더링(HTML)은 이 파일을 쓰는 쪽(notifications.js,
// dashboard.js)에서 담당 — 데이터 가공과 화면 표시를 분리해서, 나중에 실제 서버
// 알림/DB로 바꿀 때 이 파일만 교체하면 되게 한다.
// ============================================================

const NOTIF_LAST_SEEN_KEY = "notifications_last_seen";

// ── 위험도 분석 1건 → 알림 항목
function _predictToNotifItem(r) {
  const shortLabel = (ACCIDENT_TYPE_SHORT_LABEL && ACCIDENT_TYPE_SHORT_LABEL[r.topType]) || r.topType || "위험";
  const isUrgent = r.grade === "매우위험" || r.grade === "위험";
  const isCaution = r.grade === "주의";
  const tip = (ACCIDENT_TYPE_TIPS && ACCIDENT_TYPE_TIPS[r.topType] && ACCIDENT_TYPE_TIPS[r.topType][0]) || null;
  const topProb = r.result?.accident_type?.confidence;

  return {
    importance: isUrgent ? "urgent" : isCaution ? "caution" : "info",
    icon: isUrgent ? "🔴" : isCaution ? "🟠" : "🔵",
    title: isUrgent || isCaution ? `${shortLabel} 위험 확인 필요` : "위험도 분석 완료",
    situation: isUrgent || isCaution
      ? `현장 위험도 분석에서 '${shortLabel}' 관련 위험이${topProb ? ` ${Math.round(topProb * 100)}% 확률로` : ""} 가장 높게 나타났습니다.`
      : `현장 위험도 분석이 완료됐어요. 종합 위험도 ${r.score}점(${r.grade})으로 전반적으로 안전한 수준입니다.`,
    action: tip ? tip.desc : "정기 안전점검을 유지하세요.",
    time: r.savedAt,
    source: "위험도 분석",
    href: r.id ? `predict-result.html?resultId=${encodeURIComponent(r.id)}` : null,
  };
}

// ── 사진 분석 1건 → 알림 항목 (rules.json 판정 결과 기반)
function _photoToNotifItem(p) {
  const hazards = p.result?.hazards || [];
  const boxes = p.result?.boxes || [];
  const grade = p.result?.grade; // HIGH | MEDIUM | LOW
  const isUrgent = grade === "HIGH";
  const isCaution = grade === "MEDIUM";
  const topHazard = hazards[0];
  const dangerLabels = [...new Set(boxes.filter((b) => b.color === "danger").map((b) => b.label))];

  return {
    importance: isUrgent ? "urgent" : isCaution ? "caution" : "info",
    icon: isUrgent ? "🔴" : isCaution ? "🟠" : "🔵",
    title: topHazard ? topHazard.title : "사진 분석 완료",
    situation: hazards.length > 0
      ? `현장 사진 분석에서 위험요소 ${hazards.length}건이 탐지됐어요.${dangerLabels.length ? ` (${dangerLabels.slice(0, 3).join(", ")})` : ""}`
      : "현장 사진 분석이 완료됐어요. 탐지된 위험요소가 없습니다.",
    action: hazards.length > 0
      ? "사진에 표시된 위험요소 위치를 확인하고 필요한 안전조치를 시행하세요."
      : "특별한 조치 없이 정기 점검을 유지하세요.",
    time: p.savedAt,
    source: "사진 분석",
    href: p.id ? `photo-result.html?resultId=${encodeURIComponent(p.id)}` : null,
  };
}

// ⚠️ 아래 2개는 실제 트리거(기상특보 API 연동, 교육일정 DB)가 아직 없어 고정 예시입니다.
function _placeholderItems() {
  const now = Date.now();
  return [
    {
      importance: "caution",
      icon: "🟠",
      title: "강우 위험 대비 필요",
      situation: "내일 오전 강수량 52mm가 예보되었습니다.",
      action: "고소작업 및 야외작업 안전에 각별히 주의하세요.",
      time: new Date(now - 18 * 60 * 60 * 1000).toISOString(),
      source: "기상 정보",
      href: null,
    },
    {
      importance: "info",
      icon: "🔵",
      title: "안전교육 일정 안내",
      situation: "이번 주 목요일 오전 8시 추락·낙하 예방 교육이 예정되어 있습니다.",
      action: "참석 대상자는 일정을 미리 확인하세요.",
      time: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
      source: "교육 안내",
      href: null,
    },
  ];
}

/** 저장된 위험도 분석/사진 분석 이력 + 고정 안내 항목을 최신순으로 합친 알림 목록. */
function buildNotificationItems() {
  const predictItems = getSavedResults().map(_predictToNotifItem);
  const photoItems = getSavedPhotoResults().map(_photoToNotifItem);
  return [...predictItems, ...photoItems, ..._placeholderItems()].sort(
    (a, b) => new Date(b.time) - new Date(a.time)
  );
}

/** 마지막으로 알림 화면을 본 시점 이후의 항목 수 (읽음 처리는 하지 않음 — 대시보드 배지용으로도 재사용). */
function getUnreadNotificationCount(items) {
  const lastSeen = localStorage.getItem(NOTIF_LAST_SEEN_KEY);
  const lastSeenTime = lastSeen ? new Date(lastSeen).getTime() : 0;
  return items.filter((n) => new Date(n.time).getTime() > lastSeenTime).length;
}

/** 알림 화면을 실제로 봤을 때만 호출 — 다음 방문부터는 새 항목만 미확인으로 집계. */
function markNotificationsSeen() {
  localStorage.setItem(NOTIF_LAST_SEEN_KEY, new Date().toISOString());
}
