// ============================================================
// i18n.js — 공통 다국어(국제화) 엔진
// ------------------------------------------------------------
// 페이지마다 if(language === "en") 같은 분기를 반복하지 않도록,
// 모든 페이지가 공유하는 번역 조회/적용 함수를 여기 한 곳에 모읍니다.
//
// 사용법:
//   1) <head>에서 accessibility.js 다음, 각 lang-*.js 사전 파일들을 로드
//      (순서 무관 — 전부 window.I18N_DICT[code]에 등록됨), 그 다음 이 파일을 로드.
//   2) 정적 텍스트: <span data-i18n="nav.dashboard">대시보드</span>
//      → 페이지 로드 시 applyI18n()이 textContent를 자동으로 바꿔치기.
//      속성 번역: data-i18n-placeholder / data-i18n-aria-label / data-i18n-title
//   3) 동적 텍스트(JS가 만드는 문자열): t("chatbot.generating") 형태로 직접 호출.
//   4) 언어를 바꿀 때는 항상 setLanguage(code)를 사용 — 저장 + 즉시 재적용 +
//      "i18n:change" 이벤트 발행까지 한 번에 처리합니다. 각 페이지 JS는 그 이벤트를
//      구독해서 動적으로 그려둔 텍스트(카드, 목록 등)를 다시 그리면 됩니다.
//
// 중요(요구사항 9): 이 사전은 오직 "화면에 보여주는 문구"만 번역합니다.
// 백엔드로 보내거나 백엔드에서 받는 category 값(예: "추락·압착(Falls)", "위험" 등급 등)은
// 절대 이 사전으로 바꿔치기하지 않습니다 — status.js의 STATUS_LABEL_MAP은 오직
// "표시용" 매핑이고, API로 나가는 payload/모델 입력값은 항상 원래 한국어 문자열 그대로 씁니다.
// ============================================================

const I18N_SUPPORTED_LANGS = ["ko", "en", "ja", "zh", "vi", "th", "id", "ne"];
const I18N_DEFAULT_LANG = "ko";
const I18N_STORAGE_KEY = "app_language"; // 비로그인(guest) 상태 폴백용 전역 키

/** 현재 로그인 계정의 저장된 언어 → 없으면 전역 폴백 키 → 없으면 기본값(ko) */
function getLanguage() {
  try {
    if (typeof getUserPrefs === "function") {
      const prefs = getUserPrefs();
      if (prefs && prefs.language && I18N_SUPPORTED_LANGS.includes(prefs.language)) {
        return prefs.language;
      }
    }
    const fallback = localStorage.getItem(I18N_STORAGE_KEY);
    if (fallback && I18N_SUPPORTED_LANGS.includes(fallback)) return fallback;
  } catch (e) {
    /* localStorage 접근 불가 환경 — 기본값으로 진행 */
  }
  return I18N_DEFAULT_LANG;
}

/**
 * 언어를 바꾸고, 계정별 설정에 저장하고, 현재 페이지에 즉시 반영합니다.
 * (요구사항 20: 새로고침 없이 즉시 반영 + 요구사항 7: 계정별 유지)
 */
function setLanguage(code) {
  if (!I18N_SUPPORTED_LANGS.includes(code)) return;
  try {
    localStorage.setItem(I18N_STORAGE_KEY, code); // 비로그인 상태에서도 최소한 이 브라우저에서는 유지
    if (typeof setUserPrefs === "function") {
      setUserPrefs({ language: code }); // 로그인 상태면 계정 레코드에도 저장 (다른 기기 동기화는 안 되지만, 최소한 이 계정 전용으로 분리 저장)
    }
  } catch (e) {
    /* 무시 — 그래도 이번 세션 화면 반영은 진행 */
  }
  applyI18n();
  document.dispatchEvent(new CustomEvent("i18n:change", { detail: { lang: code } }));
}

/**
 * key(dot-path 문자열)로 현재 언어의 번역문을 찾습니다.
 * 없으면 한국어(기본 사전) → 그래도 없으면 key 자체를 반환합니다.
 * vars: {name: "값"} 형태로 넘기면 문자열 안의 {name}을 치환합니다.
 */
function t(key, vars) {
  const lang = getLanguage();
  const dict = (window.I18N_DICT && window.I18N_DICT[lang]) || {};
  const fallbackDict = (window.I18N_DICT && window.I18N_DICT[I18N_DEFAULT_LANG]) || {};
  let str = key in dict ? dict[key] : key in fallbackDict ? fallbackDict[key] : key;
  if (vars) {
    Object.keys(vars).forEach((k) => {
      str = str.replace(new RegExp(`\\{${k}\\}`, "g"), vars[k]);
    });
  }
  return str;
}

/**
 * 모델/백엔드 category 값(한국어 원문)을 현재 언어의 "표시용" 문구로 바꿉니다.
 * status-labels.js의 STATUS_LABEL_MAP에 등록된 값만 대상 — 없으면 원문 그대로 반환
 * (즉, API에 보내는 값·내부 로직 비교에는 절대 쓰지 말고 화면 출력 직전에만 사용).
 */
function tStatus(koreanValue) {
  if (!koreanValue) return koreanValue;
  const lang = getLanguage();
  if (lang === "ko") return koreanValue;
  const map = window.STATUS_LABEL_MAP && window.STATUS_LABEL_MAP[koreanValue];
  return (map && map[lang]) || koreanValue;
}

/** 주어진 루트(기본: 문서 전체) 안의 data-i18n* 요소들을 현재 언어로 다시 그립니다. */
function applyI18n(root) {
  root = root || document;
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.getAttribute("data-i18n-html"));
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
  });
  root.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.getAttribute("data-i18n-title"));
  });
  try {
    document.documentElement.lang = getLanguage();
  } catch (e) {
    /* 무시 */
  }
}

document.addEventListener("DOMContentLoaded", () => applyI18n());
