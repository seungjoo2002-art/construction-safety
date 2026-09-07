// ============================================================
// photo-analyzing.js — 사진 분석 로딩 화면
// api.js 보다 나중에 로드되어야 합니다.
// ============================================================

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