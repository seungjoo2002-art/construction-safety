// ============================================================
// similar-cases.js — 유사 사고사례 목록 화면
// idb-store.js, mock-cases.js, env.js, hf-dataset.js, api.js 보다 나중에 로드되어야 합니다.
// Hugging Face Dataset Viewer API에서 검색/필터링된 사례를 페이지 단위(최대 100건)로
// 가져오고, 연결 실패 시 api.js가 자동으로 IndexedDB "최근 데이터" 또는 MOCK_CASES로
// 대체합니다.
// ============================================================

const CASES_PAGE_LIMIT = 50; // 한 번에 50건, 최대 100건(hf-dataset.js가 clamp)

document.addEventListener("DOMContentLoaded", () => {
  const chipRow = document.getElementById("filter-chip-row");
  const searchInput = document.getElementById("case-search-input");
  const listEl = document.getElementById("case-list");
  const countEl = document.getElementById("case-count");
  const dbNoteEl = document.getElementById("db-total-note");
  const mockTagEl = document.getElementById("cases-mock-tag");
  const paginationEl = document.getElementById("case-pagination");
  const prevBtn = document.getElementById("case-prev");
  const nextBtn = document.getElementById("case-next");
  const pageIndicatorEl = document.getElementById("case-page-indicator");
  const filterNoteEl = document.getElementById("case-filter-note");

  let activeFilter = "전체";
  let requestSeq = 0; // 느리게 도착한 이전 요청 응답이 최신 렌더를 덮어쓰지 않도록
  let offset = 0;
  let total = 0;
  let lastCases = [];
  let lastNotConfigured = false;
  let searchDebounceTimer = null;

  // ── 필터 칩 렌더링
  chipRow.innerHTML = CASE_FILTER_TAGS.map(
    (tag) => `<button type="button" class="filter-chip${tag === "전체" ? " is-active" : ""}" data-tag="${tag}">${tag}</button>`
  ).join("");

  chipRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-chip");
    if (!btn) return;
    chipRow.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("is-active"));
    btn.classList.add("is-active");
    activeFilter = btn.dataset.tag;
    loadCases({ offset: 0 });
  });

  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => loadCases({ offset: 0 }), 350);
  });

  prevBtn.addEventListener("click", () => {
    if (offset <= 0) return;
    loadCases({ offset: Math.max(0, offset - CASES_PAGE_LIMIT) });
  });

  nextBtn.addEventListener("click", () => {
    loadCases({ offset: offset + CASES_PAGE_LIMIT });
  });

  function tagBadgeClass(tag) {
    if (["치명", "중상"].includes(tag)) return "badge--danger";
    if (["경상"].includes(tag)) return "badge--safe";
    return "badge--caution"; // 사고유형 태그(추락/끼임 등)는 전부 caution 톤 배지
  }

  async function loadCases({ offset: nextOffset }) {
    const seq = ++requestSeq;
    offset = nextOffset;

    listEl.innerHTML = `<p class="case-empty">불러오는 중...</p>`;
    dbNoteEl.textContent = "불러오는 중...";
    paginationEl.style.display = "none";
    filterNoteEl.style.display = "none";
    mockTagEl.style.display = "none";

    const result = await getCases({
      q: searchInput.value.trim(),
      hazard: activeFilter,
      limit: CASES_PAGE_LIMIT,
      offset,
    });

    if (seq !== requestSeq) return; // 그 사이 새 검색/필터/페이지 요청이 또 들어온 경우 폐기

    total = result.total || 0;
    lastCases = result.cases || [];
    lastNotConfigured = !!result._notConfigured;

    if (result._notConfigured) {
      mockTagEl.style.display = "none";
      dbNoteEl.textContent = "⚠️ Hugging Face 데이터셋이 아직 설정되지 않았어요.";
    } else if (result._mock) {
      mockTagEl.style.display = "inline-block";
      mockTagEl.textContent = "MOCK";
      dbNoteEl.textContent = "목업 데이터 표시 중 (Hugging Face 데이터셋 미연결)";
    } else if (result._offline) {
      mockTagEl.style.display = "inline-block";
      mockTagEl.textContent = "저장된 최근 데이터";
      dbNoteEl.textContent = "네트워크 연결이 없어 마지막으로 저장된 검색 결과를 보여주고 있어요.";
    } else {
      dbNoteEl.textContent = `국내 건설사고 DB · 총 ${total.toLocaleString()}건`;
    }

    if (result._filterUnsupported) {
      filterNoteEl.style.display = "block";
      filterNoteEl.textContent = "⚠️ 지금은 서버 측 검색/필터가 지원되지 않아 전체 목록을 보여드리고 있어요.";
    }

    render();
  }

  function render() {
    countEl.textContent = total ? `${total.toLocaleString()}건의 사례` : "";

    if (lastCases.length === 0) {
      const emptyText = lastNotConfigured
        ? "Hugging Face 데이터셋 설정이 필요해요. README를 확인해주세요."
        : "일치하는 사례가 없어요. 다른 검색어를 시도해보세요.";
      listEl.innerHTML = `<p class="case-empty">${emptyText}</p>`;
      paginationEl.style.display = "none";
      return;
    }

    listEl.innerHTML = lastCases
      .map(
        (c) => `
      <a href="case-detail.html?id=${encodeURIComponent(c.id)}" class="card case-card">
        <div class="case-card__top">
          <div class="case-card__tags">
            ${c.tags.map((t) => `<span class="badge ${tagBadgeClass(t)}">${t}</span>`).join("")}
          </div>
        </div>
        <div class="case-card__title">${c.title}</div>
        <div class="case-card__desc text-clamp-1">${c.desc}</div>
        <div class="case-card__meta">${c.date} · 재해자 ${c.victims}</div>
      </a>
    `
      )
      .join("");

    const currentPage = Math.floor(offset / CASES_PAGE_LIMIT) + 1;
    const hasNext = total ? offset + lastCases.length < total : lastCases.length === CASES_PAGE_LIMIT;
    paginationEl.style.display = "flex";
    pageIndicatorEl.textContent = `${currentPage} 페이지`;
    prevBtn.disabled = offset <= 0;
    nextBtn.disabled = !hasNext;
  }

  loadCases({ offset: 0 });
});
