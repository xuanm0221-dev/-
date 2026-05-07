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

  const salesBu = bizUnits.filter((b) => b !== "공통");
  const salesRows = rows.filter((r) => salesBu.includes(r.biz_unit));
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

  const ratioM = sM > 0 ? (cM / sM) * 100 : 0;
  const ratioMP = sMP > 0 ? (cMP / sMP) * 100 : 0;
  const ratioY = sY > 0 ? (cY / sY) * 100 : 0;
  const ratioYP = sYP > 0 ? (cYP / sYP) * 100 : 0;
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
        const detail = `YTD 실적 ${fmtK(curr)}K / 계획 ${planStr} (계획비 ${planRatioStr}) / 사용률 ${usageStr} / 연간계획 ${annStr} — ${reasons.join(", ")}`;
        brandRows.push(`| ${lv1} | ${verdict} | ${detail} |`);
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
  const costRatio = sales > 0 ? (cost / sales) * 100 : 0;
  const prevCostRatio = prevSales > 0 ? (prevCost / prevSales) * 100 : 0;
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
    const ratio = sales > 0 ? (cur / sales) * 100 : 0;
    const prvRatio = prevSales > 0 ? (prv / prevSales) * 100 : 0;
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
      const ratio = sBr > 0 ? (c / sBr) * 100 : 0;
      const prvRatio = sBrPrev > 0 ? (p / sBrPrev) * 100 : 0;
      const yr = Math.round(yoy);
      const rpT = isRedPackTimingDiff(bdRaw);
      const judge = rpT && yr < SALARY_GUIDELINE_MIN
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

  const lines = [
    `고정비|인건비+임차료+감가상각비|${fmtK(fixed)}K|${total > 0 ? ((fixed / total) * 100).toFixed(1) : "-"}%|YOY ${fmtYoy(fixed, fixedPrev)}`,
    `준고정비|복리후생비+IT수수료+기타+차량렌트비|${fmtK(semi)}K|${total > 0 ? ((semi / total) * 100).toFixed(1) : "-"}%|YOY ${fmtYoy(semi, semiPrev)}`,
    `변동비|광고비+수주회+출장비+지급수수료+세금과공과|${fmtK(variable)}K|${total > 0 ? ((variable / total) * 100).toFixed(1) : "-"}%|YOY ${fmtYoy(variable, variablePrev)}`,
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
  const ratioY = salesY > 0 ? (costY / salesY) * 100 : 0;
  const ratioYP = salesYP > 0 ? (costYP / salesYP) * 100 : 0;
  const ratioM = corpM.current.sales > 0 ? (corpM.current.cost / corpM.current.sales) * 100 : 0;
  const ratioMP = corpM.previous && corpM.previous.sales > 0 ? (corpM.previous.cost / corpM.previous.sales) * 100 : 0;
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
      const rM = sM > 0 ? (adM / sM) * 100 : 0;
      const rMP = sMP > 0 ? (adMP / sMP) * 100 : 0;
      const rY = sY > 0 ? (adY / sY) * 100 : 0;
      const rYP = sYP > 0 ? (adYP / sYP) * 100 : 0;
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
    const ratioM = sM > 0 ? (cM / sM) * 100 : 0;
    const ratioMP = sMP > 0 ? (cMP / sMP) * 100 : 0;
    const ratioY = sY > 0 ? (cY / sY) * 100 : 0;
    const ratioYP = sYP > 0 ? (cYP / sYP) * 100 : 0;
    const ratioPlan = sPlan && sPlan > 0 ? (cPlan / sPlan) * 100 : 0;
    const ratioAnn = sAnn && sAnn > 0 ? (cAnn / sAnn) * 100 : 0;
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
    const ratio = sales > 0 ? (cost / sales) * 100 : 0;
    const ratioPrev = salesPrev > 0 ? (costPrev / salesPrev) * 100 : 0;
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
  const disRatio = dis.current.sales > 0 ? (dis.current.cost / dis.current.sales) * 100 : 0;
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
// 조립
// ────────────────────────────────────────────────
const cs = buildCostStructure();
const out = [
  buildMeta(),
  buildBullets(),
  buildKpi(),
  buildRiskTable(),
  buildYoyTable(),
  cs.text,
  buildCostInsight(cs),
  buildKeyInsight(),
  buildDetailed(),
  "===END===\n",
].join("\n");

const filename = `${year}-${month}-${yearType}-${mode}.txt`;
const outPath = path.join(ROOT, "data", "ai-reports", filename);
fs.writeFileSync(outPath, out, "utf-8");
console.log(`✓ wrote ${outPath} (${out.length} bytes)`);
