#!/usr/bin/env node
// AI 보고서 로컬 빌더 — Claude API 없이 aggregated-expense.json 기반으로 정적 보고서 생성
// 사용: node scripts/build-ai-report.mjs --year 2026 --month 1 --yearType actual --mode monthly

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// ────────────────────────────────────────────────
// CLI
// ────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      out[a.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}
const args = parseArgs(process.argv);
const year = parseInt(args.year ?? "2026", 10);
const month = parseInt(args.month ?? "1", 10);
const yearType = args.yearType ?? "actual";
const mode = args.mode ?? "monthly";

const BRANDS = ["MLB", "KIDS", "DISCOVERY", "공통"];
const BRANDS_WITH_CORP = ["법인", "MLB", "KIDS", "DISCOVERY", "공통"];

// ────────────────────────────────────────────────
// Data load
// ────────────────────────────────────────────────
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "aggregated-expense.json"), "utf-8"));

// ────────────────────────────────────────────────
// Aggregation helpers
// ────────────────────────────────────────────────
function bizUnitsFor(brand) {
  return brand === "법인" ? [...BRANDS] : [brand];
}

function sumTotal(bizUnits, y, m, mo, yt) {
  let rows = data.monthly_total.filter(
    (r) => bizUnits.includes(r.biz_unit) && r.year === y && (r.year_type || "actual") === yt
  );
  rows = mo === "monthly" ? rows.filter((r) => r.month === m) : rows.filter((r) => r.month <= m);
  if (rows.length === 0) return null;
  const costRaw = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const endMonthRows = rows.filter((r) => r.month === m);
  const headcount = endMonthRows.length > 0
    ? endMonthRows.reduce((s, r) => s + (r.headcount || 0), 0)
    : (rows[rows.length - 1]?.headcount ?? 0);

  let headcountAvg = headcount;
  const months = [...new Set(rows.map((r) => r.month))].sort((a, b) => a - b);
  if (mo === "ytd" && months.length > 0) {
    const monthlyTotals = months.map((mm) => rows.filter((r) => r.month === mm).reduce((s, r) => s + (r.headcount || 0), 0));
    headcountAvg = Math.round(monthlyTotals.reduce((s, h) => s + h, 0) / monthlyTotals.length);
  }
  const headcountSum = months.reduce((s, mm) => {
    return s + rows.filter((r) => r.month === mm).reduce((ms, r) => ms + (r.headcount || 0), 0);
  }, 0);

  // 매출 합산 분모 규칙
  // - 일반 브랜드/법인: 자기 매출만 (공통 제외)
  // - 공통 단독 분석 시: 전체 브랜드 매출 합계를 분모로 (공통 비용률 = 공통비용 / 전체매출)
  let salesBu = bizUnits.filter((b) => b !== "공통");
  if (salesBu.length === 0) {
    // 공통만 단독 분석 → 전체 브랜드 매출 합 사용
    salesBu = ["MLB", "KIDS", "DISCOVERY"];
  }
  // 단, 행 필터링 시 같은 (year, month, year_type) 범위 내 다른 브랜드 매출 합산
  let salesRows;
  if (bizUnits.length === 1 && bizUnits[0] === "공통") {
    // 전체 brand 데이터에서 동일 기간 매출 추출
    salesRows = data.monthly_total.filter(
      (r) => salesBu.includes(r.biz_unit) && r.year === y && (r.year_type || "actual") === yt
    );
    if (mo === "monthly") salesRows = salesRows.filter((r) => r.month === m);
    else salesRows = salesRows.filter((r) => r.month <= m);
  } else {
    salesRows = rows.filter((r) => salesBu.includes(r.biz_unit));
  }
  const salesRaw = salesRows.reduce((s, r) => s + (r.sales || 0), 0);

  return {
    cost: Math.round(costRaw / 1000),
    headcount,
    headcountAvg,
    headcountSum,
    sales: Math.round(salesRaw / 1000),
  };
}

function sumCategories(bizUnits, y, m, mo, yt) {
  let rows = data.monthly_aggregated.filter(
    (r) => bizUnits.includes(r.biz_unit) && r.year === y && (r.year_type || "actual") === yt
  );
  rows = mo === "monthly" ? rows.filter((r) => r.month === m) : rows.filter((r) => r.month <= m);
  const raw = {};
  for (const r of rows) raw[r.cost_lv1] = (raw[r.cost_lv1] || 0) + (r.amount || 0);
  const out = {};
  for (const k of Object.keys(raw)) out[k] = Math.round(raw[k] / 1000);
  return out;
}

function sumLv2(bizUnits, y, m, mo, yt, lv1Filter) {
  let rows = data.category_detail.filter(
    (r) =>
      bizUnits.includes(r.biz_unit) &&
      r.year === y &&
      (r.year_type || "actual") === yt &&
      r.cost_lv1 === lv1Filter
  );
  rows = mo === "monthly" ? rows.filter((r) => r.month === m) : rows.filter((r) => r.month <= m);
  const raw = {};
  for (const r of rows) raw[r.cost_lv2] = (raw[r.cost_lv2] || 0) + (r.amount || 0);
  const out = {};
  for (const k of Object.keys(raw)) out[k] = Math.round(raw[k] / 1000);
  return out;
}

// ────────────────────────────────────────────────
// Format helpers
// ────────────────────────────────────────────────
function fmtK(v, decimals = 0) {
  if (v == null || isNaN(v)) return "-";
  const fixed = Number(v).toFixed(decimals);
  const [int, dec] = fixed.split(".");
  const intStr = Number(int).toLocaleString("en-US");
  return dec ? `${intStr}.${dec}` : intStr;
}
function fmtYoy(curr, prev) {
  if (prev == null || prev === 0 || isNaN(prev)) return "-";
  if (curr == null) return "-";
  // 음수가 섞이면 의미 모호 → "-"
  if (prev < 0 && curr > 0) return "-";
  if (prev > 0 && curr < 0) return "-";
  if (prev < 0 && curr < 0) return `${Math.round((curr / prev) * 100)}%`;
  return `${Math.round((curr / prev) * 100)}%`;
}
function fmtPct(v, decimals = 2) {
  if (v == null || isNaN(v)) return "-";
  return `${Number(v).toFixed(decimals)}%`;
}
function diffStr(curr, prev, suffix = "") {
  if (curr == null || prev == null) return "-";
  const d = curr - prev;
  const sign = d >= 0 ? "+" : "";
  return `${sign}${fmtK(d, 0)}${suffix}`;
}
function diffP(curr, prev) {
  if (curr == null || prev == null) return "-";
  const d = curr - prev;
  const sign = d >= 0 ? "+" : "";
  return `${sign}${d.toFixed(2)}p`;
}
function yoyNum(curr, prev) {
  if (prev == null || prev === 0) return null;
  if ((prev < 0 && curr > 0) || (prev > 0 && curr < 0)) return null;
  return (curr / prev) * 100;
}

// ────────────────────────────────────────────────
// 임계값
// ────────────────────────────────────────────────
const baseline = Math.round((month / 12) * 1000) / 10;
const normalMin = Math.max(0, Math.round((baseline - 5) * 10) / 10);
const normalMax = Math.round((baseline + 5) * 10) / 10;
const cautionMax = Math.round((baseline + 15) * 10) / 10;
const heavyOverMin = Math.round(baseline * 2 * 10) / 10;
const SALARY_GUIDELINE_MIN = 105;
const SALARY_GUIDELINE_MAX = 110;

// 시점차 항목 (RISK_TABLE 자동 분류 시 제외하거나 "—" 판정)
const SEASONAL_ITEMS = new Set(["수주회", "Red pack", "세금과공과"]);

// ────────────────────────────────────────────────
// 비즈니스 컨텍스트 오버라이드 (자동 감지 불가능한 케이스)
// 매월 새 케이스 생기면 이 배열에 추가만 하면 빌더 곳곳에 자동 적용
// ────────────────────────────────────────────────
const BUSINESS_OVERRIDES = [
  {
    brand: "KIDS",
    category: "인건비",
    year: 2026,
    label: "🔀 인력재배치",
    note: "KIDS 관리직 1인 MLB로 이동 — 단순 인력 재배치, 실효적 절감 아님",
    relatedBrand: "MLB",
    excludeFromTop3: true,
    excludeFromBest: true,
  },
  {
    brand: "MLB",
    category: "인건비",
    year: 2026,
    label: "🔀 인력재배치",
    note: "KIDS 관리직 1인 MLB로 이동분 포함 — 실효적 증가분과 인력 재배치 분리 필요",
    relatedBrand: "KIDS",
    excludeFromTop3: false,
  },
  {
    brand: "DISCOVERY",
    category: "인건비",
    year: 2026,
    label: "📈 성장단계",
    note: "전년 중국 시장 진출 초기로 인원 적음, 당년 신규 입사 반영 — 인건비 증가는 성장 단계 정상",
    excludeFromTop3: true,
    excludeFromBest: false,
  },
  {
    brand: "DISCOVERY",
    category: "광고비",
    year: 2026,
    label: "📈 성장단계",
    note: "전년 진출 초기 → 당년 매출 확대 단계, 광고비 절대 금액 증가는 정상 투자 — 비용률 감소는 매출 효과",
    excludeFromTop3: true,
    excludeFromBest: false,
  },
];

function findOverride(brand, category) {
  return BUSINESS_OVERRIDES.find((o) => o.year === year && o.brand === brand && o.category === category);
}

// 비용률 공식: 비용 × 1.13 / 리테일 매출 (매출 부가세 포함, 비용 미포함 → 가산)
const VAT_FACTOR = 1.13;
function calcCostRatio(cost, sales) {
  if (!sales || sales <= 0) return 0;
  return (cost * VAT_FACTOR / sales) * 100;
}

// 비용 분류
const COST_CLASS = {
  고정비: ["인건비", "임차료", "감가상각비"],
  준고정비: ["복리후생비", "IT수수료", "기타", "차량렌트비"],
  변동비: ["광고비", "수주회", "출장비", "지급수수료", "세금과공과"],
};
function classifyCost(lv1) {
  for (const [cls, items] of Object.entries(COST_CLASS)) {
    if (items.includes(lv1)) return cls;
  }
  return "기타";
}

// ────────────────────────────────────────────────
// 데이터 빌드
// ────────────────────────────────────────────────
const PREV_YEAR = year - 1;

const brandData = {};
for (const brand of BRANDS_WITH_CORP) {
  const bu = bizUnitsFor(brand);
  brandData[brand] = {
    monthly: {
      current: sumTotal(bu, year, month, "monthly", yearType),
      previous: sumTotal(bu, PREV_YEAR, month, "monthly", "actual"),
      currCats: sumCategories(bu, year, month, "monthly", yearType),
      prevCats: sumCategories(bu, PREV_YEAR, month, "monthly", "actual"),
      currLabor: sumLv2(bu, year, month, "monthly", yearType, "인건비"),
      prevLabor: sumLv2(bu, PREV_YEAR, month, "monthly", "actual", "인건비"),
    },
    ytd: {
      current: sumTotal(bu, year, month, "ytd", yearType),
      previous: sumTotal(bu, PREV_YEAR, month, "ytd", "actual"),
      currCats: sumCategories(bu, year, month, "ytd", yearType),
      prevCats: sumCategories(bu, PREV_YEAR, month, "ytd", "actual"),
      currLabor: sumLv2(bu, year, month, "ytd", yearType, "인건비"),
      prevLabor: sumLv2(bu, PREV_YEAR, month, "ytd", "actual", "인건비"),
    },
    ytdPlan: {
      total: sumTotal(bu, 2026, month, "ytd", "plan"),
      cats: sumCategories(bu, 2026, month, "ytd", "plan"),
      labor: sumLv2(bu, 2026, month, "ytd", "plan", "인건비"),
    },
    annualPlan: {
      total: sumTotal(bu, 2026, 12, "ytd", "plan"),
      cats: sumCategories(bu, 2026, 12, "ytd", "plan"),
    },
  };
}

const adMlb = {
  monthly: {
    current: sumLv2(["MLB"], year, month, "monthly", yearType, "광고비"),
    previous: sumLv2(["MLB"], PREV_YEAR, month, "monthly", "actual", "광고비"),
  },
  ytd: {
    current: sumLv2(["MLB"], year, month, "ytd", yearType, "광고비"),
    previous: sumLv2(["MLB"], PREV_YEAR, month, "ytd", "actual", "광고비"),
  },
};

// ────────────────────────────────────────────────
// 인사이트 헬퍼
// ────────────────────────────────────────────────
function laborAnalysisText(yoy, hcCurr, hcPrev, redPackTimingDiff = false) {
  if (yoy == null) return "데이터 부족 — 판정 보류";
  const r = Math.round(yoy);
  const hcChange = hcCurr - hcPrev;
  const hcNote = hcChange === 0 ? "" : ` 인원 ${hcPrev}→${hcCurr}명${hcChange > 0 ? " 증가" : " 감소"}`;
  if (redPackTimingDiff && r < SALARY_GUIDELINE_MIN) {
    return `Red pack 시점차 영향 — 전년 동기 일시 지급분 미반영, YTD 누적 정상화 시 재판정${hcNote}`;
  }
  if (r >= SALARY_GUIDELINE_MIN && r <= SALARY_GUIDELINE_MAX) return "인건비 상승 +7~8% 적용 시 정상범위";
  if (r > SALARY_GUIDELINE_MAX) return `인건비 상승 반영분 상회 — 구조적 인건비 부담 점검${hcNote}`;
  return `인건비 상승 반영분 하회 — 인력 구성 변화 또는 신규채용 지연 점검${hcNote}`;
}
function laborLv2AnalysisText(lv2, yoy, currK, prevK) {
  const r = yoy == null ? null : Math.round(yoy);
  if (lv2 === "기본급") {
    if (r == null) return "전년 비교 불가";
    if (r >= SALARY_GUIDELINE_MIN && r <= SALARY_GUIDELINE_MAX) return "인건비 상승 +7~8% 적용 시 정상범위";
    if (r > SALARY_GUIDELINE_MAX) return "인건비 상승 반영분 상회 — 인당 단가 상승 점검";
    return "인건비 상승 반영분 하회 — 인원 또는 처우 변동 가능성";
  }
  if (lv2 === "Red pack") {
    if (r == null) return "연 1회 지급 — 시점차 가능";
    if (r >= 95 && r <= 105) return "연 1회 지급 특성, 전년 수준 유지로 정상";
    if (r > 105) return "Red pack 증액 — 인원 증가 또는 단가 상승 영향";
    return "Red pack 감소 — 인원 감소 또는 시점차 가능";
  }
  if (lv2 === "성과급충당금") {
    if (currK > 0 && prevK <= 0) return "전년 마이너스→당년 플러스 전환, 성과 기대치 상향 시그널";
    if (currK <= 0 && prevK > 0) return "전년 플러스→당년 마이너스 전환, 성과 기대치 하향 시그널";
    if (r == null) return "성과 기대치 변동 — 추이 모니터링";
    if (r > 110) return "성과 기대치 상향 시그널 — 충당금 증액";
    if (r < 90) return "성과 기대치 하향 시그널 — 충당금 축소";
    return "전년 수준 유지";
  }
  if (lv2 === "잡급") {
    if (r == null) return "절대 금액 미미";
    if (r > 110) return "소폭 증가, 비중 미미";
    if (r < 90) return "소폭 감소, 비중 미미";
    return "전년 수준 유지";
  }
  return "";
}

// ────────────────────────────────────────────────
// 섹션 빌더
// ────────────────────────────────────────────────
function sec(name, body) {
  return `===${name}===\n${body.trim()}\n`;
}

function buildMeta() {
  return sec("META", `${year}|${yearType}|${year}년 중국법인 예산구조진단 보고서`);
}

function buildKpi() {
  const corpM = brandData["법인"].monthly;
  const corpY = brandData["법인"].ytd;
  const sM = corpM.current.sales, sMP = corpM.previous?.sales ?? null;
  const sY = corpY.current.sales, sYP = corpY.previous?.sales ?? null;
  const cM = corpM.current.cost, cMP = corpM.previous?.cost ?? null;
  const cY = corpY.current.cost, cYP = corpY.previous?.cost ?? null;

  // 비용률 = 비용 × 1.13 / 리테일 매출 (매출 부가세 포함, 비용 미포함)
  const ratioM = calcCostRatio(cM, sM);
  const ratioMP = calcCostRatio(cMP, sMP);
  const ratioY = calcCostRatio(cY, sY);
  const ratioYP = calcCostRatio(cYP, sYP);
  const verdict = ratioY < ratioYP ? "개선(YTD 기준)" : ratioY > ratioYP ? "악화(YTD 기준)" : "전년 동등";

  const hc = corpY.current.headcount;
  const hcAvg = corpY.current.headcountAvg;
  const hcPrev = corpY.previous?.headcount ?? hc;
  const hcDiff = hc - hcPrev;
  const hcDiffStr = `${hcDiff > 0 ? "+" : hcDiff < 0 ? "" : ""}${hcDiff}명`;

  const perCapSalesY = corpY.current.headcountSum > 0 ? Math.round(corpY.current.sales / corpY.current.headcountSum) : null;
  const perCapSalesPrev = corpY.previous && corpY.previous.headcountSum > 0
    ? corpY.previous.sales / corpY.previous.headcountSum
    : null;
  const perCapYoy = perCapSalesY != null && perCapSalesPrev ? Math.round((perCapSalesY / perCapSalesPrev) * 100) : null;

  // 광고비: MLB/KIDS/DISCOVERY YTD 기준만 (브랜드별:금액:YOY 인코딩)
  const adBrandLine = (br) => {
    const c = brandData[br].ytd.currCats["광고비"] ?? 0;
    const p = brandData[br].ytd.prevCats["광고비"] ?? 0;
    return `${br}:${fmtK(c)}K:${fmtYoy(c, p)}`;
  };

  const lines = [
    `판매매출|${fmtK(sM)}K|${fmtYoy(sM, sMP)}|${fmtK(sY)}K|${fmtYoy(sY, sYP)}`,
    `총비용|${fmtK(cM)}K|${fmtYoy(cM, cMP)}|${fmtK(cY)}K|${fmtYoy(cY, cYP)}`,
    `비용률|당월 ${ratioM.toFixed(2)}%|${diffP(ratioM, ratioMP)}|YTD ${ratioY.toFixed(2)}%|${diffP(ratioY, ratioYP)}|${verdict}`,
    `인원|${hc}명(기말)/${hcAvg}명(평균)|${hcDiffStr}|YTD 인당매출 ${fmtK(perCapSalesY)}K|YOY ${perCapYoy != null ? perCapYoy + "%" : "-"}`,
    `광고비|${adBrandLine("MLB")}|${adBrandLine("KIDS")}|${adBrandLine("DISCOVERY")}`,
  ];
  return sec("KPI", lines.join("\n"));
}

function judgeUsage(usage, isSeasonal) {
  if (usage == null) return null;
  if (isSeasonal) return null;
  if (usage > cautionMax) return "🟡";
  return null;
}

function isRedPackTimingDiff(bd) {
  // 전년 동기 Red pack 지급 + 당년 미지급(or 절반 이하) → 시점차
  const prev = bd.ytd.prevLabor["Red pack"] ?? 0;
  const curr = bd.ytd.currLabor["Red pack"] ?? 0;
  if (prev <= 0) return false;
  return curr === 0 || curr / prev < 0.5;
}

function buildRiskTable() {
  const rows = [];
  rows.push("| 항목 | 판정 | 수치/원인 |");
  rows.push("|------|------|-----------|");
  for (const brand of BRANDS_WITH_CORP) {
    const bd = brandData[brand];
    const ytdCats = bd.ytd.currCats;
    const ytdPlanCats = bd.ytdPlan.cats;
    const annualCats = bd.annualPlan.cats;
    const prevCats = bd.ytd.prevCats;
    const redPackTiming = isRedPackTimingDiff(bd);

    const brandRows = [];
    for (const lv1 of Object.keys(ytdCats).sort()) {
      const curr = ytdCats[lv1];
      const prev = prevCats[lv1] ?? 0;
      const ytdPlan = ytdPlanCats[lv1] ?? null;
      const annPlan = annualCats[lv1] ?? null;
      const yoy = yoyNum(curr, prev);
      const planRatio = ytdPlan && ytdPlan > 0 ? (curr / ytdPlan) * 100 : null;
      const usage = annPlan && annPlan > 0 ? (curr / annPlan) * 100 : null;
      const isSeasonal = SEASONAL_ITEMS.has(lv1);

      let verdict = null;
      const reasons = [];

      if (isSeasonal) {
        if (lv1 === "수주회") {
          verdict = "—";
          reasons.push("시즌 선집행 정상 패턴");
        } else if (lv1 === "세금과공과") {
          if ((planRatio != null && planRatio > 130) || (yoy != null && yoy < 50)) {
            verdict = "🟡";
            reasons.push("납부 시점 이연 추정, 하반기 집중 납부 가능");
          }
        }
      } else if (lv1 === "인건비" && redPackTiming) {
        // Red pack 시점차로 인한 인건비 변동은 시점차로 처리, 계획비 110% 초과만 🟡
        if (planRatio != null && planRatio > 110) {
          verdict = "🟡";
          reasons.push(`Red pack 시점차 영향 가능, 계획비 ${Math.round(planRatio)}% 초과 점검 필요`);
        }
      } else if (findOverride(brand, lv1)) {
        // 비즈니스 오버라이드 (인력재배치 등) — RISK_TABLE에서는 별도 라벨 + 노트
        const ov = findOverride(brand, lv1);
        verdict = ov.label;
        reasons.push(ov.note);
      } else {
        // 일반 카테고리 판정 (임계값 완화: 130% 이상 또는 70% 이하만 🔴)
        if (yoy != null && yoy >= 130 && (planRatio == null || planRatio > 110)) {
          verdict = "🔴";
          reasons.push(`YOY ${Math.round(yoy)}% 급증, 계획비 ${planRatio != null ? Math.round(planRatio) : "-"}%`);
        } else if (yoy != null && yoy <= 70 && !isSeasonal) {
          verdict = "🔴";
          reasons.push(`YOY ${Math.round(yoy)}% 급감, 구조적 변화 점검`);
        } else if (planRatio != null && planRatio > 115) {
          verdict = "🟡";
          reasons.push(`계획비 ${Math.round(planRatio)}% 초과`);
        } else if (yoy != null && yoy >= 115 && yoy < 130) {
          verdict = "🟡";
          reasons.push(`YOY ${Math.round(yoy)}% 증가, 추이 모니터링`);
        } else if (yoy != null && yoy >= 71 && yoy <= 85) {
          verdict = "🟡";
          reasons.push(`YOY ${Math.round(yoy)}% 감소, 추이 모니터링`);
        }
      }

      if (verdict) {
        const planStr = ytdPlan != null ? `${fmtK(ytdPlan)}K` : "-";
        const planRatioStr = planRatio != null ? `${Math.round(planRatio)}%` : "-";
        const usageStr = usage != null ? `${usage.toFixed(1)}%` : "-";
        const annStr = annPlan != null ? `${fmtK(annPlan)}K` : "-";
        // 브랜드별 지급수수료 등: 최대 lv2 항목 괄호 표시 (공통비용으로 오해 방지)
        let lv1Display = lv1;
        if (brand !== "공통" && brand !== "법인" && (lv1 === "지급수수료" || lv1 === "복리후생비" || lv1 === "IT수수료")) {
          const top = getTopLv2(brand, lv1);
          if (top && top.amount > 0) {
            lv1Display = `${lv1} (${top.name})`;
          }
        }
        const detail = `YTD 실적 ${fmtK(curr)}K / 계획 ${planStr} (계획비 ${planRatioStr}) / 사용률 ${usageStr} / 연간계획 ${annStr} — ${reasons.join(", ")}`;
        brandRows.push(`| ${lv1Display} | ${verdict} | ${detail} |`);
      }
    }

    // 성과급충당금 마이너스 전환 점검 (시점차 영향 무관, 구조 시그널)
    const lab = bd.ytd.currLabor;
    const labPrev = bd.ytd.prevLabor;
    if (brand !== "법인") {
      const sg = lab["성과급충당금"] ?? 0;
      const sgPrev = labPrev["성과급충당금"] ?? 0;
      if (sg < 0 && sgPrev > 0) {
        const totalLabor = bd.ytd.currCats["인건비"];
        const planLabor = bd.ytdPlan.cats["인건비"] ?? null;
        const annLabor = bd.annualPlan.cats["인건비"] ?? null;
        const planR = planLabor && planLabor > 0 ? (totalLabor / planLabor) * 100 : null;
        const usg = annLabor && annLabor > 0 ? (totalLabor / annLabor) * 100 : null;
        const detail = `YTD 인건비 ${fmtK(totalLabor)}K / 계획 ${fmtK(planLabor)}K (계획비 ${planR != null ? Math.round(planR) + "%" : "-"}) / 사용률 ${usg != null ? usg.toFixed(1) + "%" : "-"} / 연간계획 ${fmtK(annLabor)}K — 성과급충당금 마이너스(${fmtK(sg)}K) 전환, 인건비 구조 점검 필요`;
        if (!brandRows.some((r) => r.startsWith("| 인건비 |"))) {
          brandRows.push(`| 인건비 | 🔴 | ${detail} |`);
        }
      }
    }

    if (brandRows.length > 0) {
      rows.push(`| **${brand === "법인" ? "법인전체" : brand}** | | |`);
      rows.push(...brandRows);
    }
  }
  return sec("RISK_TABLE", rows.join("\n"));
}

function buildYoyTable() {
  const corpY = brandData["법인"].ytd;
  const sales = corpY.current.sales;
  const prevSales = corpY.previous?.sales ?? 0;
  const r = [];
  r.push("| 항목 | YOY | 매출比 | 판단 |");
  r.push("|------|-----|--------|------|");

  // 법인 총비용
  const cost = corpY.current.cost, prevCost = corpY.previous?.cost ?? 0;
  const costYoy = yoyNum(cost, prevCost);
  const costRatio = calcCostRatio(cost, sales);
  const prevCostRatio = calcCostRatio(prevCost, prevSales);
  const salesYoy = yoyNum(sales, prevSales);
  const costJudge = costYoy != null && salesYoy != null && costYoy <= salesYoy
    ? "🟡 비용 증가율 매출 증가율 하회, 비용률 개선. 정상"
    : "🟡 비용 증가율 매출 증가율 상회, 비용률 악화 가능";
  const costRatioDelta = costRatio - prevCostRatio;
  const costRatioDeltaStr = `${costRatioDelta >= 0 ? "+" : ""}${costRatioDelta.toFixed(2)}%p`;
  r.push(`| 법인 총비용(YTD) | ${costYoy != null ? Math.round(costYoy) + "%" : "-"} | ${costRatio.toFixed(2)}% (${costRatioDeltaStr}) | ${costJudge} |`);

  // 주요 비용 항목별 YOY/매출비율
  const items = ["인건비", "광고비", "수주회", "세금과공과"];
  for (const it of items) {
    const cur = corpY.currCats[it] ?? 0;
    const prv = corpY.prevCats[it] ?? 0;
    const yoy = yoyNum(cur, prv);
    const ratio = calcCostRatio(cur, sales);
    const prvRatio = calcCostRatio(prv, prevSales);
    let judge;
    if (it === "수주회") {
      judge = "시즌 선집행 정상 패턴 — YTD 누적 패턴은 분기별 점검";
    } else if (it === "세금과공과") {
      const annPlan = brandData["법인"].annualPlan.cats["세금과공과"] ?? null;
      const planRatio = brandData["법인"].ytdPlan.cats["세금과공과"]
        ? (cur / brandData["법인"].ytdPlan.cats["세금과공과"]) * 100
        : null;
      judge = `🟡 납부 시점 이연 가능, 연간계획 ${annPlan ? fmtK(annPlan) + "K" : "-"} 대비 하반기 집중납부 리스크`;
    } else if (it === "인건비") {
      const yr = yoy != null ? Math.round(yoy) : null;
      const corpRpT = isRedPackTimingDiff(brandData["법인"]);
      judge = yr == null ? "데이터 부족"
        : (corpRpT && yr < SALARY_GUIDELINE_MIN) ? "정상(Red pack 시점차) — 전년 동기 일시 지급분 미반영, YTD 누적 정상화 시 재판정"
        : (yr >= SALARY_GUIDELINE_MIN && yr <= SALARY_GUIDELINE_MAX) ? "정상 — 연봉인상 +7~8% 기준 내"
        : yr > SALARY_GUIDELINE_MAX ? "🟡 인건비 상승 반영분 상회"
        : "🟡 인건비 상승 반영분 하회 — 인력 구성 변화 가능";
    } else {
      const yr = yoy != null ? Math.round(yoy) : null;
      judge = yr != null && salesYoy != null && yr > Math.round(salesYoy)
        ? `🟡 매출 YOY ${Math.round(salesYoy)}% 대비 ${it} YOY ${yr}% 상회`
        : `정상`;
    }
    const itDelta = ratio - prvRatio;
    const itDeltaStr = `${itDelta >= 0 ? "+" : ""}${itDelta.toFixed(2)}%p`;
    r.push(`| ${it}(YTD) | ${yoy != null ? Math.round(yoy) + "%" : "-"} | ${ratio.toFixed(2)}% (${itDeltaStr}) | ${judge} |`);
  }

  // 브랜드 단위 트렌드 (KIDS/DISCOVERY) 1~2개
  for (const br of ["KIDS", "DISCOVERY"]) {
    const bdRaw = brandData[br];
    const bd = bdRaw.ytd;
    const c = bd.currCats["인건비"] ?? 0;
    const p = bd.prevCats["인건비"] ?? 0;
    const yoy = yoyNum(c, p);
    if (yoy != null && (yoy < 80 || yoy > 130)) {
      const sBr = bd.current.sales;
      const sBrPrev = bd.previous?.sales ?? 0;
      const ratio = calcCostRatio(c, sBr);
      const prvRatio = calcCostRatio(p, sBrPrev);
      const yr = Math.round(yoy);
      const rpT = isRedPackTimingDiff(bdRaw);
      const ov = findOverride(br, "인건비");
      const judge = ov
        ? `${ov.label} ${ov.note}`
        : rpT && yr < SALARY_GUIDELINE_MIN
        ? "정상(Red pack 시점차) — YTD 누적 정상화 시 재판정"
        : yr < 80 ? "🔴 인건비 압축 — 성과급 또는 인원 변동 점검"
        : "🟡 인건비 급증 — 인원/단가 변동 점검";
      const brDelta = ratio - prvRatio;
      const brDeltaStr = `${brDelta >= 0 ? "+" : ""}${brDelta.toFixed(2)}%p`;
      r.push(`| ${br} 인건비(YTD) | ${yr}% | ${ratio.toFixed(2)}% (${brDeltaStr}) | ${judge} |`);
    }
  }

  return sec("YOY_TABLE", r.join("\n"));
}

function buildCostStructure() {
  const ytdCats = brandData["법인"].ytd.currCats;
  const prevCats = brandData["법인"].ytd.prevCats;

  const fixed = (ytdCats["인건비"] ?? 0) + (ytdCats["임차료"] ?? 0) + (ytdCats["감가상각비"] ?? 0);
  const semi = (ytdCats["복리후생비"] ?? 0) + (ytdCats["IT수수료"] ?? 0) + (ytdCats["기타"] ?? 0) + (ytdCats["차량렌트비"] ?? 0);
  const variable = (ytdCats["광고비"] ?? 0) + (ytdCats["수주회"] ?? 0) + (ytdCats["출장비"] ?? 0) + (ytdCats["지급수수료"] ?? 0) + (ytdCats["세금과공과"] ?? 0);
  const total = fixed + semi + variable;

  const fixedPrev = (prevCats["인건비"] ?? 0) + (prevCats["임차료"] ?? 0) + (prevCats["감가상각비"] ?? 0);
  const semiPrev = (prevCats["복리후생비"] ?? 0) + (prevCats["IT수수료"] ?? 0) + (prevCats["기타"] ?? 0) + (prevCats["차량렌트비"] ?? 0);
  const variablePrev = (prevCats["광고비"] ?? 0) + (prevCats["수주회"] ?? 0) + (prevCats["출장비"] ?? 0) + (prevCats["지급수수료"] ?? 0) + (prevCats["세금과공과"] ?? 0);

  const totalPrev = fixedPrev + semiPrev + variablePrev;
  const lines = [
    `고정비|인건비+임차료+감가상각비|${fmtK(fixed)}K|${total > 0 ? ((fixed / total) * 100).toFixed(1) : "-"}%|YOY ${fmtYoy(fixed, fixedPrev)}`,
    `준고정비|복리후생비+IT수수료+기타+차량렌트비|${fmtK(semi)}K|${total > 0 ? ((semi / total) * 100).toFixed(1) : "-"}%|YOY ${fmtYoy(semi, semiPrev)}`,
    `변동비|광고비+수주회+출장비+지급수수료+세금과공과|${fmtK(variable)}K|${total > 0 ? ((variable / total) * 100).toFixed(1) : "-"}%|YOY ${fmtYoy(variable, variablePrev)}`,
    `합계|법인 전체 YTD 총비용|${fmtK(total)}K|100.0%|YOY ${fmtYoy(total, totalPrev)}`,
  ];
  return { text: sec("COST_STRUCTURE", lines.join("\n")), fixed, semi, variable, total };
}

function buildCostInsight(cs) {
  const ad = brandData["법인"].ytd.currCats["광고비"] ?? 0;
  const adShare = cs.total > 0 ? ((ad / cs.total) * 100).toFixed(1) : "-";
  const varShare = cs.total > 0 ? ((cs.variable / cs.total) * 100).toFixed(1) : "-";
  const body = `▶ YTD 총비용의 ${varShare}%를 광고비·수주회 중심 변동비가 차지하며, 광고비 단독으로 전체 비용의 ${adShare}% 점유 — 광고 집행 효율이 법인 전체 비용구조 최대 드라이버`;
  return sec("COST_INSIGHT", body);
}

function buildKeyInsight() {
  const corpY = brandData["법인"].ytd;
  const salesYoy = yoyNum(corpY.current.sales, corpY.previous?.sales ?? 0);
  const costYoy = yoyNum(corpY.current.cost, corpY.previous?.cost ?? 0);
  const tax = corpY.currCats["세금과공과"] ?? 0;
  const taxPlan = brandData["법인"].ytdPlan.cats["세금과공과"] ?? null;
  const taxPlanRatio = taxPlan && taxPlan > 0 ? Math.round((tax / taxPlan) * 100) : null;

  const kidsLab = brandData["KIDS"].ytd.currCats["인건비"] ?? 0;
  const kidsLabPrev = brandData["KIDS"].ytd.prevCats["인건비"] ?? 0;
  const kidsLabYoy = yoyNum(kidsLab, kidsLabPrev);

  const periodTxt = mode === "ytd" ? `1~${month}월` : `${month}월`;
  const parts = [];
  parts.push(`2026년 ${periodTxt} 법인 YTD 매출 ${fmtK(corpY.current.sales)}K (${salesYoy != null ? "YOY " + Math.round(salesYoy) + "%" : ""}) 성장 속에 총비용 ${fmtK(corpY.current.cost)}K (${costYoy != null ? "YOY " + Math.round(costYoy) + "%" : ""})로 비용 ${costYoy != null && salesYoy != null && costYoy <= salesYoy ? "증가율이 매출을 하회하며 전반적 비용 효율 유지" : "증가율이 매출을 상회하여 비용률 악화 점검 필요"}.`);

  const corpRpTiming = isRedPackTimingDiff(brandData["법인"]);
  const kidsRpTiming = isRedPackTimingDiff(brandData["KIDS"]);
  const kidsLabKi = brandData["KIDS"].ytd.currCats["인건비"] ?? 0;
  const kidsLabKiPrev = brandData["KIDS"].ytd.prevCats["인건비"] ?? 0;
  const kidsLabKiYoy = yoyNum(kidsLabKi, kidsLabKiPrev);

  const flags = [];
  if (kidsLabKiYoy != null && kidsLabKiYoy < 80 && !kidsRpTiming) flags.push(`KIDS 인건비 구조적 압축(YOY ${Math.round(kidsLabKiYoy)}%)`);
  if (taxPlanRatio != null && taxPlanRatio > 130) flags.push(`세금과공과 하반기 집중납부 리스크(계획비 ${taxPlanRatio}%)`);
  if (corpRpTiming) flags.push(`법인 인건비 YOY 하락은 Red pack 시점차(전년 동기 일시 지급분 미반영)로 인한 일시 현상`);

  if (flags.length > 0) parts.push(`단, ${flags.join("; ")}이 즉시 원인 확인 및 경영진 의사결정 사안이다.`);

  return sec("KEY_INSIGHT", parts.join(" "));
}

function buildBullets() {
  const corpY = brandData["법인"].ytd;
  const corpM = brandData["법인"].monthly;
  const bullets = [];

  // 1) 매출/비용/비용률
  const salesY = corpY.current.sales, salesYP = corpY.previous?.sales ?? 0;
  const costY = corpY.current.cost, costYP = corpY.previous?.cost ?? 0;
  const ratioY = calcCostRatio(costY, salesY);
  const ratioYP = calcCostRatio(costYP, salesYP);
  const ratioM = calcCostRatio(corpM.current.cost, corpM.current.sales);
  const ratioMP = calcCostRatio(corpM.previous?.cost ?? 0, corpM.previous?.sales ?? 0);
  const direction = ratioY < ratioYP ? "개선" : "악화";
  bullets.push(`• 법인 YTD 총비용 ${fmtK(costY)}K (YOY ${Math.round(yoyNum(costY, costYP) ?? 0)}%), 매출 ${fmtK(salesY)}K (YOY ${Math.round(yoyNum(salesY, salesYP) ?? 0)}%) — 비용 증가율이 매출 증가율을 ${(yoyNum(costY, costYP) ?? 0) <= (yoyNum(salesY, salesYP) ?? 0) ? "하회" : "상회"}하여 비용률 ${direction}(YTD ${ratioYP.toFixed(2)}% → ${ratioY.toFixed(2)}%, 당월 ${ratioMP.toFixed(2)}% → ${ratioM.toFixed(2)}%)`);

  // 2) 인건비
  const lab = corpY.currCats["인건비"] ?? 0;
  const labPrev = corpY.prevCats["인건비"] ?? 0;
  const labYoy = yoyNum(lab, labPrev);
  const hcSum = corpY.current.headcountSum;
  const hcSumPrev = corpY.previous?.headcountSum ?? 0;
  const perCap = hcSum > 0 ? lab / hcSum : 0;
  const perCapPrev = hcSumPrev > 0 ? labPrev / hcSumPrev : 0;
  const perCapYoy = perCapPrev > 0 ? Math.round((perCap / perCapPrev) * 100) : null;
  const corpRpTiming = isRedPackTimingDiff(brandData["법인"]);
  const kidsBd = brandData["KIDS"];
  const kidsLab = kidsBd.ytd.currCats["인건비"] ?? 0;
  const kidsLabPrev = kidsBd.ytd.prevCats["인건비"] ?? 0;
  const kidsLabYoy = yoyNum(kidsLab, kidsLabPrev);
  const kidsRpTiming = isRedPackTimingDiff(kidsBd);
  const kidsClause = kidsLabYoy != null && kidsLabYoy < 90 && !kidsRpTiming
    ? `, 단 KIDS 인건비 YOY ${Math.round(kidsLabYoy)}%로 급감(인원 또는 성과급 변동)` : "";
  const guideline = corpRpTiming && perCapYoy != null && perCapYoy < SALARY_GUIDELINE_MIN
    ? "Red pack 시점차로 인한 일시 감소(전년 1월 일시 지급분 미반영), YTD 누적 정상화 시 재평가"
    : perCapYoy != null && perCapYoy >= SALARY_GUIDELINE_MIN && perCapYoy <= SALARY_GUIDELINE_MAX
    ? "연봉인상 +7~8% 기준 내 정상"
    : perCapYoy != null && perCapYoy > SALARY_GUIDELINE_MAX ? "연봉인상 반영분 상회"
    : perCapYoy != null && perCapYoy < SALARY_GUIDELINE_MIN ? "연봉인상 반영분 하회"
    : "전년 비교 데이터 부족";
  bullets.push(`• YTD 인건비 ${fmtK(lab)}K (YOY ${labYoy != null ? Math.round(labYoy) + "%" : "-"}), 인당 인건비 ${perCap.toFixed(1)}K (전년 ${perCapPrev.toFixed(1)}K, YOY ${perCapYoy != null ? perCapYoy + "%" : "-"}) — ${guideline}${kidsClause}`);

  // 3) MLB 광고비 (브랜드별 합계만)
  const adTotal = brandData["MLB"].ytd.currCats["광고비"] ?? 0;
  const adTotalPrev = brandData["MLB"].ytd.prevCats["광고비"] ?? 0;
  const adAnnPlan = brandData["MLB"].annualPlan.cats["광고비"] ?? null;
  const adUsage = adAnnPlan && adAnnPlan > 0 ? (adTotal / adAnnPlan) * 100 : null;
  const adYoy = yoyNum(adTotal, adTotalPrev);
  if (adYoy != null) {
    const trend = adYoy > 110 ? "증가" : adYoy < 90 ? "감소" : "유지";
    bullets.push(`• MLB YTD 광고비 ${fmtK(adTotal)}K (YOY ${Math.round(adYoy)}%) — 전년 대비 ${trend}, YTD 광고 사용률 ${adUsage != null ? adUsage.toFixed(1) + "%" : "-"} (연간계획 ${fmtK(adAnnPlan)}K)`);
  }

  // 4) 시점차 (세금과공과)
  const tax = corpY.currCats["세금과공과"] ?? 0;
  const taxPrev = corpY.prevCats["세금과공과"] ?? 0;
  const taxPlan = brandData["법인"].ytdPlan.cats["세금과공과"] ?? null;
  const taxAnnPlan = brandData["법인"].annualPlan.cats["세금과공과"] ?? null;
  const taxRatio = taxPlan && taxPlan > 0 ? Math.round((tax / taxPlan) * 100) : null;
  const taxUsage = taxAnnPlan && taxAnnPlan > 0 ? (tax / taxAnnPlan) * 100 : null;
  const taxM = brandData["공통"].monthly.currCats["세금과공과"] ?? 0;
  const taxMP = brandData["공통"].monthly.prevCats["세금과공과"] ?? 0;
  bullets.push(`• 공통 당월 세금과공과 ${fmtK(taxM)}K (YOY ${fmtYoy(taxM, taxMP)}) / YTD ${fmtK(tax)}K vs 계획 ${fmtK(taxPlan)}K (계획비 ${taxRatio != null ? taxRatio + "%" : "-"}) — ${taxRatio != null && taxRatio > 130 ? "납부 시점 집중에 따른 시점차로" : "정상 범위로"} YTD 사용률 ${taxUsage != null ? taxUsage.toFixed(1) + "%" : "-"}이며 연간 계획(${fmtK(taxAnnPlan)}K) 대비 잔여 집행 추적 필요`);

  // 5) DISCOVERY
  const dis = brandData["DISCOVERY"].ytd;
  const disSales = dis.current.sales, disSalesPrev = dis.previous?.sales ?? 0;
  const disCost = dis.current.cost, disCostPrev = dis.previous?.cost ?? 0;
  const disSalesYoy = yoyNum(disSales, disSalesPrev);
  const disCostYoy = yoyNum(disCost, disCostPrev);
  const disAd = dis.currCats["광고비"] ?? 0;
  const disAdPrev = dis.prevCats["광고비"] ?? 0;
  const disAdYoy = yoyNum(disAd, disAdPrev);
  const disRatio = disSales > 0 ? (disCost / disSales) * 100 : 0;
  const disAdAnn = brandData["DISCOVERY"].annualPlan.cats["광고비"] ?? null;
  const disAdUsage = disAdAnn && disAdAnn > 0 ? (disAd / disAdAnn) * 100 : null;
  bullets.push(`• DISCOVERY YTD 매출 ${fmtK(disSales)}K (YOY ${disSalesYoy != null ? Math.round(disSalesYoy) + "%" : "-"}) ${disSalesYoy != null && disSalesYoy > 200 ? "급성장" : "성장"} 중이나 광고비 ${fmtK(disAd)}K (YOY ${disAdYoy != null ? Math.round(disAdYoy) + "%" : "-"}), 비용률 ${disRatio.toFixed(1)}% — ${disRatio > 50 ? "투자 단계 적자 구조 지속" : "비용률 안정화"}, 연간 계획 대비 광고비 사용률 ${disAdUsage != null ? disAdUsage.toFixed(1) + "%" : "-"}로 하반기 집행 여력 확보`);

  return sec("BULLETS", bullets.join("\n"));
}

// ────────────────────────────────────────────────
// DETAILED 1️⃣ A-1. 인당 인건비 분석
// ────────────────────────────────────────────────
function buildLaborPerCapita() {
  const lines = [];
  lines.push("#### A-1. 인당 인건비 분석");
  lines.push("");
  lines.push("| 구분 | 전년 인당(K) | 당년 인당(K) | 전년비(K) | YOY | 분석 |");
  lines.push("|------|------------|------------|----------|-----|------|");

  const corp = brandData["법인"];
  const corpY = corp.ytd;
  const corpHc = corpY.current.headcountSum;
  const corpHcPrev = corpY.previous?.headcountSum ?? 0;
  const corpLab = corpY.currCats["인건비"] ?? 0;
  const corpLabPrev = corpY.prevCats["인건비"] ?? 0;
  const corpPc = corpHc > 0 ? corpLab / corpHc : 0;
  const corpPcPrev = corpHcPrev > 0 ? corpLabPrev / corpHcPrev : 0;
  const corpPcYoy = corpPcPrev > 0 ? (corpPc / corpPcPrev) * 100 : null;
  const corpRpTiming = isRedPackTimingDiff(corp);
  lines.push(`| **법인전체 인당 인건비** | ${corpPcPrev.toFixed(1)} | ${corpPc.toFixed(1)} | ${(corpPc - corpPcPrev) >= 0 ? "+" : ""}${(corpPc - corpPcPrev).toFixed(1)} | ${corpPcYoy != null ? Math.round(corpPcYoy) + "%" : "-"} | ${laborAnalysisText(corpPcYoy, corp.ytd.current.headcount, corp.ytd.previous?.headcount ?? 0, corpRpTiming)} |`);

  // 법인 lv2별 인당
  const LAB_LV2 = ["기본급", "Red pack", "성과급충당금", "잡급"];
  for (const lv2 of LAB_LV2) {
    const c = corpY.currLabor[lv2] ?? 0;
    const p = corpY.prevLabor[lv2] ?? 0;
    const pc = corpHc > 0 ? c / corpHc : 0;
    const pcPrev = corpHcPrev > 0 ? p / corpHcPrev : 0;
    const yoy = pcPrev !== 0 ? (pc / pcPrev) * 100 : null;
    const diff = pc - pcPrev;
    const yoyValid = pcPrev > 0 && pc >= 0 || (pcPrev < 0 && pc < 0);
    lines.push(`| 　${lv2} (인당) | ${pcPrev.toFixed(1)} | ${pc.toFixed(1)} | ${diff >= 0 ? "+" : ""}${diff.toFixed(1)} | ${yoyValid && yoy != null ? Math.round(yoy) + "%" : "-"} | ${laborLv2AnalysisText(lv2, yoyValid && yoy != null ? yoy : null, c, p)} |`);
  }

  // 브랜드별 인당
  for (const br of ["MLB", "KIDS", "DISCOVERY", "공통"]) {
    const bd = brandData[br];
    const y = bd.ytd;
    const hc = y.current.headcountSum;
    const hcPrev = y.previous?.headcountSum ?? 0;
    const lab = y.currCats["인건비"] ?? 0;
    const labPrev = y.prevCats["인건비"] ?? 0;
    const pc = hc > 0 ? lab / hc : 0;
    const pcPrev = hcPrev > 0 ? labPrev / hcPrev : 0;
    const yoy = pcPrev > 0 ? (pc / pcPrev) * 100 : null;
    const diff = pc - pcPrev;
    const rpTiming = isRedPackTimingDiff(bd);
    lines.push(`| **${br} 인당 인건비** | ${pcPrev.toFixed(1)} | ${pc.toFixed(1)} | ${diff >= 0 ? "+" : ""}${diff.toFixed(1)} | ${yoy != null ? Math.round(yoy) + "%" : "-"} | ${laborAnalysisText(yoy, y.current.headcount, y.previous?.headcount ?? 0, rpTiming)} |`);
  }
  return lines.join("\n");
}

// ────────────────────────────────────────────────
// DETAILED 1️⃣ A-2. 인건비 총액
// ────────────────────────────────────────────────
function buildLaborTotal() {
  const lines = [];
  lines.push("#### A-2. 인건비 총액 분석");
  lines.push("");
  lines.push("| 항목 | 당월(전년)K | 당월(당년)K | 당월YOY | YTD(전년)K | YTD(당년)K | YTDYOY | YTD계획K | 계획비% | 사용률% | 연간계획K | 최종판정 |");
  lines.push("|------|-----------|-----------|--------|-----------|-----------|--------|---------|--------|--------|---------|--------|");

  for (const br of BRANDS_WITH_CORP) {
    const bd = brandData[br];
    const m = bd.monthly, y = bd.ytd;
    const labM = m.currCats["인건비"] ?? 0;
    const labMP = m.prevCats["인건비"] ?? 0;
    const labY = y.currCats["인건비"] ?? 0;
    const labYP = y.prevCats["인건비"] ?? 0;
    const planY = bd.ytdPlan.cats["인건비"] ?? null;
    const annY = bd.annualPlan.cats["인건비"] ?? null;
    const planRatio = planY && planY > 0 ? (labY / planY) * 100 : null;
    const usage = annY && annY > 0 ? (labY / annY) * 100 : null;
    const ytdYoy = yoyNum(labY, labYP);
    const rpTiming = isRedPackTimingDiff(bd);
    const verdict = (() => {
      if (ytdYoy == null) return "-";
      const yr = Math.round(ytdYoy);
      // Red pack 시점차일 때 YOY 급감은 시점차로 분류
      if (rpTiming && yr < SALARY_GUIDELINE_MIN) {
        if (planRatio != null && planRatio > 110) return `🟡 — Red pack 시점차로 일시 감소이나 계획비 ${Math.round(planRatio)}% 초과`;
        return `정상(Red pack 시점차) — 전년 동기 일시 지급분 미반영, YTD 누적 정상화 시 재판정`;
      }
      if (yr <= SALARY_GUIDELINE_MAX && yr >= SALARY_GUIDELINE_MIN) return "정상 — YTD 기준 연봉인상 범위 내";
      if (yr > SALARY_GUIDELINE_MAX && (planRatio ?? 0) > 105) return `🟡 — YTD ${yr}% 정상 상한 초과, 계획비 ${Math.round(planRatio)}%`;
      if (yr < 70) return `🔴 — YTD ${yr}% 급감, 인건비 구조 점검 필요`;
      if (yr > SALARY_GUIDELINE_MAX) return `🟡 — YTD ${yr}% 정상 상한 초과`;
      return "정상";
    })();
    const label = br === "법인" ? "법인전체 인건비" : `${br} 인건비`;
    lines.push(`| **${label}** | ${fmtK(labMP)} | ${fmtK(labM)} | ${fmtYoy(labM, labMP)} | ${fmtK(labYP)} | ${fmtK(labY)} | ${ytdYoy != null ? Math.round(ytdYoy) + "%" : "-"} | ${planY != null ? fmtK(planY) : "-"} | ${planRatio != null ? Math.round(planRatio) + "%" : "-"} | ${usage != null ? usage.toFixed(1) + "%" : "-"} | ${annY != null ? fmtK(annY) : "-"} | ${verdict} |`);

    // lv2 분해
    const LAB_LV2 = ["기본급", "Red pack", "성과급충당금", "잡급"];
    for (const lv2 of LAB_LV2) {
      const cm = m.currLabor[lv2] ?? 0;
      const cmp = m.prevLabor[lv2] ?? 0;
      const cy = y.currLabor[lv2] ?? 0;
      const cyp = y.prevLabor[lv2] ?? 0;
      const yYoy = yoyNum(cy, cyp);
      const note = laborLv2AnalysisText(lv2, yYoy, cy, cyp);
      lines.push(`| 　${lv2} | ${fmtK(cmp)} | ${fmtK(cm)} | ${fmtYoy(cm, cmp)} | ${fmtK(cyp)} | ${fmtK(cy)} | ${yYoy != null ? Math.round(yYoy) + "%" : "-"} | - | - | - | - | ${note} |`);
    }
  }
  return lines.join("\n");
}

// ────────────────────────────────────────────────
// DETAILED 1️⃣ B. 광고비
// ────────────────────────────────────────────────
function buildAdAnalysis() {
  const lines = [];
  lines.push("### B. 광고비 분석 (브랜드별)");
  lines.push("");
  lines.push("| 항목 | 당월(전년)K | 당월(당년)K | 당월YOY | YTD(전년)K | YTD(당년)K | YTDYOY | YTD계획K | 계획비% | 사용률% | 연간계획K | 최종판정 |");
  lines.push("|------|-----------|-----------|--------|-----------|-----------|--------|---------|--------|--------|---------|--------|");

  for (const br of ["법인", "MLB", "KIDS", "DISCOVERY"]) {
    const bd = brandData[br];
    const m = bd.monthly, y = bd.ytd;
    const adM = m.currCats["광고비"] ?? 0;
    const adMP = m.prevCats["광고비"] ?? 0;
    const adY = y.currCats["광고비"] ?? 0;
    const adYP = y.prevCats["광고비"] ?? 0;
    const planY = bd.ytdPlan.cats["광고비"] ?? null;
    const annY = bd.annualPlan.cats["광고비"] ?? null;
    const planR = planY && planY > 0 ? (adY / planY) * 100 : null;
    const usage = annY && annY > 0 ? (adY / annY) * 100 : null;
    const ytdYoy = yoyNum(adY, adYP);
    const verdict = (() => {
      if (planR != null && planR > 110) return `🟡 — 계획비 ${Math.round(planR)}% 경계선`;
      if (ytdYoy != null && ytdYoy < 90) return `🟡 — YTD 광고비 감소(${Math.round(ytdYoy)}%)`;
      if (usage != null && usage > cautionMax) return `🟡 — 사용률 ${usage.toFixed(1)}% 초과`;
      return "정상";
    })();
    const label = br === "법인" ? "법인전체 광고비" : `${br} 광고비`;
    lines.push(`| **${label}** | ${fmtK(adMP)} | ${fmtK(adM)} | ${fmtYoy(adM, adMP)} | ${fmtK(adYP)} | ${fmtK(adY)} | ${ytdYoy != null ? Math.round(ytdYoy) + "%" : "-"} | ${planY != null ? fmtK(planY) : "-"} | ${planR != null ? Math.round(planR) + "%" : "-"} | ${usage != null ? usage.toFixed(1) + "%" : "-"} | ${annY != null ? fmtK(annY) : "-"} | ${verdict} |`);

    // 광고비/매출비율
    if (br !== "법인" && br !== "공통") {
      const sM = m.current.sales, sMP = m.previous?.sales ?? 0;
      const sY = y.current.sales, sYP = y.previous?.sales ?? 0;
      const rM = calcCostRatio(adM, sM);
      const rMP = calcCostRatio(adMP, sMP);
      const rY = calcCostRatio(adY, sY);
      const rYP = calcCostRatio(adYP, sYP);
      lines.push(`| 　광고비/매출비율 | ${rMP.toFixed(2)}% | ${rM.toFixed(2)}% | — | ${rYP.toFixed(2)}% | ${rY.toFixed(2)}% | — | — | — | — | — | 광고비율 ${rY > rYP ? "악화" : "유지/개선"} |`);
    }
  }
  return lines.join("\n");
}

// ────────────────────────────────────────────────
// DETAILED 2️⃣ A. 전사 비용률
// ────────────────────────────────────────────────
function buildEfficiency() {
  const lines = [];
  lines.push("## 2️⃣ 매출 대비 비용 효율성 분석");
  lines.push("");
  lines.push("### A. 전사 비용률 분석");
  lines.push("");
  lines.push("| 항목 | 당월(전년)K | 당월(당년)K | 당월YOY | YTD(전년)K | YTD(당년)K | YTDYOY | YTD계획K | 계획비% | 사용률% | 연간계획K | 최종판정 |");
  lines.push("|------|-----------|-----------|--------|-----------|-----------|--------|---------|--------|--------|---------|--------|");

  // 판매매출 (법인 + 브랜드)
  for (const br of ["법인", "MLB", "KIDS", "DISCOVERY"]) {
    const bd = brandData[br];
    const sM = bd.monthly.current.sales, sMP = bd.monthly.previous?.sales ?? 0;
    const sY = bd.ytd.current.sales, sYP = bd.ytd.previous?.sales ?? 0;
    const sPlan = bd.ytdPlan.total?.sales ?? null;
    const sAnn = bd.annualPlan.total?.sales ?? null;
    const planR = sPlan && sPlan > 0 ? (sY / sPlan) * 100 : null;
    const usage = sAnn && sAnn > 0 ? (sY / sAnn) * 100 : null;
    const ytdYoy = yoyNum(sY, sYP);
    const verdict = (() => {
      if (planR == null) return "-";
      if (planR < 90) return `🟡 — 매출 계획 미달(${Math.round(planR)}%)`;
      if (planR > 110) return `정상 — 계획 초과 달성(+${Math.round(planR - 100)}%)`;
      return "정상";
    })();
    const label = br === "법인" ? "**판매매출**" : `　${br}`;
    const labelBold = br === "법인";
    lines.push(`| ${labelBold ? `**판매매출**` : `　${br}`} | ${fmtK(sMP)} | ${fmtK(sM)} | ${fmtYoy(sM, sMP)} | ${fmtK(sYP)} | ${fmtK(sY)} | ${ytdYoy != null ? Math.round(ytdYoy) + "%" : "-"} | ${sPlan != null ? fmtK(sPlan) : "-"} | ${planR != null ? Math.round(planR) + "%" : "-"} | ${usage != null ? usage.toFixed(1) + "%" : "-"} | ${sAnn != null ? fmtK(sAnn) : "-"} | ${verdict} |`);
  }

  // 총비용 (법인 + 브랜드 + 공통)
  for (const br of BRANDS_WITH_CORP) {
    const bd = brandData[br];
    const cM = bd.monthly.current.cost, cMP = bd.monthly.previous?.cost ?? 0;
    const cY = bd.ytd.current.cost, cYP = bd.ytd.previous?.cost ?? 0;
    const cPlan = bd.ytdPlan.total?.cost ?? null;
    const cAnn = bd.annualPlan.total?.cost ?? null;
    const planR = cPlan && cPlan > 0 ? (cY / cPlan) * 100 : null;
    const usage = cAnn && cAnn > 0 ? (cY / cAnn) * 100 : null;
    const ytdYoy = yoyNum(cY, cYP);
    const verdict = (() => {
      if (planR == null) return "-";
      if (planR > 110) return `🟡 — 계획비 ${Math.round(planR)}% 초과`;
      if (planR < 90) return `정상 — 계획비 ${Math.round(planR)}% 미달(절감)`;
      return "정상";
    })();
    const label = br === "법인" ? "**총비용**" : `　${br}`;
    lines.push(`| ${label} | ${fmtK(cMP)} | ${fmtK(cM)} | ${fmtYoy(cM, cMP)} | ${fmtK(cYP)} | ${fmtK(cY)} | ${ytdYoy != null ? Math.round(ytdYoy) + "%" : "-"} | ${cPlan != null ? fmtK(cPlan) : "-"} | ${planR != null ? Math.round(planR) + "%" : "-"} | ${usage != null ? usage.toFixed(1) + "%" : "-"} | ${cAnn != null ? fmtK(cAnn) : "-"} | ${verdict} |`);
  }

  // 비용률 (법인 + 브랜드)
  for (const br of ["법인", "MLB", "KIDS", "DISCOVERY"]) {
    const bd = brandData[br];
    const sM = bd.monthly.current.sales, sMP = bd.monthly.previous?.sales ?? 0;
    const sY = bd.ytd.current.sales, sYP = bd.ytd.previous?.sales ?? 0;
    const cM = bd.monthly.current.cost, cMP = bd.monthly.previous?.cost ?? 0;
    const cY = bd.ytd.current.cost, cYP = bd.ytd.previous?.cost ?? 0;
    const sAnn = bd.annualPlan.total?.sales ?? null;
    const cAnn = bd.annualPlan.total?.cost ?? null;
    const sPlan = bd.ytdPlan.total?.sales ?? null;
    const cPlan = bd.ytdPlan.total?.cost ?? null;
    const ratioM = calcCostRatio(cM, sM);
    const ratioMP = calcCostRatio(cMP, sMP);
    const ratioY = calcCostRatio(cY, sY);
    const ratioYP = calcCostRatio(cYP, sYP);
    const ratioPlan = calcCostRatio(cPlan ?? 0, sPlan ?? 0);
    const ratioAnn = calcCostRatio(cAnn ?? 0, sAnn ?? 0);
    const verdict = (() => {
      if (br === "DISCOVERY" && ratioY > 50) return `🔴 — 비용률 ${ratioY.toFixed(1)}%, 적자 구조`;
      return ratioY < ratioYP ? "정상 — YTD 비용률 개선" : ratioY > ratioYP + 0.5 ? "🟡 — YTD 비용률 악화" : "정상";
    })();
    const label = br === "법인" ? "**비용률(총비용/매출)**" : `　${br} 비용률`;
    lines.push(`| ${label} | ${ratioMP.toFixed(2)}% | ${ratioM.toFixed(2)}% | ${diffP(ratioM, ratioMP)} | ${ratioYP.toFixed(2)}% | ${ratioY.toFixed(2)}% | ${diffP(ratioY, ratioYP)} | ${ratioPlan.toFixed(2)}% | — | — | ${ratioAnn.toFixed(2)}% | ${verdict} |`);
  }

  return lines.join("\n");
}

// ────────────────────────────────────────────────
// DETAILED 2️⃣ B. 비용 항목별 YTD 상세
// ────────────────────────────────────────────────
function buildCategoryDetail() {
  const lines = [];
  lines.push("### B. 비용 항목별 YTD 상세 분석");
  lines.push("");
  lines.push("| 항목 | 당월(전년)K | 당월(당년)K | 당월YOY | YTD(전년)K | YTD(당년)K | YTDYOY | YTD계획K | 계획비% | 사용률% | 연간계획K | 최종판정 |");
  lines.push("|------|-----------|-----------|--------|-----------|-----------|--------|---------|--------|--------|---------|--------|");

  const ITEMS = ["인건비", "광고비", "복리후생비", "수주회", "지급수수료", "출장비", "IT수수료", "기타", "세금과공과", "임차료", "감가상각비", "차량렌트비"];
  const corp = brandData["법인"];
  for (const it of ITEMS) {
    const cM = corp.monthly.currCats[it] ?? 0;
    const cMP = corp.monthly.prevCats[it] ?? 0;
    const cY = corp.ytd.currCats[it] ?? 0;
    const cYP = corp.ytd.prevCats[it] ?? 0;
    const planY = corp.ytdPlan.cats[it] ?? null;
    const annY = corp.annualPlan.cats[it] ?? null;
    const planR = planY && planY > 0 ? (cY / planY) * 100 : null;
    const usage = annY && annY > 0 ? (cY / annY) * 100 : null;
    const ytdYoy = yoyNum(cY, cYP);
    const verdict = (() => {
      if (it === "수주회") {
        return `시즌 선집행 정상 패턴 — 사용률 ${usage != null ? usage.toFixed(1) + "%" : "-"}이나 상반기 집중 집행 구조`;
      }
      if (it === "세금과공과") {
        if (planR != null && planR > 130) return `🟡 — 계획비 ${Math.round(planR)}% 초과, 납부 시점 이연으로 하반기 집중납부 리스크`;
        if (ytdYoy != null && ytdYoy < 60) return `🟡 — YTD 감소(${Math.round(ytdYoy)}%), 시점차 가능`;
        return "정상";
      }
      if (planR != null && planR > 110) return `🟡 — 계획비 ${Math.round(planR)}% 초과`;
      if (usage != null && usage < (baseline / 2)) return `🟡 — 사용률 ${usage.toFixed(1)}%, 집행 지연`;
      if (ytdYoy != null && ytdYoy < 80) return `🟡 — YTD ${Math.round(ytdYoy)}% 급감`;
      if (ytdYoy != null && ytdYoy > 130) return `🟡 — YTD ${Math.round(ytdYoy)}% 급증`;
      return "정상";
    })();
    lines.push(`| **${it}** | ${fmtK(cMP)} | ${fmtK(cM)} | ${fmtYoy(cM, cMP)} | ${fmtK(cYP)} | ${fmtK(cY)} | ${ytdYoy != null ? Math.round(ytdYoy) + "%" : "-"} | ${planY != null ? fmtK(planY) : "-"} | ${planR != null ? Math.round(planR) + "%" : "-"} | ${usage != null ? usage.toFixed(1) + "%" : "-"} | ${annY != null ? fmtK(annY) : "-"} | ${verdict} |`);
  }
  return lines.join("\n");
}

// ────────────────────────────────────────────────
// DETAILED 2️⃣ C. 브랜드별 효율성 비교
// ────────────────────────────────────────────────
function buildBrandSummary() {
  const lines = [];
  lines.push("### C. 브랜드별 효율성 비교 요약");
  lines.push("");
  lines.push("| 브랜드 | YTD매출K | YTD매출YOY | YTD비용K | YTD비용YOY | 비용률 | 전년비용률 | 인원(기말/평균) | 인당매출K | 판정 |");
  lines.push("|------|---------|-----------|---------|-----------|------|---------|-------------|---------|------|");
  for (const br of BRANDS) {
    const bd = brandData[br].ytd;
    const sales = bd.current.sales, salesPrev = bd.previous?.sales ?? 0;
    const cost = bd.current.cost, costPrev = bd.previous?.cost ?? 0;
    const ratio = calcCostRatio(cost, sales);
    const ratioPrev = calcCostRatio(costPrev, salesPrev);
    const hc = bd.current.headcount, hcAvg = bd.current.headcountAvg;
    const perCapSales = bd.current.headcountSum > 0 ? sales / bd.current.headcountSum : null;
    const verdict = (() => {
      if (br === "공통") return "정상 — 지원부서 비용";
      if (br === "DISCOVERY" && ratio > 50) return `🔴 — 비용률 ${ratio.toFixed(1)}% 적자 구조, BEP 달성 로드맵 필요`;
      if (sales < salesPrev) return "🟡 — 매출 감소 모니터링";
      if (ratio < ratioPrev) return "정상 — 비용률 개선";
      return "정상";
    })();
    if (br === "공통") {
      lines.push(`| **공통** | — | — | ${fmtK(cost)} | ${fmtYoy(cost, costPrev)} | — | — | ${hc}명/${hcAvg}명 | — | ${verdict} |`);
    } else {
      lines.push(`| **${br}** | ${fmtK(sales)} | ${fmtYoy(sales, salesPrev)} | ${fmtK(cost)} | ${fmtYoy(cost, costPrev)} | ${ratio.toFixed(2)}% | ${ratioPrev.toFixed(2)}% | ${hc}명/${hcAvg}명 | ${perCapSales != null ? fmtK(perCapSales) : "-"} | ${verdict} |`);
    }
  }
  return lines.join("\n");
}

// ────────────────────────────────────────────────
// DETAILED 3️⃣ A~F. 운영 관리 기준 제안
// ────────────────────────────────────────────────
function buildOperationGuide() {
  const lines = [];
  lines.push("## 3️⃣ 연간 예산 운영 관리 기준 제안");
  lines.push("");

  const tax = brandData["법인"].ytd.currCats["세금과공과"] ?? 0;
  const taxAnn = brandData["법인"].annualPlan.cats["세금과공과"] ?? 0;
  const taxPlan = brandData["법인"].ytdPlan.cats["세금과공과"] ?? 0;
  const taxRatio = taxPlan > 0 ? Math.round((tax / taxPlan) * 100) : null;
  const taxUsage = taxAnn > 0 ? (tax / taxAnn) * 100 : null;
  const taxRemain = taxAnn - tax;

  // A. 브랜드별 광고비 집행 점검
  const mlbAd = brandData["MLB"].ytd.currCats["광고비"] ?? 0;
  const mlbAdPlan = brandData["MLB"].ytdPlan.cats["광고비"] ?? 0;
  const mlbAdAnn = brandData["MLB"].annualPlan.cats["광고비"] ?? 0;
  const mlbAdPlanR = mlbAdPlan > 0 ? Math.round((mlbAd / mlbAdPlan) * 100) : null;
  const mlbAdUsage = mlbAdAnn > 0 ? (mlbAd / mlbAdAnn) * 100 : null;
  lines.push("**A. 브랜드별 광고비 집행 점검**");
  lines.push(`- MLB YTD ${fmtK(mlbAd)}K (계획비 ${mlbAdPlanR != null ? mlbAdPlanR + "%" : "-"}, 사용률 ${mlbAdUsage != null ? mlbAdUsage.toFixed(1) + "%" : "-"}) — 연간계획 ${fmtK(mlbAdAnn)}K 대비 집행 속도 및 매출 기여도 모니터링. 분기별 ROI 검토 정례화 권고.`);
  lines.push("");

  // B. DISCOVERY BEP
  const dis = brandData["DISCOVERY"].ytd;
  const disRatio = calcCostRatio(dis.current.cost, dis.current.sales);
  const disAd = dis.currCats["광고비"] ?? 0;
  const disAdAnn = brandData["DISCOVERY"].annualPlan.cats["광고비"] ?? 0;
  const disAdUsage = disAdAnn > 0 ? (disAd / disAdAnn) * 100 : 0;
  const disAdRemain = disAdAnn - disAd;
  lines.push("**B. DISCOVERY 손익분기 달성 로드맵 수립**");
  lines.push(`- YTD 비용률 ${disRatio.toFixed(1)}% — 하반기 매출 급증 전제 조건 충족 여부 월별 트래킹. 광고비 사용률 ${disAdUsage.toFixed(1)}%로 잔여 집행 여력(${fmtK(disAdRemain)}K) 존재. 하반기 ROI 기준 집행 의사결정 체계 수립.`);
  lines.push("");

  // C. KIDS 매출/인건비
  const kids = brandData["KIDS"].ytd;
  const kidsSalesYoy = yoyNum(kids.current.sales, kids.previous?.sales ?? 0);
  const kidsLab = kids.currCats["인건비"] ?? 0;
  const kidsLabPrev = kids.prevCats["인건비"] ?? 0;
  const kidsLabYoy = yoyNum(kidsLab, kidsLabPrev);
  const kidsAd = kids.currCats["광고비"] ?? 0;
  const kidsAdAnn = brandData["KIDS"].annualPlan.cats["광고비"] ?? 0;
  const kidsAdUsage = kidsAdAnn > 0 ? (kidsAd / kidsAdAnn) * 100 : 0;
  const kidsAdRemain = kidsAdAnn - kidsAd;
  lines.push("**C. KIDS 매출 회복 및 인건비 구조 점검**");
  lines.push(`- 매출 YOY ${kidsSalesYoy != null ? Math.round(kidsSalesYoy) + "%" : "-"} ${kidsSalesYoy != null && kidsSalesYoy < 100 ? "하락" : "성장"} + 인건비 YOY ${kidsLabYoy != null ? Math.round(kidsLabYoy) + "%" : "-"} — 성과급/인원 변동이 인력 이탈로 이어질 리스크 점검. 하반기 매출 반등 전략(광고비 사용률 ${kidsAdUsage.toFixed(1)}%, 잔여 ${fmtK(kidsAdRemain)}K 집행 여력) 구체화.`);
  lines.push("");

  // D. 세금과공과
  lines.push("**D. 세금과공과 납부 스케줄 관리**");
  lines.push(`- YTD 계획비 ${taxRatio != null ? taxRatio + "%" : "-"}, 연간 계획 ${fmtK(taxAnn)}K 대비 YTD 실적 ${fmtK(tax)}K(사용률 ${taxUsage != null ? taxUsage.toFixed(1) + "%" : "-"}) — 납부 시점 이연 가능성 점검. 세무팀과 분기별 납부 스케줄 확인 후 월별 현금흐름 계획에 반영. 하반기 일시 집중 납부(최대 ~${fmtK(taxRemain)}K) 대비 유동성 확보 필요.`);
  lines.push("");

  // E. MLB 인건비
  const mlb = brandData["MLB"].ytd;
  const mlbLab = mlb.currCats["인건비"] ?? 0;
  const mlbLabPlan = brandData["MLB"].ytdPlan.cats["인건비"] ?? 0;
  const mlbLabAnn = brandData["MLB"].annualPlan.cats["인건비"] ?? 0;
  const mlbLabPlanR = mlbLabPlan > 0 ? Math.round((mlbLab / mlbLabPlan) * 100) : null;
  const mlbLabUsage = mlbLabAnn > 0 ? (mlbLab / mlbLabAnn) * 100 : 0;
  lines.push("**E. MLB 인건비 YTD 계획 모니터링**");
  lines.push(`- YTD 인건비 ${fmtK(mlbLab)}K (계획비 ${mlbLabPlanR != null ? mlbLabPlanR + "%" : "-"}, 사용률 ${mlbLabUsage.toFixed(1)}%) — 연간 계획 ${fmtK(mlbLabAnn)}K 대비 현재 집행 속도 유지 시 ${mlbLabPlanR != null && mlbLabPlanR > 105 ? "연간 초과 가능" : "정상 집행"}. 당월 변동 원인(Red pack 시점차 등) 확인 후 분기 인건비 집행 계획 재검토.`);
  lines.push("");

  // F. 출장비/지급수수료 사용률 낮은 항목
  const outlay = brandData["법인"].ytd.currCats["출장비"] ?? 0;
  const outlayAnn = brandData["법인"].annualPlan.cats["출장비"] ?? 0;
  const outlayUsage = outlayAnn > 0 ? (outlay / outlayAnn) * 100 : 0;
  lines.push("**F. 출장비 집행 지연 해소**");
  lines.push(`- YTD 사용률 ${outlayUsage.toFixed(1)}%(${fmtK(outlay)}K / ${fmtK(outlayAnn)}K) — 하반기 출장 집중 발생 방지를 위해 분기별 출장 계획 수립 및 선집행 유도. 특히 DISCOVERY 해외 수주·파트너십 출장 일정 반영 필요.`);

  return lines.join("\n");
}

// ────────────────────────────────────────────────
// DETAILED 통합
// ────────────────────────────────────────────────
function buildDetailed() {
  const parts = [];
  parts.push("## 1️⃣ 광고비 & 인건비 심층 분석");
  parts.push("");
  parts.push("### A. 인건비 분석");
  parts.push("");
  parts.push(buildLaborPerCapita());
  parts.push("");
  parts.push(buildLaborTotal());
  parts.push("");
  parts.push("---");
  parts.push("");
  parts.push(buildAdAnalysis());
  parts.push("");
  parts.push("---");
  parts.push("");
  parts.push(buildEfficiency());
  parts.push("");
  parts.push("---");
  parts.push("");
  parts.push(buildCategoryDetail());
  parts.push("");
  parts.push("---");
  parts.push("");
  parts.push(buildBrandSummary());
  parts.push("");
  parts.push("---");
  parts.push("");
  parts.push(buildOperationGuide());
  parts.push("");
  parts.push("─ End of Report ─");
  return sec("DETAILED", parts.join("\n"));
}

// ────────────────────────────────────────────────
// ② 브랜드별 비용 효율 종합 스코어 (A/B/C/D)
// ────────────────────────────────────────────────
function calcScore(brand) {
  const bd = brandData[brand];
  const y = bd.ytd; // ②~⑤ 분석은 항상 YTD 기준 (당월은 참고용)
  const sales = y.current.sales;
  const salesPrev = y.previous?.sales ?? 0;
  const cost = y.current.cost;
  const costPrev = y.previous?.cost ?? 0;
  const ratio = calcCostRatio(cost, sales);
  const ratioPrev = calcCostRatio(costPrev, salesPrev);
  const yoyDelta = ratio - ratioPrev; // %p
  const salesYoy = salesPrev > 0 ? (sales / salesPrev) * 100 : null;
  const costYoy = costPrev > 0 ? (cost / costPrev) * 100 : null;

  // 1) 추세 (35점) — YTD YoY 비용률 변화 (단, 매출 급증/급감 시 매출 효과 보정)
  let trendScore = 15;
  let trendNote = `YoY ${yoyDelta >= 0 ? "+" : ""}${yoyDelta.toFixed(2)}%p`;
  if (yoyDelta < -3) trendScore = 35;
  else if (yoyDelta < -1) trendScore = 28;
  else if (yoyDelta < 0) trendScore = 22;
  else if (yoyDelta < 1) trendScore = 15;
  else if (yoyDelta < 3) trendScore = 8;
  else trendScore = 0;

  // 매출 ±20% 초과 변동 시 추세 점수 신뢰도 보정
  if (salesYoy != null && (salesYoy > 130 || salesYoy < 80)) {
    // 매출 급변 → 비용률 변화가 매출 효과일 수 있음. 추세 점수 절반으로 cap
    const capped = Math.min(trendScore, 17);
    if (capped < trendScore) {
      trendScore = capped;
      trendNote = `${trendNote} (매출 YoY ${Math.round(salesYoy)}% — 매출 효과 가능, 비용 YoY ${costYoy != null ? Math.round(costYoy) + "%" : "-"})`;
    }
  }

  // 절대 비용률이 매우 높으면 추세 점수에 상한 (적자 구조)
  if (ratio > 50) {
    trendScore = Math.min(trendScore, 8);
    trendNote = `${trendNote} | 비용률 ${ratio.toFixed(1)}% 적자 구조 — 매출 확대 우선`;
  } else if (ratio > 30) {
    trendScore = Math.min(trendScore, 15);
  }

  // 2) 수준 (30점) — 절대 비용률 + MLB 대비 (둘 결합)
  let levelScore = 30;
  let levelNote = "MLB 기준 브랜드";
  if (brand === "공통") {
    levelScore = 22;
    levelNote = "지원조직 (참고값)";
  } else if (brand !== "MLB") {
    const mlbRatio = calcCostRatio(brandData["MLB"].ytd.current.cost, brandData["MLB"].ytd.current.sales);
    const diff = ratio - mlbRatio;
    // 절대 비용률 패널티 우선
    if (ratio > 50) {
      levelScore = 0;
      levelNote = `비용률 ${ratio.toFixed(1)}% (적자 구조)`;
    } else if (ratio > 30) {
      levelScore = 5;
      levelNote = `비용률 ${ratio.toFixed(1)}% (높음)`;
    } else if (diff <= -1) { levelScore = 30; levelNote = `MLB 대비 ${diff.toFixed(1)}%p (낮음)`; }
    else if (diff <= 1) { levelScore = 25; levelNote = `MLB 대비 ${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%p`; }
    else if (diff <= 3) { levelScore = 15; levelNote = `MLB 대비 +${diff.toFixed(1)}%p`; }
    else { levelScore = 5; levelNote = `MLB 대비 +${diff.toFixed(1)}%p (높음)`; }
  }

  // 3) 광고비율 (20점) — 광고비/매출
  const adAmt = y.currCats["광고비"] ?? 0;
  const adRatio = calcCostRatio(adAmt, sales);
  const adPrev = y.prevCats["광고비"] ?? 0;
  const adRatioPrev = calcCostRatio(adPrev, salesPrev);
  let adScore = 10;
  let adNote = `${adRatio.toFixed(1)}% (전년 ${adRatioPrev.toFixed(1)}%)`;
  if (brand === "공통") { adScore = 15; adNote = "지원조직"; }
  else if (adRatio < 2) adScore = 20;
  else if (adRatio < 3) adScore = 15;
  else if (adRatio < 5) adScore = 10;
  else if (adRatio < 8) adScore = 5;
  else adScore = 0;

  // 4) 계획 집행 효율 (15점) — YTD 계획비 정상 범위
  const plan = bd.ytdPlan.total?.cost ?? 0;
  const planRatio = plan > 0 ? (cost / plan) * 100 : null;
  let planScore = 0;
  let planNote = "계획 데이터 없음";
  if (planRatio != null) {
    if (planRatio >= 90 && planRatio <= 110) { planScore = 15; planNote = `계획비 ${Math.round(planRatio)}% (정상)`; }
    else if ((planRatio >= 80 && planRatio < 90) || (planRatio > 110 && planRatio <= 120)) { planScore = 10; planNote = `계획비 ${Math.round(planRatio)}% (경계)`; }
    else { planScore = 3; planNote = `계획비 ${Math.round(planRatio)}% (이탈)`; }
  }

  const total = trendScore + levelScore + adScore + planScore;
  let grade;
  if (total >= 75) grade = "A";
  else if (total >= 55) grade = "B";
  else if (total >= 35) grade = "C";
  else grade = "D";

  return {
    brand, ratio, yoyDelta, total, grade,
    trend: { score: trendScore, note: trendNote },
    level: { score: levelScore, note: levelNote },
    ad: { score: adScore, note: adNote, ratio: adRatio, yoy: adRatio - adRatioPrev },
    plan: { score: planScore, note: planNote, planRatio },
  };
}

function buildScoreCards() {
  const lines = [];
  // 라인 포맷: brand|grade|total|ratio|yoyDelta|trendScore|trendNote|levelScore|levelNote|adScore|adNote|planScore|planNote
  for (const br of BRANDS_WITH_CORP) {
    const s = calcScore(br);
    lines.push([
      br === "법인" ? "법인전체" : br,
      s.grade, s.total, s.ratio.toFixed(2), `${s.yoyDelta >= 0 ? "+" : ""}${s.yoyDelta.toFixed(2)}%p`,
      s.trend.score, s.trend.note,
      s.level.score, s.level.note,
      s.ad.score, s.ad.note,
      s.plan.score, s.plan.note,
    ].join("|"));
  }
  return sec("SCORE_CARDS", lines.join("\n"));
}

// ────────────────────────────────────────────────
// ③ 브랜드별 체크포인트 — 액션 카드
// ────────────────────────────────────────────────
function buildCheckpoints() {
  const lines = [];
  for (const br of BRANDS_WITH_CORP) {
    const bd = brandData[br];
    const sales = bd.ytd.current.sales;
    const salesPrev = bd.ytd.previous?.sales ?? 0;
    const useAmountBased = sales <= 0; // 공통: 금액 YoY 기준
    // 매출 급증 + 비용률 절대 높은 브랜드 (DISCOVERY 등): 비율 감소는 매출 효과
    const salesYoy = salesPrev > 0 ? (sales / salesPrev) * 100 : null;
    const totalRatio = sales > 0 ? calcCostRatio(bd.ytd.current.cost, sales) : 0;
    const isSalesEffect = salesYoy != null && salesYoy > 130 && totalRatio > 30;
    const s = calcScore(br);
    lines.push(`BRAND_HEADER|${br === "법인" ? "법인전체" : br}|${s.grade}`);

    const items = [];
    const cats = Object.keys(bd.ytd.currCats);
    for (const cat of cats) {
      const cur = bd.ytd.currCats[cat] ?? 0;
      const prv = bd.ytd.prevCats[cat] ?? 0;
      const isSeasonal = SEASONAL_ITEMS.has(cat);
      if (isSeasonal) continue;

      let severity, note, change, deltaStr, sortKey;
      if (useAmountBased) {
        // 공통: 금액 YoY 기준
        const yoy = yoyNum(cur, prv);
        if (yoy == null) continue;
        const yoyPct = yoy - 100;
        if (Math.abs(yoyPct) < 3) continue; // ±3% 미만 미미한 변동 제외
        if (cat === "인건비" && isRedPackTimingDiff(bd) && yoyPct < 0) continue;

        if (yoyPct >= 30) { severity = "🔴 즉시"; note = "큰 증가 — 원인 규명 및 절감 계획 수립 필요"; }
        else if (yoyPct >= 10) { severity = "🟡 모니터링"; note = "증가 추세 — 지속 여부 모니터링"; }
        else if (yoyPct >= 3) { severity = "📊 추적"; note = "소폭 증가, 추세 안정성 점검"; }
        else if (yoyPct <= -20) { severity = "✅ 개선"; note = "큰 절감 — 지속 유지 확인 권고"; }
        else if (yoyPct <= -5) { severity = "🔵 절감"; note = "소폭 절감, 일회성 여부 점검"; }
        else continue;

        change = `${fmtK(prv)}K → ${fmtK(cur)}K`;
        deltaStr = `${yoyPct >= 0 ? "+" : ""}${Math.round(yoyPct)}%`;
        sortKey = Math.abs(yoyPct);
        items.push({ cat, severity, change, delta: deltaStr, amount: cur, note, sortKey });
      } else {
        // 일반: 비용률 변화 기준
        const r = calcCostRatio(cur, sales);
        const rp = calcCostRatio(prv, salesPrev);
        const delta = r - rp;
        const isLaborTiming = cat === "인건비" && isRedPackTimingDiff(bd) && delta < 0;
        if (isLaborTiming) continue;
        if (Math.abs(delta) < 0.05) continue;

        // 비즈니스 오버라이드 (인력재배치 등) 우선 적용
        const ov = findOverride(br, cat);
        if (ov) { severity = ov.label; note = ov.note; }
        else if (delta >= 3) { severity = "🔴 즉시"; note = "급증 원인 규명 및 절감 계획 수립 필요"; }
        else if (delta >= 1) { severity = "🟡 모니터링"; note = "추세 지속 여부 모니터링 필요"; }
        else if (delta >= 0.3) { severity = "📊 추적"; note = "소폭 상승, 추세 안정성 점검"; }
        else if (delta <= -1) {
          // 매출 급증 브랜드의 비율 감소는 실효적 효율화 아님
          if (isSalesEffect) { severity = "💧 매출효과"; note = `매출 급증(YoY ${salesYoy ? Math.round(salesYoy) + "%" : "-"})에 의한 비율 감소 — 실효적 절감 아님, 절대 금액 추적 필요`; }
          else { severity = "✅ 개선"; note = "효율화 달성 — 지속 유지 확인 권고"; }
        }
        else if (delta <= -0.3) {
          if (isSalesEffect) { severity = "💧 매출효과"; note = "매출 증가에 따른 비율 감소"; }
          else { severity = "🔵 절감"; note = "소폭 절감, 일회성 여부 점검"; }
        }
        else { severity = "▸ 안정"; note = "전년 대비 안정적 유지"; }

        change = `${rp.toFixed(2)}%→${r.toFixed(2)}%`;
        deltaStr = `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%p`;
        sortKey = Math.abs(delta);
        items.push({ cat, severity, change, delta: deltaStr, amount: cur, note, sortKey });
      }
    }
    items.sort((a, b) => b.sortKey - a.sortKey);
    const visible = items.slice(0, 4);

    // Fallback: 의미 있는 변동 없으면 "양호" 현황 카드 표시
    if (visible.length === 0) {
      if (useAmountBased) {
        // 공통: 금액 YoY 기반 현황
        const costYoy = yoyNum(bd.ytd.current.cost, bd.ytd.previous?.cost ?? 0);
        const yoyStr = costYoy != null ? `${costYoy >= 100 ? "+" : ""}${Math.round(costYoy - 100)}%` : "-";
        visible.push({
          cat: "비용 현황",
          severity: "▸ 양호",
          change: `${fmtK(bd.ytd.previous?.cost ?? 0)}K → ${fmtK(bd.ytd.current.cost)}K`,
          delta: yoyStr,
          amount: bd.ytd.current.cost,
          note: "전년 대비 카테고리 단위 큰 변동 없음 — 현 추세 양호, 분기별 모니터링 권고",
        });
      } else {
        // 일반 브랜드: 비용률 현황
        const ratio = calcCostRatio(bd.ytd.current.cost, sales);
        const ratioPrev = calcCostRatio(bd.ytd.previous?.cost ?? 0, salesPrev);
        const overallDelta = ratio - ratioPrev;
        visible.push({
          cat: "비용률 현황",
          severity: "▸ 양호",
          change: `${ratioPrev.toFixed(2)}%→${ratio.toFixed(2)}%`,
          delta: `${overallDelta >= 0 ? "+" : ""}${overallDelta.toFixed(2)}%p`,
          amount: bd.ytd.current.cost,
          note: "카테고리 단위 의미 있는 변동 없음 — 비용 구조 안정적, 현 추세 유지 권고",
        });
      }
    }

    for (const it of visible) {
      lines.push([
        "ITEM", br === "법인" ? "법인전체" : br, it.severity, it.cat,
        it.change,
        it.delta,
        `${fmtK(it.amount)}K`, it.note,
      ].join("|"));
    }

    // 인건비 추이 추가 (Red pack 시점차로 위에서 제외된 경우 별도 정보로 표시)
    if (isRedPackTimingDiff(bd)) {
      const lab = bd.ytd.currCats["인건비"] ?? 0;
      const labPrev = bd.ytd.prevCats["인건비"] ?? 0;
      const hc = bd.ytd.current.headcountSum;
      const hcPrev = bd.ytd.previous?.headcountSum ?? 0;
      const perCap = hc > 0 ? lab / hc : 0;
      const perCapPrev = hcPrev > 0 ? labPrev / hcPrev : 0;
      const perCapYoy = perCapPrev > 0 ? (perCap / perCapPrev - 1) * 100 : null;
      const perCapStr = perCapYoy != null ? `${perCapYoy >= 0 ? "+" : ""}${perCapYoy.toFixed(1)}%` : "-";
      lines.push([
        "ITEM", br === "법인" ? "법인전체" : br, "ℹ️ 시점차", "인건비 (Red pack)",
        `인당 ${perCapPrev.toFixed(1)}K → ${perCap.toFixed(1)}K`,
        perCapStr,
        `${fmtK(lab)}K`,
        "Red pack 미지급 시점차 영향 — YTD 누적 정상화 시 재평가",
      ].join("|"));
    }

    // MLB 대비 구조 차이 (브랜드만)
    if (br !== "법인" && br !== "공통" && br !== "MLB") {
      const mlbRatio = calcCostRatio(brandData["MLB"].ytd.current.cost, brandData["MLB"].ytd.current.sales);
      const brRatio = calcCostRatio(bd.ytd.current.cost, sales);
      const structDiff = brRatio - mlbRatio;
      if (Math.abs(structDiff) >= 1) {
        lines.push([
          "ITEM", br, "📌 구조", "MLB 대비 총비용률",
          `MLB ${mlbRatio.toFixed(1)}% vs ${br} ${brRatio.toFixed(1)}%`,
          `${structDiff >= 0 ? "+" : ""}${structDiff.toFixed(1)}%p`,
          "—",
          structDiff > 0 ? "구조적 비효율 가능성 점검 — 채널/단가/계약 차이 분석" : "MLB 대비 비용 효율 우수",
        ].join("|"));
      }
    }

    // 계획비 이상 항목 (계획비 > 110% 또는 < 80%, 위에서 안 잡힌 경우)
    const planCats = bd.ytdPlan?.cats ?? {};
    for (const cat of Object.keys(planCats)) {
      if (SEASONAL_ITEMS.has(cat)) continue;
      const cur = bd.ytd.currCats[cat] ?? 0;
      const plan = planCats[cat] ?? 0;
      if (plan <= 0) continue;
      const planR = (cur / plan) * 100;
      if (planR > 110) {
        // 이미 visible items에 있으면 skip
        if (visible.some((v) => v.cat === cat)) continue;
        lines.push([
          "ITEM", br === "법인" ? "법인전체" : br, "🟡 계획비",
          `${cat} 계획비 ${Math.round(planR)}%`,
          `실적 ${fmtK(cur)}K / 계획 ${fmtK(plan)}K`,
          `+${Math.round(planR - 100)}%p`,
          `${fmtK(cur)}K`,
          "계획 초과 — 원인 점검 및 잔여 분기 집행 조정",
        ].join("|"));
        break; // 최대 1개만
      }
    }
  }
  return sec("CHECKPOINTS", lines.join("\n"));
}

// ────────────────────────────────────────────────
// ⑦ 고정/변동/준고정 비용 구조 분석 (브랜드별)
// ────────────────────────────────────────────────
function buildFixedVarAnalysis() {
  const lines = [];
  lines.push("BY_BRAND_HEADER");
  for (const br of BRANDS_WITH_CORP) {
    const bd = brandData[br];
    const cats = bd.ytd.currCats;
    const prevCats = bd.ytd.prevCats;
    const totals = { 고정비: 0, 준고정비: 0, 변동비: 0 };
    const prevTotals = { 고정비: 0, 준고정비: 0, 변동비: 0 };
    for (const lv1 of Object.keys(cats)) {
      const cls = classifyCost(lv1);
      if (cls in totals) {
        totals[cls] += cats[lv1] ?? 0;
        prevTotals[cls] += prevCats[lv1] ?? 0;
      }
    }
    const total = totals.고정비 + totals.준고정비 + totals.변동비;
    const prevTotal = prevTotals.고정비 + prevTotals.준고정비 + prevTotals.변동비;

    // 분석 + 액션 자동 생성
    const fixedShare = total > 0 ? (totals.고정비 / total) * 100 : 0;
    const varShare = total > 0 ? (totals.변동비 / total) * 100 : 0;
    const semiShare = total > 0 ? (totals.준고정비 / total) * 100 : 0;
    const prevFixedShare = prevTotal > 0 ? (prevTotals.고정비 / prevTotal) * 100 : 0;
    const prevVarShare = prevTotal > 0 ? (prevTotals.변동비 / prevTotal) * 100 : 0;
    const fixedShareDelta = fixedShare - prevFixedShare;
    const varShareDelta = varShare - prevVarShare;

    // 구조 특성
    let characteristics;
    if (fixedShare > 50) characteristics = `고정비 비중 ${fixedShare.toFixed(1)}%로 매우 높음 — 매출 변동에 취약한 구조`;
    else if (varShare > 60) characteristics = `변동비 비중 ${varShare.toFixed(1)}% 중심 — 광고비·수수료 영향 큼, 매출 연동성 강함`;
    else if (fixedShare > 35 && varShare > 40) characteristics = `고정비 ${fixedShare.toFixed(1)}% + 변동비 ${varShare.toFixed(1)}% 균형 구조`;
    else if (varShare > 50) characteristics = `변동비 우위 (${varShare.toFixed(1)}%) — 매출 연동성 강함`;
    else if (fixedShare > 40) characteristics = `고정비 우위 (${fixedShare.toFixed(1)}%) — 매출 안정성 확보 필요`;
    else characteristics = `고정 ${fixedShare.toFixed(1)}% / 준고정 ${semiShare.toFixed(1)}% / 변동 ${varShare.toFixed(1)}%`;

    // 변동 추이 (가장 크게 변화한 분류)
    const yoyByCls = {
      고정비: yoyNum(totals.고정비, prevTotals.고정비),
      준고정비: yoyNum(totals.준고정비, prevTotals.준고정비),
      변동비: yoyNum(totals.변동비, prevTotals.변동비),
    };
    let trend;
    const bigChanges = Object.entries(yoyByCls).filter(([, v]) => v != null && (v > 115 || v < 85));
    if (bigChanges.length > 0) {
      const parts = bigChanges.map(([cls, v]) => `${cls} YoY ${Math.round(v)}%`).join(", ");
      trend = `주요 변화: ${parts}`;
    } else {
      trend = "전년 대비 큰 분류 단위 변동 없음";
    }

    // 액션
    let action;
    if (varShare > 60 && yoyByCls.변동비 != null && yoyByCls.변동비 > 115) {
      action = "변동비 급증 — 광고비 채널 효율·판매수수료 단가 우선 점검";
    } else if (fixedShare > 45 && yoyByCls.고정비 != null && yoyByCls.고정비 > 110) {
      action = "고정비 증가 부담 — 인건비·임차료 구조 재검토";
    } else if (Math.abs(varShareDelta) > 5) {
      action = `변동비 비중 ${varShareDelta >= 0 ? "+" : ""}${varShareDelta.toFixed(1)}%p 변화 — 구성비 변화 원인 분해 분석`;
    } else if (Math.abs(fixedShareDelta) > 5) {
      action = `고정비 비중 ${fixedShareDelta >= 0 ? "+" : ""}${fixedShareDelta.toFixed(1)}%p 변화 — 인력·임차 구조 변화 확인`;
    } else if (varShare > 60) {
      action = "변동비 중심 구조 — 광고 ROI 분기별 모니터링 권고";
    } else if (fixedShare > 45) {
      action = "고정비 부담 — 매출 안정 확보 또는 인력 효율화 추진";
    } else {
      action = "현 구조 안정적 — 분기별 모니터링 유지";
    }

    for (const cls of ["고정비", "준고정비", "변동비"]) {
      const cur = totals[cls];
      const prv = prevTotals[cls];
      const share = total > 0 ? (cur / total) * 100 : 0;
      const yoy = yoyNum(cur, prv);
      // 분석/액션은 첫 행(고정비)에만 포함, 나머지는 빈 값
      const isFirst = cls === "고정비";
      lines.push([
        br === "법인" ? "법인전체" : br,
        cls,
        `${fmtK(cur)}K`,
        `${fmtK(prv)}K`,
        yoy != null ? `${Math.round(yoy)}%` : "-",
        `${share.toFixed(1)}%`,
        isFirst ? characteristics : "",
        isFirst ? trend : "",
        isFirst ? action : "",
      ].join("|"));
    }
  }
  return sec("FIXED_VAR", lines.join("\n"));
}

// ────────────────────────────────────────────────
// 상단 3카드 — TOP_SUMMARY (전체총평 / 주목 브랜드 / 변동 TOP 3)
// ────────────────────────────────────────────────
function buildTopSummary() {
  const lines = [];
  const corp = brandData["법인"].ytd;
  const corpSales = corp.current.sales;
  const corpSalesPrev = corp.previous?.sales ?? 0;
  const corpCost = corp.current.cost;
  const corpCostPrev = corp.previous?.cost ?? 0;
  const corpRatio = calcCostRatio(corpCost, corpSales);
  const corpRatioPrev = calcCostRatio(corpCostPrev, corpSalesPrev);
  const overallDelta = corpRatio - corpRatioPrev;

  // 분류별 영향도 — 어느 분류가 변화 주도?
  const cats = corp.currCats;
  const prevCats = corp.prevCats;
  const classImpact = { 고정비: 0, 준고정비: 0, 변동비: 0 };
  for (const lv1 of Object.keys(cats)) {
    const cls = classifyCost(lv1);
    if (!(cls in classImpact)) continue;
    const r = calcCostRatio(cats[lv1] ?? 0, corpSales);
    const rp = calcCostRatio(prevCats[lv1] ?? 0, corpSalesPrev);
    classImpact[cls] += (r - rp);
  }
  const sortedImpact = Object.entries(classImpact).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const mainDriverCls = sortedImpact[0][0];
  const mainDriverDelta = sortedImpact[0][1];

  // 브랜드별 비용률 YoY (worst / best)
  // 다음 케이스는 best 후보에서 제외:
  //   - 매출 급증(YoY >130%) + 비용률 절대값 30%↑ (매출 효과)
  //   - BUSINESS_OVERRIDES의 excludeFromBest 케이스 (인력재배치 등)
  const brandDeltas = [];
  for (const br of BRANDS) {
    const bd = brandData[br].ytd;
    const s = bd.current.sales, sp = bd.previous?.sales ?? 0;
    const c = bd.current.cost, cp = bd.previous?.cost ?? 0;
    if (s <= 0) continue;
    const r = calcCostRatio(c, s);
    const rp = calcCostRatio(cp, sp);
    const salesYoy = sp > 0 ? (s / sp) * 100 : null;
    const isSalesEffect = salesYoy != null && salesYoy > 130 && r > 30;
    // 인력재배치 등 비즈니스 오버라이드: 해당 브랜드의 인건비가 excludeFromBest이면 부정확
    const hasBestExcludingOverride = BUSINESS_OVERRIDES.some(
      (o) => o.year === year && o.brand === br && o.excludeFromBest
    );
    brandDeltas.push({ brand: br, delta: r - rp, ratio: r, prev: rp, isSalesEffect, hasBestExcludingOverride });
  }
  brandDeltas.sort((a, b) => b.delta - a.delta);
  const worst = brandDeltas[0];
  // best는 매출 효과 / 인력재배치 브랜드 제외하고 선정
  const bestCandidates = brandDeltas.filter((b) => !b.isSalesEffect && !b.hasBestExcludingOverride);
  const best = bestCandidates.length > 0 ? bestCandidates[bestCandidates.length - 1] : null;

  // 변동 TOP 3 (브랜드×카테고리, 시점차 제외)
  // 우선순위: 일반 변동(라벨없음) > 매출효과 > 인력재배치 등 오버라이드
  // 일반 변동만으로 3개가 안 차면 라벨링한 항목으로 자동 fallback
  const variations = [];
  for (const br of BRANDS_WITH_CORP) {
    const bd = brandData[br].ytd;
    const sales = bd.current.sales;
    const salesPrev = bd.previous?.sales ?? 0;
    const salesYoy = salesPrev > 0 ? (sales / salesPrev) * 100 : null;
    const isSalesEffect = salesYoy != null && salesYoy > 130;
    for (const lv1 of Object.keys(bd.currCats)) {
      if (SEASONAL_ITEMS.has(lv1)) continue;
      if (lv1 === "인건비" && isRedPackTimingDiff(brandData[br])) continue;
      const r = calcCostRatio(bd.currCats[lv1] ?? 0, sales);
      const rp = calcCostRatio(bd.prevCats[lv1] ?? 0, salesPrev);
      const delta = r - rp;
      const amount = bd.currCats[lv1] ?? 0;
      if (Math.abs(delta) < 0.1) continue; // 매우 작은 변동만 제외 (0.3 → 0.1)
      const ov = findOverride(br, lv1);
      const isSalesEff = isSalesEffect && delta < 0;
      let label = "";
      let priority = 0; // 0 = 일반 (최우선), 1 = 매출효과, 2 = 오버라이드
      if (ov?.excludeFromTop3) { label = ov.label; priority = 2; }
      else if (isSalesEff) { label = "💧 매출효과"; priority = 1; }
      variations.push({
        brand: br === "법인" ? "법인전체" : br,
        category: lv1,
        delta,
        amount,
        label,
        priority,
      });
    }
  }
  // 정렬: priority 낮은 것 우선(일반 변동 먼저), 동일 priority 내에선 |delta| 큰 순
  variations.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return Math.abs(b.delta) - Math.abs(a.delta);
  });
  const top3 = variations.slice(0, 3);

  // 출력 포맷
  // OVERALL|overallDeltaStr|verdict|mainDriverCls|mainDriverDeltaStr|worstBrand|worstDeltaStr
  lines.push([
    "OVERALL",
    `${overallDelta >= 0 ? "+" : ""}${overallDelta.toFixed(2)}%p`,
    overallDelta > 0.5 ? "전반적 악화" : overallDelta < -0.5 ? "전반적 개선" : "전년 동등",
    mainDriverCls,
    `${mainDriverDelta >= 0 ? "+" : ""}${mainDriverDelta.toFixed(2)}%p`,
    worst.brand,
    `${worst.delta >= 0 ? "+" : ""}${worst.delta.toFixed(2)}%p`,
  ].join("|"));

  // NOTABLE worst/best
  if (worst) {
    lines.push([
      "NOTABLE_WORST",
      worst.brand,
      `${worst.ratio.toFixed(1)}%`,
      `${worst.prev.toFixed(1)}%`,
      `${worst.delta >= 0 ? "+" : ""}${worst.delta.toFixed(2)}%p`,
    ].join("|"));
  }
  if (best && best.brand !== worst?.brand) {
    lines.push([
      "NOTABLE_BEST",
      best.brand,
      `${best.ratio.toFixed(1)}%`,
      `${best.prev.toFixed(1)}%`,
      `${best.delta >= 0 ? "+" : ""}${best.delta.toFixed(2)}%p`,
    ].join("|"));
  }

  // TOP3 변동 원인 (라벨 있는 경우 카테고리 앞에 prefix)
  for (let i = 0; i < top3.length; i++) {
    const v = top3[i];
    const catWithLabel = v.label ? `${v.label} ${v.category}` : v.category;
    lines.push([
      `TOP${i + 1}`,
      v.brand,
      catWithLabel,
      `${v.delta >= 0 ? "+" : ""}${v.delta.toFixed(2)}%p`,
      `${fmtK(v.amount)}K`,
    ].join("|"));
  }

  return sec("TOP_SUMMARY", lines.join("\n"));
}

// ────────────────────────────────────────────────
// ④ 브랜드별 한눈에 보기 (BRAND_OVERVIEW)
// ────────────────────────────────────────────────
function buildBrandOverview() {
  const lines = [];
  // 포맷: brand|sales|ratio|prevRatio|delta|labRatio|adRatio|maxChangeItem|signal
  for (const br of BRANDS_WITH_CORP) {
    const bd = brandData[br].ytd;
    const s = bd.current.sales;
    const sp = bd.previous?.sales ?? 0;
    const c = bd.current.cost;
    const cp = bd.previous?.cost ?? 0;
    const ratio = calcCostRatio(c, s);
    const ratioPrev = calcCostRatio(cp, sp);
    const delta = ratio - ratioPrev;
    const labRatio = calcCostRatio(bd.currCats["인건비"] ?? 0, s);
    const adRatio = calcCostRatio(bd.currCats["광고비"] ?? 0, s);

    // 최대 변동 항목 (시점차 + 비즈니스 오버라이드 제외)
    let maxItem = null;
    let maxAbs = 0;
    for (const lv1 of Object.keys(bd.currCats)) {
      if (SEASONAL_ITEMS.has(lv1)) continue;
      if (lv1 === "인건비" && isRedPackTimingDiff(brandData[br])) continue;
      // 비즈니스 오버라이드 항목: 최대 변동 표시 시 라벨 함께 표기
      const ovItem = findOverride(br, lv1);
      const r = calcCostRatio(bd.currCats[lv1] ?? 0, s);
      const rp = calcCostRatio(bd.prevCats[lv1] ?? 0, sp);
      const d = r - rp;
      if (Math.abs(d) > maxAbs) {
        maxAbs = Math.abs(d);
        const labelPrefix = ovItem ? `${ovItem.label} ` : "";
        maxItem = `${labelPrefix}${lv1} ${d >= 0 ? "+" : ""}${d.toFixed(2)}%p`;
      }
    }

    // 신호: delta 기반
    const signal = delta > 2 ? "🔴" : delta > 0.5 ? "🟡" : "🟢";

    lines.push([
      br === "법인" ? "법인전체" : br,
      `${fmtK(s)}K`,
      `${ratio.toFixed(2)}%`,
      `${ratioPrev.toFixed(2)}%`,
      `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%p`,
      // 공통: 인건비는 있으니 표시, 광고비는 없으므로 "—"
      `${labRatio.toFixed(2)}%`,
      br === "공통" ? "—" : `${adRatio.toFixed(2)}%`,
      maxItem ?? "—",
      signal,
    ].join("|"));
  }
  return sec("BRAND_OVERVIEW", lines.join("\n"));
}

// lv2 항목별 특화 액션 매핑 (실제 데이터에 존재하는 lv2 이름만 사용)
const UP_ACTION_BY_LV2 = {
  // 지급수수료 lv2
  "지급수수료|인테리어 개발": "신규/리뉴얼 매장 인테리어 비용 — 오픈 계획 및 시공 단가 검증",
  "지급수수료|법무": "법무 자문 사례 검토, 사내 처리 가능 여부 평가",
  "지급수수료|재무": "재무 자문 항목·필요성 재평가",
  "지급수수료|Supply Chain": "SCM 비용 항목 점검, 단가 재협상 가능성",
  "지급수수료|재고실사 서비스비용": "재고실사 빈도·서비스 단가 검토",
  "지급수수료|매장 DP점검 외주용역": "매장 DP 점검 빈도·범위 재평가",
  "지급수수료|보험비": "보험 항목별 한도·면책 조건 재검토",
  "지급수수료|인사": "인사 서비스 범위·필요성 점검",
  "지급수수료|Office Service": "사무 서비스 항목별 검토",
  "지급수수료|리테일 교육 소프트웨어": "교육 SaaS 사용률·라이센스 수 재검토",
  "지급수수료|골프 회원 연회비": "회원권 활용도·필요성 재검토",
  // 인건비 lv2
  "인건비|기본급": "직급 구성·단가 인상 영향 점검, 인당 기본급 추이 추적",
  "인건비|성과급충당금": "성과 기대치 변화 시그널, 충당 정책 재확인",
  "인건비|잡급": "임시·일용직 활용 추이 확인",
  // 광고비 lv2 (MLB 채널)
  "광고비|APP": "APP 퍼포먼스 ROI 검토, 채널 단가 추이",
  "광고비|ACC": "ACC 채널 ROI·매출 기여도 분석",
  "광고비|Branding": "브랜딩 캠페인 효과·도달 효율 평가",
  "광고비|Retailing": "리테일 광고 매장 매출 기여도 추적",
  "광고비|Products": "제품 광고 SKU별 효율 점검",
  "광고비|Product": "제품 광고 SKU별 효율 점검",
  "광고비|CRM": "CRM 데이터·세그멘트 활용도 점검",
  "광고비|Campaign": "캠페인 ROI 측정 강화",
  "광고비|CAMPAIGN": "캠페인 ROI 측정 강화",
  // 임차료 lv2 (실재: 관리비, 사무실임차료)
  "임차료|사무실임차료": "사무실 면적 효율·위치 재검토",
  "임차료|관리비": "관리비 청구 내역·항목 재점검",
  // 복리후생비 lv2
  "복리후생비|식대": "급식 단가·인원 변동 영향 확인",
  "복리후생비|건강검진": "검진 정책·빈도 재검토",
  "복리후생비|5대보험": "5대보험 부담률·인원 변동 영향 확인",
  "복리후생비|송년회": "송년회 규모·필요성 검토",
  "복리후생비|장기근속": "장기근속 포상 정책 점검",
  // 출장비 lv2 (실재: 국내출장비, 해외출장비)
  "출장비|국내출장비": "국내 출장 빈도·교통수단 효율 점검",
  "출장비|해외출장비": "해외 출장 사유·횟수 점검, 화상회의 대체 가능성",
  // IT수수료 lv2 (실재 항목명)
  "IT수수료|시스템 유지보수비용": "유지보수 계약 범위·단가 재검토",
  "IT수수료|Snowflake": "Snowflake 사용량·계약 재협상 가능성",
  "IT수수료|CN SAP": "SAP 유지·라이센스 재검토",
  "IT수수료|Data Server": "데이터 서버 사용량·아키텍처 최적화",
  "IT수수료|온라인플랫폼 서비스 비용": "플랫폼 사용료·필요성 재평가",
  "IT수수료|온라인 스토어 오픈비용": "신규 스토어 오픈 일회성 여부 확인",
  // 차량렌트비 lv2
  "차량렌트비|ALPHA": "ALPHA 차량 사용 효율, 대체 옵션 검토",
  "차량렌트비|KIA": "KIA 차량 사용 효율 점검",
  "차량렌트비|차량유지비": "차량 유지비 항목·빈도 재검토",
  // 세금과공과 (시점차 처리이지만 lv2 매핑)
  "세금과공과|증치세 부가 지방세": "납부 시점 이연 가능성, 하반기 집중 납부 대비",
  "세금과공과|인지세": "인지세 발생 사유 점검",
  // 기타 lv2
  "기타|교육비": "교육 프로그램 효과·참여율 점검",
  "기타|물류비": "물류 단가·물량 변동 확인",
  "기타|사무용품비": "구매 빈도·표준 단가 점검",
  "기타|여비교통비": "교통비 정산 기준 재검토",
  "기타|접대비": "접대비 정책·한도 점검",
  "기타|통신비": "통신 요금제·회선 수 재검토",
};

// 카테고리 단위 폴백 액션 (lv2 매칭 안 될 때) — 데이터에 실재하는 표현만 사용
const UP_ACTION_BY_CAT = {
  "인건비": "인력 구성·기본급 단가 점검, 인당 인건비 추이 추적",
  "광고비": "채널별 ROI 검토, 매출 기여도 분석",
  "임차료": "계약 갱신 영향 확인, 단가 재협상 검토",
  "감가상각비": "신규 자산 투자 내역 확인",
  "복리후생비": "정책 변경·일회성 지출 여부 확인, 세부 항목 분해",
  "IT수수료": "라이센스 사용량·계약 단가 재검토",
  "출장비": "출장 계획 정비, 분기별 한도 설정",
  "지급수수료": "최대 비중 lv2 항목 점검 후 단가·범위 재평가",
  "차량렌트비": "차량 사용 효율, 대체 옵션 검토",
  "수주회": "시즌 선집행 패턴 확인, 정상 여부 점검",
  "세금과공과": "납부 시점 이연 가능성 확인, 하반기 집중 납부 대비",
  "기타": "세부 항목 분해 후 원인 규명, 추세 모니터링",
};

const DOWN_ACTION_BY_LV2 = {
  "지급수수료|인테리어 개발": "매장 오픈 지연·축소 영향 확인",
  "지급수수료|법무": "법무 자문 감소 — 신규 분쟁 부재 여부 확인",
  "지급수수료|Supply Chain": "SCM 비용 축소 — 운영 영향 확인",
  "광고비|APP": "APP 축소가 매출 영향 여부 추적",
  "광고비|ACC": "ACC 채널 ROI 검토 후 축소 적정성 평가",
  "광고비|Branding": "브랜딩 비용 축소 — 브랜드 인지도 영향 확인",
  "광고비|Retailing": "리테일 광고 축소 영향 모니터링",
  "임차료|사무실임차료": "사무실 면적·계약 변경 영향 확인",
  "임차료|관리비": "관리비 절감 사유 확인",
  "출장비|해외출장비": "해외 출장 감소 — 사업 기회 손실 여부 확인",
  "출장비|국내출장비": "국내 출장 감소 — 운영 차질 여부 확인",
  "복리후생비|식대": "식대 변동 — 인원·정책 변화 확인",
  "인건비|기본급": "기본급 감소 — 인력 변동 영향 확인",
};

const DOWN_ACTION_BY_CAT = {
  "인건비": "효율화 지속 여부 확인, 인력 공백·이탈 리스크 점검",
  "광고비": "절감이 매출 영향 미치는지 추적",
  "임차료": "계약 갱신·면적 변경 영향 확인",
  "감가상각비": "자산 폐기·신규 투자 지연 영향 확인",
  "복리후생비": "정책 변경 여부, 단순 시점차 가능성 확인",
  "IT수수료": "라이센스 재협상·계약 종료 영향 확인",
  "출장비": "집행 지연 여부, 하반기 집중 발생 가능성",
  "지급수수료": "최대 비중 lv2 항목 검토, 축소 영향 점검",
  "차량렌트비": "차량 수 변경·정책 영향 확인",
  "기타": "세부 항목 분해 후 효율화·일회성 여부 점검",
};

// 특정 브랜드·카테고리의 최대 lv2 항목 찾기 (②~⑤ 분석 항상 YTD 기준)
function getTopLv2(brand, cat) {
  const bu = bizUnitsFor(brand);
  const lv2Sum = sumLv2(bu, year, month, "ytd", yearType, cat);
  const entries = Object.entries(lv2Sum).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return { name: entries[0][0], amount: entries[0][1] };
}

function buildDynamicAction(brand, cat, isUp) {
  const top = getTopLv2(brand, cat);
  if (top && top.name) {
    const key = `${cat}|${top.name}`;
    const dict = isUp ? UP_ACTION_BY_LV2 : DOWN_ACTION_BY_LV2;
    if (dict[key]) {
      return { action: dict[key], topLv2: top };
    }
  }
  const fallback = (isUp ? UP_ACTION_BY_CAT : DOWN_ACTION_BY_CAT)[cat] ?? "원인 규명 및 추세 모니터링";
  return { action: fallback, topLv2: top };
}

// ────────────────────────────────────────────────
// ⑤ 변동 원인 분석 (CHANGE_DRIVERS) — 브랜드별 상승/하락 상위 항목
// 매출 있는 브랜드: 비용률 변화(%p) 기준
// 매출 없는 공통: 금액 YoY (%) 기준
// ────────────────────────────────────────────────
function buildChangeDrivers() {
  const lines = [];
  for (const br of BRANDS_WITH_CORP) {
    const bd = brandData[br].ytd;
    const s = bd.current.sales;
    const sp = bd.previous?.sales ?? 0;
    const c = bd.current.cost;
    const cp = bd.previous?.cost ?? 0;
    const useAmountBased = s <= 0; // 공통(지원조직): 매출 없음 → 금액 YoY 기준
    const salesYoy = sp > 0 ? (s / sp) * 100 : null;
    const totalRatio = s > 0 ? calcCostRatio(c, s) : 0;
    const isSalesEffect = !useAmountBased && salesYoy != null && salesYoy > 130 && totalRatio > 30;

    let verdict, headerRatio, headerDelta;
    if (useAmountBased) {
      const costYoy = yoyNum(c, cp);
      verdict = costYoy != null && costYoy > 110 ? "악화" : costYoy != null && costYoy < 90 ? "개선" : "유지";
      headerRatio = `총비용 ${fmtK(c)}K (전년 ${fmtK(cp)}K)`;
      headerDelta = costYoy != null ? `YoY ${Math.round(costYoy)}%` : "-";
    } else if (isSalesEffect) {
      // 매출 급증 + 비용률 높은 브랜드: 비율 변화는 매출 효과로 라벨링
      const ratio = calcCostRatio(c, s);
      const ratioPrev = calcCostRatio(cp, sp);
      const delta = ratio - ratioPrev;
      verdict = "매출효과";
      headerRatio = `${ratio.toFixed(2)}%`;
      headerDelta = `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%p (매출 YoY ${Math.round(salesYoy)}%)`;
    } else {
      const ratio = calcCostRatio(c, s);
      const ratioPrev = calcCostRatio(cp, sp);
      const delta = ratio - ratioPrev;
      verdict = delta > 0.5 ? "악화" : delta < -0.5 ? "개선" : "유지";
      headerRatio = `${ratio.toFixed(2)}%`;
      headerDelta = `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%p`;
    }

    lines.push([
      "BRAND",
      br === "법인" ? "법인전체" : br,
      verdict,
      headerRatio,
      headerDelta,
    ].join("|"));

    const up = [], down = [];
    for (const lv1 of Object.keys(bd.currCats)) {
      if (SEASONAL_ITEMS.has(lv1)) continue;
      if (lv1 === "인건비" && isRedPackTimingDiff(brandData[br])) continue;
      const cur = bd.currCats[lv1] ?? 0;
      const prv = bd.prevCats[lv1] ?? 0;

      if (useAmountBased) {
        // 공통: 금액 YoY 기준 — 변동률 분석
        const yoy = yoyNum(cur, prv);
        if (yoy == null) continue;
        const yoyPct = yoy - 100; // +25%, -10% 등
        if (Math.abs(yoyPct) < 5) continue; // ±5% 미만 변동 제외
        const item = {
          cat: lv1,
          change: `${fmtK(prv)}K → ${fmtK(cur)}K`,
          delta: `${yoyPct >= 0 ? "+" : ""}${Math.round(yoyPct)}%`,
          amount: cur,
          sortKey: Math.abs(yoyPct) + Math.log10(Math.abs(cur) + 1), // 변동률 + 금액 가중치
        };
        if (yoyPct > 0) up.push(item);
        else down.push(item);
      } else {
        // 일반: 비용률 변화 기준
        const r = calcCostRatio(cur, s);
        const rp = calcCostRatio(prv, sp);
        const d = r - rp;
        if (Math.abs(d) < 0.2) continue;
        const item = {
          cat: lv1,
          change: `${rp.toFixed(2)}%→${r.toFixed(2)}%`,
          delta: `${d >= 0 ? "+" : ""}${d.toFixed(2)}%p`,
          amount: cur,
          sortKey: Math.abs(d),
        };
        if (d > 0) up.push(item);
        else down.push(item);
      }
    }
    up.sort((a, b) => b.sortKey - a.sortKey);
    down.sort((a, b) => b.sortKey - a.sortKey);

    for (const it of up.slice(0, 4)) {
      const ov = findOverride(br, it.cat);
      const { action, topLv2 } = buildDynamicAction(br, it.cat, true);
      const finalAction = ov ? `${ov.label} ${ov.note}` : action;
      const lv2Note = topLv2 ? ` (주요: ${topLv2.name} ${fmtK(topLv2.amount)}K)` : "";
      lines.push([
        "UP",
        br === "법인" ? "법인전체" : br,
        it.cat,
        it.change,
        it.delta,
        `${fmtK(it.amount)}K${lv2Note}`,
        finalAction,
      ].join("|"));
    }
    for (const it of down.slice(0, 3)) {
      const ov = findOverride(br, it.cat);
      const { action, topLv2 } = buildDynamicAction(br, it.cat, false);
      const finalAction = ov ? `${ov.label} ${ov.note}` : action;
      const lv2Note = topLv2 ? ` (주요: ${topLv2.name} ${fmtK(topLv2.amount)}K)` : "";
      lines.push([
        "DOWN",
        br === "법인" ? "법인전체" : br,
        it.cat,
        it.change,
        it.delta,
        `${fmtK(it.amount)}K${lv2Note}`,
        finalAction,
      ].join("|"));
    }
  }
  return sec("CHANGE_DRIVERS", lines.join("\n"));
}

// ────────────────────────────────────────────────
// 조립
// ────────────────────────────────────────────────
const cs = buildCostStructure();
const out = [
  buildMeta(),
  buildBullets(),
  buildTopSummary(),
  buildKpi(),
  buildScoreCards(),
  buildCheckpoints(),
  buildBrandOverview(),
  buildChangeDrivers(),
  buildRiskTable(),
  buildYoyTable(),
  cs.text,
  buildFixedVarAnalysis(),
  buildCostInsight(cs),
  buildKeyInsight(),
  buildDetailed(),
  "===END===\n",
].join("\n");

const filename = `${year}-${month}-${yearType}-${mode}.txt`;
const outPath = path.join(ROOT, "data", "ai-reports", filename);
fs.writeFileSync(outPath, out, "utf-8");
console.log(`✓ wrote ${outPath} (${out.length} bytes)`);
