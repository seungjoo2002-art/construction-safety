// ============================================================
// similar-cases.js — 유사 사고사례 목록 화면
// mock-cases.js, api.js 보다 나중에 로드되어야 합니다.
// 백엔드(app.py의 /api/cases)에서 검색/필터링된 사례를 가져오고,
// 연결 실패 시 api.js가 자동으로 MOCK_CASES로 대체합니다.
// ============================================================

const CASES_PAGE_SIZE = 20;

document.addEventListener("DOMContentLoaded", () => {
  const chipRow = document.getElementById("filter-chip-row");
  const searchInput = document.getElementById("case-search-input");
  const listEl = document.getElementById("case-list");
  const countEl = document.getElementById("case-count");
  const dbNoteEl = document.getElementById("db-total-note");
  const mockTagEl = document.getElementById("cases-mock-tag");
  const loadMoreBtn = document.getElementById("case-load-more");

  let activeFilter = "전체";
  let requestSeq = 0; // 느리게 도착한 이전 요청 응답이 최신 렌더를 덮어쓰지 않도록
  let loadedCases = [];
  let total = 0;
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
    loadCases({ reset: true });
  });

  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => loadCases({ reset: true }), 350);
  });

  loadMoreBtn.addEventListener("click", () => loadCases({ reset: false }));

  function tagBadgeClass(tag) {
    if (["치명", "중상"].includes(tag)) return "badge--danger";
    if (["경상"].includes(tag)) return "badge--safe";
    return "badge--caution"; // 사고유형 태그(추락/끼임 등)는 전부 caution 톤 배지
  }

  async function loadCases({ reset }) {
    const seq = ++requestSeq;
    const offset = reset ? 0 : loadedCases.length;

    if (reset) {
      listEl.innerHTML = `<p class="case-empty">불러오는 중...</p>`;
    } else {
      loadMoreBtn.disabled = true;
      loadMoreBtn.textContent = "불러오는 중...";
    }

    const result = await getCases({
      q: searchInput.value.trim(),
      hazard: activeFilter,
      limit: CASES_PAGE_SIZE,
      offset,
    });

    if (seq !== requestSeq) return; // 그 사이 새 검색/필터 요청이 또 들어온 경우 폐기

    total = result.total;
    loadedCases = reset ? result.cases : loadedCases.concat(result.cases);

    mockTagEl.style.display = result._mock ? "inline-block" : "none";
    dbNoteEl.textContent = result._mock
      ? "목업 데이터 표시 중 (백엔드 미연결)"
      : `국내 건설사고 DB · 총 ${total.toLocaleString()}건`;

    render();
  }

  function render() {
    countEl.textContent = `${total.toLocaleString()}건의 사례${loadedCases.length < total ? ` (${loadedCases.length}건 표시 중)` : ""}`;

    if (loadedCases.length === 0) {
      listEl.innerHTML = `<p class="case-empty">일치하는 사례가 없어요. 다른 검색어를 시도해보세요.</p>`;
      loadMoreBtn.style.display = "none";
      return;
    }

    listEl.innerHTML = loadedCases
      .map(
        (c) => `
      <a href="case-detail.html?id=${encodeURIComponent(c.id)}" class="card case-card">
        <div class="case-card__top">
          <div class="case-card__tags">
            ${c.tags.map((t) => `<span class="badge ${tagBadgeClass(t)}">${t}</span>`).join("")}
          </div>
        </div>
        <div class="case-card__title">${c.title}</div>
        <div class="case-card__desc">${c.desc}</div>
        <div class="case-card__meta">${c.date} · 재해자 ${c.victims}</div>
      </a>
    `
      )
      .join("");

    const hasMore = loadedCases.length < total;
    loadMoreBtn.style.display = hasMore ? "block" : "none";
    loadMoreBtn.disabled = false;
    loadMoreBtn.textContent = "더 보기";
  }

  loadCases({ reset: true });
});
