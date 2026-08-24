"use client";

import React, { useMemo } from "react";
import { X } from "lucide-react";
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
// UI Sub-components (git 참고 - 컴팩트 디자인)
// ─────────────────────────────────────────────────────
// 법인 카드 헤더와 통일 (그라데이션 우측 밝은 톤에 맞춤)
const NAVY = "#1e3a8a";

function SectionHeading({ index, title }: { index: number; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3 pb-2 border-b-2" style={{ borderColor: `${NAVY}4d` }}>
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-[11px] font-extrabold" style={{ backgroundColor: NAVY }}>
        {index}
      </span>
      <h3 className="text-[14px] font-extrabold" style={{ color: NAVY }}>{title}</h3>
    </div>
  );
}

function Chip({ children, color }: { children: React.ReactNode; color: "blue" | "amber" }) {
  const palette = { blue: "bg-blue-100 text-blue-800", amber: "bg-amber-100 text-amber-800" };
  return (
    <span className={`inline-block text-[10.5px] font-bold tracking-wider uppercase px-2 py-0.5 rounded ${palette[color]} mr-2`}>
      {children}
    </span>
  );
}

// KPI 카드 — 톤별 그라데이션 + accent 이모지
function KpiCard({ label, value, yoy, sub, tone }: {
  label: string; value: string; yoy: string; sub: string;
  tone: "up" | "warn" | "alert";
}) {
  const styles = {
    up: { card: "border-emerald-300 bg-gradient-to-br from-emerald-50 to-emerald-100/60", label: "text-emerald-700", value: "text-emerald-900", yoy: "text-white bg-emerald-600", sub: "text-emerald-700/80", accent: "📈" },
    warn: { card: "border-amber-300 bg-gradient-to-br from-amber-50 to-amber-100/60", label: "text-amber-700", value: "text-amber-900", yoy: "text-white bg-amber-600", sub: "text-amber-700/80", accent: "⚠️" },
    alert: { card: "border-rose-300 bg-gradient-to-br from-rose-50 to-rose-100/60", label: "text-rose-700", value: "text-rose-900", yoy: "text-white bg-rose-600", sub: "text-rose-700/80", accent: "🔥" },
  }[tone];
  return (
    <div className={`border-2 ${styles.card} rounded-lg p-3 shadow-sm relative overflow-hidden`}>
      <div className="absolute top-2 right-2 text-[16px] opacity-60">{styles.accent}</div>
      <div className={`text-[10px] font-bold uppercase tracking-wider ${styles.label}`}>{label}</div>
      <div className="flex items-baseline gap-2 mt-1.5">
        <div className={`text-[20px] font-extrabold ${styles.value}`} style={{ fontVariantNumeric: "tabular-nums" }}>{value}</div>
        <div className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded shadow-sm ${styles.yoy}`}>{yoy}</div>
      </div>
      <div className={`text-[10px] mt-1 font-medium ${styles.sub}`}>{sub}</div>
    </div>
  );
}

// SubSection - 좌측 컬러 바 + 톤별 배경 (blue/amber/slate/emerald 로테이션)
type SubTone = "blue" | "amber" | "slate" | "emerald";
function SubSection({ icon, title, subtitle, tone, children }: {
  icon: string; title: React.ReactNode; subtitle?: string; tone: SubTone; children: React.ReactNode;
}) {
  const toneCls = { blue: "border-blue-400 bg-blue-50/40", amber: "border-amber-400 bg-amber-50/40", slate: "border-slate-400 bg-slate-50/40", emerald: "border-emerald-400 bg-emerald-50/40" }[tone];
  const titleTone = { blue: "text-blue-900", amber: "text-amber-900", slate: "text-slate-900", emerald: "text-emerald-900" }[tone];
  return (
    <div className={`border-l-4 ${toneCls} pl-3 pr-2 py-2.5 mb-3 rounded-r break-inside-avoid`}>
      <div className="flex items-baseline gap-1.5 mb-1.5">
        <span className="text-[14px] font-extrabold">{icon}</span>
        <span className={`text-[12.5px] font-extrabold ${titleTone}`}>{title}</span>
      </div>
      {subtitle && <div className="text-[11px] text-gray-600 mb-2 italic">— {subtitle}</div>}
      {children}
    </div>
  );
}

function Phase({ label, tone, children }: { label: string; tone: "blue" | "emerald"; children: React.ReactNode }) {
  const toneCls = tone === "blue" ? "bg-blue-100 text-blue-900 border-blue-300" : "bg-emerald-100 text-emerald-900 border-emerald-300";
  return (
    <div className="mb-3">
      <div className={`inline-block text-[10.5px] font-extrabold px-2.5 py-1 rounded mb-2 border ${toneCls}`}>[{label}]</div>
      <div className="space-y-1 pl-2">{children}</div>
    </div>
  );
}

function Bullet({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex gap-2 text-[12px] ${className || ""}`}>
      <span style={{ color: NAVY }} className="mt-0.5">•</span>
      <span className="flex-1">{children}</span>
    </div>
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
      ? "flex flex-col bg-white rounded-2xl border border-slate-200 w-full overflow-hidden"
      : "relative flex flex-col bg-white rounded-2xl shadow-2xl w-[96vw] max-w-4xl h-[94vh] overflow-hidden"}
    >
      {/* Header — 법인 카드와 톤 통일 (단색) + amber 밑선 */}
      <div
        className={`${inline ? "" : "sticky top-0 z-10"} px-5 py-3 text-white shrink-0 border-b-2 border-amber-400`}
        style={{ background: NAVY }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold tracking-widest text-amber-300 uppercase">
              심층 보고서
            </div>
            <h2 className="text-base font-extrabold mt-0.5 leading-tight">
              F&amp;F 중국 법인 비용 구조 및 운영 효율성 분석
            </h2>
            <div className="text-[11px] text-blue-100 mt-0.5">
              {m.monthLabel} 기준 · YTD 누적
            </div>
          </div>
          {!inline && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-white/10 text-white/80 hover:text-white shrink-0"
              aria-label="닫기"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Body — text-[12px] 기본, p-5 */}
      <div className={inline ? "p-5 text-[12px] text-gray-800 leading-normal" : "flex-1 overflow-y-auto p-5 text-[12px] text-gray-800 leading-normal"}>
        {/* 1. KPI Review */}
        <Section idx={1} title="전사 경영 지표 및 수익성 현황 (KPI Review)">
          <p className="text-gray-700 mb-3">
            {m.monthLabel} 누적(YTD) 기준, 법인은 <b>외형 성장</b>과 함께 <b>미래를 위한 인프라 구축</b>에 집중하고 있습니다.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
            <KpiCard
              label="판매매출"
              value={`${fmtK(m.kpi.salesM)}M`}
              yoy={yoyStr(m.kpi.salesYoy)}
              sub={`전년 동기 ${fmtK(m.kpi.salesPrevM)}M`}
              tone="up"
            />
            <KpiCard
              label="총비용 집행"
              value={`${fmtK(m.kpi.costK)}K`}
              yoy={yoyStr(m.kpi.costYoy)}
              sub={`전년 동기 ${fmtK(m.kpi.costPrevK)}K`}
              tone="warn"
            />
            <KpiCard
              label="매출 대비 비용률"
              value={`${m.kpi.ratioPct.toFixed(1)}%`}
              yoy={`${m.kpi.ratioDeltaP >= 0 ? "+" : ""}${m.kpi.ratioDeltaP.toFixed(1)}%p`}
              sub="SCM 혁신·공간 확장 전략적 비용"
              tone="alert"
            />
          </div>
          <p className="text-[11px] text-gray-600 bg-amber-50 border-l-4 border-amber-400 px-3 py-2 rounded">
            ※ 매출 성장보다 비용 투입이 가팔라지며 비용률이 상승했으나, 이는 <b>단순 소모성 지출이 아닌 SCM 혁신 및 공간 확장을 위한 전략적 비용</b>이 포함된 수치입니다.
          </p>
        </Section>

        {/* 2. 주요 항목별 심층 분석 — 넓은 화면은 2열 컬럼 흐름 */}
        <Section idx={2} title="주요 항목별 심층 분석 및 효율 진단">
          <div className="columns-1 xl:columns-2 gap-3 [column-fill:balance]">
            {/* ① 광고비 */}
            <SubSection
              icon="①"
              title={<>광고비 <span className="text-blue-800 font-bold">({fmtK(m.ad.totalK)}K, YoY {yoyStr(m.ad.yoyPct)})</span></>}
              subtitle="성장을 견인하는 핵심 엔진"
              tone="blue"
            >
              <div className="space-y-1">
                <Bullet>
                  <b>브랜드별 전략</b>: <b>MLB({fmtK(m.ad.mlbK)}K, {yoyStr(m.ad.mlbYoyPct)}↑)</b> 안정적 매출 기반, <b>DISCOVERY({fmtK(m.ad.discK)}K, {yoyStr(m.ad.discYoyPct)}↑)</b> 공격적 투자 지속.
                </Bullet>
                <Bullet>
                  <Chip color="blue">개선 여지</Chip>
                  브랜드별 광고 효율 등급이 <b>C등급</b>인 만큼, 채널·타겟 최적화를 통해 ROAS 상향 여지 있음. 최적 집행 구간 참고 예산 재배분 권장.
                </Bullet>
              </div>
            </SubSection>

            {/* ② 지급수수료 */}
            <SubSection
              icon="②"
              title={<>지급수수료 <span className="text-amber-800 font-bold">({fmtK(m.fee.totalK)}K, YoY {yoyStr(m.fee.yoyPct)})</span></>}
              subtitle="SCM 혁신을 위한 선제적 투자"
              tone="amber"
            >
              <div className="space-y-1">
                {m.fee.surging.length > 0 && (
                  <Bullet>
                    <b>일시적 비용 집중</b>:{" "}
                    {m.fee.surging.map((s, i) => (
                      <React.Fragment key={s.name}>
                        <b>{s.name} {fmtK(s.amountK)}K ({yoyStr(s.yoyPct)}↑)</b>
                        {i < m.fee.surging.length - 1 ? " · " : ""}
                      </React.Fragment>
                    ))}
                    {" "}급증 (창고 이전 · 재고 실사 등).
                  </Bullet>
                )}
                <Bullet>
                  <Chip color="amber">장기 효과</Chip>
                  창고 이전 후 연간 <b>500만~900만 RMB</b> 수수료 절감 예상 — 미래 이익률을 위한 <b>고통 분담 과정</b>.
                </Bullet>
              </div>
            </SubSection>

            {/* ③ 임차료 및 수주회 */}
            <SubSection
              icon="③"
              title="임차료 및 수주회"
              subtitle="구조적 상승과 운영 리스크 관리"
              tone="slate"
            >
              <div className="space-y-1">
                <Bullet>
                  <b>임차료 {fmtK(m.rent.totalK)}K (YoY {yoyStr(m.rent.yoyPct)})</b>: 사무실 추가 임차 구조적 상승, 계획 {fmtK(m.rent.planK)}K 대비 <b className="text-emerald-700">{yoyStr(m.rent.usagePct)} 집행률</b> — 계획 범위 내.
                </Bullet>
                <Bullet>
                  <b>수주회 {fmtK(m.meeting.totalK)}K (YoY {yoyStr(m.meeting.yoyPct)})</b>: 상반기 가구 제작비 큼. 하반기 <b>하이난</b> 개최 변경 → 재활용 제한 가능성, <b className="text-rose-700">추가 비용 모니터링 필요</b>.
                </Bullet>
              </div>
            </SubSection>

            {/* ④ IT 수수료 */}
            <SubSection
              icon="④"
              title={<>IT 수수료 <span className="text-emerald-800 font-bold">({fmtK(m.it.totalK)}K, YoY {yoyStr(m.it.yoyPct)})</span></>}
              subtitle="효율화와 기술 투자의 병행"
              tone="emerald"
            >
              <Bullet>
                {m.it.yoyPct < 95
                  ? <>전체 지출 감소, </>
                  : m.it.yoyPct <= 105
                  ? <>전체 지출 전년 수준(<b>{yoyStr(m.it.yoyPct)}</b>) 유지, </>
                  : <>전체 지출 소폭 증가(<b>{yoyStr(m.it.yoyPct)}</b>), </>}
                온라인 플랫폼 수수료 절감(<b>{m.it.onlinePlatformDeltaK < 0 ? m.it.onlinePlatformDeltaK.toFixed(0) : `+${m.it.onlinePlatformDeltaK.toFixed(0)}`}K</b>) 재원을{" "}
                {m.it.aiSystemK > 0 && <><b>AI 식별시스템({fmtK(m.it.aiSystemK)}K 신규)</b> · </>}
                {m.it.omsK > 0 && <><b>OMS({yoyStr(m.it.omsYoyPct)}↑)</b> </>}
                자체 시스템 고도화에 재투입 — 디지털 전환 가속화.
              </Bullet>
            </SubSection>
          </div>
        </Section>

        {/* 3. 향후 전략적 관리 방안 — 단기·중기 나란히 */}
        <Section idx={3} title="향후 전략적 관리 방안 제안">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-4">
            <Phase label="단기: 효율 최적화" tone="blue">
              <Bullet>
                <b>광고 타겟팅 정교화</b>: 효율 등급(<b>C → B 이상</b>) 상향 위해 브랜드별 최적 집행 구간 참고 예산 재배분.
              </Bullet>
              <Bullet>
                <b>하이난 수주회 예산 통제</b>: 장소 변경 물류비 상승분·가구 재활용 제약 반영 <b>긴급 예산 검토</b>.
              </Bullet>
            </Phase>
            <Phase label="중기: 수익성 회복" tone="emerald">
              <Bullet>
                <b>SCM 절감 효과 가시화</b>: 창고 이전 후 연간 <b>500만~900만 RMB</b> 절감분 분기 손익 반영, 비용률 <b className="text-emerald-700">4.8% 이하</b> 회복 마일스톤.
              </Bullet>
              <Bullet>
                <b>인당 생산성 유지</b>: 인당 인건비 <b>{m.labor.perPersonK.toFixed(1)}K ({yoyStr(m.labor.perPersonYoyPct)}↑)</b> 상승 추세 — AI·OMS로 인력 운영 효율성 극대화.
              </Bullet>
            </Phase>
          </div>
        </Section>

        {/* 결론 — navy 그라데이션 */}
        <div className="mt-4 p-5 rounded-lg text-white" style={{ background: NAVY }}>
          <div className="text-[10px] tracking-widest font-semibold text-amber-300 uppercase mb-1">결론</div>
          <p className="text-[12.5px] leading-snug">
            F&amp;F 중국 법인은 현재 <b>&apos;규모의 경제&apos;</b>를 달성하기 위한 과도기적 투자 단계에 있습니다. 창고 이전비·가구 제작비 등 일시적 요인이 제거되고 마케팅 타겟팅이 최적화된다면, <b>하반기에는 매출 성장세와 더불어 압도적인 수익성 개선이 가능</b>할 것으로 판단됩니다.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className={`${inline ? "" : "sticky bottom-0"} bg-slate-50 border-t border-slate-200 px-5 py-2 text-[10px] text-gray-500 flex justify-between shrink-0`}>
        <span>기준: {m.monthLabel} YTD 누적 · 비용 SAP G/L · 매출 Snowflake (자동 산출)</span>
        <span>F&amp;F China Operations Analytics</span>
      </div>
    </div>
  );

  // Section wrapper (섹션 번호 + 제목 + 자식)
  function Section({ idx, title, children }: { idx: number; title: string; children: React.ReactNode }) {
    return (
      <section className="mb-4">
        <SectionHeading index={idx} title={title} />
        {children}
      </section>
    );
  }

  if (inline) return bodyContent;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      {bodyContent}
    </div>
  );
}
