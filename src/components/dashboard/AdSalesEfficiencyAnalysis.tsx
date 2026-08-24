"use client";

import { useState, useEffect } from "react";
import {
  ComposedChart,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getAdSalesAnalysisData,
  type BizUnit,
} from "@/lib/expenseData";
import {
  calculateCorrelation,
  calculateLinearRegression,
  calculateChangeRate,
  calculateROAS,
  calculateROI,
  calculateEfficiencyGrade,
  findOptimalAdSpendRange,
  detectSaturationPoint,
  generateComprehensiveInsights,
  computeAdSpendQuartiles,
  interpretQuartileAnalysis,
} from "@/lib/statsUtils";
import { formatK, formatM, formatPercent, formatRangeWithCommas } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { t } from "@/lib/translations";
import { AlertTriangle, Target } from "lucide-react";

interface AdSalesEfficiencyAnalysisProps {
  bizUnit: BizUnit;
  year: number;
  mode?: "yoy" | "mom";
  yearType?: 'actual' | 'plan';
}

export function AdSalesEfficiencyAnalysis({
  bizUnit,
  year,
  mode = "yoy",
  yearType = 'actual',
}: AdSalesEfficiencyAnalysisProps) {
  const { lang } = useLanguage();
  const [axisFontSize, setAxisFontSize] = useState(11);
  useEffect(() => {
    const update = () => setAxisFontSize(window.innerWidth < 640 ? 10 : window.innerWidth < 1024 ? 11 : 12);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // 데이터 가져오기
  const data = getAdSalesAnalysisData(bizUnit, year, yearType);

  // 데이터 부족 시 안내 메시지
  if (data.length < 3) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("광고비-매출 효율 분석", lang)}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            {t("광고비-매출 분석을 위한 데이터가 부족합니다. (최소 3개월 필요)", lang)}
          </div>
        </CardContent>
      </Card>
    );
  }

  // 기본 통계 계산
  const adSpends = data.map((d) => d.adSpend);
  const sales = data.map((d) => d.sales);
  const correlation = calculateCorrelation(adSpends, sales);
  const regression = calculateLinearRegression(adSpends, sales);

  // ROAS & ROI 계산
  const monthlyROAS = data.map((d) => ({
    month: `${d.month}월`,
    monthNum: d.month,
    roas: calculateROAS(d.sales, d.adSpend),
    roi: calculateROI(d.sales, d.adSpend),
    adSpend: d.adSpend,
    sales: d.sales,
  }));

  const avgROAS =
    monthlyROAS.reduce((sum, d) => sum + d.roas, 0) / monthlyROAS.length;
  const avgROI =
    monthlyROAS.reduce((sum, d) => sum + d.roi, 0) / monthlyROAS.length;
  const maxAdSpend =
    monthlyROAS.length > 0
      ? Math.max(...monthlyROAS.map((d) => d.adSpend))
      : 0;

  // 고급 분석
  const efficiencyGrade = calculateEfficiencyGrade(correlation, avgROAS);
  const { ranges: optimalRanges, optimal: optimalRange } =
    findOptimalAdSpendRange(data);
  const saturation = detectSaturationPoint(data);

  // 종합 인사이트
  const insights = generateComprehensiveInsights(
    correlation,
    avgROAS,
    avgROI,
    efficiencyGrade,
    optimalRange,
    saturation
  );

  // 광고비 구간별 (하/중/상 25%)
  const quartileSegments = computeAdSpendQuartiles(data);
  const quartileInterpretation = interpretQuartileAnalysis(quartileSegments);

  // 증감률 데이터
  const changeRateData = data
    .map((d) => {
      const adSpendChange =
        mode === "yoy"
          ? calculateChangeRate(d.adSpend, d.adSpendPrevYear)
          : null;
      const salesChange =
        mode === "yoy" ? calculateChangeRate(d.sales, d.salesPrevYear) : null;

      if (adSpendChange === null || salesChange === null) {
        return null;
      }

      return {
        month: `${d.month}월`,
        adSpendChange,
        salesChange,
      };
    })
    .filter((item) => item !== null);

  // 탄력도
  const avgAdSpendChange =
    changeRateData.length > 0
      ? changeRateData.reduce((sum, d) => sum + d!.adSpendChange, 0) /
        changeRateData.length
      : 0;
  const avgSalesChange =
    changeRateData.length > 0
      ? changeRateData.reduce((sum, d) => sum + d!.salesChange, 0) /
        changeRateData.length
      : 0;
  const elasticity =
    avgAdSpendChange !== 0 ? avgSalesChange / avgAdSpendChange : 0;

  const navyColor = "#001f3f";

  return (
    <div className="space-y-6">
      {/* 광고비 효율분석 (통합 섹션) */}
      <Card style={{ borderColor: navyColor, borderWidth: "1px" }}>
        <div
          className="absolute left-0 top-0 bottom-0 w-1"
          style={{ backgroundColor: navyColor }}
        />
        <CardHeader className="pl-5">
          <CardTitle className="text-[19px] font-bold tracking-tight" style={{ color: navyColor }}>
            {t("광고비 효율분석", lang)}
          </CardTitle>
        </CardHeader>
        <CardContent className="pl-5">
          <div className="flex flex-wrap items-stretch gap-3">
            {/* 평균 ROAS + 월별 표 (git 참고) */}
            <div className="min-w-[240px] border border-gray-200 rounded-lg p-3 bg-white">
              <div className="text-[10px] font-semibold mb-1" style={{ color: navyColor }}>평균 ROAS</div>
              <div className="text-[18px] font-bold mb-1" style={{ color: navyColor }}>{avgROAS.toFixed(2)}</div>
              <div className="text-[10px] text-gray-500 mb-1.5">= 월별 ROAS 평균 (매출 ÷ 광고비)</div>
              <table className="w-full text-[10px] border border-gray-200 border-collapse">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-1.5 py-0.5 border border-gray-200 text-left font-semibold text-gray-700">{t("월", lang)}</th>
                    <th className="px-1.5 py-0.5 border border-gray-200 text-right font-semibold text-gray-700">{t("매출", lang)}(M)</th>
                    <th className="px-1.5 py-0.5 border border-gray-200 text-right font-semibold text-gray-700">{t("광고비", lang)}(K)</th>
                    <th className="px-1.5 py-0.5 border border-gray-200 text-right font-semibold text-gray-700">ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const totalSales = monthlyROAS.reduce((s, d) => s + d.sales, 0);
                    const totalAd = monthlyROAS.reduce((s, d) => s + d.adSpend, 0);
                    const roasSum = totalAd > 0 ? totalSales / totalAd : 0;
                    const fmt = (n: number) => Math.round(n).toLocaleString();
                    return (
                      <tr className="bg-slate-100 font-bold">
                        <td className="px-1.5 py-0.5 border border-gray-200" style={{ color: navyColor }}>{t("합계", lang)}</td>
                        <td className="px-1.5 py-0.5 border border-gray-200 text-right" style={{ color: navyColor }}>{fmt(totalSales / 1_000_000)}</td>
                        <td className="px-1.5 py-0.5 border border-gray-200 text-right" style={{ color: navyColor }}>{fmt(totalAd / 1000)}</td>
                        <td className="px-1.5 py-0.5 border border-gray-200 text-right" style={{ color: navyColor }}>{roasSum.toFixed(2)}</td>
                      </tr>
                    );
                  })()}
                  {monthlyROAS.map(d => {
                    const fmt = (n: number) => Math.round(n).toLocaleString();
                    return (
                      <tr key={d.month}>
                        <td className="px-1.5 py-0.5 border border-gray-200 text-gray-700">{d.month}</td>
                        <td className="px-1.5 py-0.5 border border-gray-200 text-right text-gray-700">{fmt(d.sales / 1_000_000)}</td>
                        <td className="px-1.5 py-0.5 border border-gray-200 text-right text-gray-700">{fmt(d.adSpend / 1000)}</td>
                        <td className="px-1.5 py-0.5 border border-gray-200 text-right font-bold" style={{ color: navyColor }}>{d.roas.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div
              className="flex items-center gap-3 px-3 py-2 rounded-lg border-2 min-w-[200px]"
              style={{
                backgroundColor: efficiencyGrade.bgColor,
                borderColor: efficiencyGrade.color,
              }}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold border-2 flex-shrink-0"
                style={{
                  color: efficiencyGrade.color,
                  borderColor: efficiencyGrade.color,
                }}
              >
                {efficiencyGrade.grade}
              </div>
              <div className="min-w-0 space-y-0.5">
                <div className="text-[10px] font-bold" style={{ color: efficiencyGrade.color }}>
                  광고 효율 등급
                </div>
                <div className="text-[10px] mt-0.5 leading-snug" style={{ color: efficiencyGrade.color }}>
                  <span className="font-medium">판정 이유: </span>
                  {efficiencyGrade.reason}
                </div>
                <div className="text-[10px] leading-snug" style={{ color: efficiencyGrade.color }}>
                  <span className="font-medium">권장 액션: </span>
                  {efficiencyGrade.action}
                </div>
                {saturation.hasSaturation && (
                  <div className="text-[10px] leading-snug" style={{ color: efficiencyGrade.color }}>
                    <span className="font-medium">광고 포화 신호: </span>
                    {saturation.message}
                  </div>
                )}
              </div>
            </div>
            {/* 인사이트 1~6 세로 하나 카드로 통합 */}
            <Card className="flex-1 min-w-[220px] border rounded-lg p-3 bg-gray-50/80">
              <CardContent className="p-0">
                <div className="space-y-1.5">
                  {insights.slice(0, 6).map((insight, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-[9px] font-bold flex-shrink-0">
                        {index + 1}
                      </span>
                      <p className="text-[10px] text-gray-700 flex-1 leading-snug">{insight}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      {/* 2행: 월별 ROAS 추이 | 광고비 구간별 효율 분석 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 월별 ROAS 추이 (광고비/매출 막대 + ROAS 선, 이중 Y축) */}
      <Card style={{ borderColor: navyColor, borderWidth: "1px" }}>
        <div
          className="absolute left-0 top-0 bottom-0 w-1"
          style={{ backgroundColor: navyColor }}
        />
        <CardHeader className="pl-5">
          <CardTitle className="text-[13px] font-bold" style={{ color: navyColor }}>
            월별 ROAS 추이 (광고비 1CNY당 매출 추이) | 평균 {avgROAS.toFixed(2)}
          </CardTitle>
        </CardHeader>
        <CardContent className="pl-5">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart
              data={monthlyROAS}
              margin={{ top: 20, right: 70, bottom: 20, left: 20 }}
              barCategoryGap="25%"
              barGap={2}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: axisFontSize }} />
              <YAxis
                yAxisId="left"
                orientation="left"
                tick={{ fontSize: axisFontSize }}
                label={{
                  value: "ROAS",
                  angle: -90,
                  position: "insideLeft",
                  fontSize: axisFontSize,
                  fill: "#8b5cf6",
                }}
                stroke="#8b5cf6"
                width={40}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: axisFontSize }}
                label={{
                  value: "매출 (M)",
                  angle: 90,
                  position: "bottom",
                  dy: 40,
                  fontSize: axisFontSize,
                  fill: "#82ca9d",
                }}
                tickFormatter={(v) => formatM(v, 0)}
                stroke="#82ca9d"
              />
              <YAxis
                yAxisId="right2"
                orientation="right"
                tick={{ fontSize: axisFontSize }}
                domain={[0, (maxAdSpend || 1) * 3]}
                label={{
                  value: "광고비 (M)",
                  angle: 90,
                  position: "bottom",
                  dy: 40,
                  fontSize: axisFontSize,
                  fill: "#8884d8",
                }}
                tickFormatter={(v) => formatM(v, 0)}
                stroke="#8884d8"
                width={50}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-white p-3 border rounded shadow-lg">
                        <p className="font-semibold mb-2">{label}</p>
                        <p className="text-[11.5px]">ROAS: {data.roas.toFixed(2)}</p>
                        <p className="text-[11.5px]">광고비: {formatK(data.adSpend)}</p>
                        <p className="text-[11.5px]">매출: {formatK(data.sales)}</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Legend wrapperStyle={{ fontSize: axisFontSize }} iconSize={Math.min(14, axisFontSize)} />
              <ReferenceLine
                yAxisId="left"
                y={avgROAS}
                stroke="#999"
                strokeDasharray="3 3"
                label={{ value: "평균", position: "right" }}
              />
              <Bar
                yAxisId="right"
                dataKey="sales"
                fill="#82ca9d"
                name="매출"
                radius={[4, 4, 0, 0]}
                maxBarSize={22}
              />
              <Bar
                yAxisId="right2"
                dataKey="adSpend"
                fill="#8884d8"
                name="광고비"
                radius={[4, 4, 0, 0]}
                maxBarSize={22}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="roas"
                stroke="#dc2626"
                strokeWidth={3}
                name="ROAS"
                dot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* 광고비 구간별 효율 분석 — 2행 우측 (월별 ROAS 옆) */}
      {optimalRanges.length > 0 && (
        <Card style={{ borderColor: navyColor, borderWidth: "1px" }}>
          <div
            className="absolute left-0 top-0 bottom-0 w-1"
            style={{ backgroundColor: navyColor }}
          ></div>
          <CardHeader className="pl-5">
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5" style={{ color: navyColor }} />
              <CardTitle className="text-[13px] font-bold" style={{ color: navyColor }}>
                광고비 구간별 효율 분석
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pl-5">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={optimalRanges}
                margin={{ top: 20, right: 30, bottom: 44, left: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="range"
                  interval={0}
                  tick={({ x, y, payload }) => {
                    const value = (payload?.value ?? payload) as string;
                    const item = optimalRanges.find((r) => r.range === value);
                    const yOffset = 10;
                    return (
                      <text x={x} y={y + yOffset} textAnchor="middle" fontSize={axisFontSize} fill="#374151">
                        <tspan x={x} dy={0}>{formatRangeWithCommas(value)}</tspan>
                        <tspan x={x} dy={14}>
                          {item ? `ROAS ${item.avgROAS.toFixed(2)} | ${item.count}개월` : ""}
                        </tspan>
                      </text>
                    );
                  }}
                />
                <YAxis
                  label={{
                    value: "평균 ROAS",
                    angle: -90,
                    position: "insideLeft",
                  }}
                  tick={{ fontSize: axisFontSize }}
                />
                <Bar
                  dataKey="avgROAS"
                  fill="#10b981"
                  name="평균 ROAS"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={32}
                />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-3 text-[10.5px] bg-green-50 p-3 rounded-lg border border-green-200">
              <p className="font-semibold text-green-800 mb-1">해석</p>
              <p className="text-green-800 leading-snug">{optimalRange.recommendation}</p>
              <p className="text-green-700 mt-1.5 text-[10px] leading-snug">
                각 구간은 해당 기간 월별 광고비를 기준으로 나눈 뒤, 구간별 평균 ROAS를 비교한 결과입니다. ROAS가 높은 구간에 투자 비중을 두는 것이 효율적입니다.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      </div>

      {/* 3행: 광고비 구간별 분석 | 광고비-매출 증감률 비교 (YoY) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 2. 광고비 구간별 분석 (하/중/상 25%) */}
      {quartileSegments.length > 0 && (
        <Card style={{ borderColor: navyColor, borderWidth: "1px" }}>
          <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: navyColor }} />
          <CardHeader className="pl-5">
            <CardTitle className="text-[13px] font-bold" style={{ color: navyColor }}>광고비 구간별 분석</CardTitle>
          </CardHeader>
          <CardContent className="pl-5">
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">구간</th>
                    <th className="text-right py-2">평균 광고비</th>
                    <th className="text-right py-2">평균 매출</th>
                    <th className="text-right py-2">매출 YoY(%)</th>
                    <th className="text-right py-2">관측 수</th>
                  </tr>
                </thead>
                <tbody>
                  {quartileSegments.map((seg) => (
                    <tr key={seg.label} className="border-b">
                      <td className="py-2">{seg.label}</td>
                      <td className="py-2 text-right">{formatK(seg.avgAdSpend)}</td>
                      <td className="py-2 text-right">{formatK(seg.avgSales)}</td>
                      <td className="py-2 text-right">
                        {seg.salesGrowthYoY != null ? `${seg.salesGrowthYoY.toFixed(1)}%` : "-"}
                      </td>
                      <td className="py-2 text-right">{seg.count}개월</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={quartileSegments.map((s) => ({
                  name: `${s.label} (${formatM(s.avgAdSpend)})`,
                  avgSales: s.avgSales,
                  avgAdSpend: s.avgAdSpend,
                }))}
                margin={{ top: 20, right: 30, bottom: 20, left: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: axisFontSize }} />
                <YAxis tickFormatter={(v) => formatM(v, 0)} tick={{ fontSize: axisFontSize }} />
                <Tooltip formatter={(value: number) => formatM(value)} />
                <Bar dataKey="avgSales" name="평균 매출" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-3 space-y-2">
              <div className="text-[10px] bg-amber-50 p-3 rounded-lg border border-amber-200">
                <p className="font-semibold text-amber-900 mb-1 text-[10.5px]">읽는 법</p>
                <p className="text-amber-800 leading-snug">
                  월별 광고비를 하위 25%, 중간 50%, 상위 25%로 나눈 뒤, 각 구간의 평균 광고비·평균 매출·매출 YoY를 비교한 결과입니다.
                  하위 구간에서도 매출이 높다면 광고 외 요인이 크고, 상위 구간에서 매출이 뚜렷히 높다면 광고 투자 효과를 의심해 볼 수 있습니다.
                </p>
              </div>
              <div className="text-[10px] text-gray-600 bg-gray-50 p-2.5 rounded leading-snug">
                {quartileInterpretation}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 3. 광고비-매출 증감률 비교 (YoY) */}
      {changeRateData.length > 0 && (
        <Card style={{ borderColor: navyColor, borderWidth: "1px" }}>
          <div
            className="absolute left-0 top-0 bottom-0 w-1"
            style={{ backgroundColor: navyColor }}
          ></div>
          <CardHeader className="pl-5">
            <CardTitle className="text-[13px] font-bold" style={{ color: navyColor }}>
              광고비-매출 증감률 비교 (YoY)
              {elasticity !== 0 && (
                <span className="text-[11px] font-normal text-gray-600 ml-4">
                  탄력도: {elasticity.toFixed(2)}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pl-5">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart
                data={changeRateData}
                margin={{ top: 20, right: 30, bottom: 20, left: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: Math.max(10, Math.round(axisFontSize * 0.8)) }}
                />
                <YAxis
                  tickFormatter={(value) => `${value.toFixed(0)}%`}
                  tick={{ fontSize: Math.max(10, Math.round(axisFontSize * 0.8)) }}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-white p-3 border rounded shadow-lg">
                          <p className="font-semibold mb-2">{label}</p>
                          {payload.map((entry, index) => (
                            <p
                              key={index}
                              className="text-[11.5px]"
                              style={{ color: entry.color }}
                            >
                              {entry.name}: {formatPercent(entry.value as number, 1)}
                            </p>
                          ))}
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend wrapperStyle={{ fontSize: axisFontSize }} iconSize={Math.min(14, axisFontSize)} />
                <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
                <Line
                  type="monotone"
                  dataKey="adSpendChange"
                  stroke="#8884d8"
                  strokeWidth={2}
                  name="광고비 증감률"
                  dot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="salesChange"
                  stroke="#82ca9d"
                  strokeWidth={2}
                  name="매출 증감률"
                  dot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
            <div className="mt-4 text-[11.5px] bg-blue-50 p-4 rounded-lg border border-blue-200">
              <p className="font-semibold text-blue-900 mb-1">해석</p>
              <p className="text-blue-800">
                탄력도 {elasticity.toFixed(2)}는{" "}
                {elasticity > 1
                  ? "광고비 증가율보다 매출 증가율이 더 크게 나타나 광고 효율이 양호"
                  : elasticity > 0
                  ? "광고비 증가에 따라 매출도 증가하지만, 효율은 비례하지 않음"
                  : "광고비 증가가 매출 증가로 이어지지 않고 있음"}
                함을 의미합니다.
                {Math.abs(elasticity) < 0.5 && changeRateData.length > 0 && (
                  <span className="block mt-2 text-blue-700">
                    매출 증감이 광고비와 관계없이 변동이 크지 않다는 해석도 가능합니다. 계절성·외부 요인 등을 함께 보는 것이 좋습니다.
                  </span>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      </div>

      {/* 포화점 경고 */}
      {saturation.hasSaturation && (
        <Card className="border-orange-300 bg-orange-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-orange-600 flex-shrink-0" />
              <div>
                <div className="font-bold text-orange-900 mb-1">
                  광고 포화 신호 감지
                </div>
                <p className="text-[11.5px] text-orange-800">{saturation.message}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
