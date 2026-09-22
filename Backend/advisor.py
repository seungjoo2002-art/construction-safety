# -*- coding: utf-8 -*-
"""
advisor.py — [해결방안] 예측 결과 → KOSHA 유사사례 검색 → Gemini 안전수칙 생성

원본 "사고 유형 예측 및 해결방안" 모듈(Backend/kosha_sif/ 참고)은 로컬 임베딩
모델(KURE-v1, 2.2GB)과 로컬 생성 LLM(EXAONE-4.0-1.2B, 2.4GB)을 썼지만, 둘 다
GPU 없는 Render 소형 Web Service엔 못 올립니다(그냥 로딩만으로 메모리 한도 초과,
생성도 CPU면 너무 느림). 그래서 이 모듈은:

  - 검색: OpenAI 임베딩으로 바꾸려 했으나 API 키에 크레딧이 없어(429) 대신
    **로컬 TF-IDF(문자 2~3gram)** 유사도를 씁니다. 외부 의존·비용이 전혀 없고,
    카테고리 필터(공종+작업+재해)가 이미 후보를 좁혀주므로 순위만 다듬는
    역할로는 충분합니다.
  - 생성: app.py의 /api/chat과 동일한 Gemini REST API를 재사용합니다
    (같은 GEMINI_API_KEY, 새 모델을 띄우지 않음).

예측 자체(위험도·사고유형)는 이 모듈이 하지 않습니다 — app.py가 이미 갖고 있는
severity_predictor/accident_type_predictor 결과를 그대로 받아서(advise()의
risk 인자) 검색·생성만 얹습니다.

주의: 예측이 답하지 않는 것 — "오늘 사고가 날 확률". 답하는 것 — "이 조건에서
사고가 발생한다면 얼마나 심각/어떤 유형일 것인가". relative_risk_percentile은
확률이 아니라 전체 사례 대비 백분위입니다. UI에 "위험 82%"처럼 쓰면 안 됩니다.
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import requests
from sklearn.feature_extraction.text import TfidfVectorizer

BASE = Path(__file__).parent
KOSHA_DIR = BASE / "kosha_sif"

sys.path.insert(0, str(KOSHA_DIR))
from build_sif import 공종_MAP, 작업종류_MAP, 재해종류_MAP  # noqa: E402

GEMINI_MODEL = "gemini-2.0-flash"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

# ── 생성 백엔드 선택 ────────────────────────────────────────────
#   ADVISOR_LLM=gemini (기본) : Gemini REST API. Render 소형 인스턴스에서도 동작.
#   ADVISOR_LLM=exaone        : 로컬 EXAONE-4.0-1.2B(Hugging Face 캐시). transformers/torch 필요.
#                               실패하면 GEMINI_API_KEY가 있을 때 Gemini로 폴백.
LLM_BACKEND = os.environ.get("ADVISOR_LLM", "gemini").strip().lower()
EXAONE_MODEL_ID = os.environ.get("EXAONE_MODEL_ID", "LGAI-EXAONE/EXAONE-4.0-1.2B")
EXAONE_MAX_NEW_TOKENS = int(os.environ.get("EXAONE_MAX_NEW_TOKENS", "640"))
_CACHE_MAX = 64  # 같은 입력을 다시 물으면 재생성하지 않는다 (CPU 생성은 1건에 ~2분)

_영문타입 = re.compile(r"\s*\([^)]*\)\s*$")
_공백 = re.compile(r"[\s·,()]+")
_숫자 = re.compile(r"\d+(?:\.\d+)?\s*(?:회|번|개|일|주|개월|시간|분|m|cm|mm|kg|톤|%|배|명|층)")

SYSTEM = """너는 건설현장 안전관리자를 돕는 assistant다.
[참고 사례]로 주어진 대책을 현장용 문장으로 옮겨 적는 것이 네 임무다.

규칙:
- 참고 사례에 없는 내용을 추가하지 마라. 숫자·횟수·치수를 새로 만들지 마라.
- 원인 분석이나 추측을 쓰지 마라.
- 참고 사례를 빠뜨리지 말고 전부 항목으로 만들어라.
- 원문 표현을 유지하고 어미만 "~하십시오"로 바꿔라.
- 같은 문장을 반복하지 마라. 표, 코드, 머리말을 쓰지 마라.
- 아래 예시와 똑같은 짜임으로 쓰고, 마지막 항목을 쓴 즉시 멈춰라.

── 예시 (형식만 참고. 내용은 절대 가져다 쓰지 마라) ──
■ 핵심 위험
철골공사 철골 작업 중 추락·압착 사고 발생 시 치명 위험 상위 12%입니다.

■ 안전 조치사항
1. 추락위험이 있는 장소에서 작업 시 작업발판 및 고소작업대를 사용하십시오. (사례 #770)
2. 철골구조물 승하강 시 안전대 부착설비나 안전블럭을 활용하십시오. (사례 #802)
──────────────────────────"""


def _injury_type_kr(predicted_type: str) -> str:
    """'추락·압착(Falls)' -> '추락·압착' (예측모형의 영문 표기 제거, 번역표 키와 맞춤)"""
    return _영문타입.sub("", predicted_type or "").strip()


def _키(대책: str) -> str:
    """중복 판정용 지문 — 공백·기호를 지우고 앞 35자만 본다."""
    return _공백.sub("", 대책)[:35]


def _겹침(a: str, b: str) -> float:
    """두 문장의 2글자 조각이 겹치는 비율 (0~1). 과도한 재작성 탐지용."""
    A = {a[i:i + 2] for i in range(len(a) - 1)}
    B = {b[i:i + 2] for i in range(len(b) - 1)}
    return len(A & B) / max(len(A), 1)


def _정리(t: str) -> str:
    """반복된 줄과 형식 군더더기를 잘라낸다."""
    줄, 본 = [], set()
    for line in t.splitlines():
        s = line.strip()
        if not s:
            줄.append("")
            continue
        if s in 본:
            continue
        본.add(s)
        줄.append(line.rstrip())
    t = "\n".join(줄)
    t = re.sub(r"^\s*[─—-]{3,}.*$", "", t, flags=re.M)
    t = re.sub(r"\n\s*(출력 완료\.?|이상입니다\.?|\(.*개수만큼\))\s*", "\n", t)
    return re.sub(r"\n{3,}", "\n\n", t).strip()


class SafetyAdvisor:
    """예측 결과 → KOSHA 유사사례 검색(TF-IDF) → Gemini 생성. 프로세스당 1개만 만들 것."""

    def __init__(self, gemini_api_key: str = "", llm_backend: Optional[str] = None):
        self.gemini_api_key = gemini_api_key
        self.llm_backend = (llm_backend or LLM_BACKEND).lower()

        self._exaone = None                    # (tokenizer, model) — 첫 사용 시 지연 로딩
        self._load_lock = threading.Lock()
        self._gen_lock = threading.Lock()      # 모델 1개를 여러 요청이 동시에 돌리지 않도록
        self._cache: Dict[str, str] = {}

        with open(KOSHA_DIR / "sif.jsonl", encoding="utf-8") as f:
            self.recs: List[Dict[str, Any]] = [json.loads(line) for line in f]

        self._공종 = np.array([r["공종"] for r in self.recs])
        self._작업 = np.array([r["작업명"] for r in self.recs])
        self._재해 = np.array([r["재해종류"] for r in self.recs])

        self._vectorizer = TfidfVectorizer(analyzer="char", ngram_range=(2, 3), min_df=1)
        self._matrix = self._vectorizer.fit_transform([r["검색문장"] for r in self.recs])

    # ── 후보 좁히기 ────────────────────────────────────────────
    def _candidates(self, 공종=None, 작업종류=None, 예측유형=None, 최소=10):
        """번역표로 후보를 좁힌다. 10건 미만이면 조건을 단계적으로 푼다."""
        t공, t작, t재 = (공종_MAP.get(공종), 작업종류_MAP.get(작업종류),
                        재해종류_MAP.get(예측유형))
        m공 = (self._공종 == t공) if t공 else None
        m작 = np.isin(self._작업, t작) if t작 else None
        m재 = np.isin(self._재해, t재) if t재 else None

        def 합(*ms):
            ms = [m for m in ms if m is not None]
            if not ms:
                return np.ones(len(self.recs), bool)
            out = ms[0].copy()
            for m in ms[1:]:
                out &= m
            return out

        for 이름, mask in [("공종+작업+재해", 합(m공, m작, m재)),
                          ("공종+재해", 합(m공, m재)),
                          ("공종+작업", 합(m공, m작)),
                          ("재해만", 합(m재)),
                          ("전체", 합())]:
            idx = np.flatnonzero(mask)
            if len(idx) >= 최소:
                return idx, 이름
        return np.arange(len(self.recs)), "전체"

    def retrieve(self, 공종, 작업종류, 예측유형, 상황, k=5, 풀=40):
        """후보 안에서 유사도 상위 대책 k개를 중복 없이 뽑는다."""
        후보, 단계 = self._candidates(공종, 작업종류, 예측유형)
        q = self._vectorizer.transform([상황])
        점수 = (self._matrix[후보] @ q.T).toarray().ravel()

        본, 결과 = set(), []
        for j in np.argsort(-점수)[:풀]:
            i, s = 후보[j], float(점수[j])
            for 대책 in self.recs[i]["대책"]:
                kk = _키(대책)
                if kk in 본:
                    continue
                본.add(kk)
                결과.append({"대책": 대책, "점수": round(s, 4), "출처": self.recs[i]})
                if len(결과) >= k:
                    return 결과, 단계, int(len(후보))
        return 결과, 단계, int(len(후보))

    # ── 생성 (EXAONE 로컬 / Gemini 폴백) ───────────────────────
    def load_exaone(self):
        """EXAONE 토크나이저·모델을 1회만 로드한다 (Hugging Face 캐시에서, 없으면 다운로드).
        CPU에서는 bf16(2.4GB)이 메모리상 가장 안전하다 — fp32는 4.8GB라 RAM 8GB급 PC에서 페이징이 난다."""
        with self._load_lock:
            if self._exaone is None:
                import torch
                from transformers import AutoModelForCausalLM, AutoTokenizer

                tok = AutoTokenizer.from_pretrained(EXAONE_MODEL_ID)
                model = AutoModelForCausalLM.from_pretrained(EXAONE_MODEL_ID, dtype=torch.bfloat16)
                model.eval()
                if torch.cuda.is_available():
                    model.to("cuda")
                self._exaone = (tok, model)
                print(f"[advisor.py] EXAONE 로드 완료: {EXAONE_MODEL_ID} "
                      f"({'cuda' if torch.cuda.is_available() else 'cpu'})")
        return self._exaone

    def _generate_exaone(self, user: str, min_new_tokens: int = 0, force_sample: bool = False) -> str:
        import torch

        tok, model = self.load_exaone()
        msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]
        enc = tok.apply_chat_template(msgs, add_generation_prompt=True,
                                      return_tensors="pt", return_dict=True).to(model.device)
        gen_kwargs = dict(
            max_new_tokens=EXAONE_MAX_NEW_TOKENS,
            # ⚠️ min_new_tokens 없이는 "■ 핵심 위험" 한 줄만 쓰고 EOS를 내버리는 조기 종료가
            #    실측으로 나왔다(항목 0/5) — 최소 토큰 수를 강제해 "■ 안전 조치사항" 목록까지
            #    쓸 여유를 준다. 0이면(호출자가 안 정하면) 제한을 걸지 않는다.
            min_new_tokens=min_new_tokens or None,
            repetition_penalty=1.12,       # 같은 줄 반복 억제
            no_repeat_ngram_size=18,
            pad_token_id=tok.eos_token_id,
        )
        if force_sample:
            # 그리디(do_sample=False)가 나쁜 경로로 일찍 멈췄을 때 재시도용 — 약간의 무작위성으로
            # 같은 조기종료를 반복하지 않게 한다(안전 정보라 기본은 여전히 그리디).
            gen_kwargs.update(do_sample=True, temperature=0.7, top_p=0.9)
        else:
            gen_kwargs["do_sample"] = False
        with self._gen_lock, torch.no_grad():
            out = model.generate(**enc, **gen_kwargs)
        return tok.decode(out[0][enc["input_ids"].shape[1]:], skip_special_tokens=True).strip()

    def generate_chat(self, system_prompt: str, turns: list, max_new_tokens: int = 400) -> str:
        """범용 대화 생성 (app.py의 /api/chat이 CHAT_LLM=exaone일 때 재사용).
        advise()의 _generate_exaone()과 달리 안전수칙 전용 SYSTEM이 아니라 호출자가 준
        system_prompt(페르소나 + 언어 지시)를 그대로 쓰고, 자유 대화 이력(turns)을 받는다.
        같은 self._exaone(모델 1개)과 self._gen_lock을 공유해 이중 로드를 피한다.

        turns: [{"role": "user"|"assistant", "content": str}, ...] (마지막이 이번 사용자 메시지)
        """
        import torch

        tok, model = self.load_exaone()
        msgs = [{"role": "system", "content": system_prompt}, *turns]
        enc = tok.apply_chat_template(msgs, add_generation_prompt=True,
                                      return_tensors="pt", return_dict=True).to(model.device)
        with self._gen_lock, torch.no_grad():
            out = model.generate(**enc, max_new_tokens=max_new_tokens,
                                 do_sample=True, temperature=0.6, top_p=0.9,  # 잡담형 대화 → 약간의 다양성 허용
                                 repetition_penalty=1.12,
                                 no_repeat_ngram_size=8,
                                 pad_token_id=tok.eos_token_id)
        return tok.decode(out[0][enc["input_ids"].shape[1]:], skip_special_tokens=True).strip()

    def _generate_gemini(self, user: str) -> str:
        res = requests.post(
            GEMINI_URL,
            params={"key": self.gemini_api_key},
            json={
                "contents": [{"role": "user", "parts": [{"text": user}]}],
                "systemInstruction": {"parts": [{"text": SYSTEM}]},
            },
            timeout=30,
        )
        res.raise_for_status()
        return res.json()["candidates"][0]["content"]["parts"][0]["text"]

    @staticmethod
    def _truncate_to_n_items(text: str, n: int) -> str:
        """번호 항목 n개까지만 남기고 그 뒤는 전부 버린다.
        ⚠️ 실측: EXAONE-4.0은 추론(思考) 겸용 모델이라, min_new_tokens로 조기종료를 막으면
        (1) 목록을 처음부터 다시 반복하거나 (2) 목록을 다 쓰고도 멈추지 않고
        "지침종료지침종료..." 같은 내부 추론 군더더기를 계속 이어붙이는 경우가 있었다.
        (1)은 n+1번째 "숫자." 항목이 나오는 시점에 끊고, (2)는 n번째 항목 뒤 첫 빈 줄에서
        끊는다 — 그 뒤에 오는 내용은 숫자로 시작하지 않는 군더더기이기 때문."""
        lines, out, count, last_item_done = text.splitlines(), [], 0, False
        for line in lines:
            if re.match(r"\s*\d+\.\s", line):
                count += 1
                if count > n:
                    break
                last_item_done = (count == n)
            elif last_item_done and line.strip() == "":
                break  # n번째 항목 뒤 첫 빈 줄 — 그 뒤는 버린다
            out.append(line)
        return "\n".join(out).strip()

    def _cache_put(self, key: str, text: str) -> None:
        if len(self._cache) >= _CACHE_MAX:
            self._cache.pop(next(iter(self._cache)))
        self._cache[key] = text

    def _format_advice_fallback(self, injury_top: str, top_percent: float, evidence: list) -> str:
        """LLM이 목록을 다 못 채웠을 때 쓰는 결정적 안전망 — 새 문장을 짓지 않고 원문
        대책 끝에 종결어미만 기계적으로 붙인다. 항상 노트북/advisor.py가 원래 보장하려던
        '■ 핵심 위험 / ■ 안전 조치사항 1. ~하십시오.' 형식 그대로 나오게 한다."""
        lines = [
            "■ 핵심 위험",
            f"{injury_top} 위험 발생 시 치명 위험 상위 {top_percent:.0f}%입니다.",
            "",
            "■ 안전 조치사항",
        ]
        for i, r in enumerate(evidence, 1):
            본 = r["대책"].strip().rstrip(". ()")
            if not 본.endswith(("하십시오", "하세요", "바랍니다", "주십시오")):
                본 = f"{본}하십시오"
            lines.append(f"{i}. {본}. (사례 #{r['출처']['id']})")
        return "\n".join(lines)

    def generate_ex(self, 현장: str, injury_top: str, top_percent: float,
                    evidence: list) -> Tuple[str, Optional[str], Optional[str]]:
        """(안전수칙 문장, 실제로 쓴 모델 'exaone'|'gemini'|'template'|None, 실패 사유|None)"""
        if not evidence:
            return "", None, "근거 사례가 없어 생성하지 않았습니다"
        사례 = "\n".join(f"{n}. {r['대책']}  [사례 #{r['출처']['id']}]"
                        for n, r in enumerate(evidence, 1))
        user = (f"[현장 조건]\n{현장}\n\n"
                f"[예측 결과]\n"
                f"사고 발생 시 예상 유형: {injury_top}\n"
                f"치명 위험도: 상위 {top_percent:.0f}%\n\n"
                f"[참고 사례]  — 아래 {len(evidence)}개를 전부 사용하라\n{사례}")

        if user in self._cache:
            return self._cache[user], self.llm_backend, None

        def 항목수(t: str) -> int:
            return len(re.findall(r"^\s*\d+\.\s*\S", t, re.M))

        errors = []
        order = ["exaone", "gemini"] if self.llm_backend == "exaone" else ["gemini"]
        for name in order:
            if name == "gemini" and not self.gemini_api_key:
                errors.append("gemini: GEMINI_API_KEY 미설정")
                continue
            try:
                if name == "exaone":
                    # 항목당 대략 40~50토큰 잡고, "핵심 위험" 한 줄만 쓰고 멈추지 않도록 최소치를 강제
                    min_tokens = min(EXAONE_MAX_NEW_TOKENS - 20, 60 + len(evidence) * 45)
                    raw = self._generate_exaone(user, min_new_tokens=min_tokens)
                    text = self._truncate_to_n_items(_정리(raw), len(evidence))
                    if 항목수(text) < len(evidence):
                        print(f"[advisor.py] ⚠️ EXAONE 1차 생성이 목록을 다 못 채워({항목수(text)}/{len(evidence)}) "
                              f"재시도합니다")
                        raw2 = self._generate_exaone(user, min_new_tokens=min_tokens, force_sample=True)
                        text2 = self._truncate_to_n_items(_정리(raw2), len(evidence))
                        if 항목수(text2) > 항목수(text):
                            text = text2
                else:
                    raw = self._generate_gemini(user)
                    text = self._truncate_to_n_items(_정리(raw), len(evidence))
            except Exception as e:
                print(f"[advisor.py] ⚠️ {name} 생성 실패: {e}")
                errors.append(f"{name}: {type(e).__name__}: {e}")
                continue

            # 목록을 (거의) 다 채웠을 때만 성공으로 본다 — 1개 정도 누락은 허용하되,
            # "핵심 위험" 한 줄만 쓰고 멈춘 경우(0개)는 절대 그대로 내보내지 않는다.
            if text and 항목수(text) >= max(1, len(evidence) - 1):
                self._cache_put(user, text)
                return text, name, None
            errors.append(f"{name}: 목록 {항목수(text)}/{len(evidence)}개만 생성됨" if text else f"{name}: 빈 응답")

        # 모든 백엔드가 실패했거나 목록을 못 채웠다 — 형식은 항상 보장하는 결정적 안전망으로 대체.
        # (LLM 재작성이 아니라 원문 그대로라 verify()가 항상 깨끗하게 통과한다.)
        print(f"[advisor.py] ⚠️ LLM 생성이 모두 불완전해 원문 대책을 그대로 정리한 문장으로 대체합니다 "
              f"({' | '.join(errors)})")
        fallback = self._format_advice_fallback(injury_top, top_percent, evidence)
        self._cache_put(user, fallback)
        return fallback, "template", None

    def generate(self, 현장: str, injury_top: str, top_percent: float, evidence: list) -> str:
        return self.generate_ex(현장, injury_top, top_percent, evidence)[0]

    # ── 검증 ──────────────────────────────────────────────────
    @staticmethod
    def verify(advice: str, evidence: list, top_percent: float) -> dict:
        """생성문에 원문·예측에 없는 수치나 출처가 끼었는지 기계적으로 확인."""
        허용 = {f"{top_percent:.0f}%"}
        for r in evidence:
            허용 |= set(_숫자.findall(r["대책"]))
        본문 = re.sub(r"사례\s*#\d+", "", advice)
        지어낸수치 = [t for t in _숫자.findall(본문) if t not in 허용]
        가짜출처 = set(re.findall(r"#(\d+)", advice)) - {str(r["출처"]["id"]) for r in evidence}

        항목 = re.findall(r"^\s*\d+\.\s*(.+)$", advice, re.M)
        과다재작성 = []
        for 줄 in 항목:
            본 = _공백.sub("", re.sub(r"[—\-]?\s*\[?사례\s*#\d+\]?", "", 줄))
            점수 = max((_겹침(본, _공백.sub("", r["대책"])) for r in evidence), default=0)
            if 점수 < 0.25:
                과다재작성.append({"겹침": round(점수, 2), "문장": 줄})

        return {"지어낸수치": 지어낸수치, "가짜출처": sorted(가짜출처),
                "사용대책": f"{len(항목)}/{len(evidence)}", "과다재작성": 과다재작성}

    # ── 전체 파이프라인 ───────────────────────────────────────
    def advise(self, risk: Dict[str, Any], 공종: str, 작업종류: str,
               상황: Optional[str] = None, k: int = 5) -> dict:
        """
        risk: {"injury_top": "추락·압착(Falls)", "relative_risk_percentile": 82.0, ...}
              app.py가 이미 계산한 severity/accident_type 예측 결과에서 뽑아 전달.
        """
        injury_top = _injury_type_kr(risk.get("injury_top", ""))
        top_percent = 100.0 - float(risk.get("relative_risk_percentile", 0.0))
        상황 = 상황 or f"{공종} {작업종류} 중 {injury_top} 위험"

        evidence, 단계, n후보 = self.retrieve(공종, 작업종류, injury_top, 상황, k=k)
        advice, llm_used, llm_error = self.generate_ex(
            f"{공종} / {작업종류} — {상황}", injury_top, top_percent, evidence)

        return {
            "evidence": evidence,
            "advice": advice,
            "llm": {"backend": self.llm_backend, "used": llm_used, "error": llm_error},
            "verification": self.verify(advice, evidence, top_percent) if advice else None,
            "retrieval": {"filter_stage": 단계, "candidates": n후보},
        }
