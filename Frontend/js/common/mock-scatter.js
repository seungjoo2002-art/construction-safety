// ============================================================
// mock-scatter.js — 유사도 산점도 목업 데이터
// ⚠️ 완전 목업입니다. 실제 임베딩 기반 유사도 계산 모델은 없습니다.
//    predict-result.js(미니차트), scatter-detail.js(전체차트)가 공유합니다.
// ============================================================

const SCATTER_TYPE_COLORS = {
  "추락": "#E53935",
  "낙하물": "#FF9800",
  "충돌": "#FFC107",
  "감전": "#9C27B0",
  "전도": "#00BCD4",
  "끼임": "#E91E8C",
};

// Top-5(기준점과 가장 가까운 5건) — rank 1~5
const SCATTER_TOP5 = [
  { x: 0.35, y: 0.22, type: "추락", severity: "치명", rank: 1, title: "강남 오피스텔 고소작업 추락사고" },
  { x: -0.42, y: 0.31, type: "추락", severity: "중상", rank: 2, title: "부산 아파트 고소작업 추락사고" },
  { x: 0.12, y: -0.55, type: "낙하물", severity: "치명", rank: 3, title: "인천 물류창고 자재 낙하물 사고" },
  { x: -0.58, y: -0.28, type: "추락", severity: "경상", rank: 4, title: "울산 조선소 고소작업 추락사고" },
  { x: 0.61, y: -0.15, type: "충돌", severity: "중상", rank: 5, title: "대구 공사현장 장비 충돌사고" },
];

// 나머지 15건 (Top-5 반경 밖)
const SCATTER_OTHERS = [
  { x: 1.4, y: 1.6, type: "추락", severity: "경상", title: "수원 아파트 추락사고" },
  { x: -1.6, y: 1.3, type: "추락", severity: "중상", title: "광주 오피스 추락사고" },
  { x: 1.9, y: 0.4, type: "추락", severity: "치명", title: "천안 물류센터 추락사고" },
  { x: -1.3, y: -1.7, type: "추락", severity: "중상", title: "대전 상가 추락사고" },
  { x: 2.2, y: -1.1, type: "추락", severity: "경상", title: "청주 아파트 추락사고" },
  { x: -2.4, y: 0.7, type: "낙하물", severity: "중상", title: "평택 공장 낙하물 사고" },
  { x: 1.1, y: -2.3, type: "낙하물", severity: "경상", title: "김해 물류창고 낙하물 사고" },
  { x: -0.9, y: 2.4, type: "전도", severity: "경상", title: "창원 건물 전도사고" },
  { x: 2.6, y: 1.9, type: "전도", severity: "중상", title: "전주 철거현장 전도사고" },
  { x: -2.1, y: -0.9, type: "전도", severity: "경상", title: "포항 공장 전도사고" },
  { x: 0.8, y: 2.7, type: "충돌", severity: "중상", title: "성남 현장 장비 충돌사고" },
  { x: -2.7, y: -1.8, type: "감전", severity: "중상", title: "서울 상업시설 감전 사고" },
  { x: 1.7, y: -2.6, type: "감전", severity: "경상", title: "인천 배전작업 감전 사고" },
  { x: -1.5, y: 2.5, type: "끼임", severity: "치명", title: "경기 공장 기계 끼임 사고" },
  { x: 2.9, y: -0.6, type: "끼임", severity: "중상", title: "화성 설비 끼임 사고" },
];

const SCATTER_ALL = [...SCATTER_TOP5, ...SCATTER_OTHERS];

/** 유형별 건수/비율 집계 (범례·막대리스트 렌더링용) */
function scatterTypeCounts(points) {
  const counts = {};
  points.forEach((p) => (counts[p.type] = (counts[p.type] || 0) + 1));
  return Object.entries(counts)
    .map(([type, count]) => ({ type, count, pct: Math.round((count / points.length) * 100) }))
    .sort((a, b) => b.count - a.count);
}

/** 심각도별 건수 집계 */
function scatterSeverityCounts(points) {
  const counts = { "치명": 0, "중상": 0, "경상": 0 };
  points.forEach((p) => {
    if (counts[p.severity] !== undefined) counts[p.severity]++;
  });
  return counts;
}