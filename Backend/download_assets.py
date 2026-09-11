import os
from pathlib import Path
import requests

ASSETS_DIR = Path(__file__).parent / "assets"
HF_BASE_URL = "https://huggingface.co/datasets/joojoojo/construction-safety-embeddings/resolve/main"
LARGE_ASSET_FILES = ["db_v_con.npy", "db_v_fac.npy", "db_v_wrk.npy"]

def ensure_large_assets():
    ASSETS_DIR.mkdir(exist_ok=True)
    for fname in LARGE_ASSET_FILES:
        local_path = ASSETS_DIR / fname
        if local_path.exists():
            print(f"[download_assets.py] {fname} 이미 존재 (다운로드 생략)")
            continue
        print(f"[download_assets.py] {fname} 다운로드 중...")
        url = f"{HF_BASE_URL}/{fname}"
        r = requests.get(url, stream=True, timeout=300)
        r.raise_for_status()
        with open(local_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                f.write(chunk)
        print(f"[download_assets.py] {fname} 다운로드 완료")

if __name__ == "__main__":
    ensure_large_assets()
