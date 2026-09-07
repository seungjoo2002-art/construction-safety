// ============================================================
// predict-result.js — 분석 결과 화면
// constants.js 보다 나중에 로드되어야 합니다.
// predict-loading.html에서 저장한 sessionStorage 값을 읽어 렌더링합니다.
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  const resultRaw = sessionStorage.getItem("predict_result");
  const inputRaw = sessionStorage.getItem("predict_result_input");
  const simRaw = sessionStorage.getItem("similarity_result");

  if (!resultRaw) {
    // 결과 없이 이 화면에 바로 들어온 경우 → 입력 화면으로 되돌림
    window.location.href = "predict-input.html";
    return;
  }

  const result = JSON.parse(resultRaw); // { severity, accident_type }
  const input = inputRaw ? JSON.parse(inputRaw) : {};
  const sim = simRaw ? JSON.parse(simRaw) : null; // { similar_cases, mds_chart_image, prevention_guidelines, _mock?, is_approximate? }

  renderScore(result.severity);
  renderTypeRankList(result.accident_type);

  if (sim) {
    // _mock: 백엔드 연결 자체가 실패해서 완전 하드코딩 목업으로 대체된 경우
    // is_approximate: 백엔드는 정상 응답했지만 OPENAI_API_KEY가 없어 실제 DB를
    //   임베딩 대신 카테고리 키워드 매칭으로 근사 계산한 경우 (목업 아님)
    toggleModeTag("scatter-mock-tag", sim);
    toggleModeTag("cases-mock-tag", sim);
    renderScatterImage(sim.mds_chart_image);
    renderSimilarCases(sim.similar_cases);
    renderPrevention(result.accident_type, sim.prevention_guidelines);
  } else {
    renderPrevention(result.accident_type, null);
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
function renderScatterImage(imageUrl) {
  const img = document.getElementById("scatter-mini-image");
  const showError = () => {
    img.closest(".scatter-mini-canvas-wrap").innerHTML =
      `<p style="text-align:center; padding:60px 0; font-size:14px; color:#888;">산점도 이미지를 불러오지 못했어요.</p>`;
  };
  if (imageUrl) {
    img.onerror = showError; // src는 있는데 디코딩/로드 자체가 실패한 경우까지 잡아줌
    img.src = imageUrl;
  } else {
    showError();
  }
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

// ── 예측 사고 유형 순위 (실제 백엔드 응답 형태 그대로 사용)
function renderTypeRankList(accidentType) {
  const listEl = document.getElementById("type-rank-list");
  const top = accidentType.ranked_types.slice(0, 4); // 상위 4개만 표시

  listEl.innerHTML = top
    .map((r) => {
      const color = ACCIDENT_TYPE_COLORS[r.type] || "#B0B7C3";
      const shortLabel = ACCIDENT_TYPE_SHORT_LABEL[r.type] || r.type;
      const badgeClass =
        r.likelihood === "매우높음" || r.likelihood === "높음"
          ? "badge--danger"
          : r.likelihood === "보통"
          ? "badge--caution"
          : "badge--safe";

      return `
        <div class="type-rank-item">
          <span class="type-rank-item__icon" style="background:${color}"></span>
          <div>
            <div class="type-rank-item__title">
              ${shortLabel}
              <span class="badge ${badgeClass}">${r.likelihood}</span>
            </div>
            <div class="type-rank-item__desc">
              발생확률 ${Math.round(r.probability * 100)}% · ${r.likelihood_description}
            </div>
          </div>
        </div>
      `;
    })
    .join("");
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
      <div class="similar-case-list__item">
        <span class="similar-case-list__rank">${i + 1}</span>
        <div>
          <div class="similar-case-list__title">${c.title}</div>
          <div class="similar-case-list__date">
            <span class="badge" style="margin-right:4px; background:${color}22; color:${color};">${c.hazard_type}</span>
            ${c.summary}
          </div>
        </div>
        <span class="similar-case-list__pct">유사 ${c.similarity_percent}%</span>
      </div>
    `;
    })
    .join("");
}

// ── 예방 조치: similarity_service.py의 prevention_guidelines(SIF 기반 실제 대책) 우선 사용,
//    없으면 예측 TOP1 사고유형 기반 일반 예방수칙(ACCIDENT_TYPE_TIPS)으로 대체
function renderPrevention(accidentType, guidelines) {
  const gridEl = document.getElementById("tip-grid");

  if (guidelines && guidelines.length > 0) {
    gridEl.style.gridTemplateColumns = "1fr";
    gridEl.innerHTML = `
      <div class="card" style="background: var(--color-safe-bg); padding: var(--space-md);">
        ${guidelines
          .map(
            (g) => `
          <div class="prevention-list__item">
            <span class="prevention-list__check">✓</span>
            <span>${g}</span>
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