// ============================================================
// analysis-history.js — 분석 기록 화면
// "과거에 실행했던 위험도 분석 및 사진 분석 결과"를 시간순으로 보여준다.
// (알림 화면과 역할이 분리되어 있음: 알림 = 지금 확인/조치할 것, 분석 기록 = 과거 이력)
//
// 데이터는 session-store.js가 서버(/api/me/analyses, /api/me/photo-analyses)에서 가져온다 —
// 서버가 로그인 사용자 소유 기록만 돌려주므로 다른 계정의 기록은 애초에 내려오지 않는다.
// auth.js, constants.js, session-store.js 보다 나중에 로드되어야 합니다.
// ============================================================

const HISTORY_FILTER_TAGS = ["전체", "위험도 분석", "사진 분석"];

document.addEventListener("DOMContentLoaded", async () => {
  const chipRow = document.getElementById("filter-chip-row");
  const listEl = document.getElementById("history-list");

  let allItems;
  try {
    allItems = await buildHistoryItems();
  } catch (err) {
    console.error("[analysis-history.js] 기록 조회 실패", err);
    listEl.innerHTML = `<p style="text-align:center; color: var(--color-danger); padding: var(--space-lg) 0;">분석 기록을 불러오지 못했어요: ${err.message}</p>`;
    return;
  }
  let activeFilter = "전체";

  chipRow.innerHTML = HISTORY_FILTER_TAGS.map(
    (tag) => `<button type="button" class="filter-chip${tag === "전체" ? " is-active" : ""}" data-tag="${tag}">${tag}</button>`
  ).join("");

  chipRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-chip");
    if (!btn) return;
    chipRow.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("is-active"));
    btn.classList.add("is-active");
    activeFilter = btn.dataset.tag;
    render();
  });

  function render() {
    const filtered = activeFilter === "전체" ? allItems : allItems.filter((it) => it.type === activeFilter);
    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div class="dashboard-empty">
          <div class="dashboard-empty__icon">📁</div>
          <p class="dashboard-empty__text">아직 분석 기록이 없어요.<br>위험도 분석 또는 사진 분석을 진행하면 여기에 쌓여요.</p>
          <a href="predict-input.html" class="dashboard-empty__btn">위험도 분석하러 가기</a>
        </div>
      `;
      return;
    }
    listEl.innerHTML = filtered.map(renderHistoryItem).join("");
  }

  render();
});

function formatHistoryDate(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── 위험도 분석 이력 + 사진 분석 이력을 같은 모양({type, time, id, ...})으로 합친다
async function buildHistoryItems() {
  const [savedResults, savedPhotos] = await Promise.all([getSavedResults(), getSavedPhotoResults()]);
  const predictItems = savedResults
    .map((r) => {
      const ranked = (r.result?.accident_type?.ranked_types || []).slice(0, 3);
      const topHazards = ranked.map((t) => ACCIDENT_TYPE_SHORT_LABEL[t.type] || t.type);
      const peakHour = r.result?.hourly?.peak_hour; // 시간대별 분석 이전 기록엔 없음
      return {
        type: "위험도 분석",
        time: r.savedAt,
        summary:
          `종합 위험도 ${r.score}점 · ${r.grade}` +
          (peakHour != null ? ` · 최고위험 ${String(peakHour).padStart(2, "0")}:00` : ""),
        topHazards,
        href: `predict-result.html?resultId=${encodeURIComponent(r.id)}`,
      };
    });

  const photoItems = savedPhotos
    .map((p) => {
      const hazardCount = p.result?.hazards?.length ?? 0;
      const boxes = p.result?.boxes || [];
      const noObjects = boxes.length === 0;
      const dangerLabels = boxes.filter((b) => b.color === "danger").map((b) => b.label);
      const otherLabels = boxes.filter((b) => b.color !== "danger").map((b) => b.label);
      const topHazards = [...new Set([...dangerLabels, ...otherLabels])].slice(0, 3);
      return {
        type: "사진 분석",
        time: p.savedAt,
        summary: noObjects ? "탐지된 객체 없음 (판정 불가)" : `발견 위험요소 ${hazardCount}건 · 탐지 객체 ${boxes.length}개`,
        topHazards,
        href: `photo-result.html?resultId=${encodeURIComponent(p.id)}`,
      };
    });

  return [...predictItems, ...photoItems].sort((a, b) => new Date(b.time) - new Date(a.time));
}

function renderHistoryItem(item) {
  const title = item.type === "위험도 분석" ? "현장 위험도 분석" : "현장 사진 분석";
  const hazardsLine = item.topHazards.length
    ? `주요 위험: <b>${item.topHazards.join(" · ")}</b>`
    : "탐지된 위험요소가 없어요.";

  return `
    <div class="card history-item">
      <div class="history-item__head">
        <span class="history-item__type-tag">${title}</span>
        <span class="history-item__time">${formatHistoryDate(item.time)}</span>
      </div>
      <div class="history-item__score">${item.summary}</div>
      <div class="history-item__hazards">${hazardsLine}</div>
      <a href="${item.href}" class="btn btn-outline btn-block">상세 결과 보기</a>
    </div>
  `;
}
