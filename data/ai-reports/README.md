# AI 리포트 정적 파일

이 폴더의 `.txt` 파일을 AI 리포트 모달이 그대로 읽어 표시합니다.
런타임에는 보고서를 생성하지 않으며, **로컬 빌더로만** 생성합니다 (Claude API 사용 안 함).

## 파일명 규칙

`{year}-{month}-{yearType}-{mode}.txt`

예:
- `2026-3-actual-ytd.txt` — 2026년 3월 실적, YTD 누적
- `2026-3-actual-monthly.txt` — 2026년 3월 실적, 당월

## 생성 방법

```bash
# 1) (필요 시) 원본 데이터 갱신
python scripts/preprocess_sales.py        # Snowflake → 판매매출 CSV
python scripts/preprocess_expense.py      # CSV → aggregated-expense.json

# 2) 보고서 빌드 (결정적, 비용 0)
node scripts/build-ai-report.mjs --year 2026 --month 3 --mode ytd
node scripts/build-ai-report.mjs --year 2026 --month 3 --mode monthly

# 3) 커밋 & 푸시 → Vercel 자동 배포
git add data/ai-reports/2026-3-*.txt
git commit -m "AI 리포트 3월 갱신"
git push
```

## 배포 환경 동작

- 정적 파일이 있으면 즉시 표시
- 없으면 "보고서 미생성" 안내만 노출 (외부에서 생성 불가)
