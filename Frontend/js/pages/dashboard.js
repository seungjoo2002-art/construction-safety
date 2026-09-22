// ============================================================
// dashboard.js — 대시보드 화면
// session-store.js, constants.js, notification-center.js, weather.js, api.js,
// i18n.js 보다 나중에 로드되어야 합니다.
//
// 정보 우선순위(위→아래): 현재 상태 → 가장 위험한 사고유형 → 지금 할 일 →
// 세부 위험 분석 → 유사 사례 → 진입 배너
// (사고유형별 확률 분포 — "예측 사고 유형 분류" 파이차트/순위 — 는 화면에서 제거됨.
//  모델/API 응답의 accident_type.probabilities 자체는 그대로이고 여기서 그리지만 않는다.
//  "오늘 시간별 위험도 추이" 섹션도 요청에 따라 제거됨 — Chart.js/predictRisk() 시간대별
//  반복 호출 로직은 더 이상 쓰지 않는다.)
//
// 데이터 소스:
//  - 종합위험도 / 사고유형             → getLastPredictResult() (실제 모델 응답, 없으면 빈 상태)
//  - 유사사례 TOP3                    → MOCK_CASES (목업, 분석 전엔 빈 상태)
//  - 헤더 알림 배지                    → notification-center.js (알림 화면과 동일한 데이터)
//
// i18n: renderHero/renderFocus/renderStats/renderSimilarCases는 화면에 보여줄 값(등급/
// 유형명/문구)만 매번 새로 그리므로, 언어가 바뀌면(i18n:change) 서버를 다시 호출하지
// 않고 캐시해둔 데이터로 그대로 다시 그린다.
// ============================================================

let _cachedResult = null;
let _cachedSimilarity = null;

document.addEventListener("DOMContentLoaded", () => {
  renderHeaderWeatherMini();
  renderHeaderNotifBadge();

  _cachedResult = getLastPredictResult();
  _cachedSimilarity = getLastSimilarity();

  renderLocalizedParts();

  document.addEventListener("i18n:change", renderLocalizedParts);
});

// 언어가 바뀌거나 최초 로드될 때, 캐시된 데이터만 가지고 다시 그리는 부분들
function renderLocalizedParts() {
  if (!_cachedResult) {
    renderHeroEmpty();
    renderFocusEmpty();
    renderStatsEmpty();
    renderSimilarEmpty();
  } else {
    renderHero(_cachedResult);
    renderFocus(_cachedResult.accident_type);
    renderStats(_cachedResult);

    if (_cachedSimilarity && _cachedSimilarity.similar_cases && _cachedSimilarity.similar_cases.length > 0) {
      renderSimilarCases(_cachedSimilarity.similar_cases.slice(0, 3), _cachedSimilarity);
    } else {
      renderSimilarEmpty(t("dashboard.similarLoadFailed"));
    }
  }
}

function emptyStateHtml(text, href, linkText) {
  return `
    <div class="dashboard-empty">
      <div class="dashboard-empty__icon">📊</div>
      <p class="dashboard-empty__text">${text}</p>
      <a href="${href}" class="dashboard-empty__btn">${linkText}</a>
    </div>
  `;
}

function renderHeroEmpty() {
  document.getElementById("dash-hero-body").innerHTML = emptyStateHtml(
    `${t("dashboard.noResultLine1")}<br>${t("dashboard.noResultLine2")}`,
    "predict-input.html",
    t("dashboard.goAnalyze")
  );
  document.getElementById("dash-hero-focus-line").style.display = "none";
}

function renderFocusEmpty() {
  document.getElementById("dash-focus").style.display = "none";
}

function renderStatsEmpty() {
  document.getElementById("stat-grid-wrapper").innerHTML = emptyStateHtml(
    `${t("dashboard.noResultLine1")}<br>${t("dashboard.noResultStatsLine2")}`,
    "predict-input.html",
    t("dashboard.goAnalyze")
  );
}

function renderSimilarEmpty(text) {
  document.getElementById("similar-case-list").innerHTML = emptyStateHtml(
    text || t("dashboard.similarEmpty"),
    "predict-input.html",
    t("dashboard.goAnalyze")
  );
}

// ── 헤더 날씨 미니위젯
async function renderHeaderWeatherMini() {
  const iconEl = document.getElementById("hwm-icon");
  const tempEl = document.getElementById("hwm-temp");
  try {
    const { current } = await getWeatherSnapshot();
    iconEl.textContent = weatherIconToEmoji(current.icon);
    tempEl.textContent = `${Math.round(current.temp)}°C`;
  } catch (err) {
    console.error(err);
    iconEl.textContent = "⚠️";
    tempEl.textContent = t("dashboard.weatherError");
  }
}

// ── 헤더 알림 배지: notification-center.js가 알림 화면과 동일한 기준으로 계산
//    (읽음 처리는 하지 않음 — 실제로 알림 화면을 열었을 때만 markNotificationsSeen() 호출)
function renderHeaderNotifBadge() {
  const badgeEl = document.getElementById("header-notif-badge");
  try {
    const items = buildNotificationItems();
    const unread = getUnreadNotificationCount(items);
    if (unread > 0) {
      badgeEl.textContent = unread > 9 ? "9+" : String(unread);
      badgeEl.style.display = "flex";
    } else {
      badgeEl.style.display = "none";
    }
  } catch (err) {
    console.error("[dashboard.js] 알림 배지 계산 실패:", err);
  }
}

function riskColor(pct) {
  if (pct >= 80) return "var(--color-danger)";
  if (pct >= 50) return "var(--color-caution)";
  return "var(--color-safe)";
}

function gradeToBadgeClass(grade) {
  if (grade === "매우위험" || grade === "위험") return "badge--danger";
  if (grade === "주의") return "badge--caution";
  return "badge--safe";
}

// ── ① 오늘의 현장 안전 상태 (종합 위험도 히어로 카드)
// 실제 predict_severity.py fatal_risk 응답을 그대로 사용
// ⚠️ i18n 주의: fr.grade("매우위험" 등)는 화면에 보여줄 때만 tStatus()로 번역한다.
// gradeToBadgeClass() 같은 로직 비교, className 조립에는 항상 원래 한국어 값을 쓴다.
function renderHero(result) {
  const fr = result.severity.fatal_risk;
  const pct = Math.round(fr.percentile);

  const r = 42;
  const circumference = 2 * Math.PI * r;
  const circle = document.getElementById("gauge-total-circle");
  circle.style.strokeDasharray = `${circumference}`;
  circle.style.strokeDashoffset = `${circumference - (circumference * pct) / 100}`;
  circle.style.stroke = riskColor(pct);
  document.getElementById("gauge-total-number").textContent = pct;
  const gaugeLabel = document.getElementById("gauge-total-label");
  gaugeLabel.textContent = tStatus(fr.grade);
  gaugeLabel.style.color = riskColor(pct);

  const badgeEl = document.getElementById("dash-hero-badge");
  badgeEl.textContent = tStatus(fr.grade);
  badgeEl.className = `badge ${gradeToBadgeClass(fr.grade)}`;

  document.getElementById("dash-hero-meta").innerHTML =
    `${t("dashboard.riskMeta")} · ${t("dashboard.liftDelta")} <b>${fr.lift_vs_median}${t("dashboard.timesUnit")}</b>`;

  // "현재 가장 주의가 필요한 위험: 끼임 (27%)" — 문장 형태로도 한 번 더 확인 가능하게
  const topType = result.accident_type.predicted_type;
  const topShort = tStatus(ACCIDENT_TYPE_SHORT_LABEL[topType] || topType);
  const topPct = Math.round(result.accident_type.confidence * 100);
  const focusLineEl = document.getElementById("dash-hero-focus-line");
  focusLineEl.innerHTML = `${t("dashboard.focusLinePrefix")} <b>${topShort}</b> (${topPct}%)`;
  focusLineEl.style.display = "";
}

// ── ③ 지금 가장 주의할 위험 (액션 유도 카드) — 예측 사고유형 TOP1 + 예방수칙 첫 항목
function renderFocus(accidentType) {
  const section = document.getElementById("dash-focus");
  const topType = accidentType.predicted_type;
  const pct = Math.round(accidentType.confidence * 100);
  const tip = (ACCIDENT_TYPE_TIPS[topType] && ACCIDENT_TYPE_TIPS[topType][0]) || null;

  if (!tip) {
    section.style.display = "none";
    return;
  }

  section.style.display = "";
  document.getElementById("dash-focus-icon").textContent = pct >= 30 ? "🔴" : pct >= 15 ? "🟠" : "🔵";
  document.getElementById("dash-focus-type").textContent = tStatus(ACCIDENT_TYPE_SHORT_LABEL[topType] || topType);
  document.getElementById("dash-focus-pct").textContent = `${pct}%`;
  // ⚠️ tip.desc(예방수칙 문구)는 아직 다국어 사전에 없어 한국어 원문 그대로 표시합니다.
  document.getElementById("dash-focus-tip").textContent = tip.desc;

  // 방금 본 lastResult가 어느 이력(id)에 대응하는지 찾아서 상세 화면으로 바로 이동
  const btn = document.getElementById("dash-focus-btn");
  const latestWithId = getSavedResults().find((r) => r.id);
  if (latestWithId) {
    btn.href = `predict-result.html?resultId=${encodeURIComponent(latestWithId.id)}`;
  } else {
    btn.href = "predict-input.html";
  }
}

// ── ④ 세부 위험 분석 (보조 정보 — 평균 대비 위험도 / 예측 심각도)
function renderStats(result) {
  const fr = result.severity.fatal_risk;

  document.getElementById("value-lift").textContent = `${fr.lift_vs_median}${t("dashboard.timesUnit")}`;
  document.getElementById("bar-prob").style.width = `${Math.min(fr.lift_vs_median * 20, 100)}%`;

  document.getElementById("value-severity-class").textContent = tStatus(result.severity.predicted_class);
  const severityBarPct = { "경+중등도": 20, "중상": 60, "치명": 100 }[result.severity.predicted_class] || 20;
  document.getElementById("bar-fatal").style.width = `${severityBarPct}%`;
}

// ── ⑤ 유사사례 TOP3 (제목 / 사고유형 / 유사도만 — 대시보드에서는 가볍게)
function renderSimilarCases(cases, sim) {
  const tagEl = document.getElementById("similar-cases-mock-tag");
  if (tagEl) {
    if (sim._mock) {
      tagEl.textContent = t("common.mock");
      tagEl.style.display = "inline-block";
    } else if (sim.is_approximate) {
      tagEl.textContent = t("dashboard.approximate");
      tagEl.style.display = "inline-block";
    } else {
      tagEl.style.display = "none";
    }
  }

  document.getElementById("similar-case-list").innerHTML = cases
    .map((c, i) => {
      const color = SIM_HAZARD_COLORS[c.hazard_type] || "#B0B7C3";
      return `
      <a href="case-detail.html?id=${encodeURIComponent(c.id)}" class="similar-case-list__item">
        <span class="similar-case-list__rank">${i + 1}</span>
        <div>
          <div class="similar-case-list__title">${c.title}</div>
          <span class="badge" style="background:${color}22; color:${color}; margin-top:2px;">${tStatus(c.hazard_type)}</span>
        </div>
        <span class="similar-case-list__pct">${t("dashboard.similarPct", { n: c.similarity_percent })}</span>
      </a>
    `;
    })
    .join("");
}

