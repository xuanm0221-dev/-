"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCategoryDetail, type BizUnit } from "@/lib/expenseData";
import { formatK, formatPercent } from "@/lib/utils";
import { ExpenseAccountRow } from "@/types/expense";
import { useLanguage } from "@/contexts/LanguageContext";
import { t, getDisplayLabel } from "@/lib/translations";

const navyColor = "#001f3f";
const navyBarColor = "#5b7cba";

interface PaymentFeeCardProps {
  bizUnit: BizUnit;
  year: number;
  month: number;
  paymentNode?: ExpenseAccountRow | null;
  yearType?: 'actual' | 'plan';
  /** 실적(actual)일 때만 전달: 당월/누적 구분 */
  mode?: import("@/lib/expenseData").Mode;
  sales?: number;
  prevSales?: number;
}

function sumByKey(details: { cost_lv2: string; amount: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  details.forEach((d) => {
    const key = d.cost_lv2 || "";
    if (key.trim() !== "") {
      map.set(key, (map.get(key) || 0) + d.amount);
    }
  });
  return map;
}

function totalExpense(details: { amount: number }[]): number {
  return details.reduce((s, d) => s + d.amount, 0);
}

export function PaymentFeeCard({ bizUnit, year, month, paymentNode, yearType, mode = "ytd", sales, prevSales }: PaymentFeeCardProps) {
  const { lang } = useLanguage();
  const [showDetail, setShowDetail] = useState(false);
  const useMonthly = mode === "monthly";

  // paymentNode가 제공되면 계층형 데이터 사용, 아니면 기존 로직 사용
  let totalCurrent: number;
  let totalPrev: number;
  let l2Children: ExpenseAccountRow[] = [];

  if (paymentNode) {
    // 계층형 표에서 받은 데이터 사용 (실적 당월 모드면 curr_month/prev_month)
    totalCurrent = useMonthly ? paymentNode.curr_month : paymentNode.curr_ytd;
    totalPrev = useMonthly ? paymentNode.prev_month : paymentNode.prev_ytd;
    l2Children = paymentNode.children || [];
  } else {
    // 기존 로직: getCategoryDetail 사용
    const dataMode = useMonthly ? "monthly" : "ytd";
    const detailCurrent = getCategoryDetail(bizUnit, year, month, "지급수수료", dataMode, yearType);
    const detailPrev = getCategoryDetail(bizUnit, year - 1, month, "지급수수료", dataMode, yearType);

    totalCurrent = totalExpense(detailCurrent);
    totalPrev = totalExpense(detailPrev);

    // L2로 그룹화
    const currMap = sumByKey(detailCurrent);
    const prevMap = sumByKey(detailPrev);
    
    const allKeys = new Set([...currMap.keys(), ...prevMap.keys()]);
    l2Children = Array.from(allKeys).map(key => ({
      id: `payment-l2-${key}`,
      level: 2 as const,
      category_l1: "지급수수료",
      category_l2: key,
      category_l3: "",
      prev_month: useMonthly ? (prevMap.get(key) || 0) : 0,
      curr_month: useMonthly ? (currMap.get(key) || 0) : 0,
      prev_ytd: useMonthly ? 0 : (prevMap.get(key) || 0),
      curr_ytd: useMonthly ? 0 : (currMap.get(key) || 0),
      prev_year_annual: null,
      curr_year_annual: null,
      description: "",
      isExpanded: false,
      children: [],
    }));
  }

  const yoy = totalPrev > 0 ? (totalCurrent / totalPrev) * 100 : null;
  const costRatio = sales && sales > 0 ? (totalCurrent / sales) * 100 : null;
  const diff = totalCurrent - totalPrev;
  const diffStr = diff >= 0 ? `+${formatK(diff, 0)}` : formatK(diff, 0);
  const yoyStr = yoy != null ? formatPercent(yoy, 0) : "-";
  const currVal = (row: ExpenseAccountRow) => useMonthly ? row.curr_month : row.curr_ytd;
  const prevVal = (row: ExpenseAccountRow) => useMonthly ? row.prev_month : row.prev_ytd;
  const sortedL2Children = [...l2Children].sort((a, b) => (currVal(b) || 0) - (currVal(a) || 0));
  const displayL2Children = showDetail ? sortedL2Children : sortedL2Children.slice(0, 5);

  return (
    <div className="w-full min-w-0">
      <Card className="relative overflow-hidden" style={{ borderColor: navyColor, borderWidth: "1px" }}>
        <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: navyBarColor }} />
        <CardHeader className="pl-5 pb-3">
          <CardTitle style={{ color: navyColor, fontSize: "21px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ width: "3px", height: "1em", backgroundColor: navyBarColor, display: "inline-block" }} />
              {t("지급수수료", lang)}
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
                    {paymentNode && (
                      <div className="flex flex-col items-start">
                        <button
                          onClick={() => setShowDetail(!showDetail)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          {showDetail ? t("간략히", lang) : t("상세보기", lang)}
                        </button>
                        {!showDetail && (
                          <span className="text-gray-500 font-normal text-[10px]">{t("기본: 당년 기준 상위 5개", lang)}</span>
                        )}
                      </div>
                    )}
                  </th>
                  <th className="text-right py-1 px-1 font-semibold">{t("전년", lang)}</th>
                  <th className="text-right py-1 px-1 font-semibold">{t("당년", lang)}</th>
                  <th className="text-right py-1 px-1 font-semibold">{t("전년비", lang)}</th>
                  <th className="text-right py-1 pl-1 font-semibold">YoY</th>
                </tr>
              </thead>
              <tbody>
                {displayL2Children.map((l2Child, idx) => {
                  const curr = currVal(l2Child);
                  const prev = prevVal(l2Child);
                  const yoyRow = prev > 0 ? (curr / prev) * 100 : null;
                  const currStr = curr > 0 ? formatK(curr, 0) : "-";
                  const prevStr = prev > 0 ? formatK(prev, 0) : "-";
                  const diff = curr - prev;
                  const amountPart = (diff >= 0 ? "+" : "-") + formatK(Math.abs(diff), 0);
                  const percentPart = yoyRow != null ? formatPercent(yoyRow, 0) : "";
                  const label = getDisplayLabel(
                    l2Child.category_l2 || l2Child.biz_unit || "-",
                    l2Child.category_l2_cn ?? l2Child.biz_unit_cn,
                    lang
                  );

                  const l3CurrVal = (c: ExpenseAccountRow) => useMonthly ? c.curr_month : c.curr_ytd;
                  const l3PrevVal = (c: ExpenseAccountRow) => useMonthly ? c.prev_month : c.prev_ytd;
                  const l3Children = showDetail && l2Child.children 
                    ? l2Child.children.filter(c => l3CurrVal(c) > 0)
                    : [];

                  return (
                    <React.Fragment key={idx}>
                      {/* L2 행 (중분류) */}
                      <tr>
                        <td className="text-left py-0.5 pr-2 font-semibold">{label}</td>
                        <td className="text-right py-0.5 px-1">{prevStr}</td>
                        <td className="text-right py-0.5 px-1">{currStr}</td>
                        <td className="text-right py-0.5 px-1">{amountPart || "-"}</td>
                        <td className="text-right py-0.5 pl-1">{percentPart || "-"}</td>
                      </tr>

                      {/* L3 행들 (소분류) - showDetail이 true면 자동으로 표시 */}
                      {l3Children.map((l3, l3Idx) => {
                        const l3Curr = l3CurrVal(l3);
                        const l3Prev = l3PrevVal(l3);
                        const l3Yoy = l3Prev > 0 ? (l3Curr / l3Prev) * 100 : null;
                        const l3Diff = l3Curr - l3Prev;
                        const l3AmountPart = (l3Diff >= 0 ? "+" : "-") + formatK(Math.abs(l3Diff), 0);
                        const l3PercentPart = l3Yoy != null ? formatPercent(l3Yoy, 0) : "";
                        return (
                          <tr key={`${idx}-${l3Idx}`} className="text-gray-600">
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
