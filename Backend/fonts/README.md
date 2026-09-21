# Backend/fonts — 산점도(Matplotlib) 한글 폰트

`similarity_service.py`가 만드는 "유사 사례 2D 투영 산점도"(PNG)의 한글 글자를 그리는 폰트입니다.

| 파일 | 설명 |
|---|---|
| `NanumGothic-Regular.ttf`, `NanumGothic-Bold.ttf` | 나눔고딕 (NHN Corp.) — [google/fonts](https://github.com/google/fonts/tree/main/ofl/nanumgothic) 저장소의 원본 그대로 |
| `OFL.txt` | SIL Open Font License 1.1 — 재배포 허용(폰트를 단독으로 판매하지 않고, 라이선스 문서를 함께 두는 조건) |

## 왜 동봉했나
Render(Linux) 기본 이미지에는 한글 폰트가 없습니다. Matplotlib 폰트 목록에 `Malgun Gothic`(Windows 전용),
`AppleGothic`(macOS 전용)만 있으면 서버에서는 `DejaVu Sans`로 떨어져 한글이 □□□로 깨집니다.
그래서 이 폴더의 TTF를 `font_manager.fontManager.addfont()`로 직접 등록하고 최우선으로 씁니다
(로컬 Windows와 Render가 같은 폰트로 그려지므로 결과도 같습니다).

## 다른 폰트로 바꾸려면
TTF(OFL 등 재배포 가능한 라이선스)를 이 폴더에 넣고 `similarity_service.py` 상단의 파일명 목록과
`font.sans-serif` 첫 항목(폰트 *패밀리 이름*)만 바꾸면 됩니다.
