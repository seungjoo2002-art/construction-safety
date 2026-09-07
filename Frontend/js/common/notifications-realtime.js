// ============================================================
// notifications-realtime.js — "앱이 열려있는 동안" 실제 브라우저 알림
// 완전한 서버 푸시(앱이 꺼져있어도 오는 알림)는 별도 푸시서버 인프라가
// 필요해서 제외하고, Notification API로 포그라운드 알림만 지원합니다.
// ============================================================

const TRIGGERED_NOTIFICATIONS_KEY = "triggered_notifications";
const TRIGGERED_NOTIFICATIONS_MAX = 50;

/**
 * 브라우저 알림 권한 요청. 이미 허용/거부된 상태면 그대로 반환.
 * @returns {Promise<"granted"|"denied"|"default"|"unsupported">}
 */
async function requestNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";

  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }

  return Notification.requestPermission();
}

/**
 * 실제 브라우저 알림 표시. profile.html의 "푸시 알림" 토글(notif_prefs.push)이
 * true이고, 알림 권한이 허용된 상태일 때만 동작합니다.
 */
async function showRealNotification(title, body, tag) {
  const prefs = JSON.parse(localStorage.getItem("notif_prefs") || '{"push":true,"alert":true}');
  if (!prefs.push) return;

  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const options = { body, icon: "../../pictures/icon-192.png", tag };

  let registration = null;
  if ("serviceWorker" in navigator) {
    registration = await navigator.serviceWorker.getRegistration();
  }

  if (registration) {
    await registration.showNotification(title, options);
  } else {
    new Notification(title, options);
  }

  recordTriggeredNotification(title, body, tag);
}

/** notifications.html에서 실제 알림 이력으로 보여줄 용도로 최근 50개까지 저장 */
function recordTriggeredNotification(title, body, tag) {
  const history = JSON.parse(localStorage.getItem(TRIGGERED_NOTIFICATIONS_KEY) || "[]");
  history.unshift({ title, body, tag, time: new Date().toISOString() });
  localStorage.setItem(
    TRIGGERED_NOTIFICATIONS_KEY,
    JSON.stringify(history.slice(0, TRIGGERED_NOTIFICATIONS_MAX))
  );
}
