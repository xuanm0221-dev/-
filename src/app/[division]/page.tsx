"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { MonthlyStackedChart } from "@/components/dashboard/MonthlyStackedChart";
import { CategoryDrilldown } from "@/components/dashboard/CategoryDrilldown";
import { BizUnitSwitch } from "@/components/dashboard/BizUnitSwitch";
import { ExpenseAccountHierTable } from "@/components/dashboard/ExpenseAccountHierTable";
import { AdSalesEfficiencyAnalysis } from "@/components/dashboard/AdSalesEfficiencyAnalysis";
import { LaborCostPerCapitaCard } from "@/components/dashboard/LaborCostPerCapitaCard";
import { AdExpenseCard } from "@/components/dashboard/AdExpenseCard";
import { ITFeeCard } from "@/components/dashboard/ITFeeCard";
import { PaymentFeeCard } from "@/components/dashboard/PaymentFeeCard";
import { CategoryExpenseCard } from "@/components/dashboard/CategoryExpenseCard";
import { AIReportModal } from "@/components/dashboard/AIReportModal";
import { ExpenseAccountRow } from "@/types/expense";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calendar, ChevronDown, Baby, Mountain, Building2, Building, Download, Bot } from "lucide-react";

// 야구공 아이콘 컴포넌트
const BaseballIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
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
);
import {
  getMonthlyTotal,
  getPreviousYearTotal,
  getMonthlyAggregatedByCategory,
  getAnnualData,
  getAnnualHeadcountSum,
  getCategoryDetail,
  calculateYOY,
  calculateCostRatio,
  calculatePerPersonCost,
  getAvailableYears,
  getAvailableMonths,
  getAvailableQuarters,
  getAvailableYearOptions,
  type BizUnit,
  type Mode,
  type YearOption,
} from "@/lib/expenseData";
import { formatK, formatPercent, formatPercentPoint } from "@/lib/utils";
import { getLatestYearOption, getLatestMonth } from "@/lib/dashboardDefaults";
import { useLanguage } from "@/contexts/LanguageContext";
import { t, getDisplayLabel } from "@/lib/translations";
import { LanguageToggle } from "@/components/dashboard/LanguageToggle";

const DIVISION_NAMES: Record<string, string> = {
  법인: "법인",
  MLB: "MLB",
  KIDS: "KIDS",
  DISCOVERY: "DISCOVERY",
  공통: "공통",
};

// 사업부별 아이콘 매핑
const DIVISION_ICONS: Record<string, React.ElementType> = {
  법인: Building,
  MLB: BaseballIcon,
  KIDS: Baby,
  DISCOVERY: Mountain,
  공통: Building2,
};

export default function DivisionPage() {
  const { lang } = useLanguage();
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Next.js의 useParams()는 이미 디코딩된 값을 반환
  const divisionRaw = params.division as string;
  // 한글 경로 처리: URL 인코딩된 값이 올 수 있으므로 디코딩 시도
  const division = divisionRaw ? decodeURIComponent(divisionRaw) : divisionRaw;
  const bizUnit = division as BizUnit;
  
  // 디버깅: division 값 확인
  console.log("Division from params (raw):", divisionRaw);
  console.log("Division (decoded):", division);
  console.log("BizUnit:", bizUnit);
  console.log("Valid bizUnits:", ["MLB", "KIDS", "DISCOVERY", "공통"].includes(bizUnit));

  const availableYearOptions = getAvailableYearOptions();
  const yearParam = searchParams.get("year");
  const typeParam = searchParams.get("type") as 'actual' | 'plan' | null;
  const monthParam = searchParams.get("month");
  const modeParam = searchParams.get("mode") as Mode | null;

  const urlYearOption = yearParam && typeParam
    ? availableYearOptions.find((opt) => opt.year === parseInt(yearParam) && opt.type === typeParam)
    : null;
  // URL 파라미터가 없으면 항상 최신 실적 연도 + 가장 최근 가용 월
  const initialYearOption = urlYearOption || getLatestYearOption();
  const initialMonth = (monthParam && !isNaN(parseInt(monthParam)))
    ? parseInt(monthParam)
    : getLatestMonth(initialYearOption);
  const defaultMode: Mode = initialYearOption.type === "actual" ? "ytd" : "monthly";
  const initialMode: Mode = (modeParam === "monthly" || modeParam === "ytd") ? modeParam : defaultMode;

  const [yearOption, setYearOption] = useState<YearOption>(initialYearOption);
  const [month, setMonth] = useState<number>(initialMonth);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [adExpenseNode, setAdExpenseNode] = useState<ExpenseAccountRow | null>(null);
  const [itFeeNode, setITFeeNode] = useState<ExpenseAccountRow | null>(null);
  const [paymentFeeNode, setPaymentFeeNode] = useState<ExpenseAccountRow | null>(null);
  const [meetingNode, setMeetingNode] = useState<ExpenseAccountRow | null>(null);
  const [travelNode, setTravelNode] = useState<ExpenseAccountRow | null>(null);
  const [tableAnnualTotals, setTableAnnualTotals] = useState<{ prev: number; curr: number } | null>(null);
  const [isAIReportOpen, setIsAIReportOpen] = useState(false);
  const [forceExpandAll, setForceExpandAll] = useState(false);
  const [isPdfExporting, setIsPdfExporting] = useState(false);
  const exportAreaRef = useRef<HTMLDivElement>(null);

  const isPlanYear = yearOption.year === 2026 && yearOption.type === 'plan';
  const availableMonths = getAvailableMonths(yearOption.year, yearOption.type);

  useEffect(() => {
    // 2026년(예산)이면 12월로 고정, mode도 ytd로 고정
    if (isPlanYear) {
      if (month !== 12) setMonth(12);
      if (mode !== 'ytd') setMode('ytd');
    } else if (availableMonths.length > 0 && !availableMonths.includes(month)) {
      setMonth(availableMonths[availableMonths.length - 1]);
    }
  }, [yearOption, availableMonths, month, isPlanYear, mode]);

  useEffect(() => {
    const searchParams = new URLSearchParams();
    searchParams.set("year", yearOption.year.toString());
    searchParams.set("type", yearOption.type);
    searchParams.set("month", month.toString());
    searchParams.set("mode", mode);
    // Next.js router는 자동으로 URL 인코딩을 처리하므로 원본 값을 사용
    router.replace(`/${division}?${searchParams.toString()}`, { scroll: false });
  }, [yearOption, month, mode, division, router]);

  // 훅이 필요로 하는 변수들을 early return 이전에 정의
  const year = yearOption.year;
  const yearType = yearOption.type;
  const isCommon = bizUnit === "공통";
  const isCorporate = bizUnit === "법인";
  const isBrand = !isCommon && !isCorporate;
  // 법인 탭 전용: 완전한 3개월 데이터가 있는 분기만 노출
  const availableQuarters = isCorporate ? getAvailableQuarters(yearOption.year, yearOption.type) : [];
  const is2026Annual = year === 2026 && yearType === 'plan';

  // 브랜드·공통·2026 연간이 아니면 표 연간 합계 캐시 초기화
  useEffect(() => {
    if (!((isBrand || isCommon) && yearOption.year === 2026 && yearOption.type === "plan")) {
      setTableAnnualTotals(null);
    }
  }, [isBrand, isCommon, yearOption.year, yearOption.type]);

  // 표 합계 콜백 (메모이제이션으로 무한 루프 방지)
  const handleAnnualTotalsChange = useCallback((totals: { prevYear: number; currYear: number }) => {
    if ((isBrand || isCommon) && is2026Annual) {
      setTableAnnualTotals({ prev: totals.prevYear, curr: totals.currYear });
    }
  }, [isBrand, isCommon, is2026Annual]);

  const handleDownloadHtml = useCallback(() => {
    if (!exportAreaRef.current) return;
    const inner = exportAreaRef.current.innerHTML;
    const title = `법인 대시보드 ${yearOption.year}년 ${month ? `${month}월` : "연간"}`;
    const fullDoc = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title><script src="https://cdn.tailwindcss.com"></script><style>body{font-family:system-ui,sans-serif;}</style></head><body class="p-4 bg-gray-50">${inner}</body></html>`;
    const blob = new Blob([fullDoc], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `corporate-dashboard-${yearOption.year}${month ? `-${month}` : ""}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [yearOption.year, month]);

  // 당월 + YTD + AI 보고서를 합쳐 하나의 PDF로 인쇄
  // AI 보고서는 모달의 디자인된 HTML을 그대로 캡처해서 PDF에 포함
  const handleDownloadPdf = useCallback(async () => {
    if (!exportAreaRef.current) return;
    setIsPdfExporting(true);
    setForceExpandAll(true);
    const originalMode = mode;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // 특정 selector가 'ready' 상태가 될 때까지 대기 (최대 timeout)
    const waitForReady = (selector: string, timeoutMs = 15000): Promise<HTMLElement | null> =>
      new Promise((resolve) => {
        const start = Date.now();
        const tick = () => {
          const el = document.querySelector(selector) as HTMLElement | null;
          if (el && el.getAttribute("data-ai-report-state") === "ready") return resolve(el);
          if (Date.now() - start > timeoutMs) return resolve(el);
          setTimeout(tick, 120);
        };
        tick();
      });
    try {
      // 1) 당월 캡처
      setMode("monthly");
      await sleep(800);
      const monthlyHtml = exportAreaRef.current.innerHTML;
      // 2) YTD 캡처
      setMode("ytd");
      await sleep(800);
      const ytdHtml = exportAreaRef.current.innerHTML;
      // 3) AI 보고서 모달 열고 디자인된 HTML 캡처
      setIsAIReportOpen(true);
      await sleep(200);
      const aiBody = await waitForReady("#ai-report-body");
      let aiHtml = "";
      if (aiBody) {
        aiHtml = aiBody.innerHTML;
        await sleep(150);
      } else {
        aiHtml = "<p style='color:#b91c1c;font-size:13px;'>AI 보고서 로드 실패</p>";
      }
      setIsAIReportOpen(false);
      // 4) 합쳐서 새 창으로 열고 자동 인쇄
      const title = `법인 종합 리포트 ${yearOption.year}년 ${month}월`;
      const fullDoc = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title><script src="https://cdn.tailwindcss.com"></script><style>
        @media print {
          @page { size: A4; margin: 12mm; }
          .page-break { page-break-before: always; }
          .no-print { display: none !important; }
        }
        body { font-family: system-ui, -apple-system, sans-serif; color: #1f2937; background: white; }
        h1.section-title { font-size: 22px; font-weight: 800; margin: 18px 0 12px; padding-bottom: 8px; border-bottom: 3px solid #4f46e5; color: #1e293b; }
      </style></head><body class="p-4 bg-white">
        <h1 class="section-title">📅 ${yearOption.year}년 ${month}월 당월 — 법인 대시보드 (전체 펼침)</h1>
        ${monthlyHtml}
        <div class="page-break"></div>
        <h1 class="section-title">📊 ${yearOption.year}년 1~${month}월 YTD 누적 — 법인 대시보드 (전체 펼침)</h1>
        ${ytdHtml}
        <div class="page-break"></div>
        <h1 class="section-title">🤖 AI 보고서 (${yearOption.year}년 ${month}월 ${mode === "monthly" ? "당월" : "YTD"})</h1>
        ${aiHtml}
        <script>
          window.addEventListener('load', () => {
            setTimeout(() => { window.print(); }, 1500);
          });
        </script>
      </body></html>`;
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(fullDoc);
        w.document.close();
      }
    } finally {
      setMode(originalMode);
      setForceExpandAll(false);
      setIsPdfExporting(false);
    }
  }, [exportAreaRef, mode, yearOption.year, yearOption.type, month]);

  if (!["법인", "MLB", "KIDS", "DISCOVERY", "공통"].includes(bizUnit)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">페이지를 찾을 수 없습니다</h1>
          <Link href="/">
            <Button>홈으로 돌아가기</Button>
          </Link>
        </div>
      </div>
    );
  }

  const current = getMonthlyTotal(bizUnit, year, month, mode, yearType);
  const previous = getPreviousYearTotal(bizUnit, year, month, mode, yearType);

  // 2026년(예산) 선택 시: 연간 계획(2026) vs 2025 실적(12월 YTD) 기준 KPI
  const annual2026 = is2026Annual ? getAnnualData(bizUnit, 2026, "", "", "", yearType) : [];
  const currentAnnualSum = annual2026.reduce((s, i) => s + i.annual_amount, 0);
  // 25년 합계는 2025년 12월 YTD(실적 누적)로 통일
  const previousAnnualSum = is2026Annual
    ? (getMonthlyTotal(bizUnit, 2025, 12, "ytd", 'actual')?.amount ?? 0)
    : 0;

  // 인건비 데이터 가져오기
  const currentCategories = getMonthlyAggregatedByCategory(bizUnit, year, month, mode, yearType);
  const previousCategories = is2026Annual
    ? getMonthlyAggregatedByCategory(bizUnit, 2025, 12, "ytd", 'actual')
    : getMonthlyAggregatedByCategory(bizUnit, year - 1, month, mode, yearType);
  const currentLaborCost = currentCategories.find(cat => cat.cost_lv1 === "인건비");
  const previousLaborCost = previousCategories.find(cat => cat.cost_lv1 === "인건비");

  // 모든 페이지에서 총비용 KPI용 법인 총비용 (전체 법인 합계)
  let corporateTotalCost: number | undefined;
  let corporateTotalCostYOY: number | null = null;
  let corporatePreviousAmountForKpi: number | null = null;
  if (is2026Annual) {
    const corpAnnual = getAnnualData("법인", 2026, "", "", "", yearType);
    corporateTotalCost = corpAnnual.reduce((s, i) => s + i.annual_amount, 0);
    corporatePreviousAmountForKpi = getMonthlyTotal("법인", 2025, 12, "ytd", "actual")?.amount ?? 0;
    corporateTotalCostYOY = calculateYOY(corporateTotalCost, corporatePreviousAmountForKpi);
  } else {
    const corpCurrent = getMonthlyTotal("법인", year, month, mode, yearType);
    const corpPrevious = getPreviousYearTotal("법인", year, month, mode, yearType);
    corporateTotalCost = corpCurrent?.amount ?? 0;
    corporatePreviousAmountForKpi = corpPrevious?.amount ?? null;
    corporateTotalCostYOY = calculateYOY(corporateTotalCost, corporatePreviousAmountForKpi);
  }

  // 계층형 표에서 광고비, IT수수료, 지급수수료 노드 추출
  const handleHierarchyReady = (rows: ExpenseAccountRow[]) => {
    const adNode = rows.find(row => row.category_l1 === "광고비");
    const itNode = rows.find(row => row.category_l1 === "IT수수료");
    const paymentNode = rows.find(row => row.category_l1 === "지급수수료");
    const meeting = rows.find(row => row.category_l1 === "수주회");
    const travel = rows.find(row => row.category_l1 === "출장비");
    setAdExpenseNode(adNode || null);
    setITFeeNode(itNode || null);
    setPaymentFeeNode(paymentNode || null);
    setMeetingNode(meeting || null);
    setTravelNode(travel || null);
  };

  const totalCost = is2026Annual ? currentAnnualSum : (current?.amount || 0);
  const totalCostYOY = is2026Annual
    ? calculateYOY(currentAnnualSum, previousAnnualSum)
    : calculateYOY(current?.amount || null, previous?.amount || null);
  const totalCostChange = is2026Annual
    ? (currentAnnualSum - previousAnnualSum)
    : (current?.amount && previous?.amount ? current.amount - previous.amount : null);
  const previousAmountForKpi = is2026Annual ? previousAnnualSum : (previous?.amount ?? null);

  // 매출 (2026년 예산: 연간 합계)
  const sales = is2026Annual
    ? (() => {
        let sum = 0;
        for (let m = 1; m <= 12; m++) {
          const monthData = getMonthlyTotal(bizUnit, year, m, "monthly", yearType);
          sum += monthData?.sales || 0;
        }
        return sum;
      })()
    : (current?.sales || 0);
  const prevSales = is2026Annual
    ? (getMonthlyTotal(bizUnit, 2025, 12, "ytd", 'actual')?.sales ?? 0)
    : (previous?.sales || 0);
  const salesYOY = calculateYOY(sales, prevSales);

  // 공통 페이지: 판매매출 카드는 법인 판매매출 사용
  const corporateCurrent = isCommon ? getMonthlyTotal("법인", year, month, mode, yearType) : null;
  const corporatePrevious = isCommon ? getPreviousYearTotal("법인", year, month, mode, yearType) : null;
  const corporateSales = isCommon
    ? (is2026Annual
      ? (() => {
          let sum = 0;
          for (let m = 1; m <= 12; m++) {
            const monthData = getMonthlyTotal("법인", year, m, "monthly", yearType);
            sum += monthData?.sales || 0;
          }
          return sum;
        })()
      : (corporateCurrent?.sales ?? 0))
    : 0;
  const corporatePrevSales = isCommon
    ? (is2026Annual
      ? (getMonthlyTotal("법인", 2025, 12, "ytd", "actual")?.sales ?? 0)
      : (corporatePrevious?.sales ?? 0))
    : 0;
  const corporateSalesYOY = isCommon ? calculateYOY(corporateSales, corporatePrevSales) : null;

  const costRatio = calculateCostRatio(totalCost, sales);
  const prevCostRatio = calculateCostRatio(previousAnnualSum || previous?.amount || 0, prevSales);
  const costRatioYOY =
    costRatio !== null && prevCostRatio !== null
      ? costRatio - prevCostRatio
      : null;

  // 비용 YOY 카드용 상세 항목 계산
  const categoryMap = new Map(currentCategories.map(c => [c.cost_lv1, c]));
  const prevCategoryMap = new Map(previousCategories.map(c => [c.cost_lv1, c]));
  
  // 법인 페이지: 인건비 외, 광고비, 지급수수료, 수주회, 임차료
  const corporateDetailItems = isCorporate ? (() => {
    const items: { label: string; value: string }[] = [];
    
    // 인건비 외 (인건비 + 복리후생비)
    const laborCurr = categoryMap.get("인건비")?.amount ?? 0;
    const welfareCurr = categoryMap.get("복리후생비")?.amount ?? 0;
    const laborPrev = prevCategoryMap.get("인건비")?.amount ?? 0;
    const welfarePrev = prevCategoryMap.get("복리후생비")?.amount ?? 0;
    const laborWelfareCurr = laborCurr + welfareCurr;
    const laborWelfarePrev = laborPrev + welfarePrev;
    const laborWelfareDiff = laborWelfareCurr - laborWelfarePrev;
    const laborWelfareYoy = laborWelfarePrev > 0 ? (laborWelfareCurr / laborWelfarePrev) * 100 : null;
    items.push({
      label: t("인건비 외", lang),
      value: `${laborWelfareDiff >= 0 ? "+" : ""}${formatK(laborWelfareDiff)} (${laborWelfareYoy != null ? formatPercent(laborWelfareYoy, 0) : "-"})`
    });
    
    // 광고비, 지급수수료, 수주회, 임차료
    ["광고비", "지급수수료", "수주회", "임차료"].forEach(cat => {
      const curr = categoryMap.get(cat);
      const prev = prevCategoryMap.get(cat);
      if (curr || prev) {
        const currAmount = curr?.amount ?? 0;
        const prevAmount = prev?.amount ?? 0;
        const diff = currAmount - prevAmount;
        const yoy = prevAmount > 0 ? (currAmount / prevAmount) * 100 : null;
        items.push({
          label: getDisplayLabel(cat, curr?.cost_lv1_cn ?? prev?.cost_lv1_cn, lang),
          value: `${diff >= 0 ? "+" : ""}${formatK(diff)} (${yoy != null ? formatPercent(yoy, 0) : "-"})`
        });
      }
    });
    
    return items;
  })() : undefined;
  
  // 브랜드 페이지: 인건비 외, 광고비, 수주회
  const brandDetailItems = isBrand ? (() => {
    const items: { label: string; value: string }[] = [];
    
    // 인건비 외 (인건비 + 복리후생비)
    const laborCurr = categoryMap.get("인건비")?.amount ?? 0;
    const welfareCurr = categoryMap.get("복리후생비")?.amount ?? 0;
    const laborPrev = prevCategoryMap.get("인건비")?.amount ?? 0;
    const welfarePrev = prevCategoryMap.get("복리후생비")?.amount ?? 0;
    const laborWelfareCurr = laborCurr + welfareCurr;
    const laborWelfarePrev = laborPrev + welfarePrev;
    const laborWelfareDiff = laborWelfareCurr - laborWelfarePrev;
    const laborWelfareYoy = laborWelfarePrev > 0 ? (laborWelfareCurr / laborWelfarePrev) * 100 : null;
    items.push({
      label: t("인건비 외", lang),
      value: `${laborWelfareDiff >= 0 ? "+" : ""}${formatK(laborWelfareDiff)} (${laborWelfareYoy != null ? formatPercent(laborWelfareYoy, 0) : "-"})`
    });
    
    // 광고비, 수주회
    ["광고비", "수주회"].forEach(cat => {
      const curr = categoryMap.get(cat);
      const prev = prevCategoryMap.get(cat);
      if (curr || prev) {
        const currAmount = curr?.amount ?? 0;
        const prevAmount = prev?.amount ?? 0;
        const diff = currAmount - prevAmount;
        const yoy = prevAmount > 0 ? (currAmount / prevAmount) * 100 : null;
        items.push({
          label: getDisplayLabel(cat, curr?.cost_lv1_cn ?? prev?.cost_lv1_cn, lang),
          value: `${diff >= 0 ? "+" : ""}${formatK(diff)} (${yoy != null ? formatPercent(yoy, 0) : "-"})`
        });
      }
    });
    
    return items;
  })() : undefined;
  
  // 공통 페이지: 인건비 외, 지급수수료, IT수수료, 임차료
  const commonDetailItems = isCommon ? (() => {
    const items: { label: string; value: string }[] = [];
    
    // 인건비 외 (인건비 + 복리후생비)
    const laborCurr = categoryMap.get("인건비")?.amount ?? 0;
    const welfareCurr = categoryMap.get("복리후생비")?.amount ?? 0;
    const laborPrev = prevCategoryMap.get("인건비")?.amount ?? 0;
    const welfarePrev = prevCategoryMap.get("복리후생비")?.amount ?? 0;
    const laborWelfareCurr = laborCurr + welfareCurr;
    const laborWelfarePrev = laborPrev + welfarePrev;
    const laborWelfareDiff = laborWelfareCurr - laborWelfarePrev;
    const laborWelfareYoy = laborWelfarePrev > 0 ? (laborWelfareCurr / laborWelfarePrev) * 100 : null;
    items.push({
      label: t("인건비 외", lang),
      value: `${laborWelfareDiff >= 0 ? "+" : ""}${formatK(laborWelfareDiff)} (${laborWelfareYoy != null ? formatPercent(laborWelfareYoy, 0) : "-"})`
    });
    
    // 지급수수료, IT수수료, 임차료
    ["지급수수료", "IT수수료", "임차료"].forEach(cat => {
      const curr = categoryMap.get(cat);
      const prev = prevCategoryMap.get(cat);
      if (curr || prev) {
        const currAmount = curr?.amount ?? 0;
        const prevAmount = prev?.amount ?? 0;
        const diff = currAmount - prevAmount;
        const yoy = prevAmount > 0 ? (currAmount / prevAmount) * 100 : null;
        items.push({
          label: getDisplayLabel(cat, curr?.cost_lv1_cn ?? prev?.cost_lv1_cn, lang),
          value: `${diff >= 0 ? "+" : ""}${formatK(diff)} (${yoy != null ? formatPercent(yoy, 0) : "-"})`
        });
      }
    });
    
    return items;
  })() : undefined;

  // 인당 비용 계산: 인건비 / 인원수
  // 카드 표시용 인원수: 12월 기말 인원수
  const headcount = is2026Annual 
    ? (getMonthlyTotal(bizUnit, year, 12, "monthly", yearType)?.headcount || 0)
    : (current?.headcount || 0);
  const prevHeadcount = is2026Annual
    ? (getMonthlyTotal(bizUnit, 2025, 12, "monthly", 'actual')?.headcount || 0)
    : (previous?.headcount || 0);
  
  // 인당 인건비 계산용: 연간 인건비 합계 / 연간 인원수 합계
  const laborCostAmount = is2026Annual
    ? annual2026.filter(item => item.cost_lv1 === "인건비").reduce((s, i) => s + i.annual_amount, 0)
    : (currentLaborCost?.amount || 0);
  const headcountForPerPerson = is2026Annual
    ? getAnnualHeadcountSum(bizUnit, year, yearType)
    : headcount;
  const prevHeadcountForPerPerson = is2026Annual
    ? getAnnualHeadcountSum(bizUnit, 2025, 'actual')
    : prevHeadcount;
  const perPersonCost = calculatePerPersonCost(laborCostAmount, headcountForPerPerson);
  
  const prevLaborCostAmount = previousLaborCost?.amount || 0;
  const prevPerPersonCost = calculatePerPersonCost(prevLaborCostAmount, prevHeadcountForPerPerson);
  
  const perPersonCostYOY = calculateYOY(perPersonCost, prevPerPersonCost);

  return (
    <>
    <div className="min-h-screen bg-gray-50">
      <div className="w-full px-4 sm:px-6 md:px-8 lg:px-12 xl:px-20 py-6 md:py-8">
        {/* 헤더: sticky로 스크롤 시 상단 고정 */}
        <div className="sticky top-0 z-50 -mx-4 sm:-mx-6 md:-mx-8 lg:-mx-12 xl:-mx-20 px-4 sm:px-6 md:px-8 lg:px-12 xl:px-20 pt-6 md:pt-8 pb-4 mb-2 bg-gray-50 flex flex-nowrap items-center gap-2 min-w-0">
          <Link href="/" className="flex-shrink-0">
            <Button variant="ghost" size="sm" className="p-1">
              <ArrowLeft className="h-3 w-3" />
            </Button>
          </Link>
          <h1 className="font-medium flex items-center gap-1 flex-shrink-0 text-[0.975rem]">
            {DIVISION_ICONS[bizUnit] && (() => {
              const Icon = DIVISION_ICONS[bizUnit];
              return <Icon className="w-4 h-4" />;
            })()}
            <span>{t(DIVISION_NAMES[bizUnit], lang)} {t("비용분석", lang)}</span>
          </h1>
          <BizUnitSwitch
            currentBizUnit={bizUnit}
            year={year}
            month={month}
            mode={mode}
            yearType={yearType}
          />
          {/* 기준 문구 + 날짜 선택 한 묶음 */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <p className="hidden lg:inline text-xs text-gray-500 whitespace-nowrap">
              {`${yearOption.year}${t(yearOption.type === 'plan' ? '년(예산)' : '년(실적)', lang)}`} {isPlanYear ? '' : `${month}${t("월", lang)}`} {t("기준", lang)}
            </p>
            <div className="inline-flex h-7 items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 bg-gray-50 whitespace-nowrap">
              <Calendar className="w-3 h-3 flex-shrink-0" style={{ color: '#3b82f6' }} />
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
                  className="appearance-none bg-transparent border-none outline-none text-xs font-medium text-gray-700 cursor-pointer pr-4"
                >
                  {availableYearOptions.map((opt) => (
                    <option key={`${opt.year}-${opt.type}`} value={`${opt.year}-${opt.type}`}>
                      {`${opt.year}${t(opt.type === 'plan' ? '년(예산)' : '년(실적)', lang)}`}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-gray-600 pointer-events-none" />
              </div>
              <div className="relative">
                <select
                  value={month.toString()}
                  onChange={(e) => setMonth(parseInt(e.target.value))}
                  disabled={isPlanYear}
                  className={`appearance-none bg-transparent border-none outline-none text-xs font-medium pr-4 ${
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
                <ChevronDown className={`absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 pointer-events-none ${
                  isPlanYear ? 'text-gray-400' : 'text-gray-600'
                }`} />
              </div>
            </div>
          </div>
          <Tabs
            value={mode}
            onValueChange={(v) => !isPlanYear && setMode(v as Mode)}
            className="flex-shrink-0 w-auto"
          >
            <TabsList className="h-7 rounded-lg border border-gray-200 bg-gray-50 p-1">
              <TabsTrigger
                value="monthly"
                disabled={isPlanYear}
                className={`text-xs px-2 py-1 rounded-md ${isPlanYear ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                {t("당월", lang)}
              </TabsTrigger>
              {/* 법인 탭 전용: 3개월 완성된 분기만 노출 */}
              {isCorporate && !isPlanYear && availableQuarters.map((q) => (
                <TabsTrigger
                  key={`q${q}`}
                  value={`q${q}`}
                  className="text-xs px-2 py-1 rounded-md"
                >
                  {q}{t("분기", lang)}
                </TabsTrigger>
              ))}
              <TabsTrigger value="ytd" className="text-xs px-2 py-1 rounded-md">
                {isPlanYear ? t("연간", lang) : t("누적 (YTD)", lang)}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-shrink-0 items-center gap-2">
            <LanguageToggle compact />
            <button
              type="button"
              onClick={() => setIsAIReportOpen(true)}
              className="flex h-7 items-center gap-1 rounded-lg border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100"
            >
              <Bot className="h-3 w-3 flex-shrink-0" />
              AI 보고서
            </button>
            {isCorporate && (
              <>
                <button
                  type="button"
                  onClick={handleDownloadHtml}
                  className="flex h-7 items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100"
                >
                  <Download className="h-3 w-3 flex-shrink-0" />
                  {t("HTML 다운로드", lang)}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={isPdfExporting}
                  className="flex h-7 items-center gap-1 rounded-lg border border-indigo-300 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-60 disabled:cursor-wait"
                  title="당월 + YTD + AI 보고서를 합쳐 PDF로 인쇄 (전체 펼침 상태)"
                >
                  <Download className="h-3 w-3 flex-shrink-0" />
                  {isPdfExporting ? "준비 중..." : "PDF 다운로드"}
                </button>
              </>
            )}
            {isPlanYear && (
              <span className="text-[10px] font-medium text-gray-600 whitespace-nowrap">
                {t("연간 계획 (2025 실적 vs 2026 계획)", lang)}
              </span>
            )}
          </div>
        </div>

        {/* KPI 카드 + 카드 4개 + 비용 계정 상세 분석 (HTML 다운로드 대상) */}
        <div ref={isCorporate ? exportAreaRef : undefined} className={isCorporate ? "" : undefined}>
        {/* KPI 카드 */}
        <div className="mb-6">
          <h2 className="font-bold mb-4 text-xs sm:text-sm lg:text-lg">{t("주요 지표 (KPI)", lang)}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title={t("총비용", lang)}
            value={corporateTotalCost ?? totalCost}
            unit="K"
            yoy={corporateTotalCostYOY ?? totalCostYOY}
            yoyLabel={is2026Annual ? t("전년(2025 실적) 대비", lang) : t("전년동월대비", lang)}
            previousValue={corporatePreviousAmountForKpi ?? previousAmountForKpi}
          />
          {isBrand && (
            <>
              <KpiCard
                title={t("브랜드비용", lang)}
                value={is2026Annual && !tableAnnualTotals ? "-" : (is2026Annual && tableAnnualTotals ? tableAnnualTotals.curr : totalCost)}
                unit="K"
                yoy={null}
                secondLine={(() => {
                  if (is2026Annual && !tableAnnualTotals) return null;
                  const change = is2026Annual && tableAnnualTotals
                    ? tableAnnualTotals.curr - tableAnnualTotals.prev
                    : totalCostChange;
                  const yoy = is2026Annual && tableAnnualTotals
                    ? calculateYOY(tableAnnualTotals.curr, tableAnnualTotals.prev)
                    : totalCostYOY;
                  return `${change != null && change >= 0 ? "+" : ""}${formatK(change ?? 0)}, ${formatPercent(yoy ?? 0, 0)}`;
                })()}
                detailItems={brandDetailItems}
              />
              <KpiCard
                title={t("매출대비 비용률", lang)}
                value={costRatio}
                yoy={costRatioYOY}
                yoyLabel={t("전년동월대비", lang)}
                previousValue={prevCostRatio}
              />
              <KpiCard
                title={t("판매매출", lang)}
                value={sales}
                unit="M"
                yoy={salesYOY}
                yoyLabel={t("전년동월대비", lang)}
                previousValue={previous?.sales ?? null}
              />
            </>
          )}
          {(isCommon || isCorporate) && (
            <>
              {isCorporate && (
                <KpiCard
                  title={t("법인비용 YOY", lang)}
                  value={(() => {
                    const change = is2026Annual && tableAnnualTotals
                      ? tableAnnualTotals.curr - tableAnnualTotals.prev
                      : totalCostChange;
                    const yoy = is2026Annual && tableAnnualTotals
                      ? calculateYOY(tableAnnualTotals.curr, tableAnnualTotals.prev)
                      : totalCostYOY;
                    return `${change && change > 0 ? '+' : ''}${formatK(change || 0)} (${formatPercent(yoy, 0)})`;
                  })()}
                  yoy={null}
                  yoyLabel={is2026Annual ? t("전년(2025 실적) 대비", lang) : ""}
                  detailItems={corporateDetailItems}
                />
              )}
              {isCommon && (
                <KpiCard
                  title={t("공통비용", lang)}
                  value={is2026Annual && !tableAnnualTotals ? "-" : (is2026Annual && tableAnnualTotals ? tableAnnualTotals.curr : totalCost)}
                  unit="K"
                  yoy={null}
                  secondLine={(() => {
                    if (is2026Annual && !tableAnnualTotals) return null;
                    const change = is2026Annual && tableAnnualTotals
                      ? tableAnnualTotals.curr - tableAnnualTotals.prev
                      : totalCostChange;
                    const yoy = is2026Annual && tableAnnualTotals
                      ? calculateYOY(tableAnnualTotals.curr, tableAnnualTotals.prev)
                      : totalCostYOY;
                    return `${change != null && change >= 0 ? "+" : ""}${formatK(change ?? 0)}, ${formatPercent(yoy ?? 0, 0)}`;
                  })()}
                  detailItems={commonDetailItems}
                />
              )}
              <KpiCard
                title={t("매출대비 비용률", lang)}
                value={costRatio}
                yoy={costRatioYOY}
                yoyLabel={is2026Annual ? t("전년(2025 실적) 대비", lang) : t("전년동월대비", lang)}
                previousValue={prevCostRatio}
              />
              <KpiCard
                title={t("판매매출", lang)}
                value={isCommon ? corporateSales : sales}
                unit="M"
                yoy={isCommon ? corporateSalesYOY : salesYOY}
                yoyLabel={is2026Annual ? t("전년(2025 실적) 대비", lang) : t("전년동월대비", lang)}
                previousValue={isCommon ? corporatePrevSales : prevSales}
              />
            </>
          )}
          </div>
        </div>

        {/* 인건비 · 광고비 · IT수수료 · 지급수수료 카드 (구분별 상이) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <LaborCostPerCapitaCard bizUnit={bizUnit} year={year} month={month} mode={mode} yearType={yearType} />
          {isBrand && (
            <>
              <AdExpenseCard bizUnit={bizUnit} year={year} month={month} adNode={adExpenseNode} yearType={yearType} {...(yearType === "actual" && { mode })} sales={sales} prevSales={prevSales} />
              <CategoryExpenseCard title={t("수주회", lang)} categoryLv1="수주회" node={meetingNode} bizUnit={bizUnit} year={year} month={month} yearType={yearType} sales={sales} prevSales={prevSales} />
              <CategoryExpenseCard title={t("출장비", lang)} categoryLv1="출장비" node={travelNode} bizUnit={bizUnit} year={year} month={month} yearType={yearType} sales={sales} prevSales={prevSales} />
            </>
          )}
          {isCommon && (
            <>
              <ITFeeCard bizUnit={bizUnit} year={year} month={month} itNode={itFeeNode} yearType={yearType} {...(yearType === "actual" && { mode })} sales={corporateSales} prevSales={corporatePrevSales} />
              <PaymentFeeCard bizUnit={bizUnit} year={year} month={month} paymentNode={paymentFeeNode} yearType={yearType} {...(yearType === "actual" && { mode })} sales={corporateSales} prevSales={corporatePrevSales} />
            </>
          )}
          {isCorporate && (
            <>
              <AdExpenseCard bizUnit={bizUnit} year={year} month={month} adNode={adExpenseNode} yearType={yearType} {...(yearType === "actual" && { mode })} sales={sales} prevSales={prevSales} />
              <ITFeeCard bizUnit={bizUnit} year={year} month={month} itNode={itFeeNode} yearType={yearType} {...(yearType === "actual" && { mode })} sales={sales} prevSales={prevSales} />
              <PaymentFeeCard bizUnit={bizUnit} year={year} month={month} paymentNode={paymentFeeNode} yearType={yearType} {...(yearType === "actual" && { mode })} sales={sales} prevSales={prevSales} />
            </>
          )}
        </div>

        {/* 비용 계정 상세 분석 */}
        <div className="mb-6">
          <ExpenseAccountHierTable
            bizUnit={bizUnit}
            year={year}
            month={month}
            title={`${t(DIVISION_NAMES[bizUnit], lang)} ${t("비용 계정 상세 분석", lang)}`}
            onHierarchyReady={handleHierarchyReady}
            onAnnualTotalsChange={(isBrand || isCommon) && is2026Annual ? handleAnnualTotalsChange : undefined}
            yearType={yearType}
            forceExpandAll={forceExpandAll}
            {...(yearType === "actual" ? { mode, onModeChange: setMode } : {})}
          />
        </div>
        </div>

        {/* 광고비-매출 효율 분석 (브랜드 & 법인만) */}
        {!isCommon && (
          <div className="mb-6">
            <AdSalesEfficiencyAnalysis bizUnit={bizUnit} year={year} mode="yoy" yearType={yearType} />
          </div>
        )}

        {/* 월별 추이 차트 */}
        <div className="mb-6">
          <MonthlyStackedChart bizUnit={bizUnit} year={year} mode="monthly" yearType={yearType} />
        </div>

        {/* 드릴다운 차트 */}
        <div className="mb-6">
          <CategoryDrilldown
            bizUnit={bizUnit}
            year={year}
            month={month}
            mode={mode}
            yearType={yearType}
          />
        </div>

      </div>
    </div>

    <AIReportModal
      isOpen={isAIReportOpen}
      onClose={() => setIsAIReportOpen(false)}
      year={year}
      month={month}
      mode={mode}
      yearType={yearType}
    />
    </>
  );
}

