// ============================================================
// predict-input.js — 위험도 분석 입력 화면
// constants.js, common.js, session-store.js, weather.js 보다
// 나중에 로드되어야 합니다.
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  // 이 화면에서 채워지는 "동적" 답변들 (RAW_INPUT_COLS 필드명을 key로 사용)
  const answers = {};
  let weatherFields = null; // 백엔드로 보낼 날씨 필드 (숫자만)
  let weatherDescription = null; // 분석정보 카드 표시용 (백엔드로는 안 보냄)
  let progressInfo = null; // { percent, bucket }

  const submitBtn = document.getElementById("submit-btn");

  // ── 0. 현장 정보(site-setup) 확인
  const siteSetupData = getSiteSetup();
  if (!siteSetupData) {
    document.getElementById("site-setup-warning").style.display = "block";
  }

  // ── 1. 작업 대상물 (버튼선택형, 사고객체 - 대분류)
  renderButtonSelect("field-work-object", "사고객체 - 대분류", WORK_OBJECT_OPTIONS);

  // ── 2. 작업 종류 (드롭다운, 추출된_작업종류)
  renderSelect("field-work-type", "추출된_작업종류", WORK_TYPE_OPTIONS);

  // ── 3. 공종 - 중분류 (검색형 드롭다운)
  createSearchSelect(
    "field-work-category",
    WORK_CATEGORY_OPTIONS,
    (value) => {
      if (value) answers["공종 - 중분류"] = value;
      else delete answers["공종 - 중분류"];
      validateForm();
    },
    "예: 철근콘크리트공사"
  );

  // ── 4. 작업프로세스 (검색형 드롭다운)
  createSearchSelect(
    "field-work-process",
    WORK_PROCESS_OPTIONS,
    (value) => {
      if (value) answers["작업프로세스"] = value;
      else delete answers["작업프로세스"];
      validateForm();
    },
    "예: 거푸집 설치작업"
  );

  // ── 5. 공정 진행률 자동계산 (site-setup의 공사시작일/종료일 기준)
  renderProgressInfo();

  // ── 6. 기상 정보 자동 조회
  await loadWeather();

  // ── 렌더 헬퍼: 버튼선택형 (문자열 배열 또는 {value, desc} 객체 배열 모두 지원)
  // desc가 있으면 버튼 안에 값(굵게) + 설명(작은 회색 글씨) 2줄로 항상 표시
  function renderButtonSelect(containerId, fieldName, options) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    options.forEach((opt) => {
      const isObj = typeof opt === "object";
      const value = isObj ? opt.value : opt;
      const desc = isObj ? opt.desc : null;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "button-select__option";
      if (desc) {
        btn.classList.add("button-select__option--desc");
        btn.innerHTML = `
          <span class="button-select__option-title">${value}</span>
          <span class="button-select__option-desc">${desc}</span>
        `;
      } else {
        btn.textContent = value;
      }

      btn.addEventListener("click", () => {
        container.querySelectorAll(".button-select__option").forEach((b) =>
          b.classList.remove("is-selected")
        );
        btn.classList.add("is-selected");
        answers[fieldName] = value;
        validateForm();
      });
      container.appendChild(btn);
    });
  }

  // ── 렌더 헬퍼: 네이티브 드롭다운
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
      validateForm();
    });
  }

  // ── 공정 진행률 표시
  function renderProgressInfo() {
    const infoEl = document.getElementById("progress-info");

    if (!siteSetupData || !siteSetupData["공사시작일"] || !siteSetupData["공사종료일"]) {
      infoEl.innerHTML = `<p style="font-size: var(--fs-sm); color: var(--color-text-secondary);">
        현장 정보에 공사기간이 없어 계산할 수 없어요.
      </p>`;
      return;
    }

    const result = calcProgressBucket(siteSetupData["공사시작일"], siteSetupData["공사종료일"]);
    if (!result) {
      infoEl.innerHTML = `<p style="font-size: var(--fs-sm); color: var(--color-text-secondary);">
        공사기간 값이 올바르지 않아 계산할 수 없어요.
      </p>`;
      return;
    }

    progressInfo = result;
    infoEl.innerHTML = `
      <div class="readonly-stat">
        <span class="readonly-stat__label">오늘 기준 진행률</span>
        <span class="readonly-stat__value">${result.percent}% (${result.bucket})</span>
      </div>
      <div class="readonly-stat__bar">
        <div class="readonly-stat__bar-fill" style="width:${result.percent}%"></div>
      </div>
      <p style="font-size: 11px; color: var(--color-text-placeholder); margin-top: var(--space-sm);">
        공사시작일·종료일 기준으로 매일 자동 계산됩니다.
      </p>
    `;
    validateForm();
  }

  // ── 기상 정보 조회
  async function loadWeather() {
    const stateEl = document.getElementById("weather-state");
    const bodyEl = document.getElementById("weather-body");
    const currentEl = document.getElementById("weather-current");

    try {
      const { current, hourlyList } = await getWeatherSnapshot();
      weatherFields = toBackendWeatherFields(current, hourlyList);
      weatherDescription = current.description;

      currentEl.innerHTML = `
        <div class="weather-current__item">
          <div class="weather-current__label">기온</div>
          <div class="weather-current__value">${Math.round(current.temp)}°C</div>
        </div>
        <div class="weather-current__item">
          <div class="weather-current__label">습도</div>
          <div class="weather-current__value">${current.humidity}%</div>
        </div>
        <div class="weather-current__item">
          <div class="weather-current__label">풍속</div>
          <div class="weather-current__value">${current.windSpeed}m/s</div>
        </div>
        <div class="weather-current__item">
          <div class="weather-current__label">강수량</div>
          <div class="weather-current__value">${weatherFields["일강수량(mm)"]}mm</div>
        </div>
      `;
      stateEl.style.display = "none";
      bodyEl.style.display = "block";
    } catch (err) {
      console.error(err);
      stateEl.textContent =
        err && err.code === 1
          ? "위치 권한이 거부되어 날씨를 불러올 수 없어요. (결측으로 처리되어 분석은 진행 가능)"
          : "날씨 정보를 불러오지 못했어요. (결측으로 처리되어 분석은 진행 가능)";
      stateEl.classList.add("is-error");
    } finally {
      validateForm();
    }
  }

  // ── 필수 입력 검증 (날씨는 실패해도 진행 가능 — README상 결측 허용)
  function validateForm() {
    const required = [
      "사고객체 - 대분류",
      "추출된_작업종류",
      "공종 - 중분류",
      "작업프로세스",
    ];
    const filled = required.every((f) => answers[f]);
    const ready = filled && !!progressInfo;

    submitBtn.disabled = !ready;
    submitBtn.textContent = ready ? "위험도 분석하기" : "모든 항목을 입력해주세요";
  }

  // ── 제출
  submitBtn.addEventListener("click", () => {
    if (submitBtn.disabled) return;

    const now = new Date().toISOString().slice(0, 16).replace("T", " "); // "YYYY-MM-DD HH:MM"

    const payload = {
      ...(siteSetupData || {}),
      ...answers,
      "공정률": progressInfo.bucket,
      "발생일시": now,
      "사고일시_x": now,
      ...(weatherFields || {}), // 날씨 실패 시 비워둠 → 백엔드가 결측 처리
      "_weather_description": weatherDescription, // UI 표시 전용 (백엔드 전송 시 제외 권장)
    };

    // TODO: 백엔드 /api/predict 연동되면 predict-loading.html에서
    //       sessionStorage.getItem("predict_input_payload")를 읽어 fetch 요청으로 사용
    sessionStorage.setItem("predict_input_payload", JSON.stringify(payload));
    window.location.href = "predict-loading.html";
  });
});