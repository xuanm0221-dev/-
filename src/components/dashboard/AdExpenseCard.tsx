"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCategoryDetail, type BizUnit } from "@/lib/expenseData";
import { formatK, formatPercent } from "@/lib/utils";
import { ExpenseAccountRow } from "@/types/expense";
import { useLanguage } from "@/contexts/LanguageContext";
import { t, getDisplayLabel } from "@/lib/translations";

const AD_ROW_ORDER = ["MLB", "KIDS", "DISCOVERY"] as const;
const AD_SUBCATEGORY_ORDER = ["ACC", "APP", "Branding", "Others Product requested", "Products", "Retailing"] as const;
const navyColor = "#001f3f";
const navyBarColor = "#5b7cba";

interface AdExpenseCardProps {
  bizUnit: BizUnit;
  year: number;
  month: number;
  adNode?: ExpenseAccountRow | null;
  yearType?: 'actual' | 'plan';
  /** 실적(actual)일 때만 전달: 당월/누적 구분 */
  mode?: import("@/lib/expenseData").Mode;
  sales?: number;
  prevSales?: number;
}

function sumByBizUnit(details: { biz_unit: string; amount: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  details.forEach((d) => {
    const key = d.biz_unit || "";
    if (key.trim() !== "") {
      map.set(key, (map.get(key) || 0) + d.amount);
    }
  });
  return map;
}

function sumByCostLv2(details: { cost_lv2: string; amount: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  details.forEach((d) => {
    const key = d.cost_lv2 || "";
    if (key.trim() !== "") {
      map.set(key, (map.get(key) || 0) + d.amount);
    }
  });
  return map;
}

function totalAdExpense(details: { amount: number }[]): number {
  return details.reduce((s, d) => s + d.amount, 0);
}

export function AdExpenseCard({ bizUnit, year, month, adNode, yearType, mode = "ytd", sales, prevSales }: AdExpenseCardProps) {
  const { lang } = useLanguage();
  const [showDetail, setShowDetail] = useState(false);
  const isBrand = bizUnit === "MLB" || bizUnit === "KIDS" || bizUnit === "DISCOVERY";
  const useMonthly = mode === "monthly";

  // adNode가 제공되면 계층형 데이터 사용, 아니면 기존 로직 사용
  let totalCurrent: number;
  let totalPrev: number;
  let byBizCurrent: Map<string, number>;
  let byBizPrev: Map<string, number>;

  if (adNode) {
    // 계층형 표에서 받은 데이터 사용 (실적 당월 모드면 curr_month/prev_month)
    totalCurrent = useMonthly ? adNode.curr_month : adNode.curr_ytd;
    totalPrev = useMonthly ? adNode.prev_month : adNode.prev_ytd;

    // L2 children에서 금액 추출 (브랜드: cost_lv2 소분류, 법인/ALL/공통: biz_unit)
    const currMap = new Map<string, number>();
    const prevMap = new Map<string, number>();
    
    adNode.children?.forEach(child => {
      const key = isBrand ? child.category_l2 : child.biz_unit;
      if (key && key.trim() !== "") {
        currMap.set(key, useMonthly ? child.curr_month : child.curr_ytd);
        prevMap.set(key, useMonthly ? child.prev_month : child.prev_ytd);
      }
    });

    byBizCurrent = currMap;
    byBizPrev = prevMap;
  } else {
    // 기존 로직: getCategoryDetail 사용
    const dataMode = useMonthly ? "monthly" : "ytd";
    const detailCurrent = getCategoryDetail(bizUnit, year, month, "광고비", dataMode, yearType);
    const detailPrev = getCategoryDetail(bizUnit, year - 1, month, "광고비", dataMode, yearType);

    totalCurrent = totalAdExpense(detailCurrent);
    totalPrev = totalAdExpense(detailPrev);

    byBizCurrent = isBrand ? sumByCostLv2(detailCurrent) : sumByBizUnit(detailCurrent);
    byBizPrev = isBrand ? sumByCostLv2(detailPrev) : sumByBizUnit(detailPrev);
  }

  const yoy = totalPrev > 0 ? (totalCurrent / totalPrev) * 100 : null;
  const costRatio = sales && sales > 0 ? (totalCurrent / sales) * 100 : null;
  const diff = totalCurrent - totalPrev;
  const diffStr = diff >= 0 ? `+${formatK(diff, 0)}` : formatK(diff, 0);
  const yoyStr = yoy != null ? formatPercent(yoy, 0) : "-";

  // 표시할 항목 결정: 브랜드는 상위 3개(ACC, APP, Branding), 상세보기 클릭 시 전체
  const displayOrder = isBrand ? AD_SUBCATEGORY_ORDER : AD_ROW_ORDER;
  const actualDisplayOrder = (isBrand && !showDetail) ? displayOrder.slice(0, 3) : displayOrder;

  return (
    <div className="w-full min-w-0">
      <Card className="relative overflow-hidden" style={{ borderColor: navyColor, borderWidth: "1px" }}>
        <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: navyBarColor }} />
        <CardHeader className="pl-5 pb-3">
          <CardTitle style={{ color: navyColor, fontSize: "21px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ width: "3px", height: "1em", backgroundColor: navyBarColor, display: "inline-block" }} />
              {t("광고비", lang)}
            </span>
            <span className="font-bold" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
              <span>
                {totalCurrent > 0 ? formatK(totalCurrent, 0) : "-"}
                {costRatio != null && ` (${costRatio.toFixed(1)}%)`}
              </span>
              <span style={{ fontSize: "0.85em" }}>
                {diffStr} ({yoyStr})
              </span>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pl-5">
          <hr className="border-gray-200 my-3" />
          <div style={{ fontSize: "60%" }}>
            <table className="w-full text-gray-700">
              <thead>
                <tr>
                  <th className="text-left py-1 pr-2 font-semibold">
                    {adNode && (isBrand || displayOrder.length > 3) && (
                      <button
                        onClick={() => setShowDetail(!showDetail)}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        {showDetail ? t("간략히", lang) : t("상세보기", lang)}
                      </button>
                    )}
                  </th>
                  <th className="text-right py-1 px-1 font-semibold">{t("전년", lang)}</th>
                  <th className="text-right py-1 px-1 font-semibold">{t("당년", lang)}</th>
                  <th className="text-right py-1 px-1 font-semibold">{t("전년비", lang)}</th>
                  <th className="text-right py-1 pl-1 font-semibold">YoY</th>
                </tr>
              </thead>
              <tbody>
                {actualDisplayOrder.map((key) => {
                  const curr = byBizCurrent.get(key) ?? 0;
                  const prev = byBizPrev.get(key) ?? 0;
                  const yoyRow = prev > 0 ? (curr / prev) * 100 : null;
                  const currStr = curr > 0 ? formatK(curr, 0) : "-";
                  const prevStr = prev > 0 ? formatK(prev, 0) : "-";
                  const diff = curr - prev;
                  const amountPart = (diff >= 0 ? "+" : "-") + formatK(Math.abs(diff), 0);
                  const percentPart = yoyRow != null ? formatPercent(yoyRow, 0) : "";
                  
                  // L2 노드 찾기 (소분류 데이터용)
                  const l2Node = adNode?.children?.find(
                    c => (isBrand ? c.category_l2 : c.biz_unit) === key
                  );
                  
                  // L3 children 필터링 (curr 값 > 0, showDetail === true일 때만)
                  const l3CurrVal = (c: ExpenseAccountRow) => useMonthly ? c.curr_month : c.curr_ytd;
                  const l3PrevVal = (c: ExpenseAccountRow) => useMonthly ? c.prev_month : c.prev_ytd;
                  const l3Children = showDetail && l2Node?.children 
                    ? l2Node.children.filter(c => l3CurrVal(c) > 0)
                    : [];

                  return (
                    <React.Fragment key={key}>
                      {/* L2 행 (브랜드 합계 또는 소분류) */}
                      <tr>
                        <td className="text-left py-0.5 pr-2 font-semibold">{getDisplayLabel(key, isBrand ? l2Node?.category_l2_cn : l2Node?.biz_unit_cn, lang)}</td>
                        <td className="text-right py-0.5 px-1">{prevStr}</td>
                        <td className="text-right py-0.5 px-1">{currStr}</td>
                        <td className="text-right py-0.5 px-1">{amountPart || "-"}</td>
                        <td className="text-right py-0.5 pl-1">{percentPart || "-"}</td>
                      </tr>
                      
                      {/* L3 행들 (소분류) - showDetail이 true면 자동으로 표시 */}
                      {l3Children.map((l3, idx) => {
                        const l3Curr = l3CurrVal(l3);
                        const l3Prev = l3PrevVal(l3);
                        const l3Yoy = l3Prev > 0 ? (l3Curr / l3Prev) * 100 : null;
                        const l3Diff = l3Curr - l3Prev;
                        const l3AmountPart = (l3Diff >= 0 ? "+" : "-") + formatK(Math.abs(l3Diff), 0);
                        const l3PercentPart = l3Yoy != null ? formatPercent(l3Yoy, 0) : "";
                        return (
                          <tr key={`${key}-${idx}`} className="text-gray-600">
                            <td className="text-left py-0.5 pr-2 pl-4">
                              - {getDisplayLabel(l3.category_l3 || "-", l3.category_l3_cn, lang)}
                            </td>
                            <td className="text-right py-0.5 px-1">{l3Prev > 0 ? formatK(l3Prev, 0) : "-"}</td>
                            <td className="text-right py-0.5 px-1">{formatK(l3Curr, 0)}</td>
                            <td className="text-right py-0.5 px-1">{l3AmountPart || "-"}</td>
                            <td className="text-right py-0.5 pl-1">{l3PercentPart || "-"}</td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
