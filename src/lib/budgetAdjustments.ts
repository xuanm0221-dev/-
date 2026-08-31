/**
 * 예산 수기조정 (Budget Adjustment)
 *
 * 예산 중간점검에서 사용자가 직접 입력하는 연간계획 가감액.
 * - 신규 항목 발생 → 양수로 입력 (예: IT수수료 +800K, 비고 "AI식별시스템 신규 도입")
 * - 미집행 확정   → 음수로 입력 (예: IT수수료 -1,280K, 비고 "OMS 하반기 미사용")
 *
 * 저장된 금액은 해당 (연도 · 브랜드 · 대분류) 의 연간계획에 가산되며,
 * 진척률 · 잔여예산 · 8~12월예산 · 판정이 모두 재계산된다.
 */

/** 브랜드 드롭다운 목록 — 좌측 사업부 카드와 동일 */
export const ADJUST_BIZ_UNITS = ["법인", "MLB", "KIDS", "DISCOVERY", "공통"] as const;

/** 법인 = 브랜드 전체 롤업이므로 모든 조정을 합산한다 */
const CORPORATE_VIEW = "법인";

export interface BudgetAdjustment {
  id: string;
  year: number;
  /** 브랜드 (법인/MLB/KIDS/DISCOVERY/공통) */
  bizUnit: string;
  /** 대분류명 — 좌측 카드 항목명과 동일하게 입력 */
  lv1: string;
  /** 항목명(중분류) — 선택. 어떤 세부 항목 때문인지 표기용 (예: OMS) */
  lv2: string;
  /** 항목명 중국어 — 비우면 번역맵·CSV 에서 자동 표기 */
  lv2Cn: string;
  /** 가감액 (원 단위 = 입력한 K × 1000). 음수 허용 */
  amount: number;
  /** 비고 — 왜 이 금액인지 */
  note: string;
  /** 비고 중국어 — 비우면 한국어 비고를 그대로 노출 */
  noteCn: string;
  updatedAt: string;
}

export function makeAdjustmentId(): string {
  return `adj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isBlankAdjustment(a: BudgetAdjustment): boolean {
  return !a.lv1.trim() && !a.lv2.trim() && !a.amount && !a.note.trim();
}

/**
 * 특정 연도 · 브랜드 화면에 반영할 조정만 추린다.
 * 법인 뷰는 브랜드 조정까지 모두 합산(롤업), 개별 브랜드 뷰는 자기 것만.
 */
export function filterAdjustments(
  all: BudgetAdjustment[],
  year: number,
  bizUnit: string
): BudgetAdjustment[] {
  return all.filter(
    (a) =>
      a.year === year &&
      !!a.lv1.trim() &&
      (bizUnit === CORPORATE_VIEW || a.bizUnit === bizUnit)
  );
}

/** 대분류별 가감액 합계 (원 단위) */
export function adjustmentByLv1(
  all: BudgetAdjustment[],
  year: number,
  bizUnit: string
): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of filterAdjustments(all, year, bizUnit)) {
    const k = a.lv1.trim();
    m.set(k, (m.get(k) ?? 0) + a.amount);
  }
  return m;
}

/** 대분류별 조정 내역 (배지·툴팁에 비고를 보여주기 위함) */
export function adjustmentDetailByLv1(
  all: BudgetAdjustment[],
  year: number,
  bizUnit: string
): Map<string, BudgetAdjustment[]> {
  const m = new Map<string, BudgetAdjustment[]>();
  for (const a of filterAdjustments(all, year, bizUnit)) {
    const k = a.lv1.trim();
    const arr = m.get(k) ?? [];
    arr.push(a);
    m.set(k, arr);
  }
  return m;
}

/** 서버 응답 → 안전한 BudgetAdjustment[] */
export function normalizeAdjustments(raw: unknown): BudgetAdjustment[] {
  if (!Array.isArray(raw)) return [];
  const out: BudgetAdjustment[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const year = Number(o.year);
    const amount = Number(o.amount);
    if (!Number.isFinite(year) || !Number.isFinite(amount)) continue;
    out.push({
      id: typeof o.id === "string" && o.id ? o.id : makeAdjustmentId(),
      year,
      bizUnit: typeof o.bizUnit === "string" ? o.bizUnit : CORPORATE_VIEW,
      lv1: typeof o.lv1 === "string" ? o.lv1 : "",
      lv2: typeof o.lv2 === "string" ? o.lv2 : "",
      lv2Cn: typeof o.lv2Cn === "string" ? o.lv2Cn : "",
      amount,
      note: typeof o.note === "string" ? o.note : "",
      noteCn: typeof o.noteCn === "string" ? o.noteCn : "",
      updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : new Date().toISOString(),
    });
  }
  return out;
}

/** 화면 언어에 맞는 항목명 (중국어는 직접입력 → 자동표기 → 한국어 순) */
export function adjustmentLv2Label(
  a: BudgetAdjustment,
  lang: "ko" | "zh",
  autoCn: (ko: string) => string | undefined
): string {
  if (lang !== "zh") return a.lv2;
  return a.lv2Cn.trim() || autoCn(a.lv2) || a.lv2;
}

/** 화면 언어에 맞는 비고 (중국어 비고가 없으면 한국어 비고) */
export function adjustmentNote(a: BudgetAdjustment, lang: "ko" | "zh"): string {
  return (lang === "zh" ? a.noteCn.trim() || a.note : a.note).trim();
}
