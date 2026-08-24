"use client";

import { LucideIcon } from "lucide-react";
import {
  formatK,
  formatM,
  formatPercent,
  calculateYOY,
} from "@/lib/utils";

import {
  getMonthlyTotal,
  getPreviousYearTotal,
  getMonthlyAggregatedByCategory,
  getCategoryDetail,
  calculateCostRatio,
  getAnnualHeadcountSum,
  getYTDHeadcountSum,
  getAnnualData,
  type BizUnit,
  type Mode,
} from "@/lib/expenseData";

import { BizUnitCard, type ExpenseDetail } from "./BizUnitCard";
import { useLanguage } from "@/contexts/LanguageContext";
import { t } from "@/lib/translations";

interface BrandCardProps {
  bizUnit: BizUnit;
  year: number;
  month: number;
  mode: Mode;
  brandColor: string;
  brandInitial: string;
  brandName: string;
  icon: LucideIcon;
  yearType?: 'actual' | 'plan';
  /** 헤더 브랜드명 자리를 사용자 정의 노드로 교체 (예: 드롭다운 셀렉터) */
  titleControl?: React.ReactNode;
}

/** 영업비 상세보기 표시 순서 */
const EXPENSE_DETAIL_ORDER = [
  "인건비",
  "복리후생비",
  "광고비",
  "수주회",
  "출장비",
  "지급수수료",
  "IT수수료",
  "감가상각비",
  "임차료",
  "세금과공과",
  "기타",
  "차량렌트비",
];

const CATEGORY_DISPLAY_NAME: Record<string, string> = {
  광고비: "광고비",
  인건비: "인건비",
  복리후생비: "복리후생비",
  수주회: "수주회",
  지급수수료: "지급수수료",
  출장비: "출장비",
  감가상각비: "감가상각비",
  IT수수료: "IT수수료",
  임차료: "임차료",
  세금과공과: "세금과공과",
  기타: "기타",
  차량렌트비: "차량렌트비",
};

function getCategoryDisplayName(categoryName: string): string {
  return CATEGORY_DISPLAY_NAME[categoryName] || categoryName;
}

export function BrandCard({
  bizUnit,
  year,
  month,
  mode,
  brandColor,
  brandInitial,
  brandName,
  icon: Icon,
  yearType = 'actual',
  titleControl,
}: BrandCardProps) {
  const { lang } = useLanguage();
  const isPlanYear = year === 2026 && yearType === 'plan';
  
  // 2026년(예산): 연간 데이터 사용
  const annualData = isPlanYear ? getAnnualData(bizUnit, year, "", "", "", yearType) : [];
  const annualSum = annualData.reduce((s, i) => s + i.annual_amount, 0);
  
  // 2026년(예산): 12월 기말 인원수 및 연간 매출 합계 계산
  const annualHeadcount = isPlanYear 
    ? (getMonthlyTotal(bizUnit, year, 12, "monthly", yearType)?.headcount || 0)
    : 0;
  const annualSales = isPlanYear ? (() => {
    let sum = 0;
    for (let m = 1; m <= 12; m++) {
      const monthData = getMonthlyTotal(bizUnit, year, m, "monthly", yearType);
      sum += monthData?.sales || 0;
    }
    return sum;
  })() : 0;
  
  const current = isPlanYear 
    ? { 
        biz_unit: bizUnit,
        year,
        month: 12,
        yyyymm: `${year}12`,
        amount: annualSum,
        headcount: annualHeadcount,
        sales: annualSales,
      }
    : getMonthlyTotal(bizUnit, year, month, mode, yearType);
  
  // 전년도는 2025년 12월 YTD (2026 예산의 경우)
  const previous = isPlanYear
    ? getMonthlyTotal(bizUnit, 2025, 12, "ytd", 'actual')
    : getPreviousYearTotal(bizUnit, year, month, mode, yearType);

  const isCommon = bizUnit === "공통";
  const isCorporate = bizUnit === "법인";

  // 공통 카드: 전체 법인 매출 기준 YOY 및 매출대비%용
  const corporateTotal = isCommon ? getMonthlyTotal("법인", year, month, mode, yearType) : null;
  const prevCorporateTotal = isCommon ? getPreviousYearTotal("법인", year, month, mode, yearType) : null;

  // 대분류별 데이터
  const categoryData = getMonthlyAggregatedByCategory(bizUnit, year, month, mode, yearType);
  const categoryMap = new Map(categoryData.map((item) => [item.cost_lv1, item]));

  // 총비용
  const totalCost = categoryData.reduce((sum, item) => sum + item.amount, 0);

  // 전년도 (2026 예산이면 2025년 12월 YTD)
  const prevCategoryData = isPlanYear
    ? getMonthlyAggregatedByCategory(bizUnit, 2025, 12, "ytd", 'actual')
    : getMonthlyAggregatedByCategory(bizUnit, year - 1, month, mode, yearType);
  const prevCategoryMap = new Map(
    prevCategoryData.map((item) => [item.cost_lv1, item])
  );

  // 연간 계획 (YTD 뷰용) — 2026년 plan × 12월 YTD 기준
  const annualPlanData = yearType === 'actual'
    ? getMonthlyAggregatedByCategory(bizUnit, year, 12, "ytd", "plan")
    : [];
  const annualPlanMap = new Map(annualPlanData.map((item) => [item.cost_lv1, item.amount]));

  const prevTotalCost = prevCategoryData.reduce(
    (sum, item) => sum + item.amount,
    0
  );

  // YOY
  const totalCostYOY = calculateYOY(totalCost, prevTotalCost);
  const totalCostChange = totalCost - prevTotalCost;
  const totalExpenseChangeStr =
    totalCostChange === 0
      ? "0K"
      : totalCostChange > 0
        ? `+${formatK(totalCostChange)}`
        : formatK(totalCostChange);

  // 매출 (법인은 4개 사업부 합산 매출 있음)
  const sales = current?.sales ?? 0;
  const prevSales = previous?.sales ?? 0;
  const salesYOY = calculateYOY(sales, prevSales);
  // 공통: 전체 법인 매출 YOY 표시
  const corporateSalesYOY =
    isCommon && corporateTotal != null && prevCorporateTotal != null
      ? calculateYOY(corporateTotal.sales ?? 0, prevCorporateTotal.sales ?? 0)
      : null;

  // 비용율 계산 (법인: 법인 매출 기준, 공통: 전체 법인 매출 기준)
  const costRatio = isCorporate
    ? calculateCostRatio(totalCost, sales)
    : isCommon
      ? calculateCostRatio(totalCost, corporateTotal?.sales ?? 0)
      : calculateCostRatio(totalCost, sales);

  // 이전 비용율은 “아직 사용하지 않으므로 제거”
  // const prevCostRatio = ...

  // 실적: 기말 = 당월말. 예산: 기존(current = 12월 기말 등) 유지
  const headcount = isPlanYear
    ? (current?.headcount ?? 0)
    : (getMonthlyTotal(bizUnit, year, month, "monthly", yearType)?.headcount ?? 0);
  const prevHeadcount = isPlanYear
    ? (getMonthlyTotal(bizUnit, 2025, 12, "monthly", 'actual')?.headcount ?? 0)
    : (getMonthlyTotal(bizUnit, year - 1, month, "monthly", yearType)?.headcount ?? 0);
  // 인원수는 소수점 시 올림(인원 쪼갤 수 없음)
  const headcountCeil = Math.ceil(headcount);
  const prevHeadcountCeil = Math.ceil(prevHeadcount);
  const headcountDiff = headcountCeil - prevHeadcountCeil;
  const headcountUnit = t("명", lang);
  const headcountChangeStr =
    headcountCeil > 0 || prevHeadcountCeil > 0
      ? headcountDiff === 0
        ? `0${headcountUnit}`
        : headcountDiff > 0
          ? `+${headcountDiff}${headcountUnit}`
          : `${headcountDiff}${headcountUnit}`
      : null;

  // 평균 인원수: 예산 = 연합계/12, 실적 = 누적/누적월
  const annualSumCurr = getAnnualHeadcountSum(bizUnit, year, yearType);
  const annualSumPrev = getAnnualHeadcountSum(bizUnit, isPlanYear ? 2025 : year - 1, isPlanYear ? 'actual' : yearType);
  const avgHeadcountNum = isPlanYear
    ? Math.ceil(annualSumCurr / 12)
    : (month > 0 ? Math.ceil(getYTDHeadcountSum(bizUnit, year, month, yearType) / month) : 0);
  const prevAvgHeadcountNum = isPlanYear
    ? Math.ceil(annualSumPrev / 12)
    : (month > 0 ? Math.ceil(getYTDHeadcountSum(bizUnit, year - 1, month, yearType) / month) : 0);
  const avgHeadcountDiff = avgHeadcountNum - prevAvgHeadcountNum;
  const avgHeadcountChangeStr =
    avgHeadcountNum > 0 || prevAvgHeadcountNum > 0
      ? avgHeadcountDiff === 0
        ? `0${headcountUnit}`
        : avgHeadcountDiff > 0
          ? `+${avgHeadcountDiff}${headcountUnit}`
          : `${avgHeadcountDiff}${headcountUnit}`
      : null;
  const avgHeadcountStr = avgHeadcountNum > 0 ? `${avgHeadcountNum.toLocaleString("ko-KR")}${headcountUnit}` : null;

  // 인건비(기본급만), 복리후생비(5대보험+공적금만) 금액 추출 (인당 비용 계산용)
  // 인건비는 중분류 "기본급"만 사용 (성과급, 잡급 제외)
  const laborDetails = getCategoryDetail(bizUnit, year, month, "인건비", mode, yearType);
  const basicSalary = laborDetails
    .filter((item) => item.cost_lv2 === "기본급")
    .reduce((sum, item) => sum + (item.amount ?? 0), 0);
  
  // 전년도 인건비 (2026년 예산이면 2025년 12월 YTD actual)
  const prevYear = isPlanYear ? 2025 : year - 1;
  const prevMonth = isPlanYear ? 12 : month;
  const prevMode = isPlanYear ? "ytd" : mode;
  const prevYearType = isPlanYear ? 'actual' : yearType;
  
  const prevLaborDetails = getCategoryDetail(bizUnit, prevYear, prevMonth, "인건비", prevMode, prevYearType);
  const prevBasicSalary = prevLaborDetails
    .filter((item) => item.cost_lv2 === "기본급")
    .reduce((sum, item) => sum + (item.amount ?? 0), 0);
  
  // 복리후생비는 중분류 "5대보험" + "공적금"만 사용 (인당 비용 계산용)
  const welfareDetails = getCategoryDetail(bizUnit, year, month, "복리후생비", mode, yearType);
  const welfare5InsuranceAndFund = welfareDetails
    .filter((item) => item.cost_lv2 === "5대보험" || item.cost_lv2 === "공적금")
    .reduce((sum, item) => sum + (item.amount ?? 0), 0);
  
  // 전년도 5대보험 + 공적금
  const prevWelfareDetails = getCategoryDetail(bizUnit, prevYear, prevMonth, "복리후생비", prevMode, prevYearType);
  const prevWelfare5InsuranceAndFund = prevWelfareDetails
    .filter((item) => item.cost_lv2 === "5대보험" || item.cost_lv2 === "공적금")
    .reduce((sum, item) => sum + (item.amount ?? 0), 0);
  
  const laborCost = basicSalary;  // 기본급만 사용
  const welfareCost = welfare5InsuranceAndFund;  // 5대보험 + 공적금만 사용

  // 인당 비용 계산
  // 예산: 연간 인원수 합계. 실적 당월: 당월 인원수. 실적 YTD: 1~선택월 누적 인원수
  const annualHeadcountSum = isPlanYear
    ? getAnnualHeadcountSum(bizUnit, year, yearType)
    : mode === "ytd"
      ? getYTDHeadcountSum(bizUnit, year, month, yearType)
      : 0;
  const prevAnnualHeadcountSum = isPlanYear
    ? getAnnualHeadcountSum(bizUnit, prevYear, prevYearType)
    : mode === "ytd"
      ? getYTDHeadcountSum(bizUnit, prevYear, prevMonth, prevYearType)
      : 0;
  const denom = mode === "ytd" || isPlanYear ? annualHeadcountSum : headcount;
  const prevDenom = mode === "ytd" || isPlanYear ? prevAnnualHeadcountSum : prevHeadcount;
  const perPersonLaborCost = denom > 0 ? laborCost / denom : null;
  const perPersonWelfareCost = denom > 0 ? welfareCost / denom : null;
  const prevPerPersonLaborCost = prevDenom > 0 ? prevBasicSalary / prevDenom : null;
  const prevPerPersonWelfareCost = prevDenom > 0 ? prevWelfare5InsuranceAndFund / prevDenom : null;
  
  // 인당 비용 YOY 계산
  const perPersonLaborCostYOY = calculateYOY(perPersonLaborCost ?? 0, prevPerPersonLaborCost ?? 0);
  const perPersonWelfareCostYOY = calculateYOY(perPersonWelfareCost ?? 0, prevPerPersonWelfareCost ?? 0);

  // 상세 카테고리 데이터 (순서: EXPENSE_DETAIL_ORDER)
  const expenseDetails: ExpenseDetail[] = (isCommon || isCorporate)
    ? EXPENSE_DETAIL_ORDER.filter((name) => categoryMap.has(name))
        .map((categoryName) => {
          const cat = categoryMap.get(categoryName)!;
          const prev = prevCategoryMap.get(categoryName);
          const currentAmount = cat?.amount ?? 0;
          const prevAmount = prev?.amount ?? 0;
          const amountDiff = currentAmount - prevAmount;
          const yoy = calculateYOY(currentAmount, prevAmount);
          const annualPlan = annualPlanMap.get(categoryName) ?? 0;
          const usagePct = annualPlan > 0 ? (currentAmount / annualPlan) * 100 : null;
          return {
            label: categoryName,
            labelCn: cat.cost_lv1_cn,
            amount: formatK(cat.amount),
            amountDiff,
            yoy,
            prevAmount,
            annualPlan: annualPlan > 0 ? annualPlan : undefined,
            usagePct,
          };
        })
    : EXPENSE_DETAIL_ORDER.filter((categoryName) => {
        const amount = categoryMap.get(categoryName)?.amount ?? 0;
        return amount > 0; // 브랜드 카드: 연간(또는 당월) 0인 항목은 미표시
      }).map((categoryName) => {
        const cat = categoryMap.get(categoryName);
        const prev = prevCategoryMap.get(categoryName);
        const currentAmount = cat?.amount ?? 0;
        const prevAmount = prev?.amount ?? 0;
        const amountDiff = currentAmount - prevAmount;
        const yoy = calculateYOY(currentAmount, prevAmount);
        const annualPlan = annualPlanMap.get(categoryName) ?? 0;
        const usagePct = annualPlan > 0 ? (currentAmount / annualPlan) * 100 : null;
        return {
          label: getCategoryDisplayName(categoryName),
          labelCn: cat?.cost_lv1_cn,
          amount: formatK(currentAmount),
          amountDiff,
          yoy,
          prevAmount,
          annualPlan: annualPlan > 0 ? annualPlan : undefined,
          usagePct,
        };
      });

  return (
    <BizUnitCard
      businessUnit={bizUnit}
      icon={<Icon className="w-5 h-5" />}
      yoySales={isCommon ? corporateSalesYOY : salesYOY}
      yoyExpense={totalCostYOY}
      totalExpense={formatK(totalCost)}
      totalExpenseChange={totalExpenseChangeStr}
      ratio={costRatio != null ? formatPercent(costRatio) : null}
      headcount={headcountCeil > 0 ? `${headcountCeil.toLocaleString("ko-KR")}${headcountUnit}` : null}
      headcountChange={headcountChangeStr}
      avgHeadcount={avgHeadcountStr}
      avgHeadcountChange={avgHeadcountChangeStr}
      salesAmount={
        isCorporate
          ? (sales > 0 ? formatM(sales, 0) : null)
          : isCommon
            ? (corporateTotal && (corporateTotal.sales ?? 0) > 0 ? formatM(corporateTotal.sales!, 0) : null)
            : (sales > 0 ? formatM(sales, 0) : null)
      }
      perPersonLaborCost={perPersonLaborCost != null ? formatK(perPersonLaborCost, 1) : null}
      perPersonWelfareCost={perPersonWelfareCost != null ? formatK(perPersonWelfareCost, 1) : null}
      perPersonLaborCostYOY={perPersonLaborCostYOY != null ? formatPercent(perPersonLaborCostYOY, 0) : null}
      perPersonWelfareCostYOY={perPersonWelfareCostYOY != null ? formatPercent(perPersonWelfareCostYOY, 0) : null}
      expenseDetails={expenseDetails}
      year={year}
      month={month}
      mode={mode}
      yearType={yearType}
      isCommon={isCommon}
      titleControl={titleControl}
    />
  );
}

