# -*- coding: utf-8 -*-
"""건설현장 위험 판단 - 추론 + 룰 판정.

    from hazard import Hazard
    hz = Hazard()
    print(hz.analyze("photo.jpg"))

YOLO는 "무엇이 있는지"까지만 하고, "그래서 위험한지"는 rules.json이 판단한다.
"""
from __future__ import annotations

import base64
import json
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODEL_DIR = HERE / "model"


class Hazard:
    def __init__(self, weights=None, conf=None, imgsz=None, device=None):
        from ultralytics import YOLO

        cfg = json.loads((MODEL_DIR / "classes.json").read_text(encoding="utf-8"))
        rules = json.loads((MODEL_DIR / "rules.json").read_text(encoding="utf-8"))

        self.names = {int(k): v for k, v in cfg["names"].items()}
        self.imgsz = imgsz or cfg["imgsz"]
        self.conf = cfg["conf_default"] if conf is None else conf
        self.device = device  # None이면 GPU 있으면 GPU, 없으면 CPU

        self.danger = rules["danger_objects"]
        self.combo = rules["combo_rules"]
        self.cooccur = rules["cooccur_rules"]

        self.model = YOLO(str(weights or MODEL_DIR / "best.pt"))

    @staticmethod
    def cid_of(name):
        return name.split("_")[0]          # 'SO-24_용접기' -> 'SO-24'

    def label_of(self, cid):
        for v in self.names.values():
            if v.startswith(cid + "_"):
                return v
        return cid

    def judge(self, cids):
        """검출된 클래스 ID 집합 -> 위험 목록. 모델 없이 단독 테스트 가능."""
        risks = []
        for r in self.danger:                          # 존재만으로 위험
            if r["cid"] in cids:
                risks.append({"level": "위험", "message": r["msg"], "ref": r["ref"]})
        for r in self.combo:                           # 있어야 할 게 없으면 위험
            if any(c in cids for c in r["need"]) and not any(c in cids for c in r["absent"]):
                risks.append({"level": "위험", "message": r["msg"], "ref": r["ref"]})
        for r in self.cooccur:                         # 같이 있으면 위험
            if any(c in cids for c in r["a"]) and any(c in cids for c in r["b"]):
                risks.append({"level": r.get("level", "위험"),
                              "message": r["msg"], "ref": r["ref"]})
        return risks

    def analyze(self, image, conf=None, draw=False):
        """image: 파일 경로 / PIL.Image / numpy 배열 모두 받는다."""
        t0 = time.perf_counter()
        r = self.model.predict(
            image,
            imgsz=self.imgsz,
            conf=self.conf if conf is None else conf,
            device=self.device,
            verbose=False,
        )[0]

        objects = []
        for b in r.boxes:
            full = self.names[int(b.cls)]
            objects.append({
                "cid": self.cid_of(full),
                "name": full,
                "conf": round(float(b.conf), 3),
                "box": [round(float(v), 1) for v in b.xyxy[0].tolist()],   # x1,y1,x2,y2 픽셀
            })
        objects.sort(key=lambda o: -o["conf"])

        risks = self.judge({o["cid"] for o in objects})
        if any(x["level"] == "위험" for x in risks):
            verdict = "위험"
        elif risks:
            verdict = "주의"
        else:
            verdict = "정상"

        out = {
            "verdict": verdict,
            "risks": risks,
            "objects": objects,
            "image_size": [r.orig_shape[1], r.orig_shape[0]],   # w, h
            "elapsed_ms": round((time.perf_counter() - t0) * 1000),
        }

        if draw:
            import cv2
            ok, buf = cv2.imencode(".jpg", r.plot())
            if ok:
                out["image_b64"] = base64.b64encode(buf.tobytes()).decode()
        return out
