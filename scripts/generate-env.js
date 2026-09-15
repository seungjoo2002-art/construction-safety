// ============================================================
// scripts/generate-env.js — Render Static Site 빌드 스크립트
// ============================================================
// 이 저장소는 Vite/Next.js 같은 번들러가 없는 순수 정적 HTML/CSS/JS 앱입니다.
// 그래서 "환경변수를 번들에 주입"하는 표준 번들러 기능이 없고, 대신 이 스크립트가
// Render의 Build Command로 실행되어 Environment 탭에 등록된 값을 읽어
// Frontend/js/common/env.js 파일을 직접 덮어씁니다(빌드 시 딱 1번).
//
// 순수 Node 내장 모듈만 사용합니다 — npm install이 전혀 필요 없습니다.
//
// 이 스크립트가 하는 일 2가지:
//   1) Frontend/js/common/env.js 생성 — HF 데이터셋 설정 + 백엔드(Render Web Service)
//      URL (전부 공개 정보, 비밀값 아님 — API 키 등 비밀값은 여기 넣지 않는다)
//   2) pictures/ → Frontend/pictures/ 복사 — Render Publish Directory가 Frontend
//      하나뿐이라, Frontend 바깥의 저장소 루트 pictures/(아이콘)까지 함께 배포되게
//      만들어준다. (로컬 저장소의 pictures/는 원래 위치 그대로 둔다 — 로컬에서
//      저장소 루트를 그대로 열어 테스트하는 기존 방식이 계속 동작해야 하므로.)
// ============================================================
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
const FRONTEND_DIR = path.join(ROOT_DIR, "Frontend");

function generateEnvFile() {
  const datasetId = process.env.HF_DATASET_ID || "";
  const datasetConfig = process.env.HF_DATASET_CONFIG || "default";
  const datasetSplit = process.env.HF_DATASET_SPLIT || "train";
  const apiBase = process.env.HF_API_BASE || "https://datasets-server.huggingface.co";
  // 끝에 "/"를 붙여 등록하는 실수를 하면 api.js가 `${API_BASE_URL}/api/predict`처럼 붙일 때
  // "//api/predict"(슬래시 중복)가 되어 백엔드가 못 찾는 경로가 되어버린다. 미리 제거해둔다.
  const backendApiBaseUrl = (process.env.BACKEND_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

  const content = `// ============================================================
// env.js — scripts/generate-env.js가 빌드 시 자동 생성한 파일입니다. 직접 수정하지 마세요.
// (Render의 Build Command가 Environment 탭 값을 읽어 이 파일을 덮어씁니다)
// ============================================================
window.APP_CONFIG = {
  HF_DATASET_ID: ${JSON.stringify(datasetId)},
  HF_DATASET_CONFIG: ${JSON.stringify(datasetConfig)},
  HF_DATASET_SPLIT: ${JSON.stringify(datasetSplit)},
  HF_API_BASE: ${JSON.stringify(apiBase)},
  BACKEND_API_BASE_URL: ${JSON.stringify(backendApiBaseUrl)},
};
`;

  const outPath = path.join(FRONTEND_DIR, "js", "common", "env.js");
  fs.writeFileSync(outPath, content, "utf-8");
  console.log(
    `[generate-env.js] env.js 생성 완료 (HF_DATASET_ID=${datasetId ? "설정됨" : "⚠️ 미설정"}, BACKEND_API_BASE_URL=${backendApiBaseUrl})`
  );
}

function copyPictures() {
  const src = path.join(ROOT_DIR, "pictures");
  const dest = path.join(FRONTEND_DIR, "pictures");

  if (!fs.existsSync(src)) {
    console.warn("[generate-env.js] 저장소 루트에 pictures/ 폴더가 없어 복사를 건너뜁니다.");
    return;
  }

  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log("[generate-env.js] pictures/ → Frontend/pictures/ 복사 완료");
}

generateEnvFile();
copyPictures();
