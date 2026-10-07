// ============================================================
// predict-result.js — 분석 결과 화면
// auth.js, constants.js, session-store.js 보다 나중에 로드되어야 합니다.
// URL에 ?resultId=...가 있으면 알림 화면 등에서 다시 열어본 지난 분석 이력을
// 보여주고, 없으면 predict-loading.html에서 저장한 sessionStorage 값(방금 막
// 끝난 분석)을 읽어 렌더링합니다.
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  const resultId = new URLSearchParams(window.location.search).get("resultId");

  let result, input, sim, advise;
  let legacyRecord = false;
  let recordId = resultId || sessionStorage.getItem("predict_result_id");

  if (resultId) {
    let record = null;
    try {
      record = await getSavedResultById(resultId); // 서버가 내 기록이 아니면 404 → null
    } catch (err) {
      console.error("[predict-result.js] 분석 기록 조회 실패", err);
    }
    if (!record) {
      // 이력을 못 찾은 경우(삭제됨 등) → 입력 화면으로 되돌림
      window.location.href = "predict-input.html";
      return;
    }
    result = record.result;
    input = record.input || {};
    sim = record.sim || null;
    // 분석 당시 받은 예방대책 5개를 그대로 다시 보여준다(재생성하면 값이 바뀔 수 있어서 재요청 안 함).
    // 이 필드가 없는 기록은 예전 버전에서 저장된 것 — 구 포맷(▶ 대책)으로 대체하지 않고 안내만 한다.
    advise = record.advise || null;
    legacyRecord = !record.advise;
    // 이 화면에서 "자세히 보기"(scatter-detail.html)로 넘어가도 같은 기록을 보도록 맞춰 둔다
    if (sim) sessionStorage.setItem("similarity_result", JSON.stringify(sim));
    else sessionStorage.removeItem("similarity_result");
    if (advise) sessionStorage.setItem("advise_result", JSON.stringify(advise));
    else sessionStorage.removeItem("advise_result");
  } else {
    const resultRaw = sessionStorage.getItem("predict_result");
    const inputRaw = sessionStorage.getItem("predict_result_input");
    const simRaw = sessionStorage.getItem("similarity_result");
    const adviseRaw = sessionStorage.getItem("advise_result");

    if (!resultRaw) {
      // 결과 없이 이 화면에 바로 들어온 경우 → 입력 화면으로 되돌림
      window.location.href = "predict-input.html";
      return;
    }

    result = JSON.parse(resultRaw); // { severity, accident_type }
    input = inputRaw ? JSON.parse(inputRaw) : {};
    sim = simRaw ? JSON.parse(simRaw) : null; // { similar_cases, mds_chart_image, prevention_guidelines, _mock?, is_approximate? }
    advise = adviseRaw ? JSON.parse(adviseRaw) : null; // { evidence, advice, verification, retrieval }
  }

  // ── 디버깅용: 이 결과 화면에 쓰인 입력 변수/결과값을 콘솔에 그대로 표시
  console.log("[predict-result.js] 위험도 분석 입력 변수:", input);
  console.table(input);
  console.log("[predict-result.js] 위험도 분석 결과 (severity + accident_type):", result);
  console.log("[predict-result.js] 유사도 분석 결과 (similar_cases + mds_chart_image):", sim);
  console.log("[predict-result.js] 예방대책 (/api/advise items):", advise);

  renderPeakHour(result); // hourly가 없는 예전 기록이면 섹션을 숨긴 채로 둔다
  renderScore(result.severity);

  if (sim) {
    // _mock: 백엔드 연결 자체가 실패해서 완전 하드코딩 목업으로 대체된 경우
    // is_approximate: 백엔드는 정상 응답했지만 OPENAI_API_KEY가 없어 실제 DB를
    //   임베딩 대신 카테고리 키워드 매칭으로 근사 계산한 경우 (목업 아님)
    toggleModeTag("scatter-mock-tag", sim);
    toggleModeTag("cases-mock-tag", sim);
    renderScatterImage(sim.mds_chart_image);
    renderSimilarCases(sim.similar_cases);
  } else {
    renderScatterImage(null); // 유사도 결과 없음 → "불러오지 못했어요" 안내 + 확대 버튼 숨김
    renderSimilarCases(null, true);
  }
  renderPrevention(advise, legacyRecord);

  renderAnalysisMeta(input, result.hourly);
  bindActions(result, input, sim, advise, recordId);
});

function toggleModeTag(id, sim) {
  const el = document.getElementById(id);
  if (!el) return;
  if (sim._mock) {
    el.textContent = "MOCK";
    el.style.display = "inline-block";
  } else if (sim.is_approximate) {
    el.textContent = "근사치";
    el.style.display = "inline-block";
  } else {
    el.style.display = "none";
  }
}

// ── 유사도 산점도 미니 이미지 (백엔드 /api/analyze가 렌더링해서 내려주는 이미지)
//    이미지 자체 또는 "🔍 자세히 보기" 버튼을 누르면 전체화면 뷰어로 확대한다.
function renderScatterImage(imageUrl) {
  const img = document.getElementById("scatter-mini-image");
  const zoomBtn = document.getElementById("scatter-zoom-btn");
  const showError = () => {
    img.closest(".scatter-mini-canvas-wrap").innerHTML =
      `<p style="text-align:center; padding:60px 0; font-size:14px; color:#888;">산점도 이미지를 불러오지 못했어요.</p>`;
    zoomBtn.hidden = true; // 확대할 이미지가 없으면 버튼도 숨김
  };
  if (!imageUrl) {
    showError();
    return;
  }

  const openViewer = () =>
    ImageViewer.open(imageUrl, {
      alt: "유사도 산점도 차트",
      caption: "두 손가락으로 확대 · 두 번 탭하면 확대/원래대로",
      detailHref: "scatter-detail.html",
      detailLabel: "유사 사례·재발 방지 대책 보기 →",
    });

  img.onerror = showError; // src는 있는데 디코딩/로드 자체가 실패한 경우까지 잡아줌
  img.src = imageUrl;
  ImageViewer.bindTrigger(img, openViewer);
  zoomBtn.addEventListener("click", openViewer);
}

// ── 오늘 가장 위험한 시간대 (/api/predict-hourly의 hourly — 분석 당시 값을 그대로 복원)
function formatHour(h) {
  return `${String(h).padStart(2, "0")}:00`;
}
// 위험도는 모형 확률(p_fatal)이 아니라 기준분포 백분위로 표시한다 — 모형이 언더샘플링·가중치로
// 학습돼 확률이 실제 치명률과 어긋나 있으므로 "치명 확률 70%"처럼 띄우면 틀린 정보가 된다.
function formatScore(percentile) {
  return `${Math.round(percentile)}점`;
}
function formatTop(percentile) {
  return `상위 ${Math.max(0.1, 100 - percentile).toFixed(1)}%`;
}

function renderPeakHour(result) {
  const hourly = result.hourly;
  if (!hourly || !Array.isArray(hourly.points) || hourly.points.length === 0) return;

  const fr = result.severity.fatal_risk;
  document.getElementById("peak-hour-section").style.display = "block";
  document.getElementById("peak-hour-time").textContent = formatHour(hourly.peak_hour);
  const gradeEl = document.getElementById("peak-hour-grade");
  gradeEl.textContent = fr.grade;
  gradeEl.className = `badge ${gradeToBadgeClass(fr.grade)}`;
  document.getElementById("peak-hour-pfatal").textContent = formatTop(fr.percentile);
  const type = result.accident_type?.predicted_type;
  document.getElementById("peak-hour-type").textContent = type ? ACCIDENT_TYPE_SHORT_LABEL[type] || type : "--";

  document.getElementById("hourly-chart-caption").textContent =
    `${hourly.date} · ${formatHour(hourly.start_hour)}~${formatHour(hourly.end_hour)} · 1시간 간격 ${hourly.points.length}회 분석` +
    (hourly.points.length > 1 ? " · 같은 값이면 이른 시간 우선" : "");

  document.getElementById("hourly-table").innerHTML =
    `<thead><tr><th>시간</th><th>근무형태</th><th>위험도 점수</th><th>등급</th></tr></thead><tbody>` +
    hourly.points
      .map(
        (p) => `<tr class="${p.hour === hourly.peak_hour ? "is-peak" : ""}">
          <td>${formatHour(p.hour)}${p.hour === hourly.peak_hour ? " ▲" : ""}</td>
          <td>${p.shift_type || "-"}</td><td>${p.percentile.toFixed(1)}</td><td>${p.grade}</td></tr>`
      )
      .join("") +
    `</tbody>`;

  const chartEl = document.getElementById("hourly-chart");
  renderHourlyChart(chartEl, hourly);
  let lastWidth = chartEl.clientWidth;
  window.addEventListener("resize", () => {
    if (chartEl.clientWidth !== lastWidth) {
      lastWidth = chartEl.clientWidth;
      renderHourlyChart(chartEl, hourly);
    }
  });
}

// 시간대별 위험도 점수(백분위) 꺾은선 (단일 계열 — 범례 없음). 가장 위험한 시간은 빨간 점 + 값 라벨로 강조.
// SVG 좌표를 실제 픽셀 폭에 맞춰 그려 글자 크기가 화면 폭에 따라 줄어들지 않게 한다.
function renderHourlyChart(el, hourly) {
  const pts = hourly.points;
  const W = Math.max(el.clientWidth, 260);
  const H = 180;
  const m = { top: 26, right: 14, bottom: 24, left: 38 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;

  // 점수가 한쪽에 몰려 있어도 변화가 보이게 y축을 값 범위에 맞춰 10점 단위로 자른다
  const vals = pts.map((p) => p.percentile);
  let yMin = Math.max(0, Math.floor((Math.min(...vals) - 2) / 10) * 10);
  let yMax = Math.min(100, Math.ceil((Math.max(...vals) + 2) / 10) * 10);
  if (yMax - yMin < 20) {
    yMin = Math.max(0, Math.min(yMin, yMax - 20));
    yMax = Math.min(100, yMin + 20);
  }
  const x = (i) => m.left + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
  const y = (v) => m.top + ih - ((v - yMin) / (yMax - yMin)) * ih;

  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  const labelEvery = Math.ceil(pts.length / Math.max(1, Math.floor(iw / 34))); // 라벨 간 최소 ~34px
  const peakIdx = pts.findIndex((p) => p.hour === hourly.peak_hour);
  const svgNs = "http://www.w3.org/2000/svg";

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="시간대별 위험도 점수. 가장 위험한 시간 ${formatHour(hourly.peak_hour)} ${formatScore(pts[peakIdx].percentile)}" xmlns="${svgNs}">`;
  yTicks.forEach((v) => {
    svg += `<line class="hourly-chart__grid" x1="${m.left}" x2="${W - m.right}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text class="hourly-chart__axis-text" x="${m.left - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`;
  });
  pts.forEach((p, i) => {
    const isPeak = i === peakIdx;
    // 간격(labelEvery)마다 + 마지막 시각 + 가장 위험한 시간은 항상. 강조 라벨과 24px 안쪽이면 겹치지 않게 생략
    const wanted = i % labelEvery === 0 || i === pts.length - 1;
    if (!isPeak && (!wanted || Math.abs(x(i) - x(peakIdx)) < 24)) return;
    svg += `<text class="hourly-chart__axis-text" x="${x(i)}" y="${H - 6}" text-anchor="middle"${isPeak ? ' style="fill:var(--color-danger);font-weight:700"' : ""}>${String(p.hour).padStart(2, "0")}</text>`;
  });
  if (pts.length > 1) {
    svg += `<polyline class="hourly-chart__line" points="${pts.map((p, i) => `${x(i)},${y(p.percentile)}`).join(" ")}"/>`;
  }
  svg += `<line class="hourly-chart__cursor" id="hourly-cursor" y1="${m.top}" y2="${m.top + ih}" x1="0" x2="0" style="display:none"/>`;
  pts.forEach((p, i) => {
    if (i !== peakIdx) svg += `<circle class="hourly-chart__dot" cx="${x(i)}" cy="${y(p.percentile)}" r="${pts.length > 16 ? 3 : 4}"/>`;
  });
  // 가장 위험한 시간: 큰 빨간 점 + 값 라벨 (가장자리에서 잘리지 않게 정렬 보정)
  const px = x(peakIdx);
  const py = y(pts[peakIdx].percentile);
  const anchor = px > W - 50 ? "end" : px < m.left + 40 ? "start" : "middle";
  svg += `<circle class="hourly-chart__dot hourly-chart__dot--peak" cx="${px}" cy="${py}" r="6"/>`;
  svg += `<text class="hourly-chart__peak-text" x="${px}" y="${py - 11}" text-anchor="${anchor}">${formatHour(hourly.peak_hour)} ${formatScore(pts[peakIdx].percentile)}</text>`;
  // 터치/호버 영역: 점보다 넓은 세로 띠
  const band = pts.length === 1 ? iw : iw / (pts.length - 1);
  pts.forEach((p, i) => {
    svg += `<rect class="hourly-chart__hit" data-i="${i}" x="${x(i) - band / 2}" y="${m.top}" width="${band}" height="${ih}"/>`;
  });
  svg += `</svg><div class="hourly-chart__tip" id="hourly-tip" style="display:none"></div>`;
  el.innerHTML = svg;

  const tip = el.querySelector("#hourly-tip");
  const cursor = el.querySelector("#hourly-cursor");
  const show = (i) => {
    const p = pts[i];
    tip.textContent = `${formatHour(p.hour)} · ${formatScore(p.percentile)} · ${p.grade}${p.shift_type ? ` · ${p.shift_type}` : ""}`;
    tip.style.display = "block";
    tip.style.left = `${Math.min(Math.max(x(i), 60), W - 60)}px`;
    tip.style.top = `${Math.max(0, y(p.percentile) - 44)}px`;
    cursor.setAttribute("x1", x(i));
    cursor.setAttribute("x2", x(i));
    cursor.style.display = "block";
  };
  const hide = () => {
    tip.style.display = "none";
    cursor.style.display = "none";
  };
  el.querySelectorAll(".hourly-chart__hit").forEach((r) => {
    const i = Number(r.dataset.i);
    r.addEventListener("pointerenter", () => show(i));
    r.addEventListener("pointerdown", () => show(i));
  });
  el.querySelector("svg").addEventListener("pointerleave", hide);
}

// ── 종합 위험도 (fatal_risk.percentile을 0~100 점수로 그대로 사용)
function renderScore(severity) {
  const fr = severity.fatal_risk;
  const score = Math.round(fr.percentile);

  document.getElementById("score-number").textContent = score;

  const badgeEl = document.getElementById("score-badge");
  badgeEl.textContent = fr.grade;
  badgeEl.className = `badge ${gradeToBadgeClass(fr.grade)}`;

  const knob = document.getElementById("risk-bar-knob");
  knob.style.left = `${score}%`;
  knob.style.borderColor = gradeToColor(fr.grade);

  // grade_fatal_rate/lift_vs_base: 이 등급에 속한 실제 사고(OOF 27,907명)의 치명률 검증값.
  // 예전 모형으로 저장된 기록에는 없고 lift_vs_median만 있다.
  const evidence =
    fr.grade_fatal_rate != null
      ? `이 등급의 실제 치명률 ${fr.grade_fatal_rate}% (전체 평균 ${fr.base_fatal_rate}%의 ${fr.lift_vs_base}배)`
      : `평균 대비 ${fr.lift_vs_median}배`;
  document.getElementById("score-note").textContent =
    `${fr.grade_description} · ${evidence}, 예측 심각도는 "${severity.predicted_class}"입니다.`;
}

function gradeToBadgeClass(grade) {
  return `badge--${riskGradeLevel(grade)}`;
}
function gradeToColor(grade) {
  return `var(--color-${riskGradeLevel(grade)})`;
}

// ── 유사 사고 사례 (similarity_service.py의 similar_cases — title/summary/hazard_type/similarity_percent)
function renderSimilarCases(cases, failed = false) {
  const listEl = document.getElementById("similar-case-list");

  if (!cases || cases.length === 0) {
    listEl.innerHTML = failed
      ? `<p style="font-size: var(--fs-sm); color: var(--color-danger);">⚠️ 유사 사례 서버 응답을 받지 못했어요. 잠시 후 다시 분석해주세요.</p>`
      : `<p style="font-size: var(--fs-sm); color: var(--color-text-secondary);">유사 사례를 찾지 못했어요.</p>`;
    return;
  }

  listEl.innerHTML = cases
    .slice(0, 3)
    .map((c, i) => {
      const color = SIM_HAZARD_COLORS[c.hazard_type] || "#B0B7C3";
      return `
      <a href="case-detail.html?id=${encodeURIComponent(c.id)}" class="similar-case-list__item">
        <span class="similar-case-list__rank">${i + 1}</span>
        <div>
          <div class="similar-case-list__title">${c.title}</div>
          <div class="similar-case-list__date">
            <span class="badge" style="background:${color}22; color:${color};">${c.hazard_type}</span>
          </div>
          <div class="similar-case-list__summary text-clamp-1">${c.summary}</div>
        </div>
        <span class="similar-case-list__pct">유사 ${c.similarity_percent}%</span>
      </a>
    `;
    })
    .join("");
}

// ── 예방 조치: 백엔드 /api/advise가 확정한 핵심 예방대책 5개(items)를 그대로 그린다.
//    (KOSHA 사례 검색 → 재서술(EXAONE/Gemini, 불가 시 원문 템플릿) → 중복 제거 → 정확히 5개)
//    프론트에서 텍스트를 다시 파싱하거나 개수를 자르지 않는다. 받지 못했으면 예전처럼
//    /api/analyze의 "▶ ..." 구 포맷 대책이나 일반 수칙으로 대체하지 않고 오류를 그대로 보여준다.
function renderPrevention(advise, legacyRecord) {
  const gridEl = document.getElementById("tip-grid");
  gridEl.style.gridTemplateColumns = "1fr";

  if (!advise || !Array.isArray(advise.items) || advise.items.length === 0) {
    const msg = legacyRecord
      ? "이 기록은 이전 버전에서 저장되어 핵심 예방대책이 없어요. 같은 조건으로 새로 분석하면 확인할 수 있어요."
      : "⚠️ 예방 대책 서버 응답을 받지 못했어요. 잠시 후 다시 분석해주세요.";
    gridEl.innerHTML = `<p style="font-size: var(--fs-sm); color: ${legacyRecord ? "var(--color-text-secondary)" : "var(--color-danger)"};">${msg}</p>`;
    return;
  }

  const v = advise.verification;
  const issues = [];
  if (v?.지어낸수치?.length) issues.push(`원문에 없는 수치가 섞였을 수 있어요: ${v.지어낸수치.join(", ")}`);
  if (v?.가짜출처?.length) issues.push(`존재하지 않는 사례 번호가 인용됐어요: #${v.가짜출처.join(", #")}`);
  if (v?.과다재작성?.length) issues.push(`${v.과다재작성.length}개 항목이 원문과 많이 달라졌어요 — 아래 근거 사례 원문과 대조해보세요.`);

  gridEl.innerHTML = `
    <div class="card" style="background: var(--color-safe-bg); padding: var(--space-md);">
      ${advise.intro ? `<p style="font-size: var(--fs-xs); color: var(--color-text-secondary); margin-bottom: var(--space-sm);">🤖 ${escapeHtml(advise.intro)}</p>` : ""}
      ${advise.items
        .map(
          (item, i) => `
        <div class="prevention-list__item">
          <span class="prevention-list__check">${i + 1}</span>
          <span class="prevention-list__text">${escapeHtml(item.text)}${
            item.case_id != null
              ? ` <span style="font-size:11px; color:var(--color-text-placeholder);">(KOSHA 사례 #${escapeHtml(String(item.case_id))})</span>`
              : ""
          }</span>
        </div>
      `
        )
        .join("")}
      ${
        issues.length
          ? `<div style="margin-top: var(--space-sm); font-size: var(--fs-xs); color: var(--color-caution); background: var(--color-caution-bg); padding: var(--space-sm); border-radius: 8px;">
               ⚠️ AI 생성문 자동 검증<br>${issues.map((t) => `· ${escapeHtml(t)}`).join("<br>")}
             </div>`
          : ""
      }
      ${
        advise.evidence?.length
          ? `<details style="margin-top: var(--space-sm);">
               <summary style="cursor:pointer; font-size: var(--fs-xs); color: var(--color-text-secondary);">📋 근거가 된 KOSHA 사례 원문 보기</summary>
               <div style="margin-top: var(--space-sm);">
                 ${advise.evidence
                   .map((e) => {
                     const lowSim = e.점수 < 0.3;
                     return `
                       <div class="prevention-list__item" style="align-items:flex-start;">
                         <span class="prevention-list__check">📋</span>
                         <span class="prevention-list__text">
                           ${escapeHtml(e.대책)}
                           <span style="display:block; font-size:11px; color:var(--color-text-placeholder); margin-top:2px;">
                             KOSHA 사례 #${e.출처.id} · ${escapeHtml(e.출처.공종)}/${escapeHtml(e.출처.작업명)} · ${escapeHtml(e.출처.재해종류)}
                             ${lowSim ? " · <span style=\"color:var(--color-caution);\">참고용(유사도 낮음)</span>" : ""}
                           </span>
                         </span>
                       </div>
                     `;
                   })
                   .join("")}
               </div>
             </details>`
          : ""
      }
    </div>
  `;
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ── 분석 정보 (실제 입력값 기반 — 위치는 역지오코딩 미보유로 생략)
function renderAnalysisMeta(input, hourly) {
  const metaEl = document.getElementById("analysis-meta");
  const items = [];

  if (input["발생일시"]) {
    items.push(`<span class="analysis-meta__item">🕐 ${input["발생일시"]}</span>`);
  }
  if (hourly) {
    items.push(
      `<span class="analysis-meta__item">⏰ 작업시간 ${formatHour(hourly.start_hour)}~${formatHour(hourly.end_hour)}</span>`
    );
  }
  if (input["_weather_description"]) {
    items.push(`<span class="analysis-meta__item">☁️ 날씨: ${input["_weather_description"]}</span>`);
  }
  if (input["평균기온(°C)"] !== undefined) {
    items.push(`<span class="analysis-meta__item">🌡 온도: ${Math.round(input["평균기온(°C)"])}°C</span>`);
  }

  metaEl.innerHTML = items.length
    ? items.join("")
    : `<span class="analysis-meta__item">분석 정보를 불러오지 못했어요.</span>`;
}

// ── 저장 / 공유 액션
function bindActions(result, input, sim, advise, recordId) {
  const saveBtn = document.getElementById("save-btn");
  const bookmarkBtn = document.getElementById("bookmark-btn");
  const shareBtn = document.getElementById("share-btn");

  // 분석이 끝나면 predict-loading.js가 이미 내 기록(서버)에 저장해 두므로, 기록 id가 있으면
  // 중복 저장하지 않는다. 자동 저장이 실패했던 경우(id 없음)에만 여기서 저장한다.
  async function saveResult() {
    if (recordId) return true;
    try {
      recordId = await saveAnalysisRecord(result, input, sim, advise);
      sessionStorage.setItem("predict_result_id", recordId);
      return true;
    } catch (err) {
      console.error("[predict-result.js] 저장 실패", err);
      alert(`저장하지 못했어요: ${err.message}`);
      return false;
    }
  }

  saveBtn.addEventListener("click", async () => {
    if (!(await saveResult())) return;
    saveBtn.textContent = "✓ 분석 보관소에 저장됨";
    setTimeout(() => (saveBtn.textContent = "💾 결과 저장하기"), 1500);
  });

  bookmarkBtn.addEventListener("click", async () => {
    if (!(await saveResult())) return;
    bookmarkBtn.textContent = "✅";
    setTimeout(() => (bookmarkBtn.textContent = "🔖"), 1200);
  });

  shareBtn.addEventListener("click", async () => {
    const shareText = `[AI 건설현장 안전관리] 종합 위험도 ${Math.round(
      result.severity.fatal_risk.percentile
    )}점(${result.severity.fatal_risk.grade}) · 예측 사고유형: ${result.accident_type.predicted_type}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: "위험도 분석 결과", text: shareText });
      } catch (err) {
        // 사용자가 공유를 취소한 경우 등 — 별다른 처리 불필요
      }
    } else {
      alert("이 브라우저는 공유 기능을 지원하지 않아요. 아래 내용을 복사해서 사용해주세요:\n\n" + shareText);
    }
  });
}