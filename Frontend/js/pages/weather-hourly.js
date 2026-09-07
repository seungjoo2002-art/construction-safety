// ============================================================
// weather-hourly.js — 오늘 시간별 날씨 화면
// dashboard.html에서 이미 조회한 캐시가 있으면 그걸 그대로 씀
// (위치 권한 재요청/재조회 없이 즉시 표시됨).
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  const stateEl = document.getElementById("weather-state");
  const bodyEl = document.getElementById("weather-body");

  try {
    const { current, hourlyList } = await getWeatherSnapshot();

    // ── 현재 날씨 히어로
    document.getElementById("hero-icon").textContent = weatherIconToEmoji(current.icon);
    document.getElementById("hero-temp").textContent = `${Math.round(current.temp)}°C`;
    document.getElementById("hero-desc").textContent = current.description;

    const statsEl = document.getElementById("hero-stats");
    statsEl.innerHTML = `
      <div class="weather-current__item">
        <div class="weather-current__label">습도</div>
        <div class="weather-current__value">${current.humidity}%</div>
      </div>
      <div class="weather-current__item">
        <div class="weather-current__label">풍속</div>
        <div class="weather-current__value">${current.windSpeed}m/s</div>
      </div>
      <div class="weather-current__item">
        <div class="weather-current__label">최근 1시간 강수</div>
        <div class="weather-current__value">${current.rain1h}mm</div>
      </div>
      <div class="weather-current__item">
        <div class="weather-current__label">체감</div>
        <div class="weather-current__value">${Math.round(current.temp)}°C</div>
      </div>
    `;

    // ── 시간별 리스트
    const listEl = document.getElementById("hourly-list");
    if (hourlyList.length === 0) {
      listEl.innerHTML = `<p style="font-size: var(--fs-sm); color: var(--color-text-secondary);">
        오늘 남은 예보 시간대가 없어요. 내일 예보는 추후 지원 예정입니다.
      </p>`;
    } else {
      listEl.innerHTML = hourlyList
        .map(
          (h) => `
        <div class="hourly-list__row">
          <div class="hourly-list__time">${h.time}</div>
          <div class="hourly-list__icon">${weatherIconToEmoji(h.icon)}</div>
          <div class="hourly-list__desc">${h.description}</div>
          <div class="hourly-list__pop">💧${h.pop}%</div>
          <div class="hourly-list__temp">${Math.round(h.temp)}°C</div>
        </div>
      `
        )
        .join("");
    }

    stateEl.style.display = "none";
    bodyEl.style.display = "block";
  } catch (err) {
    console.error(err);
    stateEl.textContent =
      err && err.code === 1
        ? "위치 권한이 거부되어 날씨를 불러올 수 없어요. 브라우저 설정에서 위치 접근을 허용해주세요."
        : "날씨 정보를 불러오지 못했어요. (API 키 확인 필요할 수 있음)";
    stateEl.classList.add("is-error");
  }
});