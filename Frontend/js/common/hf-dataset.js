// ============================================================
// hf-dataset.js — Hugging Face Dataset Viewer API 클라이언트
// 사고 사례 DB(구 Backend의 /api/cases, /api/cases/{id})를 대체합니다.
// 브라우저가 Render 백엔드를 거치지 않고 datasets-server.huggingface.co를 직접
// 호출합니다 — 이 앱은 대용량 원본 파일(csv/parquet)을 통째로 내려받지 않고,
// 항상 offset/length로 필요한 행만 페이지 단위로 조회합니다.
//
// env.js(빌드 시 scripts/generate-env.js가 생성)가 이 파일보다 먼저 로드되어
// window.APP_CONFIG를 채워둬야 합니다.
//
// 필요한 HF 데이터셋 컬럼 구조는 Backend/prepare_hf_dataset.py 상단 주석과
// 프로젝트 루트 README.md "Hugging Face 데이터셋 준비" 섹션을 참고하세요.
// ============================================================

const HF_ROWS_LENGTH_DEFAULT = 50;
const HF_ROWS_LENGTH_MAX = 100;

function hfConfigReady() {
  return !!(window.APP_CONFIG && window.APP_CONFIG.HF_DATASET_ID);
}

function _hfClampLength(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num < 1) return HF_ROWS_LENGTH_DEFAULT;
  return Math.min(Math.floor(num), HF_ROWS_LENGTH_MAX);
}

function _hfEscapeSqlLiteral(s) {
  return String(s).replace(/'/g, "''");
}

// hazard/검색어 → HF Dataset Viewer의 /filter 엔드포인트가 쓰는 SQL WHERE 절.
// (조건이 없으면 null을 반환 — 이 경우 /rows를 써서 필터 없이 페이지만 조회)
//
// ⚠️ 컬럼명은 반드시 큰따옴표로 감싸야 합니다(문자열 값은 작은따옴표) — 실제 API에
// "hazard_tag = 'x'"처럼 컬럼명을 따옴표 없이 보내면 "Parameter 'where' contains
// errors or invalid symbols"로 거부됩니다. HF 공식 예시(where="no_answer"=true)로
// 직접 검증한 문법입니다.
function _hfBuildWhereClause(q, hazard) {
  const clauses = [];
  if (hazard && hazard !== "전체") {
    clauses.push(`"hazard_tag" = '${_hfEscapeSqlLiteral(hazard)}'`);
  }
  const keyword = (q || "").trim();
  if (keyword) {
    clauses.push(`"search_blob" LIKE '%${_hfEscapeSqlLiteral(keyword)}%'`);
  }
  return clauses.length ? clauses.join(" AND ") : null;
}

/**
 * HF Dataset Viewer API에서 행을 offset/length로 조회.
 * where가 있으면 /filter(서버 측 SQL 필터)를, 없으면 /rows를 호출합니다.
 * /filter가 이 데이터셋/구성에서 지원되지 않으면(4xx/5xx) 필터 없이 /rows로
 * 자동 폴백하고 partial 결과에 filterUnsupported 플래그를 남깁니다 — 필터가 적용된
 * 것처럼 조용히 보여주지 않기 위함입니다.
 */
async function _hfFetchRows({ offset = 0, length = HF_ROWS_LENGTH_DEFAULT, where = null } = {}) {
  const cfg = window.APP_CONFIG;
  const base = (cfg.HF_API_BASE || "https://datasets-server.huggingface.co").replace(/\/$/, "");
  length = _hfClampLength(length);

  async function call(endpoint, withWhere) {
    const params = new URLSearchParams({
      dataset: cfg.HF_DATASET_ID,
      config: cfg.HF_DATASET_CONFIG || "default",
      split: cfg.HF_DATASET_SPLIT || "train",
      offset: String(offset),
      length: String(length),
    });
    if (withWhere) params.set("where", withWhere);
    const res = await fetch(`${base}/${endpoint}?${params.toString()}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`HF Dataset Viewer 요청 실패 (${res.status})`);
      err.status = res.status;
      err.body = body.slice(0, 300);
      throw err;
    }
    return res.json();
  }

  if (where) {
    try {
      const data = await call("filter", where);
      return {
        rows: (data.rows || []).map((r) => r.row),
        numRowsTotal: data.num_rows_total ?? null,
        partial: !!data.partial,
        filterUnsupported: false,
      };
    } catch (err) {
      console.warn("[hf-dataset.js] /filter 실패, 필터 없이 /rows로 대체합니다.", err);
      const data = await call("rows", null);
      return {
        rows: (data.rows || []).map((r) => r.row),
        numRowsTotal: data.num_rows_total ?? null,
        partial: !!data.partial,
        filterUnsupported: true, // 화면에서 "검색/필터가 지금은 지원되지 않아요"로 명시해야 함
      };
    }
  }

  const data = await call("rows", null);
  return {
    rows: (data.rows || []).map((r) => r.row),
    numRowsTotal: data.num_rows_total ?? null,
    partial: !!data.partial,
    filterUnsupported: false,
  };
}

// HF row(원본 컬럼 그대로) → 기존 UI(case-card, similar-case-list 등)가 기대하던 형태.
// incidents_db.py의 _row_to_summary()와 동일한 매핑입니다.
function _mapHfRowToCaseSummary(row) {
  return {
    id: row.id,
    tags: [row.hazard_tag, row.severity_tag],
    title: row["사고명"] || "제목 없음",
    desc: row["사고경위"] || "",
    date: (row["발생일시"] || "").replace(/-/g, "."),
    victims: row.victims_text,
  };
}

// incidents_db.py의 _row_to_detail()과 동일한 매핑.
function _mapHfRowToCaseDetail(row) {
  const base = _mapHfRowToCaseSummary(row);
  const location = [row["시도"], row["군구"]].filter(Boolean).join(" ");
  const prevention = row["재발방지대책"] || "";
  return {
    ...base,
    location: location || "위치 정보 없음",
    causes: {
      direct: row["사고경위"] || "정보 없음",
      indirect: row["사고원인"] || "정보 없음",
      root: row["구체적 사고원인"] || "정보 없음",
    },
    timeline: [row["사고경위"] || "정보 없음"],
    prevention: prevention ? [prevention] : ["등록된 재발방지대책이 없어요."],
  };
}

/**
 * @param {{q?: string, hazard?: string, limit?: number, offset?: number}} opts
 * @returns {Promise<{total: number, cases: object[], _hf: true, _filterUnsupported?: boolean}>}
 */
async function getCasesFromHF({ q = "", hazard = "전체", limit = HF_ROWS_LENGTH_DEFAULT, offset = 0 } = {}) {
  const where = _hfBuildWhereClause(q, hazard);
  const { rows, numRowsTotal, filterUnsupported } = await _hfFetchRows({ offset, length: limit, where });
  return {
    total: numRowsTotal ?? (filterUnsupported ? rows.length : offset + rows.length),
    cases: rows.map(_mapHfRowToCaseSummary),
    _hf: true,
    _filterRequested: !!where,
    _filterUnsupported: !!where && filterUnsupported,
  };
}

/**
 * @param {string|number} caseId id = HF 데이터셋 행 offset(=원본 df_db.csv 행 인덱스)
 * @returns {Promise<object|null>}
 */
async function getCaseDetailFromHF(caseId) {
  const idx = Number(caseId);
  if (!Number.isFinite(idx) || idx < 0) return null;
  const { rows } = await _hfFetchRows({ offset: idx, length: 1 });
  if (!rows.length) return null;
  return _mapHfRowToCaseDetail(rows[0]);
}
