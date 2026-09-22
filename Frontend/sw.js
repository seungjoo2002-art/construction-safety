// ============================================================
// sw.js — PWA 캐시 정책
// ============================================================
// 캐시하는 것: 앱 화면(HTML/CSS/JS), 아이콘, manifest, 오프라인 안내 화면 (Cache First)
// 캐시하되 갱신 우선: /api/ 중 남은 검색류 GET 응답 (Network First, 실패 시 캐시 폴백)
// 절대 캐시하지 않는 것: /api/ 중 쓰기·분석성 POST(predict/analyze/analyze-photo/chat),
//   그리고 대용량 원본 데이터(huggingface.co 직접 URL, *.npy, *.csv, *.xlsx, *.db 등).
//   사고 사례 검색(similar-cases.html, case-detail.html)은 이제 이 서버가 아니라
//   Hugging Face Dataset Viewer API(datasets-server.huggingface.co)를 브라우저가
//   직접 호출한다 — huggingface.co 하위 도메인이라 아래 isLargeRawDataRequest()에
//   걸려 서비스워커가 절대 캐시하지 않는다(대용량 원본 차단 규칙을 그대로 재사용).
//   대신 "최근 조회 결과"는 hf-dataset.js → api.js가 idb-store.js(IndexedDB)에
//   저장해서 네트워크 실패 시 보여준다 — Network First + IndexedDB 폴백은 앱
//   레벨(api.js)에서 구현되고, 서비스워커는 여기 관여하지 않는다.
// ============================================================

// ⚠️ 화면(HTML/CSS/JS)을 고치면 이 버전을 올려야 이미 설치된 PWA가 새 파일을 받는다
//    (앱 셸이 Cache First 라서, 안 올리면 배포해도 예전 CSS/JS 가 계속 쓰인다).
// v7: 챗봇 EXAONE 연동 / i18n 7개 언어 / 접근성 강화 / site-setup 버그 수정 반영
//     (accessibility.css, i18n.js, i18n/*.js, user-prefs.js 신규 + 기존 JS 다수 수정 —
//     버전을 안 올리면 이미 설치된 사용자는 이 변경을 하나도 못 받는다).
// v8: 일본어(ja) 추가 — lang-ja.js 신규, profile.js/i18n.js/status-labels.js 수정.
// v9: 예방조치 생성 신뢰성 수정(advisor.py) + "AI 맞춤 안전수칙" 카드를
//     "예방 조치" 섹션에 통합(predict-result.html/js).
// v10: 대시보드 "오늘 시간별 위험도 추이" 섹션 제거(dashboard.html/js, Chart.js 의존 제거).
// v11: 챗봇 타임아웃 연장(280초) + 느릴 때 안내 문구 + 생성 길이 단축(400→220 토큰)로
//      "AI 연결이 원활하지 않습니다" 조기 타임아웃 완화.
const SHELL_CACHE = "ai-safety-shell-v11";
const API_CACHE = "ai-safety-api-v1";
const CURRENT_CACHES = [SHELL_CACHE, API_CACHE];

const OFFLINE_URL = "html/offline.html";

// 앱 셸 — 화면(HTML)·스타일·스크립트·아이콘·manifest만 포함한다.
// 원본 데이터 파일(assets/*.npy, *.csv, *.xlsx, incidents.db)은 여기 절대 넣지 않는다.
const PRECACHE_URLS = [
  // HTML 화면
  "html/analysis-history.html",
  "html/case-detail.html",
  "html/chatbot.html",
  "html/dashboard.html",
  "html/login.html",
  "html/notifications.html",
  "html/offline.html",
  "html/photo-analyzing.html",
  "html/photo-capture.html",
  "html/photo-result.html",
  "html/predict-input.html",
  "html/predict-loading.html",
  "html/predict-result.html",
  "html/profile.html",
  "html/Qr-generator.html",
  "html/scatter-detail.html",
  "html/signup.html",
  "html/similar-cases.html",
  "html/site-setup.html",
  "html/weather-hourly.html",
  "html/manifest.json",
  // CSS
  "css/accessibility.css",
  "css/components.css",
  "css/layout.css",
  "css/pages.css",
  "css/reset.css",
  "css/variables.css",
  // JS 공통
  "js/common/accessibility.js",
  "js/common/api.js",
  "js/common/common.js",
  "js/common/constants.js",
  "js/common/i18n.js",
  "js/common/i18n/lang-en.js",
  "js/common/i18n/lang-id.js",
  "js/common/i18n/lang-ja.js",
  "js/common/i18n/lang-ko.js",
  "js/common/i18n/lang-ne.js",
  "js/common/i18n/lang-th.js",
  "js/common/i18n/lang-vi.js",
  "js/common/i18n/lang-zh.js",
  "js/common/i18n/status-labels.js",
  "js/common/idb-store.js",
  "js/common/image-viewer.js",
  "js/common/mock-cases.js",
  "js/common/mock-scatter.js",
  "js/common/nav.js",
  "js/common/notification-center.js",
  "js/common/notifications-realtime.js",
  "js/common/session-store.js",
  "js/common/user-prefs.js",
  "js/common/weather.js",
  // JS 화면별
  "js/pages/analysis-history.js",
  "js/pages/case-detail.js",
  "js/pages/chatbot.js",
  "js/pages/dashboard.js",
  "js/pages/login.js",
  "js/pages/notifications.js",
  "js/pages/photo-analyzing.js",
  "js/pages/photo-capture.js",
  "js/pages/photo-result.js",
  "js/pages/predict-input.js",
  "js/pages/predict-loading.js",
  "js/pages/predict-result.js",
  "js/pages/profile.js",
  "js/pages/scatter-detail.js",
  "js/pages/signup.js",
  "js/pages/similar-cases.js",
  "js/pages/site-setup.js",
  "js/pages/weather-hourly.js",
  // 아이콘 (manifest.json이 가리키는 것과 동일 경로)
  "../pictures/icon-192.png",
  "../pictures/icon-512.png",
  "../pictures/logo.png",
];

// 이 백엔드(Render Web Service)에는 더 이상 "검색 결과"성 GET 엔드포인트가 없다
// (구 /api/cases, /api/incidents는 Hugging Face Dataset Viewer API 직접 호출로
// 대체되어 제거됨 — 위 주석 참고). /api/predict, /api/analyze, /api/analyze-photo,
// /api/chat은 전부 매번 새로 계산되는 POST 결과라 애초에 캐싱 대상이 아니었다.
const CACHEABLE_API_PREFIXES = [];

// 원본 대용량 데이터는 어떤 경우에도 캐시하지 않는다 (요구사항: 캐시 금지).
function isLargeRawDataRequest(url) {
  if (url.hostname.endsWith("huggingface.co")) return true;
  return /\.(npy|csv|xlsx)$/i.test(url.pathname) || url.pathname.endsWith("incidents.db");
}

function isCacheableApiGet(request, url) {
  if (request.method !== "GET") return false;
  if (!url.pathname.includes("/api/")) return false;
  return CACHEABLE_API_PREFIXES.some((p) => url.pathname.includes(p));
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // 파일 하나가 404여도 설치 전체가 실패하지 않도록 개별 처리
      Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => console.warn(`[sw.js] precache 실패: ${url}`, err))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !CURRENT_CACHES.includes(k)).map((k) => caches.delete(k))))
      .then(() => trimCache(API_CACHE, 40))
  );
  self.clients.claim();
});

// 오래된 API 캐시 정리 — 개수 상한을 넘으면 가장 오래 전에 저장된 것부터 삭제.
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  const excess = keys.length - maxEntries;
  for (let i = 0; i < excess; i++) {
    await cache.delete(keys[i]);
  }
}

// env.js는 Render Static Site 빌드마다(generate-env.js가) 내용이 새로 바뀌는 파일이다
// (BACKEND_API_BASE_URL 등). 파일 경로 자체는 그대로라 아래 "그 외 정적 자산" Cache
// First 규칙에 걸리면, 배포를 새로 해서 백엔드 주소가 바뀌어도 브라우저가 예전에 캐시해둔
// env.js를 계속 써버려 "백엔드가 켜져 있는데도 프론트가 옛날(또는 잘못된) 주소로만 요청해서
// 연결 실패로 보이는" 문제가 생긴다. 그래서 절대 캐시하지 않고 항상 네트워크로만 받는다.
function isEnvConfigRequest(url) {
  return url.pathname.endsWith("/js/common/env.js");
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  if (isLargeRawDataRequest(url)) return; // 절대 가로채지 않음(캐시 금지) — 네트워크로만

  if (isEnvConfigRequest(url)) return; // 절대 캐시하지 않음 — 항상 최신 빌드 설정을 네트워크로

  if (e.request.method !== "GET") return; // POST 등은 항상 네트워크로만 (분석/예측 결과 등)

  if (isCacheableApiGet(e.request, url)) {
    e.respondWith(networkFirst(e.request));
    return;
  }

  if (url.pathname.includes("/api/")) return; // 그 외 API GET(/health 등)은 캐싱하지 않고 네트워크로

  // 화면 이동(navigation) 요청 — 셸 캐시 우선, 실패하면 오프라인 안내 화면
  if (e.request.mode === "navigate") {
    e.respondWith(cacheFirstShell(e.request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // 그 외(CSS/JS/이미지 등 정적 자산) — Cache First
  e.respondWith(cacheFirstShell(e.request));
});

async function cacheFirstShell(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) {
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, res.clone());
  }
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const res = await fetch(request, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      cache.put(request, res.clone());
      trimCache(API_CACHE, 40);
    }
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err; // fetch()를 호출한 쪽(api.js)이 IndexedDB 폴백을 처리
  }
}
