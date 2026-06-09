export type BizUnit = "법인" | "MLB" | "KIDS" | "DISCOVERY" | "공통";

/** API에서 로드된 집계 데이터 (Provider가 설정) */
let _data: AggregatedData | null = null;

/** 집계 데이터 설정 (ExpenseDataProvider에서 API fetch 후 호출) */
export function setExpenseData(d: AggregatedData): void {
  _data = d;
}

/** 내부용: 현재 데이터 반환. 없으면 에러 (Provider 로드 전 호출 시) */
function getData(): AggregatedData {
  if (!_data) {
    throw new Error("비용 데이터가 아직 로드되지 않았습니다. ExpenseDataProvider 내부에서 사용해주세요.");
  }
  return _data;
}

/** 집계 데이터 직접 접근 (annual_data 등 raw 접근 시 사용) */
export function getAggregatedData(): AggregatedData {
  return getData();
}

export type Mode = "monthly" | "ytd";

// 법인 비용/인원수 계산에 포함할 사업부 목록 (공통 포함)
const CORPORATE_BIZ_UNITS = ["MLB", "KIDS", "DISCOVERY", "공통"] as const;

// 법인 판매매출 계산에 포함할 브랜드 목록 (공통 제외 - 공통은 경영지원으로 자체 매출 없음)
const CORPORATE_SALES_BIZ_UNITS = ["MLB", "KIDS", "DISCOVERY"] as const;

export interface MonthlyAggregated {
  biz_unit: string;
  year: number;
  month: number;
  yyyymm: string;
  cost_lv1: string;
  amount: number;
  headcount: number;
  sales: number;
  year_type?: 'actual' | 'plan';  // 실적/예산 구분
  biz_unit_cn?: string;
  cost_lv1_cn?: string;
}

export interface MonthlyTotal {
  biz_unit: string;
  year: number;
  month: number;
  yyyymm: string;
  amount: number;
  headcount: number;
  sales: number;
  year_type?: 'actual' | 'plan';  // 실적/예산 구분
  biz_unit_cn?: string;
}

export interface CategoryDetail {
  biz_unit: string;
  year: number;
  month: number;
  yyyymm: string;
  cost_lv1: string;
  cost_lv2: string;
  cost_lv3: string;
  amount: number;
  headcount?: number;  // 사업부(소분류) 기준 인원수 (선택적)
  year_type?: 'actual' | 'plan';  // 실적/예산 구분
  biz_unit_cn?: string;
  cost_lv1_cn?: string;
  cost_lv2_cn?: string;
  cost_lv3_cn?: string;
}

export interface AnnualData {
  biz_unit: string;
  year: number;
  cost_lv1: string;
  cost_lv2: string;
  cost_lv3: string;
  annual_amount: number;
  year_type?: 'actual' | 'plan';  // 실적/예산 구분
  biz_unit_cn?: string;
  cost_lv1_cn?: string;
  cost_lv2_cn?: string;
  cost_lv3_cn?: string;
}

export interface AggregatedData {
  monthly_aggregated: MonthlyAggregated[];
  monthly_total: MonthlyTotal[];
  category_detail: CategoryDetail[];
  annual_data?: AnnualData[];  // 연간 데이터 (선택적)
  metadata: {
    target_biz_units: string[];
    years: number[];
    months: number[];
    year_types?: Record<string, string[]>;  // 연도별 타입 (actual/plan)
  };
}

// 분석 대상 사업부만 필터링
const TARGET_BIZ_UNITS: BizUnit[] = ["MLB", "KIDS", "DISCOVERY", "공통"];

export function getMonthlyTotal(
  bizUnit: BizUnit,
  year: number,
  month: number,
  mode: Mode = "monthly",
  yearType: 'actual' | 'plan' = 'actual'
): MonthlyTotal | null {
  // 법인인 경우 4개 사업부 raw 데이터 직접 합계 (재귀 호출 제거로 경영지원 중복 방지)
  if (bizUnit === "법인") {
    const data = getData();
    let corporateFiltered = data.monthly_total.filter(
      (item) =>
        CORPORATE_BIZ_UNITS.includes(item.biz_unit as any) &&
        item.year === year &&
        item.year_type === yearType
    );
    if (mode === "monthly") {
      corporateFiltered = corporateFiltered.filter((item) => item.month === month);
    } else {
      corporateFiltered = corporateFiltered.filter((item) => item.month <= month);
    }
    if (corporateFiltered.length === 0) {
      return null;
    }
    if (mode === "ytd") {
      // 판매매출은 공통 제외하고 브랜드만 합산
      const salesSum = corporateFiltered
        .filter(item => CORPORATE_SALES_BIZ_UNITS.includes(item.biz_unit as any))
        .reduce((acc, item) => acc + (item.sales || 0), 0);
      
      return corporateFiltered.reduce(
        (acc, item) => ({
          ...acc,
          amount: acc.amount + (item.amount || 0),
          headcount: item.headcount || 0,
          sales: salesSum,
        }),
        {
          biz_unit: "법인",
          year,
          month,
          yyyymm: `${year}${String(month).padStart(2, "0")}`,
          amount: 0,
          headcount: 0,
          sales: 0,
          year_type: yearType,
        }
      );
    } else {
      // monthly: 4개 사업부 합산
      // 판매매출은 공통 제외하고 브랜드만 합산
      const salesSum = corporateFiltered
        .filter(item => CORPORATE_SALES_BIZ_UNITS.includes(item.biz_unit as any))
        .reduce((acc, item) => acc + (item.sales || 0), 0);
      
      return corporateFiltered.reduce(
        (acc, item) => ({
          ...acc,
          amount: acc.amount + (item.amount || 0),
          headcount: acc.headcount + (item.headcount || 0),
          sales: salesSum,
        }),
        {
          biz_unit: "법인",
          year,
          month,
          yyyymm: `${year}${String(month).padStart(2, "0")}`,
          amount: 0,
          headcount: 0,
          sales: 0,
          year_type: yearType,
        }
      );
    }
  }

  // 공통: monthly_total 공통 + category_detail MLB 경영지원 amount 합산
  if (bizUnit === "공통") {
    const data = getData();
    let commonFiltered = data.monthly_total.filter(
      (item) =>
        item.biz_unit === "공통" &&
        item.year === year &&
        item.year_type === yearType
    );
    if (mode === "monthly") {
      commonFiltered = commonFiltered.filter((item) => item.month === month);
    } else {
      commonFiltered = commonFiltered.filter((item) => item.month <= month);
    }
    if (commonFiltered.length === 0) {
      return null;
    }
    let result: MonthlyTotal;
    if (mode === "ytd") {
      result = commonFiltered.reduce(
        (acc, item) => ({
          ...acc,
          amount: acc.amount + (item.amount || 0),
          headcount: item.headcount || 0,
          sales: acc.sales + (item.sales || 0),
        }),
        {
          biz_unit: "공통",
          year,
          month,
          yyyymm: `${year}${String(month).padStart(2, "0")}`,
          amount: 0,
          headcount: 0,
          sales: 0,
          year_type: yearType,
        }
      );
    } else {
      result = { ...commonFiltered[0] };
    }
    const supportDetail = data.category_detail.filter(
      (item) =>
        item.biz_unit === "MLB" &&
        (item.cost_lv3 || "").trim() === "경영지원" &&
        item.year === year &&
        item.year_type === yearType
    );
    const supportFiltered =
      mode === "monthly"
        ? supportDetail.filter((item) => item.month === month)
        : supportDetail.filter((item) => item.month <= month);
    const supportAmount = supportFiltered.reduce(
      (s, i) => s + (i.amount || 0),
      0
    );
    result.amount += supportAmount;
    return result;
  }

  const data = getData();
  let filtered = data.monthly_total.filter(
    (item) =>
      item.biz_unit === bizUnit &&
      item.year === year &&
      item.year_type === yearType
  );

  if (mode === "monthly") {
    filtered = filtered.filter((item) => item.month === month);
  } else {
    // YTD: 1월부터 해당 월까지
    filtered = filtered.filter((item) => item.month <= month);
  }

  if (filtered.length === 0) {
    return null;
  }

  // YTD인 경우 합계 계산
  if (mode === "ytd") {
    if (filtered.length === 0) {
      return null;
    }
    const aggregated = filtered.reduce(
      (acc, item) => ({
        ...acc,
        amount: acc.amount + (item.amount || 0),
        headcount: item.headcount || 0, // 마지막 월의 인원수 사용
        sales: acc.sales + (item.sales || 0),
      }),
      {
        biz_unit: bizUnit,
        year,
        month,
        yyyymm: `${year}${String(month).padStart(2, "0")}`,
        amount: 0,
        headcount: 0,
        sales: 0,
      }
    );
    return aggregated;
  }

  return filtered[0];
}

export function getPreviousYearTotal(
  bizUnit: BizUnit,
  year: number,
  month: number,
  mode: Mode = "monthly",
  yearType: 'actual' | 'plan' = 'actual'
): MonthlyTotal | null {
  return getMonthlyTotal(bizUnit, year - 1, month, mode, yearType);
}

/** 해당 연도 1~12월 인원수 합계 (인당 비용 계산용: 연간 비용 합계 / 연간 인원수 합계) */
export function getAnnualHeadcountSum(bizUnit: BizUnit, year: number, yearType: 'actual' | 'plan' = 'actual'): number {
  let sum = 0;
  for (let m = 1; m <= 12; m++) {
    const t = getMonthlyTotal(bizUnit, year, m, "monthly", yearType);
    sum += t?.headcount ?? 0;
  }
  return sum;
}

/** 1월~선택월까지 인원수 합계 (실적 YTD 인당 계산용) */
export function getYTDHeadcountSum(
  bizUnit: BizUnit,
  year: number,
  month: number,
  yearType: 'actual' | 'plan' = 'actual'
): number {
  let sum = 0;
  for (let m = 1; m <= month; m++) {
    const t = getMonthlyTotal(bizUnit, year, m, "monthly", yearType);
    sum += t?.headcount ?? 0;
  }
  return sum;
}

export function getMonthlyAggregatedByCategory(
  bizUnit: BizUnit,
  year: number,
  month: number,
  mode: Mode = "monthly",
  yearType: 'actual' | 'plan' = 'actual'
): MonthlyAggregated[] {
  const data = getData();
  // 법인인 경우 4개 사업부 raw 데이터 직접 집계 (재귀 호출 제거로 경영지원 중복 방지)
  if (bizUnit === "법인") {
    let corporateFiltered = data.monthly_aggregated.filter(
      (item) =>
        CORPORATE_BIZ_UNITS.includes(item.biz_unit as any) &&
        item.year === year &&
        item.year_type === yearType
    );
    if (mode === "monthly") {
      corporateFiltered = corporateFiltered.filter((item) => item.month === month);
    } else {
      corporateFiltered = corporateFiltered.filter((item) => item.month <= month);
    }
    const grouped = new Map<string, MonthlyAggregated>();
    corporateFiltered.forEach((item) => {
      const key = item.cost_lv1;
      if (grouped.has(key)) {
        const existing = grouped.get(key)!;
        existing.amount += item.amount;
      } else {
        grouped.set(key, {
          ...item,
          biz_unit: "법인",
        });
      }
    });
    return Array.from(grouped.values());
  }

  // 공통: monthly_aggregated 공통 + category_detail MLB 경영지원 cost_lv1별 합산 반영
  if (bizUnit === "공통") {
    let commonFiltered = data.monthly_aggregated.filter(
      (item) =>
        item.biz_unit === "공통" &&
        item.year === year &&
        item.year_type === yearType
    );
    if (mode === "monthly") {
      commonFiltered = commonFiltered.filter((item) => item.month === month);
    } else {
      commonFiltered = commonFiltered.filter((item) => item.month <= month);
    }
    const grouped = new Map<string, MonthlyAggregated>();
    commonFiltered.forEach((item) => {
      const key = item.cost_lv1;
      if (grouped.has(key)) {
        const existing = grouped.get(key)!;
        existing.amount += item.amount;
      } else {
        grouped.set(key, { ...item });
      }
    });
    const supportDetail = data.category_detail.filter(
      (item) =>
        item.biz_unit === "MLB" &&
        (item.cost_lv3 || "").trim() === "경영지원" &&
        item.year === year &&
        item.year_type === yearType
    );
    const supportFiltered =
      mode === "monthly"
        ? supportDetail.filter((item) => item.month === month)
        : supportDetail.filter((item) => item.month <= month);
    supportFiltered.forEach((item) => {
      const key = item.cost_lv1 || "";
      if (!key) return;
      const amount = item.amount || 0;
      const headcount = item.headcount || 0;
      if (grouped.has(key)) {
        const existing = grouped.get(key)!;
        existing.amount += amount;
        existing.headcount += headcount;
      } else {
        grouped.set(key, {
          biz_unit: "공통",
          year,
          month,
          yyyymm: `${year}${String(month).padStart(2, "0")}`,
          cost_lv1: key,
          amount,
          headcount,
          sales: 0,
          year_type: yearType,
        });
      }
    });
    return Array.from(grouped.values());
  }

  let filtered = data.monthly_aggregated.filter(
    (item) =>
      item.biz_unit === bizUnit &&
      item.year === year &&
      item.year_type === yearType
  );

  if (mode === "monthly") {
    filtered = filtered.filter((item) => item.month === month);
  } else {
    filtered = filtered.filter((item) => item.month <= month);
  }

  // monthly와 ytd 모두 대분류별로 합계 계산
  const grouped = new Map<string, MonthlyAggregated>();
  filtered.forEach((item) => {
    const key = item.cost_lv1;
    if (grouped.has(key)) {
      const existing = grouped.get(key)!;
      existing.amount += item.amount;
    } else {
      grouped.set(key, { ...item });
    }
  });
  return Array.from(grouped.values());
}

export function getAnnualData(
  bizUnit: BizUnit | "ALL",
  year: number,
  costLv1: string = "",
  costLv2: string = "",
  costLv3: string = "",
  yearType: 'actual' | 'plan' = 'actual'
): AnnualData[] {
  const data = getData();
  if (!data.annual_data) {
    return [];
  }

  // 법인인 경우 4개 사업부 raw 데이터 직접 반환 (재귀 호출 제거로 경영지원 중복 방지)
  if (bizUnit === "법인") {
    return data.annual_data.filter(
      (item) =>
        CORPORATE_BIZ_UNITS.includes(item.biz_unit as any) &&
        item.year === year &&
        (costLv1 === "" || item.cost_lv1 === costLv1) &&
        (costLv2 === "" || item.cost_lv2 === costLv2) &&
        (costLv3 === "" || item.cost_lv3 === costLv3) &&
        item.year_type === yearType
    );
  }

  // bizUnit이 "ALL"이면 모든 사업부(MLB, KIDS, DISCOVERY, DUVETICA, SUPRA, 공통) 포함
  let filtered = data.annual_data.filter(
    (item) =>
      (bizUnit === "ALL" || item.biz_unit === bizUnit) &&
      item.year === year &&
      (costLv1 === "" || item.cost_lv1 === costLv1) &&
      (costLv2 === "" || item.cost_lv2 === costLv2) &&
      (costLv3 === "" || item.cost_lv3 === costLv3) &&
      item.year_type === yearType
  );

  // 공통: 데이터상 사업부가 MLB이고 소분류가 "경영지원"인 행도 공통으로 포함 (26년 예산 등 연간 데이터)
  if (bizUnit === "공통") {
    const commonAsMLB = data.annual_data.filter(
      (item) =>
        item.biz_unit === "MLB" &&
        (item.cost_lv3 || "").trim() === "경영지원" &&
        item.year === year &&
        (costLv1 === "" || item.cost_lv1 === costLv1) &&
        (costLv2 === "" || item.cost_lv2 === costLv2) &&
        (costLv3 === "" || item.cost_lv3 === costLv3) &&
        item.year_type === yearType
    ).map((item) => ({ ...item, biz_unit: "공통" }));
    filtered = [...filtered, ...commonAsMLB];
  }

  return filtered;
}

/** CategoryDetail[]을 (cost_lv1, cost_lv2, cost_lv3, biz_unit)별로 집계하여 AnnualData[]로 변환 */
export function aggregateCategoryDetailToAnnual(details: CategoryDetail[]): AnnualData[] {
  const grouped = new Map<string, number>();
  for (const d of details) {
    const key = `${d.biz_unit || ""}\x00${d.cost_lv1 || ""}\x00${d.cost_lv2 || ""}\x00${d.cost_lv3 || ""}`;
    grouped.set(key, (grouped.get(key) || 0) + d.amount);
  }
  const year = details[0]?.year ?? 0;
  const yearType = details[0]?.year_type ?? "actual";
  return Array.from(grouped.entries()).map(([key, annual_amount]) => {
    const [biz_unit, cost_lv1, cost_lv2, cost_lv3] = key.split("\x00");
    return {
      biz_unit: biz_unit || "",
      year,
      cost_lv1: cost_lv1 || "",
      cost_lv2: cost_lv2 || "",
      cost_lv3: cost_lv3 || "",
      annual_amount,
      year_type: yearType,
    } as AnnualData;
  });
}

export function getCategoryDetail(
  bizUnit: BizUnit | "ALL",
  year: number,
  month: number,
  costLv1: string = "",
  mode: Mode = "monthly",
  yearType: 'actual' | 'plan' = 'actual'
): CategoryDetail[] {
  const data = getData();
  // 법인인 경우 4개 사업부 raw 데이터 직접 반환 (재귀 호출 제거로 경영지원 중복 방지)
  if (bizUnit === "법인") {
    let corporateFiltered = data.category_detail.filter(
      (item) =>
        CORPORATE_BIZ_UNITS.includes(item.biz_unit as any) &&
        item.year === year &&
        (costLv1 === "" || item.cost_lv1 === costLv1) &&
        item.year_type === yearType
    );
    if (mode === "monthly") {
      corporateFiltered = corporateFiltered.filter((item) => item.month === month);
    } else {
      corporateFiltered = corporateFiltered.filter((item) => item.month <= month);
    }
    if (mode === "ytd") {
      const grouped = new Map<string, CategoryDetail>();
      corporateFiltered.forEach((item) => {
        const key = `${item.biz_unit || ""}|${item.cost_lv1 || ""}|${item.cost_lv2 || ""}|${item.cost_lv3 || ""}`;
        if (grouped.has(key)) {
          const existing = grouped.get(key)!;
          existing.amount += item.amount;
        } else {
          grouped.set(key, { ...item });
        }
      });
      return Array.from(grouped.values());
    }
    return corporateFiltered;
  }

  // bizUnit이 "ALL"이면 모든 사업부(MLB, KIDS, DISCOVERY, DUVETICA, SUPRA, 공통) 포함
  let filtered = data.category_detail.filter(
    (item) =>
      (bizUnit === "ALL" || item.biz_unit === bizUnit) &&
      item.year === year &&
      (costLv1 === "" || item.cost_lv1 === costLv1) &&
      item.year_type === yearType
  );

  // 공통: 데이터상 사업부가 MLB이고 소분류가 "경영지원"인 행도 공통으로 포함
  if (bizUnit === "공통") {
    const commonAsMLB = data.category_detail.filter(
      (item) =>
        item.biz_unit === "MLB" &&
        (item.cost_lv3 || "").trim() === "경영지원" &&
        item.year === year &&
        (costLv1 === "" || item.cost_lv1 === costLv1) &&
        item.year_type === yearType
    ).map((item) => ({ ...item, biz_unit: "공통" as const }));
    filtered = [...filtered, ...commonAsMLB];
  }

  if (mode === "monthly") {
    filtered = filtered.filter((item) => item.month === month);
  } else {
    filtered = filtered.filter((item) => item.month <= month);
  }

  // 디버깅: 필터링 결과 확인
  if (costLv1 === "광고비" && bizUnit === "MLB") {
    console.log(`[getCategoryDetail] MLB 광고비 필터링 결과: ${filtered.length}개`);
    if (filtered.length > 0) {
      const lv2Set = new Set(filtered.map((item) => item.cost_lv2 || "").filter((x) => x.trim() !== ""));
      console.log(`[getCategoryDetail] 중분류 종류:`, Array.from(lv2Set));
      const sample = filtered.filter((item) => (item.cost_lv2 || "").trim() !== "").slice(0, 5);
      console.log(`[getCategoryDetail] 샘플:`, sample);
    }
  }

  if (mode === "ytd") {
    // YTD: 사업부구분, 중분류, 소분류별로 합계
    const grouped = new Map<string, CategoryDetail>();
    filtered.forEach((item) => {
      // bizUnit이 "ALL"인 경우도 사업부구분을 유지 (계층 구조를 위해)
      const key = `${item.biz_unit || ""}|${item.cost_lv1 || ""}|${item.cost_lv2 || ""}|${item.cost_lv3 || ""}`;
      if (grouped.has(key)) {
        const existing = grouped.get(key)!;
        existing.amount += item.amount;
      } else {
        grouped.set(key, { ...item });
      }
    });
    return Array.from(grouped.values());
  }

  return filtered;
}

export function getMonthlyTrend(
  bizUnit: BizUnit,
  year: number,
  mode: Mode = "monthly",
  yearType: 'actual' | 'plan' = 'actual'
): MonthlyTotal[] {
  const data = getData();
  // 법인인 경우 4개 사업부 합계 계산
  if (bizUnit === "법인") {
    const allTrends = new Map<number, MonthlyTotal>();
    
    for (const bu of CORPORATE_BIZ_UNITS) {
      const buTrends = getMonthlyTrend(bu as BizUnit, year, mode, yearType);
      
      buTrends.forEach((item) => {
        if (allTrends.has(item.month)) {
          const existing = allTrends.get(item.month)!;
          existing.amount += item.amount;
          existing.sales += item.sales;
          existing.headcount = (existing.headcount || 0) + (item.headcount || 0);
        } else {
          allTrends.set(item.month, {
            ...item,
            biz_unit: "법인",
          });
        }
      });
    }
    
    return Array.from(allTrends.values()).sort((a, b) => a.month - b.month);
  }

  let filtered = data.monthly_total.filter(
    (item) => 
      item.biz_unit === bizUnit && 
      item.year === year &&
      item.year_type === yearType
  );

  if (mode === "ytd") {
    // YTD: 각 월까지의 누적값 계산
    const result: MonthlyTotal[] = [];
    let cumulativeAmount = 0;
    let cumulativeSales = 0;
    for (let m = 1; m <= 12; m++) {
      const monthData = filtered.find((item) => item.month === m);
      if (monthData) {
        cumulativeAmount += monthData.amount;
        cumulativeSales += monthData.sales;
        result.push({
          ...monthData,
          amount: cumulativeAmount,
          sales: cumulativeSales,
        });
      }
    }
    return result;
  }

  return filtered.sort((a, b) => a.month - b.month);
}

export function getMonthlyStackedData(
  bizUnit: BizUnit,
  year: number,
  mode: Mode = "monthly",
  yearType: 'actual' | 'plan' = 'actual'
): {
  data: {
    month: number;
    yyyymm: string;
    categories: Record<string, number>;
    total: number;
    yoy: number | null;
    current: number;
    previous: number | null;
  }[];
  categoryLabelMap: Record<string, string>;
} {
  const monthlyData = getMonthlyTrend(bizUnit, year, mode, yearType);
  const prevYearData = getMonthlyTrend(bizUnit, year - 1, mode, yearType === 'plan' ? 'actual' : yearType);

  const prevYearMap = new Map(
    prevYearData.map((item) => [`${item.month}`, item])
  );

  const categoryLabelMap: Record<string, string> = {};

  const data = monthlyData.map((item) => {
    const prevItem = prevYearMap.get(`${item.month}`);
    const previous = prevItem?.amount ?? null;
    // YOY 계산: 당년 / 전년 * 100 (예: 당년 1500 / 전년 100 = 1,500%)
    // 전년도가 음수이거나 0이면 YOY를 null로 처리 (추세선 끊김)
    const yoy =
      previous !== null && previous > 0
        ? (item.amount / previous) * 100
        : null;

    // 해당 월의 대분류별 데이터 가져오기
    const categoryData = getMonthlyAggregatedByCategory(
      bizUnit,
      year,
      item.month,
      mode,
      yearType
    );

    const categories: Record<string, number> = {};
    categoryData.forEach((cat) => {
      categories[cat.cost_lv1] = (categories[cat.cost_lv1] || 0) + cat.amount;
      if (cat.cost_lv1_cn != null && String(cat.cost_lv1_cn).trim() !== "") {
        categoryLabelMap[cat.cost_lv1] = String(cat.cost_lv1_cn).trim();
      }
    });

    return {
      month: item.month,
      yyyymm: item.yyyymm,
      categories,
      total: item.amount,
      yoy,
      current: item.amount,
      previous,
    };
  });

  return { data, categoryLabelMap };
}

export function calculateYOY(
  current: number | null | undefined,
  previous: number | null | undefined
): number | null {
  // YOY 계산: 당년 / 전년 * 100 (예: 당년 68 / 전년 100 = 68%)
  if (
    current === null ||
    current === undefined ||
    previous === null ||
    previous === undefined ||
    previous === 0 ||
    isNaN(current) ||
    isNaN(previous)
  ) {
    return null;
  }
  // YOY 계산: 당년 / 전년 * 100 (예: 당년 68 / 전년 100 = 68%)
  return (current / previous) * 100;
}

export function calculateCostRatio(
  cost: number | null | undefined,
  sales: number | null | undefined
): number | null {
  if (
    cost === null ||
    cost === undefined ||
    sales === null ||
    sales === undefined ||
    sales === 0 ||
    isNaN(cost) ||
    isNaN(sales)
  ) {
    return null;
  }
  // 비용율 계산: 비용 * 1.13 / 판매매출 * 100
  return (cost * 1.13 / sales) * 100;
}

export function calculatePerPersonCost(
  cost: number | null | undefined,
  headcount: number | null | undefined
): number | null {
  if (
    cost === null ||
    cost === undefined ||
    headcount === null ||
    headcount === undefined ||
    headcount === 0 ||
    isNaN(cost) ||
    isNaN(headcount)
  ) {
    return null;
  }
  return cost / headcount;
}

export interface YearOption {
  year: number;
  type: 'actual' | 'plan';
  display: string;
}

export function getAvailableYearOptions(): YearOption[] {
  const data = getData();
  const metadata = data.metadata;
  const yearTypes = metadata.year_types || {};
  const options: YearOption[] = [];
  
  for (const year of metadata.years) {
    const types = yearTypes[year.toString()] || ['actual'];
    
    for (const type of types) {
      const display = type === 'plan' 
        ? `${year}년(예산)` 
        : `${year}년(실적)`;
      
      options.push({ year, type: type as 'actual' | 'plan', display });
    }
  }
  
  // 정렬: 연도 내림차순, 같은 연도면 plan 먼저
  return options.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return a.type === 'plan' ? -1 : 1;
  });
}

export function getAvailableYears(): number[] {
  const data = getData();
  return data.metadata.years.sort((a, b) => b - a);
}

export function getAvailableMonths(year: number, yearType: 'actual' | 'plan' = 'actual'): number[] {
  const data = getData();
  // 월별 amount 합계를 계산해 0이 아닌 월만 "가용"으로 간주
  // (전처리 시 미래 월에도 0 행이 생성되므로 단순 존재 여부로는 부족)
  const sumsByMonth = new Map<number, number>();
  for (const item of data.monthly_total) {
    if (item.year === year && item.year_type === yearType) {
      sumsByMonth.set(item.month, (sumsByMonth.get(item.month) ?? 0) + (item.amount ?? 0));
    }
  }
  return Array.from(sumsByMonth.entries())
    .filter(([, sum]) => sum !== 0)
    .map(([m]) => m)
    .sort((a, b) => a - b);
}

export interface AdSalesDataPoint {
  month: number;
  yyyymm: string;
  adSpend: number; // 광고비
  sales: number; // 매출
  adSpendPrevYear: number | null;
  salesPrevYear: number | null;
}/**
 * 광고비-매출 분석 데이터 추출
 * @param bizUnit 사업부
 * @param year 년도
 * @returns 월별 광고비-매출 데이터 (광고비가 0이거나 null인 월 제외)
 */
export function getAdSalesAnalysisData(
  bizUnit: BizUnit,
  year: number,
  yearType: 'actual' | 'plan' = 'actual'
): AdSalesDataPoint[] {
  // 당해년도 및 전년도 월별 데이터 가져오기
  const currentYearData = getMonthlyTrend(bizUnit, year, "monthly", yearType);
  const prevYearData = getMonthlyTrend(bizUnit, year - 1, "monthly", yearType);

  // 전년도 데이터를 Map으로 변환
  const prevYearMap = new Map(
    prevYearData.map((item) => [item.month, item])
  );

  // 각 월의 광고비 추출
  const result: AdSalesDataPoint[] = [];

  for (const monthData of currentYearData) {
    // 해당 월의 광고비 추출
    const adCategories = getMonthlyAggregatedByCategory(
      bizUnit,
      year,
      monthData.month,
      "monthly",
      yearType
    );
    const adExpense = adCategories.find((cat) => cat.cost_lv1 === "광고비");
    const adSpend = adExpense?.amount ?? 0;

    // 전년도 광고비 추출
    const prevYearMonth = prevYearMap.get(monthData.month);
    let adSpendPrevYear: number | null = null;
    if (prevYearMonth) {
      const prevAdCategories = getMonthlyAggregatedByCategory(
        bizUnit,
        year - 1,
        monthData.month,
        "monthly",
        yearType
      );
      const prevAdExpense = prevAdCategories.find(
        (cat) => cat.cost_lv1 === "광고비"
      );
      adSpendPrevYear = prevAdExpense?.amount ?? null;
    }

    // 광고비가 0이거나 매출이 0인 경우 제외
    if (adSpend > 0 && monthData.sales > 0) {
      result.push({
        month: monthData.month,
        yyyymm: monthData.yyyymm,
        adSpend,
        sales: monthData.sales,
        adSpendPrevYear,
        salesPrevYear: prevYearMonth?.sales ?? null,
      });
    }
  }

  return result.sort((a, b) => a.month - b.month);
}

/** 채널(광고비 cost_lv2)별 월별 광고비 + 해당 월 전체 매출 */
export interface AdSalesByChannelItem {
  channel: string;
  data: AdSalesDataPoint[];
}

export function getAdSalesByChannel(
  bizUnit: BizUnit,
  year: number,
  yearType: 'actual' | 'plan' = 'actual'
): AdSalesByChannelItem[] {
  const monthlyTrend = getMonthlyTrend(bizUnit, year, "monthly", yearType);
  const prevYearTrend = getMonthlyTrend(bizUnit, year - 1, "monthly", yearType);
  const prevYearMap = new Map(prevYearTrend.map((item) => [item.month, item]));

  const channelMonths = new Map<string, Map<number, { adSpend: number; sales: number; salesPrevYear: number | null }>>();

  for (const mt of monthlyTrend) {
    const details = getCategoryDetail(bizUnit, year, mt.month, "광고비", "monthly", yearType);
    const byLv2 = new Map<string, number>();
    for (const d of details) {
      const key = (d.cost_lv2 || "").trim() || "기타";
      byLv2.set(key, (byLv2.get(key) ?? 0) + d.amount);
    }
    const prev = prevYearMap.get(mt.month);
    for (const [channel, adSpend] of byLv2) {
      if (adSpend <= 0 || mt.sales <= 0) continue;
      if (!channelMonths.has(channel)) {
        channelMonths.set(channel, new Map());
      }
      channelMonths.get(channel)!.set(mt.month, {
        adSpend,
        sales: mt.sales,
        salesPrevYear: prev?.sales ?? null,
      });
    }
  }  const result: AdSalesByChannelItem[] = [];
  for (const [channel, monthMap] of channelMonths) {
    const data: AdSalesDataPoint[] = [];
    for (const [month, v] of monthMap) {
      const prev = prevYearMap.get(month);
      let adSpendPrevYear: number | null = null;
      if (prev) {
        const prevDetails = getCategoryDetail(bizUnit, year - 1, month, "광고비", "monthly", yearType);
        const prevAd = prevDetails.find((d) => ((d.cost_lv2 || "").trim() || "기타") === channel);
        adSpendPrevYear = prevAd?.amount ?? null;
      }
      data.push({
        month,
        yyyymm: `${year}${String(month).padStart(2, "0")}`,
        adSpend: v.adSpend,
        sales: v.sales,
        adSpendPrevYear,
        salesPrevYear: v.salesPrevYear,
      });
    }
    data.sort((a, b) => a.month - b.month);
    if (data.length >= 3) {
      result.push({ channel, data });
    }
  }
  return result.sort((a, b) => a.channel.localeCompare(b.channel));
}
