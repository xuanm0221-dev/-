"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Baby, Mountain, Building2, Building, ChevronDown, Download, FileText, Bot, Microscope, BarChart2, Table as TableIcon, Scale, type LucideIcon } from "lucide-react";
import { BudgetMidCheck } from "@/components/dashboard/BudgetMidCheck";
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
import { MonthlyCategoryTrendTable } from "@/components/dashboard/MonthlyCategoryTrendTable";
import { AdSalesEfficiencyAnalysis } from "@/components/dashboard/AdSalesEfficiencyAnalysis";
import { MonthlyStackedChart } from "@/components/dashboard/MonthlyStackedChart";
import { ReportModal } from "@/components/dashboard/ReportModal";
import { AIReportModal } from "@/components/dashboard/AIReportModal";
import { DeepAnalysisModal } from "@/components/dashboard/DeepAnalysisModal";
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
import { getAnnualData, type BizUnit } from "@/lib/expenseData";
import { getLatestYearOption, getLatestMonth } from "@/lib/dashboardDefaults";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePlanVariant } from "@/contexts/PlanVariantContext";
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
  const { planVariant } = usePlanVariant();
  const availableYearOptions = getAvailableYearOptions();

  // 진입 시 항상 최신 실적 연도 + 가장 최근 가용 월
  const initialYearOption = getLatestYearOption();
  const initialMonth = getLatestMonth(initialYearOption);
  const initialMode: Mode = "ytd";

  const [yearOption, setYearOption] = useState<YearOption>(initialYearOption);
  const [month, setMonth] = useState<number>(initialMonth);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isAIReportOpen, setIsAIReportOpen] = useState(false);
  const [isDeepAnalysisOpen, setIsDeepAnalysisOpen] = useState(false);
  // 홈 상단 카드에서 선택 중인 사업부 (드롭다운 셀렉터로 전환)
  const [selectedBrandBizUnit, setSelectedBrandBizUnit] = useState<BizUnit>("법인");
  // 우측 5-탭 스위처 선택 상태
  type RightTab = "budget" | "detail" | "adEfficiency" | "ai" | "deep";
  const [rightTab, setRightTab] = useState<RightTab>("budget");

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

  // 예산 중간점검은 연간계획 대비 YTD 진척 분석이라 당월·분기에는 의미가 없다.
  // 그 모드로 넘어가면 탭을 비활성화하고, 열려 있었으면 월별 추이로 내린다.
  const budgetTabEnabled = mode === "ytd";
  useEffect(() => {
    if (!budgetTabEnabled && rightTab === "budget") setRightTab("detail");
  }, [budgetTabEnabled, rightTab]);

  return (
    <>
    <div className="min-h-screen bg-gray-50">
      <div className="w-full px-2 sm:px-2 md:px-3 lg:px-3 xl:px-4 py-3 md:py-4">
        {/* 헤더 */}
        <div className="mb-3">
          {/* 제목 영역 — 심플 스타일 (좌: 제목+언어토글, 우: 전처리 절차 가로) */}
          <div className="mb-3 pb-2 border-b border-slate-300 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <h1 className="text-[16px] sm:text-lg lg:text-xl font-bold text-slate-900">{t("F&F China 영업비 대시보드", lang)}</h1>
              <LanguageToggle />
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 flex-wrap justify-end">
              <span className="text-slate-500">{t("매월 데이터 갱신(실행순서)", lang)}:</span>
              <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px]">
                python scripts/preprocess_sales.py
              </code>
              <span className="text-slate-400">→</span>
              <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px]">
                python scripts/preprocess_expense.py
              </code>
            </div>
          </div>
          
          {/* 날짜 선택 및 모드 전환 영역 */}
          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
              {/* 모드 탭 (참고 디자인: rounded-xl bg-slate-100 pill 스타일) */}
              <div className="inline-flex items-center rounded-xl bg-slate-100/90 p-1 ring-1 ring-slate-200/80 shadow-sm shadow-slate-200/40 flex-shrink-0">
                {(() => {
                  const modeItems: { key: Mode; label: string; disabled: boolean }[] = [
                    { key: "monthly", label: isPlanYear ? t("월", lang) : t("당월", lang), disabled: isPlanYear },
                    { key: "ytd",     label: isPlanYear ? t("연간", lang) : t("누적(YTD)", lang), disabled: false },
                    ...(!isPlanYear ? ([1, 2, 3, 4] as const).map((q) => ({
                      key: `q${q}` as Mode,
                      label: `${q}${t("분기", lang)}`,
                      disabled: !availableQuarters.includes(q),
                    })) : []),
                  ];
                  return modeItems.map((it) => {
                    const active = mode === it.key;
                    return (
                      <button
                        key={it.key}
                        type="button"
                        disabled={it.disabled}
                        onClick={() => !it.disabled && setMode(it.key)}
                        className={`px-3 py-1 text-[13px] font-semibold rounded-lg transition-all ${
                          active
                            ? "bg-white text-blue-600 shadow-sm shadow-slate-200/60"
                            : it.disabled
                            ? "text-slate-300 cursor-not-allowed"
                            : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        {it.label}
                      </button>
                    );
                  });
                })()}
              </div>
              {/* 날짜 셀렉터 (흰 배경, 모드탭과 동일 형태) */}
              <div className="inline-flex items-center rounded-xl bg-white p-1 ring-1 ring-slate-200/80 shadow-sm shadow-slate-200/40 flex-shrink-0">
                <div className="relative flex items-center px-2 py-1 mr-0.5">
                  <select
                    value={`${yearOption.year}-${yearOption.type}`}
                    onChange={(e) => {
                      const [yearStr, type] = e.target.value.split('-');
                      const selected = availableYearOptions.find(
                        opt => opt.year === parseInt(yearStr) && opt.type === type
                      );
                      if (selected) setYearOption(selected);
                    }}
                    className="appearance-none bg-transparent border-none outline-none text-[13px] font-semibold text-blue-600 cursor-pointer pr-4 py-0 leading-none"
                  >
                    {availableYearOptions.map((opt) => (
                      <option key={`${opt.year}-${opt.type}`} value={`${opt.year}-${opt.type}`}>
                        {`${opt.year}${t(opt.type === 'plan' ? '년(예산)' : '년', lang)}`}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
                </div>
                <div className="relative flex items-center px-2 py-1">
                  <select
                    value={month.toString()}
                    onChange={(e) => setMonth(parseInt(e.target.value))}
                    disabled={isPlanYear}
                    className={`appearance-none bg-transparent border-none outline-none text-[13px] font-semibold pr-4 py-0 leading-none ${
                      isPlanYear ? 'text-slate-300 cursor-not-allowed' : 'text-blue-600 cursor-pointer'
                    }`}
                  >
                    {availableMonths.map((m) => (
                      <option key={m} value={m}>
                        {m}{t("월", lang)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className={`absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none ${
                    isPlanYear ? 'text-slate-300' : 'text-slate-400'
                  }`} />
                </div>
              </div>
              {/* 우측 탭 스위처 (예산/상세/광고/AI/심층) — 핵심결론&액션 탭과 동일 디자인 */}
              <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden shadow-sm flex-shrink-0 flex-wrap">
                {(() => {
                  const tabs = [
                    { key: "ai",           label: t("AI 보고서", lang),          icon: <Bot className="w-3.5 h-3.5" /> },
                    { key: "deep",         label: t("심층분석", lang),           icon: <Microscope className="w-3.5 h-3.5" /> },
                    { key: "detail",       label: t("월별 비용 추이", lang), icon: <TableIcon className="w-3.5 h-3.5" /> },
                    { key: "adEfficiency", label: t("광고비 효율 분석", lang),   icon: <BarChart2 className="w-3.5 h-3.5" /> },
                    { key: "budget",       label: t("예산 중간점검", lang),      icon: <Scale className="w-3.5 h-3.5" />, disabled: !budgetTabEnabled },
                  ] as { key: RightTab; label: string; icon: React.ReactNode; disabled?: boolean }[];
                  return tabs.map((tab, idx) => {
                    const active = rightTab === tab.key;
                    const disabled = !!tab.disabled;
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        disabled={disabled}
                        title={disabled ? t("누적(YTD)에서만 확인할 수 있습니다", lang) : undefined}
                        onClick={() => !disabled && setRightTab(tab.key)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold transition-colors ${idx > 0 ? "border-l border-slate-300" : ""} ${
                          disabled
                            ? "bg-slate-50 text-slate-300 cursor-not-allowed"
                            : active
                            ? "bg-slate-900 text-white"
                            : "bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {tab.icon}
                        {tab.label}
                      </button>
                    );
                  });
                })()}
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
          </div>
        </div>

        {/* HTML 다운로드 대상: 사업부 카드 + 상세표 (드롭다운으로 사업부 전환) */}
        <div ref={isPlanYear ? homeExportRef : undefined}>
          {(() => {
            // 카드 폭: YTD 는 기존계획/조정후 모두 790px 로 통일 (토글해도 레이아웃이 안 흔들린다).
            // 조정후는 컬럼이 9개라 남는 폭이 생기는데, 그건 대분류 트랙(1fr)이 흡수해
            // 중·소분류 긴 이름이 덜 잘린다. 당월/분기는 5컬럼이라 470px.
            // flex-none으로 카드가 자연 폭을 지키고, 남는 공간은 우측 panel이 흡수.
            const cardWidthClass = mode !== "ytd"
              ? "xl:flex-none xl:w-[470px]"
              : "xl:flex-none xl:w-[790px]";
            return (
          <div className="flex flex-col xl:flex-row gap-5 items-start mb-8">
            {/* 좌: 사업부 선택 카드 (모드에 따라 폭 자동 조정) */}
            <div className={`w-full ${cardWidthClass} shrink-0 transition-[flex] duration-200`}>
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
            {/* 우: 5-탭 콘텐츠 영역 (탭 헤더는 상단 헤더 행으로 이동) */}
            <div className="xl:flex-1 min-w-0 flex flex-col">
              {/* 탭 콘텐츠 */}
              {rightTab === "budget" && (
                <BudgetMidCheck
                  bizUnit={selectedBrandBizUnit}
                  year={yearOption.year}
                  month={month}
                />
              )}
              {rightTab === "detail" && (
                <div className="space-y-4">
                  {/* 월별 계정 추이 (매트릭스 표) */}
                  <MonthlyCategoryTrendTable
                    bizUnit={selectedBrandBizUnit}
                    year={yearOption.year}
                    yearType={yearOption.type}
                    upToMonth={month}
                  />
                  {/* 하단: 월별 비용 스택 차트 (YOY 라인 포함) */}
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <MonthlyStackedChart
                      bizUnit={selectedBrandBizUnit}
                      year={yearOption.year}
                      mode="monthly"
                      yearType={yearOption.type}
                    />
                  </div>
                </div>
              )}
              {rightTab === "adEfficiency" && (
                <div className="space-y-4">
                  {/* 광고비-매출 효율 분석 (공통은 매출 없어 스킵) */}
                  {selectedBrandBizUnit !== "공통" ? (
                    <div className="rounded-lg border border-slate-200 bg-white p-4">
                      <AdSalesEfficiencyAnalysis
                        bizUnit={selectedBrandBizUnit}
                        year={yearOption.year}
                        mode="yoy"
                        yearType={yearOption.type}
                      />
                    </div>
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
                      {t("공통은 매출이 없어 광고비 효율 분석을 제공하지 않습니다.", lang)}
                    </div>
                  )}
                </div>
              )}
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
            );
          })()}
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

