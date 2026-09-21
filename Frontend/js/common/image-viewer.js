// ============================================================
// image-viewer.js — 전체화면 이미지 뷰어 (산점도 확대 보기)
// 외부 라이브러리 없이 Pointer Events 로 구현. 어느 화면에서나 아래처럼 쓴다.
//
//   ImageViewer.bindTrigger(imgEl, () => ImageViewer.open(src, { alt, caption, detailHref, detailLabel }));
//
// 지원: 배경 어둡게 / X 버튼 / 이미지 밖(배경) 탭으로 닫기 / ESC / 두 손가락 핀치 줌 /
//       확대 중 한 손가락 이동(팬) / 더블탭·더블클릭 확대·복귀 / 마우스 휠 줌 / 포커스 가둠.
// 스타일은 css/components.css 의 .img-viewer* 규칙에 있다.
// ============================================================

const ImageViewer = (() => {
  const DOUBLE_TAP_MS = 300;
  const DOUBLE_TAP_ZOOM = 2.5;
  const TAP_SLOP = 8; // px — 이만큼 이하로 움직였으면 "탭"으로 본다

  let overlay, stage, img, closeBtn, captionEl, detailLink;
  let lastFocus = null;
  let isOpen = false;

  // 뷰 상태: 화면 중앙 기준 이동(x, y)과 배율(scale). scale=1 이 "화면에 맞춤".
  let scale = 1, x = 0, y = 0, maxScale = 6;

  const pointers = new Map(); // pointerId → {x, y}
  let gesture = null; // { startX, startY, moved, multi }
  let lastTap = { t: 0, x: 0, y: 0 };
  let pinchLastDist = 0;
  let lastPointerType = "mouse"; // 직전 pointerdown 의 입력 종류 — dblclick 이 터치에서 중복 처리되는 것 방지

  function build() {
    overlay = document.createElement("div");
    overlay.className = "img-viewer";
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "이미지 확대 보기");
    overlay.innerHTML = `
      <button type="button" class="img-viewer__close" aria-label="닫기">✕</button>
      <div class="img-viewer__stage">
        <img class="img-viewer__img" alt="" draggable="false">
      </div>
      <div class="img-viewer__bar">
        <span class="img-viewer__caption"></span>
        <a class="img-viewer__detail" hidden></a>
      </div>
    `;
    document.body.appendChild(overlay);

    stage = overlay.querySelector(".img-viewer__stage");
    img = overlay.querySelector(".img-viewer__img");
    closeBtn = overlay.querySelector(".img-viewer__close");
    captionEl = overlay.querySelector(".img-viewer__caption");
    detailLink = overlay.querySelector(".img-viewer__detail");

    closeBtn.addEventListener("click", close);

    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", onPointerUp);
    stage.addEventListener("pointercancel", onPointerUp);
    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("dblclick", (e) => {
      // 터치 더블탭은 pointerup 에서 직접 처리한다. 브라우저가 터치 더블탭 뒤에 dblclick 도 합성해서
      // 보내므로, 그걸 또 처리하면 확대했다가 바로 되돌아가 버린다 → dblclick 은 마우스 입력만 처리.
      if (lastPointerType === "mouse" && e.target === img) toggleZoomAt(e.clientX, e.clientY);
    });

    overlay.addEventListener("keydown", onKeyDown);
  }

  // ── 좌표/변환 ────────────────────────────────────────────
  function baseSize() {
    return { w: img.offsetWidth, h: img.offsetHeight }; // scale=1 일 때(화면에 맞춘) 크기
  }

  function clampPan() {
    const { w, h } = baseSize();
    const maxX = Math.max(0, (w * scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (h * scale - stage.clientHeight) / 2);
    x = Math.min(maxX, Math.max(-maxX, x));
    y = Math.min(maxY, Math.max(-maxY, y));
  }

  function apply() {
    clampPan();
    img.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;
    stage.classList.toggle("is-zoomed", scale > 1.01);
  }

  // (cx, cy): 화면 좌표. 그 지점이 확대 후에도 손가락/커서 아래에 그대로 있도록 이동량을 보정한다.
  function zoomAt(newScale, cx, cy) {
    newScale = Math.min(maxScale, Math.max(1, newScale));
    const rect = stage.getBoundingClientRect();
    const px = cx - (rect.left + rect.width / 2);
    const py = cy - (rect.top + rect.height / 2);
    const ratio = newScale / scale;
    x = px - (px - x) * ratio;
    y = py - (py - y) * ratio;
    scale = newScale;
    if (scale <= 1.001) { scale = 1; x = 0; y = 0; }
    apply();
  }

  function toggleZoomAt(cx, cy) {
    if (scale > 1.01) zoomAt(1, cx, cy);
    else zoomAt(Math.min(DOUBLE_TAP_ZOOM, maxScale), cx, cy);
  }

  // ── 포인터(터치/마우스/펜) ───────────────────────────────
  function onPointerDown(e) {
    lastPointerType = e.pointerType;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      gesture = { startX: e.clientX, startY: e.clientY, moved: false, multi: false, onImage: e.target === img };
    } else {
      gesture.multi = true;
      pinchLastDist = pointerDistance();
    }
  }

  function onPointerMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p || !gesture) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;

    if (Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) > TAP_SLOP) gesture.moved = true;

    if (pointers.size >= 2) {
      // 핀치: 두 손가락 사이 거리 비율로 확대, 두 손가락의 중점을 기준점으로 삼는다
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchLastDist > 0) zoomAt(scale * (dist / pinchLastDist), (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinchLastDist = dist;
    } else if (scale > 1.01) {
      // 확대 중 한 손가락 이동 = 팬
      x += dx;
      y += dy;
      apply();
    }
  }

  function onPointerUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);

    if (pointers.size > 0) {
      pinchLastDist = pointerDistance();
      return;
    }
    const g = gesture;
    gesture = null;
    if (!g || g.moved || g.multi || e.type === "pointercancel") return;

    // 여기까지 오면 "탭" 한 번
    if (e.pointerType === "mouse") {
      // 마우스: 이미지 밖(배경) 클릭이면 닫기. 이미지 위 더블클릭은 dblclick 핸들러가 처리.
      if (!g.onImage) close();
      return;
    }
    const now = Date.now();
    const isDouble = now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
    if (isDouble && g.onImage) {
      lastTap = { t: 0, x: 0, y: 0 };
      toggleZoomAt(e.clientX, e.clientY);
    } else {
      lastTap = { t: now, x: e.clientX, y: e.clientY };
      if (!g.onImage) close(); // 터치: 이미지 밖(배경) 탭이면 닫기
    }
  }

  function pointerDistance() {
    const pts = [...pointers.values()];
    return pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
  }

  function onWheel(e) {
    e.preventDefault();
    zoomAt(scale * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  }

  // ── 키보드: ESC 닫기 + Tab 이 뷰어 밖으로 나가지 않게 가둠 ──
  function onKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "+" || e.key === "=") {
      const r = stage.getBoundingClientRect();
      zoomAt(scale * 1.4, r.left + r.width / 2, r.top + r.height / 2);
    } else if (e.key === "-") {
      const r = stage.getBoundingClientRect();
      zoomAt(scale / 1.4, r.left + r.width / 2, r.top + r.height / 2);
    } else if (e.key === "Tab") {
      const focusables = [closeBtn, ...(detailLink.hidden ? [] : [detailLink])];
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // ── 열기/닫기 ────────────────────────────────────────────
  function open(src, opts = {}) {
    if (!src) return;
    if (!overlay) build();

    lastFocus = document.activeElement;
    scale = 1; x = 0; y = 0; pointers.clear(); gesture = null;

    img.alt = opts.alt || "";
    captionEl.textContent = opts.caption || "";
    if (opts.detailHref) {
      detailLink.href = opts.detailHref;
      detailLink.textContent = opts.detailLabel || "자세히 보기 →";
      detailLink.hidden = false;
    } else {
      detailLink.hidden = true;
    }

    overlay.hidden = false;
    document.documentElement.classList.add("img-viewer-open");
    isOpen = true;

    // 원본(고해상도) 이미지를 그대로 표시 — 화면에 맞추는 건 CSS(max-width/height), 확대해도 원본 픽셀을 쓴다.
    const onReady = () => {
      // 원본 해상도의 약 2배까지는 확대해도 뭉개지지 않으므로 그 지점을 최대 배율로 삼는다(최소 4배 ~ 최대 8배)
      const natural = img.naturalWidth || img.offsetWidth;
      maxScale = Math.min(8, Math.max(4, (natural / Math.max(img.offsetWidth, 1)) * 2));
      apply();
    };
    img.onload = onReady;
    img.src = src;
    if (img.complete) onReady();
    apply();

    closeBtn.focus();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    overlay.hidden = true;
    img.removeAttribute("src"); // 큰 base64 이미지를 뷰어가 계속 들고 있지 않도록
    document.documentElement.classList.remove("img-viewer-open");
    pointers.clear();
    gesture = null;
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
    lastFocus = null;
  }

  // 이미지처럼 버튼이 아닌 요소도 키보드로 열 수 있게 한다 (Enter / Space)
  function bindTrigger(el, handler) {
    el.classList.add("is-zoom-trigger");
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.addEventListener("click", handler);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handler();
      }
    });
  }

  return { open, close, bindTrigger };
})();
