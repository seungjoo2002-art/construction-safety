// ============================================================
// photo-capture.js — 현장 촬영 화면
// getUserMedia로 실제 카메라를 켭니다. (Live Server 등 localhost/https 필요)
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  wakeBackend(); // 촬영하는 동안 잠든 백엔드(Render)를 미리 깨워 둔다

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
    reader.onerror = () => alert("사진 파일을 읽지 못했어요. 다른 사진을 선택해주세요.");
    reader.readAsDataURL(file);
  }

  // ── 업로드 전 축소: 휴대폰 원본(4~12MB)을 그대로 base64로 만들면 sessionStorage 한도(~5MB)를
  //    넘어 저장 단계에서 조용히 멈추고, 전송도 느려진다. YOLO 입력은 960px(classes.json imgsz)이라
  //    긴 변 1600px JPEG로 줄여도 탐지 정확도에는 영향이 없다. 브라우저가 해석하지 못하는 형식
  //    (예: 일부 PC 브라우저의 HEIC)은 여기서 명확히 안내한다 — 서버로 보내 500을 받지 않도록.
  const MAX_SIDE = 1600;
  function normalizeImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff"; // 투명 PNG → 검정 배경이 되지 않도록
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", 0.88));
      };
      img.onerror = () => reject(new Error("unsupported-image"));
      img.src = dataUrl;
    });
  }

  async function finishCapture(dataUrl) {
    let normalized;
    try {
      normalized = await normalizeImage(dataUrl);
    } catch (err) {
      alert("이 사진 형식은 브라우저에서 열 수 없어요(HEIC 등). JPG 또는 PNG 사진으로 다시 선택해주세요.");
      return;
    }
    try {
      sessionStorage.setItem("captured_photo", normalized);
    } catch (err) {
      console.error("[photo-capture.js] 사진 임시 저장 실패", err);
      alert("사진이 너무 커서 처리할 수 없어요. 다른 사진으로 다시 시도해주세요.");
      return;
    }
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