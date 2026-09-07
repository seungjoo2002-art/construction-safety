// ============================================================
// case-detail.js — 사고 상세정보 화면
// mock-cases.js, api.js 보다 나중에 로드되어야 합니다.
// URL 쿼리스트링(?id=...)으로 어떤 사례를 보여줄지 결정합니다.
// 백엔드(app.py의 /api/cases/{id})에서 가져오고, 연결 실패 시
// api.js가 자동으로 MOCK_CASES에서 같은 id를 찾아 대체합니다.
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const caseId = params.get("id");
  const root = document.getElementById("content-root");

  if (!caseId) {
    renderNotFound();
    return;
  }

  root.innerHTML = `<p style="text-align:center; padding: var(--space-xl) 0; color: var(--color-text-secondary);">불러오는 중...</p>`;

  const caseData = await getCaseDetail(caseId);

  if (!caseData) {
    renderNotFound();
    return;
  }

  function renderNotFound() {
    root.innerHTML = `
      <p style="text-align:center; padding: var(--space-xl) 0; color: var(--color-text-secondary);">
        사례를 찾을 수 없어요.
      </p>
      <a href="similar-cases.html" class="btn btn-primary btn-block">목록으로 돌아가기</a>
    `;
  }

  function tagBadgeClass(tag) {
    if (["치명", "중상"].includes(tag)) return "badge--danger";
    if (["경상"].includes(tag)) return "badge--safe";
    return "badge--caution";
  }

  function formatDate(rawDate) {
    const parts = String(rawDate).split(/[.-]/).filter(Boolean);
    if (parts.length < 3) return rawDate;
    const [y, m, d] = parts;
    return `${y}년 ${Number(m)}월 ${Number(d)}일`;
  }

  root.innerHTML = `
    <div class="card case-alert">
      <div class="case-alert__title">📋 사고 사례 상세 ${caseData._mock ? '<span class="mock-tag" style="color:#fff; background:rgba(255,255,255,0.25);">MOCK</span>' : ""}</div>
      <div class="case-alert__desc">
        국내 건설사고 데이터베이스에 기록된 실제 사례입니다. 유사한 조건에서 작업 중이라면
        아래 재발 방지 대책을 참고해 사전 안전조치를 취하세요.
      </div>
    </div>

    <div class="case-card__tags" style="margin-bottom: 4px;">
      ${caseData.tags.map((t) => `<span class="badge ${tagBadgeClass(t)}">${t}</span>`).join("")}
    </div>
    <div class="case-detail-title">${caseData.title}</div>

    <section class="card" style="margin-bottom: var(--space-md);">
      <div class="case-detail-meta-row">
        <span class="case-detail-meta-row__icon">📅</span>
        <div>
          <div class="case-detail-meta-row__label">발생일</div>
          <div class="case-detail-meta-row__value">${formatDate(caseData.date)}</div>
        </div>
      </div>
      <div class="case-detail-meta-row">
        <span class="case-detail-meta-row__icon">📍</span>
        <div>
          <div class="case-detail-meta-row__label">현장</div>
          <div class="case-detail-meta-row__value">${caseData.location}</div>
        </div>
      </div>
      <div class="case-detail-meta-row">
        <span class="case-detail-meta-row__icon">👥</span>
        <div>
          <div class="case-detail-meta-row__label">재해자</div>
          <div class="case-detail-meta-row__value">${caseData.victims}</div>
        </div>
      </div>
    </section>

    <section class="card" style="margin-bottom: var(--space-md);">
      <h2 class="card-section-title">📋 사고 원인</h2>
      <div class="cause-row">
        <span class="cause-row__label cause-row__label--direct">직접원인</span>
        <span class="cause-row__text">${caseData.causes.direct}</span>
      </div>
      <div class="cause-row">
        <span class="cause-row__label cause-row__label--indirect">간접원인</span>
        <span class="cause-row__text">${caseData.causes.indirect}</span>
      </div>
      <div class="cause-row">
        <span class="cause-row__label cause-row__label--root">근본원인</span>
        <span class="cause-row__text">${caseData.causes.root}</span>
      </div>
    </section>

    <section class="card" style="margin-bottom: var(--space-md);">
      <h2 class="card-section-title">🔄 사고 경위</h2>
      <div class="timeline">
        ${caseData.timeline
          .map(
            (step, i) => `
          <div class="timeline__item">
            <span class="timeline__dot">${i + 1}</span>
            ${step}
          </div>
        `
          )
          .join("")}
      </div>
    </section>

    <section class="card" style="margin-bottom: var(--space-md); background: var(--color-safe-bg);">
      <h2 class="card-section-title">✅ 재발 방지 대책</h2>
      <div class="prevention-list">
        ${caseData.prevention
          .map(
            (p) => `
          <div class="prevention-list__item">
            <span class="prevention-list__check">✓</span>
            <span>${p}</span>
          </div>
        `
          )
          .join("")}
      </div>
    </section>
  `;

  // ── 저장/공유 (predict-result.js와 동일한 패턴)
  document.getElementById("bookmark-btn").addEventListener("click", (e) => {
    const saved = JSON.parse(localStorage.getItem("saved_cases") || "[]");
    if (!saved.includes(caseData.id)) {
      saved.unshift(caseData.id);
      localStorage.setItem("saved_cases", JSON.stringify(saved.slice(0, 50)));
    }
    e.target.textContent = "✅";
    setTimeout(() => (e.target.textContent = "🔖"), 1200);
  });

  document.getElementById("share-btn").addEventListener("click", async () => {
    const shareText = `[사고 사례] ${caseData.title}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: caseData.title, text: shareText });
      } catch (err) {
        /* 취소 시 별도 처리 불필요 */
      }
    } else {
      alert("이 브라우저는 공유 기능을 지원하지 않아요. 아래 내용을 복사해서 사용해주세요:\n\n" + shareText);
    }
  });
});
