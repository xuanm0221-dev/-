"use client";

import { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  ReferenceLine,
  LabelList,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatK, formatPercent } from "@/lib/utils";
import {
  getMonthlyStackedData,
  type BizUnit,
  type Mode,
} from "@/lib/expenseData";
import { EXPENSE_COLOR_MAP } from "@/lib/expenseColors";
import { useLanguage } from "@/contexts/LanguageContext";
import { t, getDisplayLabel } from "@/lib/translations";

interface MonthlyStackedChartProps {
  bizUnit: BizUnit;
  year: number;
  mode: Mode;
  yearType?: 'actual' | 'plan';
}

export function MonthlyStackedChart({
  bizUnit,
  year,
  mode,
  yearType = 'actual',
}: MonthlyStackedChartProps) {
  const { lang } = useLanguage();
  const [axisFontSize, setAxisFontSize] = useState(11);
  useEffect(() => {
    const update = () => setAxisFontSize(window.innerWidth < 640 ? 10 : window.innerWidth < 1024 ? 11 : 12);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  // 막대 내부 라벨 표시 대상 (참고 디자인 기준)
  const IN_BAR_LABEL_CATS = new Set(["광고비", "인건비", "복리후생비", "수주회"]);
  const { data, categoryLabelMap } = getMonthlyStackedData(bizUnit, year, mode, yearType);

  // 모든 대분류 수집
  const allCategories = new Set<string>();
  data.forEach((item) => {
    Object.keys(item.categories).forEach((cat) => allCategories.add(cat));
  });

  // 범례 순서 정의 (사업부별로 다름)
  const isCommon = bizUnit === "공통";
  const isCorporate = bizUnit === "법인";
  
  let categoryOrder: string[];
  if (isCommon) {
    categoryOrder = ["임차료", "IT수수료", "세금과공과", "복리후생비", "지급수수료", "차량렌트비", "기타"];
  } else if (isCorporate) {
    // 법인: 브랜드 + 공통 카테고리 포함
    categoryOrder = ["광고비", "인건비", "복리후생비", "임차료", "IT수수료", "지급수수료", "출장비", "감가상각비"];
  } else {
    // 개별 브랜드
    categoryOrder = ["광고비", "인건비", "복리후생비", "수주회", "지급수수료", "출장비", "감가상각비"];
  }
  
  // 지정된 순서대로 정렬하고, 없는 카테고리는 뒤에 추가
  const categories = [
    ...categoryOrder.filter((cat) => allCategories.has(cat)),
    ...Array.from(allCategories).filter((cat) => !categoryOrder.includes(cat)).sort(),
  ];

  // 차트 데이터 포맷팅 — 데이터가 없는 미래 월은 yoy=null 로 (라인 자연 종료)
  const chartData = data.map((item) => {
    const hasData = (item.current ?? 0) !== 0 || Object.values(item.categories ?? {}).some((v) => (v ?? 0) !== 0);
    const result: any = {
      month: `${item.month}${t("월", lang)}`,
      yoy: hasData ? item.yoy : null,
      current: item.current,
      previous: item.previous,
    };
    categories.forEach((cat) => {
      result[cat] = item.categories[cat] || 0;
    });
    return result;
  });

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      // chartData에서 직접 YOY 값 찾기 (payload에 Line 데이터가 포함되지 않을 수 있음)
      const monthData = chartData.find((d: any) => d.month === label);
      const yoyValue = monthData?.yoy;
      
      // 카테고리별 데이터 필터링 (yoy, current, previous 제외)
      const categoryPayloads = payload.filter(
        (p: any) => p.dataKey !== "yoy" && p.dataKey !== "current" && p.dataKey !== "previous"
      );
      
      // 합계 계산
      const total = categoryPayloads.reduce((sum: number, p: any) => sum + (p.value || 0), 0);
      
      return (
        <div className="bg-white p-2 border rounded shadow-lg text-[11px]">
          <p className="font-semibold mb-1.5">{label}</p>
          {categoryPayloads.map((p: any) => (
            <p key={p.dataKey} style={{ color: p.color }} className="leading-snug">
              {getDisplayLabel(p.dataKey, categoryLabelMap[p.dataKey], lang)}: {formatK(p.value)}
            </p>
          ))}
          <p className="mt-1.5 pt-1.5 border-t border-gray-200 font-semibold">
            {t("합계", lang)}: {formatK(total)}
          </p>
          {yoyValue !== null && yoyValue !== undefined && (
            <p className="mt-1 font-semibold">
              YOY: {formatPercent(yoyValue, 0)}
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="font-bold text-[13px] sm:text-sm">{t("월별 비용 추이 및 YOY 비교", lang)} <span className="text-slate-400 font-normal text-[11px]">(CNY K)</span></CardTitle>
        <p className="text-[11px] text-slate-500 mt-0.5">
          {t("기준월을 끝으로 하는 연속 13개월. 대분류 구성 및 전년 동월 대비 증감률(지수%, 전년=100)", lang)}
        </p>
      </CardHeader>
      <CardContent className="pt-2">
        <ResponsiveContainer width="100%" height={380}>
          <ComposedChart
            data={chartData}
            margin={{ left: 12, right: 12, top: 20, bottom: 4 }}
            barCategoryGap="18%"
          >
            <CartesianGrid strokeDasharray="3 7" stroke="#e7edf5" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fill: "#64748b", fontSize: axisFontSize }}
              axisLine={{ stroke: "#cbd5e1" }}
              tickLine={{ stroke: "#94a3b8" }}
            />
            <YAxis
              yAxisId="left"
              tick={{ fill: "#64748b", fontSize: axisFontSize }}
              axisLine={{ stroke: "#cbd5e1" }}
              tickLine={{ stroke: "#94a3b8" }}
              tickFormatter={(value) => `${Math.round(value / 1000).toLocaleString()}K`}
              width={60}
              label={{ value: "금액 (K)", position: "top", offset: 12, fill: "#64748b", fontSize: axisFontSize }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: "#64748b", fontSize: axisFontSize }}
              axisLine={{ stroke: "#cbd5e1" }}
              tickLine={{ stroke: "#94a3b8" }}
              domain={[0, "dataMax + 10"]}
              tickFormatter={(value) => `${Math.round(value)}%`}
              width={44}
              label={{ value: "YOY (지수%)", position: "top", offset: 12, fill: "#e11d48", fontSize: axisFontSize }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              iconType="circle"
              iconSize={6}
              wrapperStyle={{ paddingTop: "6px", fontSize: 9 }}
            />
            {categories.map((cat, i) => {
              const isLast = i === categories.length - 1;
              return (
                <Bar
                  key={cat}
                  yAxisId="left"
                  dataKey={cat}
                  stackId="a"
                  fill={EXPENSE_COLOR_MAP[cat] || "#94a3b8"}
                  name={getDisplayLabel(cat, categoryLabelMap[cat], lang)}
                  maxBarSize={44}
                  {...(isLast ? { radius: [4, 4, 0, 0] as [number, number, number, number] } : {})}
                >
                  {/* 특정 카테고리만 막대 안에 라벨 표시 (수량이 적으면 안 보임) */}
                  {IN_BAR_LABEL_CATS.has(cat) && (
                    <LabelList
                      dataKey={cat}
                      position="center"
                      content={(props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: number | string }) => {
                        const { x = 0, y = 0, width = 0, height = 0 } = props;
                        const nx = Number(x); const ny = Number(y);
                        const nw = Number(width); const nh = Number(height);
                        const label = getDisplayLabel(cat, categoryLabelMap[cat], lang);
                        // 폰트 크기: 막대 너비/글자수 기준 안전 계산 (한글은 폰트 크기와 거의 1:1)
                        const maxByWidth = Math.floor((nw - 4) / Math.max(label.length, 1));
                        const maxByHeight = Math.floor(nh - 4);
                        const fontSize = Math.min(10, Math.min(maxByWidth, maxByHeight));
                        // 최소 6px 미만이면 표시 생략 (넘침 방지)
                        if (fontSize < 6 || nh < 12) return <g />;
                        return (
                          <text
                            x={nx + nw / 2}
                            y={ny + nh / 2}
                            fill="#111827"
                            fontSize={fontSize}
                            fontWeight={600}
                            textAnchor="middle"
                            dominantBaseline="middle"
                          >
                            {label}
                          </text>
                        );
                      }}
                    />
                  )}
                </Bar>
              );
            })}
            {/* 100% 기준선 */}
            <ReferenceLine
              yAxisId="right"
              y={100}
              stroke="#cbd5e1"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="yoy"
              stroke="#e11d48"
              strokeWidth={2.5}
              dot={{ fill: "#ffffff", stroke: "#e11d48", strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6, fill: "#e11d48", stroke: "#ffffff", strokeWidth: 2 }}
              name={t("YOY (%)", lang)}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
        {bizUnit === "MLB" && (
          <p className="text-xs text-gray-400 mt-2 text-center">
            전년 3월 성과급 조정 영향으로 영업비용이 일시적으로 마이너스 발생하여, YoY 비교가 불가함에 따라 추세선이 단절
          </p>
        )}
      </CardContent>
    </Card>
  );
}

