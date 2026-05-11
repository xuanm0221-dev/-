"""
리테일 매출 전처리 — Snowflake에서 actual 데이터를 가져와 CSV로 저장.
매출이 비용보다 먼저 결산되므로 비용 전처리(preprocess_expense.py)와 별도로 실행합니다.

사용:
    python scripts/preprocess_sales.py
    python scripts/preprocess_sales.py --years 2024 2025 2026

자격증명: .env.local의 SNOWFLAKE_* 변수 사용 (key-pair 인증)
테이블: FNF.CHN.DW_SALE.sale_amt (실판), 브랜드 × 월별 합계
출력: 파일/YYYY년판매매출_actual.csv (기존 형식: 사업부 | 1월 | ... | 12월)

다음 단계: 비용 CSV 추가 후 `python scripts/preprocess_expense.py` 실행
"""

import argparse
import os
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).parent.parent
CSV_DIR = ROOT / "파일"
ENV_PATH = ROOT / ".env.local"
DEFAULT_YEARS = [2024, 2025, 2026]

# 사업부명 매핑 (Snowflake brd_cd → CSV biz_unit)
BRAND_MAP = {"M": "MLB", "I": "KIDS", "X": "DISCOVERY"}
# CSV 출력 순서 (기존 파일과 동일하게 유지)
CSV_ROW_ORDER = ["DISCOVERY", "KIDS", "MLB"]


# ─────────────────────────────────────────────────────────────
# Snowflake 연결
# ─────────────────────────────────────────────────────────────
_CONN = None


def connect():
    global _CONN
    if _CONN is not None:
        return _CONN
    import snowflake.connector
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import serialization
    from dotenv import load_dotenv

    if ENV_PATH.exists():
        load_dotenv(ENV_PATH)
    cfg = {
        "account":   os.environ["SNOWFLAKE_ACCOUNT"],
        "user":      os.environ["SNOWFLAKE_USERNAME"],
        "warehouse": os.environ["SNOWFLAKE_WAREHOUSE"],
        "database":  os.environ["SNOWFLAKE_DATABASE"],
        "schema":    os.environ["SNOWFLAKE_SCHEMA"],
        "role":      os.environ.get("SNOWFLAKE_ROLE"),
        "private_key_pem": os.environ["SNOWFLAKE_PRIVATE_KEY"],
    }
    pk = serialization.load_pem_private_key(
        cfg["private_key_pem"].encode("utf-8"),
        password=None,
        backend=default_backend(),
    )
    pkb = pk.private_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    _CONN = snowflake.connector.connect(
        account=cfg["account"],
        user=cfg["user"],
        warehouse=cfg["warehouse"],
        database=cfg["database"],
        schema=cfg["schema"],
        role=cfg["role"],
        private_key=pkb,
    )
    print(f"✓ Snowflake 연결: {cfg['account']} / {cfg['warehouse']} / {cfg['database']}.{cfg['schema']}")
    return _CONN


def fetch_sql(sql: str, label: str = "") -> list[dict]:
    print(f"[fetch] {label}")
    conn = connect()
    cur = conn.cursor()
    try:
        cur.execute(sql)
        cols = [c[0] for c in cur.description]
        rows = cur.fetchall()
        return [dict(zip(cols, r)) for r in rows]
    finally:
        cur.close()


# ─────────────────────────────────────────────────────────────
# 매출 데이터 조회
# ─────────────────────────────────────────────────────────────
def fetch_sales_by_brand_month(years: list[int]) -> pd.DataFrame:
    """
    FNF.CHN.DW_SALE.sale_amt 기준 브랜드 × 월별 합계.
    반환: DataFrame(biz_unit, year, month, sales)
    """
    years_str = ", ".join(str(y) for y in years)
    sql = f"""
SELECT
  CASE brd_cd
    WHEN 'M' THEN 'MLB'
    WHEN 'I' THEN 'KIDS'
    WHEN 'X' THEN 'DISCOVERY'
  END AS BIZ_UNIT,
  EXTRACT(YEAR FROM sale_dt)::INT AS YEAR,
  EXTRACT(MONTH FROM sale_dt)::INT AS MONTH,
  SUM(sale_amt) AS SALES
FROM FNF.CHN.DW_SALE
WHERE brd_cd IN ('M', 'I', 'X')
  AND EXTRACT(YEAR FROM sale_dt) IN ({years_str})
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3
"""
    rows = fetch_sql(sql, f"리테일 매출 actual (years={years})")
    if not rows:
        return pd.DataFrame(columns=["biz_unit", "year", "month", "sales"])
    df = pd.DataFrame(rows)
    df.columns = [c.lower() for c in df.columns]
    df["sales"] = pd.to_numeric(df["sales"], errors="coerce").fillna(0)
    print(f"   → {len(df)} 행 (브랜드×연월)")
    return df


# ─────────────────────────────────────────────────────────────
# CSV 저장 (기존 형식 유지: 사업부 | 1월 | ... | 12월)
# ─────────────────────────────────────────────────────────────
def write_csv_per_year(df: pd.DataFrame, year: int) -> Path:
    sub = df[df["year"] == year]
    pivot = sub.pivot_table(index="biz_unit", columns="month", values="sales", aggfunc="sum", fill_value=0)
    pivot.columns = [f"{m}월" for m in pivot.columns]
    # 행 순서 정렬 (기존 CSV와 동일)
    ordered = [b for b in CSV_ROW_ORDER if b in pivot.index]
    pivot = pivot.loc[ordered]
    # 합계 행
    total = pivot.sum().to_frame().T
    total.index = ["합계"]
    out = pd.concat([pivot, total])
    out.index.name = "사업부"
    # 누락된 월 컬럼은 0으로 채워 1~12월 모두 표시 (기존 CSV는 빈 셀)
    for m in range(1, 13):
        col = f"{m}월"
        if col not in out.columns:
            out[col] = 0
    # 1월~12월 순서로 컬럼 재정렬
    month_cols = [f"{m}월" for m in range(1, 13)]
    out = out[month_cols]
    # 빈 셀(미래 월)은 NaN으로 — 기존 CSV 미래월이 비어 있는 것과 동일
    today_year_max_month = sub["month"].max() if len(sub) > 0 else 0
    if year >= 2026:  # 진행 중 연도면 미래 월 NaN 처리
        for m in range(int(today_year_max_month) + 1, 13):
            out[f"{m}월"] = ""

    out_path = CSV_DIR / f"{year}년판매매출_actual.csv"
    # CSV: utf-8-sig (BOM) — 기존 파일과 동일 인코딩
    out.to_csv(out_path, encoding="utf-8-sig")
    print(f"✓ {out_path.name} 저장 ({len(out)} 행 × {len(out.columns)} 월)")
    return out_path


# ─────────────────────────────────────────────────────────────
# main
# ─────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Snowflake → 판매매출 actual CSV 갱신")
    parser.add_argument("--years", nargs="+", type=int, default=DEFAULT_YEARS,
                        help=f"갱신할 연도 목록 (default: {DEFAULT_YEARS})")
    args = parser.parse_args()

    print(f"=== Snowflake 판매매출 actual 갱신 ===")
    print(f"대상 연도: {args.years}")
    print()

    df = fetch_sales_by_brand_month(args.years)
    if df.empty:
        print("⚠ 데이터 없음. 종료.")
        sys.exit(1)

    for y in args.years:
        write_csv_per_year(df, y)

    print()
    print("✓ 완료. 다음 단계: `python scripts/preprocess_expense.py` 로 JSON 재생성")


if __name__ == "__main__":
    main()
