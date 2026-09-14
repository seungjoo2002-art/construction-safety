// ============================================================
// idb-store.js — IndexedDB 저장소 (최근 검색 결과 + 즐겨찾기)
// 다른 js보다 먼저 로드되어야 합니다 (api.js, similar-cases.js, case-detail.js가 사용).
// 외부 라이브러리 없이 순수 indexedDB API만 사용합니다.
//
// 원칙(요구사항 6, 7):
//   - "원본 대용량 데이터"는 여기 저장하지 않습니다. 사용자가 실제로 조회한
//     검색 결과 페이지(최대 수십 건)와 즐겨찾기한 사례만 저장합니다.
//   - 오프라인일 때 화면에 보여줄 "마지막 데이터" 용도이므로 저장 개수를
//     kind별로 제한하고(MAX_RECENT_PER_KIND), 초과분은 오래된 것부터 정리합니다.
// ============================================================

const IDB_NAME = "ai-safety-app";
const IDB_VERSION = 1;
const STORE_RECENT = "recentSearches";
const STORE_FAVORITES = "favorites";
const MAX_RECENT_PER_KIND = 20;

let _dbPromise = null;

function openIdb() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("이 브라우저는 IndexedDB를 지원하지 않아요."));
      return;
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_RECENT)) {
        const store = db.createObjectStore(STORE_RECENT, { keyPath: "key" });
        store.createIndex("by_kind_savedAt", ["kind", "savedAt"]);
      }
      if (!db.objectStoreNames.contains(STORE_FAVORITES)) {
        db.createObjectStore(STORE_FAVORITES, { keyPath: "id" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    _dbPromise = null; // 다음 호출에서 재시도할 수 있게
    throw err;
  });

  return _dbPromise;
}

function _tx(db, storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function _reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── 최근 검색 결과 ──────────────────────────────────────────
// kind: "cases" | "incidents" | "caseDetail" 등 화면/API별 구분자
// queryKey: 같은 검색조건을 다시 찾을 때 쓰는 문자열 키 (예: "q=추락&hazard=전체")

async function saveRecentSearch(kind, queryKey, data) {
  try {
    const db = await openIdb();
    const store = _tx(db, STORE_RECENT, "readwrite");
    const key = `${kind}::${queryKey}`;
    await _reqToPromise(store.put({ key, kind, queryKey, data, savedAt: Date.now() }));
    await _pruneRecentSearches(kind);
  } catch (err) {
    console.warn("[idb-store.js] saveRecentSearch 실패 (무시하고 계속 진행)", err);
  }
}

async function getRecentSearch(kind, queryKey) {
  try {
    const db = await openIdb();
    const store = _tx(db, STORE_RECENT, "readonly");
    const row = await _reqToPromise(store.get(`${kind}::${queryKey}`));
    return row ? row.data : null;
  } catch (err) {
    console.warn("[idb-store.js] getRecentSearch 실패", err);
    return null;
  }
}

// 정확히 같은 검색조건 캐시가 없을 때, 오프라인 화면에 보여줄 "그나마 가장 최근" 데이터
async function getLatestSearch(kind) {
  try {
    const db = await openIdb();
    const store = _tx(db, STORE_RECENT, "readonly");
    const index = store.index("by_kind_savedAt");
    const range = IDBKeyRange.bound([kind, 0], [kind, Number.MAX_SAFE_INTEGER]);
    let latest = null;
    await new Promise((resolve, reject) => {
      const cursorReq = index.openCursor(range, "prev"); // 최신순
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          latest = cursor.value.data;
        }
        resolve();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
    return latest;
  } catch (err) {
    console.warn("[idb-store.js] getLatestSearch 실패", err);
    return null;
  }
}

async function _pruneRecentSearches(kind) {
  const db = await openIdb();
  const store = _tx(db, STORE_RECENT, "readwrite");
  const index = store.index("by_kind_savedAt");
  const range = IDBKeyRange.bound([kind, 0], [kind, Number.MAX_SAFE_INTEGER]);

  const rows = [];
  await new Promise((resolve, reject) => {
    const cursorReq = index.openCursor(range);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        rows.push(cursor.value);
        cursor.continue();
      } else {
        resolve();
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });

  if (rows.length <= MAX_RECENT_PER_KIND) return;

  rows.sort((a, b) => a.savedAt - b.savedAt); // 오래된 것부터
  const toDelete = rows.slice(0, rows.length - MAX_RECENT_PER_KIND);
  for (const row of toDelete) {
    store.delete(row.key);
  }
}

// ── 즐겨찾기(사고 사례 북마크) ──────────────────────────────

async function addFavorite(caseData) {
  const db = await openIdb();
  const store = _tx(db, STORE_FAVORITES, "readwrite");
  await _reqToPromise(store.put({ ...caseData, savedAt: Date.now() }));
}

async function removeFavorite(id) {
  const db = await openIdb();
  const store = _tx(db, STORE_FAVORITES, "readwrite");
  await _reqToPromise(store.delete(id));
}

async function isFavorite(id) {
  try {
    const db = await openIdb();
    const store = _tx(db, STORE_FAVORITES, "readonly");
    const row = await _reqToPromise(store.get(id));
    return !!row;
  } catch (err) {
    console.warn("[idb-store.js] isFavorite 실패", err);
    return false;
  }
}

async function listFavorites() {
  try {
    const db = await openIdb();
    const store = _tx(db, STORE_FAVORITES, "readonly");
    const rows = await _reqToPromise(store.getAll());
    return rows.sort((a, b) => b.savedAt - a.savedAt);
  } catch (err) {
    console.warn("[idb-store.js] listFavorites 실패", err);
    return [];
  }
}
