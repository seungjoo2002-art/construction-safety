import os
from pathlib import Path
import requests

ASSETS_DIR = Path(__file__).parent / "assets"
HF_BASE_URL = "https://huggingface.co/datasets/joojoojo/construction-safety-embeddings/resolve/main"
LARGE_ASSET_FILES = ["db_v_con.npy", "db_v_fac.npy", "db_v_wrk.npy"]

# 비공개(gated) HF 데이터셋으로 바꾸는 경우에만 필요. 토큰은 절대 코드에 하드코딩하지
# 않고 환경변수로만 받는다 (Render: 대시보드 Environment 탭에 HF_TOKEN 등록).
HF_TOKEN = os.environ.get("HF_TOKEN", "")


def ensure_large_assets():
    """db_v_con/fac/wrk.npy(각 137MB, 총 411MB)를 필요할 때 1번만 스트리밍 다운로드.
    파일 전체를 메모리에 올리지 않고 청크 단위로 디스크에 바로 쓴다."""
    ASSETS_DIR.mkdir(exist_ok=True)
    headers = {"Authorization": f"Bearer {HF_TOKEN}"} if HF_TOKEN else {}
    for fname in LARGE_ASSET_FILES:
        local_path = ASSETS_DIR / fname
        if local_path.exists():
            print(f"[download_assets.py] {fname} 이미 존재 (다운로드 생략)")
            continue
        print(f"[download_assets.py] {fname} 다운로드 중...")
        url = f"{HF_BASE_URL}/{fname}"
        tmp_path = local_path.with_suffix(".tmp")
        with requests.get(url, stream=True, timeout=300, headers=headers) as r:
            r.raise_for_status()
            with open(tmp_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=1024 * 1024):
                    f.write(chunk)
        os.replace(tmp_path, local_path)  # 원자적 교체 — 다운로드 도중 죽어도 반쪽 파일이 남지 않음
        print(f"[download_assets.py] {fname} 다운로드 완료")

if __name__ == "__main__":
    ensure_large_assets()
