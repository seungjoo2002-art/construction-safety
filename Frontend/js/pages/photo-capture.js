// ============================================================
// photo-capture.js — 현장 촬영 화면
// getUserMedia로 실제 카메라를 켭니다. (Live Server 등 localhost/https 필요)
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  const video = document.getElementById("camera-video");
  const viewport = document.getElementById("camera-viewport");
  const shutterBtn = document.getElementById("shutter-btn");
  const galleryBtn = document.getElementById("gallery-btn");
  const galleryInput = document.getElementById("gallery-input");
  const cameraFallbackInput = document.getElementById("camera-fallback-input");
  const switchBtn = document.getElementById("switch-btn");
  const flashBtn = document.getElementById("flash-btn");
  const canvas = document.getElementById("capture-canvas");

  let currentStream = null;
  let facingMode = "environment"; // "environment" = 후면, "user" = 전면
  let torchOn = false;

  // ── 카메라 스트림 시작
  async function startCamera() {
    stopCamera();
    try {
      currentStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode } },
        audio: false,
      });
      video.srcObject = currentStream;
    } catch (err) {
      console.error(err);
      showFallback();
    }
  }

  function stopCamera() {
    if (currentStream) {
      currentStream.getTracks().forEach((t) => t.stop());
      currentStream = null;
    }
  }

  // ── 카메라 접근 실패 시 (권한 거부, 데스크탑에 카메라 없음 등) → 파일 선택으로 대체
  function showFallback() {
    viewport.innerHTML = `
      <div class="camera-fallback">
        📷 카메라에 접근할 수 없어요.<br>
        권한을 허용했는지 확인하거나, 아래 버튼으로 사진을 선택해주세요.
      </div>
    `;
    shutterBtn.textContent = "🖼";
    shutterBtn.setAttribute("aria-label", "사진 선택");
  }

  // ── 촬영: 비디오 프레임을 캔버스에 그려서 이미지로 변환
  function capturePhoto() {
    if (!currentStream) {
      // 카메라 스트림이 없으면(fallback 상태) 파일 선택으로 대체
      cameraFallbackInput.click();
      return;
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(video, 0, 0, w, h);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    finishCapture(dataUrl);
  }

  // ── 파일(갤러리/카메라 fallback)로 선택된 이미지를 dataURL로 변환
  function handleFileSelect(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => finishCapture(reader.result);
    reader.readAsDataURL(file);
  }

  function finishCapture(dataUrl) {
    sessionStorage.setItem("captured_photo", dataUrl);
    stopCamera();
    window.location.href = "photo-analyzing.html";
  }

  // ── 카메라 전환 (전면/후면)
  switchBtn.addEventListener("click", () => {
    facingMode = facingMode === "environment" ? "user" : "environment";
    startCamera();
  });

  // ── 플래시(손전등) 토글 — 지원 기기에서만 동작, 미지원이면 조용히 무시
  flashBtn.addEventListener("click", async () => {
    if (!currentStream) return;
    const track = currentStream.getVideoTracks()[0];
    const capabilities = track.getCapabilities ? track.getCapabilities() : {};
    if (!capabilities.torch) {
      alert("이 기기/브라우저는 플래시 제어를 지원하지 않아요.");
      return;
    }
    torchOn = !torchOn;
    await track.applyConstraints({ advanced: [{ torch: torchOn }] });
    flashBtn.style.background = torchOn ? "rgba(255,193,7,0.8)" : "rgba(0,0,0,0.4)";
  });

  shutterBtn.addEventListener("click", capturePhoto);

  galleryBtn.addEventListener("click", () => galleryInput.click());
  galleryInput.addEventListener("change", (e) => handleFileSelect(e.target.files[0]));
  cameraFallbackInput.addEventListener("change", (e) => handleFileSelect(e.target.files[0]));

  // 페이지 벗어날 때 카메라 반드시 꺼주기 (계속 켜져있으면 배터리/프라이버시 문제)
  window.addEventListener("beforeunload", stopCamera);

  startCamera();
});