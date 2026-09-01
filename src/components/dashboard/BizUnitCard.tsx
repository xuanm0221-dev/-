"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, ArrowDown, Plus, Minus, Pencil } from "lucide-react";
import { formatPercent, formatK } from "@/lib/utils";
import { getCategoryDetail, getMonthlyTotal, getAggregatedData, type BizUnit, type Mode } from "@/lib/expenseData";
import { useLanguage } from "@/contexts/LanguageContext";
import { useBudgetAdjustments } from "@/contexts/BudgetAdjustmentContext";
import {
  adjustmentDetailByLv1,
  adjustmentLv2Label,
  adjustmentNote,
  type BudgetAdjustment,
} from "@/lib/budgetAdjustments";
import { autoCnLabel } from "@/lib/accountLabels";
import { t, getDisplayLabel } from "@/lib/translations";
import React, { Fragment, useEffect, useState } from "react";

// 사업부별 테마 설정
// 헤더는 그라데이션 없이 단색. 법인은 git 참고 네이비 (#001f3f).
const THEME = {
  법인: {
    headerBg: "bg-[#1e3a8a]",
    primaryColor: "text-[#1e3a8a]",
    borderColor: "border-[#1e3a8a]",
    buttonColor: "#1e3a8a",
    accentColor: "bg-[#1e3a8a]",
    cellBg: "bg-slate-100/60",
  },
  MLB: {
    headerBg: "bg-blue-600",
    primaryColor: "text-blue-600",
    borderColor: "border-blue-600",
    buttonColor: "#2563eb",
    accentColor: "bg-blue-600",
    cellBg: "bg-blue-100/40",
  },
  KIDS: {
    headerBg: "bg-yellow-500",
    primaryColor: "text-yellow-600",
    borderColor: "border-yellow-500",
    buttonColor: "#eab308",
    accentColor: "bg-yellow-500",
    cellBg: "bg-yellow-100/50",
  },
  DISCOVERY: {
    headerBg: "bg-green-600",
    primaryColor: "text-green-600",
    borderColor: "border-green-600",
    buttonColor: "#16a34a",
    accentColor: "bg-green-600",
    cellBg: "bg-green-100/40",
  },
  COMMON: {
    headerBg: "bg-slate-700",
    primaryColor: "text-slate-700",
    borderColor: "border-slate-700",
    buttonColor: "#334155",
    accentColor: "bg-slate-700",
    cellBg: "bg-slate-100/60",
  },
} as const;

export interface ExpenseDetail {
  label: string;
  labelCn?: string; // 대분류 중국어 (CSV 대분류(중국어))
  amount: string;
  amountDiff: number; // 전년 대비 금액 증감 (당년 - 전년)
  yoy: number | null; // YOY (%)
  /** 전년 동기 금액 (원 단위 raw) — YTD/분기/당월 모두 표기용 */
  prevAmount?: number;
  /** 연간 계획 (원 단위 raw) — YTD 모드에서만 표시 */
  annualPlan?: number;
  /** YTD 시점 계획 (해당 월까지 계획 누적) — YTD 모드에서만 표시 */
  planYtd?: number;
  /** 진척률 (0~100+, 당년 실적 / 연간 계획 × 100) — YTD 모드에서만 표시 */
  usagePct?: number | null;
}

export interface BizUnitCardProps {
  businessUnit: BizUnit;
  icon: React.ReactNode; // LucideIcon 또는 emoji 등
  yoySales: number | null; // 판매매출 YOY (%)
  yoyExpense: number | null; // 영업비 YOY (%)
  totalExpense: string; // 총비용 (예: "19,393K")
  totalExpenseChange?: string | null; // 전년비 증가액 (예: "+25,078K", "-10,000K")
  ratio: string | null; // 영업비율 (예: "2.2%")
  headcount: string | null; // 인원수 (예: "199명")
  headcountChange: string | null; // 전년비 증감 (예: "-2명", "+3명")
  avgHeadcount?: string | null; // 평균 인원수 (연합계/12, 예: "250명")
  avgHeadcountChange?: string | null; // 평균 인원 전년비 증감 (예: "+3명")
  salesAmount: string | null; // 판매매출 (예: "896,299K")
  perPersonLaborCost: string | null; // 인당 인건비 (예: "30.5K")
  perPersonWelfareCost: string | null; // 인당 복리후생비 (예: "8.5K")
  perPersonLaborCostYOY: string | null; // 인당 인건비 YOY (예: "105%")
  perPersonWelfareCostYOY: string | null; // 인당 복리후생비 YOY (예: "98%")
  expenseDetails: ExpenseDetail[];
  year: number;
  month: number;
  mode: Mode;
  yearType?: 'actual' | 'plan';
  isCommon?: boolean;
  /** 헤더 브랜드명 자리를 사용자 정의 노드로 교체 (예: 드롭다운 셀렉터). 없으면 기본 텍스트 렌더 */
  titleControl?: React.ReactNode;
}

export function BizUnitCard({
  businessUnit,
  icon,
  yoySales,
  yoyExpense,
  totalExpense,
  totalExpenseChange = null,
  ratio,
  headcount,
  headcountChange = null,
  avgHeadcount = null,
  avgHeadcountChange = null,
  salesAmount,
  perPersonLaborCost,
  perPersonWelfareCost,
  perPersonLaborCostYOY,
  perPersonWelfareCostYOY,
  expenseDetails,
  year,
  month,
  mode,
  yearType = 'actual',
  isCommon = false,
  titleControl,
}: BizUnitCardProps) {
  const { lang } = useLanguage();
  const { adjustments, applyAdjustments } = useBudgetAdjustments();
  const isCorporate = businessUnit === "법인";
  // 예산 수기조정 — "조정 후" 뷰일 때만. 연간계획 가산은 BrandCard 에서 이미 반영됐고,
  // 여기서는 어느 대분류가 조정됐는지 표시(배지 + 펼침 시 '수기조정' 행)만 담당한다.
  const adjByLv1 = applyAdjustments && yearType === "actual"
    ? adjustmentDetailByLv1(adjustments, year, businessUnit)
    : new Map<string, BudgetAdjustment[]>();
  const adjDelta = (lv1: string) => (adjByLv1.get(lv1) ?? []).reduce((s2, a) => s2 + a.amount, 0);
  const adjTitle = (lv1: string) => {
    const rows = adjByLv1.get(lv1) ?? [];
    if (rows.length === 0) return undefined;
    return rows
      .map((a) => {
        const who = a.lv2 ? `${adjustmentLv2Label(a, lang, autoCnLabel)} ` : "";
        const memo = adjustmentNote(a, lang);
        return `${who}${a.amount >= 0 ? "+" : ""}${formatK(a.amount)}${memo ? ` · ${memo}` : ""}`;
      })
      .join(String.fromCharCode(10));
  };
  const adjTotal = Array.from(adjByLv1.values()).flat().reduce((s2, a) => s2 + a.amount, 0);
  const themeKey = isCommon ? "COMMON" : isCorporate ? "법인" : (businessUnit as keyof typeof THEME);
  const theme = THEME[themeKey] || THEME.COMMON;
  const detailMode = yearType === "actual" ? "ytd" : mode;

  // 대분류(lv1)/중분류(lv2) 펼침 상태 (계층 키: `lv1` 또는 `lv1|lv2`)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  useEffect(() => { setExpandedKeys(new Set()); }, [businessUnit, year, month, mode, yearType]);
  const toggle = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const isExpanded = (key: string) => expandedKeys.has(key);

  // 법인 뷰에서 광고비/출장비는 브랜드(biz_unit)를 lv2로 먼저 그룹핑
  const BRAND_FIRST_LV1 = new Set(["광고비", "출장비"]);

  // 특정 lv1의 하위 lv2 그룹핑 (annualPlan 포함)
  const getLv2Rows = (lv1: string) => {
    // 광고비/출장비 & 법인 뷰: lv2 = biz_unit
    const brandFirst = isCorporate && BRAND_FIRST_LV1.has(lv1);
    const curr = getCategoryDetail(businessUnit, year, month, lv1, mode, yearType);
    const prev = getCategoryDetail(businessUnit, year - 1, month, lv1, mode, "actual");
    const plan = getCategoryDetail(businessUnit, year, 12, lv1, "ytd", "plan");
    const planYtdRaw = getCategoryDetail(businessUnit, year, month, lv1, "ytd", "plan");
    const keyFn = (d: { biz_unit?: string; cost_lv2?: string }) => brandFirst ? (d.biz_unit || "-") : (d.cost_lv2 || "-");
    const labelCnFn = (d: { biz_unit_cn?: string; cost_lv2_cn?: string }) => brandFirst ? d.biz_unit_cn : d.cost_lv2_cn;

    // 라벨(중국어)은 실적 → 계획 순으로 먼저 잡히는 값을 사용 (계획만 있는 행도 라벨이 필요)
    const labelCnMap = new Map<string, string | undefined>();
    const currMap = new Map<string, number>();
    for (const d of curr) {
      const key = keyFn(d);
      currMap.set(key, (currMap.get(key) ?? 0) + (d.amount || 0));
      if (!labelCnMap.get(key)) labelCnMap.set(key, labelCnFn(d));
    }
    const prevMap = new Map<string, number>();
    for (const d of prev) {
      const key = keyFn(d);
      prevMap.set(key, (prevMap.get(key) ?? 0) + (d.amount || 0));
    }
    const planMap = new Map<string, number>();
    for (const d of plan) {
      const key = keyFn(d);
      planMap.set(key, (planMap.get(key) ?? 0) + (d.amount || 0));
      if (!labelCnMap.get(key)) labelCnMap.set(key, labelCnFn(d));
    }
    const planYtdMap = new Map<string, number>();
    for (const d of planYtdRaw) {
      const key = keyFn(d);
      planYtdMap.set(key, (planYtdMap.get(key) ?? 0) + (d.amount || 0));
    }
    // 실적 있는 행 ∪ 계획 있는 행 — 계획만 있고 실적 0인 행이 빠지면 하위 합이 대분류 소계와 어긋난다
    const keys = new Set<string>([...Array.from(currMap.keys()), ...Array.from(planMap.keys())]);
    return Array.from(keys)
      .map((lv2) => {
        const amount = currMap.get(lv2) ?? 0;
        const p = prevMap.get(lv2) ?? 0;
        const ap = planMap.get(lv2) ?? 0;
        const py = planYtdMap.get(lv2) ?? 0;
        return {
          label: lv2,
          labelCn: labelCnMap.get(lv2),
          amount,
          prevAmount: p,
          amountDiff: amount - p,
          yoy: p > 0 ? (amount / p) * 100 : null,
          // 계획 0도 undefined 로 지우지 않는다 — 지우면 잔여예산이 '-'가 되어 소계에서 조용히 빠진다
          annualPlan: ap,
          planYtd: py,
          usagePct: ap > 0 ? (amount / ap) * 100 : null,
        };
      })
      .filter((r) => Math.abs(r.amount) > 0 || r.annualPlan > 0)
      .sort((a, b) => b.amount - a.amount);
  };

  // 특정 lv1+lv2의 하위 lv3 그룹핑 (annualPlan 포함)
  // 광고비/출장비 & 법인 뷰: lv2가 biz_unit이므로 lv3 = cost_lv2 로 필터
  const getLv3Rows = (lv1: string, lv2: string) => {
    const brandFirst = isCorporate && BRAND_FIRST_LV1.has(lv1);
    const filter = brandFirst
      ? (d: { biz_unit?: string }) => (d.biz_unit || "-") === lv2
      : (d: { cost_lv2?: string }) => (d.cost_lv2 || "-") === lv2;
    const groupKey = brandFirst
      ? (d: { cost_lv2?: string }) => (d.cost_lv2 || "-")
      : (d: { cost_lv3?: string }) => (d.cost_lv3 || "-");
    const labelCnFn = brandFirst
      ? (d: { cost_lv2_cn?: string }) => d.cost_lv2_cn
      : (d: { cost_lv3_cn?: string }) => d.cost_lv3_cn;

    const curr = getCategoryDetail(businessUnit, year, month, lv1, mode, yearType).filter(filter);
    const prev = getCategoryDetail(businessUnit, year - 1, month, lv1, mode, "actual").filter(filter);
    const plan = getCategoryDetail(businessUnit, year, 12, lv1, "ytd", "plan").filter(filter);
    const planYtdRaw = getCategoryDetail(businessUnit, year, month, lv1, "ytd", "plan").filter(filter);

    const labelCnMap = new Map<string, string | undefined>();
    const currMap = new Map<string, number>();
    for (const d of curr) {
      const key = groupKey(d);
      currMap.set(key, (currMap.get(key) ?? 0) + (d.amount || 0));
      if (!labelCnMap.get(key)) labelCnMap.set(key, labelCnFn(d));
    }
    const prevMap = new Map<string, number>();
    for (const d of prev) {
      const key = groupKey(d);
      prevMap.set(key, (prevMap.get(key) ?? 0) + (d.amount || 0));
    }
    const planMap = new Map<string, number>();
    for (const d of plan) {
      const key = groupKey(d);
      planMap.set(key, (planMap.get(key) ?? 0) + (d.amount || 0));
      if (!labelCnMap.get(key)) labelCnMap.set(key, labelCnFn(d));
    }
    const planYtdMap = new Map<string, number>();
    for (const d of planYtdRaw) {
      const key = groupKey(d);
      planYtdMap.set(key, (planYtdMap.get(key) ?? 0) + (d.amount || 0));
    }
    // 실적 있는 행 ∪ 계획 있는 행 (getLv2Rows 와 동일 규칙)
    const keys = new Set<string>([...Array.from(currMap.keys()), ...Array.from(planMap.keys())]);
    return Array.from(keys)
      .map((lv3) => {
        const amount = currMap.get(lv3) ?? 0;
        const p = prevMap.get(lv3) ?? 0;
        const ap = planMap.get(lv3) ?? 0;
        const py = planYtdMap.get(lv3) ?? 0;
        return {
          label: lv3,
          labelCn: labelCnMap.get(lv3),
          amount,
          prevAmount: p,
          amountDiff: amount - p,
          yoy: p > 0 ? (amount / p) * 100 : null,
          annualPlan: ap,
          planYtd: py,
          usagePct: ap > 0 ? (amount / ap) * 100 : null,
        };
      })
      .filter((r) => (Math.abs(r.amount) > 0 || r.annualPlan > 0) && r.label !== "-")
      .sort((a, b) => b.amount - a.amount);
  };

  // 인당 계산용 headcount 합 (mode에 따라 단일 월 또는 분기/YTD 3~N개월 합)
  const getHeadcountSumForPeriod = (bu: BizUnit, yr: number, mo: number, md: Mode, yt: "actual" | "plan"): number => {
    if (md === "monthly") {
      return getMonthlyTotal(bu, yr, mo, "monthly", yt)?.headcount ?? 0;
    }
    // ytd or quarters: 범위 내 모든 월의 headcount 합산
    const ranges: Record<string, [number, number]> = {
      ytd: [1, mo],
      q1: [1, 3], q2: [4, 6], q3: [7, 9], q4: [10, 12],
    };
    const [start, end] = ranges[md] ?? [1, mo];
    let sum = 0;
    for (let m = start; m <= end; m++) {
      sum += getMonthlyTotal(bu, yr, m, "monthly", yt)?.headcount ?? 0;
    }
    return sum;
  };
  // 인건비 lv2에만 사용 — 미리 두 번(당년/전년) 계산해서 재사용
  const currHeadcountSum = getHeadcountSumForPeriod(businessUnit, year, month, mode, yearType);
  const prevHeadcountSum = getHeadcountSumForPeriod(businessUnit, year - 1, month, mode, "actual");

  // 임의 biz_unit(문자열, MLB/KIDS/공통/경영지원 등) 기준 headcount 합계 (lv3용)
  // monthly_total (MLB/KIDS/공통 등) 우선, 없으면 category_detail의 cost_lv3 headcount 합산 (경영지원 등)
  const getRawHeadcountSum = (buName: string, yr: number, yt: "actual" | "plan"): number => {
    const data = getAggregatedData();
    let startM: number, endM: number;
    if (mode === "monthly") { startM = endM = month; }
    else if (mode === "ytd") { startM = 1; endM = month; }
    else {
      const q = { q1: [1, 3], q2: [4, 6], q3: [7, 9], q4: [10, 12] } as const;
      [startM, endM] = q[mode as keyof typeof q];
    }
    // 1) monthly_total 기준
    const mtSum = data.monthly_total
      .filter((r) => r.biz_unit === buName && r.year === yr && (r.year_type ?? "actual") === yt && r.month >= startM && r.month <= endM)
      .reduce((s, r) => s + (r.headcount || 0), 0);
    if (mtSum > 0) return mtSum;
    // 2) fallback: category_detail의 cost_lv3=buName + 인건비 하위 headcount 합산 (경영지원 등)
    const cdSum = data.category_detail
      .filter((r) => r.cost_lv3 === buName && r.cost_lv1 === "인건비" && r.year === yr && (r.year_type ?? "actual") === yt && r.month >= startM && r.month <= endM)
      .reduce((s, r) => s + (r.headcount || 0), 0);
    return cdSum;
  };

  // 인당 계산 대상 lv2: 기본급, 성과급충당금만
  const PER_PERSON_LV2 = new Set(["기본급", "성과급충당금"]);

  // 진척률 컬러: 예상 pace(month/12) 기준 위/아래
  const usageColor = (v: number | null | undefined, expected: number | null) => {
    if (v == null || expected == null) return "text-gray-500";
    if (v > expected + 1) return "text-red-600";
    if (v < expected - 1) return "text-blue-600";
    return "text-gray-700";
  };

  const yoyClass = (y: number | null) => y == null ? "text-gray-500" : y >= 100 ? "text-red-600" : y === 0 ? "text-gray-500" : "text-blue-600";
  const diffClass = (d: number) => d >= 0 ? "text-red-600" : "text-blue-600";

  // 컬럼 폭: 대분류는 minmax — 텍스트 담을 만큼만, 남는 공간 흡수 방지.
  // 금액류는 실제 텍스트 길이 기준 px 고정 → 카드 폭과 무관하게 좌측 공백 최소.
  // YTD 모드에서만: 남은월 예산(66px) + 판정(64px) 2컬럼 추가
  const showAnnualColsTop = mode === "ytd";
  const gridStyle = {
    gridTemplateColumns: showAnnualColsTop
      ? "minmax(0,140px) 62px 62px 66px 38px 62px 54px 66px 66px 62px"
      : "minmax(0,158px) 72px 72px 76px 40px",
  };
  // 남은월 라벨: 8월~12월예산 (7월 기준)
  const remainingLabel = month < 12 ? `${month + 1}~12${t("월", lang)}${t("예산", lang)}` : `${t("예산", lang)}`;
  // 잔여예산 = 연간계획 − YTD 실적 (음수면 계획 초과)
  // 계획이 0이어도 실적이 있으면 '-' 가 아니라 −실적(초과)으로 표기한다.
  // '-' 로 비우면 그 실적은 상위 소계에만 반영되고 화면에서 사라져 소계가 안 맞는 것처럼 보인다.
  const budgetLeft = (annualPlan: number, currAmt: number) => {
    if (!(annualPlan > 0) && !(Math.abs(currAmt) > 0)) return <span className="text-gray-400">-</span>;
    const left = annualPlan - currAmt;
    return <span className={left < 0 ? "text-red-600" : ""}>{formatK(left)}</span>;
  };
  // 연간계획/잔여예산/남은월예산/판정 컬럼 계산 — 계획 0을 '없음'이 아니라 '영'으로 취급
  const budgetCells = (annualPlan: number, planYtd: number, currAmt: number) => {
    const has = annualPlan > 0 || Math.abs(currAmt) > 0;
    const rem = Math.max(0, annualPlan - planYtd); // 남은월 예산 (계획 0 → 0)
    const diff = currAmt + rem - annualPlan;       // 판정 = 예상 연간 − 연간계획
    return { has, rem, diff, isOver: diff > 0 };
  };
  // 2열(당년 금액) 헤더 라벨: 당월 / YTD / N분기 (예산 연도는 "연간")
  const amountColLabel =
    yearType === "plan" ? t("연간", lang)
    : mode === "ytd" ? "YTD"
    : mode === "monthly" ? t("당월", lang)
    : `${mode.slice(1)}${t("분기", lang)}`;

  return (
    <Card className="flex flex-col shadow-md hover:shadow-lg transition-shadow overflow-hidden rounded-lg">
      {/* 헤더 - 그라데이션 배경 */}
      <div className={`${theme.headerBg} px-3 py-2 text-white`}>
        {/* 상단: 아이콘 + 브랜드명 */}
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white">
            {typeof icon === "string" ? (
              <span className="text-sm sm:text-base">{icon}</span>
            ) : (
              <div className="w-5 h-5">{icon}</div>
            )}
          </div>
          {titleControl ? (
            <div className="flex-1 min-w-0">{titleControl}</div>
          ) : (
            <span className="text-sm sm:text-base font-bold">{t(businessUnit, lang)}</span>
          )}
        </div>

        {/* 하단: 3박스 — 컨텐츠 폭에 맞춰 자동 (전년대비가 가장 김) */}
        <div className="flex gap-2 items-stretch">
          {/* 총비용 박스 */}
          <div className="bg-white/20 backdrop-blur-sm rounded-md px-2.5 py-1 border border-white/30 flex-none whitespace-nowrap">
            <div className="text-[10.5px] text-white/90 mb-0.5">{t("총비용", lang)}</div>
            <div className="text-[15px] font-bold text-white leading-tight">{totalExpense}</div>
          </div>
          {/* 전년대비 박스 (금액 + YoY%) — 가장 김, 남는 폭 흡수 */}
          <div className="bg-white/20 backdrop-blur-sm rounded-md px-2.5 py-1 border border-white/30 flex-1 min-w-0 whitespace-nowrap">
            <div className="text-[10.5px] text-white/90 mb-0.5">{t("전년대비", lang)}</div>
            <div className="text-[15px] font-bold text-white leading-tight">
              {totalExpenseChange ?? "-"}
              {yoyExpense != null && (
                <span className="ml-1 text-[13px] font-semibold">({formatPercent(yoyExpense, 0)})</span>
              )}
            </div>
          </div>
          {/* 리테일 YoY 박스 */}
          {yoySales !== null && (
            <div className="bg-white/20 backdrop-blur-sm rounded-md px-2.5 py-1 border border-white/30 flex-none whitespace-nowrap">
              <div className="text-[10.5px] text-white/90 mb-0.5">{t("리테일 YoY", lang)}</div>
              <div className="flex items-center gap-1">
                {yoySales >= 100 ? (
                  <TrendingUp className="w-4 h-4 text-white" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-white" />
                )}
                <span className="text-[15px] font-bold text-white leading-tight">
                  {formatPercent(yoySales, 0)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <CardContent className="flex-1 flex flex-col p-3 bg-white">
        {/* 주요 KPI (총비용은 헤더 박스로 이동, 여기선 브랜드일 때만 3-그리드 표시) */}
        <div className="mb-2">

          {!isCommon && !isCorporate && (
            <>
              <div className="grid grid-cols-[1fr_2fr_1fr] gap-2">
                {/* 영업비율 */}
                {ratio !== null && (
                  <div className="bg-gray-50 rounded-lg px-2.5 py-1.5 border border-gray-200 flex flex-col justify-between">
                    <div className="text-[11.4px] sm:text-[13.2px] font-semibold text-blue-600 break-words">{ratio}</div>
                    <div className="text-[11.4px] sm:text-[13.2px] text-gray-500 break-words">{t("영업비율", lang)}</div>
                  </div>
                )}

                {/* 인원수 */}
                {headcount !== null && (
                  <div className="bg-gray-50 rounded-lg px-2.5 py-1.5 border border-gray-200 flex flex-col justify-between">
                    <div className="text-[11.4px] sm:text-[13.2px] font-semibold text-purple-600 break-words">
                      {t("기말", lang)}: {headcount}{headcountChange != null ? ` (${headcountChange})` : ""}
                    </div>
                    <div className="text-[11.4px] sm:text-[13.2px] text-gray-500 break-words">
                      {avgHeadcount != null
                        ? `${t("평균", lang)}: ${avgHeadcount}${avgHeadcountChange != null ? ` (${avgHeadcountChange})` : ""}`
                        : " "}
                    </div>
                  </div>
                )}

                {/* 판매매출 */}
                {salesAmount !== null && (
                  <div className="bg-gray-50 rounded-lg px-2.5 py-1.5 border border-gray-200 flex flex-col justify-between">
                    <div className="text-[11.4px] sm:text-[13.2px] font-semibold text-teal-600 break-words">{salesAmount}</div>
                    <div className="text-[11.4px] sm:text-[13.2px] text-gray-500 break-words">{t("판매매출", lang)}</div>
                  </div>
                )}
              </div>
              {/* 인당 인건비/복리후생비 — 중앙 정렬 */}
              {(perPersonLaborCost || perPersonWelfareCost) && (
                <div className="mt-1.5 flex items-center justify-center gap-4 text-[11.4px] sm:text-[13.2px] font-normal">
                  {perPersonLaborCost && (
                    <span>
                      <span className="text-gray-500">{t("인당 기본급", lang)}</span>{" "}
                      <span className="text-orange-600">{perPersonLaborCost}</span>
                      {perPersonLaborCostYOY && (
                        <span className="text-gray-400 ml-1">({perPersonLaborCostYOY})</span>
                      )}
                    </span>
                  )}
                  {perPersonLaborCost && perPersonWelfareCost && (
                    <span className="text-gray-300">|</span>
                  )}
                  {perPersonWelfareCost && (
                    <span>
                      <span className="text-gray-500">{t("인당복후비", lang)}</span>{" "}
                      <span className="text-pink-600">{perPersonWelfareCost}</span>
                      {perPersonWelfareCostYOY && (
                        <span className="text-gray-400 ml-1">({perPersonWelfareCostYOY})</span>
                      )}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
          {/* 공통 및 법인 카드: 브랜드와 동일 3칸 그리드 (영업비율 | 인원수 | 판매매출) */}
          {(isCommon || isCorporate) && (
            <>
              <div className="grid grid-cols-[1fr_2fr_1fr] gap-2">
                {ratio !== null && (
                  <div className="bg-gray-50 rounded-lg px-2.5 py-1.5 border border-gray-200 flex flex-col justify-between">
                    <div className="text-[11.4px] sm:text-[13.2px] font-semibold text-blue-600 break-words">{ratio}</div>
                    <div className="text-[11.4px] sm:text-[13.2px] text-gray-500 break-words">{t("영업비율", lang)}</div>
                  </div>
                )}
                {headcount !== null && (
                  <div className="bg-gray-50 rounded-lg px-2.5 py-1.5 border border-gray-200 flex flex-col justify-between">
                    <div className="text-[11.4px] sm:text-[13.2px] font-semibold text-purple-600 break-words">
                      {t("기말", lang)}: {headcount}{headcountChange != null ? ` (${headcountChange})` : ""}
                    </div>
                    <div className="text-[11.4px] sm:text-[13.2px] text-gray-500 break-words">
                      {avgHeadcount != null
                        ? `${t("평균", lang)}: ${avgHeadcount}${avgHeadcountChange != null ? ` (${avgHeadcountChange})` : ""}`
                        : " "}
                    </div>
                  </div>
                )}
                {salesAmount !== null && (
                  <div className="bg-gray-50 rounded-lg px-2.5 py-1.5 border border-gray-200 flex flex-col justify-between">
                    <div className="text-[11.4px] sm:text-[13.2px] font-semibold text-teal-600 break-words">{salesAmount}</div>
                    <div className="text-[11.4px] sm:text-[13.2px] text-gray-500 break-words">{t("판매매출", lang)}</div>
                  </div>
                )}
              </div>
              {/* 인당 인건비/복리후생비 — 중앙 정렬 */}
              {(perPersonLaborCost || perPersonWelfareCost) && (
                <div className="mt-1.5 flex items-center justify-center gap-4 text-[11.4px] sm:text-[13.2px] font-normal">
                  {perPersonLaborCost && (
                    <span>
                      <span className="text-gray-500">{t("인당 기본급", lang)}</span>{" "}
                      <span className="text-orange-600">{perPersonLaborCost}</span>
                      {perPersonLaborCostYOY && (
                        <span className="text-gray-400 ml-1">({perPersonLaborCostYOY})</span>
                      )}
                    </span>
                  )}
                  {perPersonLaborCost && perPersonWelfareCost && (
                    <span className="text-gray-300">|</span>
                  )}
                  {perPersonWelfareCost && (
                    <span>
                      <span className="text-gray-500">{t("인당복후비", lang)}</span>{" "}
                      <span className="text-pink-600">{perPersonWelfareCost}</span>
                      {perPersonWelfareCostYOY && (
                        <span className="text-gray-400 ml-1">({perPersonWelfareCostYOY})</span>
                      )}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* 대분류별 요약 - 테이블 형식 (헤더 문구 없이 표만 노출) */}
        <div className="mt-1 pt-1 border-t border-gray-200">
          {(() => {
            const showAnnualCols = mode === "ytd";
            // 예상 pace = 현재 월/12 × 100 (예: 7월이면 58%)
            const expectedPacePct = mode === "ytd" ? Math.round((month / 12) * 100) : null;
            // 합계 계산
            const totalCurr = expenseDetails.reduce((s, d) => s + ((d.prevAmount ?? 0) + d.amountDiff), 0);
            const totalPrev = expenseDetails.reduce((s, d) => s + (d.prevAmount ?? 0), 0);
            const totalDiff = totalCurr - totalPrev;
            const totalYoy = totalPrev > 0 ? (totalCurr / totalPrev) * 100 : null;
            const totalAnnualPlan = expenseDetails.reduce((s, d) => s + (d.annualPlan ?? 0), 0);
            const totalUsagePct = totalAnnualPlan > 0 ? (totalCurr / totalAnnualPlan) * 100 : null;

            const usageColor = (v: number | null | undefined) => {
              if (v == null || expectedPacePct == null) return "text-gray-500";
              if (v > expectedPacePct + 1) return "text-red-600";
              if (v < expectedPacePct - 1) return "text-blue-600";
              return "text-gray-700";
            };

            return (
              <>
                {/* 테이블 헤더 (한 줄, 부드러운 slate 배경) */}
                {showAnnualCols ? (
                  <div className="grid gap-1 text-[10.5px] text-slate-500 font-semibold uppercase tracking-wide mb-0.5 px-1.5 py-1 bg-slate-50 rounded whitespace-nowrap" style={gridStyle}>
                    <div>{t("대분류", lang)}</div>
                    <div className="text-center">{amountColLabel}</div>
                    <div className="text-center">{t("전년동기간", lang)}</div>
                    <div className="text-center">YOY{t("금액", lang)}</div>
                    <div className="text-center">YoY</div>
                    <div className="text-center border-l border-slate-200 pl-1.5">{t("연간계획", lang)}</div>
                    <div className="text-center">
                      {t("진척률", lang)}
                      {expectedPacePct != null && <span className="ml-0.5 text-slate-400 normal-case">({expectedPacePct}%)</span>}
                    </div>
                    <div className="text-center border-l border-slate-200 pl-1.5">{t("잔여예산", lang)}</div>
                    <div className="text-center border-l border-slate-200 pl-1.5">{remainingLabel}</div>
                    <div className="text-center">{t("판정", lang)}</div>
                  </div>
                ) : (
                  <div className="grid gap-1 text-[11px] text-slate-500 font-semibold uppercase tracking-wide mb-0.5 px-1.5 py-1 bg-slate-50 rounded whitespace-nowrap" style={gridStyle}>
                    <div>{t("대분류", lang)}</div>
                    <div className="text-center">{amountColLabel}</div>
                    <div className="text-center">{t("전년동기간", lang)}</div>
                    <div className="text-center">YOY{t("금액", lang)}</div>
                    <div className="text-center">YoY</div>
                  </div>
                )}

                {/* 합계 행 (굵게, 배경, 첫 행) */}
                <div className="grid gap-1 items-center py-1.5 mb-1 px-1.5 rounded bg-slate-100/70 text-[12.5px] sm:text-[13px] font-bold text-gray-900" style={gridStyle}>
                  <div>{t("합계", lang)}</div>
                  <div className="text-right">{formatK(totalCurr)}</div>
                  <div className="text-right text-gray-500 font-medium">{formatK(totalPrev)}</div>
                  <div className={`text-right ${diffClass(totalDiff)}`}>
                    {totalDiff >= 0 ? "+" : ""}{formatK(totalDiff)}
                  </div>
                  <div className={`text-right ${yoyClass(totalYoy)}`}>
                    {totalYoy != null ? formatPercent(totalYoy, 0) : "-"}
                  </div>
                  {showAnnualCols && (() => {
                    const totalPlanYtd = expenseDetails.reduce((s, d) => s + (d.planYtd ?? 0), 0);
                    const totalRemaining = Math.max(0, totalAnnualPlan - totalPlanYtd);
                    const diff = totalCurr + totalRemaining - totalAnnualPlan;
                    const isOver = diff > 0;
                    return (
                      <>
                        <div className="text-right border-l border-gray-200 pl-1.5" title={adjTotal !== 0 ? `${t("수기조정", lang)} ${adjTotal >= 0 ? "+" : ""}${formatK(adjTotal)}` : undefined}>
                          {adjTotal !== 0 && <Pencil className="inline w-2.5 h-2.5 text-amber-600 mr-0.5 align-[-1px]" />}
                          {formatK(totalAnnualPlan)}
                        </div>
                        <div className={`text-right ${usageColor(totalUsagePct)}`}>
                          {totalUsagePct != null ? formatPercent(totalUsagePct, 0) : "-"}
                        </div>
                        <div className="text-right border-l border-gray-200 pl-1.5">{budgetLeft(totalAnnualPlan, totalCurr)}</div>
                        <div className="text-right border-l border-gray-200 pl-1.5">{formatK(totalRemaining)}</div>
                        <div className="text-center">
                          <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10.5px] font-bold tabular-nums ${isOver ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                            {diff >= 0 ? "+" : ""}{formatK(diff)}
                          </span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </>
            );
          })()}
          {/* 테이블 바디 — 계층 펼치기: lv1(+) → lv2(+) → lv3 (YTD 모드에서 연간계획/진척률 추가) */}
          <div className="space-y-0.5 text-[12.5px]">
            {(() => { /* eslint-disable */ return null; })()}
            {expenseDetails.map((detail, index) => {
              const lv1Key = detail.label;
              const lv1Open = isExpanded(lv1Key);
              const showAnnualCols = mode === "ytd";
              const expectedPacePctForRow = showAnnualCols ? Math.round((month / 12) * 100) : null;
              return (
                <Fragment key={`${lv1Key}-${index}`}>
                  {/* lv1 행 (헤더와 좌우 padding 통일) */}
                  <button
                    type="button"
                    onClick={() => toggle(lv1Key)}
                    className="w-full grid gap-1 items-center hover:bg-gray-50 py-1 px-1.5 rounded text-left transition-colors"
                    style={gridStyle}
                    aria-expanded={lv1Open}
                  >
                    <div className="text-gray-900 flex items-center justify-between gap-1 pr-1 min-w-0">
                      <span className="truncate">{getDisplayLabel(detail.label, detail.labelCn, lang)}</span>
                      {lv1Open
                        ? <Minus strokeWidth={1.5} className="w-3 h-3 text-gray-300 flex-shrink-0" />
                        : <Plus  strokeWidth={1.5} className="w-3 h-3 text-gray-300 flex-shrink-0" />}
                    </div>
                    <div className={`text-right font-medium text-gray-900 ${theme.cellBg} -my-1 py-1`}>{detail.amount}</div>
                    <div className="text-right text-gray-500">{formatK(detail.prevAmount ?? 0)}</div>
                    <div className={`text-right ${diffClass(detail.amountDiff)}`}>
                      {detail.amountDiff >= 0 ? "+" : ""}{formatK(detail.amountDiff)}
                    </div>
                    <div className={`text-right ${yoyClass(detail.yoy)}`}>
                      {detail.yoy !== null ? formatPercent(detail.yoy, 0) : "0.0%"}
                    </div>
                    {showAnnualCols && (
                      <>
                        {(() => {
                          const ap = detail.annualPlan ?? 0;
                          const py = detail.planYtd ?? 0;
                          const currAmt = (detail.prevAmount ?? 0) + detail.amountDiff;
                          const { has, rem, diff, isOver } = budgetCells(ap, py, currAmt);
                          return (
                            <>
                              <div className="text-right text-gray-600 border-l border-gray-200 pl-1.5" title={adjTitle(lv1Key)}>
                                {adjDelta(lv1Key) !== 0 && <Pencil className="inline w-2.5 h-2.5 text-amber-600 mr-0.5 align-[-1px]" />}
                                {has ? formatK(ap) : "-"}
                              </div>
                              <div className={`text-right ${theme.cellBg} -my-1 py-1 ${usageColor(detail.usagePct, expectedPacePctForRow)}`}>
                                {detail.usagePct != null ? formatPercent(detail.usagePct, 0) : "-"}
                              </div>
                              <div className="text-right text-gray-600 border-l border-gray-200 pl-1.5">{budgetLeft(ap, currAmt)}</div>
                              <div className="text-right text-gray-600 border-l border-gray-200 pl-1.5">
                                {has ? formatK(rem) : "-"}
                              </div>
                              <div className="text-center">
                                {has ? (
                                  <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10.5px] font-bold tabular-nums ${isOver ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                                    {diff >= 0 ? "+" : ""}{formatK(diff)}
                                  </span>
                                ) : <span className="text-gray-400">-</span>}
                              </div>
                            </>
                          );
                        })()}
                      </>
                    )}
                  </button>
                  {/* lv2 행 (lv1 펼침 시) */}
                  {lv1Open && (
                    <div className="mb-0.5 space-y-0.5">
                      {showAnnualCols && (adjByLv1.get(lv1Key) ?? []).map((adj) => (
                        <div key={adj.id} className="grid gap-1.5 items-center py-0.5 text-[11.5px] bg-amber-50/70 rounded" style={gridStyle}>
                          <div className="text-amber-800 flex items-center gap-1 pl-3 min-w-0">
                            <Pencil className="w-2.5 h-2.5 flex-shrink-0" />
                            <span className="truncate" title={adjustmentNote(adj, lang) || undefined}>
                              {adj.lv2 ? adjustmentLv2Label(adj, lang, autoCnLabel) : t("수기조정", lang)}
                            </span>
                          </div>
                          <div /><div /><div /><div />
                          <div
                            className={`text-right border-l border-gray-100 pl-1.5 font-medium ${adj.amount >= 0 ? "text-rose-700" : "text-blue-700"}`}
                            title={adjustmentNote(adj, lang) || undefined}
                          >
                            {adj.amount >= 0 ? "+" : ""}{formatK(adj.amount)}
                          </div>
                          <div /><div /><div /><div />
                        </div>
                      ))}
                      {getLv2Rows(lv1Key).map((c2) => {
                        const lv2Key = `${lv1Key}|${c2.label}`;
                        const lv2Open = isExpanded(lv2Key);
                        const lv3RowsAll = getLv3Rows(lv1Key, c2.label);
                        const hasLv3 = lv3RowsAll.length > 0;
                        const lv3Rows = lv2Open ? lv3RowsAll : [];
                        // 인당 계산은 인건비 하위 중 기본급/성과급충당금만 대상
                        const isLaborLv2 = lv1Key === "인건비" && PER_PERSON_LV2.has(c2.label) && currHeadcountSum > 0;
                        const perCurr = isLaborLv2 ? c2.amount / currHeadcountSum : null;
                        const perPrev = isLaborLv2 && prevHeadcountSum > 0 ? c2.prevAmount / prevHeadcountSum : null;
                        return (
                          <Fragment key={lv2Key}>
                            <button
                              type="button"
                              onClick={() => toggle(lv2Key)}
                              className="w-full grid gap-1.5 items-center py-0.5 hover:bg-gray-50 rounded text-left text-[11.5px]"
                              style={gridStyle}
                              aria-expanded={lv2Open}
                            >
                              <div className="text-gray-700 flex items-center justify-between gap-1 pr-1 pl-3 min-w-0">
                                <span className="truncate" title={getDisplayLabel(c2.label, c2.labelCn, lang)}>{getDisplayLabel(c2.label, c2.labelCn, lang)}</span>
                                {hasLv3 && (lv2Open
                                  ? <Minus strokeWidth={1.5} className="w-2.5 h-2.5 text-gray-300 flex-shrink-0" />
                                  : <Plus  strokeWidth={1.5} className="w-2.5 h-2.5 text-gray-300 flex-shrink-0" />)}
                              </div>
                              <div className={`text-right text-gray-700 ${theme.cellBg} -my-0.5 py-0.5`}>{formatK(c2.amount)}</div>
                              <div className="text-right text-gray-500">{formatK(c2.prevAmount)}</div>
                              <div className={`text-right ${diffClass(c2.amountDiff)}`}>
                                {c2.amountDiff >= 0 ? "+" : ""}{formatK(c2.amountDiff)}
                              </div>
                              <div className={`text-right ${yoyClass(c2.yoy)}`}>
                                {c2.yoy != null ? formatPercent(c2.yoy, 0) : "-"}
                              </div>
                              {showAnnualCols && (
                                <>
                                  {(() => {
                                    const ap = c2.annualPlan ?? 0;
                                    const py = c2.planYtd ?? 0;
                                    const { has, rem, diff, isOver } = budgetCells(ap, py, c2.amount);
                                    return (
                                      <>
                                        <div className="text-right text-gray-600 border-l border-gray-100 pl-1.5">
                                          {has ? formatK(ap) : "-"}
                                        </div>
                                        <div className={`text-right ${theme.cellBg} -my-0.5 py-0.5 ${usageColor(c2.usagePct, expectedPacePctForRow)}`}>
                                          {c2.usagePct != null ? formatPercent(c2.usagePct, 0) : "-"}
                                        </div>
                                        <div className="text-right text-gray-600 border-l border-gray-100 pl-1.5">{budgetLeft(ap, c2.amount)}</div>
                                        <div className="text-right text-gray-600 border-l border-gray-100 pl-1.5">
                                          {has ? formatK(rem) : "-"}
                                        </div>
                                        <div className="text-center">
                                          {has ? (
                                            <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums ${isOver ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                                              {diff >= 0 ? "+" : ""}{formatK(diff)}
                                            </span>
                                          ) : <span className="text-gray-400">-</span>}
                                        </div>
                                      </>
                                    );
                                  })()}
                                </>
                              )}
                            </button>
                            {/* 인건비 lv2 하위: 인당 정보 — 각 값에 알약(pill) 배경 */}
                            {isLaborLv2 && perCurr != null && (() => {
                              const perDiff = perPrev != null ? (perCurr - perPrev) / 1000 : null;
                              const perYoy  = perPrev != null && perPrev > 0 ? (perCurr / perPrev) * 100 : null;
                              return (
                                <div className="grid gap-1 items-center px-1.5 py-0.5 mb-0.5 text-[10px] italic"
                                     style={gridStyle}>
                                  <div />
                                  <div className="text-right text-gray-500">
                                    {(perCurr / 1000).toFixed(1)}K/인
                                  </div>
                                  <div className="text-right text-gray-400">
                                    {perPrev != null ? `${(perPrev / 1000).toFixed(1)}K/인` : ""}
                                  </div>
                                  <div className={`text-right ${perDiff != null && perDiff >= 0 ? "text-red-400" : "text-blue-400"}`}>
                                    {perDiff != null ? `${perDiff >= 0 ? "+" : ""}${perDiff.toFixed(1)}K/인` : ""}
                                  </div>
                                  <div className={`text-right ${perYoy != null && perYoy >= 100 ? "text-red-400" : "text-blue-400"}`}>
                                    {perYoy != null ? formatPercent(perYoy, 0) : ""}
                                  </div>
                                </div>
                              );
                            })()}
                            {/* lv3 행 (lv2 펼침 시) — 인건비 하위 대상 lv2면 사업부별 인당도 추가 */}
                            {lv2Open && lv3Rows.length > 0 && (
                              <div className="space-y-0.5">
                                {lv3Rows.map((c3, ci3) => {
                                  // 인건비 > 기본급/성과급충당금 > 사업부 → 사업부별 인당
                                  const showLv3PerPerson = isLaborLv2;
                                  const buHc  = showLv3PerPerson ? getRawHeadcountSum(c3.label, year, yearType) : 0;
                                  const buHcPrev = showLv3PerPerson ? getRawHeadcountSum(c3.label, year - 1, "actual") : 0;
                                  const c3PerCurr = showLv3PerPerson && buHc > 0 ? c3.amount / buHc : null;
                                  const c3PerPrev = showLv3PerPerson && buHcPrev > 0 ? c3.prevAmount / buHcPrev : null;
                                  return (
                                  <React.Fragment key={`${lv2Key}-c3-${ci3}`}>
                                  <div className="grid gap-1.5 items-center py-0.5 text-[11px]"
                                       style={gridStyle}>
                                    <div className="text-gray-500 truncate pl-6 min-w-0" title={getDisplayLabel(c3.label, c3.labelCn, lang)}>
                                      {getDisplayLabel(c3.label, c3.labelCn, lang)}
                                    </div>
                                    <div className={`text-right text-gray-600 ${theme.cellBg} -my-0.5 py-0.5`}>{formatK(c3.amount)}</div>
                                    <div className="text-right text-gray-400">{formatK(c3.prevAmount)}</div>
                                    <div className={`text-right ${diffClass(c3.amountDiff)}`}>
                                      {c3.amountDiff >= 0 ? "+" : ""}{formatK(c3.amountDiff)}
                                    </div>
                                    <div className={`text-right ${yoyClass(c3.yoy)}`}>
                                      {c3.yoy != null ? formatPercent(c3.yoy, 0) : "-"}
                                    </div>
                                    {showAnnualCols && (
                                      <>
                                        {(() => {
                                          const ap = c3.annualPlan ?? 0;
                                          const py = c3.planYtd ?? 0;
                                          const { has, rem, diff, isOver } = budgetCells(ap, py, c3.amount);
                                          return (
                                            <>
                                              <div className="text-right text-gray-500 border-l border-gray-100 pl-1.5">
                                                {has ? formatK(ap) : "-"}
                                              </div>
                                              <div className={`text-right ${theme.cellBg} -my-0.5 py-0.5 ${usageColor(c3.usagePct, expectedPacePctForRow)}`}>
                                                {c3.usagePct != null ? formatPercent(c3.usagePct, 0) : "-"}
                                              </div>
                                              <div className="text-right text-gray-500 border-l border-gray-100 pl-1.5">{budgetLeft(ap, c3.amount)}</div>
                                              <div className="text-right text-gray-500 border-l border-gray-100 pl-1.5">
                                                {has ? formatK(rem) : "-"}
                                              </div>
                                              <div className="text-center">
                                                {has ? (
                                                  <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums ${isOver ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                                                    {diff >= 0 ? "+" : ""}{formatK(diff)}
                                                  </span>
                                                ) : <span className="text-gray-400">-</span>}
                                              </div>
                                            </>
                                          );
                                        })()}
                                      </>
                                    )}
                                  </div>
                                  {/* lv3 사업부별 인당 — pill 스타일 + YoY 금액 */}
                                  {showLv3PerPerson && c3PerCurr != null && (() => {
                                    const c3PerDiff = c3PerPrev != null ? (c3PerCurr - c3PerPrev) / 1000 : null;
                                    const c3PerYoy  = c3PerPrev != null && c3PerPrev > 0 ? (c3PerCurr / c3PerPrev) * 100 : null;
                                    return (
                                      <div className="grid gap-1 items-center px-1.5 py-0.5 mb-0.5 text-[10px] italic"
                                           style={gridStyle}>
                                        <div />
                                        <div className="text-right text-gray-500">
                                          {(c3PerCurr / 1000).toFixed(1)}K/인
                                        </div>
                                        <div className="text-right text-gray-400">
                                          {c3PerPrev != null ? `${(c3PerPrev / 1000).toFixed(1)}K/인` : ""}
                                        </div>
                                        <div className={`text-right ${c3PerDiff != null && c3PerDiff >= 0 ? "text-red-400" : "text-blue-400"}`}>
                                          {c3PerDiff != null ? `${c3PerDiff >= 0 ? "+" : ""}${c3PerDiff.toFixed(1)}K/인` : ""}
                                        </div>
                                        <div className={`text-right ${c3PerYoy != null && c3PerYoy >= 100 ? "text-red-400" : "text-blue-400"}`}>
                                          {c3PerYoy != null ? formatPercent(c3PerYoy, 0) : ""}
                                        </div>
                                      </div>
                                    );
                                  })()}
                                  </React.Fragment>
                                  );
                                })}
                              </div>
                            )}
                          </Fragment>
                        );
                      })}
                    </div>
                  )}
                  {(detail.label === "복리후생비" || detail.label === "출장비") && (
                    <div className="border-t border-gray-200 mt-2 mb-1" aria-hidden="true" />
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>

        {/* 상세보기 버튼 */}
        <div className="mt-4">
          <Link href={`/${businessUnit}?year=${year}&type=${yearType}&month=${month}&mode=${detailMode}`}>
            <Button
              className="w-full text-[10px] sm:text-xs py-2.5 rounded-lg font-medium"
              style={{
                backgroundColor: theme.buttonColor,
                color: "white",
                border: "none",
              }}
            >
              {isCorporate ? t("법인 대시보드 보기", lang) : isCommon ? t("공통비용 상세보기", lang) : t("전체 대시보드 보기", lang)} &gt;
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
