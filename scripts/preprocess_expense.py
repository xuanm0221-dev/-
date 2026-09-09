"""
비용 데이터 전처리 스크립트
CSV 파일을 읽어 공통 스키마로 변환하고 JSON으로 저장합니다.

판매매출 actual CSV는 scripts/pull_sales_from_snowflake.py가 Snowflake에서
미리 갱신해두는 것을 전제로 합니다. plan CSV는 수동으로 유지됩니다.
"""

import pandas as pd
import json
import os
from pathlib import Path
from typing import Dict, List, Any

# CSV 파일 경로 설정 (프로젝트/파일 폴더)
CSV_BASE_PATH = str(Path(__file__).parent.parent / "파일")
OUTPUT_DIR = Path(__file__).parent.parent / "data"
OUTPUT_DIR.mkdir(exist_ok=True)

# 분석 대상 사업부 (MLB, KIDS, DISCOVERY, 공통)
TARGET_BIZ_UNITS = ["MLB", "KIDS", "DISCOVERY", "공통"]

# 예산 중간점검 — "연간 실제 사용예상"(연간 전망치)으로 만드는 계획
# 예산을 고친 게 아니라, 지금 페이스로 연말까지 갔을 때 실제로 쓸 금액을 다시 취합한 값.
PLAN_ADJ_FILE = "2026년비용_plan_중간점검.csv"
PLAN_ADJ_YEAR = 2026
# 시트 컬럼명 후보 — 앞의 것부터 찾아 쓴다 (구 시트는 "조정후 예산" 헤더를 쓴다)
PLAN_ADJ_COLS = ["연간 실제 사용예상", "조정후 예산"]
PLAN_ADJ_TYPE = "plan_adj"


def parse_month_column(col: str, year: int = None) -> tuple[int, int] | None:
    """월 컬럼명(예: '1월', '2월', '24년1월', 'Jan-24', '2024-01') → (year, month)로 파싱"""
    try:
        import re
        col = (col or "").strip()

        # 형식 0: "1월", "2월", "12월" (연도는 파라미터로 전달받음)
        match = re.match(r'^(\d{1,2})월$', col)
        if match and year is not None:
            month = int(match.group(1))
            if 1 <= month <= 12:
                return (year, month)

        # 형식 1: "24년1월", "25년10월" (한글 형식)
        match = re.match(r'(\d{2})년(\d{1,2})월', col)
        if match:
            year_str, month_str = match.groups()
            year = 2000 + int(year_str)
            month = int(month_str)
            if 2000 <= year <= 2100 and 1 <= month <= 12:
                return (year, month)
        
        # 형식 2: 기존 형식들도 지원 (하위 호환성)
        parts = col.split("-")
        if len(parts) != 2:
            return None

        part1, part2 = parts

        month_map = {
            "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4,
            "May": 5, "Jun": 6, "Jul": 7, "Aug": 8,
            "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12,
        }
        
        # "Jan-24" (월-년도)
        if part1 in month_map:
            month = month_map[part1]
            year = 2000 + int(part2)
            return (year, month)
        
        # "24-Jan" (년도-월)
        if part2 in month_map:
            try:
                year = 2000 + int(part1)
                month = month_map[part2]
                return (year, month)
            except:
                pass
        
        # "2024-01" (년도-월)
        try:
            year = int(part1)
            month = int(part2)
            if 2000 <= year <= 2100 and 1 <= month <= 12:
                return (year, month)
        except:
            pass

        return None

    except Exception:
        return None


# 전역 변수로 연간 데이터 저장
_annual_data_list: list[pd.DataFrame] = []

def load_expense_data() -> pd.DataFrame:
    """비용 CSV 파일들을 읽어서 long-format으로 변환"""
    expense_files = [
        ("2024년비용_actual.csv", 2024, "actual"),
        ("2025년비용_actual.csv", 2025, "actual"),
        ("2026년비용_plan.csv", 2026, "plan"),
        ("2026년비용_actual.csv", 2026, "actual"),
    ]

    all_data: list[pd.DataFrame] = []

    for filename, default_year, year_type in expense_files:
        filepath = os.path.join(CSV_BASE_PATH, filename)
        if not os.path.exists(filepath):
            print(f"경고: {filepath} 파일을 찾을 수 없습니다.")
            continue

        df = pd.read_csv(filepath, encoding="utf-8-sig")
        
        # 디버깅: 실제 컬럼명 출력
        print(f"   - {filename} 원본 컬럼명: {list(df.columns)[:15]}...")
        
        # "사업부구분 대분류"가 하나의 컬럼으로 합쳐져 있을 수 있음
        # 컬럼명 정리: 공백으로 분리된 경우 처리
        actual_id_cols = []
        for col in df.columns:
            if "사업부" in col or "대분류" in col or "중분류" in col or "소분류" in col:
                actual_id_cols.append(col)
        
        # 표준 컬럼명 확인
        id_cols = []
        if "사업부구분" in df.columns:
            id_cols.append("사업부구분")
        elif any("사업부" in col for col in df.columns):
            # "사업부구분 대분류" 같은 경우 분리 필요
            for col in df.columns:
                if "사업부" in col:
                    # 첫 번째 컬럼이 "사업부구분 대분류"인 경우, 실제로는 두 컬럼일 수 있음
                    # 일단 그대로 사용
                    id_cols.append(col)
                    break
        
        if "대분류" in df.columns:
            id_cols.append("대분류")
        if "중분류" in df.columns:
            id_cols.append("중분류")
        if "소분류" in df.columns:
            id_cols.append("소분류")

        # 중국어 컬럼 (있으면 melt 시 보존)
        id_cols_cn = []
        for cn_col in ["사업부구분(중국어)", "대분류(중국어)", "중분류(중국어)", "소분류(중국어)"]:
            if cn_col in df.columns:
                id_cols_cn.append(cn_col)
        id_cols_full = id_cols + id_cols_cn

        # id_cols가 비어있으면 기본값 사용
        if not id_cols:
            id_cols = ["사업부구분", "대분류", "중분류", "소분류"]
            id_cols_full = id_cols + id_cols_cn

        print(f"   - {filename} ID 컬럼: {id_cols}")
        
        # 연간 컬럼과 월별 컬럼 분리
        month_cols = []
        annual_cols = []
        
        for col in df.columns:
            if col not in id_cols_full:
                # 연간 컬럼 체크 (예: "2024년 연간", "2025년 연간", "2024연간", "2025연간")
                if "연간" in col or "annual" in col.lower() or "yearly" in col.lower():
                    annual_cols.append(col)
                else:
                    month_cols.append(col)
        
        print(f"   - 월 컬럼 후보: {month_cols[:5]}...")  # 처음 5개만 출력
        print(f"   - 연간 컬럼: {annual_cols}")

        # Long format으로 변환 (월별 데이터)
        df_melted = df.melt(
            id_vars=id_cols_full,
            value_vars=month_cols,
            var_name="month_col",
            value_name="amount",
        )
        
        # 연간 데이터 처리
        annual_data = []
        if annual_cols:
            for col in annual_cols:
                # 연도 추출 (예: "2024년 연간" -> 2024, "2025연간" -> 2025)
                year_match = None
                for year in range(2020, 2030):
                    if str(year) in col:
                        year_match = year
                        break
                
                if year_match:
                    df_annual = df[id_cols_full + [col]].copy()
                    df_annual = df_annual.rename(columns={col: "annual_amount"})
                    df_annual["year"] = year_match
                    df_annual["year_type"] = year_type
                    annual_data.append(df_annual)
            
            if annual_data:
                df_annual_combined = pd.concat(annual_data, ignore_index=True)
                print(f"   - 연간 데이터: {len(df_annual_combined)} 행")

        # 연도/월 파싱
        parsed = df_melted["month_col"].apply(parse_month_column)

        # (year, month) 튜플만 남기기
        mask = parsed.apply(lambda x: isinstance(x, tuple) and len(x) == 2)

        # 잘못된 값 제거
        df_melted = df_melted[mask].copy()
        
        if len(df_melted) == 0:
            print(f"경고: {filename}에서 유효한 월 컬럼을 찾을 수 없습니다.")
            print(f"   - 파싱 시도한 컬럼 샘플: {df_melted['month_col'].unique()[:5] if 'month_col' in df_melted.columns else 'N/A'}")
            # 원본 month_cols에서 파싱 결과 확인
            sample_cols = month_cols[:5] if len(month_cols) > 0 else []
            print(f"   - 월 컬럼 샘플 파싱 결과:")
            for col in sample_cols:
                result = parse_month_column(col)
                print(f"     '{col}' -> {result}")
            continue

        # year, month 컬럼 분리
        parsed_filtered = parsed[mask].tolist()
        df_melted["year"] = [p[0] for p in parsed_filtered]
        df_melted["month"] = [p[1] for p in parsed_filtered]

        # yyyymm 생성
        df_melted["yyyymm"] = (
            df_melted["year"].astype(str)
            + df_melted["month"].astype(str).str.zfill(2)
        )
        
        # year_type 필드 추가
        df_melted["year_type"] = year_type

        # 컬럼명 변경 (실제 컬럼명에 맞게, 중국어 컬럼 제외)
        rename_map = {}
        for col in df_melted.columns:
            if "(중국어)" in col:
                continue
            if "사업부" in col and "구분" in col:
                rename_map[col] = "biz_unit"
            elif col == "대분류" or ("대분류" in col and "사업부" not in col):
                rename_map[col] = "cost_lv1"
            elif col == "중분류" or ("중분류" in col):
                rename_map[col] = "cost_lv2"
            elif col == "소분류" or ("소분류" in col):
                rename_map[col] = "cost_lv3"
        
        # 표준 컬럼명이 있으면 사용
        if "사업부구분" in df_melted.columns:
            rename_map["사업부구분"] = "biz_unit"
        if "대분류" in df_melted.columns:
            rename_map["대분류"] = "cost_lv1"
        if "중분류" in df_melted.columns:
            rename_map["중분류"] = "cost_lv2"
        if "소분류" in df_melted.columns:
            rename_map["소분류"] = "cost_lv3"
        if "사업부구분(중국어)" in df_melted.columns:
            rename_map["사업부구분(중국어)"] = "biz_unit_cn"
        if "대분류(중국어)" in df_melted.columns:
            rename_map["대분류(중국어)"] = "cost_lv1_cn"
        if "중분류(중국어)" in df_melted.columns:
            rename_map["중분류(중국어)"] = "cost_lv2_cn"
        if "소분류(중국어)" in df_melted.columns:
            rename_map["소분류(중국어)"] = "cost_lv3_cn"

        if rename_map:
            df_melted = df_melted.rename(columns=rename_map)
            print(f"   - 컬럼명 변경: {rename_map}")
        
        # 디버깅: 컬럼 존재 여부 확인
        print(f"   - 변경 후 컬럼: {list(df_melted.columns)}")
        if "cost_lv2" in df_melted.columns:
            lv2_sample = df_melted[df_melted["cost_lv2"].astype(str).str.strip() != ""].head(3)
            if len(lv2_sample) > 0:
                print(f"   - 중분류 샘플:")
                for idx, row in lv2_sample.iterrows():
                    print(f"     {row.get('biz_unit', 'N/A')} / {row.get('cost_lv1', 'N/A')} / {row.get('cost_lv2', 'N/A')}")
        
        # biz_unit 값 정리 (공백 제거, 대소문자 통일)
        if "biz_unit" in df_melted.columns:
            df_melted["biz_unit"] = df_melted["biz_unit"].astype(str).str.strip()
            print(f"   - biz_unit 고유값: {df_melted['biz_unit'].unique().tolist()[:10]}")

        # amount를 숫자로 변환 (NaN은 0으로)
        # 먼저 문자열에서 쉼표 제거 (천 단위 구분자)
        print(f"   - amount 원본 타입: {df_melted['amount'].dtype}")
        print(f"   - amount 샘플 (처음 5개): {df_melted['amount'].head(5).tolist()}")
        
        if df_melted["amount"].dtype == "object":
            # NaN을 문자열로 변환하기 전에 처리
            # 먼저 NaN 값을 처리
            df_melted["amount"] = df_melted["amount"].fillna("0")
            # 문자열로 변환
            df_melted["amount"] = df_melted["amount"].astype(str)
            # 'nan', 'NaN', 빈 문자열 등을 처리
            df_melted["amount"] = df_melted["amount"].replace(["nan", "NaN", "None", "", " "], "0")
            # 쉼표와 공백 제거 (regex=False로 정확한 문자열 매칭)
            df_melted["amount"] = df_melted["amount"].str.replace(",", "", regex=False)
            df_melted["amount"] = df_melted["amount"].str.replace(" ", "", regex=False)
            df_melted["amount"] = df_melted["amount"].str.strip()
        
        df_melted["amount"] = pd.to_numeric(
            df_melted["amount"], errors="coerce"
        ).fillna(0)
        
        print(f"   - amount 변환 후 샘플 (처음 5개): {df_melted['amount'].head(5).tolist()}")
        print(f"   - amount 통계: min={df_melted['amount'].min()}, max={df_melted['amount'].max()}, sum={df_melted['amount'].sum():.2f}")
        
        # 디버깅: 데이터 샘플 확인
        if len(df_melted) > 0:
            print(f"   - {filename} melt 후 데이터 수: {len(df_melted)}")
            print(f"   - amount 통계: min={df_melted['amount'].min()}, max={df_melted['amount'].max()}, mean={df_melted['amount'].mean():.2f}")
            sample_data = df_melted[df_melted["amount"] > 0].head(5)
            if len(sample_data) > 0:
                print(f"   - {filename} 데이터 샘플 (amount > 0):")
                for idx, row in sample_data.iterrows():
                    print(f"     {row['biz_unit']} / {row['cost_lv1']} / {row['year']}-{row['month']:02d} / amount={row['amount']}")
            else:
                print(f"   - 경고: {filename}에서 amount > 0인 데이터가 없습니다.")
                print(f"     원본 melt 데이터 샘플 (처음 10개):")
                for idx, row in df_melted.head(10).iterrows():
                    print(f"       month_col='{row['month_col']}', amount='{row['amount']}' (type: {type(row['amount'])})")

        # cost_lv2, cost_lv3가 없으면 빈 문자열로 채우기
        if "cost_lv2" not in df_melted.columns:
            df_melted["cost_lv2"] = ""
        else:
            df_melted["cost_lv2"] = df_melted["cost_lv2"].fillna("").astype(str).str.strip()
        
        if "cost_lv3" not in df_melted.columns:
            df_melted["cost_lv3"] = ""
        else:
            df_melted["cost_lv3"] = df_melted["cost_lv3"].fillna("").astype(str).str.strip()

        # 중국어 컬럼이 없으면 빈 문자열로
        for cn_key in ["biz_unit_cn", "cost_lv1_cn", "cost_lv2_cn", "cost_lv3_cn"]:
            if cn_key not in df_melted.columns:
                df_melted[cn_key] = ""
            else:
                df_melted[cn_key] = df_melted[cn_key].fillna("").astype(str).str.strip()

        # 디버깅: 복리후생비 > 5대보험/공적금 데이터 확인
        if default_year == 2024:
            welfare_5 = df_melted[(df_melted["cost_lv1"] == "복리후생비") & (df_melted["cost_lv2"] == "5대보험")]
            welfare_public = df_melted[(df_melted["cost_lv1"] == "복리후생비") & (df_melted["cost_lv2"] == "공적금")]
            print(f"   - 2024년 복리후생비 > 5대보험 행 수: {len(welfare_5)}")
            if len(welfare_5) > 0:
                print(f"     사업부구분: {sorted(welfare_5['biz_unit'].unique().tolist())}")
                for biz in ["KIDS", "DISCOVERY", "DUVETICA", "SUPRA"]:
                    biz_data = welfare_5[welfare_5["biz_unit"] == biz]
                    if len(biz_data) > 0:
                        print(f"     {biz}: {len(biz_data)}행, amount sum={biz_data['amount'].sum():.2f}")
            print(f"   - 2024년 복리후생비 > 공적금 행 수: {len(welfare_public)}")
            if len(welfare_public) > 0:
                print(f"     사업부구분: {sorted(welfare_public['biz_unit'].unique().tolist())}")
                for biz in ["KIDS", "DISCOVERY", "DUVETICA", "SUPRA"]:
                    biz_data = welfare_public[welfare_public["biz_unit"] == biz]
                    if len(biz_data) > 0:
                        print(f"     {biz}: {len(biz_data)}행, amount sum={biz_data['amount'].sum():.2f}")
        
        # 디버깅: 중분류 데이터 확인
        if len(df_melted) > 0:
            sample_with_lv2 = df_melted[df_melted["cost_lv2"].astype(str).str.strip() != ""].head(5)
            if len(sample_with_lv2) > 0:
                print(f"   - {filename} 중분류 샘플:")
                for idx, row in sample_with_lv2.iterrows():
                    print(f"     {row['biz_unit']} / {row['cost_lv1']} / {row['cost_lv2']} / amount={row['amount']}")
            else:
                print(f"   - 경고: {filename}에서 중분류 데이터가 없습니다.")
                print(f"     cost_lv2 컬럼 존재: {'cost_lv2' in df_melted.columns}")
                if 'cost_lv2' in df_melted.columns:
                    print(f"     cost_lv2 고유값 샘플: {df_melted['cost_lv2'].unique()[:10].tolist()}")
        
        # 필요한 컬럼만 선택 (중국어 포함)
        out_cols = [
            "year", "month", "yyyymm", "biz_unit", "cost_lv1", "cost_lv2", "cost_lv3",
            "amount", "year_type",
        ]
        for cn_key in ["biz_unit_cn", "cost_lv1_cn", "cost_lv2_cn", "cost_lv3_cn"]:
            if cn_key in df_melted.columns:
                out_cols.append(cn_key)
        df_melted = df_melted[out_cols]

        all_data.append(df_melted)
        
        # 연간 데이터 처리 및 저장 (별도로 관리)
        if annual_data:
            df_annual_combined = pd.concat(annual_data, ignore_index=True)
            
            # 컬럼명 변경 (중국어 컬럼 제외 - 별도 처리)
            rename_map = {}
            for col in df_annual_combined.columns:
                if "(중국어)" in col:
                    continue
                if "사업부" in col and "구분" in col:
                    rename_map[col] = "biz_unit"
                elif col == "대분류" or ("대분류" in col and "사업부" not in col):
                    rename_map[col] = "cost_lv1"
                elif col == "중분류" or ("중분류" in col):
                    rename_map[col] = "cost_lv2"
                elif col == "소분류" or ("소분류" in col):
                    rename_map[col] = "cost_lv3"
            
            if rename_map:
                df_annual_combined = df_annual_combined.rename(columns=rename_map)
            
            # 표준 컬럼명이 있으면 사용
            if "사업부구분" in df_annual_combined.columns:
                df_annual_combined = df_annual_combined.rename(columns={"사업부구분": "biz_unit"})
            if "대분류" in df_annual_combined.columns:
                df_annual_combined = df_annual_combined.rename(columns={"대분류": "cost_lv1"})
            if "중분류" in df_annual_combined.columns:
                df_annual_combined = df_annual_combined.rename(columns={"중분류": "cost_lv2"})
            if "소분류" in df_annual_combined.columns:
                df_annual_combined = df_annual_combined.rename(columns={"소분류": "cost_lv3"})
            if "사업부구분(중국어)" in df_annual_combined.columns:
                df_annual_combined = df_annual_combined.rename(columns={"사업부구분(중국어)": "biz_unit_cn"})
            if "대분류(중국어)" in df_annual_combined.columns:
                df_annual_combined = df_annual_combined.rename(columns={"대분류(중국어)": "cost_lv1_cn"})
            if "중분류(중국어)" in df_annual_combined.columns:
                df_annual_combined = df_annual_combined.rename(columns={"중분류(중국어)": "cost_lv2_cn"})
            if "소분류(중국어)" in df_annual_combined.columns:
                df_annual_combined = df_annual_combined.rename(columns={"소분류(중국어)": "cost_lv3_cn"})

            for cn_key in ["biz_unit_cn", "cost_lv1_cn", "cost_lv2_cn", "cost_lv3_cn"]:
                if cn_key not in df_annual_combined.columns:
                    df_annual_combined[cn_key] = ""
                else:
                    df_annual_combined[cn_key] = df_annual_combined[cn_key].fillna("").astype(str).str.strip()

            # biz_unit 값 정리
            if "biz_unit" in df_annual_combined.columns:
                df_annual_combined["biz_unit"] = df_annual_combined["biz_unit"].astype(str).str.strip()
            
            # cost_lv2, cost_lv3 처리
            if "cost_lv2" not in df_annual_combined.columns:
                df_annual_combined["cost_lv2"] = ""
            else:
                df_annual_combined["cost_lv2"] = df_annual_combined["cost_lv2"].fillna("").astype(str).str.strip()
            
            if "cost_lv3" not in df_annual_combined.columns:
                df_annual_combined["cost_lv3"] = ""
            else:
                df_annual_combined["cost_lv3"] = df_annual_combined["cost_lv3"].fillna("").astype(str).str.strip()
            
            # annual_amount를 숫자로 변환
            if "annual_amount" in df_annual_combined.columns:
                if df_annual_combined["annual_amount"].dtype == "object":
                    df_annual_combined["annual_amount"] = df_annual_combined["annual_amount"].fillna("0")
                    df_annual_combined["annual_amount"] = df_annual_combined["annual_amount"].astype(str)
                    df_annual_combined["annual_amount"] = df_annual_combined["annual_amount"].replace(["nan", "NaN", "None", "", " "], "0")
                    df_annual_combined["annual_amount"] = df_annual_combined["annual_amount"].str.replace(",", "", regex=False)
                    df_annual_combined["annual_amount"] = df_annual_combined["annual_amount"].str.replace(" ", "", regex=False)
                    df_annual_combined["annual_amount"] = df_annual_combined["annual_amount"].str.strip()
                
                df_annual_combined["annual_amount"] = pd.to_numeric(
                    df_annual_combined["annual_amount"], errors="coerce"
                ).fillna(0)
            
            # 연간 데이터를 전역 변수에 저장 (나중에 사용)
            _annual_data_list.append(df_annual_combined)

    if not all_data:
        raise ValueError("비용 데이터를 로드할 수 없습니다.")

    expense_df = pd.concat(all_data, ignore_index=True)
    expense_df = append_plan_adj(expense_df)
    return expense_df


def _clean_amount(series: pd.Series) -> pd.Series:
    """'1,234 ' 같은 문자열을 숫자로. 빈칸/문자는 0."""
    s = series.fillna("").astype(str)
    s = s.str.replace(",", "", regex=False).str.replace(" ", "", regex=False).str.strip()
    return pd.to_numeric(s, errors="coerce").fillna(0.0)


def append_plan_adj(expense_df: pd.DataFrame) -> pd.DataFrame:
    """예산 중간점검의 '연간 실제 사용예상'(연간 전망치)으로 plan_adj 계획을 만들어 덧붙인다.

    중간점검 CSV 에는 월 컬럼이 없고 연간 값만 있으므로 월 배분이 필요한데,
    분석을 연간 기준으로만 하므로 증감액은 전부 12월에 몰아 넣는다.
      - 1~11월 : 원계획(plan) 월별 금액 그대로
      - 12월   : 연간 실제 사용예상 − 원계획 1~11월 합
    이렇게 하면 연간 합계가 '연간 실제 사용예상' 과 정확히 일치한다.
    원계획에 없는 신규 항목은 12월에만 금액이 잡힌 행으로 새로 만든다.
    """
    filepath = os.path.join(CSV_BASE_PATH, PLAN_ADJ_FILE)
    if not os.path.exists(filepath):
        print(f"   - {PLAN_ADJ_FILE} 없음 → plan_adj 생략 (원계획만 사용)")
        return expense_df

    raw = pd.read_csv(filepath, encoding="utf-8-sig")
    adj_col = next((c for c in PLAN_ADJ_COLS if c in raw.columns), None)
    if adj_col is None:
        print(f"   - 경고: {PLAN_ADJ_FILE} 에 {PLAN_ADJ_COLS} 중 어떤 컬럼도 없어 plan_adj 를 만들지 못했습니다.")
        return expense_df

    key_cols = ["사업부구분", "대분류", "중분류", "소분류"]
    cn_cols = ["사업부구분(중국어)", "대분류(중국어)", "중분류(중국어)", "소분류(중국어)"]
    for c in key_cols:
        raw[c] = raw[c].fillna("").astype(str).str.strip()
    for c in cn_cols:
        if c not in raw.columns:
            raw[c] = ""
        raw[c] = raw[c].fillna("").astype(str).str.strip()
    raw["_after"] = _clean_amount(raw[adj_col])

    # 사업부구분이 비어 있는 꼬리행(검산·메모)은 제외
    raw = raw[raw["사업부구분"] != ""]
    after_by_key = raw.groupby(key_cols, as_index=False).agg(
        _after=("_after", "sum"),
        biz_unit_cn=("사업부구분(중국어)", "first"),
        cost_lv1_cn=("대분류(중국어)", "first"),
        cost_lv2_cn=("중분류(중국어)", "first"),
        cost_lv3_cn=("소분류(중국어)", "first"),
    )
    after_map = {
        (r["사업부구분"], r["대분류"], r["중분류"], r["소분류"]): r["_after"]
        for _, r in after_by_key.iterrows()
    }

    base = expense_df[
        (expense_df["year"] == PLAN_ADJ_YEAR) & (expense_df["year_type"] == "plan")
    ].copy()
    if base.empty:
        print(f"   - {PLAN_ADJ_YEAR}년 원계획(plan) 이 없어 plan_adj 를 만들지 못했습니다.")
        return expense_df

    base["year_type"] = PLAN_ADJ_TYPE
    for c in ["cost_lv2", "cost_lv3"]:
        base[c] = base[c].fillna("").astype(str).str.strip()
    base["biz_unit"] = base["biz_unit"].astype(str).str.strip()
    base["cost_lv1"] = base["cost_lv1"].astype(str).str.strip()
    keys = list(zip(base["biz_unit"], base["cost_lv1"], base["cost_lv2"], base["cost_lv3"]))
    base["_key"] = keys

    # 1~11월 합 (키 단위)
    sum_1_11 = base[base["month"] <= 11].groupby("_key")["amount"].sum()

    # 12월 = 연간 실제 사용예상 − 1~11월 합. 같은 키가 여러 행이면 첫 행에 몰아넣고 나머지는 0.
    matched, unmatched = 0, []
    dec = base[base["month"] == 12]
    for key, grp in dec.groupby("_key", sort=False):
        after = after_map.get(key)
        if after is None:
            unmatched.append(key)
            continue
        idxs = list(grp.index)
        base.loc[idxs, "amount"] = 0.0
        base.loc[idxs[0], "amount"] = after - float(sum_1_11.get(key, 0.0))
        matched += 1

    # 원계획에 없는 신규 항목 → 12월에만 금액이 있는 행으로 추가
    base_keys = set(base["_key"])
    new_rows = []
    for _, r in after_by_key.iterrows():
        key = (r["사업부구분"], r["대분류"], r["중분류"], r["소분류"])
        if key in base_keys:
            continue
        for m in range(1, 13):
            new_rows.append({
                "year": PLAN_ADJ_YEAR,
                "month": m,
                "yyyymm": f"{PLAN_ADJ_YEAR}{m:02d}",
                "biz_unit": key[0],
                "cost_lv1": key[1],
                "cost_lv2": key[2],
                "cost_lv3": key[3],
                "amount": float(r["_after"]) if m == 12 else 0.0,
                "year_type": PLAN_ADJ_TYPE,
                "biz_unit_cn": r["biz_unit_cn"],
                "cost_lv1_cn": r["cost_lv1_cn"],
                "cost_lv2_cn": r["cost_lv2_cn"],
                "cost_lv3_cn": r["cost_lv3_cn"],
            })

    base = base.drop(columns=["_key"])
    parts = [expense_df, base]
    if new_rows:
        parts.append(pd.DataFrame(new_rows).reindex(columns=base.columns))

    out = pd.concat(parts, ignore_index=True)
    plan_total = expense_df.loc[
        (expense_df["year"] == PLAN_ADJ_YEAR) & (expense_df["year_type"] == "plan"), "amount"
    ].sum()
    adj_total = out.loc[
        (out["year"] == PLAN_ADJ_YEAR) & (out["year_type"] == PLAN_ADJ_TYPE), "amount"
    ].sum()
    print(f"   - plan_adj 생성: 매칭 {matched}개 키, 신규 {len(new_rows)//12}개 키")
    if unmatched:
        print(f"     경고: 중간점검에 없는 원계획 키 {len(unmatched)}개는 원계획 값 유지 → {unmatched[:5]}")
    print(f"     원계획 {plan_total:,.0f} → 실제 사용예상 {adj_total:,.0f} ({adj_total - plan_total:+,.0f})")
    return out


def get_annual_data() -> pd.DataFrame | None:
    """전역 변수에 저장된 연간 데이터를 반환하고 초기화"""
    global _annual_data_list
    if _annual_data_list:
        result = pd.concat(_annual_data_list, ignore_index=True)
        _annual_data_list = []  # 초기화
        return result
    return None


def load_headcount_data() -> tuple[pd.DataFrame, pd.DataFrame]:
    """인원수 CSV 파일들을 연도별로 읽어서 biz_unit & yyyymm 기준으로 집계
    반환값: (사업부 기준 인원수, 사업부(소분류) 기준 인원수)
    """
    import re
    
    headcount_files = [
        ("2024년인원수_actual.csv", 2024, "actual"),
        ("2025년인원수_actual.csv", 2025, "actual"),
        ("2026년인원수_plan.csv", 2026, "plan"),
        ("2026년인원수_actual.csv", 2026, "actual"),
    ]
    
    all_headcount = []
    all_headcount_sub = []
    
    for filename, year, year_type in headcount_files:
        filepath = os.path.join(CSV_BASE_PATH, filename)
        if not os.path.exists(filepath):
            print(f"경고: {filepath} 파일을 찾을 수 없습니다.")
            continue
        
        df = pd.read_csv(filepath, encoding="utf-8-sig")
        
        # 사업부 기준으로 집계
        id_cols = ["사업부"]
        has_subcategory = "사업부(소분류)" in df.columns
        
        # 월 컬럼 찾기: "1월", "2월", ... "12월"
        exclude_cols = [col for col in df.columns if "사업부" in col and col != "사업부"]
        month_cols = [col for col in df.columns 
                      if col not in id_cols 
                      and col not in exclude_cols
                      and re.match(r'^\d{1,2}월$', col.strip())]
        
        print(f"   - {filename} 월 컬럼: {month_cols[:5]}...")
        
        df_melted = df.melt(
            id_vars=id_cols,
            value_vars=month_cols,
            var_name="month_col",
            value_name="headcount",
        )
        
        # 연도/월 파싱 (파일명에서 추출한 year 전달)
        parsed = df_melted["month_col"].apply(lambda col: parse_month_column(col, year))
        mask = parsed.apply(lambda x: isinstance(x, tuple) and len(x) == 2)
        df_melted = df_melted[mask].copy()
        
        if len(df_melted) == 0:
            print(f"경고: {filename}에서 유효한 월 컬럼을 찾을 수 없습니다.")
            continue
        
        # year, month 컬럼 분리
        parsed_filtered = parsed[mask].tolist()
        df_melted["year"] = [p[0] for p in parsed_filtered]
        df_melted["month"] = [p[1] for p in parsed_filtered]
        df_melted["yyyymm"] = (
            df_melted["year"].astype(str)
            + df_melted["month"].astype(str).str.zfill(2)
        )
        df_melted["year_type"] = year_type
        
        # headcount 숫자 변환
        if df_melted["headcount"].dtype == "object":
            df_melted["headcount"] = df_melted["headcount"].astype(str)
            df_melted["headcount"] = df_melted["headcount"].replace(["nan", "NaN", "None", "", " ", "-"], "0")
            df_melted["headcount"] = df_melted["headcount"].str.replace(",", "", regex=False).str.replace(" ", "", regex=False).str.strip()
        
        df_melted["headcount"] = pd.to_numeric(
            df_melted["headcount"], errors="coerce"
        ).fillna(0)
        
        # 사업부 기준 집계
        headcount_df = df_melted.groupby(
            ["사업부", "yyyymm", "year_type"], as_index=False
        )["headcount"].sum()
        headcount_df = headcount_df.rename(columns={"사업부": "biz_unit"})
        all_headcount.append(headcount_df)
        
        print(f"   - {filename} 처리 완료: {len(headcount_df)} 행")
        
        # 사업부(소분류) 기준 인원수 처리
        if has_subcategory:
            id_cols_sub = ["사업부", "사업부(소분류)"]
            exclude_cols_sub = [col for col in df.columns if "사업부" in col and col not in id_cols_sub]
            month_cols_sub = [col for col in df.columns 
                            if col not in id_cols_sub 
                            and col not in exclude_cols_sub
                            and re.match(r'^\d{1,2}월$', col.strip())]
            
            df_melted_sub = df.melt(
                id_vars=id_cols_sub,
                value_vars=month_cols_sub,
                var_name="month_col",
                value_name="headcount",
            )
            
            # 연도/월 파싱
            parsed_sub = df_melted_sub["month_col"].apply(lambda col: parse_month_column(col, year))
            mask_sub = parsed_sub.apply(lambda x: isinstance(x, tuple) and len(x) == 2)
            df_melted_sub = df_melted_sub[mask_sub].copy()
            
            if len(df_melted_sub) > 0:
                parsed_filtered_sub = parsed_sub[mask_sub].tolist()
                df_melted_sub["year"] = [p[0] for p in parsed_filtered_sub]
                df_melted_sub["month"] = [p[1] for p in parsed_filtered_sub]
                df_melted_sub["yyyymm"] = (
                    df_melted_sub["year"].astype(str)
                    + df_melted_sub["month"].astype(str).str.zfill(2)
                )
                df_melted_sub["year_type"] = year_type
                
                # headcount 숫자 변환
                if df_melted_sub["headcount"].dtype == "object":
                    df_melted_sub["headcount"] = df_melted_sub["headcount"].astype(str)
                    df_melted_sub["headcount"] = df_melted_sub["headcount"].replace(["nan", "NaN", "None", "", " ", "-"], "0")
                    df_melted_sub["headcount"] = df_melted_sub["headcount"].str.replace(",", "", regex=False).str.replace(" ", "", regex=False).str.strip()
                
                df_melted_sub["headcount"] = pd.to_numeric(
                    df_melted_sub["headcount"], errors="coerce"
                ).fillna(0)
                
                # 사업부 컬럼이 비어있으면 "사업부(소분류)" 값을 사용
                df_melted_sub["사업부"] = df_melted_sub["사업부"].fillna(df_melted_sub["사업부(소분류)"])
                df_melted_sub["사업부"] = df_melted_sub.apply(
                    lambda row: row["사업부(소분류)"] if pd.isna(row["사업부"]) or str(row["사업부"]).strip() == "" else row["사업부"],
                    axis=1
                )
                
                # 사업부(소분류) 기준으로 집계
                headcount_subcategory_df = df_melted_sub.groupby(
                    ["사업부", "사업부(소분류)", "yyyymm", "year_type"], as_index=False
                )["headcount"].sum()
                headcount_subcategory_df = headcount_subcategory_df.rename(columns={"사업부": "biz_unit", "사업부(소분류)": "subcategory"})
                all_headcount_sub.append(headcount_subcategory_df)
                print(f"   - {filename} 사업부(소분류) 기준: {len(headcount_subcategory_df)} 행")
    
    # 모든 연도 데이터 결합
    if all_headcount:
        final_headcount_df = pd.concat(all_headcount, ignore_index=True)
    else:
        final_headcount_df = pd.DataFrame(columns=["biz_unit", "yyyymm", "headcount", "year_type"])
    
    if all_headcount_sub:
        final_headcount_sub_df = pd.concat(all_headcount_sub, ignore_index=True)
    else:
        final_headcount_sub_df = pd.DataFrame(columns=["biz_unit", "subcategory", "yyyymm", "headcount", "year_type"])

    return final_headcount_df[["biz_unit", "yyyymm", "headcount", "year_type"]], final_headcount_sub_df


def load_sales_data() -> pd.DataFrame:
    """판매매출 CSV 파일들을 연도별로 읽어서 biz_unit & yyyymm 기준으로 변환"""
    import re
    
    sales_files = [
        ("2024년판매매출_actual.csv", 2024, "actual"),
        ("2025년판매매출_actual.csv", 2025, "actual"),
        ("2026년판매매출_plan.csv", 2026, "plan"),
        ("2026년판매매출_actual.csv", 2026, "actual"),
    ]
    
    all_sales = []
    
    for filename, year, year_type in sales_files:
        filepath = os.path.join(CSV_BASE_PATH, filename)
        if not os.path.exists(filepath):
            print(f"경고: {filepath} 파일을 찾을 수 없습니다.")
            continue
        
        df = pd.read_csv(filepath, encoding="utf-8-sig")
        
        # 컬럼명 공백 제거
        df.columns = df.columns.str.strip()
        
        # "합계" 행 제외
        df = df[df["사업부"] != "합계"]
        
        # 빈 행 제거
        df = df.dropna(subset=["사업부"])
        
        # 월 컬럼 찾기: "1월", "2월", ... "12월"
        id_cols = ["사업부"]
        month_cols = [col for col in df.columns 
                      if col not in id_cols
                      and re.match(r'^\d{1,2}월$', col.strip())]
        
        print(f"   - {filename} 월 컬럼: {month_cols[:5]}...")
        
        df_melted = df.melt(
            id_vars=id_cols,
            value_vars=month_cols,
            var_name="month_col",
            value_name="sales",
        )
        
        # 연도/월 파싱 (파일명에서 추출한 year 전달)
        parsed = df_melted["month_col"].apply(lambda col: parse_month_column(col, year))
        mask = parsed.apply(lambda x: isinstance(x, tuple) and len(x) == 2)
        df_melted = df_melted[mask].copy()
        
        if len(df_melted) == 0:
            print(f"경고: {filename}에서 유효한 월 컬럼을 찾을 수 없습니다.")
            continue
        
        # year, month 컬럼 분리
        parsed_filtered = parsed[mask].tolist()
        df_melted["year"] = [p[0] for p in parsed_filtered]
        df_melted["month"] = [p[1] for p in parsed_filtered]
        df_melted["yyyymm"] = (
            df_melted["year"].astype(str)
            + df_melted["month"].astype(str).str.zfill(2)
        )
        df_melted["year_type"] = year_type
        
        sales_df = df_melted.rename(columns={"사업부": "biz_unit"})
        
        # sales 숫자 변환
        if sales_df["sales"].dtype == "object":
            sales_df["sales"] = sales_df["sales"].fillna("0")
            sales_df["sales"] = sales_df["sales"].astype(str)
            sales_df["sales"] = sales_df["sales"].replace(["nan", "NaN", "None", "", " "], "0")
            sales_df["sales"] = sales_df["sales"].str.replace(",", "", regex=False)
            sales_df["sales"] = sales_df["sales"].str.replace(" ", "", regex=False)
            sales_df["sales"] = sales_df["sales"].str.strip()
        
        sales_df["sales"] = pd.to_numeric(
            sales_df["sales"], errors="coerce"
        ).fillna(0)
        
        all_sales.append(sales_df[["biz_unit", "yyyymm", "sales", "year_type"]])
        print(f"   - {filename} 처리 완료: {len(sales_df)} 행")
    
    # 모든 연도 데이터 결합
    if all_sales:
        return pd.concat(all_sales, ignore_index=True)
    else:
        return pd.DataFrame(columns=["biz_unit", "yyyymm", "sales", "year_type"])


def merge_all_data(
    expense_df: pd.DataFrame,
    headcount_df: pd.DataFrame,
    headcount_subcategory_df: pd.DataFrame,
    sales_df: pd.DataFrame,
) -> pd.DataFrame:
    """모든 데이터를 병합"""
    # 디버깅: 병합 전 데이터 확인
    print(f"   - 병합 전 데이터:")
    print(f"     expense_df: {len(expense_df)} 행, amount sum={expense_df['amount'].sum():.2f}")
    print(f"     headcount_df: {len(headcount_df)} 행, yyyymm 샘플: {headcount_df['yyyymm'].head(3).tolist() if len(headcount_df) > 0 else '없음'}")
    print(f"     sales_df: {len(sales_df)} 행, yyyymm 샘플: {sales_df['yyyymm'].head(3).tolist() if len(sales_df) > 0 else '없음'}")
    if len(expense_df) > 0:
        print(f"     expense_df yyyymm 샘플: {expense_df['yyyymm'].head(3).tolist()}")
        print(f"     expense_df biz_unit 샘플: {expense_df['biz_unit'].head(3).tolist()}")
    
    # expense_df를 기준으로 left join (year_type 포함)
    merged = expense_df.merge(
        headcount_df,
        on=["biz_unit", "yyyymm", "year_type"],
        how="left",
    ).merge(
        sales_df,
        on=["biz_unit", "yyyymm", "year_type"],
        how="left",
    )

    # 사업부(소분류) 기준 인원수 병합 (cost_lv3와 매칭)
    if len(headcount_subcategory_df) > 0 and "cost_lv3" in merged.columns:
        # cost_lv3가 있는 경우에만 병합
        # 1단계: biz_unit과 cost_lv3로 매칭 시도 (year_type 포함)
        merged = merged.merge(
            headcount_subcategory_df.rename(columns={"subcategory": "cost_lv3"}),
            on=["biz_unit", "cost_lv3", "yyyymm", "year_type"],
            how="left",
            suffixes=("", "_subcategory"),
        )
        
        # 2단계: 매칭이 안 된 경우 cost_lv3만으로 매칭 시도 (biz_unit이 비어있거나 다른 경우)
        unmatched_mask = merged["headcount_subcategory"].isna()
        if unmatched_mask.any():
            # cost_lv3만으로 매칭
            headcount_by_subcategory = headcount_subcategory_df.rename(columns={"subcategory": "cost_lv3"}).drop(columns=["biz_unit"])
            merged_unmatched = merged[unmatched_mask].merge(
                headcount_by_subcategory,
                on=["cost_lv3", "yyyymm", "year_type"],
                how="left",
                suffixes=("", "_subcategory_fallback"),
            )
            # 매칭된 경우 업데이트
            matched_mask = merged_unmatched["headcount_subcategory_fallback"].notna()
            if matched_mask.any():
                merged.loc[unmatched_mask, "headcount_subcategory"] = merged_unmatched.loc[matched_mask, "headcount_subcategory_fallback"].values
                merged = merged.drop(columns=["headcount_subcategory_fallback"], errors="ignore")
        
        # 사업부(소분류) 기준 인원수가 있으면 그것을 사용, 없으면 사업부 기준 인원수 사용
        merged["headcount"] = merged["headcount_subcategory"].fillna(merged["headcount"])
        merged = merged.drop(columns=["headcount_subcategory"], errors="ignore")
        print(f"   - 사업부(소분류) 기준 인원수 병합 완료")

    # 디버깅: 병합 후 데이터 확인
    print(f"   - 병합 후 데이터:")
    print(f"     merged: {len(merged)} 행, amount sum={merged['amount'].sum():.2f}")
    print(f"     headcount null 개수: {merged['headcount'].isna().sum()}")
    print(f"     sales null 개수: {merged['sales'].isna().sum()}")

    # NaN을 0으로 채우기
    merged["headcount"] = merged["headcount"].fillna(0)
    merged["sales"] = merged["sales"].fillna(0)
    
    print(f"   - NaN 처리 후:")
    print(f"     amount sum={merged['amount'].sum():.2f}, headcount sum={merged['headcount'].sum():.2f}, sales sum={merged['sales'].sum():.2f}")

    return merged


def reassign_biz_unit_by_subcategory(df: pd.DataFrame) -> pd.DataFrame:
    """인건비/복리후생비의 소분류 기준으로 사업부 재할당
    - 대분류가 "인건비" 또는 "복리후생비"이고, 소분류가 "경영지원"인 경우 → 공통
    - 나머지 비용은 원래 사업부구분 그대로 유지
    """
    # 재할당 전 통계
    before_common = (df["biz_unit"] == "공통").sum()
    before_mlb = (df["biz_unit"] == "MLB").sum()
    
    # 조건: 대분류가 인건비 또는 복리후생비이고, 소분류가 경영지원인 경우
    mask = (
        (df["cost_lv1"].isin(["인건비", "복리후생비"])) &
        (df["cost_lv3"] == "경영지원")
    )
    
    # 경영지원 → 공통으로 재할당
    df.loc[mask, "biz_unit"] = "공통"
    
    # 재할당 후 통계
    after_common = (df["biz_unit"] == "공통").sum()
    after_mlb = (df["biz_unit"] == "MLB").sum()
    
    reassigned_count = mask.sum()
    if reassigned_count > 0:
        print(f"   - 인건비/복리후생비 경영지원 → 공통 재할당: {reassigned_count}행")
        print(f"     MLB: {before_mlb}행 → {after_mlb}행 (△{before_mlb - after_mlb})")
        print(f"     공통: {before_common}행 → {after_common}행 (+{after_common - before_common})")
        
        # 재할당된 금액 확인
        reassigned_amount = df.loc[mask, "amount"].sum()
        print(f"     재할당된 금액: {reassigned_amount:,.2f}")
    
    return df


def calculate_aggregations(df: pd.DataFrame, annual_df: pd.DataFrame | None = None, headcount_subcategory_df: pd.DataFrame | None = None) -> Dict[str, Any]:
    """집계 데이터 계산"""
    # 전체 데이터 (DUVETICA, SUPRA 포함)
    full_df = df.copy()
    
    # 디버깅: 병합된 데이터 확인
    print(f"   - 병합된 데이터 통계:")
    print(f"     전체 행 수: {len(df)}")
    print(f"     biz_unit 종류: {df['biz_unit'].unique().tolist()}")
    print(f"     amount 통계: min={df['amount'].min()}, max={df['amount'].max()}, sum={df['amount'].sum():.2f}")

    # biz_unit 값 정리 (공백 제거)
    if "biz_unit" in df.columns:
        df["biz_unit"] = df["biz_unit"].astype(str).str.strip()
    
    # 분석 대상만 필터링
    target_df = df[df["biz_unit"].isin(TARGET_BIZ_UNITS)].copy()
    
    # 디버깅: 필터링 전후 비교
    print(f"   - 필터링 전 biz_unit 고유값: {df['biz_unit'].unique().tolist()}")
    print(f"   - 필터링 전 데이터 수: {len(df)}, amount sum={df['amount'].sum():.2f}")
    
    # 디버깅: 필터링 후 데이터 확인
    print(f"   - 필터링 후 데이터 통계:")
    print(f"     대상 사업부 행 수: {len(target_df)}")
    print(f"     대상 사업부: {target_df['biz_unit'].unique().tolist()}")
    print(f"     amount 통계: min={target_df['amount'].min()}, max={target_df['amount'].max()}, sum={target_df['amount'].sum():.2f}")
    if len(target_df) > 0:
        sample = target_df[target_df["amount"] > 0].head(3)
        if len(sample) > 0:
            print(f"     샘플 데이터 (amount > 0):")
            for idx, row in sample.iterrows():
                print(f"       {row['biz_unit']} / {row['cost_lv1']} / {row['year']}-{row['month']:02d} / amount={row['amount']}")

    # 기본 집계: biz_unit, year, month, cost_lv1 기준
    agg_dict = {
        "amount": "sum",
        "headcount": "first",
        "sales": "first",
    }
    for cn in ["biz_unit_cn", "cost_lv1_cn"]:
        if cn in target_df.columns:
            agg_dict[cn] = "first"
    monthly_agg = target_df.groupby(
        ["biz_unit", "year", "month", "yyyymm", "cost_lv1", "year_type"],
        as_index=False,
    ).agg(agg_dict)
    
    # 디버깅: 집계 후 데이터 확인
    print(f"   - 집계 후 monthly_agg 통계:")
    print(f"     행 수: {len(monthly_agg)}")
    print(f"     amount 통계: min={monthly_agg['amount'].min()}, max={monthly_agg['amount'].max()}, sum={monthly_agg['amount'].sum():.2f}")
    if len(monthly_agg) > 0:
        sample = monthly_agg[monthly_agg["amount"] > 0].head(3)
        if len(sample) > 0:
            print(f"     샘플 데이터 (amount > 0):")
            for idx, row in sample.iterrows():
                print(f"       {row['biz_unit']} / {row['cost_lv1']} / {row['year']}-{row['month']:02d} / amount={row['amount']}")

    # 월별 총합 (cost_lv1 무시)
    total_agg_dict = {"amount": "sum", "headcount": "first", "sales": "first"}
    if "biz_unit_cn" in target_df.columns:
        total_agg_dict["biz_unit_cn"] = "first"
    monthly_total = target_df.groupby(
        ["biz_unit", "year", "month", "yyyymm", "year_type"],
        as_index=False,
    ).agg(total_agg_dict)

    # ========== 사업부(소분류) 기준 인원수로 덮어쓰기 ==========
    # 경영지원 → 공통, MLB → MLB, KIDS → KIDS, DISCOVERY → DISCOVERY
    if headcount_subcategory_df is not None and len(headcount_subcategory_df) > 0:
        subcategory_to_bizunit = {
            "경영지원": "공통",
            "MLB": "MLB",
            "KIDS": "KIDS",
            "DISCOVERY": "DISCOVERY",
        }
        
        print(f"   - 사업부(소분류) 기준 인원수 매핑 중...")
        for subcategory, dashboard_biz in subcategory_to_bizunit.items():
            sub_headcount = headcount_subcategory_df[
                headcount_subcategory_df["subcategory"] == subcategory
            ]
            for _, row in sub_headcount.iterrows():
                mask = (monthly_total["biz_unit"] == dashboard_biz) & \
                       (monthly_total["yyyymm"] == row["yyyymm"]) & \
                       (monthly_total["year_type"] == row["year_type"])
                if mask.any():
                    monthly_total.loc[mask, "headcount"] = row["headcount"]
        
        print(f"     매핑 규칙: {subcategory_to_bizunit}")
        # 디버깅: 매핑 결과 확인
        for biz in ["공통", "MLB", "KIDS", "DISCOVERY", "DUVETICA", "SUPRA"]:
            sample = monthly_total[(monthly_total["biz_unit"] == biz) & (monthly_total["yyyymm"] == "202511")]
            if len(sample) > 0:
                print(f"     {biz} 202511: headcount={sample['headcount'].values[0]}")

    # category_detail은 전체 데이터(DUVETICA, SUPRA 포함)를 사용
    # cost_lv2, cost_lv3가 없으면 빈 문자열로 채우기
    if "cost_lv2" not in df.columns:
        df["cost_lv2"] = ""
    else:
        df["cost_lv2"] = df["cost_lv2"].fillna("").astype(str).str.strip()
    
    if "cost_lv3" not in df.columns:
        df["cost_lv3"] = ""
    else:
        df["cost_lv3"] = df["cost_lv3"].fillna("").astype(str).str.strip()
    
    # 디버깅: MLB 광고비 중분류 확인
    mlb_ads = target_df[(target_df["biz_unit"] == "MLB") & (target_df["cost_lv1"] == "광고비")]
    if len(mlb_ads) > 0:
        print(f"   - MLB 광고비 데이터: {len(mlb_ads)} 행")
        lv2_unique = mlb_ads["cost_lv2"].unique()
        print(f"   - MLB 광고비 중분류 종류: {sorted([str(x) for x in lv2_unique if str(x).strip() != ''])}")
        sample = mlb_ads[mlb_ads["amount"] > 0].head(5)
        if len(sample) > 0:
            print(f"   - MLB 광고비 샘플 (amount > 0):")
            for idx, row in sample.iterrows():
                print(f"     {row['year']}-{row['month']:02d} / {row['cost_lv2']} / {row['cost_lv3']} / amount={row['amount']}")
    
    # category_detail: 전체 데이터 사용 (DUVETICA, SUPRA 포함)
    detail_agg_dict = {"amount": "sum", "headcount": "first"}
    for cn in ["biz_unit_cn", "cost_lv1_cn", "cost_lv2_cn", "cost_lv3_cn"]:
        if cn in df.columns:
            detail_agg_dict[cn] = "first"
    category_detail = df.groupby(
        [
            "biz_unit",
            "year",
            "month",
            "yyyymm",
            "cost_lv1",
            "cost_lv2",
            "cost_lv3",
            "year_type",
        ],
        as_index=False,
    ).agg(detail_agg_dict)
    
    print(f"   - category_detail 생성 (전체 데이터 사용):")
    print(f"     행 수: {len(category_detail)}")
    print(f"     biz_unit 종류: {sorted(category_detail['biz_unit'].unique().tolist())}")

    # 연간 데이터 처리
    annual_records = []
    if annual_df is not None and len(annual_df) > 0:
        # 연간 데이터는 전체 데이터 사용 (DUVETICA, SUPRA 포함)
        # biz_unit 값 정리 (공백 제거)
        if "biz_unit" in annual_df.columns:
            annual_df["biz_unit"] = annual_df["biz_unit"].astype(str).str.strip()
        
        # 연간 데이터를 category_detail과 같은 구조로 변환
        # biz_unit, year, cost_lv1, cost_lv2, cost_lv3 기준으로 그룹화
        annual_grouped = annual_df.groupby(
            ["biz_unit", "year", "cost_lv1", "cost_lv2", "cost_lv3", "year_type"],
            as_index=False,
        ).agg({"annual_amount": "sum"})
        
        annual_records = annual_grouped.to_dict("records")
        print(f"   - 연간 데이터 집계 (전체 데이터 사용): {len(annual_records)} 행")
        print(f"     biz_unit 종류: {sorted(annual_grouped['biz_unit'].unique().tolist())}")

    # JSON 직렬화를 위해 리스트로 변환
    monthly_agg_records = monthly_agg.to_dict("records")
    monthly_total_records = monthly_total.to_dict("records")
    
    # 디버깅: JSON 변환 전 데이터 확인
    print(f"   - JSON 변환 전:")
    print(f"     monthly_agg_records 수: {len(monthly_agg_records)}")
    if len(monthly_agg_records) > 0:
        sample = [r for r in monthly_agg_records if r.get("amount", 0) > 0][:3]
        if sample:
            print(f"     샘플 (amount > 0): {len(sample)} 건")
        else:
            print(f"     모든 amount가 0입니다. 레코드 수: {len(monthly_agg_records)}")
    
    # year_types 매핑 생성
    year_types_map = {}
    if "year_type" in target_df.columns:
        for year in target_df["year"].unique():
            year_data = target_df[target_df["year"] == year]
            types = sorted(year_data["year_type"].unique().tolist())
            year_types_map[str(int(year))] = types
    
    result: Dict[str, Any] = {
        "monthly_aggregated": monthly_agg_records,
        "monthly_total": monthly_total_records,
        "category_detail": category_detail.to_dict("records"),
        "annual_data": annual_records,  # 연간 데이터 추가
        "metadata": {
            "target_biz_units": TARGET_BIZ_UNITS,
            "years": sorted(target_df["year"].unique().tolist()),
            "months": sorted(target_df["month"].unique().tolist()),
            "year_types": year_types_map,  # year_types 추가
        },
    }

    return result


def main() -> int:
    print("비용 데이터 전처리를 시작합니다...")

    try:
        # 데이터 로드
        print("1. 비용 데이터 로드 중...")
        expense_df = load_expense_data()
        print(f"   - 비용 데이터: {len(expense_df)} 행")
        
        # 연간 데이터 추출
        annual_df = get_annual_data()
        if annual_df is not None:
            print(f"   - 연간 데이터: {len(annual_df)} 행")

        print("2. 인원수 데이터 로드 중...")
        headcount_df, headcount_subcategory_df = load_headcount_data()
        print(f"   - 인원수 데이터: {len(headcount_df)} 행")
        print(f"   - 사업부(소분류) 기준 인원수: {len(headcount_subcategory_df)} 행")

        print("3. 매출 데이터 로드 중...")
        sales_df = load_sales_data()
        print(f"   - 매출 데이터: {len(sales_df)} 행")

        # 데이터 병합
        print("4. 데이터 병합 중...")
        merged_df = merge_all_data(expense_df, headcount_df, headcount_subcategory_df, sales_df)
        print(f"   - 병합된 데이터: {len(merged_df)} 행")

        # 인건비/복리후생비 소분류 기준 사업부 재할당
        print("4-1. 인건비/복리후생비 소분류 기준 사업부 재할당...")
        merged_df = reassign_biz_unit_by_subcategory(merged_df)

        # 집계 계산
        print("5. 집계 데이터 계산 중...")
        aggregated = calculate_aggregations(merged_df, annual_df, headcount_subcategory_df)

        # JSON 저장
        output_file = OUTPUT_DIR / "aggregated-expense.json"
        print(f"6. JSON 파일 저장 중: {output_file}")
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(aggregated, f, ensure_ascii=False, indent=2)

        print("전처리 완료!")
        print(f"출력 파일: {output_file}")

    except Exception as e:
        print(f"오류 발생: {e}")
        import traceback

        traceback.print_exc()
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
