// ============================================================
// dashboard.js — 대시보드 화면
// session-store.js, constants.js, notification-center.js, weather.js, api.js
// 보다 나중에 로드되어야 합니다.
//
// 정보 우선순위(위→아래): 현재 상태 → 가장 위험한 사고유형 → 지금 할 일 →
// 세부 위험 분석 → 유사 사례 → 시간별 위험도 → 진입 배너
//
// 데이터 소스:
//  - 종합위험도 / 사고유형 / 파이차트  → getLastPredictResult() (실제 모델 응답, 없으면 빈 상태)
//  - 유사사례 TOP3                    → MOCK_CASES (목업, 분석 전엔 빈 상태)
//  - 오늘 시간별 위험도 추이           → 오늘 남은 시간대 실제 날씨 + predictRisk() 실제 호출
//  - 헤더 알림 배지                    → notification-center.js (알림 화면과 동일한 데이터)
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  renderHeaderWeatherMini();
  renderHeaderNotifBadge();

  const lastResult = getLastPredictResult();
  const lastInput = getLastPredictInput();
  const lastSimilarity = getLastSimilarity();
  const siteSetup = hasSiteSetup() ? getSiteSetup() : null;

  // ── 핵심 정보(종합위험도/가장위험한유형/지금할일/세부분석/파이차트): 실제 위험도
  //    분석을 한 번이라도 해야 채워짐
  if (!lastResult) {
    renderHeroEmpty();
    renderFocusEmpty();
    renderStatsEmpty();
    renderPieEmpty();
    renderSimilarEmpty();
  } else {
    renderHero(lastResult);
    renderFocus(lastResult.accident_type);
    renderStats(lastResult);
    renderPieChart(lastResult.accident_type.probabilities);
    renderTypeRankMiniList(lastResult.accident_type.probabilities);

    if (lastSimilarity && lastSimilarity.similar_cases && lastSimilarity.similar_cases.length > 0) {
      renderSimilarCases(lastSimilarity.similar_cases.slice(0, 3), lastSimilarity);
    } else {
      renderSimilarEmpty("유사사례 데이터를 불러오지 못했어요.");
    }
  }

  // ── 오늘 시간별 위험도 추이: 날씨는 분석 여부와 무관하게 매시간 바뀌므로,
  //    "위험도 분석"까지는 안 해도 되고 "현장 설정"(로그인 직후 필수)만 있으면 바로 계산함.
  //    분석을 이미 했다면 그 입력값(작업정보 포함)을 쓰는 게 더 정확해서 우선 사용.
  let trendBasePayload = lastInput || siteSetup;

  // 현장설정만 있고 아직 분석을 한 적 없으면 공정률이 비어있으니, 날짜 기준으로 채워줌
  if (!lastInput && siteSetup && siteSetup["공사시작일"] && siteSetup["공사종료일"]) {
    const progress = calcProgressBucket(siteSetup["공사시작일"], siteSetup["공사종료일"]);
    if (progress) trendBasePayload = { ...siteSetup, "공정률": progress.bucket };
  }

  if (trendBasePayload) {
    renderHourlyRiskTrend(trendBasePayload);
  } else {
    // 현장설정조차 없는 예외적인 경우 (직접 URL 접근 등)
    document.getElementById("trend-section-body").innerHTML = `
      <div class="dashboard-empty">
        <div class="dashboard-empty__icon">🏗️</div>
        <p class="dashboard-empty__text">현장 정보가 없어요.<br>현장 설정을 먼저 완료해주세요.</p>
        <a href="site-setup.html" class="dashboard-empty__btn">현장 설정하러 가기</a>
      </div>
    `;
  }
});

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
    "아직 위험도 분석 결과가 없어요.<br>분석을 진행하면 오늘의 안전 상태가 여기에 표시돼요.",
    "predict-input.html",
    "위험도 분석하러 가기"
  );
  document.getElementById("dash-hero-focus-line").style.display = "none";
}

function renderFocusEmpty() {
  document.getElementById("dash-focus").style.display = "none";
}

function renderStatsEmpty() {
  document.getElementById("stat-grid-wrapper").innerHTML = emptyStateHtml(
    "아직 위험도 분석 결과가 없어요.<br>분석을 진행하면 여기에 수치가 채워져요.",
    "predict-input.html",
    "위험도 분석하러 가기"
  );
}

function renderPieEmpty() {
  document.getElementById("pie-section-body").innerHTML = emptyStateHtml(
    "예측 사고 유형 분류를 보려면 먼저 분석을 진행해주세요.",
    "predict-input.html",
    "위험도 분석하러 가기"
  );
}

function renderSimilarEmpty(text) {
  document.getElementById("similar-case-list").innerHTML = emptyStateHtml(
    text || "위험도 분석을 하면 그 결과 기준 유사사례를 보여드려요.",
    "predict-input.html",
    "위험도 분석하러 가기"
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
    tempEl.textContent = "날씨 오류";
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
  gaugeLabel.textContent = fr.grade;
  gaugeLabel.style.color = riskColor(pct);

  const badgeEl = document.getElementById("dash-hero-badge");
  badgeEl.textContent = fr.grade;
  badgeEl.className = `badge ${gradeToBadgeClass(fr.grade)}`;

  document.getElementById("dash-hero-meta").innerHTML =
    `최근 분석 기준 · 평균 사고 대비 <b>${fr.lift_vs_median}배</b>`;

  // "현재 가장 주의가 필요한 위험: 끼임 (27%)" — 문장 형태로도 한 번 더 확인 가능하게
  const topType = result.accident_type.predicted_type;
  const topShort = ACCIDENT_TYPE_SHORT_LABEL[topType] || topType;
  const topPct = Math.round(result.accident_type.confidence * 100);
  const focusLineEl = document.getElementById("dash-hero-focus-line");
  focusLineEl.innerHTML = `현재 가장 주의가 필요한 위험: <b>${topShort}</b> (${topPct}%)`;
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
  document.getElementById("dash-focus-type").textContent = ACCIDENT_TYPE_SHORT_LABEL[topType] || topType;
  document.getElementById("dash-focus-pct").textContent = `${pct}%`;
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

  document.getElementById("value-lift").textContent = `${fr.lift_vs_median}배`;
  document.getElementById("bar-prob").style.width = `${Math.min(fr.lift_vs_median * 20, 100)}%`;

  document.getElementById("value-severity-class").textContent = result.severity.predicted_class;
  const severityBarPct = { "경+중등도": 20, "중상": 60, "치명": 100 }[result.severity.predicted_class] || 20;
  document.getElementById("bar-fatal").style.width = `${severityBarPct}%`;
}

// ── 파이차트 (실제 5분류 확률 분포)
function renderPieChart(probabilities) {
  const canvas = document.getElementById("type-pie-chart");
  const wrap = canvas.closest(".chart-canvas-wrap");
  const entries = Object.entries(probabilities); // [ [type, prob], ... ]

  try {
    if (typeof Chart === "undefined") throw new Error("Chart.js를 불러오지 못했어요");
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();

    new Chart(canvas, {
      type: "pie",
      data: {
        labels: entries.map(([type]) => ACCIDENT_TYPE_SHORT_LABEL[type] || type),
        datasets: [
          {
            data: entries.map(([, p]) => Math.round(p * 1000) / 10),
            backgroundColor: entries.map(([type]) => ACCIDENT_TYPE_COLORS[type] || "#B0B7C3"),
            borderWidth: 0,
          },
        ],
      },
      options: { plugins: { legend: { display: false } }, maintainAspectRatio: false },
    });
  } catch (err) {
    console.error("[dashboard.js] 파이차트 렌더링 실패:", err);
    wrap.innerHTML = `<p style="text-align:center; padding-top:80px; font-size: var(--fs-sm); color: var(--color-text-secondary);">차트를 불러오지 못했어요.</p>`;
  }

  document.getElementById("type-pie-legend").innerHTML = entries
    .map(([type, p]) => {
      const color = ACCIDENT_TYPE_COLORS[type] || "#B0B7C3";
      const label = ACCIDENT_TYPE_SHORT_LABEL[type] || type;
      return `
        <div class="legend-list__item">
          <span class="legend-list__dot" style="background:${color}"></span>
          ${label}
          <span class="legend-list__pct">${Math.round(p * 100)}%</span>
        </div>
      `;
    })
    .join("");
}

// ── 파이차트 아래 "주요 사고 유형" 순위 텍스트 리스트 (우선순위를 빠르게 파악)
function renderTypeRankMiniList(probabilities) {
  const ranked = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  document.getElementById("type-rank-mini-list").innerHTML = ranked
    .map(([type, p], i) => {
      const color = ACCIDENT_TYPE_COLORS[type] || "#B0B7C3";
      const label = ACCIDENT_TYPE_SHORT_LABEL[type] || type;
      return `
        <div class="similar-case-list__item">
          <span class="similar-case-list__rank">${i + 1}</span>
          <div class="similar-case-list__title" style="flex:1;">${label}</div>
          <span class="badge" style="background:${color}22; color:${color};">${Math.round(p * 100)}%</span>
        </div>
      `;
    })
    .join("");
}

// ── ⑤ 유사사례 TOP3 (제목 / 사고유형 / 유사도만 — 대시보드에서는 가볍게)
function renderSimilarCases(cases, sim) {
  const tagEl = document.getElementById("similar-cases-mock-tag");
  if (tagEl) {
    if (sim._mock) {
      tagEl.textContent = "MOCK";
      tagEl.style.display = "inline-block";
    } else if (sim.is_approximate) {
      tagEl.textContent = "근사치";
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
          <span class="badge" style="background:${color}22; color:${color}; margin-top:2px;">${c.hazard_type}</span>
        </div>
        <span class="similar-case-list__pct">유사 ${c.similarity_percent}%</span>
      </a>
    `;
    })
    .join("");
}

// ── ⑥ 오늘 시간별 위험도 추이
// 최근 분석에 쓰인 입력값(작업정보 등)은 그대로 두고, 기상 필드만 그 시간대 예보값으로
// 바꿔서 predictRisk()를 시간대별로 실제 호출 → 진짜 시간별 위험도를 계산합니다.
async function renderHourlyRiskTrend(basePayload) {
  const canvas = document.getElementById("trend-line-chart");
  const wrap = canvas.closest(".chart-canvas-wrap");
  wrap.insertAdjacentHTML(
    "beforebegin",
    `<p id="trend-loading-note" style="font-size:11px; color:var(--color-text-placeholder); margin-bottom:6px;">⏳ 오늘 시간별 위험도 계산 중...</p>`
  );

  try {
    const { hourlyList } = await getWeatherSnapshot();

    if (!hourlyList || hourlyList.length === 0) {
      document.getElementById("trend-section-body").innerHTML = `
        <div class="dashboard-empty">
          <div class="dashboard-empty__icon">🌙</div>
          <p class="dashboard-empty__text">오늘 남은 예보 시간대가 없어요.<br>내일 다시 확인해주세요.</p>
        </div>
      `;
      return;
    }

    const labels = [];
    const scores = [];

    for (const h of hourlyList) {
      const hourPayload = {
        ...basePayload,
        "기상상태 - 습도": h.humidity,
        "평균기온(°C)": h.temp,
        "일강수량(mm)": h.rain3h,
        "평균 풍속(m/s)": h.windSpeed,
      };
      const result = await predictRisk(hourPayload); // 실제 서버 또는 자동 목업 폴백
      labels.push(h.time);
      scores.push(Math.round(result.severity.fatal_risk.percentile));
    }

    document.getElementById("trend-loading-note")?.remove();

    if (typeof Chart === "undefined") throw new Error("Chart.js를 불러오지 못했어요");
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();

    new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            data: scores,
            borderColor: "#2F5FE0",
            backgroundColor: "rgba(47,95,224,0.08)",
            fill: true,
            tension: 0.35,
            pointBackgroundColor: "#2F5FE0",
          },
        ],
      },
      options: {
        plugins: { legend: { display: false } },
        maintainAspectRatio: false,
        scales: { y: { min: 0, max: 100 } },
      },
    });

    renderTrendInsight(scores);
  } catch (err) {
    console.error("[dashboard.js] 시간별 위험도 추이 계산 실패:", err);
    document.getElementById("trend-loading-note")?.remove();
    wrap.innerHTML = `<p style="text-align:center; padding-top:60px; font-size: var(--fs-sm); color: var(--color-text-secondary);">⚠️ 백엔드 서버에 연결되지 않아 시간별 위험도를 계산할 수 없어요.<br>서버(uvicorn)가 켜져 있는지 확인해주세요.</p>`;
  }
}

// 실제 계산된 시간별 점수가 뚜렷하게 오르내릴 때만 문구를 보여준다 (임의 문구 생성 금지)
function renderTrendInsight(scores) {
  const el = document.getElementById("trend-insight-text");
  if (scores.length < 2) {
    el.style.display = "none";
    return;
  }
  const delta = scores[scores.length - 1] - scores[0];
  if (delta >= 3) {
    el.textContent = "📈 오늘 남은 시간대의 위험도가 상승하는 추세입니다.";
    el.style.display = "";
  } else if (delta <= -3) {
    el.textContent = "📉 오늘 남은 시간대의 위험도가 낮아지는 추세입니다.";
    el.style.display = "";
  } else {
    el.style.display = "none";
  }
}
