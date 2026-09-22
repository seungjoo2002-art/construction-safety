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
  let autoWeatherFields = null; // 자동조회 성공값 백업 (직접입력 → 자동 되돌리기용)
  let weatherMode = "auto"; // "auto" | "manual"

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
    t("predictInput.categoryPlaceholder")
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
    t("predictInput.processPlaceholder")
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
        ${t("predictInput.progressNoDate")}
      </p>`;
      return;
    }

    const result = calcProgressBucket(siteSetupData["공사시작일"], siteSetupData["공사종료일"]);
    if (!result) {
      infoEl.innerHTML = `<p style="font-size: var(--fs-sm); color: var(--color-text-secondary);">
        ${t("predictInput.progressInvalidDate")}
      </p>`;
      return;
    }

    progressInfo = result;
    infoEl.innerHTML = `
      <div class="readonly-stat">
        <span class="readonly-stat__label">${t("predictInput.progressTodayLabel")}</span>
        <span class="readonly-stat__value">${result.percent}% (${result.bucket})</span>
      </div>
      <div class="readonly-stat__bar">
        <div class="readonly-stat__bar-fill" style="width:${result.percent}%"></div>
      </div>
      <p style="font-size: 11px; color: var(--color-text-placeholder); margin-top: var(--space-sm);">
        ${t("predictInput.progressAutoNote")}
      </p>
    `;
    validateForm();
  }

  // ── 기상 정보 조회 (기본값: 자동. 실패하거나 원하는 경우 아래에서 직접 입력으로 전환 가능)
  async function loadWeather() {
    const stateEl = document.getElementById("weather-state");
    const bodyEl = document.getElementById("weather-body");
    const currentEl = document.getElementById("weather-current");
    const toggleBtn = document.getElementById("weather-mode-toggle");

    try {
      const { current, hourlyList } = await getWeatherSnapshot();
      weatherFields = toBackendWeatherFields(current, hourlyList);
      autoWeatherFields = { ...weatherFields };
      weatherDescription = current.description;

      currentEl.innerHTML = `
        <div class="weather-current__item">
          <div class="weather-current__label">${t("predictInput.tempShort")}</div>
          <div class="weather-current__value">${Math.round(current.temp)}°C</div>
        </div>
        <div class="weather-current__item">
          <div class="weather-current__label">${t("predictInput.humidityShort")}</div>
          <div class="weather-current__value">${current.humidity}%</div>
        </div>
        <div class="weather-current__item">
          <div class="weather-current__label">${t("predictInput.windShort")}</div>
          <div class="weather-current__value">${current.windSpeed}m/s</div>
        </div>
        <div class="weather-current__item">
          <div class="weather-current__label">${t("predictInput.rainShort")}</div>
          <div class="weather-current__value">${weatherFields["일강수량(mm)"]}mm</div>
        </div>
      `;
      stateEl.style.display = "none";
      bodyEl.style.display = "block";
    } catch (err) {
      console.error(err);
      stateEl.textContent =
        err && err.code === 1
          ? t("predictInput.locationDenied")
          : t("predictInput.weatherLoadFailed");
      stateEl.classList.add("is-error");
    } finally {
      toggleBtn.style.display = "block"; // 성공/실패 관계없이 직접 입력 전환은 항상 가능
      validateForm();
    }
  }

  // ── 기상 정보: 자동 ↔ 직접 입력 전환
  const weatherModeBadge = document.getElementById("weather-mode-badge");
  const weatherManualEl = document.getElementById("weather-manual");
  const weatherStateEl = document.getElementById("weather-state");
  const weatherBodyEl = document.getElementById("weather-body");
  const weatherToggleBtn = document.getElementById("weather-mode-toggle");
  const manualInputs = {
    "평균기온(°C)": document.getElementById("manual-temp"),
    "기상상태 - 습도": document.getElementById("manual-humidity"),
    "일강수량(mm)": document.getElementById("manual-rain"),
    "평균 풍속(m/s)": document.getElementById("manual-wind"),
  };

  function enterManualWeatherMode() {
    weatherMode = "manual";
    weatherModeBadge.textContent = t("predictInput.manualBadge");
    weatherStateEl.style.display = "none";
    weatherBodyEl.style.display = "none";
    weatherToggleBtn.style.display = "none";
    weatherManualEl.style.display = "block";

    // 자동 조회에 성공했던 값이 있으면 미리 채워줘서 그대로 쓰거나 일부만 고치기 편하게
    const base = autoWeatherFields || {};
    Object.entries(manualInputs).forEach(([field, input]) => {
      if (base[field] !== undefined && base[field] !== null && input.value === "") {
        input.value = base[field];
      }
    });

    weatherFields = readManualWeatherFields();
    weatherDescription = t("predictInput.manualDescription");
    validateForm();
  }

  function enterAutoWeatherMode() {
    weatherMode = "auto";
    weatherManualEl.style.display = "none";
    weatherModeBadge.textContent = t("predictInput.weatherAuto");

    if (autoWeatherFields) {
      weatherFields = { ...autoWeatherFields };
      weatherStateEl.style.display = "none";
      weatherBodyEl.style.display = "block";
      weatherToggleBtn.style.display = "block";
    } else {
      // 자동 조회를 아직 못 했거나 실패했던 경우 → 다시 시도
      weatherFields = null;
      weatherStateEl.textContent = t("predictInput.weatherChecking");
      weatherStateEl.classList.remove("is-error");
      weatherStateEl.style.display = "block";
      weatherBodyEl.style.display = "none";
      weatherToggleBtn.style.display = "none";
      loadWeather();
    }
    validateForm();
  }

  /** 직접 입력 필드값 → 백엔드 필드 형태로 변환. 비워둔 값은 결측으로 처리(생략). */
  function readManualWeatherFields() {
    const fields = {};
    Object.entries(manualInputs).forEach(([field, input]) => {
      if (input.value !== "") fields[field] = Number(input.value);
    });
    return fields;
  }

  weatherToggleBtn.addEventListener("click", enterManualWeatherMode);
  document.getElementById("weather-mode-auto").addEventListener("click", enterAutoWeatherMode);
  Object.values(manualInputs).forEach((input) => {
    input.addEventListener("input", () => {
      weatherFields = readManualWeatherFields();
    });
  });

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
    submitBtn.textContent = ready ? t("predictInput.submitBtn") : t("predictInput.submitIncomplete");
  }

  document.addEventListener("i18n:change", () => {
    renderProgressInfo();
    validateForm();
  });

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