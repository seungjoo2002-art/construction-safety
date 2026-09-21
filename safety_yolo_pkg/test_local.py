# -*- coding: utf-8 -*-
"""서버 없이 바로 확인:  python test_local.py [사진경로]"""
import json
import sys
from pathlib import Path

from hazard import Hazard

img = sys.argv[1] if len(sys.argv) > 1 else str(Path(__file__).parent / "sample" / "sample_input.jpg")
print(json.dumps(Hazard().analyze(img), ensure_ascii=False, indent=2))
