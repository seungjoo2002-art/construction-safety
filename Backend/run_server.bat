@echo off
REM 이 컴퓨터는 python/uvicorn이 기본으로 Python 3.14를 가리키는데,
REM 이 프로젝트의 패키지(scikit-learn 등)는 Python 3.12에만 설치되어 있습니다.
REM 반드시 "py -3.12"로 실행해야 합니다.
set PYTHONIOENCODING=utf-8
REM 해결방안(안전 조치사항) 문장을 로컬 EXAONE-4.0-1.2B로 생성합니다 (Hugging Face 캐시 사용).
REM CPU에서는 요청 1건에 약 2분 걸립니다. Gemini로 되돌리려면 아래 줄을 지우거나 gemini로 바꾸세요.
set ADVISOR_LLM=exaone
set HF_HUB_DISABLE_SYMLINKS_WARNING=1
cd /d "%~dp0"
py -3.12 -m uvicorn app:app --reload --host 0.0.0.0 --port 8000
