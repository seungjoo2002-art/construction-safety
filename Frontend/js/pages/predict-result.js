// ============================================================
// predict-result.js — 분석 결과 화면
// constants.js, session-store.js 보다 나중에 로드되어야 합니다.
// URL에 ?resultId=...가 있으면 알림 화면 등에서 다시 열어본 지난 분석 이력을
// 보여주고, 없으면 predict-loading.html에서 저장한 sessionStorage 값(방금 막
// 끝난 분석)을 읽어 렌더링합니다.
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  const resultId = new URLSearchParams(window.location.search).get("resultId");

  let result, input, sim, advise;

  if (resultId) {
    const record = getSavedResultById(resultId);
    if (!record) {
      // 이력을 못 찾은 경우(삭제됨 등) → 입력 화면으로 되돌림
      window.location.href = "predict-input.html";
      return;
    }
    result = record.result;
    input = record.input || {};
    sim = record.sim || null;
    advise = null; // 지난 이력은 AI 생성문을 다시 보관하지 않음(매번 재생성하면 값이 바뀔 수 있어서)
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
  console.log("[predict-result.js] 유사도 분석 결과 (similar_cases + mds_chart_image + prevention_guidelines):", sim);

  renderScore(result.severity);

  if (sim) {
    // _mock: 백엔드 연결 자체가 실패해서 완전 하드코딩 목업으로 대체된 경우
    // is_approximate: 백엔드는 정상 응답했지만 OPENAI_API_KEY가 없어 실제 DB를
    //   임베딩 대신 카테고리 키워드 매칭으로 근사 계산한 경우 (목업 아님)
    toggleModeTag("scatter-mock-tag", sim);
    toggleModeTag("cases-mock-tag", sim);
    renderScatterImage(sim.mds_chart_image);
    renderSimilarCases(sim.similar_cases);
    renderPrevention(result.accident_type, sim.prevention_guidelines, advise);
  } else {
    renderScatterImage(null); // 유사도 결과 없음 → "불러오지 못했어요" 안내 + 확대 버튼 숨김
    renderPrevention(result.accident_type, null, advise);
  }

  renderAnalysisMeta(input);
  bindActions(result, input);
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

  document.getElementById("score-note").textContent =
    `${fr.grade_description} · 평균 대비 ${fr.lift_vs_median}배, 예측 등급은 "${severity.predicted_class}"입니다.`;
}

function gradeToBadgeClass(grade) {
  if (grade === "매우위험" || grade === "위험") return "badge--danger";
  if (grade === "주의") return "badge--caution";
  return "badge--safe";
}
function gradeToColor(grade) {
  if (grade === "매우위험" || grade === "위험") return "var(--color-danger)";
  if (grade === "주의") return "var(--color-caution)";
  return "var(--color-safe)";
}

// ── 유사 사고 사례 (similarity_service.py의 similar_cases — title/summary/hazard_type/similarity_percent)
function renderSimilarCases(cases) {
  const listEl = document.getElementById("similar-case-list");

  if (!cases || cases.length === 0) {
    listEl.innerHTML = `<p style="font-size: var(--fs-sm); color: var(--color-text-secondary);">유사 사례를 찾지 못했어요.</p>`;
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

// ── "▶ A, B, C" 형태의 대책 한 줄을 짧은 체크리스트 항목 여러 개로 분리
//    (맨 앞의 "▶ " 같은 기호는 제거)
function splitPreventionGuideline(text) {
  return text
    .replace(/^[▶►∙・\-–>\s]+/, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// "N. 문장 (사례 #123)" 형태의 번호 목록에서 머리말(핵심 위험 설명)과 항목 텍스트만 뽑아낸다.
// advisor.py generate_ex()가 항상 "■ 핵심 위험\n설명\n\n■ 안전 조치사항\n1. ...\n2. ..." 형태로
// 준다(실패 시에도 템플릿 안전망이 같은 형식을 보장) — 그 구조를 그대로 파싱한다.
function parseAdviceText(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let intro = "";
  const items = [];
  for (const line of lines) {
    const m = line.match(/^(\d+)\.\s*(.+)$/);
    if (m) {
      items.push(m[2]);
    } else if (!line.startsWith("■") && items.length === 0 && !intro) {
      intro = line; // "■ 핵심 위험" 다음의 설명 한 줄
    }
  }
  return { intro, items };
}

// ── 예방 조치: 아래 우선순위로 한 곳에 모아서 보여준다(EXAONE/Gemini 생성문을 별도
//    카드로 분리하지 않고 이 섹션 안에 통합 — 화면을 두 번 보여줄 필요가 없다는 요청 반영).
//    1순위: advisor.py가 생성한 맞춤 안전수칙(advise.advice) — 근거 KOSHA 사례 원문 포함
//    2순위: similarity_service.py의 prevention_guidelines(SIF 기반 실제 대책)
//    3순위: 예측 TOP1 사고유형 기반 일반 예방수칙(ACCIDENT_TYPE_TIPS)
function renderPrevention(accidentType, guidelines, advise) {
  const gridEl = document.getElementById("tip-grid");

  if (advise && advise.advice) {
    gridEl.style.gridTemplateColumns = "1fr";
    const { intro, items } = parseAdviceText(advise.advice);
    const v = advise.verification;
    const issues = [];
    if (v?.지어낸수치?.length) issues.push(`원문에 없는 수치가 섞였을 수 있어요: ${v.지어낸수치.join(", ")}`);
    if (v?.가짜출처?.length) issues.push(`존재하지 않는 사례 번호가 인용됐어요: #${v.가짜출처.join(", #")}`);
    if (v?.과다재작성?.length) issues.push(`${v.과다재작성.length}개 항목이 원문과 많이 달라졌어요 — 아래 근거 사례 원문과 대조해보세요.`);

    gridEl.innerHTML = `
      <div class="card" style="background: var(--color-safe-bg); padding: var(--space-md);">
        ${intro ? `<p style="font-size: var(--fs-xs); color: var(--color-text-secondary); margin-bottom: var(--space-sm);">🤖 ${escapeHtml(intro)}</p>` : ""}
        ${items
          .map(
            (item) => `
          <div class="prevention-list__item">
            <span class="prevention-list__check">✓</span>
            <span class="prevention-list__text">${escapeHtml(item)}</span>
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
    return;
  }

  if (guidelines && guidelines.length > 0) {
    gridEl.style.gridTemplateColumns = "1fr";
    gridEl.innerHTML = `
      <div class="card" style="background: var(--color-safe-bg); padding: var(--space-md);">
        ${guidelines
          .flatMap(splitPreventionGuideline)
          .map(
            (item) => `
          <div class="prevention-list__item">
            <span class="prevention-list__check">✓</span>
            <span class="prevention-list__text">${item}</span>
          </div>
        `
          )
          .join("")}
      </div>
    `;
    return;
  }

  // ── 폴백: 유사도 서비스 응답이 없을 때
  const topType = accidentType.predicted_type;
  const tips = ACCIDENT_TYPE_TIPS[topType] || [];
  gridEl.style.gridTemplateColumns = "";
  gridEl.innerHTML = tips
    .map(
      (t) => `
      <div class="tip-card">
        <div class="tip-card__icon">${t.icon}</div>
        <div class="tip-card__title">${t.title}</div>
        <div class="tip-card__desc">${t.desc}</div>
      </div>
    `
    )
    .join("");
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ── 분석 정보 (실제 입력값 기반 — 위치는 역지오코딩 미보유로 생략)
function renderAnalysisMeta(input) {
  const metaEl = document.getElementById("analysis-meta");
  const items = [];

  if (input["발생일시"]) {
    items.push(`<span class="analysis-meta__item">🕐 ${input["발생일시"]}</span>`);
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
function bindActions(result, input) {
  const saveBtn = document.getElementById("save-btn");
  const bookmarkBtn = document.getElementById("bookmark-btn");
  const shareBtn = document.getElementById("share-btn");

  function saveResult() {
    const saved = JSON.parse(localStorage.getItem("saved_results") || "[]");
    saved.unshift({
      savedAt: new Date().toISOString(),
      score: Math.round(result.severity.fatal_risk.percentile),
      grade: result.severity.fatal_risk.grade,
      topType: result.accident_type.predicted_type,
      result,
      input,
    });
    localStorage.setItem("saved_results", JSON.stringify(saved.slice(0, 50))); // 최근 50건만 보관
  }

  saveBtn.addEventListener("click", () => {
    saveResult();
    saveBtn.textContent = "✓ 저장됨";
    setTimeout(() => (saveBtn.textContent = "💾 결과 저장하기"), 1500);
  });

  bookmarkBtn.addEventListener("click", () => {
    saveResult();
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