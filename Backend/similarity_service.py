import os
import io
import gc
import base64
from typing import Optional
import numpy as np
import pandas as pd
from openai import OpenAI
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.manifold import MDS
from scipy.spatial import ConvexHull

# ── FastAPI(uvicorn)는 요청마다 워커 스레드에서 처리하는데, matplotlib 기본 백엔드(TkAgg 등)는
#    메인 스레드가 아닌 곳에서 GUI를 만들면 "Tcl_AsyncDelete: async handler deleted by the
#    wrong thread" 같은 치명적 오류로 서버 프로세스 전체가 죽습니다. 화면 없이 이미지만
#    렌더링하는 비대화형(Agg) 백엔드로 고정해야 서버에서 안전하게 동작합니다.
#    pyplot을 import하기 전에 반드시 지정해야 합니다.
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns

# 폰트 설정 — 기본 sans-serif(DejaVu Sans)는 한글 글리프가 없어 제목/축/범례의
# 한글이 전부 깨져서(네모 상자 또는 빈칸) 렌더링됩니다. 한글 지원 폰트를 우선순위로 지정합니다.
plt.rcParams['font.family'] = 'sans-serif'
plt.rcParams['font.sans-serif'] = ['Malgun Gothic', 'AppleGothic', 'NanumGothic', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

class SimilarityWebService:
    def __init__(self, openai_api_key: Optional[str] = None, base_path: str = None):
        if base_path is None:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            base_path = os.path.join(script_dir, "assets")

        self.base_path = base_path
        # openai_api_key가 없으면 텍스트 임베딩 없이 카테고리 완전/부분일치 기반
        # 근사 유사도로 analyze()가 동작합니다 (client=None → fallback 모드).
        self.client = OpenAI(api_key=openai_api_key) if openai_api_key else None

        # 1. 원천 DB 및 자산 로드
        self.df_db = pd.read_csv(os.path.join(self.base_path, 'df_db.csv'))
        
        sif_path = os.path.join(self.base_path, 'SIF_archive.xlsx')
        if os.path.exists(sif_path):
            self.df_sif = pd.read_excel(sif_path, sheet_name='아카이브(건설업)', skiprows=2)
            self.df_sif.columns = ['Unnamed_0', '연번', '공종', '작업명', '단위작업명', '재해종류', '재해개요', '기인물', '재해유발요인', '위험성 감소대책(예시)']
            self.df_sif = self.df_sif.dropna(subset=['위험성 감소대책(예시)']).reset_index(drop=True)
        else:
            self.df_sif = pd.DataFrame()

        # ⚠️ Render 무료 Web Service(512MB) 대응 — db_v_fac/con/wrk(각 137MB, 총 411MB)를
        # 여기서 mmap으로 열어 self.db_v_*로 인스턴스 생애주기 내내 들고 있지 않습니다.
        # 실측 결과, mmap_mode='r'이어도 cosine_similarity가 배열 전체를 훑으면 그 순간
        # RSS가 파일 크기만큼 그대로 올라가고(1개당 +131MB), self.db_v_*로 계속 들고
        # 있으면 요청 1번만으로 3개가 전부 상주해 719MB까지 치솟아 OOM이 났습니다
        # (predict_severity/predict_accident_type 모델 로드 후 기준). 그래서 경로만
        # 저장해두고, 실제 계산이 필요한 순간에 _channel_similarity()/_channel_rows()가
        # 채널 하나씩만 열었다가 즉시 해제합니다 — 결과값(코사인 유사도)은 완전히 동일하고
        # 메모리 수명만 바뀝니다. 같은 방식으로 재측정하면 피크가 약 297MB 선으로 줄어듭니다.
        self.db_v_fac_path = os.path.join(self.base_path, 'db_v_fac.npy')
        self.db_v_con_path = os.path.join(self.base_path, 'db_v_con.npy')
        self.db_v_wrk_path = os.path.join(self.base_path, 'db_v_wrk.npy')
        self.db_n_num_scaled = np.load(os.path.join(self.base_path, 'db_n_num_scaled.npy'))  # 1MB — 상주해도 무해

        self.df_db['정형화된_재해종류'] = self.df_db['인적사고'].apply(self._map_incident_to_sif)

        # SHAP 기반 가중치 정의
        self.W = {
            'FAC': 2.71, 'CON': 4.23, 'WRK': 3.85,
            'HUMID': 2.58, 'TEMP': 3.53, 'RAIN': 1.00, 'WIND': 2.27,
            'PROG': 1.78, 'WORKER': 3.30
        }
        self.total_w = sum(self.W.values())

        self.num_min = np.array([0.0,  -20.0, 0.0,   0.0,  0.0,   1.0])
        self.num_max = np.array([100.0, 40.0, 100.0, 30.0, 100.0, 500.0])

        self.gongjong_mapping = {
            '토공사': '토공사', '건축 토공사': '토공사', '말뚝공사': '토공사', '지반조사': '토공사', '지반개량공사': '토공사',
            '철근콘크리트공사': '철근콘크리트 공사', '프리캐스트 콘크리트공사': '철근콘크리트 공사',
            '철골공사': '철골공사', '강구조물공사': '철골공사',
            '마감공사': '마감공사', '창호 및 유리공사': '마감공사', '방수공사': '마감공사', '미장공사': '마감공사', '수장공사': '마감공사', 
            '타일 및 돌공사': '마감공사', '목공사': '마감공사', '조적공사': '마감공사', '지붕 및 홈통공사': '마감공사', '금속공사': '마감공사', '도장공사': '마감공사',
            '전기설비공사': '전기·기계 설비공사', '기계설비공사': '전기·기계 설비공사', '통신설비공사': '전기·기계 설비공사', '산업설비공사': '전기·기계 설비공사',
            '조경공사': '조경공사', '도로 및 포장공사': '도로 및 포장공사', '철도 및 궤도공사': '도로 및 포장공사',
            '교량공사': '교량공사', '터널공사': '터널공사', '하천공사': '하천 및 항만공사', '항만공사': '하천 및 항만공사', '댐 및 제방공사': '하천 및 항만공사',
            '관공사': '기타 토목공사', '관공사 부대공사': '기타 토목공사', '해체 및 철거공사': '철거 및 해체 공사'
        }

    def _map_incident_to_sif(self, val):
        if pd.isna(val): return "기타"
        val = str(val)
        if '떨어짐' in val: return '추락'
        elif '넘어짐' in val: return '전도'
        elif '물체에 맞음' in val: return '낙하'
        elif '부딪힘' in val: return '부딪힘'
        elif '끼임' in val: return '끼임'
        elif '깔림' in val: return '깔림'
        elif '절단' in val or '베임' in val: return '베임'
        elif '찔림' in val: return '찔림'
        return "기타"

    @staticmethod
    def _text_sim(a, b) -> float:
        """임베딩 없이 두 카테고리 텍스트의 근사 유사도(완전일치 1.0 / 부분포함 0.6 / 불일치 0.0)."""
        a = "" if a is None or (isinstance(a, float) and pd.isna(a)) else str(a).strip()
        b = "" if b is None or (isinstance(b, float) and pd.isna(b)) else str(b).strip()
        if not a or not b:
            return 0.0
        if a == b:
            return 1.0
        if a in b or b in a:
            return 0.6
        return 0.0

    def _pairwise_text_sim(self, values) -> np.ndarray:
        n = len(values)
        mat = np.zeros((n, n))
        for i in range(n):
            for j in range(n):
                mat[i, j] = 1.0 if i == j else self._text_sim(values[i], values[j])
        return mat

    @staticmethod
    def _channel_similarity(path, query_vec):
        """임베딩 파일 하나를 그때그때 열어 query와의 코사인 유사도 전체(22,325개)만
        뽑고 즉시 해제. 채널 하나당 순간적으로 최대 ~137MB가 RSS에 잡히지만(실측),
        함수가 끝나면 del+gc.collect()로 곧바로 반환되어 다음 채널로 누적되지
        않습니다(순차 처리 시 피크 ~297MB로 직접 측정 검증)."""
        arr = np.load(path, mmap_mode='r')
        try:
            return cosine_similarity([query_vec], arr)[0]
        finally:
            del arr
            gc.collect()

    @staticmethod
    def _channel_rows(path, idx):
        """임베딩 파일 하나를 열어 top-20 행만 실제 메모리로 복사하고 즉시 해제."""
        arr = np.load(path, mmap_mode='r')
        try:
            return np.array(arr[idx])
        finally:
            del arr
            gc.collect()

    def _text_channels_embedding(self, facility_text, construction_text, work_text):
        """OpenAI 임베딩 기반 채널 유사도 (client가 있을 때).
        db_v_fac/con/wrk는 self.db_v_*_path로만 경로를 들고 있고, 여기서 채널을
        하나씩 순서대로 열었다가 바로 해제합니다 — 3개를 동시에 self.*로 들고 있던
        기존 방식은 실측 700MB+까지 치솟아 512MB 컨테이너에서 OOM이 났습니다."""
        res = self.client.embeddings.create(
            input=[facility_text, construction_text, work_text],
            model="text-embedding-3-small"
        )
        u_v_fac = np.array(res.data[0].embedding)
        u_v_con = np.array(res.data[1].embedding)
        u_v_wrk = np.array(res.data[2].embedding)

        sim_fac = self._channel_similarity(self.db_v_fac_path, u_v_fac)
        sim_con = self._channel_similarity(self.db_v_con_path, u_v_con)
        sim_wrk = self._channel_similarity(self.db_v_wrk_path, u_v_wrk)

        def build_pairwise(top_20_idx):
            fac_21 = np.vstack([[u_v_fac], self._channel_rows(self.db_v_fac_path, top_20_idx)])
            con_21 = np.vstack([[u_v_con], self._channel_rows(self.db_v_con_path, top_20_idx)])
            wrk_21 = np.vstack([[u_v_wrk], self._channel_rows(self.db_v_wrk_path, top_20_idx)])
            return cosine_similarity(fac_21), cosine_similarity(con_21), cosine_similarity(wrk_21)

        return sim_fac, sim_con, sim_wrk, build_pairwise

    def _text_channels_fallback(self, facility_text, construction_text, work_text):
        """OpenAI 키가 없을 때: 카테고리 텍스트 완전/부분일치로 근사한 채널 유사도.
        db 쪽은 원본 df_db.csv의 카테고리 컬럼을 그대로 씁니다(임베딩 벡터 불필요)."""
        fac_col = self.df_db['시설물 종류 - 중분류'].fillna(self.df_db.get('시설물 종류 - 대분류', ''))
        con_col = self.df_db['공종 - 중분류']
        wrk_col = self.df_db['추출된_작업종류']

        sim_fac = fac_col.apply(lambda v: self._text_sim(facility_text, v)).values
        sim_con = con_col.apply(lambda v: self._text_sim(construction_text, v)).values
        sim_wrk = wrk_col.apply(lambda v: self._text_sim(work_text, v)).values

        def build_pairwise(top_20_idx):
            fac_vals = [facility_text] + [fac_col.iloc[i] for i in top_20_idx]
            con_vals = [construction_text] + [con_col.iloc[i] for i in top_20_idx]
            wrk_vals = [work_text] + [wrk_col.iloc[i] for i in top_20_idx]
            return (
                self._pairwise_text_sim(fac_vals),
                self._pairwise_text_sim(con_vals),
                self._pairwise_text_sim(wrk_vals),
            )

        return sim_fac, sim_con, sim_wrk, build_pairwise

    def _get_strict_guideline(self, db_row):
        if self.df_sif.empty:
            return "▶ 현장 안전 수칙 준수 및 개인 보호구 착용 철저"

        hazard = str(db_row['정형화된_재해종류']).strip()
        gongjong_db = str(db_row.get('공종 - 중분류', '')).strip()
        work_db = str(db_row.get('추출된_작업종류', '')).strip()

        df_res = self.df_sif[self.df_sif['재해종류'].str.strip() == hazard]
        target_sif_gongjong = self.gongjong_mapping.get(gongjong_db, '기타 건설공사')
        
        df_gongjong_filtered = df_res[df_res['공종'].str.replace(" ", "").str.contains(target_sif_gongjong.replace(" ", ""), na=False)]
        if not df_gongjong_filtered.empty:
            df_res = df_gongjong_filtered

        if '굴착' in work_db or '토공사' in work_db:
            df_w = df_res[df_res['작업명'].str.contains('굴착|흙막이|되메움|발파', na=False)]
            if not df_w.empty: df_res = df_w
        elif '콘크리트' in work_db or '타설' in work_db:
            df_w = df_res[df_res['작업명'].str.contains('콘크리트|거푸집|철근', na=False)]
            if not df_w.empty: df_res = df_w
        elif '해체' in work_db or '철거' in work_db:
            df_w = df_res[df_res['공종'].str.contains('철거|해체', na=False) | df_res['작업명'].str.contains('철거|해체공사', na=False)]
            if not df_w.empty: df_res = df_w

        if not df_res.empty:
            for txt in df_res['위험성 감소대책(예시)'].dropna():
                clean_txt = str(txt).replace(" ", "")
                if "원인미상" not in clean_txt and clean_txt != "":
                    return str(txt)

        generic_defaults = {
            '추락': '▶ 추락위험 구역 안전난간 및 개구부 덮개 밀착 설치, 근로자 안전대 상시 체결 체계 감독',
            '전도': '▶ 자재 정리정돈 및 통로 유효 너비 확보, 바닥면 물기 및 기름 소거를 통한 미끄러짐 차단',
            '낙하': '▶ 상하 동시 작업 원천 금지 및 하부 출입통제선 구성, 낙하물 방지망 정비 상태 정기 점검',
            '부딪힘': '▶ 차량계 건설기계 반경 내 근로자 진입 통제 및 사각지대 후방센서·카메라 작동 유무 확인',
            '끼임': '▶ 설비 회전부 및 가동 구역 안전 방호 덮개 고정, 수리·청소 시 전원 차단 및 LOTO 락아웃 실시'
        }
        return generic_defaults.get(hazard, "▶ 현장 안전 수칙 준수 및 개인 보호구 착용 철저")

    def _render_dynamic_mds_plot(self, coords, top_20_hazards, distance_matrix, facility_text, work_text):
        """
        요청 시마다 전달받은 사용자 데이터 기반으로 
        Elbow 기법 k 산출, Convex Hull, 점선 연결 그래프를 실시간으로 새로 생성
        """
        # 1. 데이터프레임 구성
        df_plot = pd.DataFrame({
            'X': coords[1:, 0],
            'Y': coords[1:, 1],
            '사고유형': top_20_hazards
        })

        # 2. Elbow Method 기반 동적 k 산출
        query_dists = distance_matrix[0, 1:]
        sorted_dists = np.sort(query_dists)
        dist_diffs = np.diff(sorted_dists)
        
        dynamic_k = np.argmax(dist_diffs) + 1 if len(dist_diffs) > 0 else 3
        dynamic_k = max(3, min(int(dynamic_k), 7))

        top_k_indices = np.argsort(query_dists)[:dynamic_k]
        top_k_coords = coords[top_k_indices + 1]

        # 3. 플롯 캔버스 생성
        fig, ax = plt.subplots(figsize=(11, 9), dpi=150)

        # A. 과거 유사 사고 20개 점 플로팅
        sns.scatterplot(
            data=df_plot, x='X', y='Y',
            hue='사고유형', style='사고유형',
            s=180, palette='Set2', alpha=0.9, edgecolor='w', linewidth=1.2, ax=ax
        )

        # B. 현재 입력 쿼리 점 (빨간 별)
        query_x, query_y = coords[0, 0], coords[0, 1]
        ax.scatter(
            query_x, query_y,
            color='red', marker='*', s=500, label='현재 입력 케이스 (Query)',
            edgecolors='black', linewidth=1.5, zorder=10
        )

        # C. 쿼리 점과 Top-k 간 점선 연결
        for idx in top_k_indices:
            target_x, target_y = coords[idx + 1, 0], coords[idx + 1, 1]
            similarity_weight = 1.0 - query_dists[idx]
            ax.plot(
                [query_x, target_x], [query_y, target_y],
                color='red', linestyle='--',
                linewidth=1.2 + (similarity_weight * 1.5),
                alpha=0.4 + (similarity_weight * 0.4),
                zorder=5
            )

        # D. Convex Hull 다각형 영역 표시
        if len(top_k_coords) >= 3:
            hull = ConvexHull(top_k_coords)
            hull_path = np.append(hull.vertices, hull.vertices[0])
            ax.fill(
                top_k_coords[hull_path, 0], top_k_coords[hull_path, 1],
                color='red', alpha=0.12, label=f'최상위 유사 군집 (Top-{dynamic_k})'
            )
            ax.plot(
                top_k_coords[hull_path, 0], top_k_coords[hull_path, 1],
                color='red', linestyle=':', linewidth=1.5, alpha=0.6
            )

        # 타이틀 및 데코레이션 (실시간 사용자 입력값 매핑)
        ax.set_title(
            f"MDS 기반 유사 사고 공간 분포도\n"
            f"입력 시설물: {facility_text} | 입력 작업: {work_text}",
            fontsize=14, pad=20
        )
        ax.set_xlabel("가상 축 1 (Component 1)", fontsize=11, labelpad=10)
        ax.set_ylabel("가상 축 2 (Component 2)", fontsize=11, labelpad=10)
        ax.legend(bbox_to_anchor=(1.03, 1), loc='upper left', title="범례 항목", title_fontsize='11', fontsize='10')
        ax.grid(True, linestyle=':', alpha=0.5)
        plt.tight_layout()

        # 메모리 상에서 PNG 바이트 스트림 생성 후 Base64 변환
        buf = io.BytesIO()
        plt.savefig(buf, format='png', bbox_inches='tight')
        plt.close(fig)
        buf.seek(0)
        
        return base64.b64encode(buf.getvalue()).decode('utf-8')

    def analyze(self, raw_user_input: dict) -> dict:
        facility_text = str(raw_user_input.get('facility_text', '미지정'))
        construction_text = str(raw_user_input.get('construction_text', '미지정'))
        work_text = str(raw_user_input.get('work_text', '미지정'))

        # 1. 텍스트 채널 유사도 — OpenAI 키가 있으면 임베딩, 없거나 호출이 실패하면(크레딧 소진,
        #    429, 네트워크 오류 등) 카테고리 완전/부분일치 근사로 자동 대체합니다. 키가 "있는데
        #    호출이 실패하는" 경우를 안 잡으면 /api/analyze 전체가 500으로 죽어 화면에서
        #    산점도·유사사례가 통째로 사라집니다 — advisor.py가 겪은 것과 동일한 문제.
        used_embedding = False
        if self.client is not None:
            try:
                sim_fac, sim_con, sim_wrk, build_pairwise = self._text_channels_embedding(
                    facility_text, construction_text, work_text
                )
                used_embedding = True
            except Exception as e:
                print(f"[similarity_service.py] ⚠️ OpenAI 임베딩 호출 실패, 근사 유사도로 대체: {e}")

        if not used_embedding:
            sim_fac, sim_con, sim_wrk, build_pairwise = self._text_channels_fallback(
                facility_text, construction_text, work_text
            )

        # 2. 수치형 데이터 정규화
        raw_nums = np.array([
            float(raw_user_input.get('humidity', 50.0)),
            float(raw_user_input.get('temp', 20.0)),
            float(raw_user_input.get('rain', 0.0)),
            float(raw_user_input.get('wind', 2.0)),
            float(raw_user_input.get('progress', 50.0)),
            float(raw_user_input.get('worker_count', 30.0))
        ])
        u_n_num = np.clip((raw_nums - self.num_min) / (self.num_max - self.num_min), 0.0, 1.0)

        # 3. 채널별 유사도 및 가중 스코어 산출
        sim_humid  = 1.0 - np.abs(self.db_n_num_scaled[:, 0] - u_n_num[0])
        sim_temp   = 1.0 - np.abs(self.db_n_num_scaled[:, 1] - u_n_num[1])
        sim_rain   = 1.0 - np.abs(self.db_n_num_scaled[:, 2] - u_n_num[2])
        sim_wind   = 1.0 - np.abs(self.db_n_num_scaled[:, 3] - u_n_num[3])
        sim_prog   = 1.0 - np.abs(self.db_n_num_scaled[:, 4] - u_n_num[4])
        sim_worker = 1.0 - np.abs(self.db_n_num_scaled[:, 5] - u_n_num[5])

        scores = (
            (sim_fac * self.W['FAC']) + (sim_con * self.W['CON']) + (sim_wrk * self.W['WRK']) + 
            (sim_humid * self.W['HUMID']) + (sim_temp * self.W['TEMP']) + (sim_rain * self.W['RAIN']) + 
            (sim_wind * self.W['WIND']) + (sim_prog * self.W['PROG']) + (sim_worker * self.W['WORKER'])
        )

        top_20_idx = np.argsort(scores)[::-1][:20]

        # 4. Top-20 유사 사고 사례 수집 — 결과 화면 위젯은 상위 3건만 보여주지만,
        #    "전체 →" 클릭 시 유사도 순 전체 목록을 보여줄 수 있도록 20건 모두 반환합니다.
        cases_list = []
        for idx in top_20_idx:
            row = self.df_db.iloc[idx]
            sim_percent = int((scores[idx] / self.total_w) * 100)
            cases_list.append({
                "id": int(idx),  # app.py의 /api/cases/{id}와 같은 df_db.csv 행 인덱스 — 상세화면 링크용
                "title": str(row.get('사고명') or f"{row.get('정형화된_재해종류', '')} 사고"),
                "summary": str(row.get('사고경위', '개요 정보 없음')),
                "hazard_type": str(row.get('정형화된_재해종류', '기타')),
                "similarity_percent": sim_percent
            })

        # 5. 21x21 거리 행렬 구축
        mat_fac, mat_con, mat_wrk = build_pairwise(top_20_idx)
        num_21 = np.vstack([[u_n_num], self.db_n_num_scaled[top_20_idx]])

        mat_humid  = 1.0 - np.abs(num_21[:, 0][:, None] - num_21[:, 0])
        mat_temp   = 1.0 - np.abs(num_21[:, 1][:, None] - num_21[:, 1])
        mat_rain   = 1.0 - np.abs(num_21[:, 2][:, None] - num_21[:, 2])
        mat_wind   = 1.0 - np.abs(num_21[:, 3][:, None] - num_21[:, 3])
        mat_prog   = 1.0 - np.abs(num_21[:, 4][:, None] - num_21[:, 4])
        mat_worker = 1.0 - np.abs(num_21[:, 5][:, None] - num_21[:, 5])

        hybrid_matrix = (
            (mat_fac * self.W['FAC']) + (mat_con * self.W['CON']) + (mat_wrk * self.W['WRK']) + 
            (mat_humid * self.W['HUMID']) + (mat_temp * self.W['TEMP']) + (mat_rain * self.W['RAIN']) + 
            (mat_wind * self.W['WIND']) + (mat_prog * self.W['PROG']) + (mat_worker * self.W['WORKER'])
        )

        normalized_sim_matrix = hybrid_matrix / self.total_w
        distance_matrix = np.clip(1.0 - normalized_sim_matrix, 0, 1)
        np.fill_diagonal(distance_matrix, 0)

        # 6. MDS 공간 투영
        mds = MDS(n_components=2, dissimilarity='precomputed', random_state=42)
        coords = mds.fit_transform(distance_matrix)

        top_20_hazards = [str(self.df_db.iloc[idx]['정형화된_재해종류']) for idx in top_20_idx]

        # 7. 실시간 동적 차트 이미지 생성 (Base64)
        chart_base64 = self._render_dynamic_mds_plot(
            coords, top_20_hazards, distance_matrix, facility_text, work_text
        )

        # 8. SIF 예방 수칙 가이드라인 추출
        guidelines = []
        for idx in top_20_idx[:5]:
            guide = self._get_strict_guideline(self.df_db.iloc[idx])
            if guide and guide not in guidelines:
                guidelines.append(guide)

        return {
            "similar_cases": cases_list,
            "mds_chart_image": f"data:image/png;base64,{chart_base64}",
            "prevention_guidelines": guidelines,
            # 임베딩 호출을 못 했으면(키 미설정 또는 호출 실패) 텍스트 임베딩 대신 카테고리
            # 완전/부분일치로 근사한 결과 — 실제 DB 기반이지만 정밀도는 임베딩보다 낮음.
            "is_approximate": not used_embedding,
        }