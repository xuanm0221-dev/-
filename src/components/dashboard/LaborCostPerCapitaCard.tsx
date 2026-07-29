"use client";

import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { getCategoryDetail, getAnnualHeadcountSum, getYTDHeadcountSum, getMonthlyTotal, type BizUnit, type Mode } from "@/lib/expenseData";
import { formatK, formatPercent } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { t } from "@/lib/translations";

const LABOR_COST_LV2_ORDER = ["기본급", "Red pack", "성과급충당금", "잡급"] as const;
/** 법인 상세보기 시 사업부 순서 및 표시명 (공통 = 경영지원) */
const SUB_UNIT_ORDER: { bizUnit: BizUnit; label: string }[] = [
  { bizUnit: "공통", label: "경영지원" },
  { bizUnit: "MLB", label: "MLB" },
  { bizUnit: "KIDS", label: "KIDS" },
  { bizUnit: "DISCOVERY", label: "DISCOVERY" },
];
const navyColor = "#001f3f";
const navyBarColor = "#5b7cba"; // 톤 다운된 파랑 (좌측 세로 바)

interface LaborCostPerCapitaCardProps {
  bizUnit: BizUnit;
  year: number;
  month: number;
  mode?: Mode;
  yearType?: 'actual' | 'plan';
}

function sumByLv2(details: { cost_lv1: string; cost_lv2: string; amount: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  details
    .filter((d) => d.cost_lv1 === "인건비" && (d.cost_lv2 || "").trim() !== "")
    .forEach((d) => {
      const key = d.cost_lv2;
      map.set(key, (map.get(key) || 0) + d.amount);
    });
  return map;
}

function totalLabor(details: { cost_lv1: string; amount: number }[]): number {
  return details
    .filter((d) => d.cost_lv1 === "인건비")
    .reduce((s, d) => s + d.amount, 0);
}

export function LaborCostPerCapitaCard({ bizUnit, year, month, mode = 'ytd', yearType = 'actual' }: LaborCostPerCapitaCardProps) {
  const { lang } = useLanguage();
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const isPlanYear = year === 2026 && yearType === 'plan';

  // 예산(2026 plan): 연간 비용/연간 인원수. 실적: mode에 따라 당월 vs YTD (분기 포함)
  const costMode: Mode = isPlanYear ? 'ytd' : mode;
  const detailCurrent = getCategoryDetail(bizUnit, year, month, "인건비", costMode, yearType);
  const detailPrev = isPlanYear
    ? getCategoryDetail(bizUnit, 2025, 12, "인건비", "ytd", 'actual')
    : getCategoryDetail(bizUnit, year - 1, month, "인건비", costMode, yearType);

  const headcountCurrent = isPlanYear
    ? getAnnualHeadcountSum(bizUnit, year, yearType)
    : costMode === 'monthly'
      ? (getMonthlyTotal(bizUnit, year, month, "monthly", yearType)?.headcount ?? 0)
      : getYTDHeadcountSum(bizUnit, year, month, yearType);
  const headcountPrev = isPlanYear
    ? getAnnualHeadcountSum(bizUnit, 2025, 'actual')
    : costMode === 'monthly'
      ? (getMonthlyTotal(bizUnit, year - 1, month, "monthly", yearType)?.headcount ?? 0)
      : getYTDHeadcountSum(bizUnit, year - 1, month, yearType);

  const totalCurrent = totalLabor(detailCurrent);
  const totalPrev = totalLabor(detailPrev);
  const perCapitaCurrent = headcountCurrent > 0 ? totalCurrent / headcountCurrent : null;
  const perCapitaPrev = headcountPrev > 0 ? totalPrev / headcountPrev : null;
  const yoyTotal =
    perCapitaCurrent != null && perCapitaPrev != null && perCapitaPrev !== 0
      ? (perCapitaCurrent / perCapitaPrev) * 100
      : null;

  const byLv2Current = sumByLv2(detailCurrent);
  const byLv2Prev = sumByLv2(detailPrev);

  // 사업부별(lv2 x biz_unit) 금액 집계 (법인일 때만 상세보기용)
  const detailByLv2AndBizCurrent = useMemo(() => {
    const map = new Map<string, Map<BizUnit, number>>();
    detailCurrent
      .filter((d) => d.cost_lv1 === "인건비" && (d.cost_lv2 || "").trim() !== "")
      .forEach((d) => {
        const bu = d.biz_unit as BizUnit;
        if (!SUB_UNIT_ORDER.some((s) => s.bizUnit === bu)) return;
        if (!map.has(d.cost_lv2)) map.set(d.cost_lv2, new Map());
        const inner = map.get(d.cost_lv2)!;
        inner.set(bu, (inner.get(bu) ?? 0) + d.amount);
      });
    return map;
  }, [detailCurrent]);
  const detailByLv2AndBizPrev = useMemo(() => {
    const map = new Map<string, Map<BizUnit, number>>();
    detailPrev
      .filter((d) => d.cost_lv1 === "인건비" && (d.cost_lv2 || "").trim() !== "")
      .forEach((d) => {
        const bu = d.biz_unit as BizUnit;
        if (!SUB_UNIT_ORDER.some((s) => s.bizUnit === bu)) return;
        if (!map.has(d.cost_lv2)) map.set(d.cost_lv2, new Map());
        const inner = map.get(d.cost_lv2)!;
        inner.set(bu, (inner.get(bu) ?? 0) + d.amount);
      });
    return map;
  }, [detailPrev]);

  const showDetailButton = bizUnit === "법인";

  const perCapitaDiff = perCapitaCurrent != null && perCapitaPrev != null ? perCapitaCurrent - perCapitaPrev : null;
  const diffStr = perCapitaDiff != null 
    ? (perCapitaDiff >= 0 ? `+${formatK(perCapitaDiff, 1)}` : formatK(perCapitaDiff, 1))
    : null;
  const yoyStr = yoyTotal != null ? formatPercent(yoyTotal, 0) : "-";

  return (
    <div className="w-full min-w-0">
      <Card className="relative overflow-hidden" style={{ borderColor: navyColor, borderWidth: "1px" }}>
        <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: navyBarColor }} />
        <CardHeader className="pl-5 pb-3">
          <CardTitle style={{ color: navyColor, fontSize: "21px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ width: "3px", height: "1em", backgroundColor: navyBarColor, display: "inline-block" }} />
              {t("인건비(인당)", lang)}
            </span>
            <span className="font-bold">
              {perCapitaCurrent != null ? formatK(perCapitaCurrent, 1) : "-"}
              {diffStr && ` (${diffStr}, ${yoyStr})`}
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
                    {showDetailButton && (
                      <button
                        type="button"
                        onClick={() => setIsDetailOpen(true)}
                        className="text-[10px] text-blue-600 hover:text-blue-800"
                      >
                        {t("상세보기", lang)}
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
                {LABOR_COST_LV2_ORDER.map((lv2) => {
                  const curr = byLv2Current.get(lv2) ?? 0;
                  const prev = byLv2Prev.get(lv2) ?? 0;
                  // Red pack은 연 1회 지급이라 월 나눌 필요 없음 (인원수 그대로 사용)
                  const pcCurr = headcountCurrent > 0 ? curr / headcountCurrent : null;
                  const pcPrev = headcountPrev > 0 ? prev / headcountPrev : null;
                  const yoy =
                    pcCurr != null && pcPrev != null && pcPrev !== 0 ? (pcCurr / pcPrev) * 100 : null;
                  const currStr = pcCurr != null ? formatK(pcCurr, 1) : "-";
                  const prevStr = pcPrev != null ? formatK(pcPrev, 1) : "-";
                  const diff = pcCurr != null && pcPrev != null ? pcCurr - pcPrev : null;
                  const amountPart = diff != null ? (diff >= 0 ? "+" : "-") + formatK(Math.abs(diff), 1) : "";
                  const percentPart = yoy != null ? formatPercent(yoy, 0) : "";
                  return (
                    <tr key={lv2}>
                      <td className="text-left py-0.5 pr-2">{t(lv2, lang)}:</td>
                      <td className="text-right py-0.5 px-1">{prevStr}</td>
                      <td className="text-right py-0.5 px-1">{currStr}</td>
                      <td className="text-right py-0.5 px-1">{amountPart || "-"}</td>
                      <td className="text-right py-0.5 pl-1">{percentPart || "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {showDetailButton && (
        <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen} contentClassName="max-w-4xl">
          <DialogContent className="max-h-[85vh] overflow-hidden flex flex-col">
            <DialogHeader className="flex-shrink-0">
              <DialogTitle>{t("인건비(인당) 상세 - 사업부별", lang)}</DialogTitle>
              <DialogClose onClick={() => setIsDetailOpen(false)} className="absolute right-4 top-4" />
            </DialogHeader>
            <div className="overflow-y-auto flex-1 min-h-0">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left py-2 px-3 font-semibold text-gray-700">{t("구분", lang)}</th>
                    <th className="text-right py-2 px-3 font-semibold text-gray-700">{t("전년인당(K)", lang)}</th>
                    <th className="text-right py-2 px-3 font-semibold text-gray-700">{t("당년인당(K)", lang)}</th>
                    <th className="text-right py-2 px-3 font-semibold text-gray-700">{t("전년비", lang)}</th>
                    <th className="text-right py-2 px-3 font-semibold text-gray-700">YoY</th>
                  </tr>
                </thead>
                <tbody>
                  {LABOR_COST_LV2_ORDER.map((lv2) => {
                    const innerCurrent = detailByLv2AndBizCurrent.get(lv2);
                    const innerPrev = detailByLv2AndBizPrev.get(lv2);
                    return (
                      <React.Fragment key={lv2}>
                        <tr className="border-b border-gray-100 bg-gray-50/80">
                          <td className="py-2 px-3 font-semibold text-gray-800" colSpan={5}>
                            {t(lv2, lang)}
                          </td>
                        </tr>
                        {SUB_UNIT_ORDER.map(({ bizUnit: bu, label }) => {
                          const currAmount = innerCurrent?.get(bu) ?? 0;
                          const prevAmount = innerPrev?.get(bu) ?? 0;
                          const currHc = isPlanYear
                            ? getAnnualHeadcountSum(bu, year, yearType)
                            : costMode === 'monthly'
                              ? (getMonthlyTotal(bu, year, month, "monthly", yearType)?.headcount ?? 0)
                              : getYTDHeadcountSum(bu, year, month, yearType);
                          const prevHc = isPlanYear
                            ? getAnnualHeadcountSum(bu, 2025, "actual")
                            : costMode === 'monthly'
                              ? (getMonthlyTotal(bu, year - 1, month, "monthly", yearType)?.headcount ?? 0)
                              : getYTDHeadcountSum(bu, year - 1, month, yearType);
                          // Red pack은 연 1회 지급이라 월 나눌 필요 없음 (인원수 그대로 사용)
                          const perCapitaCurr = currHc > 0 ? currAmount / currHc : null;
                          const perCapitaPrev = prevHc > 0 ? prevAmount / prevHc : null;
                          const yoy =
                            perCapitaCurr != null && perCapitaPrev != null && perCapitaPrev !== 0
                              ? (perCapitaCurr / perCapitaPrev) * 100
                              : null;
                          const diff = perCapitaCurr != null && perCapitaPrev != null ? perCapitaCurr - perCapitaPrev : null;
                          const amountPart = diff != null ? (diff >= 0 ? "+" : "-") + formatK(Math.abs(diff), 1) : "";
                          const percentPart = yoy != null ? formatPercent(yoy, 0) : "";
                          return (
                            <tr key={`${lv2}-${bu}`} className="border-b border-gray-100">
                              <td className="py-1.5 pl-6 pr-3 text-gray-600">ㄴ{t(label, lang)}</td>
                              <td className="py-1.5 px-3 text-right">
                                {perCapitaPrev != null ? formatK(perCapitaPrev, 1) : "-"}
                              </td>
                              <td className="py-1.5 px-3 text-right">
                                {perCapitaCurr != null ? formatK(perCapitaCurr, 1) : "-"}
                              </td>
                              <td className="py-1.5 px-3 text-right">{amountPart || "-"}</td>
                              <td className="py-1.5 px-3 text-right">{percentPart || "-"}</td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
