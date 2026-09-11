# -*- coding: utf-8 -*-
"""사진 한 장 -> 위험 판정 JSON.

    uvicorn server:app --host 0.0.0.0 --port 8000

프런트가 무엇이든(React/Next/Vue/순수 JS) REST로 붙이면 된다.
"""
import io

from fastapi import FastAPI, File, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps

from hazard import Hazard

app = FastAPI(title="건설현장 위험 판단 API")

# 배포할 땐 allow_origins를 실제 도메인으로 좁힐 것
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

hz = Hazard()   # 서버 뜰 때 한 번만 로드. 요청마다 새로 만들면 안 된다

# 첫 요청만 3초씩 걸리는 걸(CUDA 초기화 + 커널 컴파일) 막으려고 미리 한 번 돌린다
try:
    import numpy as np

    hz.analyze(np.zeros((hz.imgsz, hz.imgsz, 3), dtype=np.uint8))
    print("[warmup] ok")
except Exception as e:
    print("[warmup] skipped:", e)


@app.get("/health")
def health():
    return {"ok": True, "classes": len(hz.names), "imgsz": hz.imgsz, "conf": hz.conf}


@app.get("/classes")
def classes():
    return hz.names


@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...),
    conf: float = Query(None, ge=0.05, le=0.95, description="낮추면 더 많이 잡는다"),
    draw: bool = Query(False, description="박스 그린 이미지를 base64로 같이 반환"),
):
    raw = await file.read()
    img = Image.open(io.BytesIO(raw))
    img = ImageOps.exif_transpose(img)   # 폰 사진은 EXIF로 회전돼 있다. 빼면 안 된다
    return hz.analyze(img.convert("RGB"), conf=conf, draw=draw)
