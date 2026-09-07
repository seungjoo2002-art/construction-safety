@echo off
REM 이 컴퓨터는 python/uvicorn이 기본으로 Python 3.14를 가리키는데,
REM 이 프로젝트의 패키지(scikit-learn 등)는 Python 3.12에만 설치되어 있습니다.
REM 반드시 "py -3.12"로 실행해야 합니다.
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"
py -3.12 -m uvicorn app:app --reload --host 0.0.0.0 --port 8000
