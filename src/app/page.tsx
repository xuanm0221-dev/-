"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Baby, Mountain, Building2, Building, BarChart3, Calendar, ChevronDown, Download, FileText, Bot, Microscope, LineChart, BarChart2, Table as TableIcon, type LucideIcon } from "lucide-react";
import React from "react";

// 야구공 아이콘 컴포넌트 (LucideIcon 타입과 호환)
const BaseballIcon = React.forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>(
  ({ className, ...props }, ref) => (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* 야구공 원형 윤곽선 */}
      <circle cx="12" cy="12" r="9" />
      {/* 위쪽 이음새 곡선 (왼쪽에서 중앙으로) */}
      <path d="M3 12 Q6 8 12 12" />
      {/* 위쪽 이음새 곡선 (오른쪽에서 중앙으로) */}
      <path d="M21 12 Q18 8 12 12" />
      {/* 위쪽 이음새의 스티치 (왼쪽) */}
      <line x1="4.5" y1="10" x2="4.5" y2="10.8" />
      <line x1="5.5" y1="9.5" x2="5.5" y2="10.3" />
      {/* 위쪽 이음새의 스티치 (오른쪽) */}
      <line x1="19.5" y1="10" x2="19.5" y2="10.8" />
      <line x1="18.5" y1="9.5" x2="18.5" y2="10.3" />
      {/* 아래쪽 이음새 곡선 (왼쪽에서 중앙으로) */}
      <path d="M3 12 Q6 16 12 12" />
      {/* 아래쪽 이음새 곡선 (오른쪽에서 중앙으로) */}
      <path d="M21 12 Q18 16 12 12" />
      {/* 아래쪽 이음새의 스티치 (왼쪽) */}
      <line x1="4.5" y1="14" x2="4.5" y2="13.2" />
      <line x1="5.5" y1="14.5" x2="5.5" y2="13.7" />
      {/* 아래쪽 이음새의 스티치 (오른쪽) */}
      <line x1="19.5" y1="14" x2="19.5" y2="13.2" />
      <line x1="18.5" y1="14.5" x2="18.5" y2="13.7" />
    </svg>
  )
) as LucideIcon;

BaseballIcon.displayName = "BaseballIcon";
import { BrandCard } from "@/components/dashboard/BrandCard";
import { BrandDropdown } from "@/components/dashboard/BrandDropdown";
import { ExpenseAccountHierTable } from "@/components/dashboard/ExpenseAccountHierTable";
import { AdSalesEfficiencyAnalysis } from "@/components/dashboard/AdSalesEfficiencyAnalysis";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { LaborCostPerCapitaCard } from "@/components/dashboard/LaborCostPerCapitaCard";
import { AdExpenseCard } from "@/components/dashboard/AdExpenseCard";
import { ITFeeCard } from "@/components/dashboard/ITFeeCard";
import { PaymentFeeCard } from "@/components/dashboard/PaymentFeeCard";
import { CategoryExpenseCard } from "@/components/dashboard/CategoryExpenseCard";
import { MonthlyStackedChart } from "@/components/dashboard/MonthlyStackedChart";
import { CategoryDrilldown } from "@/components/dashboard/CategoryDrilldown";
import { ReportModal } from "@/components/dashboard/ReportModal";
import { AIReportModal } from "@/components/dashboard/AIReportModal";
import { DeepAnalysisModal } from "@/components/dashboard/DeepAnalysisModal";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  getAvailableYears,
  getAvailableMonths,
  getAvailableQuarters,
  getAvailableYearOptions,
  type Mode,
  type YearOption,
} from "@/lib/expenseData";
import { calculateYOY } from "@/lib/utils";
import { getAnnualData, getMonthlyTotal, type BizUnit } from "@/lib/expenseData";
import { getLatestYearOption, getLatestMonth } from "@/lib/dashboardDefaults";
import { useLanguage } from "@/contexts/LanguageContext";
import { t } from "@/lib/translations";
import { LanguageToggle } from "@/components/dashboard/LanguageToggle";

const MAIN_BRAND_CONFIG = [
  { bizUnit: "법인" as const, brandColor: "#7c3aed", brandInitial: "법", brandName: "법인", icon: Building },
  { bizUnit: "MLB" as const, brandColor: "#3b82f6", brandInitial: "M", brandName: "MLB", icon: BaseballIcon },
  { bizUnit: "KIDS" as const, brandColor: "#ef4444", brandInitial: "K", brandName: "KIDS", icon: Baby },
  { bizUnit: "DISCOVERY" as const, brandColor: "#10b981", brandInitial: "D", brandName: "DISCOVERY", icon: Mountain },
  { bizUnit: "공통" as const, brandColor: "#6b7280", brandInitial: "공", brandName: "공통", icon: Building2 },
];

export default function HomePage() {
  const { lang } = useLanguage();
  const availableYearOptions = getAvailableYearOptions();

  // 진입 시 항상 최신 실적 연도 + 가장 최근 가용 월
  const initialYearOption = getLatestYearOption();
  const initialMonth = getLatestMonth(initialYearOption);
  const initialMode: Mode = "monthly";

  const [yearOption, setYearOption] = useState<YearOption>(initialYearOption);
  const [month, setMonth] = useState<number>(initialMonth);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isAIReportOpen, setIsAIReportOpen] = useState(false);
  const [isDeepAnalysisOpen, setIsDeepAnalysisOpen] = useState(false);
  // 홈 상단 카드에서 선택 중인 사업부 (드롭다운 셀렉터로 전환)
  const [selectedBrandBizUnit, setSelectedBrandBizUnit] = useState<BizUnit>("법인");
  // 우측 5-탭 스위처 선택 상태
  type RightTab = "detail" | "adEfficiency" | "kpi" | "ai" | "deep";
  const [rightTab, setRightTab] = useState<RightTab>("detail");

  const isPlanYear = yearOption.year === 2026 && yearOption.type === 'plan';
  const availableMonths = getAvailableMonths(yearOption.year, yearOption.type);
  const availableQuarters = getAvailableQuarters(yearOption.year, yearOption.type);
  const homeExportRef = useRef<HTMLDivElement>(null);

  const handleDownloadHtml = useCallback(() => {
    if (!homeExportRef.current) return;
    const inner = homeExportRef.current.innerHTML;
    const title = `홈 대시보드 ${yearOption.year}년 예산`;
    const fullDoc = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title><script src="https://cdn.tailwindcss.com"></script><style>body{font-family:system-ui,sans-serif;}</style></head><body class="p-4 bg-gray-50">${inner}</body></html>`;
    const blob = new Blob([fullDoc], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `home-dashboard-${yearOption.year}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [yearOption.year]);

  useEffect(() => {
    // 2026년(예산)이면 12월로 고정, mode도 ytd로 고정
    if (isPlanYear) {
      if (month !== 12) setMonth(12);
      if (mode !== 'ytd') setMode('ytd');
    } else if (availableMonths.length > 0 && !availableMonths.includes(month)) {
      setMonth(availableMonths[availableMonths.length - 1]);
    }
  }, [yearOption, availableMonths, month, isPlanYear, mode]);

  return (
    <>
    <div className="min-h-screen bg-gray-50">
      <div className="w-full px-4 sm:px-6 md:px-8 lg:px-12 xl:px-20 py-6 md:py-8">
        {/* 헤더 */}
        <div className="mb-8">
          {/* 제목 영역 */}
          <div className="mb-6">
            <div className="flex items-center justify-center gap-4 mb-4">
              {/* 그라데이션 아이콘 박스 (바 차트) */}
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shadow-lg">
                <BarChart3 className="w-6 h-6 text-white" />
              </div>
              {/* 제목 */}
              <h1 className="text-lg sm:text-xl lg:text-2xl font-bold text-slate-800">{t("F&F CHINA 비용 대시보드", lang)}</h1>
            </div>
            {/* 제목 아래 구분선 */}
            <div className="h-1 bg-gradient-to-r from-purple-500 via-blue-500 to-purple-500 rounded-full mx-auto" style={{ maxWidth: '600px' }}></div>
          </div>
          
          {/* 날짜 선택 및 모드 전환 영역 */}
          <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
            <div className="flex items-center gap-4 flex-wrap min-w-0 flex-1">
              {/* 그라데이션 아이콘 박스 (캘린더) */}
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center shadow-lg flex-shrink-0">
                <Calendar className="w-6 h-6 text-white" />
              </div>
              {/* 날짜 선택 + 월/연간 탭 (나란히) */}
              <div className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-50 rounded-lg shadow-sm border border-gray-200 flex-shrink-0">
                <div className="relative">
                  <select
                    value={`${yearOption.year}-${yearOption.type}`}
                    onChange={(e) => {
                      const [yearStr, type] = e.target.value.split('-');
                      const selected = availableYearOptions.find(
                        opt => opt.year === parseInt(yearStr) && opt.type === type
                      );
                      if (selected) setYearOption(selected);
                    }}
                    className="appearance-none bg-transparent border-none outline-none text-[10px] sm:text-xs md:text-sm font-medium text-gray-700 cursor-pointer pr-6"
                  >
                    {availableYearOptions.map((opt) => (
                      <option key={`${opt.year}-${opt.type}`} value={`${opt.year}-${opt.type}`}>
                        {`${opt.year}${t(opt.type === 'plan' ? '년(예산)' : '년(실적)', lang)}`}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600 pointer-events-none" />
                </div>
                <div className="relative">
                  <select
                    value={month.toString()}
                    onChange={(e) => setMonth(parseInt(e.target.value))}
                    disabled={isPlanYear}
                    className={`appearance-none bg-transparent border-none outline-none text-[10px] sm:text-xs md:text-sm font-medium pr-6 ${
                      isPlanYear 
                        ? 'text-gray-400 cursor-not-allowed' 
                        : 'text-gray-700 cursor-pointer'
                    }`}
                  >
                    {availableMonths.map((m) => (
                      <option key={m} value={m}>
                        {m}{t("월", lang)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className={`absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none ${
                    isPlanYear ? 'text-gray-400' : 'text-gray-600'
                  }`} />
                </div>
                <Tabs 
                  value={mode} 
                  onValueChange={(v) => !isPlanYear && setMode(v as Mode)} 
                  className="flex-shrink-0"
                >
                  <TabsList>
                    <TabsTrigger
                      value="monthly"
                      disabled={isPlanYear}
                      className={isPlanYear ? 'cursor-not-allowed opacity-50' : ''}
                    >
                      {isPlanYear ? t("월", lang) : t("당월", lang)}
                    </TabsTrigger>
                    <TabsTrigger value="ytd">
                      {isPlanYear ? t("연간", lang) : t("누적(YTD)", lang)}
                    </TabsTrigger>
                    {/* 실적일 때만 분기 탭 노출 (가용한 분기 강조, 나머지 disabled) */}
                    {!isPlanYear && ([1, 2, 3, 4] as const).map((q) => {
                      const enabled = availableQuarters.includes(q);
                      return (
                        <TabsTrigger
                          key={`q${q}`}
                          value={`q${q}`}
                          disabled={!enabled}
                          className={!enabled ? 'cursor-not-allowed opacity-40' : ''}
                        >
                          {q}{t("분기", lang)}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                </Tabs>
              </div>
              {/* AI 보고서/심층분석 버튼 제거 — 우측 탭에서 직접 열람 */}
              {isPlanYear && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadHtml}
                    className="flex-shrink-0 text-[10px] sm:text-xs"
                  >
                    <Download className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1 sm:mr-1.5" />
                    {t("HTML 다운로드", lang)}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsReportModalOpen(true)}
                    className="flex-shrink-0 text-[10px] sm:text-xs"
                  >
                    <FileText className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1 sm:mr-1.5" />
                    {t("2026년 예산구조진단 보고서", lang)}
                  </Button>
                </>
              )}
            </div>
            <div className="flex-shrink-0 mt-2 sm:mt-0">
              <LanguageToggle />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-4 flex-wrap">
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              {t("브랜드를 클릭하면 상세 대시보드로 이동합니다.", lang)}
            </p>
            <p className="text-[10px] sm:text-xs text-slate-400">
              매월 데이터 갱신(실행순서):
              <code className="ml-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono text-[10px]">
                python scripts/preprocess_sales.py
              </code>
              <span className="mx-1.5 text-slate-400">→</span>
              <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono text-[10px]">
                python scripts/preprocess_expense.py
              </code>
            </p>
          </div>
        </div>

        {/* HTML 다운로드 대상: 사업부 카드 + 상세표 (드롭다운으로 사업부 전환) */}
        <div ref={isPlanYear ? homeExportRef : undefined}>
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,1fr)_2fr] gap-6 mb-8">
            {/* 좌: 사업부 선택 카드 (드롭다운으로 전환) */}
            <div>
              {(() => {
                const cfg =
                  MAIN_BRAND_CONFIG.find((c) => c.bizUnit === selectedBrandBizUnit) ??
                  MAIN_BRAND_CONFIG[0];
                return (
                  <BrandCard
                    key={cfg.bizUnit}
                    bizUnit={cfg.bizUnit}
                    year={yearOption.year}
                    month={month}
                    mode={mode}
                    yearType={yearOption.type}
                    brandColor={cfg.brandColor}
                    brandInitial={cfg.brandInitial}
                    brandName={t(cfg.brandName, lang)}
                    icon={cfg.icon}
                    titleControl={
                      <BrandDropdown
                        value={selectedBrandBizUnit}
                        options={MAIN_BRAND_CONFIG.map((c) => ({ bizUnit: c.bizUnit, label: c.brandName }))}
                        onChange={setSelectedBrandBizUnit}
                        onDark
                      />
                    }
                  />
                );
              })()}
            </div>
            {/* 우: 5-탭 스위처 (선택된 사업부 기준 상세/광고효율/KPI/AI/심층) */}
            <div className="flex flex-col min-h-0">
              {/* 탭 헤더 */}
              <div className="mb-3 flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
                {([
                  { key: "detail",       label: t("비용 계정 상세 분석", lang), icon: <TableIcon className="w-3.5 h-3.5" /> },
                  { key: "adEfficiency", label: t("광고비 효율 분석", lang),   icon: <BarChart2 className="w-3.5 h-3.5" /> },
                  { key: "kpi",          label: t("주요 지표 (KPI)", lang),    icon: <LineChart className="w-3.5 h-3.5" /> },
                  { key: "ai",           label: t("AI 보고서", lang),          icon: <Bot className="w-3.5 h-3.5" /> },
                  { key: "deep",         label: t("심층분석", lang),           icon: <Microscope className="w-3.5 h-3.5" /> },
                ] as { key: RightTab; label: string; icon: React.ReactNode }[]).map((tab) => {
                  const active = rightTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setRightTab(tab.key)}
                      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                        active
                          ? "bg-white shadow-sm border border-slate-200 text-indigo-700"
                          : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
                      }`}
                    >
                      {tab.icon}
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* 탭 콘텐츠 */}
              {rightTab === "detail" && (
                <ExpenseAccountHierTable
                  bizUnit={selectedBrandBizUnit}
                  year={yearOption.year}
                  month={month}
                  title={`${t(selectedBrandBizUnit, lang)} ${t("비용 계정 상세 분석", lang)}`}
                  yearType={yearOption.type}
                  {...(yearOption.type === "actual" ? { mode, onModeChange: setMode } : {})}
                />
              )}
              {rightTab === "adEfficiency" && (
                <div className="space-y-4">
                  {/* 광고비-매출 효율 분석 (공통은 매출 없어 스킵) */}
                  {selectedBrandBizUnit !== "공통" && (
                    <div className="rounded-lg border border-slate-200 bg-white p-4">
                      <AdSalesEfficiencyAnalysis
                        bizUnit={selectedBrandBizUnit}
                        year={yearOption.year}
                        mode="yoy"
                        yearType={yearOption.type}
                      />
                    </div>
                  )}
                  {/* 월별 추이 차트 */}
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <MonthlyStackedChart
                      bizUnit={selectedBrandBizUnit}
                      year={yearOption.year}
                      mode="monthly"
                      yearType={yearOption.type}
                    />
                  </div>
                  {/* 드릴다운 차트 */}
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <CategoryDrilldown
                      bizUnit={selectedBrandBizUnit}
                      year={yearOption.year}
                      month={month}
                      mode={mode}
                      yearType={yearOption.type}
                    />
                  </div>
                </div>
              )}
              {rightTab === "kpi" && (() => {
                const curr = getMonthlyTotal(selectedBrandBizUnit, yearOption.year, month, mode, yearOption.type);
                const prev = getMonthlyTotal(selectedBrandBizUnit, yearOption.year - 1, month, mode, "actual");
                const totalCost = curr?.amount ?? 0;
                const prevCost = prev?.amount ?? 0;
                const costYoy = prevCost > 0 ? (totalCost / prevCost) * 100 : null;
                const sales = curr?.sales ?? 0;
                const prevSales = prev?.sales ?? 0;
                const salesYoy = prevSales > 0 ? (sales / prevSales) * 100 : null;
                const costRatio = sales > 0 ? (totalCost * 1.13 / sales) * 100 : null;
                const prevCostRatio = prevSales > 0 ? (prevCost * 1.13 / prevSales) * 100 : null;
                const hc = curr?.headcount ?? 0;
                const prevHc = prev?.headcount ?? 0;
                const bu = selectedBrandBizUnit;
                const isBrandBu = bu !== "법인" && bu !== "공통";
                const isCommonBu = bu === "공통";
                const isCorporateBu = bu === "법인";
                return (
                  <div className="space-y-4">
                    {/* Top KPI 카드 */}
                    <div className="rounded-lg border border-slate-200 bg-white p-4">
                      <h3 className="text-[15px] font-bold text-slate-800 mb-3">{t(bu, lang)} — {t("주요 지표 (KPI)", lang)}</h3>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <KpiCard title={t("총비용", lang)} value={totalCost} unit="K" yoy={costYoy} previousValue={prevCost} />
                        <KpiCard title={t("판매매출", lang)} value={sales} unit="M" yoy={salesYoy} previousValue={prevSales} />
                        <KpiCard title={t("매출대비 비용률", lang)} value={costRatio} yoy={costRatio != null && prevCostRatio != null ? costRatio - prevCostRatio : null} previousValue={prevCostRatio} />
                        <KpiCard title={t("인원", lang)} value={hc} unit={t("명", lang)} yoy={null} previousValue={prevHc} />
                      </div>
                    </div>
                    {/* 인건비 · 광고비 · IT수수료 · 지급수수료 카드 (사업부별 상이) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                      <LaborCostPerCapitaCard bizUnit={bu} year={yearOption.year} month={month} mode={mode} yearType={yearOption.type} />
                      {isBrandBu && (
                        <>
                          <AdExpenseCard bizUnit={bu} year={yearOption.year} month={month} adNode={null} yearType={yearOption.type} {...(yearOption.type === "actual" && { mode })} sales={sales} prevSales={prevSales} />
                          <CategoryExpenseCard title={t("수주회", lang)} categoryLv1="수주회" node={null} bizUnit={bu} year={yearOption.year} month={month} yearType={yearOption.type} sales={sales} prevSales={prevSales} />
                          <CategoryExpenseCard title={t("출장비", lang)} categoryLv1="출장비" node={null} bizUnit={bu} year={yearOption.year} month={month} yearType={yearOption.type} sales={sales} prevSales={prevSales} />
                        </>
                      )}
                      {isCommonBu && (
                        <>
                          <ITFeeCard bizUnit={bu} year={yearOption.year} month={month} itNode={null} yearType={yearOption.type} {...(yearOption.type === "actual" && { mode })} sales={sales} prevSales={prevSales} />
                          <PaymentFeeCard bizUnit={bu} year={yearOption.year} month={month} paymentNode={null} yearType={yearOption.type} {...(yearOption.type === "actual" && { mode })} sales={sales} prevSales={prevSales} />
                        </>
                      )}
                      {isCorporateBu && (
                        <>
                          <AdExpenseCard bizUnit={bu} year={yearOption.year} month={month} adNode={null} yearType={yearOption.type} {...(yearOption.type === "actual" && { mode })} sales={sales} prevSales={prevSales} />
                          <ITFeeCard bizUnit={bu} year={yearOption.year} month={month} itNode={null} yearType={yearOption.type} {...(yearOption.type === "actual" && { mode })} sales={sales} prevSales={prevSales} />
                          <PaymentFeeCard bizUnit={bu} year={yearOption.year} month={month} paymentNode={null} yearType={yearOption.type} {...(yearOption.type === "actual" && { mode })} sales={sales} prevSales={prevSales} />
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}
              {rightTab === "ai" && (
                <AIReportModal
                  isOpen={true}
                  onClose={() => {}}
                  year={yearOption.year}
                  month={month}
                  mode={mode}
                  yearType={yearOption.type}
                  inline
                />
              )}
              {rightTab === "deep" && (
                <DeepAnalysisModal
                  isOpen={true}
                  onClose={() => {}}
                  year={yearOption.year}
                  month={month}
                  inline
                />
              )}
            </div>
          </div>
        </div>

        {/* 예산구조진단 보고서 모달 */}
        <ReportModal 
          isOpen={isReportModalOpen} 
          onClose={() => setIsReportModalOpen(false)} 
        />
      </div>
    </div>

    <AIReportModal
      isOpen={isAIReportOpen}
      onClose={() => setIsAIReportOpen(false)}
      year={yearOption.year}
      month={month}
      mode={mode}
      yearType={yearOption.type}
    />

    <DeepAnalysisModal
      isOpen={isDeepAnalysisOpen}
      onClose={() => setIsDeepAnalysisOpen(false)}
      year={yearOption.year}
      month={month}
    />
    </>
  );
}

