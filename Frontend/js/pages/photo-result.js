// ============================================================
// photo-result.js — 사진 분석 결과 화면
// URL에 ?resultId=...가 있으면 분석 기록·알림 화면 등에서 다시 열어본 지난 사진
// 분석 이력을 보여주고(이때 이미지는 원본이 아니라 축소 저장된 썸네일입니다),
// 없으면 photo-analyzing.html에서 저장한 sessionStorage 값(방금 막 끝난 분석)을
// 읽어 렌더링합니다. session-store.js 보다 나중에 로드되어야 합니다.
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  const resultId = new URLSearchParams(window.location.search).get("resultId");

  let result, photoDataUrl;
  const recordId = resultId || sessionStorage.getItem("photo_result_id");

  if (resultId) {
    let record = null;
    try {
      record = await getSavedPhotoResultById(resultId); // 서버가 내 기록이 아니면 404 → null
    } catch (err) {
      console.error("[photo-result.js] 사진 분석 기록 조회 실패", err);
    }
    if (!record) {
      window.location.href = "photo-capture.html";
      return;
    }
    result = record.result;
    photoDataUrl = record.thumbnail; // 원본 대신 저장된 축소 썸네일
  } else {
    const resultRaw = sessionStorage.getItem("photo_result");
    photoDataUrl = sessionStorage.getItem("captured_photo");

    if (!resultRaw || !photoDataUrl) {
      window.location.href = "photo-capture.html";
      return;
    }
    result = JSON.parse(resultRaw);
  }

  const mockTagEl = document.getElementById("photo-mock-tag");
  if (mockTagEl) mockTagEl.style.display = result._mock ? "inline-block" : "none";

  renderImageWithBoxes(photoDataUrl, result.boxes);
  renderScore(result);
  renderHazardList(result.hazards, result.boxes);
  bindActions(result, photoDataUrl, recordId);
});

const BOX_COLOR = {
  danger: "var(--color-danger)",
  caution: "var(--color-caution)",
  safe: "var(--color-safe)",
};

function renderImageWithBoxes(photoDataUrl, boxes) {
  const container = document.getElementById("photo-result-image");

  if (!photoDataUrl) {
    // 아주 예전에 수동 저장 버튼으로만 저장된 기록(썸네일 없음) 등 — 사진 없이 결과만 표시
    container.innerHTML = `<p style="text-align:center; padding:40px 0; color: var(--color-text-secondary);">저장된 사진이 없어요. 아래 위험요소 결과만 확인할 수 있어요.</p>`;
    return;
  }

  // 박스 좌표는 "원본 이미지 기준 %"이므로, 이미지와 정확히 같은 크기의 frame 안에 겹쳐야 한다.
  // (예전엔 4:3로 고정된 컨테이너에 object-fit: cover로 이미지를 잘라 넣고 박스는 컨테이너 기준 %로
  //  그려서, 4:3이 아닌 사진(16:9, 세로 3:4 등)은 박스 위치가 어긋나고 가장자리 객체가 잘려 안 보였다.)
  const boxesHtml = boxes
    .map((b) => {
      const color = BOX_COLOR[b.color] || BOX_COLOR.caution;
      const labelInside = b.top < 8 ? " photo-box__label--inside" : ""; // 위쪽 끝 박스의 라벨이 잘리지 않게
      return `
        <div class="photo-box" style="
          top:${b.top}%; left:${b.left}%; width:${b.width}%; height:${b.height}%;
          border-color:${color};
        ">
          <span class="photo-box__label${labelInside}" style="background:${color};">${b.label} ${b.pct}%</span>
        </div>
      `;
    })
    .join("");

  container.innerHTML = `
    <div class="photo-result-image__frame">
      <img src="${photoDataUrl}" alt="촬영한 현장 사진">
      ${boxesHtml}
    </div>
    <span class="photo-result-image__done-tag">AI 분석 완료</span>
  `;
}

function renderScore(result) {
  const noObjects = (result.boxes || []).length === 0;
  document.getElementById("score-verdict").textContent = noObjects ? "판정 불가" : result.grade_label;
  const card = document.querySelector(".photo-score-card");
  const mod = noObjects ? "unknown" : { MEDIUM: "medium", LOW: "low" }[result.grade];
  if (card && mod) card.classList.add(`photo-score-card--${mod}`);
  const badgeEl = document.getElementById("score-badge");
  // 탐지 객체 0개는 "안전"이 아니다 — "위험요소 없음 판정"과 구분해서 보여준다
  badgeEl.textContent = noObjects ? "탐지된 객체 없음" : result.grade;
  document.getElementById("hazard-count").textContent = result.hazards.length;
}

function renderHazardList(hazards, boxes) {
  const listEl = document.getElementById("hazard-list");
  if (hazards.length === 0) {
    listEl.innerHTML = `<p style="text-align:center; padding: var(--space-md) 0; color: var(--color-text-secondary);">${
      (boxes || []).length === 0
        ? "사진에서 탐지된 객체가 없어요. 위험요소가 없다는 뜻이 아니니, 대상이 잘 보이도록 다시 촬영하거나 현장을 직접 확인하세요."
        : `객체 ${boxes.length}개를 탐지했고, 룰 기준으로 판정된 위험요소는 없어요. AI가 학습하지 않은 위험(예: 안전모 미착용)은 판정하지 않으니 현장 점검은 계속하세요.`
    }</p>`;
    return;
  }
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

function bindActions(result, photoDataUrl, recordId) {
  const saveBtn = document.getElementById("save-btn");
  const downloadBtn = document.getElementById("download-btn");
  const shareBtn = document.getElementById("share-btn");

  // 분석 직후 photo-analyzing.js가 이미 내 기록(서버)에 저장했으면 중복 저장하지 않는다.
  saveBtn.addEventListener("click", async () => {
    if (!recordId) {
      try {
        recordId = await savePhotoAnalysisRecord(result, photoDataUrl ? await _thumb(photoDataUrl) : null);
        sessionStorage.setItem("photo_result_id", recordId);
      } catch (err) {
        alert(`저장하지 못했어요: ${err.message}`);
        return;
      }
    }
    saveBtn.textContent = "✓ 분석 보관소에 저장됨";
    setTimeout(() => (saveBtn.textContent = "💾 결과 저장하기"), 1500);
  });

  downloadBtn.addEventListener("click", () => {
    if (!photoDataUrl) {
      alert("저장된 사진이 없어서 다운로드할 수 없어요.");
      return;
    }
    const a = document.createElement("a");
    a.href = photoDataUrl;
    a.download = `현장분석_${new Date().toISOString().slice(0, 10)}.jpg`;
    a.click();
  });

  shareBtn.addEventListener("click", async () => {
    const shareText = `[AI 건설현장 안전관리] 사진 판정: ${result.grade_label} (${result.grade}), 탐지된 위험요소 ${result.hazards.length}건`;
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
/** 저장용 썸네일(긴 변 320px) — photo-analyzing.js의 makePhotoThumbnail과 동일 규칙 */
function _thumb(dataUrl, maxSize = 320) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.6));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
