// ============================================================
// site-setup.js — 현장 설정 4단계 위저드
// constants.js, session-store.js 보다 나중에 로드되어야 합니다.
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  const TOTAL_STEPS = 4;
  let currentStep = 1;

  // 최종적으로 백엔드 RAW_INPUT_COLS 필드명을 key로 쌓이는 답변 저장소
  const answers = {};

  const stepEls = document.querySelectorAll(".wizard-step");
  const dotsContainer = document.getElementById("stepper-dots");
  const prevBtn = document.getElementById("prev-btn");
  const nextBtn = document.getElementById("next-btn");

  // ── 스테퍼 점 렌더링
  function renderDots() {
    dotsContainer.innerHTML = "";
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      const dot = document.createElement("span");
      dot.className = "stepper-dots__dot";
      if (i === currentStep) dot.classList.add("is-active");
      else if (i < currentStep) dot.classList.add("is-done");
      dotsContainer.appendChild(dot);
    }
  }

  // ── 버튼 선택형 필드 렌더링
  // options: string[] 또는 { label, value }[]
  function renderButtonSelect(containerId, fieldName, options) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    options.forEach((opt) => {
      const isObj = typeof opt === "object";
      const label = isObj ? opt.label : opt;
      const value = isObj ? opt.value : opt;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "button-select__option";
      btn.textContent = label;
      btn.dataset.value = value;

      btn.addEventListener("click", () => {
        container.querySelectorAll(".button-select__option").forEach((b) =>
          b.classList.remove("is-selected")
        );
        btn.classList.add("is-selected");
        answers[fieldName] = value;
        validateCurrentStep();
      });

      container.appendChild(btn);
    });
  }

  // ── 네이티브 드롭다운 필드 렌더링
  function renderSelect(selectId, fieldName, options) {
    const select = document.getElementById(selectId);
    options.forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      select.appendChild(o);
    });
    select.addEventListener("change", () => {
      answers[fieldName] = select.value;
      select.classList.remove("is-placeholder");
      validateCurrentStep();
    });
  }

  // ── 각 필드 렌더링 (constants.js에 정의된 옵션 사용)
  renderButtonSelect("field-public-private", "공공/민간 구분", PUBLIC_PRIVATE_OPTIONS);
  renderButtonSelect("field-facility-major", "시설물 종류 - 대분류", FACILITY_MAJOR_OPTIONS);
  renderSelect("field-facility-minor", "시설물 종류 - 중분류", FACILITY_MINOR_OPTIONS);
  renderButtonSelect("field-safety-plan", "안전관리계획", SAFETY_MANAGEMENT_PLAN_OPTIONS);
  renderButtonSelect("field-design-safety", "설계안전성검토", DESIGN_SAFETY_REVIEW_OPTIONS);
  renderSelect("field-worker-count", "작업자수", WORKER_COUNT_OPTIONS);
  renderSelect("field-bid-rate", "낙찰률", BID_RATE_OPTIONS);
  renderSelect("field-cost", "공사비", CONSTRUCTION_COST_OPTIONS);
  renderButtonSelect("field-age-group", "연령_ord", AGE_GROUP_OPTIONS);

  // ── 날짜 필드는 버튼/드롭다운이 아니라서 직접 리스너 연결
  const startDateInput = document.getElementById("field-start-date");
  const endDateInput = document.getElementById("field-end-date");
  const dateErrorEl = document.getElementById("date-error");

  startDateInput.addEventListener("change", () => {
    answers["공사시작일"] = startDateInput.value; // YYYY-MM-DD (native date input 형식)

    // 종료일이 시작일보다 빠를 수 없도록 종료일 선택 범위 자체를 제한
    endDateInput.min = startDateInput.value;

    // 이미 골라둔 종료일이 새 시작일보다 빠르면 무효화하고 다시 고르게 함
    if (endDateInput.value && endDateInput.value < startDateInput.value) {
      endDateInput.value = "";
      delete answers["공사종료일"];
      showDateError("공사 종료일이 시작일보다 빠를 수 없어 초기화했어요. 종료일을 다시 선택해주세요.");
    }

    validateCurrentStep();
  });

  endDateInput.addEventListener("change", () => {
    if (startDateInput.value && endDateInput.value < startDateInput.value) {
      showDateError("공사 종료일은 시작일 이후여야 합니다.");
      endDateInput.value = "";
      delete answers["공사종료일"];
      validateCurrentStep();
      return;
    }
    clearDateError();
    answers["공사종료일"] = endDateInput.value;
    validateCurrentStep();
  });

  function showDateError(message) {
    if (!dateErrorEl) return;
    dateErrorEl.textContent = message;
    dateErrorEl.style.display = "block";
  }
  function clearDateError() {
    if (!dateErrorEl) return;
    dateErrorEl.style.display = "none";
    dateErrorEl.textContent = "";
  }

  // ── 현재 스텝에 필요한 필드가 각각 몇 개인지 (검증용)
  const STEP_REQUIRED_FIELDS = {
    1: ["공사시작일", "공사종료일"],
    2: ["공공/민간 구분", "시설물 종류 - 대분류", "시설물 종류 - 중분류"],
    3: ["안전관리계획", "설계안전성검토"],
    4: ["작업자수", "낙찰률", "공사비", "연령_ord"],
  };

  function validateCurrentStep() {
    const required = STEP_REQUIRED_FIELDS[currentStep];
    const filled = required.every((f) => answers[f] !== undefined && answers[f] !== "");
    nextBtn.disabled = !filled;
    nextBtn.textContent = filled
      ? (currentStep === TOTAL_STEPS ? "완료" : "다음")
      : "모든 항목을 입력해주세요";
  }

  // ── 스텝 전환
  function showStep(step) {
    stepEls.forEach((el) => {
      el.hidden = Number(el.dataset.step) !== step;
    });
    prevBtn.style.display = step === 1 ? "none" : "flex";
    renderDots();
    validateCurrentStep();
    document.querySelector(".app-content").scrollTo({ top: 0 });
  }

  prevBtn.addEventListener("click", () => {
    if (currentStep > 1) {
      currentStep--;
      showStep(currentStep);
    }
  });

  nextBtn.addEventListener("click", () => {
    if (nextBtn.disabled) return;

    if (currentStep < TOTAL_STEPS) {
      currentStep++;
      showStep(currentStep);
      return;
    }

    // ── 마지막 스텝: 저장 후 대시보드로 이동 (대시보드는 분석 여부에 따라 알아서 빈 상태/채워진 상태로 보여줌)
    saveSiteSetup(answers);
    window.location.href = "dashboard.html";
  });

  showStep(currentStep);
});