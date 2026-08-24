"use client";

import React, { useMemo } from "react";
import { X, Microscope } from "lucide-react";
import { getAggregatedData, type MonthlyTotal, type MonthlyAggregated, type CategoryDetail } from "@/lib/expenseData";

interface DeepAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  year: number;
  month: number;
  /** true면 모달 오버레이 없이 인라인 렌더 (탭 안에서 사용) */
  inline?: boolean;
}

const BRANDS = ["MLB", "KIDS", "DISCOVERY", "공통"] as const;
const BRANDS_SALES = ["MLB", "KIDS", "DISCOVERY"] as const;
const VAT_FACTOR = 1.13;

// ─────────────────────────────────────────────────────
// 데이터 계산 헬퍼 (원 단위 → K로 반환)
// ─────────────────────────────────────────────────────
function sumTotal(rows: MonthlyTotal[], year: number, yt: "actual" | "plan", biz: readonly string[], upToMonth: number) {
  return rows
    .filter((r) => r.year === year && (r.year_type ?? "actual") === yt && biz.includes(r.biz_unit) && r.month <= upToMonth)
    .reduce((s, r) => s + (r.amount || 0), 0);
}
function sumSales(rows: MonthlyTotal[], year: number, yt: "actual" | "plan", upToMonth: number) {
  return rows
    .filter((r) => r.year === year && (r.year_type ?? "actual") === yt && (BRANDS_SALES as readonly string[]).includes(r.biz_unit) && r.month <= upToMonth)
    .reduce((s, r) => s + (r.sales || 0), 0);
}
function sumHeadcountYtd(rows: MonthlyTotal[], year: number, yt: "actual" | "plan", biz: readonly string[], upToMonth: number) {
  return rows
    .filter((r) => r.year === year && (r.year_type ?? "actual") === yt && biz.includes(r.biz_unit) && r.month <= upToMonth)
    .reduce((s, r) => s + (r.headcount || 0), 0);
}
function sumCategory(rows: MonthlyAggregated[], year: number, yt: "actual" | "plan", biz: readonly string[], upToMonth: number, cat: string) {
  return rows
    .filter((r) => r.year === year && (r.year_type ?? "actual") === yt && biz.includes(r.biz_unit) && r.month <= upToMonth && r.cost_lv1 === cat)
    .reduce((s, r) => s + (r.amount || 0), 0);
}
function sumCategoryByBrand(rows: MonthlyAggregated[], year: number, yt: "actual" | "plan", bu: string, upToMonth: number, cat: string) {
  return rows
    .filter((r) => r.year === year && (r.year_type ?? "actual") === yt && r.biz_unit === bu && r.month <= upToMonth && r.cost_lv1 === cat)
    .reduce((s, r) => s + (r.amount || 0), 0);
}
// lv2 합계 map (원 단위)
function sumLv2Map(rows: CategoryDetail[], year: number, yt: "actual" | "plan", biz: readonly string[], upToMonth: number, cat: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.year === year && (r.year_type ?? "actual") === yt && biz.includes(r.biz_unit) && r.month <= upToMonth && r.cost_lv1 === cat) {
      m.set(r.cost_lv2, (m.get(r.cost_lv2) ?? 0) + (r.amount || 0));
    }
  }
  return m;
}
const K = (v: number) => v / 1000;
const yoy = (curr: number, prev: number) => (prev ? (curr / prev) * 100 : 0);
const fmtK = (n: number) => Math.round(n).toLocaleString();

interface DeepAnalysisMetrics {
  monthLabel: string;
  kpi: { salesM: number; salesPrevM: number; salesYoy: number; costK: number; costPrevK: number; costYoy: number; ratioPct: number; ratioDeltaP: number };
  ad:  { totalK: number; yoyPct: number; mlbK: number; mlbYoyPct: number; discK: number; discYoyPct: number };
  fee: { totalK: number; yoyPct: number; surging: Array<{ name: string; amountK: number; yoyPct: number }> };
  rent: { totalK: number; yoyPct: number; planK: number; usagePct: number };
  meeting: { totalK: number; yoyPct: number };
  it:  { totalK: number; yoyPct: number; onlinePlatformDeltaK: number; aiSystemK: number; omsK: number; omsYoyPct: number };
  labor: { perPersonK: number; perPersonPrevK: number; perPersonYoyPct: number };
}

function computeMetrics(year: number, month: number): DeepAnalysisMetrics {
  const data = getAggregatedData();
  const mt = data.monthly_total;
  const ma = data.monthly_aggregated;
  const cd = data.category_detail;

  // KPI
  const salesCurr = sumSales(mt, year, "actual", month);
  const salesPrev = sumSales(mt, year - 1, "actual", month);
  const costCurr = sumTotal(mt, year, "actual", BRANDS, month);
  const costPrev = sumTotal(mt, year - 1, "actual", BRANDS, month);
  const ratioCurr = salesCurr > 0 ? (costCurr * VAT_FACTOR / salesCurr) * 100 : 0;
  const ratioPrev = salesPrev > 0 ? (costPrev * VAT_FACTOR / salesPrev) * 100 : 0;

  // 광고비 (법인 = 4사업부 합)
  const adTotal = sumCategory(ma, year, "actual", BRANDS, month, "광고비");
  const adPrev  = sumCategory(ma, year - 1, "actual", BRANDS, month, "광고비");
  const adMlb   = sumCategoryByBrand(ma, year, "actual", "MLB", month, "광고비");
  const adMlbPrev = sumCategoryByBrand(ma, year - 1, "actual", "MLB", month, "광고비");
  const adDisc  = sumCategoryByBrand(ma, year, "actual", "DISCOVERY", month, "광고비");
  const adDiscPrev = sumCategoryByBrand(ma, year - 1, "actual", "DISCOVERY", month, "광고비");

  // 지급수수료 + top surging lv2 (전년 대비 급증 상위 2개 — YoY 200% 이상 + 금액 300K 이상)
  const feeTotal = sumCategory(ma, year, "actual", BRANDS, month, "지급수수료");
  const feePrev  = sumCategory(ma, year - 1, "actual", BRANDS, month, "지급수수료");
  const feeLv2Curr = sumLv2Map(cd, year, "actual", BRANDS, month, "지급수수료");
  const feeLv2Prev = sumLv2Map(cd, year - 1, "actual", BRANDS, month, "지급수수료");
  const feeLv2Surging = Array.from(feeLv2Curr.entries())
    .map(([name, amt]) => {
      const prev = feeLv2Prev.get(name) ?? 0;
      return { name, amt, prev, yoyPct: yoy(amt, prev) };
    })
    .filter((r) => r.amt / 1000 >= 300 && r.yoyPct >= 200)
    .sort((a, b) => b.yoyPct - a.yoyPct)
    .slice(0, 2)
    .map((r) => ({ name: r.name, amountK: K(r.amt), yoyPct: r.yoyPct }));

  // 임차료
  const rentCurr = sumCategory(ma, year, "actual", BRANDS, month, "임차료");
  const rentPrev = sumCategory(ma, year - 1, "actual", BRANDS, month, "임차료");
  const rentPlan = sumCategory(ma, year, "plan", BRANDS, month, "임차료");

  // 수주회
  const mtCurr = sumCategory(ma, year, "actual", BRANDS, month, "수주회");
  const mtPrev = sumCategory(ma, year - 1, "actual", BRANDS, month, "수주회");

  // IT수수료 + 주요 lv2
  const itCurr = sumCategory(ma, year, "actual", BRANDS, month, "IT수수료");
  const itPrev = sumCategory(ma, year - 1, "actual", BRANDS, month, "IT수수료");
  const itLv2Curr = sumLv2Map(cd, year, "actual", BRANDS, month, "IT수수료");
  const itLv2Prev = sumLv2Map(cd, year - 1, "actual", BRANDS, month, "IT수수료");
  const findLv2 = (kw: string) => {
    for (const [name, amt] of itLv2Curr) if (name.includes(kw)) return { name, amt, prev: itLv2Prev.get(name) ?? 0 };
    return null;
  };
  const onlineP = findLv2("온라인플랫폼");
  const aiSys = findLv2("AI");
  const oms = findLv2("OMS");

  // 인건비 → 인당
  const laborCurr = sumCategory(ma, year, "actual", BRANDS, month, "인건비");
  const laborPrev = sumCategory(ma, year - 1, "actual", BRANDS, month, "인건비");
  const hcCurr = sumHeadcountYtd(mt, year, "actual", BRANDS, month);
  const hcPrev = sumHeadcountYtd(mt, year - 1, "actual", BRANDS, month);
  const perCurr = hcCurr > 0 ? laborCurr / hcCurr : 0;
  const perPrev = hcPrev > 0 ? laborPrev / hcPrev : 0;

  return {
    monthLabel: `${year}년 ${month}월`,
    kpi: {
      salesM: K(salesCurr) / 1000,
      salesPrevM: K(salesPrev) / 1000,
      salesYoy: yoy(salesCurr, salesPrev),
      costK: K(costCurr),
      costPrevK: K(costPrev),
      costYoy: yoy(costCurr, costPrev),
      ratioPct: ratioCurr,
      ratioDeltaP: ratioCurr - ratioPrev,
    },
    ad: {
      totalK: K(adTotal), yoyPct: yoy(adTotal, adPrev),
      mlbK: K(adMlb), mlbYoyPct: yoy(adMlb, adMlbPrev),
      discK: K(adDisc), discYoyPct: yoy(adDisc, adDiscPrev),
    },
    fee: { totalK: K(feeTotal), yoyPct: yoy(feeTotal, feePrev), surging: feeLv2Surging },
    rent: { totalK: K(rentCurr), yoyPct: yoy(rentCurr, rentPrev), planK: K(rentPlan), usagePct: rentPlan > 0 ? (rentCurr / rentPlan) * 100 : 0 },
    meeting: { totalK: K(mtCurr), yoyPct: yoy(mtCurr, mtPrev) },
    it: {
      totalK: K(itCurr), yoyPct: yoy(itCurr, itPrev),
      onlinePlatformDeltaK: onlineP ? K(onlineP.amt - onlineP.prev) : 0,
      aiSystemK: aiSys ? K(aiSys.amt) : 0,
      omsK: oms ? K(oms.amt) : 0,
      omsYoyPct: oms ? yoy(oms.amt, oms.prev) : 0,
    },
    labor: { perPersonK: perCurr, perPersonPrevK: perPrev, perPersonYoyPct: yoy(perCurr, perPrev) },
  };
}

// ─────────────────────────────────────────────────────
// UI Sub-components
// ─────────────────────────────────────────────────────
function SectionHeading({ index, title }: { index: number; title: string }) {
  return (
    <div className="flex items-baseline gap-3 mb-5 pb-3 border-b-2 border-slate-200">
      <span className="text-[34px] font-extrabold text-violet-600 leading-none" style={{ fontVariantNumeric: "tabular-nums" }}>
        {index}.
      </span>
      <h2 className="text-[22px] font-bold text-slate-900 leading-tight">{title}</h2>
    </div>
  );
}
function Chip({ children, color }: { children: React.ReactNode; color: "blue" | "amber" }) {
  const palette = { blue: "bg-blue-100 text-blue-800", amber: "bg-amber-100 text-amber-800" };
  return (
    <span className={`inline-block text-[11.5px] font-bold tracking-wider uppercase px-2 py-0.5 rounded ${palette[color]} mr-2`}>
      {children}
    </span>
  );
}

export function DeepAnalysisModal({ isOpen, onClose, year, month, inline = false }: DeepAnalysisModalProps) {
  const m = useMemo<DeepAnalysisMetrics | null>(() => {
    if (!isOpen) return null;
    try {
      return computeMetrics(year, month);
    } catch {
      return null;
    }
  }, [isOpen, year, month]);

  if (!isOpen) return null;

  // 데이터가 없거나 로드 실패 시
  if (!m) {
    const errBody = (
      <div className={`bg-white rounded-2xl ${inline ? "" : "shadow-2xl"} p-8 max-w-md`}>
        <div className="flex items-center justify-between mb-4">
          <span className="font-bold">심층분석 보고서</span>
          {!inline && <button onClick={onClose}><X className="w-4 h-4" /></button>}
        </div>
        <p className="text-sm text-slate-600">데이터를 계산할 수 없습니다. 데이터가 로드된 후 다시 시도하세요.</p>
      </div>
    );
    if (inline) return errBody;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        {errBody}
      </div>
    );
  }

  const yoyStr = (v: number) => `${Math.round(v)}%`;

  // 실제 콘텐츠 (모달 오버레이 안 또는 인라인 컨테이너 안에 렌더)
  const bodyContent = (
    <div className={inline
      ? "flex flex-col bg-white rounded-2xl border border-slate-200 w-full"
      : "relative flex flex-col bg-white rounded-2xl shadow-2xl w-[96vw] max-w-4xl h-[94vh]"}
    >
      {/* Top bar (인라인 모드에서도 헤더 유지, 닫기 버튼만 숨김) */}
      <div className="flex items-center justify-between px-6 py-3.5 bg-white rounded-t-2xl border-b border-slate-100 shrink-0">
        <div className="flex items-center gap-2.5">
          <Microscope className="w-5 h-5 text-violet-600" />
          <span className="font-bold text-slate-800 text-[15px]">심층분석 보고서</span>
          <span className="text-[12px] text-slate-500 ml-1">{m.monthLabel} YTD 기준</span>
        </div>
        {!inline && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Scrollable content */}
      <div className={inline ? "px-7 py-6" : "flex-1 overflow-y-auto px-7 py-6"}>
          {/* Title block */}
          <div className="rounded-xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 px-7 py-6 text-white shadow-md mb-8">
            <div className="text-[13px] font-semibold uppercase tracking-widest text-violet-100 mb-2.5">
              심층 보고서
            </div>
            <h1 className="text-[27px] font-bold leading-snug tracking-tight">
              {m.monthLabel} F&amp;F 중국 법인 비용 구조 및 운영 효율성 분석
            </h1>
          </div>

          {/* 1. KPI Review */}
          <section className="mb-10">
            <SectionHeading index={1} title="전사 경영 지표 및 수익성 현황 (KPI Review)" />
            <p className="text-[15px] text-slate-700 leading-[1.7] mb-5">
              {m.monthLabel} 누적(YTD) 기준, 법인은 <strong className="text-slate-900">외형 성장</strong>과 함께 <strong className="text-slate-900">미래를 위한 인프라 구축</strong>에 집중하고 있습니다.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 px-4 py-4">
                <div className="text-[13px] font-semibold tracking-wider text-emerald-700 uppercase mb-1.5">판매매출</div>
                <div className="text-[22px] font-bold text-emerald-700 leading-tight" style={{ fontVariantNumeric: "tabular-nums" }}>{fmtK(m.kpi.salesM)}M</div>
                <div className="text-[14px] text-slate-700 mt-2 leading-[1.5]">전년 동기 {fmtK(m.kpi.salesPrevM)}M 대비 <strong className="text-emerald-700">{yoyStr(m.kpi.salesYoy)} 성장</strong></div>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50/40 px-4 py-4">
                <div className="text-[13px] font-semibold tracking-wider text-amber-700 uppercase mb-1.5">총비용 집행</div>
                <div className="text-[22px] font-bold text-amber-700 leading-tight" style={{ fontVariantNumeric: "tabular-nums" }}>{fmtK(m.kpi.costK)}K</div>
                <div className="text-[14px] text-slate-700 mt-2 leading-[1.5]">전년 대비 <strong className="text-amber-700">{yoyStr(m.kpi.costYoy)} 증가</strong>, 매출 성장률 상회</div>
              </div>
              <div className="rounded-lg border border-rose-200 bg-rose-50/40 px-4 py-4">
                <div className="text-[13px] font-semibold tracking-wider text-rose-700 uppercase mb-1.5">매출 대비 비용률</div>
                <div className="text-[22px] font-bold text-rose-700 leading-tight" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {m.kpi.ratioPct.toFixed(1)}% <span className="text-[14.5px] font-semibold">({m.kpi.ratioDeltaP >= 0 ? "+" : ""}{m.kpi.ratioDeltaP.toFixed(1)}%p)</span>
                </div>
                <div className="text-[14px] text-slate-700 mt-2 leading-[1.5]">SCM 혁신·공간 확장 <strong>전략적 비용 포함</strong></div>
              </div>
            </div>

            <p className="text-[14.5px] text-slate-700 leading-[1.7]">
              매출 성장보다 비용 투입이 가팔라지며 비용률이 상승했으나, 이는 <strong className="text-slate-900">단순 소모성 지출이 아닌 SCM 혁신 및 공간 확장을 위한 전략적 비용</strong>이 포함된 수치입니다.
            </p>
          </section>

          {/* 2. 주요 항목별 심층 분석 */}
          <section className="mb-10">
            <SectionHeading index={2} title="주요 항목별 심층 분석 및 효율 진단" />

            <div className="space-y-4">
              {/* ① 광고비 */}
              <div className="bg-slate-50/70 border-l-[3px] border-blue-500 rounded-r-lg pl-5 pr-5 py-4">
                <div className="flex items-start gap-2.5 mb-3">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white text-[15px] font-bold flex-shrink-0">1</span>
                  <div>
                    <h3 className="text-[18px] font-bold text-slate-900 leading-tight">
                      광고비 <span className="text-blue-700">{fmtK(m.ad.totalK)}K · YoY {yoyStr(m.ad.yoyPct)}</span>
                    </h3>
                    <p className="text-[13.5px] text-slate-500 font-medium mt-1">성장을 견인하는 핵심 엔진</p>
                  </div>
                </div>
                <div className="space-y-2 text-[14.5px] text-slate-700 leading-[1.7]">
                  <p>
                    <span className="font-semibold text-slate-900">브랜드별 전략:</span> <strong>MLB({fmtK(m.ad.mlbK)}K, {yoyStr(m.ad.mlbYoyPct)}↑)</strong>가 안정적 매출 기반을 제공하는 가운데, <strong>DISCOVERY({fmtK(m.ad.discK)}K, {yoyStr(m.ad.discYoyPct)}↑)</strong>에 대한 공격적 투자가 이어지고 있습니다.
                  </p>
                  <p>
                    <Chip color="blue">개선 여지</Chip>
                    브랜드별 광고 효율 등급이 <strong>C등급</strong>인 만큼, 채널·타겟 최적화를 통해 ROAS 상향 여지가 있습니다. 브랜드별 최적 집행 구간을 참고한 예산 재배분이 권장됩니다.
                  </p>
                </div>
              </div>

              {/* ② 지급수수료 */}
              <div className="bg-slate-50/70 border-l-[3px] border-amber-500 rounded-r-lg pl-5 pr-5 py-4">
                <div className="flex items-start gap-2.5 mb-3">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-600 text-white text-[15px] font-bold flex-shrink-0">2</span>
                  <div>
                    <h3 className="text-[18px] font-bold text-slate-900 leading-tight">
                      지급수수료 <span className="text-amber-700">{fmtK(m.fee.totalK)}K · YoY {yoyStr(m.fee.yoyPct)}</span>
                    </h3>
                    <p className="text-[13.5px] text-slate-500 font-medium mt-1">SCM 혁신을 위한 선제적 투자</p>
                  </div>
                </div>
                <div className="space-y-2 text-[14.5px] text-slate-700 leading-[1.7]">
                  {m.fee.surging.length > 0 && (
                    <p>
                      <span className="font-semibold text-slate-900">일시적 비용의 집중:</span>{" "}
                      {m.fee.surging.map((s, i) => (
                        <React.Fragment key={s.name}>
                          <strong>{s.name} {fmtK(s.amountK)}K ({yoyStr(s.yoyPct)}↑)</strong>
                          {i < m.fee.surging.length - 1 ? " 및 " : ""}
                        </React.Fragment>
                      ))}
                      {" "}급증 (온라인 창고 이전 · 재고 전수 실사 등 SCM 혁신 관련 일시 비용).
                    </p>
                  )}
                  <p>
                    <Chip color="amber">장기 효과</Chip>
                    창고 이전 완료 후 연간 <strong>500만~900만 RMB</strong> 규모의 수수료 절감 예상 — 현재의 비용 지출은 <strong>미래의 이익률을 높이기 위한 고통 분담 과정</strong>.
                  </p>
                </div>
              </div>

              {/* ③ 임차료 및 수주회 */}
              <div className="bg-slate-50/70 border-l-[3px] border-slate-400 rounded-r-lg pl-5 pr-5 py-4">
                <div className="flex items-start gap-2.5 mb-3">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-slate-600 text-white text-[15px] font-bold flex-shrink-0">3</span>
                  <div>
                    <h3 className="text-[18px] font-bold text-slate-900 leading-tight">임차료 및 수주회</h3>
                    <p className="text-[13.5px] text-slate-500 font-medium mt-1">구조적 상승과 운영 리스크 관리</p>
                  </div>
                </div>
                <div className="space-y-2.5 text-[14.5px] text-slate-700 leading-[1.7]">
                  <p>
                    <span className="font-semibold text-slate-900">임차료 {fmtK(m.rent.totalK)}K (YoY {yoyStr(m.rent.yoyPct)}):</span> 사무실 추가 임차에 따른 구조적 고정비 상승. 계획 누적액({fmtK(m.rent.planK)}K) 대비 <strong className="text-emerald-700">{yoyStr(m.rent.usagePct)} 집행률</strong> — 계획 범위 내 질서 있게 발생 중.
                  </p>
                  <p>
                    <span className="font-semibold text-slate-900">수주회 {fmtK(m.meeting.totalK)}K (YoY {yoyStr(m.meeting.yoyPct)}):</span> 상반기 모듈형 가구 제작비로 예산 대비 지출 컸음. 하반기 개최지가 <strong>하이난</strong>으로 변경됨에 따라 기존 제작물 재활용 제한 가능성. <strong className="text-rose-700">장소 변경 추가 비용 모니터링 필요</strong>.
                  </p>
                </div>
              </div>

              {/* ④ IT 수수료 */}
              <div className="bg-slate-50/70 border-l-[3px] border-emerald-500 rounded-r-lg pl-5 pr-5 py-4">
                <div className="flex items-start gap-2.5 mb-3">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-emerald-600 text-white text-[15px] font-bold flex-shrink-0">4</span>
                  <div>
                    <h3 className="text-[18px] font-bold text-slate-900 leading-tight">
                      IT 수수료 <span className="text-emerald-700">{fmtK(m.it.totalK)}K · YoY {yoyStr(m.it.yoyPct)}</span>
                    </h3>
                    <p className="text-[13.5px] text-slate-500 font-medium mt-1">효율화와 기술 투자의 병행</p>
                  </div>
                </div>
                <p className="text-[14.5px] text-slate-700 leading-[1.7]">
                  {m.it.yoyPct < 95
                    ? <>전체 지출은 감소했으나, </>
                    : m.it.yoyPct <= 105
                    ? <>전체 지출은 전년 수준(<strong>YoY {yoyStr(m.it.yoyPct)}</strong>)을 유지하되, </>
                    : <>전체 지출은 소폭 증가(<strong>YoY {yoyStr(m.it.yoyPct)}</strong>)했으나, </>}
                  온라인 플랫폼 수수료를 절감(<strong>{m.it.onlinePlatformDeltaK < 0 ? m.it.onlinePlatformDeltaK.toFixed(0) : `+${m.it.onlinePlatformDeltaK.toFixed(0)}`}K</strong>)한 재원을{" "}
                  {m.it.aiSystemK > 0 && <><strong>AI 식별시스템({fmtK(m.it.aiSystemK)}K 신규)</strong> 및 </>}
                  {m.it.omsK > 0 && <><strong>OMS({yoyStr(m.it.omsYoyPct)}↑)</strong> </>}
                  등 자체 시스템 고도화에 재투입 — 디지털 전환 가속화.
                </p>
              </div>
            </div>
          </section>

          {/* 3. 전략적 관리 방안 제안 */}
          <section>
            <SectionHeading index={3} title="향후 전략적 관리 방안 제안" />

            <div className="space-y-4">
              {/* 단기 */}
              <div className="bg-rose-50/40 rounded-lg px-5 py-4">
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="text-[11px] font-bold tracking-widest text-rose-700 uppercase bg-rose-200/60 px-2 py-0.5 rounded">단기</span>
                  <h3 className="text-[16px] font-bold text-rose-900">효율 최적화</h3>
                </div>
                <ul className="space-y-2.5 text-[14.5px] text-slate-700 leading-[1.7] list-none">
                  <li>
                    <span className="font-semibold text-slate-900">광고 타겟팅 정교화:</span> 현재의 높은 ROI를 유지하면서 효율 등급(<strong>C → B 이상</strong>) 상향을 위해 브랜드별 최적 집행 구간을 참고하여 예산 재배분.
                  </li>
                  <li>
                    <span className="font-semibold text-slate-900">하이난 수주회 예산 통제:</span> 장소 변경에 따른 물류비 상승분과 가구 재활용 제약 요인을 반영한 <strong>긴급 예산 검토 필요</strong>.
                  </li>
                </ul>
              </div>

              {/* 중기 */}
              <div className="bg-amber-50/40 rounded-lg px-5 py-4">
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="text-[11px] font-bold tracking-widest text-amber-700 uppercase bg-amber-200/60 px-2 py-0.5 rounded">중기</span>
                  <h3 className="text-[16px] font-bold text-amber-900">수익성 회복</h3>
                </div>
                <ul className="space-y-2.5 text-[14.5px] text-slate-700 leading-[1.7] list-none">
                  <li>
                    <span className="font-semibold text-slate-900">SCM 절감 효과 가시화:</span> 창고 이전 후 기대되는 연간 <strong>500만~900만 RMB</strong> 절감분을 분기별 손익에 반영, 매출 대비 비용률을 <strong className="text-emerald-700">4.8% 이하</strong>로 회복시키는 마일스톤 설정.
                  </li>
                  <li>
                    <span className="font-semibold text-slate-900">인당 생산성 유지:</span> 인당 인건비 <strong>{m.labor.perPersonK.toFixed(1)}K ({yoyStr(m.labor.perPersonYoyPct)}↑)</strong> 상승 추세 — AI 및 OMS 등 도입 시스템을 활용해 인력 운영 효율성 극대화.
                  </li>
                </ul>
              </div>

              {/* 결론 */}
              <div className="mt-6 rounded-xl bg-gradient-to-br from-indigo-50 via-violet-50 to-indigo-100/50 border border-indigo-200 px-6 py-5">
                <div className="text-[12.5px] font-bold uppercase tracking-widest text-indigo-700 mb-2.5">📌 결론</div>
                <p className="text-[15.5px] text-slate-800 leading-[1.8]">
                  F&amp;F 중국 법인은 현재 <strong className="text-indigo-700">&apos;규모의 경제&apos;</strong>를 달성하기 위한 과도기적 투자 단계에 있습니다. 창고 이전비와 가구 제작비 같은 일시적 요인이 제거되고 마케팅 타겟팅이 최적화된다면, <strong>하반기에는 매출 성장세와 더불어 압도적인 수익성 개선이 가능</strong>할 것으로 판단됩니다.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
  );

  if (inline) return bodyContent;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      {bodyContent}
    </div>
  );
}
