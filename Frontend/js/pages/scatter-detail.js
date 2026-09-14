// ============================================================
// scatter-detail.js — 유사도 산점도 분석 상세 화면
// constants.js 보다 나중에 로드되어야 합니다.
// sessionStorage의 'similarity_result' (predict-loading.js가 저장)를 사용합니다.
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  const simRaw = sessionStorage.getItem("similarity_result");

  if (!simRaw) {
    // 이 화면은 위험도 분석 직후 생기는 유사도 데이터를 보여주는 화면이라, 없으면 되돌려보냄
    window.location.href = "predict-input.html";
    return;
  }

  const sim = JSON.parse(simRaw); // { similar_cases, mds_chart_image, prevention_guidelines, _mock?, is_approximate? }

  const tagEl = document.getElementById("header-mock-tag");
  if (sim._mock) {
    tagEl.textContent = "MOCK";
    tagEl.style.display = "inline-block";
  } else if (sim.is_approximate) {
    tagEl.textContent = "근사치";
    tagEl.style.display = "inline-block";
  } else {
    tagEl.style.display = "none";
  }

  renderScatterImage(sim.mds_chart_image);
  renderSimilarCases(sim.similar_cases);
  renderPreventionList(sim.prevention_guidelines);
});

// ── 유사도 산점도 이미지 (백엔드 /api/analyze가 렌더링해서 내려주는 이미지)
function renderScatterImage(imageUrl) {
  const img = document.getElementById("scatter-full-image");
  const showError = () => {
    img.outerHTML = `<p style="text-align:center; padding:80px 0; font-size:14px; color:#888;">산점도 이미지를 불러오지 못했어요.</p>`;
  };
  if (imageUrl) {
    img.onerror = showError; // src는 있는데 디코딩/로드 자체가 실패한 경우까지 잡아줌
    img.src = imageUrl;
  } else {
    showError();
  }
}

// ── 유사 사고 사례 (predict-result.js의 renderSimilarCases와 동일한 스타일)
function renderSimilarCases(cases) {
  const listEl = document.getElementById("similar-case-list");

  if (!cases || cases.length === 0) {
    listEl.innerHTML = `<p style="font-size: var(--fs-sm); color: var(--color-text-secondary);">유사 사례를 찾지 못했어요.</p>`;
    return;
  }

  listEl.innerHTML = cases
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

// ── "▶ A, B, C" 형태의 대책 한 줄을 짧은 체크리스트 항목 여러 개로 분리
//    (맨 앞의 "▶ " 같은 기호는 제거) — predict-result.js와 동일한 로직
function splitPreventionGuideline(text) {
  return text
    .replace(/^[▶►∙・\-–>\s]+/, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── 재발 방지 대책 (predict-result.js의 renderPrevention과 동일한 스타일)
function renderPreventionList(guidelines) {
  const listEl = document.getElementById("prevention-list");

  if (!guidelines || guidelines.length === 0) {
    listEl.innerHTML = `<p style="font-size: var(--fs-sm); color: var(--color-text-secondary);">재발 방지 대책을 불러오지 못했어요.</p>`;
    return;
  }

  listEl.innerHTML = guidelines
    .flatMap(splitPreventionGuideline)
    .map(
      (item) => `
      <div class="prevention-list__item">
        <span class="prevention-list__check">✓</span>
        <span class="prevention-list__text">${item}</span>
      </div>
    `
    )
    .join("");
}
