# 건설현장 위험 판단 모델 패키지

사진 한 장을 넣으면 **무엇이 찍혔는지**(YOLO)와 **그래서 위험한지**(룰)를 JSON으로 돌려줍니다.
학습 run: `all_v1` / 클래스 73개 / 내보낸 날짜 20260906

```
model/best.pt        학습된 가중치 (이것만 있으면 됨)
model/best.onnx      onnxruntime용 (선택)
model/classes.json   클래스 ID -> 이름, 기본 imgsz/conf
model/rules.json     위험 판정 룰. 코드 수정 없이 이 파일만 고치면 됨
model/metrics.json   클래스별 성능 + 인스턴스 수. 미학습/표본부족 목록
hazard.py            추론 + 판정 모듈
server.py            FastAPI 서버
test_local.py        서버 없이 한 장 테스트
sample/              샘플 입력과 그때 나온 응답
```

## 1. 실행

```bash
pip install -r requirements.txt
python test_local.py                      # 먼저 이걸로 동작 확인
uvicorn server:app --host 0.0.0.0 --port 8000
```

`test_local.py` 출력이 `sample/sample_output.json`과 비슷하면 정상입니다.

GPU가 없어도 돌아갑니다. 다만 CPU는 한 장에 2~5초, GPU는 0.1초 수준이라
사용자가 기다리는 UI라면 GPU 서버를 쓰거나 로딩 표시를 넣으세요.

## 2. API

### `POST /analyze`

multipart/form-data, 필드명 `file`.

| 쿼리 | 기본 | 설명 |
|---|---|---|
| `conf` | 0.35 | 낮추면 더 많이 잡는다. 놓치는 게 많으면 0.25 |
| `draw` | false | 박스 그린 이미지를 base64로 함께 반환 |

```js
const fd = new FormData();
fd.append("file", photoBlob);
const res = await fetch("http://localhost:8000/analyze?draw=true", {
  method: "POST", body: fd,
});
const data = await res.json();
```

응답:

```json
{
  "verdict": "위험",
  "risks": [
    { "level": "위험", "message": "용접 작업 중 소화기 미배치", "ref": "N-33" }
  ],
  "objects": [
    { "cid": "SO-24", "name": "SO-24_용접기", "conf": 0.91,
       "box": [812.4, 430.1, 1043.7, 655.2] }
  ],
  "image_size": [1920, 1080],
  "elapsed_ms": 118
}
```

- `verdict` — `위험` / `주의` / `정상` 셋 중 하나. 배지 색만 이걸로 정하면 됩니다.
- `risks[].level` — `위험` 또는 `주의`
- `risks[].ref` — 근거 시나리오 코드
- `objects[].box` — **원본 이미지 픽셀 좌표** `[x1, y1, x2, y2]`.
  화면에 겹쳐 그릴 땐 `image_size` 기준으로 스케일하세요.
- `draw=true`면 `image_b64`(JPEG base64)가 추가됩니다.
  `<img src={"data:image/jpeg;base64," + data.image_b64} />`

### `GET /health`, `GET /classes`

서버 상태 확인용, 클래스 ID-이름 전체 목록.

## 3. 프런트에서 챙길 것

**사진 회전** — 서버가 EXIF로 보정하지만, 프런트에서 canvas로 리사이즈해 보낼 때는
회전 정보가 날아갑니다. 원본 파일을 그대로 올리는 게 안전합니다.

**해상도** — 960px로 학습했습니다. 프런트에서 너무 줄여 보내면 소화기·쐐기목 같은
작은 물체를 놓칩니다. 긴 변 1280px 이상으로 보내세요.

**판정은 서버 몫** — `risks`를 프런트에서 다시 계산하지 마세요.
룰이 바뀌면 `model/rules.json`만 고쳐 서버를 재시작하면 끝입니다.

## 4. 한계 (사용자에게 안내할 내용)

전체 mAP50 **0.907**, mAP50-95 **0.804**.

**아래 11개는 학습 데이터에 한 장도 없어 절대 검출되지 않습니다.**
`classes.json`에 이름은 있지만 안 잡히는 게 정상입니다. 기다리지 마세요.

- WO-16_항타기
- WO-17_롤러
- WO-18_타워크레인
- WO-22_화물트럭
- SO-27_롤러브러쉬
- SO-35_PE안전펜스
- SO-43_방독면
- SO-44_가스경보기
- SO-46_위험테이프
- SO-47_벤딩형_가림막펜스
- DO-06_방수페인트

**아래는 표본이 300개 미만이라 자주 놓칩니다.**

- SO-31_시멘트포대 (21개)
- SO-42_유도봉 (59개)
- SO-26_공구박스 (96개)
- SO-41_라바콘 (162개)

**아래는 mAP50이 0.5 미만입니다.** 이 클래스에만 걸리는 판정은
UI에서 약하게 표시하는 게 좋습니다.

- SO-02_안전난간_설치_단부
- SO-06_해치_열린_개폐형_작업발판
- SO-18_낙하물방지망_설치미흡
- SO-31_시멘트포대

학습 데이터가 36개 현장에서 **연출된** 장면이라, 실제 폰 사진과 구도·거리 분포가
다릅니다. 검증 성능이 좋아도 현장 사진에서는 떨어질 수 있습니다.
**"안전하다"고 단정하지 말고 "탐지된 위험 요소"만 보여주세요.**
못 잡은 위험이 있을 수 있다는 문구를 UI에 넣는 걸 권합니다.

`draw=true`로 그린 이미지의 한글 라벨은 ultralytics가 첫 실행 때 폰트를 내려받습니다.
서버가 외부 네트워크를 못 쓰면 라벨이 깨지니, 그 경우 `draw`를 쓰지 말고
`objects` 좌표로 프런트에서 직접 그리세요.
