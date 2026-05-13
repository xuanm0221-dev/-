"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Baby, Mountain, Building2, Building, BarChart3, Calendar, ChevronDown, Download, FileText, BookmarkCheck, Bot, type LucideIcon } from "lucide-react";
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
import { ReportModal } from "@/components/dashboard/ReportModal";
import { AIReportModal } from "@/components/dashboard/AIReportModal";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  getAvailableYears,
  getAvailableMonths,
  getAvailableYearOptions,
  type Mode,
  type YearOption,
} from "@/lib/expenseData";
import { calculateYOY } from "@/lib/utils";
import { getAnnualData, getMonthlyTotal, type BizUnit } from "@/lib/expenseData";
import { getSavedDefault, saveDefault } from "@/lib/dashboardDefaults";
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
  const saved = getSavedDefault();
  const savedOption = saved ? availableYearOptions.find((o) => o.year === saved.year && o.type === saved.type) : null;
  const savedMonths = savedOption ? getAvailableMonths(savedOption.year, savedOption.type) : [];
  const savedValid = !!saved && !!savedOption && savedMonths.length > 0 && savedMonths.includes(saved.month);

  const fallbackYearOption = availableYearOptions.find((opt) => opt.year === 2026 && opt.type === "actual") || (availableYearOptions[0] ?? { year: 2025, type: "actual" as const, display: "2025년(실적)" });
  const initialYearOption = savedValid ? savedOption! : fallbackYearOption;
  // 저장된 기본값이 없으면 선택된 연도의 가장 최근 가용 월로
  const initialAvailableMonths = getAvailableMonths(initialYearOption.year, initialYearOption.type);
  const latestAvailableMonth = initialAvailableMonths.length > 0 ? initialAvailableMonths[initialAvailableMonths.length - 1] : 1;
  const initialMonth = savedValid ? saved!.month : latestAvailableMonth;
  const initialMode: Mode = savedValid ? saved!.mode : "monthly";

  const [yearOption, setYearOption] = useState<YearOption>(initialYearOption);
  const [month, setMonth] = useState<number>(initialMonth);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isAIReportOpen, setIsAIReportOpen] = useState(false);

  const isPlanYear = yearOption.year === 2026 && yearOption.type === 'plan';
  const availableMonths = getAvailableMonths(yearOption.year, yearOption.type);
  const homeExportRef = useRef<HTMLDivElement>(null);

  const handleSaveDefault = useCallback(() => {
    saveDefault(yearOption.year, yearOption.type, month, mode);
    window.alert(t("기본 날짜가 저장되었습니다. 다음 접속 시 이 날짜가 적용됩니다.", lang));
  }, [yearOption.year, yearOption.type, month, mode, lang]);

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
                  </TabsList>
                </Tabs>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSaveDefault}
                className="flex-shrink-0 text-[10px] sm:text-xs"
              >
                <BookmarkCheck className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1 sm:mr-1.5" />
                {t("이 날짜를 기본으로 저장", lang)}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setIsAIReportOpen(true)}
                className="flex-shrink-0 text-[10px] sm:text-xs bg-blue-50 text-blue-700 border border-blue-300 hover:bg-blue-100"
                variant="outline"
              >
                <Bot className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1 sm:mr-1.5" />
                AI 보고서
              </Button>
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

        {/* HTML 다운로드 대상: 브랜드 카드 (ref는 2026 예산일 때만) */}
        <div ref={isPlanYear ? homeExportRef : undefined}>
          {/* 브랜드 카드 그리드 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
            {MAIN_BRAND_CONFIG.map((config) => (
              <BrandCard
                key={config.bizUnit}
                bizUnit={config.bizUnit}
                year={yearOption.year}
                month={month}
                mode={mode}
                yearType={yearOption.type}
                brandColor={config.brandColor}
                brandInitial={config.brandInitial}
                brandName={t(config.brandName, lang)}
                icon={config.icon}
              />
            ))}
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
    </>
  );
}

