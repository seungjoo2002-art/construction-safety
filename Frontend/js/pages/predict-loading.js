// ============================================================
// predict-loading.js — 위험도 분석 로딩 화면
// api.js 보다 나중에 로드되어야 합니다.
//
// 동작:
//  1) predict-input.html에서 저장해둔 payload + 작업 시간(KST 날짜, 시작/종료 시각)을 읽음
//     (없으면 되돌려보냄)
//  2) 1,2단계는 정해진 시간 지나면 자동으로 체크 표시 (연출용)
//  3) 3단계: 시간대별 위험도(/api/predict-hourly) → p_fatal 최대 시각(동점이면 가장 이른
//     시각) 선정 → 그 시각 입력값으로만 예방대책(/api/advise) 요청. 유사도(/api/analyze)는
//     시각 변수를 쓰지 않아(app.py build_similarity_input) 처음부터 병렬로 요청한다.
//  4) 전부 끝나면 3단계도 체크 표시 → 결과를 저장하고 predict-result.html로 이동
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  const payloadRaw = sessionStorage.getItem("predict_input_payload");
  const workHoursRaw = sessionStorage.getItem("predict_work_hours");

  if (!payloadRaw || !workHoursRaw) {
    // 입력 데이터 없이 이 화면에 바로 들어온 경우 (새로고침 등) → 입력 화면으로 되돌림
    window.location.href = "predict-input.html";
    return;
  }

  const payload = JSON.parse(payloadRaw);
  const workHours = JSON.parse(workHoursRaw); // { date: "YYYY-MM-DD"(KST), startHour, endHour }

  // ── 디버깅용: 백엔드로 보내는 입력 변수를 콘솔에 그대로 표시
  console.log("[predict-loading.js] 위험도 분석 입력 변수:", payload);
  console.table(payload);

  const step1 = document.getElementById("step-1");
  const step2 = document.getElementById("step-2");
  const step3 = document.getElementById("step-3");
  const step3Desc = document.getElementById("step-3-desc");

  const progressFill = document.getElementById("loading-progress-fill");

  function markDone(stepEl) {
    stepEl.classList.remove("is-active");
    stepEl.classList.add("is-done");
    stepEl.querySelector(".step-item__icon").textContent = "✓";
  }
  function markActive(stepEl) {
    stepEl.classList.add("is-active");
    stepEl.querySelector(".step-item__icon").textContent = "•••";
  }
  function setProgress(pct) {
    progressFill.style.width = `${pct}%`;
  }

  // ── 연출용 지연 함수
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const hh = (h) => `${String(h).padStart(2, "0")}:00`;

  // ── 실제 API 호출은 화면 연출과 동시에 백그라운드에서 진행
  //    1단계: 시간대별 위험도만 예측 → 2단계: 최대 p_fatal 시각 선정(백엔드) →
  //    3단계: 그 시각 입력값으로 예방대책 생성. 유사도는 시각과 무관해 바로 병렬 요청.
  const hourlyPromise = predictHourlyRisk(payload, workHours);
  const simPromise = getSimilarity(payload); // 유사도 분석(유사사례+산점도+재발방지대책)
  hourlyPromise.catch(() => {}); // 실패는 아래 try에서 처리 (연출 대기 중 unhandled rejection 방지)

  markActive(step1);
  setProgress(10);
  await wait(700);
  markDone(step1);
  setProgress(33);

  markActive(step2);
  await wait(700);
  markDone(step2);
  setProgress(66);

  markActive(step3);
  step3Desc.textContent = `시간대별 위험도 산출 중 (${hh(workHours.startHour)}~${hh(workHours.endHour)})...`;

  try {
    const result = await hourlyPromise; // { severity, accident_type, hourly } — severity/accident_type은 가장 위험한 시각 기준
    const peakTime = hh(result.hourly.peak_hour);
    console.log(
      "[predict-loading.js] 시간대별 p_fatal:",
      result.hourly.points.map((p) => `${hh(p.hour)} p_fatal=${p.p_fatal} (사고_시간=${p.model_input_hour})`)
    );
    console.log(`[predict-loading.js] 가장 위험한 시간대: ${peakTime} (${result.hourly.peak_datetime})`);

    // 이후 화면/저장/예방대책은 전부 "가장 위험한 시각" 입력값 기준
    const peakPayload = {
      ...payload,
      "발생일시": result.hourly.peak_datetime,
      "사고일시_x": result.hourly.peak_datetime,
    };
    step3Desc.textContent = `가장 위험한 시간(${peakTime}) 기준 예방대책 생성 중...`;
    const [simResult, adviseResult] = await Promise.all([simPromise, getSafetyAdvice(peakPayload)]); // { similar_cases, mds_chart_image, prevention_guidelines }, { evidence, advice, verification, retrieval }|null
    markDone(step3);
    setProgress(100);

    // ── 디버깅용: 백엔드에서 받은 결과값을 콘솔에 그대로 표시
    console.log("[predict-loading.js] 위험도 분석 결과 (severity + accident_type):", result);
    console.log("[predict-loading.js] 유사도 분석 결과 (similar_cases + mds_chart_image + prevention_guidelines):", simResult);
    console.log("[predict-loading.js] 해결방안 결과 (evidence + advice + verification):", adviseResult);

    // 내 분석 기록(서버 DB, 로그인 사용자 소유)에 자동 저장 — 대시보드·알림·분석기록이 모두 이 기록을 읽는다.
    // 저장이 실패해도 방금 분석한 결과 화면은 보여주고, 결과 화면의 "저장" 버튼으로 다시 시도할 수 있다.
    let recordId = null;
    try {
      recordId = await saveAnalysisRecord(result, peakPayload, simResult, adviseResult);
    } catch (saveErr) {
      console.error("[predict-loading.js] 분석 기록 저장 실패", saveErr);
    }

    // ── 위험/매우위험 등급이면 실제 브라우저 알림으로 즉시 안내
    const grade = result.severity.fatal_risk.grade;
    if (grade === "위험" || grade === "매우위험") {
      showRealNotification(
        "⚠️ 위험 감지",
        `오늘 ${peakTime} 종합 위험도 ${Math.round(result.severity.fatal_risk.percentile)}점(${grade}) - 즉각적인 안전점검이 필요해요`,
        "risk-alert"
      );
    }

    // predict-result.html에서 읽을 수 있도록 결과 + 원본 입력값 저장
    sessionStorage.setItem("predict_result", JSON.stringify(result));
    if (recordId) sessionStorage.setItem("predict_result_id", recordId);
    else sessionStorage.removeItem("predict_result_id");
    sessionStorage.setItem("predict_result_input", JSON.stringify(peakPayload));
    if (simResult) sessionStorage.setItem("similarity_result", JSON.stringify(simResult));
    else sessionStorage.removeItem("similarity_result");
    if (adviseResult) sessionStorage.setItem("advise_result", JSON.stringify(adviseResult));
    else sessionStorage.removeItem("advise_result");

    await wait(400); // 체크 표시가 눈에 보일 시간 살짝 확보
    window.location.href = "predict-result.html";
  } catch (err) {
    console.error(err);

    // api.js의 ApiError.kind로 연결 실패(network/timeout)와 서버 오류(server/client)를 구분합니다.
    // 그 외는 서버가 응답은 했지만 에러를 준 경우(예: 500, JSON 파싱 실패 등)로 구분해서 안내합니다.
    const isConnectionError = err.kind === "network" || err.kind === "timeout" || err instanceof TypeError;
    step3Desc.textContent = isConnectionError
      ? "백엔드 서버에 연결할 수 없어요. 서버가 켜져 있는지 확인해주세요."
      : "분석 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.";
    step3.classList.remove("is-active");
    step3.style.borderColor = "var(--color-danger)";
    step3.style.background = "var(--color-danger-bg)";

    // 잠시 후 입력 화면으로 되돌려서 재시도할 수 있게 함
    await wait(1800);
    window.location.href = "predict-input.html";
  }
});