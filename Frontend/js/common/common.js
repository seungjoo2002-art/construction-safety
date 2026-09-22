// ============================================================
// common.js — 여러 페이지에서 재사용하는 유틸 함수
// ============================================================

/**
 * 공사시작일/종료일 기준으로 "오늘"의 공정 진행률을 계산해
 * config.PROGRESS_MAP 버킷 문자열로 변환.
 * (site-setup.html에서 저장한 날짜를 그대로 사용)
 *
 * @returns { percent: number, bucket: string } | null (날짜 없으면 null)
 */
function calcProgressBucket(startDateStr, endDateStr) {
  if (!startDateStr || !endDateStr) return null;

  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  const today = new Date();

  const totalDays = (end - start) / (1000 * 60 * 60 * 24);
  const elapsedDays = (today - start) / (1000 * 60 * 60 * 24);

  if (!(totalDays > 0)) return null; // 종료일이 시작일보다 빠르면 계산 불가

  let percent = (elapsedDays / totalDays) * 100;
  percent = Math.max(0, Math.min(100, percent)); // 0~100으로 clip

  const bucket = percentToProgressBucket(percent);
  return { percent: Math.round(percent), bucket };
}

/** 0~100 숫자를 PROGRESS_BUCKETS(constants.js) 문자열로 변환 */
function percentToProgressBucket(percent) {
  if (percent >= 90) return "90% 이상";
  const lower = Math.floor(percent / 10) * 10;
  const upper = lower + 9;
  return `${lower}~${upper}%`.replace("0~9%", "10% 미만"); // 0~9% 구간만 라벨이 다름
}

// ============================================================
// 검색형 드롭다운 (search-select) — 옵션이 많은 필드용
// 목록에 있는 값만 선택 가능 (자유 텍스트 입력은 허용 안 함)
// ============================================================

/**
 * @param {string} containerId  <div id="..."></div> 컨테이너
 * @param {string[]} options    선택 가능한 값 목록
 * @param {(value: string|null) => void} onSelect  선택/해제될 때마다 호출
 * @param {string} placeholder
 */
function createSearchSelect(containerId, options, onSelect, placeholder) {
  placeholder = placeholder || (typeof t === "function" ? t("predictInput.searchSelectPlaceholder") : "검색해서 선택하세요");
  const container = document.getElementById(containerId);
  container.classList.add("search-select");
  container.innerHTML = `
    <input type="text" class="search-select__input" placeholder="${placeholder}" autocomplete="off">
    <span class="search-select__clear" hidden>&times;</span>
    <div class="search-select__dropdown" hidden></div>
  `;

  const input = container.querySelector(".search-select__input");
  const dropdown = container.querySelector(".search-select__dropdown");
  const clearBtn = container.querySelector(".search-select__clear");

  let selectedValue = null;

  function renderOptions(filterText) {
    const filtered = filterText
      ? options.filter((o) => o.includes(filterText))
      : options;

    if (filtered.length === 0) {
      const emptyText = typeof t === "function" ? t("predictInput.searchSelectEmpty") : "일치하는 항목이 없어요";
      dropdown.innerHTML = `<div class="search-select__empty">${emptyText}</div>`;
    } else {
      dropdown.innerHTML = filtered
        .map((o) => `<div class="search-select__option" data-value="${o}">${o}</div>`)
        .join("");
    }
    dropdown.hidden = false;
  }

  function selectValue(value) {
    selectedValue = value;
    input.value = value;
    clearBtn.hidden = false;
    dropdown.hidden = true;
    container.classList.toggle("is-filled", !!value);
    onSelect(value);
  }

  function clearValue() {
    selectedValue = null;
    input.value = "";
    clearBtn.hidden = true;
    container.classList.remove("is-filled");
    onSelect(null);
  }

  input.addEventListener("focus", () => renderOptions(""));
  input.addEventListener("input", () => {
    selectedValue = null; // 타이핑을 다시 시작하면 이전 선택은 무효화
    clearBtn.hidden = true;
    container.classList.remove("is-filled");
    onSelect(null);
    renderOptions(input.value.trim());
  });

  dropdown.addEventListener("click", (e) => {
    const opt = e.target.closest(".search-select__option");
    if (!opt) return;
    selectValue(opt.dataset.value);
  });

  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    clearValue();
    input.focus();
  });

  // 목록 바깥 클릭 시 닫기 + 선택 안 된 상태로 텍스트만 남아있으면 초기화
  document.addEventListener("click", (e) => {
    if (container.contains(e.target)) return;
    dropdown.hidden = true;
    if (!selectedValue) input.value = "";
  });
}