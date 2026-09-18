// ============================================================
// photo-analyzing.js — 사진 분석 로딩 화면
// api.js, session-store.js, notifications-realtime.js 보다 나중에 로드되어야 합니다.
// ============================================================

/** 원본 사진(수 MB)을 통째로 저장하지 않기 위해, "분석 기록"에서 다시 볼 때 쓸
 *  작은 썸네일(긴 변 320px, JPEG)만 만들어서 dataURL로 돌려준다. */
function makePhotoThumbnail(photoDataUrl, maxSize = 320) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.6));
      } catch (err) {
        console.warn("[photo-analyzing.js] 썸네일 생성 실패", err);
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = photoDataUrl;
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const photoDataUrl = sessionStorage.getItem("captured_photo");

  if (!photoDataUrl) {
    window.location.href = "photo-capture.html";
    return;
  }

  const step1 = document.getElementById("step-1");
  const step2 = document.getElementById("step-2");
  const step3 = document.getElementById("step-3");
  const step3Desc = document.getElementById("step-3-desc");
  const progressFill = document.getElementById("loading-progress-fill");

  function markDone(stepEl) {
    stepEl.classList.remove("is-active");
    stepEl.classList.add("is-done");
    stepEl.querySelector(".step-item__icon").textContent = "✓";
  }
  function markActive(stepEl) {
    stepEl.classList.add("is-active");
    stepEl.querySelector(".step-item__icon").textContent = "•••";
  }
  function setProgress(pct) {
    progressFill.style.width = `${pct}%`;
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const apiPromise = analyzePhoto(photoDataUrl);

  markActive(step1);
  setProgress(10);
  await wait(700);
  markDone(step1);
  setProgress(33);

  markActive(step2);
  await wait(700);
  markDone(step2);
  setProgress(66);

  markActive(step3);

  try {
    const result = await apiPromise;
    markDone(step3);
    setProgress(100);

    sessionStorage.setItem("photo_result", JSON.stringify(result));

    // 분석 기록 화면에서 다시 열어볼 수 있도록 자동 기록 (원본 사진 대신 작은 썸네일만 저장)
    const thumbnail = await makePhotoThumbnail(photoDataUrl);
    savePhotoAnalysisRecord(result, thumbnail);

    if (result.grade === "HIGH") {
      showRealNotification(
        "⚠️ 위험 감지",
        `사진 분석에서 위험요소 ${result.hazards.length}건이 발견됐어요 - 확인이 필요해요`,
        "photo-risk-alert"
      );
    }

    await wait(400);
    window.location.href = "photo-result.html";
  } catch (err) {
    console.error(err);
    step3Desc.textContent = "분석 중 오류가 발생했어요. 다시 시도해주세요.";
    step3.classList.remove("is-active");
    step3.style.borderColor = "var(--color-danger)";
    step3.style.background = "var(--color-danger-bg)";

    await wait(1800);
    window.location.href = "photo-capture.html";
  }
});