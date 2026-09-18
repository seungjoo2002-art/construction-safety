// ============================================================
// predict-loading.js — 위험도 분석 로딩 화면
// api.js 보다 나중에 로드되어야 합니다.
//
// 동작:
//  1) predict-input.html에서 저장해둔 payload를 읽음 (없으면 되돌려보냄)
//  2) 1,2단계는 정해진 시간 지나면 자동으로 체크 표시 (연출용)
//  3) 3단계는 실제(지금은 목업) API 응답이 올 때까지 "진행 중" 상태 유지
//  4) 응답 오면 3단계도 체크 표시 → 결과를 저장하고 predict-result.html로 이동
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  const payloadRaw = sessionStorage.getItem("predict_input_payload");

  if (!payloadRaw) {
    // 입력 데이터 없이 이 화면에 바로 들어온 경우 (새로고침 등) → 입력 화면으로 되돌림
    window.location.href = "predict-input.html";
    return;
  }

  const payload = JSON.parse(payloadRaw);

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

  // ── 실제(목업) API 호출은 화면 연출과 동시에 백그라운드에서 진행
  const apiPromise = predictRisk(payload);
  const simPromise = getSimilarity(payload); // 유사도 분석(유사사례+산점도+재발방지대책)도 같이 요청
  const advisePromise = getSafetyAdvice(payload); // KOSHA 근거사례 + AI 생성 안전수칙도 같이 요청

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

  try {
    const [result, simResult, adviseResult] = await Promise.all([apiPromise, simPromise, advisePromise]); // { severity, accident_type }, { similar_cases, mds_chart_image, prevention_guidelines }, { evidence, advice, verification, retrieval }|null
    markDone(step3);
    setProgress(100);

    // ── 디버깅용: 백엔드에서 받은 결과값을 콘솔에 그대로 표시
    console.log("[predict-loading.js] 위험도 분석 결과 (severity + accident_type):", result);
    console.log("[predict-loading.js] 유사도 분석 결과 (similar_cases + mds_chart_image + prevention_guidelines):", simResult);
    console.log("[predict-loading.js] 해결방안 결과 (evidence + advice + verification):", adviseResult);

    saveLastPredictResult(result, payload); // 대시보드가 읽어갈 "최근 분석" 갱신
    saveLastSimilarity(simResult); // 대시보드/유사사례가 읽어갈 "최근 유사도 분석" 갱신
    saveAnalysisRecord(result, payload, simResult); // 알림 화면에서 다시 열어볼 수 있도록 분석 이력에 자동 기록

    // ── 위험/매우위험 등급이면 실제 브라우저 알림으로 즉시 안내
    const grade = result.severity.fatal_risk.grade;
    if (grade === "위험" || grade === "매우위험") {
      showRealNotification(
        "⚠️ 위험 감지",
        `종합 위험도 ${Math.round(result.severity.fatal_risk.percentile)}점(${grade}) - 즉각적인 안전점검이 필요해요`,
        "risk-alert"
      );
    }

    // predict-result.html에서 읽을 수 있도록 결과 + 원본 입력값 저장
    sessionStorage.setItem("predict_result", JSON.stringify(result));
    sessionStorage.setItem("predict_result_input", JSON.stringify(payload));
    sessionStorage.setItem("similarity_result", JSON.stringify(simResult));
    if (adviseResult) sessionStorage.setItem("advise_result", JSON.stringify(adviseResult));
    else sessionStorage.removeItem("advise_result");

    await wait(400); // 체크 표시가 눈에 보일 시간 살짝 확보
    window.location.href = "predict-result.html";
  } catch (err) {
    console.error(err);

    // fetch 자체가 실패(네트워크 단절, CORS 등)하면 TypeError, 5초 타임아웃이면 TimeoutError/AbortError.
    // 그 외는 서버가 응답은 했지만 에러를 준 경우(예: 500, JSON 파싱 실패 등)로 구분해서 안내합니다.
    const isConnectionError =
      err instanceof TypeError || err.name === "TimeoutError" || err.name === "AbortError";
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