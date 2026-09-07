// ============================================================
// dashboard.js — 대시보드 화면
// session-store.js, constants.js, weather.js, api.js, mock-cases.js
// 보다 나중에 로드되어야 합니다.
//
// 데이터 소스:
//  - 종합위험도 / 사고유형 / 파이차트  → getLastPredictResult() (실제 모델 응답, 없으면 빈 상태)
//  - 유사사례 TOP3                    → MOCK_CASES (목업, 분석 전엔 빈 상태)
//  - 오늘 시간별 위험도 추이           → 오늘 남은 시간대 실제 날씨 + predictRisk() 실제 호출
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  renderHeaderWeatherMini();
  renderGreetingName();

  const lastResult = getLastPredictResult();
  const lastInput = getLastPredictInput();
  const lastSimilarity = getLastSimilarity();
  const siteSetup = hasSiteSetup() ? getSiteSetup() : null;

  // ── 통계/파이차트/유사사례: 실제 위험도 분석을 한 번이라도 해야 채워짐
  if (!lastResult) {
    renderStatsEmpty();
    renderPieEmpty();
    renderSimilarEmpty();
  } else {
    renderStats(lastResult);
    renderPieChart(lastResult.accident_type.probabilities);

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

// ── 인사말: 로그인한 계정의 실제 이름으로 표시 (없으면 "관리자님" 유지)
function renderGreetingName() {
  const loggedInUsername = localStorage.getItem("logged_in_username");
  const registeredUsers = JSON.parse(localStorage.getItem("registered_users") || "[]");
  const account = registeredUsers.find((u) => u.username === loggedInUsername);

  if (account && account.name) {
    document.getElementById("greeting-name").textContent = `${account.name}님`;
  }
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

function riskColor(pct) {
  if (pct >= 80) return "var(--color-danger)";
  if (pct >= 50) return "var(--color-caution)";
  return "var(--color-safe)";
}

// ── 통계 카드 4개 (실제 predict_severity.py / predict_accident_type.py 응답 기반)
function renderStats(result) {
  const fr = result.severity.fatal_risk;
  const pct = Math.round(fr.percentile);

  // 종합 위험도 게이지
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

  // 평균 대비 위험도 (lift_vs_median — README상 raw 확률(p_fatal)은 직접 노출 금지라 배수로 표시)
  document.getElementById("value-lift").textContent = `${fr.lift_vs_median}배`;
  document.getElementById("bar-prob").style.width = `${Math.min(fr.lift_vs_median * 20, 100)}%`;

  // 예측 심각도 (경+중등도 / 중상 / 치명)
  document.getElementById("value-severity-class").textContent = result.severity.predicted_class;
  const severityBarPct = { "경+중등도": 20, "중상": 60, "치명": 100 }[result.severity.predicted_class] || 20;
  document.getElementById("bar-fatal").style.width = `${severityBarPct}%`;

  // 예측 사고유형 TOP1
  document.getElementById("value-top-type").textContent =
    (ACCIDENT_TYPE_SHORT_LABEL && ACCIDENT_TYPE_SHORT_LABEL[result.accident_type.predicted_type]) ||
    result.accident_type.predicted_type;
  document.getElementById("value-top-type-pct").textContent = `${Math.round(result.accident_type.confidence * 100)}%`;
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

// ── 유사사례 TOP3 (similarity_service.py 연동, 서버 없으면 자동 목업)
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
      <div class="similar-case-list__item">
        <span class="similar-case-list__rank">${i + 1}</span>
        <div>
          <div class="similar-case-list__title">${c.title}</div>
          <div class="similar-case-list__date">
            <span class="badge" style="background:${color}22; color:${color};">${c.hazard_type}</span>
          </div>
          <div class="similar-case-list__summary text-clamp-1">${c.summary}</div>
        </div>
        <span class="similar-case-list__pct">유사 ${c.similarity_percent}%</span>
      </div>
    `;
    })
    .join("");
}

// ── 오늘 시간별 위험도 추이
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
  } catch (err) {
    console.error("[dashboard.js] 시간별 위험도 추이 계산 실패:", err);
    document.getElementById("trend-loading-note")?.remove();
    wrap.innerHTML = `<p style="text-align:center; padding-top:60px; font-size: var(--fs-sm); color: var(--color-text-secondary);">⚠️ 백엔드 서버에 연결되지 않아 시간별 위험도를 계산할 수 없어요.<br>서버(uvicorn)가 켜져 있는지 확인해주세요.</p>`;
  }
}