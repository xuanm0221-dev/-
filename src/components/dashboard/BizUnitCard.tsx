"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, ArrowDown, Plus, Minus } from "lucide-react";
import { formatPercent, formatK } from "@/lib/utils";
import { getCategoryDetail, type BizUnit, type Mode } from "@/lib/expenseData";
import { useLanguage } from "@/contexts/LanguageContext";
import { t, getDisplayLabel } from "@/lib/translations";
import React, { Fragment, useEffect, useState } from "react";

// 사업부별 테마 설정
const THEME = {
  법인: {
    headerGradient: "from-purple-600 to-indigo-600",
    primaryColor: "text-purple-600",
    borderColor: "border-purple-600",
    buttonColor: "#7c3aed",
    accentColor: "bg-purple-600",
  },
  MLB: {
    headerGradient: "from-blue-500 to-blue-600",
    primaryColor: "text-blue-600",
    borderColor: "border-blue-500",
    buttonColor: "#3b82f6",
    accentColor: "bg-blue-500",
  },
  KIDS: {
    headerGradient: "from-yellow-500 to-yellow-600",
    primaryColor: "text-yellow-600",
    borderColor: "border-yellow-500",
    buttonColor: "#eab308",
    accentColor: "bg-yellow-500",
  },
  DISCOVERY: {
    headerGradient: "from-green-500 to-green-600",
    primaryColor: "text-green-600",
    borderColor: "border-green-500",
    buttonColor: "#10b981",
    accentColor: "bg-green-500",
  },
  COMMON: {
    headerGradient: "from-gray-700 to-gray-800",
    primaryColor: "text-gray-700",
    borderColor: "border-gray-700",
    buttonColor: "#6b7280",
    accentColor: "bg-gray-700",
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
  const isCorporate = businessUnit === "법인";
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

  // 특정 lv1의 하위 lv2 그룹핑 (annualPlan 포함)
  const getLv2Rows = (lv1: string) => {
    const curr = getCategoryDetail(businessUnit, year, month, lv1, mode, yearType);
    const prev = getCategoryDetail(businessUnit, year - 1, month, lv1, mode, "actual");
    const plan = getCategoryDetail(businessUnit, year, 12, lv1, "ytd", "plan"); // 연간 계획
    const currMap = new Map<string, { amount: number; labelCn?: string }>();
    for (const d of curr) {
      const key = d.cost_lv2 || "-";
      const p = currMap.get(key) ?? { amount: 0, labelCn: d.cost_lv2_cn };
      currMap.set(key, { amount: p.amount + (d.amount || 0), labelCn: p.labelCn ?? d.cost_lv2_cn });
    }
    const prevMap = new Map<string, number>();
    for (const d of prev) {
      const key = d.cost_lv2 || "-";
      prevMap.set(key, (prevMap.get(key) ?? 0) + (d.amount || 0));
    }
    const planMap = new Map<string, number>();
    for (const d of plan) {
      const key = d.cost_lv2 || "-";
      planMap.set(key, (planMap.get(key) ?? 0) + (d.amount || 0));
    }
    return Array.from(currMap.entries())
      .map(([lv2, v]) => {
        const p = prevMap.get(lv2) ?? 0;
        const ap = planMap.get(lv2) ?? 0;
        return {
          label: lv2,
          labelCn: v.labelCn,
          amount: v.amount,
          prevAmount: p,
          amountDiff: v.amount - p,
          yoy: p > 0 ? (v.amount / p) * 100 : null,
          annualPlan: ap > 0 ? ap : undefined,
          usagePct: ap > 0 ? (v.amount / ap) * 100 : null,
        };
      })
      .filter((r) => Math.abs(r.amount) > 0)
      .sort((a, b) => b.amount - a.amount);
  };

  // 특정 lv1+lv2의 하위 lv3 그룹핑 (annualPlan 포함)
  const getLv3Rows = (lv1: string, lv2: string) => {
    const curr = getCategoryDetail(businessUnit, year, month, lv1, mode, yearType).filter((d) => (d.cost_lv2 || "-") === lv2);
    const prev = getCategoryDetail(businessUnit, year - 1, month, lv1, mode, "actual").filter((d) => (d.cost_lv2 || "-") === lv2);
    const plan = getCategoryDetail(businessUnit, year, 12, lv1, "ytd", "plan").filter((d) => (d.cost_lv2 || "-") === lv2);
    const currMap = new Map<string, { amount: number; labelCn?: string }>();
    for (const d of curr) {
      const key = d.cost_lv3 || "-";
      const p = currMap.get(key) ?? { amount: 0, labelCn: d.cost_lv3_cn };
      currMap.set(key, { amount: p.amount + (d.amount || 0), labelCn: p.labelCn ?? d.cost_lv3_cn });
    }
    const prevMap = new Map<string, number>();
    for (const d of prev) {
      const key = d.cost_lv3 || "-";
      prevMap.set(key, (prevMap.get(key) ?? 0) + (d.amount || 0));
    }
    const planMap = new Map<string, number>();
    for (const d of plan) {
      const key = d.cost_lv3 || "-";
      planMap.set(key, (planMap.get(key) ?? 0) + (d.amount || 0));
    }
    return Array.from(currMap.entries())
      .map(([lv3, v]) => {
        const p = prevMap.get(lv3) ?? 0;
        const ap = planMap.get(lv3) ?? 0;
        return {
          label: lv3,
          labelCn: v.labelCn,
          amount: v.amount,
          prevAmount: p,
          amountDiff: v.amount - p,
          yoy: p > 0 ? (v.amount / p) * 100 : null,
          annualPlan: ap > 0 ? ap : undefined,
          usagePct: ap > 0 ? (v.amount / ap) * 100 : null,
        };
      })
      .filter((r) => Math.abs(r.amount) > 0 && r.label !== "-")
      .sort((a, b) => b.amount - a.amount);
  };

  // 진척률 컬러: 예상 pace(month/12) 기준 위/아래
  const usageColor = (v: number | null | undefined, expected: number | null) => {
    if (v == null || expected == null) return "text-gray-500";
    if (v > expected + 1) return "text-red-600";
    if (v < expected - 1) return "text-blue-600";
    return "text-gray-700";
  };

  const yoyClass = (y: number | null) => y == null ? "text-gray-500" : y >= 100 ? "text-red-600" : y === 0 ? "text-gray-500" : "text-blue-600";
  const diffClass = (d: number) => d >= 0 ? "text-red-600" : "text-blue-600";

  return (
    <Card className="h-full flex flex-col shadow-md hover:shadow-lg transition-shadow overflow-hidden rounded-lg">
      {/* 헤더 - 그라데이션 배경 */}
      <div className={`bg-gradient-to-r ${theme.headerGradient} px-4 py-3 text-white`}>
        {/* 상단: 아이콘 + 브랜드명 */}
        <div className="flex items-center gap-2 mb-3">
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

        {/* 하단: YOY 박스들 - 브랜드/법인/공통 모두 판매매출 YOY + 영업비 YOY 표시 */}
        <div className="flex gap-2">
          {yoySales !== null && (
            <div className="bg-white/20 backdrop-blur-sm rounded-md px-2.5 py-1.5 border border-white/30 flex-1">
              <div className="flex flex-col">
                <span className="text-[9px] sm:text-[10px] text-white/90 mb-1">{t("판매매출 YOY", lang)}</span>
                <div className="flex items-center gap-1">
                  {yoySales >= 100 ? (
                    <TrendingUp className="w-3 h-3 text-white" />
                  ) : (
                    <TrendingDown className="w-3 h-3 text-white" />
                  )}
                  <span className="text-[10px] sm:text-xs font-bold text-white">
                    {formatPercent(yoySales, 0)}
                  </span>
                </div>
              </div>
            </div>
          )}
          {yoyExpense !== null && (
            <div className="bg-white/20 backdrop-blur-sm rounded-md px-2.5 py-1.5 border border-white/30 flex-1">
              <div className="flex flex-col">
                <span className="text-[9px] sm:text-[10px] text-white/90 mb-1">{t("영업비 YOY", lang)}</span>
                <div className="flex items-center gap-1">
                  {yoyExpense >= 100 ? (
                    <TrendingUp className="w-3 h-3 text-white" />
                  ) : (
                    <TrendingDown className="w-3 h-3 text-white" />
                  )}
                  <span className="text-[10px] sm:text-xs font-bold text-white">
                    {formatPercent(yoyExpense, 0)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <CardContent className="flex-1 flex flex-col p-4 bg-white">
        {/* 주요 KPI */}
        <div className="mb-4">
          {/* 총비용 - 큰 글씨로, 왼쪽에 세로선 */}
          <div className="flex items-start gap-2 mb-3">
            <div className={`w-1 h-12 ${theme.accentColor} rounded-full`}></div>
            <div>
              <div className={`text-sm sm:text-base font-bold ${theme.primaryColor}`}>
                {totalExpense}
                {totalExpenseChange != null ? ` (${totalExpenseChange})` : ""}
              </div>
              <div className="text-[11.4px] sm:text-[13.2px] text-gray-500 mt-1">{t("총 비용", lang)}</div>
            </div>
          </div>

          {!isCommon && !isCorporate && (
            <>
              <div className="grid grid-cols-[1fr_2fr_1fr] gap-2">
                {/* 영업비율 */}
                {ratio !== null && (
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 min-h-[60px] flex flex-col justify-between">
                    <div className="text-[11.4px] sm:text-[13.2px] font-semibold text-blue-600 break-words">{ratio}</div>
                    <div className="text-[11.4px] sm:text-[13.2px] text-gray-500 break-words">{t("영업비율", lang)}</div>
                  </div>
                )}

                {/* 인원수 */}
                {headcount !== null && (
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 min-h-[60px] flex flex-col justify-between">
                    <div className="text-[11.4px] sm:text-[13.2px] font-semibold text-purple-600 break-words">
                      {t("기말", lang)}: {headcount}{headcountChange != null ? ` (${headcountChange})` : ""}
                    </div>
                    <div className="text-[11.4px] sm:text-[13.2px] text-gray-500 break-words">
                      {avgHeadcount != null 
                        ? `${t("평균", lang)}: ${avgHeadcount}${avgHeadcountChange != null ? ` (${avgHeadcountChange})` : ""}`
                        : " "
                      }
                    </div>
                  </div>
                )}

                {/* 판매매출 */}
                {salesAmount !== null && (
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 min-h-[60px] flex flex-col justify-between">
                    <div className="text-[11.4px] sm:text-[13.2px] font-semibold text-teal-600 break-words">{salesAmount}</div>
                    <div className="text-[11.4px] sm:text-[13.2px] text-gray-500 break-words">{t("판매매출", lang)}</div>
                  </div>
                )}
              </div>
              {/* 인당 인건비/복리후생비 */}
              {(perPersonLaborCost || perPersonWelfareCost) && (
                <div className="border-t border-gray-200 mt-3 pt-2">
                  <div className="flex items-center justify-center gap-4 text-[10px] sm:text-xs">
                    {perPersonLaborCost && (
                      <span>
                        <span className="text-gray-500 text-[11.4px] sm:text-[13.2px]">{t("인당 기본급", lang)}</span>{" "}
                        <span className="font-semibold text-orange-600">{perPersonLaborCost}</span>
                        {perPersonLaborCostYOY && (
                          <span className="text-gray-400 text-[11.4px] sm:text-[13.2px] ml-1">({perPersonLaborCostYOY})</span>
                        )}
                      </span>
                    )}
                    {perPersonLaborCost && perPersonWelfareCost && (
                      <span className="text-gray-300">|</span>
                    )}
                    {perPersonWelfareCost && (
                      <span>
                        <span className="text-gray-500 text-[11.4px] sm:text-[13.2px]">{t("인당복후비", lang)}</span>{" "}
                        <span className="font-semibold text-pink-600">{perPersonWelfareCost}</span>
                        {perPersonWelfareCostYOY && (
                          <span className="text-gray-400 text-[11.4px] sm:text-[13.2px] ml-1">({perPersonWelfareCostYOY})</span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
          {/* 공통 및 법인 카드: 브랜드와 동일 3칸 그리드 (영업비율 | 인원수 | 판매매출) */}
          {(isCommon || isCorporate) && (
            <>
              <div className="grid grid-cols-[1fr_2fr_1fr] gap-2">
                {ratio !== null && (
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 min-h-[60px] flex flex-col justify-between">
                    <div className="text-[11.4px] sm:text-[13.2px] font-semibold text-blue-600 break-words">{ratio}</div>
                    <div className="text-[11.4px] sm:text-[13.2px] text-gray-500 break-words">{t("영업비율", lang)}</div>
                  </div>
                )}
                {headcount !== null && (
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 min-h-[60px] flex flex-col justify-between">
                    <div className="text-[11.4px] sm:text-[13.2px] font-semibold text-purple-600 break-words">
                      {t("기말", lang)}: {headcount}{headcountChange != null ? ` (${headcountChange})` : ""}
                    </div>
                    <div className="text-[11.4px] sm:text-[13.2px] text-gray-500 break-words">
                      {avgHeadcount != null 
                        ? `${t("평균", lang)}: ${avgHeadcount}${avgHeadcountChange != null ? ` (${avgHeadcountChange})` : ""}`
                        : " "
                      }
                    </div>
                  </div>
                )}
                {salesAmount !== null && (
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 min-h-[60px] flex flex-col justify-between">
                    <div className="text-[11.4px] sm:text-[13.2px] font-semibold text-teal-600 break-words">{salesAmount}</div>
                    <div className="text-[11.4px] sm:text-[13.2px] text-gray-500 break-words">{t("판매매출", lang)}</div>
                  </div>
                )}
              </div>
              {(perPersonLaborCost || perPersonWelfareCost) && (
                <div className="border-t border-gray-200 mt-3 pt-2">
                  <div className="flex items-center justify-center gap-4 text-[10px] sm:text-xs">
                    {perPersonLaborCost && (
                      <span>
                        <span className="text-gray-500 text-[11.4px] sm:text-[13.2px]">{t("인당 기본급", lang)}</span>{" "}
                        <span className="font-semibold text-orange-600">{perPersonLaborCost}</span>
                        {perPersonLaborCostYOY && (
                          <span className="text-gray-400 text-[11.4px] sm:text-[13.2px] ml-1">({perPersonLaborCostYOY})</span>
                        )}
                      </span>
                    )}
                    {perPersonLaborCost && perPersonWelfareCost && (
                      <span className="text-gray-300">|</span>
                    )}
                    {perPersonWelfareCost && (
                      <span>
                        <span className="text-gray-500 text-[11.4px] sm:text-[13.2px]">{t("인당복후비", lang)}</span>{" "}
                        <span className="font-semibold text-pink-600">{perPersonWelfareCost}</span>
                        {perPersonWelfareCostYOY && (
                          <span className="text-gray-400 text-[11.4px] sm:text-[13.2px] ml-1">({perPersonWelfareCostYOY})</span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* 대분류별 요약 - 테이블 형식 (헤더 문구 없이 표만 노출) */}
        <div className="mt-2 pt-1 border-t border-gray-200">
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
                {/* 테이블 헤더 */}
                {showAnnualCols ? (
                  <div className="grid gap-1.5 text-[10.5px] sm:text-[11.5px] text-gray-500 mb-2 pb-1.5 border-b border-gray-200 font-medium" style={{ gridTemplateColumns: "repeat(14, minmax(0, 1fr))" }}>
                    <div className="col-span-3">{t("대분류", lang)}</div>
                    <div className="col-span-2 text-right">{t("금액", lang)}</div>
                    <div className="col-span-2 text-right">{t("전년금액", lang)}</div>
                    <div className="col-span-2 text-right">YOY{t("금액", lang)}</div>
                    <div className="col-span-1 text-right">YoY</div>
                    <div className="col-span-2 text-right border-l border-gray-200 pl-1.5">{t("연간계획", lang)}</div>
                    <div className="col-span-2 text-right">
                      {t("진척률", lang)} {expectedPacePct != null && <span className="text-gray-400">({expectedPacePct}%)</span>}
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-1.5 text-[11px] sm:text-[12.5px] text-gray-500 mb-2 pb-1.5 border-b border-gray-200 font-medium" style={{ gridTemplateColumns: "repeat(14, minmax(0, 1fr))" }}>
                    <div className="col-span-4">{t("대분류", lang)}</div>
                    <div className="col-span-3 text-right">{t("금액", lang)}</div>
                    <div className="col-span-3 text-right">{t("전년금액", lang)}</div>
                    <div className="col-span-2 text-right">YOY{t("금액", lang)}</div>
                    <div className="col-span-2 text-right">YoY</div>
                  </div>
                )}

                {/* 합계 행 (굵게, 첫 행) */}
                <div className="grid gap-1.5 items-center py-1.5 mb-1 border-b border-gray-300 text-[11.5px] sm:text-[13px] font-bold text-gray-900" style={{ gridTemplateColumns: "repeat(14, minmax(0, 1fr))" }}>
                  <div className={`${showAnnualCols ? "col-span-3" : "col-span-4"}`}>{t("합계", lang)}</div>
                  <div className={`${showAnnualCols ? "col-span-2" : "col-span-3"} text-right`}>{formatK(totalCurr)}</div>
                  <div className={`${showAnnualCols ? "col-span-2" : "col-span-3"} text-right text-gray-500 font-medium`}>{formatK(totalPrev)}</div>
                  <div className={`${showAnnualCols ? "col-span-2" : "col-span-2"} text-right ${diffClass(totalDiff)}`}>
                    {totalDiff >= 0 ? "+" : ""}{formatK(totalDiff)}
                  </div>
                  <div className={`${showAnnualCols ? "col-span-1" : "col-span-2"} text-right ${yoyClass(totalYoy)}`}>
                    {totalYoy != null ? formatPercent(totalYoy, 0) : "-"}
                  </div>
                  {showAnnualCols && (
                    <>
                      <div className="col-span-2 text-right border-l border-gray-200 pl-1.5">{formatK(totalAnnualPlan)}</div>
                      <div className={`col-span-2 text-right ${usageColor(totalUsagePct)}`}>
                        {totalUsagePct != null ? formatPercent(totalUsagePct, 0) : "-"}
                      </div>
                    </>
                  )}
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
                  {/* lv1 행 */}
                  <button
                    type="button"
                    onClick={() => toggle(lv1Key)}
                    className="w-full grid gap-1.5 items-center hover:bg-gray-50 py-1 rounded text-left transition-colors"
                    style={{ gridTemplateColumns: "repeat(14, minmax(0, 1fr))" }}
                    aria-expanded={lv1Open}
                  >
                    <div className={`${showAnnualCols ? "col-span-3" : "col-span-4"} text-gray-900 flex items-center justify-between gap-1 pr-1`}>
                      <span className="truncate">{getDisplayLabel(detail.label, detail.labelCn, lang)}</span>
                      {lv1Open
                        ? <Minus strokeWidth={1.5} className="w-3 h-3 text-gray-300 flex-shrink-0" />
                        : <Plus  strokeWidth={1.5} className="w-3 h-3 text-gray-300 flex-shrink-0" />}
                    </div>
                    <div className={`${showAnnualCols ? "col-span-2" : "col-span-3"} text-right font-medium text-gray-900`}>{detail.amount}</div>
                    <div className={`${showAnnualCols ? "col-span-2" : "col-span-3"} text-right text-gray-500`}>{formatK(detail.prevAmount ?? 0)}</div>
                    <div className={`${showAnnualCols ? "col-span-2" : "col-span-2"} text-right ${diffClass(detail.amountDiff)}`}>
                      {detail.amountDiff >= 0 ? "+" : ""}{formatK(detail.amountDiff)}
                    </div>
                    <div className={`${showAnnualCols ? "col-span-1" : "col-span-2"} text-right ${yoyClass(detail.yoy)}`}>
                      {detail.yoy !== null ? formatPercent(detail.yoy, 0) : "0.0%"}
                    </div>
                    {showAnnualCols && (
                      <>
                        <div className="col-span-2 text-right text-gray-600 border-l border-gray-200 pl-1.5">
                          {detail.annualPlan != null ? formatK(detail.annualPlan) : "-"}
                        </div>
                        <div className={`col-span-2 text-right ${usageColor(detail.usagePct, expectedPacePctForRow)}`}>
                          {detail.usagePct != null ? formatPercent(detail.usagePct, 0) : "-"}
                        </div>
                      </>
                    )}
                  </button>
                  {/* lv2 행 (lv1 펼침 시) */}
                  {lv1Open && (
                    <div className="mb-0.5 pl-3 space-y-0.5">
                      {getLv2Rows(lv1Key).map((c2) => {
                        const lv2Key = `${lv1Key}|${c2.label}`;
                        const lv2Open = isExpanded(lv2Key);
                        // 하위 lv3 존재 여부는 항상 계산 (헤더에 [+] 표시용)
                        const lv3RowsAll = getLv3Rows(lv1Key, c2.label);
                        const hasLv3 = lv3RowsAll.length > 0;
                        const lv3Rows = lv2Open ? lv3RowsAll : [];
                        return (
                          <Fragment key={lv2Key}>
                            <button
                              type="button"
                              onClick={() => toggle(lv2Key)}
                              className="w-full grid gap-1.5 items-center py-1 hover:bg-gray-50 rounded text-left"
                              style={{ gridTemplateColumns: "repeat(14, minmax(0, 1fr))" }}
                              aria-expanded={lv2Open}
                            >
                              <div className={`${showAnnualCols ? "col-span-3" : "col-span-4"} text-gray-700 flex items-center justify-between gap-1 pr-1`}>
                                <span className="truncate" title={getDisplayLabel(c2.label, c2.labelCn, lang)}>{getDisplayLabel(c2.label, c2.labelCn, lang)}</span>
                                {hasLv3 && (lv2Open
                                  ? <Minus strokeWidth={1.5} className="w-2.5 h-2.5 text-gray-300 flex-shrink-0" />
                                  : <Plus  strokeWidth={1.5} className="w-2.5 h-2.5 text-gray-300 flex-shrink-0" />)}
                              </div>
                              <div className={`${showAnnualCols ? "col-span-2" : "col-span-3"} text-right text-gray-700`}>{formatK(c2.amount)}</div>
                              <div className={`${showAnnualCols ? "col-span-2" : "col-span-3"} text-right text-gray-500`}>{formatK(c2.prevAmount)}</div>
                              <div className={`${showAnnualCols ? "col-span-2" : "col-span-2"} text-right ${diffClass(c2.amountDiff)}`}>
                                {c2.amountDiff >= 0 ? "+" : ""}{formatK(c2.amountDiff)}
                              </div>
                              <div className={`${showAnnualCols ? "col-span-1" : "col-span-2"} text-right ${yoyClass(c2.yoy)}`}>
                                {c2.yoy != null ? formatPercent(c2.yoy, 0) : "-"}
                              </div>
                              {showAnnualCols && (
                                <>
                                  <div className="col-span-2 text-right text-gray-600 border-l border-gray-100 pl-1.5">
                                    {c2.annualPlan != null ? formatK(c2.annualPlan) : "-"}
                                  </div>
                                  <div className={`col-span-2 text-right ${usageColor(c2.usagePct, expectedPacePctForRow)}`}>
                                    {c2.usagePct != null ? formatPercent(c2.usagePct, 0) : "-"}
                                  </div>
                                </>
                              )}
                            </button>
                            {/* lv3 행 (lv2 펼침 시) */}
                            {lv2Open && lv3Rows.length > 0 && (
                              <div className="pl-3 space-y-0.5">
                                {lv3Rows.map((c3, ci3) => (
                                  <div key={`${lv2Key}-c3-${ci3}`} className="grid gap-1.5 items-center py-1"
                                       style={{ gridTemplateColumns: "repeat(14, minmax(0, 1fr))" }}>
                                    <div className={`${showAnnualCols ? "col-span-3" : "col-span-4"} text-gray-500 truncate`} title={getDisplayLabel(c3.label, c3.labelCn, lang)}>
                                      {getDisplayLabel(c3.label, c3.labelCn, lang)}
                                    </div>
                                    <div className={`${showAnnualCols ? "col-span-2" : "col-span-3"} text-right text-gray-600`}>{formatK(c3.amount)}</div>
                                    <div className={`${showAnnualCols ? "col-span-2" : "col-span-3"} text-right text-gray-400`}>{formatK(c3.prevAmount)}</div>
                                    <div className={`${showAnnualCols ? "col-span-2" : "col-span-2"} text-right ${diffClass(c3.amountDiff)}`}>
                                      {c3.amountDiff >= 0 ? "+" : ""}{formatK(c3.amountDiff)}
                                    </div>
                                    <div className={`${showAnnualCols ? "col-span-1" : "col-span-2"} text-right ${yoyClass(c3.yoy)}`}>
                                      {c3.yoy != null ? formatPercent(c3.yoy, 0) : "-"}
                                    </div>
                                    {showAnnualCols && (
                                      <>
                                        <div className="col-span-2 text-right text-gray-500 border-l border-gray-100 pl-1.5">
                                          {c3.annualPlan != null ? formatK(c3.annualPlan) : "-"}
                                        </div>
                                        <div className={`col-span-2 text-right ${usageColor(c3.usagePct, expectedPacePctForRow)}`}>
                                          {c3.usagePct != null ? formatPercent(c3.usagePct, 0) : "-"}
                                        </div>
                                      </>
                                    )}
                                  </div>
                                ))}
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
