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
      : boxes.length === 0
        ? "현장 사진에서 탐지된 객체가 없어 위험 여부를 판정하지 못했어요."
        : `현장 사진에서 객체 ${boxes.length}개를 탐지했고, 룰 기준 위험요소는 없었어요.`,
    action: hazards.length > 0
      ? "사진에 표시된 위험요소 위치를 확인하고 필요한 안전조치를 시행하세요."
      : boxes.length === 0
        ? "현장을 직접 확인하거나, 위험요소가 잘 보이도록 다시 촬영해 분석하세요."
        : "AI가 놓친 위험요소가 없는지 현장을 직접 점검하세요.",
    time: p.savedAt,
    source: "사진 분석",
    href: p.id ? `photo-result.html?resultId=${encodeURIComponent(p.id)}` : null,
  };
}

/**
 * 내 위험도 분석/사진 분석 기록으로 만든 알림 목록(최신순) + 마지막 확인 시각.
 * 서버(/api/me/notifications)가 토큰 사용자 소유 기록만 내려준다. 실제 트리거가 없는
 * 고정 예시 알림(기상특보·교육일정)은 모든 신규 계정에 똑같이 보여 "남의 알림"처럼
 * 보였으므로 제거했다.
 * @returns {Promise<{items: object[], lastSeenAt: string|null}>}
 */
async function buildNotificationItems() {
  const data = await authRequest("GET", "/api/me/notifications");
  const predictItems = data.analyses.map((r) =>
    _predictToNotifItem({ id: r.id, savedAt: r.created_at, score: r.score, grade: r.grade, topType: r.top_type, result: r.result })
  );
  const photoItems = data.photos.map((p) => _photoToNotifItem({ id: p.id, savedAt: p.created_at, result: p.result }));
  const items = [...predictItems, ...photoItems].sort((a, b) => new Date(b.time) - new Date(a.time));
  return { items, lastSeenAt: data.last_seen_at };
}

/** 마지막으로 알림 화면을 본 시점 이후의 항목 수 (대시보드 배지용으로도 재사용). */
function getUnreadNotificationCount(items, lastSeenAt) {
  const lastSeenTime = lastSeenAt ? new Date(lastSeenAt).getTime() : 0;
  return items.filter((n) => new Date(n.time).getTime() > lastSeenTime).length;
}

/** 알림 화면을 실제로 봤을 때만 호출 — 다음 방문부터는 새 항목만 미확인으로 집계. */
function markNotificationsSeen() {
  return authRequest("POST", "/api/me/notifications/seen").catch((err) =>
    console.warn("[notification-center.js] 읽음 처리 실패", err)
  );
}
