// ============================================================
// weather.js — OpenWeatherMap 연동
// ⚠️ 임시 방식입니다. 학습 데이터(기상청 ASOS)와 출처가 달라
//    예측 정확도에 약간 영향을 줄 수 있습니다.
//    나중에 기상청 공공데이터포털 API로 교체 예정.
// ⚠️ API 키가 프론트 코드에 그대로 노출됩니다 (개발자도구에서 보임).
//    지금은 빠른 개발을 위해 감수하고, 나중에 백엔드 프록시로 옮기는 걸 권장합니다.
// ============================================================

const OWM_API_KEY = "df718eecd2e527435b8ee31b16d7a462"; // TODO: 실제 키로 교체

/** 브라우저 위치 권한으로 현재 위경도 조회 (Promise 래핑) */
function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("이 브라우저는 위치 정보를 지원하지 않습니다."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(err),
      { timeout: 8000 }
    );
  });
}

/** 현재 날씨 조회 */
async function fetchCurrentWeather(lat, lon) {
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OWM_API_KEY}&units=metric&lang=kr`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`현재 날씨 조회 실패 (${res.status})`);
  const data = await res.json();

  return {
    temp: data.main.temp,                    // 평균기온(°C)
    humidity: data.main.humidity,             // 기상상태 - 습도(%)
    windSpeed: data.wind.speed,                // 평균 풍속(m/s)
    rain1h: data.rain?.["1h"] ?? 0,           // 최근 1시간 강수량(mm), 참고용
    description: data.weather?.[0]?.description ?? "",
    icon: data.weather?.[0]?.icon ?? "",
  };
}

/** 오늘 남은 시간대의 3시간 간격 예보 목록 (최대 8개) */
async function fetchHourlyToday(lat, lon) {
  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${OWM_API_KEY}&units=metric&lang=kr`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`시간별 예보 조회 실패 (${res.status})`);
  const data = await res.json();

  const todayStr = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  return data.list
    .filter((item) => item.dt_txt.startsWith(todayStr))
    .map((item) => ({
      time: item.dt_txt.slice(11, 16), // "HH:MM"
      temp: item.main.temp,
      humidity: item.main.humidity,
      windSpeed: item.wind.speed,
      rain3h: item.rain?.["3h"] ?? 0,
      pop: Math.round((item.pop ?? 0) * 100), // 강수확률(%)
      icon: item.weather?.[0]?.icon ?? "",
      description: item.weather?.[0]?.description ?? "",
    }));
}

// ── 세션 캐시: 대시보드 → 시간별 날씨 페이지 이동 시 재조회/재권한요청 방지
const WEATHER_CACHE_KEY = "weather_cache_v1";
const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000; // 10분

function readWeatherCache() {
  try {
    const raw = sessionStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.fetchedAt > WEATHER_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeWeatherCache(snapshot) {
  try {
    sessionStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    /* 저장 실패해도 기능엔 지장 없음 (다음에 다시 조회될 뿐) */
  }
}

/**
 * 위치 확인 + 현재날씨 + 오늘 시간별예보를 한 번에 가져오는 진입점.
 * 캐시가 10분 이내면 캐시를 그대로 씀 (페이지 이동해도 재조회 안 함).
 * forceRefresh=true 로 강제 새로고침 가능.
 */
async function getWeatherSnapshot(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = readWeatherCache();
    if (cached) return cached;
  }
  const { lat, lon } = await getCurrentPosition();
  const [current, hourlyList] = await Promise.all([
    fetchCurrentWeather(lat, lon),
    fetchHourlyToday(lat, lon),
  ]);
  const snapshot = { current, hourlyList, fetchedAt: Date.now() };
  writeWeatherCache(snapshot);
  return snapshot;
}

/**
 * 오늘 누적 강수량 근사치.
 * ⚠️ 무료 API는 "이미 지나간 시간"의 실측 강수량을 안 줘서,
 *    지금 이후 남은 예보 시간대의 강수량만 더한 근사값입니다.
 *    실제 오늘 하루 총량보다 적게 나올 수 있습니다.
 */
function estimateTodayRainfall(hourlyList) {
  return Math.round(hourlyList.reduce((sum, h) => sum + (h.rain3h || 0), 0) * 10) / 10;
}

/**
 * 백엔드 config.RAW_INPUT_COLS 필드명에 맞춰 변환.
 * 기온_D1~D3 / 강수_D1~D3 / 풍속_D1~D3(최근 3일)은
 * 무료 API로 조회 불가 → 의도적으로 비워서 백엔드가 결측 처리하게 둡니다.
 */
function toBackendWeatherFields(current, hourlyList) {
  return {
    "기상상태 - 습도": current.humidity,
    "평균기온(°C)": current.temp,
    "일강수량(mm)": estimateTodayRainfall(hourlyList),
    "평균 풍속(m/s)": current.windSpeed,
    // 기온_D1, 기온_D2, 기온_D3, 강수_D1~D3, 풍속_D1~D3: 의도적 결측
  };
}

/** OpenWeatherMap 아이콘 코드 → 이모지 (아이콘 이미지 API 대신 간단 표기) */
function weatherIconToEmoji(iconCode) {
  const map = {
    "01": "☀️", "02": "🌤", "03": "☁️", "04": "☁️",
    "09": "🌧", "10": "🌦", "11": "⛈", "13": "❄️", "50": "🌫",
  };
  const key = (iconCode || "").slice(0, 2);
  return map[key] || "🌡";
}