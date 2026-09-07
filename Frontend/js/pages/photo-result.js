// ============================================================
// photo-result.js — 사진 분석 결과 화면
// photo-analyzing.html에서 저장한 sessionStorage 값을 읽어 렌더링합니다.
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  const resultRaw = sessionStorage.getItem("photo_result");
  const photoDataUrl = sessionStorage.getItem("captured_photo");

  if (!resultRaw || !photoDataUrl) {
    window.location.href = "photo-capture.html";
    return;
  }

  const result = JSON.parse(resultRaw);

  renderImageWithBoxes(photoDataUrl, result.boxes);
  renderScore(result);
  renderHazardList(result.hazards);
  bindActions(result);
});

const BOX_COLOR = {
  danger: "var(--color-danger)",
  caution: "var(--color-caution)",
  safe: "var(--color-safe)",
};

function renderImageWithBoxes(photoDataUrl, boxes) {
  const container = document.getElementById("photo-result-image");
  const boxesHtml = boxes
    .map((b) => {
      const color = BOX_COLOR[b.color] || BOX_COLOR.caution;
      return `
        <div class="photo-box" style="
          top:${b.top}%; left:${b.left}%; width:${b.width}%; height:${b.height}%;
          border-color:${color};
        ">
          <span class="photo-box__label" style="background:${color};">${b.label} ${b.pct}%</span>
        </div>
      `;
    })
    .join("");

  container.innerHTML = `
    <img src="${photoDataUrl}" alt="촬영한 현장 사진">
    ${boxesHtml}
    <span class="photo-result-image__done-tag">AI 분석 완료</span>
  `;
}

function renderScore(result) {
  document.getElementById("score-number").textContent = `${result.score}/100`;
  const badgeEl = document.getElementById("score-badge");
  badgeEl.textContent = `${result.grade} · ${result.grade_label}`;
  document.getElementById("hazard-count").textContent = result.hazards.length;
}

function renderHazardList(hazards) {
  const listEl = document.getElementById("hazard-list");
  const severityBadge = (s) => (s === "위험" ? "badge--danger" : s === "주의" ? "badge--caution" : "badge--safe");

  listEl.innerHTML = hazards
    .map(
      (h) => `
      <div class="hazard-item">
        <span class="hazard-item__icon">${h.icon}</span>
        <div style="flex:1;">
          <div class="hazard-item__title">
            ${h.title} <span class="badge ${severityBadge(h.severity)}" style="margin-left:4px;">${h.severity}</span>
          </div>
          <div class="hazard-item__desc">${h.desc}</div>
        </div>
      </div>
    `
    )
    .join("");
}

function bindActions(result) {
  const saveBtn = document.getElementById("save-btn");
  const downloadBtn = document.getElementById("download-btn");
  const shareBtn = document.getElementById("share-btn");

  saveBtn.addEventListener("click", () => {
    const saved = JSON.parse(localStorage.getItem("saved_photo_results") || "[]");
    saved.unshift({ savedAt: new Date().toISOString(), result });
    localStorage.setItem("saved_photo_results", JSON.stringify(saved.slice(0, 50)));
    saveBtn.textContent = "✓ 저장됨";
    setTimeout(() => (saveBtn.textContent = "💾 결과 저장하기"), 1500);
  });

  downloadBtn.addEventListener("click", () => {
    const photoDataUrl = sessionStorage.getItem("captured_photo");
    const a = document.createElement("a");
    a.href = photoDataUrl;
    a.download = `현장분석_${new Date().toISOString().slice(0, 10)}.jpg`;
    a.click();
  });

  shareBtn.addEventListener("click", async () => {
    const shareText = `[AI 건설현장 안전관리] 사진 위험도 점수 ${result.score}/100 (${result.grade}), 탐지된 위험요소 ${result.hazards.length}건`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "사진 분석 결과", text: shareText });
      } catch (err) {
        /* 취소 시 별도 처리 불필요 */
      }
    } else {
      alert("이 브라우저는 공유 기능을 지원하지 않아요. 아래 내용을 복사해서 사용해주세요:\n\n" + shareText);
    }
  });
}