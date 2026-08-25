"use client";

/**
 * 예산 중간점검 - YTD 기준 진척률 분석
 *
 * 데이터는 원래 3레벨(bu / cost_lv2 / cost_lv3)이지만, 화면상으로는
 * 대분류(cost_lv1)를 상위로 하고 그 아래 한 줄로 병합한 2레벨로 보여준다.
 *   출장비
 *     MLB국내 · 마케팅
 *     MLB국내 · Procurement
 *
 * 좌측: 예산 추가 검토(초과 지출)
 * 우측: 예산 감축 검토(미사용)
 * 하단(전체 폭): 정상 진행 (참고)
 */

import { Fragment, useMemo, useState } from "react";
import { AlertCircle, TrendingDown, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import { getCategoryDetail, getMonthlyTotal, type BizUnit } from "@/lib/expenseData";
import { formatK, formatPercent } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { t } from "@/lib/translations";

type Lang = "ko" | "zh";

interface BudgetMidCheckProps {
  bizUnit: BizUnit;
  year: number;
  month: number;
}

type Verdict = "over-clear" | "under-cut" | "normal";

interface BudgetItem {
  key: string;
  bu: string;
  lv1: string;
  lv2: string;
  lv3: string;
  subLabel: string;      // "bu · (lv3 or lv2)" 병합 라벨
  actual: number;        // YTD 실적
  prevActual: number;    // 전년 동일기간 YTD 실적
  yoyAmount: number;     // actual - prevActual
  yoyPct: number | null; // actual / prevActual × 100 (prevActual 없으면 null)
  prevAnnualActual: number; // 전년 연간(12월) 실적
  adjustedAnnual: number;   // 원 연간계획 + 증액 (over) / − 감축 (under)
  projAnnualYoyAmount: number;    // adjustedAnnual - prevAnnualActual
  projAnnualYoyPct: number | null; // adjustedAnnual / prevAnnualActual × 100
  planYtd: number;       // YTD 시점의 계획 (해당 월까지 계획 누적)
  planAnnual: number;    // 연간 계획 (12월까지 누적)
  ytdRatio: number;      // actual / planYtd × 100 (계획 대비 소진율)
  annualPct: number;     // actual / planAnnual × 100 (진척률)
  projectedIfFollowPlan: number; // 남은 계획을 그대로 소진했을 때 예상 연간 금액
  projectedPct: number;  // projected / planAnnual × 100
  verdict: Verdict;      // 결론 분류
  conclusion: string;    // 결론 텍스트
  deltaP: number;        // 참고용
}

interface Lv1Group {
  lv1: string;
  planSum: number;       // planAnnual 합계
  planYtdSum: number;
  actualSum: number;
  prevActualSum: number;
  yoyAmountSum: number;
  yoyPctSum: number | null;
  prevAnnualActualSum: number;
  adjustedAnnualSum: number;      // 원계획 + 순 조정금액
  projAnnualYoyAmountSum: number;
  projAnnualYoyPctSum: number | null;
  projectedIfFollowPlanSum: number;
  usagePct: number;      // 그룹 전체의 연간 대비 진척률
  ytdRatio: number;      // 그룹 전체의 YTD 대비 소진율
  projectedPct: number;  // 그룹 전체의 예상 연간 소진율
  deltaP: number;
  items: BudgetItem[];
}

// 판정 로직 (예상 소진율 단일 기준)
// 예상 소진율 = (실적 + 남은 개월의 예상 금액) / 연간계획 × 100
//             = 실적 × 12 / 월 / 연간계획 × 100  (현재 페이스로 연말까지 이어질 때)
// - ≥ 102% → 증액 필요 (over-clear)
// - ≤  95% → 감축 가능 (under-cut)
// - 95 < x < 102 → 오차 범위 정상
const PROJ_OVER = 102;
const PROJ_UNDER = 95;

function judgeVerdict(projectedPct: number): { verdict: Verdict; conclusion: string } {
  if (projectedPct >= PROJ_OVER) {
    return { verdict: "over-clear", conclusion: `예상 소진 ${PROJ_OVER}% 이상 → 증액 필요` };
  }
  if (projectedPct <= PROJ_UNDER) {
    return { verdict: "under-cut", conclusion: `예상 소진 ${PROJ_UNDER}% 이하 → 감축 가능` };
  }
  return { verdict: "normal", conclusion: `예상 소진 ${PROJ_UNDER}~${PROJ_OVER}% 오차 범위 · 계획대로 진행` };
}

// 분석에서 제외할 대분류 — 현재 없음
const EXCLUDED_LV1 = new Set<string>();

// 실제 사용액을 승인 완료로 처리하는 대분류
// - 수주회: 상반기 발생 완료 · 증액 승인 이미 받음 → 기사용금액이 승인액 (DISCOVERY 광고비와 동일 개념)
const APPROVED_BY_ACTUAL_LV1 = new Set(["수주회"]);

// 리프 그루핑 예외 — 광고비·인테리어개발은 브랜드(bu) 단위까지만 비교, lv2/lv3 제거
const BRAND_ONLY_LV1 = new Set(["광고비", "인테리어개발"]);

// (사용 안 함 — 인건비는 브랜드 구분 없이 항목별로 판단으로 변경)
const BU_LV2_ONLY = new Set<string>();

// 브랜드 구분 없이 lv2만 판단 (브랜드 간 인원 이동 있어 bu 구분 무의미)
// — 인건비: 기본급/성과급/성과급충당금/잡급/Red pack 등 항목만
const LV2_NEUTRAL_LV1 = new Set(["인건비"]);

// 리프 이름(lv2·lv3)에 이 문자열이 포함되면 브랜드 단위로 병합 (lv1이 인테리어개발이 아닌 경우 대비)
const BRAND_ONLY_LEAF_HINTS = ["인테리어개발"];

// 특정 lv1 아래에서 리프(lv2·lv3)를 하나의 라벨로 병합
// - bu 지정 시 그 bu만, 미지정 시 모든 bu
// - buNeutral: true 면 bu 구분 없이 (모든 브랜드 합계 1행)
interface MergeRule { patterns: string[]; mergedName: string; bu?: string; buNeutral?: boolean }
const MERGE_LEAVES: Record<string, MergeRule[]> = {
  "복리후생비": [
    // 5대보험 · 공적금 · 주재원지원금 각각 브랜드 구분 없이 전 브랜드 합산 1행씩
    { patterns: ["5대보험"], mergedName: "5대보험", buNeutral: true },
    { patterns: ["공적금"], mergedName: "공적금", buNeutral: true },
    { patterns: ["주재원지원금"], mergedName: "주재원지원금", buNeutral: true },
  ],
  "인건비": [
    // 공통 bu 의 주재원지원금 관련은 한 줄로 병합
    { patterns: ["주재원지원금"], mergedName: "주재원지원금", bu: "공통" },
  ],
};
function matchMergeRule(bu: string, lv1: string, lv2: string, lv3: string): MergeRule | null {
  const rules = MERGE_LEAVES[lv1];
  if (!rules) return null;
  const leaf = `${lv2} ${lv3}`;
  for (const rule of rules) {
    if (rule.bu && rule.bu !== bu) continue;
    if (rule.patterns.some((p) => leaf.includes(p))) return rule;
  }
  return null;
}

// 대분류만 판정 (bu/lv2/lv3 모두 제거) — 하위 세분 의미 없는 항목
const LV1_ONLY = new Set(["차량렌트비", "임차료"]);

// bu 정렬 우선순위 (공통·MLB·KIDS·DISCOVERY 순)
const BU_ORDER: Record<string, number> = { "공통": 0, MLB: 1, KIDS: 2, DISCOVERY: 3 };
const buRank = (bu: string) => BU_ORDER[bu] ?? 99;

// 대분류가 이 집합에 있으면 자식은 deltaP 대신 지정 bu 순서로 정렬
const BU_ORDERED_LV1 = new Set(["지급수수료", "광고비", "인건비"]);

// bu 정렬 다음으로 이어질 lv2 이차 정렬 우선순위 (지급수수료 등)
// key: lv1, value: { lv2Name: rank } — 낮을수록 먼저 (그 외는 99로 뒤로)
const LV2_ORDER: Record<string, Record<string, number>> = {
  "지급수수료": { "Supply Chain": 0, "IT": 1 },
  "인건비": { "기본급": 0, "성과급": 1, "성과급충당금": 2, "잡급": 3, "Red pack": 4, "퇴사보상금": 5 },
};
const lv2Rank = (lv1: string, lv2: string) => LV2_ORDER[lv1]?.[lv2] ?? 99;

// lv2 를 1차 정렬, bu 를 2차 정렬 순서로 뒤집는 대분류
// - 인건비: 기본급 → 브랜드, 성과급충당금 → 브랜드 (좌측 카드와 동일)
const LV2_FIRST_LV1 = new Set(["인건비"]);

// 추가 사용 승인 오버라이드 — 검토 자동 판정을 대체
// key: `${bu}|${lv1}`  (BRAND_ONLY 리프면 이것으로 매칭됨)
// mkt      : MKT 총 추가승인 금액 (계약 전체)
// alloc26  : 그중 FY26에 실제 배분 (계약 기간 중 26년 회계기 안에 들어오는 부분)
interface ApprovedAddition {
  totalMkt: number;    // K 단위
  totalAlloc26: number; // K 단위 — 실제 26년 예산에 잡히는 금액 (증액 열 반영값)
  items: { name: string; mkt: number; alloc26: number }[];
  note?: string;
}
const APPROVED_ADDITIONS: Record<string, ApprovedAddition> = {
  "DISCOVERY|광고비": {
    totalMkt: 14200,     // 8000 + 5000 + 1200
    totalAlloc26: 6616,  // 3333 + 2083 + 1200
    items: [
      { name: "MALE BA",   mkt: 8000, alloc26: 3333 },
      { name: "FEMALE BE", mkt: 5000, alloc26: 2083 },
      { name: "Shooting",  mkt: 1200, alloc26: 1200 },
    ],
    note: "FY26 DX Marketing 추가 사용 승인 · 계약기 안 26년 배분분만 반영",
  },
};

export function BudgetMidCheck({ bizUnit, year, month }: BudgetMidCheckProps) {
  const { lang } = useLanguage();

  const { overGroups, underGroups, onTrackGroups, expectedPace, totals, roas, overCount, underCount } = useMemo(() => {
    // 5개 소스: 연간 계획 · YTD 계획 · YTD 실적 · 전년 YTD 실적 · 전년 연간 실적(12월)
    const planAnnualItems = getCategoryDetail(bizUnit, year, 12, "", "ytd", "plan");
    const planYtdItems = getCategoryDetail(bizUnit, year, month, "", "ytd", "plan");
    const actualItems = getCategoryDetail(bizUnit, year, month, "", "ytd", "actual");
    const prevActualItems = getCategoryDetail(bizUnit, year - 1, month, "", "ytd", "actual");
    const prevAnnualActualItems = getCategoryDetail(bizUnit, year - 1, 12, "", "ytd", "actual");

    // 대분류가 EXCLUDED_LV1이면 스킵.
    // BRAND_ONLY_LV1 (광고비·인건비): bu 단위 병합 (lv2/lv3 제거)
    // 그 외: (bu, lv1, lv2, lv3) 완전 리프 유지 — 렌더 시 (bu, lv2)로 그룹화하고 lv3를 리프로 노출
    // lv2 또는 lv3에 힌트 문자열이 포함되면 브랜드 단위로 병합 대상
    const isBrandLeafHint = (lv2: string, lv3: string) =>
      BRAND_ONLY_LEAF_HINTS.some((h) => lv2.includes(h) || lv3.includes(h));

    const rowKey = (r: { biz_unit?: string; cost_lv1?: string; cost_lv2?: string; cost_lv3?: string }) => {
      const bu = r.biz_unit || "";
      const lv1 = r.cost_lv1 || "";
      const lv2 = (r.cost_lv2 || "").trim();
      const lv3 = (r.cost_lv3 || "").trim();
      if (LV1_ONLY.has(lv1)) return `|${lv1}||`;
      if (BRAND_ONLY_LV1.has(lv1)) return `${bu}|${lv1}||`;
      if (BU_LV2_ONLY.has(lv1)) return `${bu}|${lv1}|${lv2}|`;
      if (LV2_NEUTRAL_LV1.has(lv1)) return `|${lv1}|${lv2}|`;
      if (isBrandLeafHint(lv2, lv3)) {
        const hint = BRAND_ONLY_LEAF_HINTS.find((h) => lv2.includes(h) || lv3.includes(h)) ?? "";
        return `${bu}|${lv1}|${hint}|`;
      }
      const merged = matchMergeRule(bu, lv1, lv2, lv3);
      if (merged) {
        // buNeutral 이면 bu 제거하고 lv1+병합명 만으로 통합
        const keyBu = merged.buNeutral ? "" : bu;
        return `${keyBu}|${lv1}||${merged.mergedName}`;
      }
      return `${bu}|${lv1}|${lv2}|${lv3}`;
    };
    const rowInfo = (r: { biz_unit?: string; cost_lv1?: string; cost_lv2?: string; cost_lv3?: string }) => {
      const bu = r.biz_unit || "";
      const lv1 = r.cost_lv1 || "";
      const lv2 = (r.cost_lv2 || "").trim();
      const lv3 = (r.cost_lv3 || "").trim();
      if (LV1_ONLY.has(lv1)) return { bu: "", lv1, lv2: "", lv3: "" };
      if (BRAND_ONLY_LV1.has(lv1)) return { bu, lv1, lv2: "", lv3: "" };
      if (BU_LV2_ONLY.has(lv1)) return { bu, lv1, lv2, lv3: "" };
      if (LV2_NEUTRAL_LV1.has(lv1)) return { bu: "", lv1, lv2, lv3: "" };
      if (isBrandLeafHint(lv2, lv3)) {
        const hint = BRAND_ONLY_LEAF_HINTS.find((h) => lv2.includes(h) || lv3.includes(h)) ?? "";
        return { bu, lv1, lv2: hint, lv3: "" };
      }
      const merged = matchMergeRule(bu, lv1, lv2, lv3);
      if (merged) {
        return { bu: merged.buNeutral ? "" : bu, lv1, lv2: "", lv3: merged.mergedName };
      }
      return { bu, lv1, lv2, lv3 };
    };

    const planAnnualMap = new Map<string, number>();
    const planYtdMap = new Map<string, number>();
    const actualMap = new Map<string, number>();
    const prevActualMap = new Map<string, number>();
    const prevAnnualActualMap = new Map<string, number>();
    const infoMap = new Map<string, { bu: string; lv1: string; lv2: string; lv3: string }>();

    for (const p of planAnnualItems) {
      if (EXCLUDED_LV1.has(p.cost_lv1 || "")) continue;
      const k = rowKey(p);
      planAnnualMap.set(k, (planAnnualMap.get(k) || 0) + (p.amount || 0));
      if (!infoMap.has(k)) infoMap.set(k, rowInfo(p));
    }
    for (const p of planYtdItems) {
      if (EXCLUDED_LV1.has(p.cost_lv1 || "")) continue;
      const k = rowKey(p);
      planYtdMap.set(k, (planYtdMap.get(k) || 0) + (p.amount || 0));
      if (!infoMap.has(k)) infoMap.set(k, rowInfo(p));
    }
    for (const a of actualItems) {
      if (EXCLUDED_LV1.has(a.cost_lv1 || "")) continue;
      const k = rowKey(a);
      actualMap.set(k, (actualMap.get(k) || 0) + (a.amount || 0));
      if (!infoMap.has(k)) infoMap.set(k, rowInfo(a));
    }
    for (const a of prevActualItems) {
      if (EXCLUDED_LV1.has(a.cost_lv1 || "")) continue;
      const k = rowKey(a);
      prevActualMap.set(k, (prevActualMap.get(k) || 0) + (a.amount || 0));
    }
    for (const a of prevAnnualActualItems) {
      if (EXCLUDED_LV1.has(a.cost_lv1 || "")) continue;
      const k = rowKey(a);
      prevAnnualActualMap.set(k, (prevAnnualActualMap.get(k) || 0) + (a.amount || 0));
    }

    const expectedPace = (month / 12) * 100;
    const items: BudgetItem[] = [];
    for (const k of infoMap.keys()) {
      const planAnnual = planAnnualMap.get(k) || 0;
      const planYtd = planYtdMap.get(k) || 0;
      const actual = actualMap.get(k) || 0;
      const prevActual = prevActualMap.get(k) || 0;
      const prevAnnualActual = prevAnnualActualMap.get(k) || 0;
      if (planAnnual <= 0) continue;
      const info = infoMap.get(k)!;
      const yoyAmount = actual - prevActual;
      const yoyPct = prevActual > 0 ? (actual / prevActual) * 100 : null;
      // 라벨: BRAND_ONLY는 bu만, 그 외는 "bu · lv2 · lv3" (있는 것만)
      // 라벨 순서:
      // - LV2_FIRST_LV1 (인건비): lv2 → bu → lv3  (기본급 · 공통 형태)
      // - 그 외: bu → lv2 → lv3
      const subParts = LV2_FIRST_LV1.has(info.lv1)
        ? [info.lv2, info.bu, info.lv3].filter(Boolean)
        : [info.bu, info.lv2, info.lv3].filter(Boolean);
      const subLabel = subParts.join(" · ");
      const ytdRatio = planYtd > 0 ? (actual / planYtd) * 100 : (actual > 0 ? 999 : 0);
      const annualPct = (actual / planAnnual) * 100;
      // projected = 실적 + 남은 개월의 예상(=계획) 금액
      // 남은 계획은 planAnnual - planYtd. 이미 다 소진했으면 0, 아직 계획 있으면 양수.
      const planRemaining = Math.max(0, planAnnual - planYtd);
      const projectedIfFollowPlan = actual + planRemaining;
      const projectedPct = planAnnual > 0 ? (projectedIfFollowPlan / planAnnual) * 100 : 0;
      const deltaP = annualPct - expectedPace;
      const raw = judgeVerdict(projectedPct);
      // 승인 오버라이드 (사전 지정 or 실사용액 기반) → 좌측 증액검토에 반드시 표시
      const approvalOverride = APPROVED_ADDITIONS[`${info.bu}|${info.lv1}`];
      const hasApproval = !!approvalOverride;
      const isApprovedByActual = APPROVED_BY_ACTUAL_LV1.has(info.lv1);
      const verdict: Verdict = (hasApproval || isApprovedByActual) ? "over-clear" : raw.verdict;
      const conclusion = hasApproval
        ? t("추가 사용 승인 완료 (실 승인액 반영)", lang)
        : isApprovedByActual
        ? t("이미 발생 완료 · 승인 완료", lang)
        : raw.conclusion;
      // 조정후 연간 = 원 연간계획 + 승인/증액 (over) or − 감축 (under)
      let adjustedAnnual = planAnnual;
      if (hasApproval) adjustedAnnual = planAnnual + approvalOverride.totalAlloc26 * 1000;
      else if (isApprovedByActual) adjustedAnnual = planAnnual + Math.max(0, actual - planAnnual);
      else if (verdict === "over-clear") adjustedAnnual = planAnnual + Math.max(0, projectedIfFollowPlan - planAnnual);
      else if (verdict === "under-cut") adjustedAnnual = planAnnual - Math.max(0, planAnnual - projectedIfFollowPlan);
      const projAnnualYoyAmount = adjustedAnnual - prevAnnualActual;
      const projAnnualYoyPct = prevAnnualActual > 0 ? (adjustedAnnual / prevAnnualActual) * 100 : null;
      items.push({
        key: k, bu: info.bu, lv1: info.lv1, lv2: info.lv2, lv3: info.lv3, subLabel,
        actual, prevActual, yoyAmount, yoyPct,
        prevAnnualActual, adjustedAnnual, projAnnualYoyAmount, projAnnualYoyPct,
        planYtd, planAnnual,
        ytdRatio, annualPct, projectedIfFollowPlan, projectedPct,
        verdict, conclusion, deltaP,
      });
    }

    // 좌측(증액) = over-clear, 우측(감축) = under-cut, 하단(정상) = normal
    const overItems = items.filter((i) => i.verdict === "over-clear");
    const underItems = items.filter((i) => i.verdict === "under-cut");
    const onTrackItems = items.filter((i) => i.verdict === "normal");

    // lv1 별로 그룹화 (2레벨 렌더용)
    const groupByLv1 = (arr: BudgetItem[]): Lv1Group[] => {
      const g = new Map<string, BudgetItem[]>();
      for (const it of arr) {
        const bucket = g.get(it.lv1) ?? [];
        bucket.push(it);
        g.set(it.lv1, bucket);
      }
      return Array.from(g.entries()).map(([lv1, its]) => {
        const planSum = its.reduce((s, i) => s + i.planAnnual, 0);
        const planYtdSum = its.reduce((s, i) => s + i.planYtd, 0);
        const actualSum = its.reduce((s, i) => s + i.actual, 0);
        const prevActualSum = its.reduce((s, i) => s + i.prevActual, 0);
        const prevAnnualActualSum = its.reduce((s, i) => s + i.prevAnnualActual, 0);
        const adjustedAnnualSum = its.reduce((s, i) => s + i.adjustedAnnual, 0);
        const yoyAmountSum = actualSum - prevActualSum;
        const yoyPctSum = prevActualSum > 0 ? (actualSum / prevActualSum) * 100 : null;
        const usagePct = planSum > 0 ? (actualSum / planSum) * 100 : 0;
        const ytdRatio = planYtdSum > 0 ? (actualSum / planYtdSum) * 100 : 0;
        const planRemaining = Math.max(0, planSum - planYtdSum);
        const projectedIfFollowPlanSum = actualSum + planRemaining;
        const projectedPct = planSum > 0 ? (projectedIfFollowPlanSum / planSum) * 100 : 0;
        const projAnnualYoyAmountSum = adjustedAnnualSum - prevAnnualActualSum;
        const projAnnualYoyPctSum = prevAnnualActualSum > 0 ? (adjustedAnnualSum / prevAnnualActualSum) * 100 : null;
        const deltaP = usagePct - expectedPace;
        // 자식 정렬:
        // - LV2_FIRST_LV1 (인건비) → ① lv2 우선순위 (기본급 → 성과급충당금...) → ② bu 우선순위 (공통·MLB·KIDS·DISCOVERY)
        // - BU_ORDERED_LV1 (지급수수료·광고비) → ① bu 우선순위 → ② lv2 우선순위 (Supply Chain 먼저 등)
        // - 그 외 → 초과 리스트=ytdRatio 큰 순 / 미달 리스트=작은 순 / 정상=예산 큰 순
        its.sort((a, b) => {
          if (LV2_FIRST_LV1.has(lv1)) {
            const lv2Diff = lv2Rank(lv1, a.lv2) - lv2Rank(lv1, b.lv2);
            if (lv2Diff !== 0) return lv2Diff;
            if (a.lv2 !== b.lv2) return a.lv2.localeCompare(b.lv2);
            const buDiff = buRank(a.bu) - buRank(b.bu);
            if (buDiff !== 0) return buDiff;
            return b.planAnnual - a.planAnnual;
          }
          if (BU_ORDERED_LV1.has(lv1)) {
            const buDiff = buRank(a.bu) - buRank(b.bu);
            if (buDiff !== 0) return buDiff;
            const lv2Diff = lv2Rank(lv1, a.lv2) - lv2Rank(lv1, b.lv2);
            if (lv2Diff !== 0) return lv2Diff;
            if (a.lv2 !== b.lv2) return a.lv2.localeCompare(b.lv2);
            return b.planAnnual - a.planAnnual;
          }
          if (arr === overItems) return b.ytdRatio - a.ytdRatio;
          if (arr === underItems) return a.ytdRatio - b.ytdRatio;
          return b.planAnnual - a.planAnnual;
        });
        return { lv1, planSum, planYtdSum, actualSum, prevActualSum, yoyAmountSum, yoyPctSum, prevAnnualActualSum, adjustedAnnualSum, projAnnualYoyAmountSum, projAnnualYoyPctSum, projectedIfFollowPlanSum, usagePct, ytdRatio, projectedPct, deltaP, items: its };
      });
    };

    // 대분류 정렬 우선순위: 광고비=0, 수주회=1, 그 외=99 → 그 이후 기존 로직
    const LV1_TOP_ORDER: Record<string, number> = { "광고비": 0, "수주회": 1 };
    const lv1TopRank = (lv1: string) => LV1_TOP_ORDER[lv1] ?? 99;
    const withTopRank = <T extends { lv1: string }>(cmp: (a: T, b: T) => number) => (a: T, b: T) => {
      const d = lv1TopRank(a.lv1) - lv1TopRank(b.lv1);
      return d !== 0 ? d : cmp(a, b);
    };
    const overGroups = groupByLv1(overItems).sort(withTopRank<Lv1Group>((a, b) => (b.actualSum - b.planYtdSum) - (a.actualSum - a.planYtdSum)));
    const underGroups = groupByLv1(underItems).sort(withTopRank<Lv1Group>((a, b) => (b.planSum - b.actualSum - b.planYtdSum) - (a.planSum - a.actualSum - a.planYtdSum)));
    const onTrackGroups = groupByLv1(onTrackItems).sort((a, b) => b.planSum - a.planSum);

    // 승인 오버라이드 (사전 지정) 합 — DISCOVERY 광고비 등
    const approvalSum = items.reduce((s, i) => {
      const approval = APPROVED_ADDITIONS[`${i.bu}|${i.lv1}`];
      return s + (approval ? approval.totalAlloc26 * 1000 : 0);
    }, 0);
    // 승인 오버라이드 (실사용액) 합 — 수주회 등, 실 초과분(actual - planAnnual)만 반영
    const approvalByActualSum = items
      .filter((i) => APPROVED_BY_ACTUAL_LV1.has(i.lv1))
      .reduce((s, i) => s + Math.max(0, i.actual - i.planAnnual), 0);
    // 카테고리별 세분 (KPI 배지 표기용)
    const approvedByLv1 = new Map<string, number>();
    for (const i of items) {
      const approval = APPROVED_ADDITIONS[`${i.bu}|${i.lv1}`];
      if (approval) approvedByLv1.set(i.lv1, (approvedByLv1.get(i.lv1) ?? 0) + approval.totalAlloc26 * 1000);
      if (APPROVED_BY_ACTUAL_LV1.has(i.lv1)) approvedByLv1.set(i.lv1, (approvedByLv1.get(i.lv1) ?? 0) + Math.max(0, i.actual - i.planAnnual));
    }

    const totals = {
      plan: items.reduce((s, i) => s + i.planAnnual, 0),
      actual: items.reduce((s, i) => s + i.actual, 0),
      prevAnnual: items.reduce((s, i) => s + i.prevAnnualActual, 0),
      // 증액 승인완료 = 사전 지정 승인 + 수주회 등 실사용 승인
      approvedAmount: approvalSum + approvalByActualSum,
      // 추가 증액 검토 = 승인 없는 over-clear 항목의 계산치 (수주회·DISCOVERY 광고비 제외)
      reviewAmount: overItems
        .filter((i) => !APPROVED_ADDITIONS[`${i.bu}|${i.lv1}`] && !APPROVED_BY_ACTUAL_LV1.has(i.lv1))
        .reduce((s, i) => s + Math.max(0, i.projectedIfFollowPlan - i.planAnnual), 0),
      // 총 증액 예상 = 위 세 개 합 (조정 후 총예산 계산용)
      overAmount:
        approvalSum + approvalByActualSum +
        overItems
          .filter((i) => !APPROVED_ADDITIONS[`${i.bu}|${i.lv1}`] && !APPROVED_BY_ACTUAL_LV1.has(i.lv1))
          .reduce((s, i) => s + Math.max(0, i.projectedIfFollowPlan - i.planAnnual), 0),
      // 감축 예상 = under-cut 항목의 남은 예산 여유
      underAmount: underItems.reduce((s, i) => s + Math.max(0, i.planAnnual - i.projectedIfFollowPlan), 0),
      // KPI 표기용 카테고리 분해 (광고비/수주회 등)
      approvedByLv1,
    };

    // ROAS 판정: 매출 YoY vs 광고비 YoY — 전체 + 브랜드별 (MLB·KIDS·DISCOVERY)
    const computeRoas = (bu: BizUnit) => {
      const cur = getMonthlyTotal(bu, year, month, "ytd", "actual")?.sales ?? 0;
      const prv = getMonthlyTotal(bu, year - 1, month, "ytd", "actual")?.sales ?? 0;
      const salesGrowthPct = prv > 0 ? ((cur - prv) / prv) * 100 : null;
      // 광고비: bu가 "법인"이면 전체, 아니면 해당 brand items만
      const adItems = items.filter((i) =>
        i.lv1 === "광고비" && (bu === "법인" ? true : i.bu === bu)
      );
      const adCur = adItems.reduce((s, i) => s + i.actual, 0);
      const adPrev = adItems.reduce((s, i) => s + i.prevActual, 0);
      const adGrowthPct = adPrev > 0 ? ((adCur - adPrev) / adPrev) * 100 : null;
      return {
        bu, curSales: cur, prvSales: prv, salesGrowthPct,
        adCur, adPrev, adGrowthPct,
        isRational: salesGrowthPct != null && adGrowthPct != null ? salesGrowthPct >= adGrowthPct : null,
      };
    };
    const roasTotal = computeRoas(bizUnit);
    // 브랜드별: 법인 조회 시 3개 브랜드, 특정 브랜드 조회 시 해당 브랜드만
    const roasBrands = bizUnit === "법인"
      ? (["MLB", "KIDS", "DISCOVERY"] as BizUnit[]).map(computeRoas)
      : [];
    const roas = { ...roasTotal, brands: roasBrands };

    return {
      overGroups,
      underGroups,
      onTrackGroups,
      expectedPace,
      totals,
      roas,
      overCount: overItems.length,
      underCount: underItems.length,
    };
  }, [bizUnit, year, month]);

  // 탭: 핵심 결론(Overview + KPI) vs 상세 분석(예산초과/감축 · 정상 진행 표)
  const [tab, setTab] = useState<"overview" | "analysis">("overview");

  return (
    <div className="space-y-3">
      {/* 탭 스위처 + 우측 제목·기간 (한 줄, 외부 카드 없이 직접 노출) */}
      <div>
        <div className="flex items-center gap-3 flex-wrap mb-2">
          <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden shadow-sm">
            <button
              type="button"
              onClick={() => setTab("overview")}
              className={`px-4 py-1.5 text-[12px] font-semibold transition-colors ${
                tab === "overview"
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              📢 {t("핵심 결론 & 액션", lang)}
            </button>
            <button
              type="button"
              onClick={() => setTab("analysis")}
              className={`px-4 py-1.5 text-[12px] font-semibold border-l border-slate-300 transition-colors ${
                tab === "analysis"
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              🔍 {t("상세 분석 (근거)", lang)}
            </button>
          </div>
          <div className="flex items-baseline gap-2 min-w-0">
            <h2 className="text-[16px] font-bold tracking-tight text-slate-900 truncate">
              {t(bizUnit, lang)} · {t("예산 중간점검", lang)}
            </h2>
            <span className="text-[11px] text-slate-500 whitespace-nowrap">
              {year}년 {month}월 YTD · 예상 진척률 <b className="text-slate-700">{expectedPace.toFixed(0)}%</b>
            </span>
          </div>
        </div>
        {tab === "overview" && (<>
        {/* KPI 카드 6개 (탭 바로 아래, Executive Overview 위) — 순액증감 좌측 첫번째 */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3 items-stretch">
          {/* 순액 증감 카드 (첫번째) — 컴팩트 버전 */}
          {(() => {
            const net = totals.reviewAmount - totals.underAmount;
            const sign = net > 0 ? "+" : net < 0 ? "−" : "";
            const isOver = net > 0;
            const isUnder = net < 0;
            const borderCls = isOver
              ? "border-rose-500 bg-gradient-to-br from-rose-100 via-white to-rose-50"
              : isUnder
                ? "border-blue-500 bg-gradient-to-br from-blue-100 via-white to-blue-50"
                : "border-slate-500 bg-gradient-to-br from-slate-100 via-white to-slate-50";
            const valueCls = isOver ? "text-rose-700" : isUnder ? "text-blue-700" : "text-slate-700";
            const subCls = isOver ? "text-rose-600" : isUnder ? "text-blue-600" : "text-slate-600";
            return (
              <div className={`relative rounded-lg border-double border-[3px] ${borderCls} px-2 py-1.5 flex flex-col justify-center shadow-sm`}>
                <div className="flex items-center gap-1 mb-0.5">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 bg-white/70 px-1 py-[1px] rounded">Σ</span>
                  <span className="text-[10px] font-semibold text-slate-700 leading-tight truncate">
                    {t("순액 증감 (광고비·수주회 제외)", lang)}
                  </span>
                </div>
                <div className={`text-[17px] font-black tabular-nums leading-tight ${valueCls}`}>
                  {sign}{formatK(Math.abs(net))}
                  <span className={`ml-1.5 text-[10px] font-semibold ${subCls}`}>
                    {isOver ? `▲ ${t("초과 우세", lang)}` : isUnder ? `▼ ${t("감축 우세", lang)}` : `= ${t("초과=감축", lang)}`}
                  </span>
                </div>
              </div>
            );
          })()}
          <SummaryBox
            label={t("초과 예상 리스크", lang)}
            value={`+${formatK(totals.reviewAmount)}`}
            sub={`${overCount}${t("개 항목", lang)}`}
            tone="rose"
            emphasize
          />
          <SummaryBox
            label={t("감축 가능 (예상)", lang)}
            value={`−${formatK(totals.underAmount)}`}
            sub={`${underCount}${t("개 항목 · 남은 계획 소진 시 여유", lang)}`}
            tone="blue"
            emphasize
          />
          <SummaryBox
            label={t("사용 확정 (승인 완료)", lang)}
            value={`+${formatK(totals.approvedAmount)}`}
            sub={(() => {
              const parts: string[] = [];
              const ad = totals.approvedByLv1.get("광고비");
              const mtg = totals.approvedByLv1.get("수주회");
              if (ad && ad > 0) parts.push(`${t("광고비", lang)} +${formatK(ad)}`);
              if (mtg && mtg > 0) parts.push(`${t("수주회", lang)} +${formatK(mtg)}`);
              return parts.length ? parts.join(" · ") : t("승인 항목 없음", lang);
            })()}
            tone="emerald"
          />
          <SummaryBox
            label={t("총 예산 (원 계획)", lang)}
            value={formatK(totals.plan)}
            sub={`${t("실적", lang)} ${formatK(totals.actual)} · ${t("진척률", lang)} ${totals.plan > 0 ? formatPercent((totals.actual / totals.plan) * 100, 0) : "-"}`}
            tone="slate"
          />
          <SummaryBox
            label={t("조정 후 총예산", lang)}
            value={formatK(totals.plan + totals.overAmount - totals.underAmount)}
            sub={`${t("원 계획 대비", lang)} ${totals.plan > 0 ? formatPercent(((totals.plan + totals.overAmount - totals.underAmount) / totals.plan) * 100, 0) : "-"}`}
            tone="emerald"
          />
        </div>
        {/* Executive Overview — 항목별 실행 액션 도출 (CEO 보고용) */}
        {(() => {
          const netExclApproved = totals.reviewAmount - totals.underAmount;
          const adjustedTotal = totals.plan + totals.overAmount - totals.underAmount;
          const yoyPct = totals.prevAnnual > 0 ? (adjustedTotal / totals.prevAnnual) * 100 : null;
          const overTone = netExclApproved > 0;
          const adAmt = totals.approvedByLv1.get("광고비") ?? 0;
          const mtgAmt = totals.approvedByLv1.get("수주회") ?? 0;

          // 승인 제외 순수 초과 예상 항목 (lv2·lv3까지) — 상위 8개
          const pureOverItems = overGroups
            .flatMap((g) => g.items)
            .filter((i) => !APPROVED_ADDITIONS[`${i.bu}|${i.lv1}`] && !APPROVED_BY_ACTUAL_LV1.has(i.lv1))
            .map((i) => ({
              bu: i.bu, lv1: i.lv1, lv2: i.lv2, lv3: i.lv3, subLabel: i.subLabel,
              over: Math.max(0, i.projectedIfFollowPlan - i.planAnnual),
              actual: i.actual, planAnnual: i.planAnnual, projectedPct: i.projectedPct,
            }))
            .filter((x) => x.over > 0)
            .sort((a, b) => b.over - a.over);
          const pureOverSum = pureOverItems.reduce((s, x) => s + x.over, 0);
          const topOver = pureOverItems.slice(0, 8);

          // 감축 여력 항목 (lv2·lv3까지) — 상위 5개
          const underItemsTop = underGroups
            .flatMap((g) => g.items)
            .filter((i) => i.verdict === "under-cut")
            .map((i) => ({
              bu: i.bu, lv1: i.lv1, lv2: i.lv2, lv3: i.lv3,
              cut: Math.max(0, i.planAnnual - i.projectedIfFollowPlan),
            }))
            .filter((x) => x.cut > 0)
            .sort((a, b) => b.cut - a.cut)
            .slice(0, 5);

          // 항목 성격/액션 판정 (lv1·lv2·lv3 기반) — 성격에 맞는 현실적 액션
          const judgeAction = (lv1: string, lv2: string, lv3: string) => {
            if (lv1 === "인건비") {
              if (lv2 === "성과급충당금") return {
                type: "충당", tone: "slate",
                action: "충당 성격 — 예상액 기반이라 실지급 시 정산. 기존 충당 잔액 확인 후 하반기 적립률 재산정, 필요 시 환입 검토"
              };
              if (lv2 === "성과급") return {
                type: "변동", tone: "rose",
                action: "성과 재평가 결과 반영 · 목표 미달 시 지급률 조정"
              };
              if (lv2 === "주재원지원금") return {
                type: "변동", tone: "amber",
                action: "주재원 배치·정책 재검토 (일방 축소 어려움)"
              };
              return { type: "고정", tone: "amber", action: "인원계획 재검토 · TO 동결 · 자연 감원 유도" };
            }
            if (lv1 === "임차료") return { type: "고정", tone: "amber", action: "임대차 재협상 · 만료 시 다운사이징/이전 검토" };
            if (lv1 === "차량렌트비") return { type: "고정", tone: "amber", action: "리스 조건 재협상 · 반납 검토" };
            if (lv1 === "감가상각비") return { type: "회계", tone: "slate", action: "회계처리 성격 — 신규 CAPEX만 통제, 기존 자산은 자연 반영" };
            if (lv1 === "세금과공과") return { type: "이연", tone: "slate", action: "매입·매출 증치세 시기차 — 27년 이연 정상화, 자연 해소" };
            if (lv1 === "복리후생비") {
              if (lv2 === "워크샵" || lv3 === "워크샵") return {
                type: "복지", tone: "slate",
                action: "직원 복지 — 축소 대신 시기·포맷·규모 최적화 (일괄 감축 지양)"
              };
              if (lv2 === "경조사비" || lv3 === "경조사비") return { type: "복지", tone: "slate", action: "복지 규정 — 통제 대상 아님" };
              return { type: "복지", tone: "amber", action: "복리 성격 — 신규 도입만 억제, 기존은 유지" };
            }
            if (lv1 === "기타") {
              if (lv2 === "지급수수료" || lv2 === "Supply Chain" || lv2 === "SupplyChain") return {
                type: "변동", tone: "rose",
                action: "물류·수수료 계약 재협상 · 벤더 통합 · 프로세스 최적화"
              };
              if (lv2 === "여비교통비") return { type: "복지", tone: "amber", action: "야근·긴급 이동 성격 — 일괄 통제 지양, 사전 승인 절차 강화" };
              if (lv2 === "교육훈련비") return { type: "변동", tone: "amber", action: "필수 교육만 유지 · 외부 위탁 축소 (핵심 역량은 유지)" };
              if (lv2 === "회의비" || lv2 === "접대비") return { type: "변동", tone: "rose", action: "즉시 통제 — 4Q 신규 지출 승인 중단" };
              return { type: "변동", tone: "rose", action: "재량 지출 — 4Q 신규 지출 승인 중단" };
            }
            if (lv1 === "인테리어개발") return { type: "변동", tone: "rose", action: "신규 매장·리뉴얼 우선순위 재조정 · 4Q 착공 이연" };
            return { type: "검토", tone: "slate", action: "성격별 재검토 필요" };
          };

          // 성격별 초과액 집계 + 실제 초과 항목 리스트 (액션에서 인용)
          const buckets: Record<string, number> = { 변동: 0, 고정: 0, 충당: 0, 복지: 0, 회계: 0, 이연: 0, 검토: 0 };
          const bucketItems: Record<string, Array<{ bu: string; lv1: string; lv2: string; lv3: string; over: number }>> = {
            변동: [], 고정: [], 충당: [], 복지: [], 회계: [], 이연: [], 검토: [],
          };
          for (const it of pureOverItems) {
            const j = judgeAction(it.lv1, it.lv2, it.lv3);
            buckets[j.type] = (buckets[j.type] ?? 0) + it.over;
            bucketItems[j.type].push(it);
          }
          // 각 bucket 항목명 top3 (lv2 · lv3 중심)
          const bucketExamples = (type: string, n = 3): string => {
            const arr = (bucketItems[type] ?? [])
              .sort((a, b) => b.over - a.over)
              .slice(0, n)
              .map((it) => {
                const parts = [it.bu, it.lv2 ? t(it.lv2, lang) : t(it.lv1, lang), it.lv3 ? t(it.lv3, lang) : ""].filter(Boolean);
                return parts.join("·");
              });
            const suffix = (bucketItems[type]?.length ?? 0) > n ? ` ${t("등", lang)}` : "";
            return arr.length ? arr.join(", ") + suffix : "";
          };

          // 헤드라인 결론 (액션 도출형)
          const headline = lang === "zh"
            ? overTone
              ? `📢 优先控制可变费用 ${formatK(buckets["변동"] ?? 0)} — 4Q冻结新增支出, 减少空间 ${formatK(totals.underAmount)}用于抵消 (调整后总预算 ${formatK(adjustedTotal)}, 同比去年 ${yoyPct != null ? (yoyPct >= 100 ? "+" : "") + (yoyPct - 100).toFixed(1) + "%" : "-"})`
              : netExclApproved < 0
                ? `📢 净节余 ${formatK(Math.abs(netExclApproved))} — 用作新投资/风险缓冲, 光告费·订货会按ROAS·ROI持续监控`
                : `📢 按原计划均衡运行 — 关注可变费用月度动态, 保持现有控制水平`
            : overTone
              ? `📢 변동비 우선 통제 ${formatK(buckets["변동"] ?? 0)} — 4Q 신규 지출 동결, 감축 여력 ${formatK(totals.underAmount)}로 상쇄 (조정 후 총예산 ${formatK(adjustedTotal)}, 전년비 ${yoyPct != null ? (yoyPct >= 100 ? "+" : "") + (yoyPct - 100).toFixed(1) + "%" : "-"})`
              : netExclApproved < 0
                ? `📢 순 여유 ${formatK(Math.abs(netExclApproved))} — 신규 투자·리스크 버퍼로 재배분, 광고비·수주회는 ROAS·ROI 지속 모니터링`
                : `📢 원 계획대로 균형 진행 — 변동비 월별 모니터링, 현 통제 수준 유지`;

          const labelOf = (it: { bu: string; lv1: string; lv2: string; lv3: string }) => {
            const parts = [it.bu, t(it.lv1, lang), it.lv2 ? t(it.lv2, lang) : "", it.lv3 ? t(it.lv3, lang) : ""].filter(Boolean);
            return parts.join(" · ");
          };

          return (
            <div className={`rounded-lg border-2 ${overTone ? "border-rose-300 bg-gradient-to-br from-rose-50/60 to-white" : netExclApproved < 0 ? "border-blue-300 bg-gradient-to-br from-blue-50/60 to-white" : "border-slate-300 bg-slate-50/60"} p-3 mb-3`}>
              <div className="flex items-baseline gap-2 mb-2">
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${overTone ? "bg-rose-600 text-white" : netExclApproved < 0 ? "bg-blue-600 text-white" : "bg-slate-600 text-white"}`}>
                  Executive Overview
                </span>
                <span className="text-[11px] text-slate-500">{t("CEO 보고용 · 항목별 실행 액션", lang)}</span>
              </div>

              {/* 헤드라인 (Action-oriented) */}
              <p className={`text-[13.5px] font-bold leading-snug mb-3 ${overTone ? "text-rose-800" : netExclApproved < 0 ? "text-blue-800" : "text-slate-800"}`}>
                {headline}
              </p>

              {/* 2 컬럼: 좌(승인 판단·초과 항목별 액션) · 우(성격별 우선순위·감축 활용·최종 액션) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">

                {/* LEFT: 승인 완료 판단 근거 + 초과 항목별 액션 */}
                <div className="space-y-2.5">
                  {/* 승인 완료 판단 근거 */}
                  <div className="rounded border border-emerald-200 bg-emerald-50/50 p-2.5">
                    <div className="text-[11px] font-bold text-emerald-800 mb-1.5">
                      ✅ {t("승인 완료 — 판단 근거 & 지속 관리 지표", lang)}
                    </div>
                    <ul className="text-[10.5px] text-slate-700 space-y-1.5 leading-snug">
                      {adAmt > 0 && (
                        <li>
                          <b className="text-emerald-800">{t("광고비", lang)} +{formatK(adAmt)}</b> — {t("DISCOVERY MKT 추가승인", lang)}
                          {/* 실제 ROAS 계산: 리테일 매출 YoY vs 광고비 YoY (전체 + 브랜드별) */}
                          <div className="mt-1 rounded bg-white/70 border border-emerald-100 p-1.5">
                            <div className="text-[10px] font-bold text-slate-700 mb-1">
                              📊 ROAS {t("실측 — 매출 YoY vs 광고비 YoY", lang)}
                            </div>
                            {/* 미니 테이블: 브랜드/합계 행 */}
                            <div className="grid grid-cols-[minmax(60px,auto)_1fr_1fr_auto] gap-x-2 gap-y-0.5 text-[10px] items-baseline">
                              <div className="text-[9px] font-semibold text-slate-500">{t("사업부", lang)}</div>
                              <div className="text-[9px] font-semibold text-slate-500 text-right">{t("매출 YoY", lang)}</div>
                              <div className="text-[9px] font-semibold text-slate-500 text-right">{t("광고비 YoY", lang)}</div>
                              <div className="text-[9px] font-semibold text-slate-500 text-center">Δ%p</div>
                              {/* 브랜드별 행 (법인 조회 시만) */}
                              {roas.brands.map((br) => {
                                const gap = (br.salesGrowthPct != null && br.adGrowthPct != null) ? br.salesGrowthPct - br.adGrowthPct : null;
                                return (
                                  <Fragment key={br.bu}>
                                    <div className="text-slate-700 font-semibold">{br.bu}</div>
                                    <div className={`text-right tabular-nums ${br.salesGrowthPct != null ? (br.salesGrowthPct >= 0 ? "text-emerald-700" : "text-rose-700") : "text-slate-400"}`}>
                                      {br.salesGrowthPct != null ? `${br.salesGrowthPct >= 0 ? "+" : ""}${br.salesGrowthPct.toFixed(1)}%` : "-"}
                                    </div>
                                    <div className={`text-right tabular-nums ${br.adGrowthPct != null ? "text-slate-700" : "text-slate-400"}`}>
                                      {br.adGrowthPct != null ? `${br.adGrowthPct >= 0 ? "+" : ""}${br.adGrowthPct.toFixed(1)}%` : "-"}
                                    </div>
                                    <div className="text-center">
                                      {br.adPrev === 0 && br.adCur === 0
                                        ? <span className="text-[9px] text-slate-400">{t("광고 없음", lang)}</span>
                                        : gap == null
                                          ? <span className="text-[9px] text-slate-400">-</span>
                                          : <span className={`text-[10px] tabular-nums font-semibold ${gap >= 0 ? "text-emerald-700" : "text-slate-500"}`}>
                                              {gap >= 0 ? "+" : ""}{gap.toFixed(1)}
                                            </span>
                                      }
                                    </div>
                                  </Fragment>
                                );
                              })}
                              {/* 합계 행 (진하게) */}
                              <div className="text-slate-800 font-bold border-t border-emerald-200 pt-0.5">{t(roas.bu, lang)} {t("합계", lang)}</div>
                              <div className={`text-right font-bold tabular-nums border-t border-emerald-200 pt-0.5 ${roas.salesGrowthPct != null ? (roas.salesGrowthPct >= 0 ? "text-emerald-700" : "text-rose-700") : "text-slate-400"}`}>
                                {roas.salesGrowthPct != null ? `${roas.salesGrowthPct >= 0 ? "+" : ""}${roas.salesGrowthPct.toFixed(1)}%` : "-"}
                              </div>
                              <div className={`text-right font-bold tabular-nums border-t border-emerald-200 pt-0.5 ${roas.adGrowthPct != null ? "text-slate-800" : "text-slate-400"}`}>
                                {roas.adGrowthPct != null ? `${roas.adGrowthPct >= 0 ? "+" : ""}${roas.adGrowthPct.toFixed(1)}%` : "-"}
                              </div>
                              <div className="text-center font-bold tabular-nums border-t border-emerald-200 pt-0.5">
                                {(roas.salesGrowthPct != null && roas.adGrowthPct != null)
                                  ? (() => {
                                      const gap = roas.salesGrowthPct - roas.adGrowthPct;
                                      return <span className={`text-[10.5px] ${gap >= 0 ? "text-emerald-700" : "text-slate-600"}`}>{gap >= 0 ? "+" : ""}{gap.toFixed(1)}</span>;
                                    })()
                                  : <span className="text-[9px] text-slate-400">-</span>}
                              </div>
                            </div>
                            {/* 시차 안내 — 광고비 효과는 3~6개월 지연되므로 동기간 즉시 판정은 부적절 */}
                            <div className="text-[9.5px] text-slate-600 mt-1 pt-1 border-t border-emerald-100 leading-snug">
                              ⏳ {t("광고비 효과는 리테일 매출에 3~6개월 시차로 반영 — 동기간 즉시 재조정 판정은 부적절. 광고비 지출 시점 + 시차 후 매출 반영을 6개월 단위로 재평가 권고 (전년비 동기간 비교는 추이 참고용).", lang)}
                            </div>
                          </div>
                        </li>
                      )}
                      {mtgAmt > 0 && (
                        <li>
                          <b className="text-emerald-800">{t("수주회", lang)} +{formatK(mtgAmt)}</b>
                          <div className="text-slate-600 mt-0.5">
                            🌏 <b>{t("판단 근거", lang)}</b>: {t("DISCOVERY 중국 시장 신규 진출 초기 투자 — 브랜드 인지·바이어 확보 목적, 절대금액보다 26·27년 신규 매장 오픈·바이어 계약 수로 ROI 관리", lang)}
                          </div>
                        </li>
                      )}
                      {adAmt === 0 && mtgAmt === 0 && (
                        <li className="text-slate-500 italic">{t("승인 항목 없음", lang)}</li>
                      )}
                    </ul>
                  </div>

                  {/* 순수 초과 항목별 액션 (lv2·lv3 포함) */}
                  <div className="rounded border border-rose-200 bg-rose-50/50 p-2.5">
                    <div className="text-[11px] font-bold text-rose-800 mb-1.5">
                      ⚠ {t("순수 초과 예상 — 세부 항목별 액션 (승인 제외)", lang)} <span className="text-[10px] text-rose-600 ml-1">+{formatK(pureOverSum)}</span>
                    </div>
                    {topOver.length === 0 ? (
                      <p className="text-[10.5px] text-slate-500 italic">{t("초과 예상 항목 없음 — 광고비·수주회 외 예산 준수 중", lang)}</p>
                    ) : (
                      <ul className="text-[10.5px] text-slate-700 space-y-1.5 leading-snug">
                        {topOver.map((it, idx) => {
                          const j = judgeAction(it.lv1, it.lv2, it.lv3);
                          const toneCls = j.tone === "rose" ? "text-rose-700 bg-rose-100" : j.tone === "amber" ? "text-amber-700 bg-amber-100" : "text-slate-600 bg-slate-100";
                          return (
                            <li key={idx} className="flex flex-col border-b border-rose-100/70 pb-1 last:border-b-0 last:pb-0">
                              <div className="flex items-baseline gap-1.5 flex-wrap">
                                <span className={`inline-block px-1 py-[1px] rounded text-[9px] font-semibold ${toneCls} flex-shrink-0`}>{t(j.type, lang)}</span>
                                <b className="text-slate-800">{labelOf(it)}</b>
                                <span className="text-rose-600 font-semibold tabular-nums">+{formatK(it.over)}</span>
                                <span className="text-slate-400 text-[9.5px]">({formatPercent(it.projectedPct, 0)})</span>
                              </div>
                              <div className="text-[10px] text-slate-600 pl-1 mt-0.5">→ {t(j.action, lang)}</div>
                            </li>
                          );
                        })}
                        {pureOverItems.length > 8 && (
                          <li className="text-[9.5px] text-slate-400 italic">…{t("외", lang)} {pureOverItems.length - 8}{t("개 항목 (표 참조)", lang)}</li>
                        )}
                      </ul>
                    )}
                  </div>
                </div>

                {/* RIGHT: 성격별 우선순위 + 감축 재배분 + 최종 액션 */}
                <div className="space-y-2.5">
                  {/* 성격별 통제 우선순위 — 값 있는 tile만 표시 */}
                  {(() => {
                    const tileDef = [
                      { key: "변동", labelKey: "변동비 (즉시 통제)", border: "border-rose-500", bg: "bg-rose-50/60", labelCls: "text-rose-700", valCls: "text-rose-800", descKey: "즉시 통제 — 4Q 신규 지출 동결", descCls: "text-slate-600" },
                      { key: "고정", labelKey: "고정비 (재협상)", border: "border-amber-500", bg: "bg-amber-50/60", labelCls: "text-amber-700", valCls: "text-amber-800", descKey: "재협상·재배치 — 즉시 통제 어려움", descCls: "text-slate-600" },
                      { key: "충당", labelKey: "충당 (재산정)", border: "border-slate-500", bg: "bg-slate-100", labelCls: "text-slate-700", valCls: "text-slate-800", descKey: "성과급충당금 — 잔액 확인, 하반기 적립률 재산정 (환입 여지)", descCls: "text-slate-600" },
                      { key: "복지", labelKey: "복지 (유지)", border: "border-emerald-500", bg: "bg-emerald-50/60", labelCls: "text-emerald-700", valCls: "text-emerald-800", descKey: "직원 복지 — 축소 대신 시기·포맷 최적화", descCls: "text-slate-600" },
                      { key: "이연", labelKey: "이연 (자연 해소)", border: "border-slate-400", bg: "bg-slate-50", labelCls: "text-slate-600", valCls: "text-slate-700", descKey: "증치세 시기차 — 27년 자연 해소, 통제 불필요", descCls: "text-slate-500" },
                      { key: "회계", labelKey: "회계 (자연 반영)", border: "border-slate-300", bg: "bg-slate-50/60", labelCls: "text-slate-600", valCls: "text-slate-700", descKey: "감가상각 — 신규 CAPEX만 통제", descCls: "text-slate-500" },
                    ];
                    const active = tileDef.filter((td) => (buckets[td.key] ?? 0) > 0);
                    if (active.length === 0) return null;
                    return (
                      <div className="rounded border border-slate-300 bg-white p-2.5">
                        <div className="text-[11px] font-bold text-slate-800 mb-1.5">
                          🎯 {t("성격별 통제 우선순위", lang)}
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 text-[10.5px]">
                          {active.map((td, idx) => {
                            const ex = bucketExamples(td.key, 2);
                            return (
                              <div key={td.key} className={`rounded border-l-4 ${td.border} ${td.bg} px-2 py-1.5`}>
                                <div className={`text-[9.5px] font-bold ${td.labelCls}`}>{["①", "②", "③", "④", "⑤", "⑥"][idx]} {t(td.labelKey, lang)}</div>
                                <div className={`text-[11.5px] font-bold tabular-nums ${td.valCls}`}>+{formatK(buckets[td.key] ?? 0)}</div>
                                {ex && <div className="text-[9.5px] text-slate-700 leading-tight mt-0.5 font-medium truncate" title={ex}>{ex}</div>}
                                <div className={`text-[9.5px] leading-tight mt-0.5 ${td.descCls}`}>{t(td.descKey, lang)}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* 감축 여력 재배분 */}
                  {underItemsTop.length > 0 && (
                    <div className="rounded border border-blue-200 bg-blue-50/50 p-2.5">
                      <div className="text-[11px] font-bold text-blue-800 mb-1.5">
                        💰 {t("감축 가능 여력 — 세부 항목 & 재배분", lang)} <span className="text-[10px] text-blue-600 ml-1">−{formatK(totals.underAmount)}</span>
                      </div>
                      <ul className="text-[10.5px] text-slate-700 space-y-0.5 leading-snug">
                        {underItemsTop.map((it, idx) => (
                          <li key={idx} className="flex items-baseline gap-1.5 flex-wrap">
                            <span className="text-blue-700 font-semibold tabular-nums flex-shrink-0">−{formatK(it.cut)}</span>
                            <span className="text-slate-700">{labelOf(it)}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="text-[10px] text-slate-600 mt-1.5 pt-1.5 border-t border-blue-200 leading-snug">
                        💡 {t("우선 재배분: 변동비 초과분 상쇄 → 잔여는 27년 리스크 버퍼로 확보", lang)}
                      </div>
                    </div>
                  )}

                  {/* 최종 실행 액션 (우선순위) — 실제 초과 항목만 인용 */}
                  <div className="rounded border-2 border-slate-800 bg-white p-2.5">
                    <div className="text-[11px] font-bold text-slate-900 mb-1.5">
                      ✍ {t("최종 실행 액션 (우선순위)", lang)}
                    </div>
                    <ol className="text-[10.5px] text-slate-800 space-y-1 leading-snug list-decimal pl-4 marker:text-slate-500 marker:font-bold">
                      {(buckets["변동"] ?? 0) > 0 && (
                        <li>
                          <b className="text-rose-700">[{t("즉시", lang)}]</b> {t("변동비 초과", lang)} <span className="text-slate-500">({bucketExamples("변동", 3)})</span> — {t("4Q 신규 지출 승인 중단, 긴급건은 CEO 직접 승인", lang)}
                        </li>
                      )}
                      {(buckets["충당"] ?? 0) > 0 && (
                        <li>
                          <b className="text-slate-700">[{t("즉시 · 회계 검토", lang)}]</b> {bucketExamples("충당", 2)} — {t("실지급 예상 대비 과다 적립 시 하반기 적립률 하향/환입 (충당이라 실제 유출 아님)", lang)}
                        </li>
                      )}
                      {(buckets["고정"] ?? 0) > 0 && (
                        <li>
                          <b className="text-amber-700">[{t("단기 (1개월 내)", lang)}]</b> {t("고정비 초과", lang)} <span className="text-slate-500">({bucketExamples("고정", 3)})</span> — {t("재협상·재배치 검토, 인건 관련은 TO 동결·성과급 목표 재평가", lang)}
                        </li>
                      )}
                      {(buckets["복지"] ?? 0) > 0 && (
                        <li>
                          <b className="text-emerald-700">[{t("유지", lang)}]</b> {bucketExamples("복지", 2)} — {t("직원 사기·유지 목적, 축소 대신 시기·포맷 최적화 (일괄 감축 금지)", lang)}
                        </li>
                      )}
                      {(buckets["이연"] ?? 0) > 0 && (
                        <li>
                          <b className="text-slate-600">[{t("자연 해소", lang)}]</b> {bucketExamples("이연", 2)} — {t("시기 차이 성격, 27년 정상화, 별도 액션 불요", lang)}
                        </li>
                      )}
                      {adAmt > 0 && (
                        <li>
                          <b className="text-emerald-700">[{t("지속 모니터링", lang)}]</b> {t("광고비 ROAS — 리테일 매출은 3~6개월 시차로 반영되므로 동기간 즉시 판정 지양, 반기 단위 지연 매출 반영 후 재평가", lang)}
                        </li>
                      )}
                      {mtgAmt > 0 && (
                        <li>
                          <b className="text-emerald-700">[{t("중장기", lang)}]</b> {t("수주회는 DISCOVERY 중국 진출 초기 투자 — 26·27년 신규 매장 오픈 수·바이어 계약 성과로 ROI 관리", lang)}
                        </li>
                      )}
                      {totals.underAmount > 0 && (
                        <li>
                          <b className="text-blue-700">[{t("재배분", lang)}]</b> {t("감축 여력 −", lang)}{formatK(totals.underAmount)} — {t("우선 변동비 초과 상쇄, 잔여는 27년 리스크 버퍼", lang)}
                        </li>
                      )}
                    </ol>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
        </>)}
      </div>

      {tab === "analysis" && (<>
        {/* 가이드 노트 (상세 분석 상단) — 판정 기준 · 승인 완료 항목 */}
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-2">
          {/* 좌: 판정 기준 */}
          <p className="text-[11px] text-gray-600 bg-amber-50 border-l-4 border-amber-400 px-3 py-2 rounded leading-snug">
            {lang === "zh" ? (
              <>
                ※ <b>预计消耗 = (实绩 + 剩余月计划金额) / 年度预算</b>. 剩余计划 = 年度预算 − YTD 计划 (若计划已全部消耗则为 0).
                <br />
                <b>≥ 102% → 需要增加</b>, <b>≤ 95% → 可减少</b>, <b className="text-blue-600">中间(95~102%)按误差范围视为正常.</b>
                <br />
                <b>广告费·内饰开发</b>汇总至品牌, <b>人工费</b>仅按项目(lv2)汇总(不分品牌, 品牌间人员可流动), <b>车辆租赁费·租金</b>仅按大分类判定.
              </>
            ) : (
              <>
                ※ <b>예상소진 = (실적 + 남은 개월 계획금액) / 연간계획</b>. 남은 계획 = 연간계획 − YTD계획 (이미 다 소진했으면 0).
                <br />
                <b>≥ 102% → 초과 예상</b>, <b>≤ 95% → 감축 가능</b>, <b className="text-blue-600">그 사이(95~102%)는 오차 범위로 정상.</b>
                <br />
                <b>광고비·인테리어개발</b>은 브랜드까지, <b>인건비</b>는 항목(lv2)만 (브랜드 무관 · 브랜드 간 인원 이동 있음), <b>차량렌트비·임차료</b>는 대분류만.
              </>
            )}
          </p>
          {/* 우: 승인 완료 항목 */}
          <p className="text-[11px] text-emerald-700 bg-emerald-50 border-l-4 border-emerald-400 px-3 py-2 rounded leading-snug">
            {lang === "zh" ? (
              <>
                <b>已批准项目</b>: <b>DISCOVERY 广告费</b> · <b>订货会</b> — 已完成批准, 直接反映实际金额 (不列入追加检查).
              </>
            ) : (
              <>
                <b>승인 완료 항목</b>: <b>DISCOVERY 광고비</b> · <b>수주회</b> — 이미 승인 완료, 실 사용액 그대로 반영 (추가 검토 대상 아님).
              </>
            )}
          </p>
        </div>
        {/* 좌·우 sync — 같은 대분류 축, 좌측 초과 / 우측 감축 */}
        <SyncedBudgetSection
          overGroups={overGroups}
          underGroups={underGroups}
          overCount={overCount}
          underCount={underCount}
          lang={lang as Lang}
        />

        {/* 하단: 정상 진행 (참고) — 증액검토와 동일 폭 (좌측 반 폭만 사용) */}
        <div className="grid grid-cols-2 gap-3">
          <BudgetSection
            icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}
            title={t("정상 진행 (참고)", lang)}
            subtitle={`${onTrackGroups.length}${t("개 대분류 · ", lang)}${onTrackGroups.reduce((s, g) => s + g.items.length, 0)}${t("개 세부 항목", lang)}`}
            tone="emerald"
            groups={onTrackGroups}
            emptyMsg={t("정상 진행 항목이 없습니다.", lang)}
            lang={lang as Lang}
          />
          <div />
        </div>
      </>)}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// UI helpers
// ─────────────────────────────────────────────────────

function SummaryBox({
  label, value, sub, tone, emphasize,
}: { label: string; value: string; sub: string; tone: "rose" | "blue" | "emerald" | "slate"; emphasize?: boolean }) {
  const cls = {
    rose: emphasize ? "border-rose-400 bg-rose-50 text-rose-900" : "border-rose-200 bg-rose-50/60 text-rose-800",
    blue: emphasize ? "border-blue-400 bg-blue-50 text-blue-900" : "border-blue-200 bg-blue-50/60 text-blue-800",
    emerald: emphasize ? "border-emerald-400 bg-emerald-50 text-emerald-900" : "border-emerald-200 bg-emerald-50/60 text-emerald-800",
    slate: emphasize ? "border-slate-400 bg-slate-50 text-slate-900" : "border-slate-200 bg-slate-50/60 text-slate-800",
  }[tone];
  return (
    <div className={`${emphasize ? "border-4" : "border"} rounded-md px-3 py-2 ${cls}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-[16px] font-bold leading-tight mt-0.5" style={{ fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div className="text-[10px] mt-0.5 opacity-80">{sub}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// SyncedBudgetSection — 같은 대분류 축을 좌우로 나눠 초과/감축 병렬 표시
// ─────────────────────────────────────────────────────
function SyncedBudgetSection({
  overGroups, underGroups, overCount, underCount, lang,
}: {
  overGroups: Lv1Group[];
  underGroups: Lv1Group[];
  overCount: number;
  underCount: number;
  lang: Lang;
}) {
  // 좌·우에 나타나는 모든 lv1 합집합 (한 쪽만 있어도 그 lv1은 보임)
  const overMap = new Map(overGroups.map((g) => [g.lv1, g]));
  const underMap = new Map(underGroups.map((g) => [g.lv1, g]));
  // 대분류별 조정후 연간 · 전년 연간 합 (이 행에 실제 표시되는 over + under만; 정상 항목은 제외)
  // 정상 항목까지 포함하면 화면에 안 보이는 브랜드 광고비 등이 섞여 YoY가 왜곡됨
  const combinedByLv1 = (lv1: string) => {
    const o = overMap.get(lv1);
    const u = underMap.get(lv1);
    const adjusted = (o?.adjustedAnnualSum ?? 0) + (u?.adjustedAnnualSum ?? 0);
    const prev = (o?.prevAnnualActualSum ?? 0) + (u?.prevAnnualActualSum ?? 0);
    return { adjusted, prev };
  };
  const allLv1 = Array.from(new Set([...overMap.keys(), ...underMap.keys()]));
  // 정렬: (초과 planSum + 감축 planSum) 큰 순
  // 정렬: 미확정 항목(나머지, planSum 큰 순) → 승인 확정 항목(광고비, 수주회)은 맨 아래
  const APPROVED_LV1_BOTTOM: Record<string, number> = { "광고비": 1, "수주회": 2 };
  allLv1.sort((a, b) => {
    const ra = APPROVED_LV1_BOTTOM[a] ?? 0;
    const rb = APPROVED_LV1_BOTTOM[b] ?? 0;
    if (ra !== rb) return ra - rb;
    const sa = (overMap.get(a)?.planSum ?? 0) + (underMap.get(a)?.planSum ?? 0);
    const sb = (overMap.get(b)?.planSum ?? 0) + (underMap.get(b)?.planSum ?? 0);
    return sb - sa;
  });

  // 좌·우 sync 토글 상태 — 기본 접힘 (사용자가 필요한 대분류만 펼침)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleLv1 = (lv1: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(lv1)) next.delete(lv1);
      else next.add(lv1);
      return next;
    });
  };

  // 좌·우 정렬 모드 (계정별=대분류 계층 / 금액순=평평한 리스트, 조정금액 큰 순)
  const [overSort, setOverSort] = useState<"byCat" | "byAmt">("byCat");
  const [underSort, setUnderSort] = useState<"byCat" | "byAmt">("byCat");

  // 금액순용 평평 리스트 (조정금액 큰 순)
  const computeOverAdjust = (i: BudgetItem) => {
    const approval = APPROVED_ADDITIONS[`${i.bu}|${i.lv1}`];
    if (approval) return approval.totalAlloc26 * 1000;
    if (APPROVED_BY_ACTUAL_LV1.has(i.lv1)) return Math.max(0, i.actual - i.planAnnual);
    if (i.verdict === "over-clear") return Math.max(0, i.projectedIfFollowPlan - i.planAnnual);
    return 0;
  };
  const overFlat = overGroups.flatMap((g) => g.items)
    .map((i) => ({ item: i, adjust: computeOverAdjust(i) }))
    .filter((x) => x.adjust > 0)
    .sort((a, b) => b.adjust - a.adjust);
  const underFlat = underGroups.flatMap((g) => g.items)
    .filter((i) => i.verdict === "under-cut")
    .map((i) => ({ item: i, adjust: Math.max(0, i.planAnnual - i.projectedIfFollowPlan) }))
    .sort((a, b) => b.adjust - a.adjust);

  const bothByCat = overSort === "byCat" && underSort === "byCat";
  // 3 섹션 그리드 (bothByCat 시 종합판정 섹션 추가) / 2 섹션 (금액순 모드)
  // min-width 설정: 각 섹션 내 GRID_TRACKS (~460px) + 종합판정(220px) 여유있게 수용, 부족시 가로 스크롤
  const outerGridCls = bothByCat
    ? "grid grid-cols-[minmax(460px,1fr)_minmax(460px,1fr)_120px_100px] min-w-[1180px]"
    : "grid grid-cols-2 min-w-[960px]";

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
      {/* 최상단 섹션 헤더 (증액 · 감축 · 종합판정) */}
      <div className={`${outerGridCls} border-b border-slate-300`}>
        <div className="flex items-center gap-2 px-4 py-2 bg-rose-100 text-rose-900 border-r-2 border-slate-400">
          <AlertCircle className="w-4 h-4 text-rose-600" />
          <h3 className="text-[13px] font-bold">{t("예산 초과", lang)}</h3>
          <span className="text-[11px] font-normal opacity-70">— {overCount}{t("개 항목 (실적+남은계획 > 연간계획)", lang)}</span>
          <SortToggle value={overSort} onChange={setOverSort} tone="rose" lang={lang} />
        </div>
        <div className={`flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-900 ${bothByCat ? "border-r-2 border-slate-400" : ""}`}>
          <TrendingDown className="w-4 h-4 text-blue-600" />
          <h3 className="text-[13px] font-bold">{t("예산 감축 검토", lang)}</h3>
          <span className="text-[11px] font-normal opacity-70">— {underCount}{t("개 항목 (실적+남은계획 < 연간계획)", lang)}</span>
          <SortToggle value={underSort} onChange={setUnderSort} tone="blue" lang={lang} />
        </div>
        {bothByCat && (
          <div className="flex items-baseline justify-center gap-1 px-2 py-2 bg-amber-100 text-amber-900 col-span-2">
            <h3 className="text-[12px] font-bold">{t("종합 판정", lang)}</h3>
            <span className="text-[10px] font-normal opacity-70">({t("대분류만", lang)})</span>
          </div>
        )}
      </div>

      {/* 컬럼 헤더 (증액 · 감축 · 종합판정) */}
      <div className={`${outerGridCls} border-b border-slate-300 text-[10.5px] text-slate-600 font-semibold bg-slate-200`}>
        <SubHeaderRow lang={lang} border="right" tone="rose" />
        <div className={bothByCat ? "border-r-2 border-slate-400" : ""}>
          <SubHeaderRow lang={lang} tone="blue" />
        </div>
        {bothByCat && (
          <>
            <div className="text-center py-1.5 bg-amber-50/60">
              <span className="text-slate-700">{t("순액 (초과−감축)", lang)}</span>
            </div>
            <div className="text-center py-1.5 bg-amber-100/60 leading-tight">
              <span className="text-slate-700">YoY</span>
              <div className="text-[9px] font-normal text-slate-500">{t("(금액,율)", lang)}</div>
            </div>
          </>
        )}
      </div>

      {/* 합계 기준 행 (증액검토·감축검토 전체 합계) */}
      {(() => {
        // 좌: over items 전체 합계 (승인은 실 승인액 우선)
        let overActual = 0, overPrevAnnual = 0, overPlanAnnual = 0, overAdjustSum = 0, overAdjAnnualSum = 0;
        for (const g of overGroups) {
          for (const it of g.items) {
            overActual += it.actual;
            overPrevAnnual += it.prevAnnualActual;
            overPlanAnnual += it.planAnnual;
            overAdjAnnualSum += it.adjustedAnnual;
            const approval = APPROVED_ADDITIONS[`${it.bu}|${it.lv1}`];
            if (approval) overAdjustSum += approval.totalAlloc26 * 1000;
            else if (APPROVED_BY_ACTUAL_LV1.has(it.lv1)) overAdjustSum += Math.max(0, it.actual - it.planAnnual);
            else if (it.verdict === "over-clear") overAdjustSum += Math.max(0, it.projectedIfFollowPlan - it.planAnnual);
          }
        }
        let underActual = 0, underPrevAnnual = 0, underPlanAnnual = 0, underAdjustSum = 0, underAdjAnnualSum = 0;
        for (const g of underGroups) {
          for (const it of g.items) {
            underActual += it.actual;
            underPrevAnnual += it.prevAnnualActual;
            underPlanAnnual += it.planAnnual;
            underAdjAnnualSum += it.adjustedAnnual;
            if (it.verdict === "under-cut") underAdjustSum += Math.max(0, it.planAnnual - it.projectedIfFollowPlan);
          }
        }
        const overAnnualPct = overPlanAnnual > 0 ? (overActual / overPlanAnnual) * 100 : 0;
        const underAnnualPct = underPlanAnnual > 0 ? (underActual / underPlanAnnual) * 100 : 0;
        const overProjYoyPct = overPrevAnnual > 0 ? (overAdjAnnualSum / overPrevAnnual) * 100 : null;
        const underProjYoyPct = underPrevAnnual > 0 ? (underAdjAnnualSum / underPrevAnnual) * 100 : null;
        return (
          <div className={`${outerGridCls} bg-slate-300/80 border-b-2 border-slate-400 font-bold text-slate-900`}>
            <TotalRow
              tone="rose"
              actual={overActual}
              annualPct={overAnnualPct}
              planAnnual={overPlanAnnual}
              adjustSum={overAdjustSum}
              projAnnual={overAdjAnnualSum}
              prevAnnual={overPrevAnnual}
              projAnnualYoyAmt={overAdjAnnualSum - overPrevAnnual}
              projAnnualYoyPct={overProjYoyPct}
              border="right"
              lang={lang}
            />
            <div className={bothByCat ? "border-r-2 border-slate-400" : ""}>
              <TotalRow
                tone="blue"
                actual={underActual}
                annualPct={underAnnualPct}
                planAnnual={underPlanAnnual}
                adjustSum={underAdjustSum}
                projAnnual={underAdjAnnualSum}
                prevAnnual={underPrevAnnual}
                projAnnualYoyAmt={underAdjAnnualSum - underPrevAnnual}
                projAnnualYoyPct={underProjYoyPct}
                lang={lang}
              />
            </div>
            {bothByCat && (() => {
              // 이 표에 표시되는 over + under 항목만 (정상 제외) — 위 좌·우 총합과 정합
              const totalAdjusted = overAdjAnnualSum + underAdjAnnualSum;
              const totalPrev = overPrevAnnual + underPrevAnnual;
              const totalYoyAmt = totalAdjusted - totalPrev;
              const totalYoyPct = totalPrev > 0 ? (totalAdjusted / totalPrev) * 100 : null;
              return (
                <>
                  <NetVerdictCell net={overAdjustSum - underAdjustSum} lang={lang} bg="bg-amber-100/60" />
                  <div className="bg-amber-100/60 flex items-center justify-center">
                    <YoyCell amount={totalYoyAmt} pct={totalYoyPct} />
                  </div>
                </>
              );
            })()}
          </div>
        );
      })()}

      {allLv1.length === 0 && overFlat.length === 0 && underFlat.length === 0 ? (
        <div className="px-4 py-6 text-[12px] text-slate-500 text-center">
          {t("검토 대상 항목이 없습니다.", lang)}
        </div>
      ) : overSort === "byCat" && underSort === "byCat" ? (
        // 둘 다 계정별 → lv1 sync 렌더링
        allLv1.map((lv1) => {
          const over = overMap.get(lv1);
          const under = underMap.get(lv1);
          const isOpen = expanded.has(lv1);
          let overSum = 0;
          let overConfirmed = false;
          for (const i of over?.items ?? []) {
            const approval = APPROVED_ADDITIONS[`${i.bu}|${i.lv1}`];
            if (approval) { overSum += approval.totalAlloc26 * 1000; overConfirmed = true; }
            else if (APPROVED_BY_ACTUAL_LV1.has(i.lv1)) { overSum += Math.max(0, i.actual - i.planAnnual); overConfirmed = true; }
            else if (i.verdict === "over-clear") overSum += Math.max(0, i.projectedIfFollowPlan - i.planAnnual);
          }
          const underSum = under?.items
            .filter((i) => i.verdict === "under-cut")
            .reduce((s, i) => s + Math.max(0, i.planAnnual - i.projectedIfFollowPlan), 0) ?? 0;
          // 종합 판정: 이 lv1 전체의 증액-감축 순액
          const netVerdict = { net: overSum - underSum };
          // 이미 승인된 항목(광고비·수주회) — 완료 처리이므로 흐리게 fade (합계행과 구분)
          const isApprovedLv1 = APPROVED_LV1_BOTTOM[lv1] !== undefined;
          const rowBg = isApprovedLv1
            ? "bg-slate-50 hover:bg-slate-100 opacity-70"
            : "bg-slate-100/70 hover:bg-slate-200/60";
          return (
            <div key={lv1} className="border-b border-slate-200 last:border-b-0">
              <button
                type="button"
                onClick={() => toggleLv1(lv1)}
                className={`w-full ${outerGridCls} ${rowBg} transition-colors text-left`}
                aria-expanded={isOpen}
              >
                <Lv1HeaderCell lv1={lv1} group={over} tone="rose" border="right" adjustSum={overSum} isOpen={isOpen} confirmed={overConfirmed} lang={lang} />
                <div className="border-r-2 border-slate-400">
                  <Lv1HeaderCell lv1={lv1} group={under} tone="blue" adjustSum={underSum} isOpen={isOpen} confirmed={false} lang={lang} />
                </div>
                <NetVerdictCell net={netVerdict.net} lang={lang} bg="bg-amber-50/60" />
                {(() => {
                  const { adjusted, prev } = combinedByLv1(lv1);
                  const yoyAmt = adjusted - prev;
                  const yoyPct = prev > 0 ? (adjusted / prev) * 100 : null;
                  return (
                    <div className="bg-amber-100/50 flex items-center justify-center">
                      {prev > 0 || adjusted > 0
                        ? <YoyCell amount={yoyAmt} pct={yoyPct} />
                        : <span className="text-[10px] text-slate-400">-</span>}
                    </div>
                  );
                })()}
              </button>
              {isOpen && (
                <div className={outerGridCls}>
                  <ItemColumn items={over?.items ?? []} tone="rose" border="right" lang={lang} />
                  <div className="border-r-2 border-slate-400">
                    <ItemColumn items={under?.items ?? []} tone="blue" lang={lang} />
                  </div>
                  <div className="bg-amber-50/60" />
                  <div className="bg-amber-100/40" />
                </div>
              )}
            </div>
          );
        })
      ) : (
        // 하나라도 금액순 → 좌·우 독립 렌더링
        <div className="grid grid-cols-2">
          <SideRender
            mode={overSort}
            groups={overGroups}
            flatItems={overFlat.map((x) => x.item)}
            tone="rose"
            border="right"
            lang={lang}
            expanded={expanded}
            onToggle={toggleLv1}
          />
          <SideRender
            mode={underSort}
            groups={underGroups}
            flatItems={underFlat.map((x) => x.item)}
            tone="blue"
            lang={lang}
            expanded={expanded}
            onToggle={toggleLv1}
          />
        </div>
      )}
    </div>
  );
}

// 좌 또는 우 한 쪽만 독립 렌더 (금액순 모드에서 사용)
function SideRender({ mode, groups, flatItems, tone, border, lang, expanded, onToggle }: {
  mode: "byCat" | "byAmt";
  groups: Lv1Group[];
  flatItems: BudgetItem[];
  tone: "rose" | "blue";
  border?: "right";
  lang: Lang;
  expanded: Set<string>;
  onToggle: (lv1: string) => void;
}) {
  if (mode === "byAmt") {
    // 조정금액 큰 순 평평 리스트 (대분류 그룹 없음)
    return (
      <div className={border === "right" ? "border-r-2 border-slate-400" : ""}>
        <ItemColumn items={flatItems} tone={tone} lang={lang} />
      </div>
    );
  }
  // 계정별 (독립 - 상대편 lv1과 sync 안 함)
  return (
    <div className={border === "right" ? "border-r-2 border-slate-400" : ""}>
      {groups.map((g) => {
        const isOpen = expanded.has(g.lv1);
        let sum = 0;
        let confirmed = false;
        for (const i of g.items) {
          if (tone === "rose") {
            const approval = APPROVED_ADDITIONS[`${i.bu}|${i.lv1}`];
            if (approval) { sum += approval.totalAlloc26 * 1000; confirmed = true; }
            else if (APPROVED_BY_ACTUAL_LV1.has(i.lv1)) { sum += Math.max(0, i.actual - i.planAnnual); confirmed = true; }
            else if (i.verdict === "over-clear") sum += Math.max(0, i.projectedIfFollowPlan - i.planAnnual);
          } else {
            if (i.verdict === "under-cut") sum += Math.max(0, i.planAnnual - i.projectedIfFollowPlan);
          }
        }
        return (
          <div key={g.lv1} className="border-b border-slate-200 last:border-b-0">
            <button
              type="button"
              onClick={() => onToggle(g.lv1)}
              className="w-full block bg-slate-100/70 hover:bg-slate-200/60 transition-colors text-left"
              aria-expanded={isOpen}
            >
              <Lv1HeaderCell lv1={g.lv1} group={g} tone={tone} adjustSum={sum} isOpen={isOpen} confirmed={confirmed} lang={lang} />
            </button>
            {isOpen && <ItemColumn items={g.items} tone={tone} lang={lang} />}
          </div>
        );
      })}
    </div>
  );
}

// 그리드 트랙: [소분류(1.2배) · 실적 · 진척률 · 연간계획 · 조정금액(+승인내역) · 조정후 연간(금액만) · 전년 연간 · YoY(금액,율)]
const GRID_TRACKS = "grid-cols-[minmax(70px,1.1fr)_54px_44px_54px_74px_72px_58px_66px]";

// 종합 판정 셀 (byCat 모드에서 3번째 섹션으로 분리)
function NetVerdictCell({ net, lang, bg }: { net: number; lang: Lang; bg?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center py-1.5 ${bg ?? ""}`}>
      {net === 0 ? (
        <span className="text-[9.5px] text-slate-400">-</span>
      ) : net > 0 ? (
        <>
          <span className="text-[11px] text-rose-600 font-bold tabular-nums">+{formatK(net)}</span>
          <span className="inline-block px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-rose-100 text-rose-700 mt-0.5">{t("초과", lang)}</span>
        </>
      ) : (
        <>
          <span className="text-[11px] text-blue-600 font-bold tabular-nums">−{formatK(Math.abs(net))}</span>
          <span className="inline-block px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-blue-100 text-blue-700 mt-0.5">{t("감축", lang)}</span>
        </>
      )}
    </div>
  );
}

function SortToggle({ value, onChange, tone, lang }: {
  value: "byCat" | "byAmt";
  onChange: (v: "byCat" | "byAmt") => void;
  tone: "rose" | "blue";
  lang: Lang;
}) {
  const activeCls = tone === "rose" ? "bg-rose-600 text-white" : "bg-blue-600 text-white";
  const idleCls = "bg-white text-slate-600 hover:bg-slate-50";
  return (
    <div className="ml-auto inline-flex rounded overflow-hidden border border-slate-300 text-[10px] font-semibold">
      <button
        type="button"
        onClick={() => onChange("byCat")}
        className={`px-2 py-0.5 ${value === "byCat" ? activeCls : idleCls}`}
      >
        {t("계정별", lang)}
      </button>
      <button
        type="button"
        onClick={() => onChange("byAmt")}
        className={`px-2 py-0.5 border-l border-slate-300 ${value === "byAmt" ? activeCls : idleCls}`}
      >
        {t("금액순", lang)}
      </button>
    </div>
  );
}

function TotalRow({ tone, actual, annualPct, planAnnual, adjustSum, projAnnual, prevAnnual, projAnnualYoyAmt, projAnnualYoyPct, border, lang }: {
  tone: "rose" | "blue";
  actual: number;
  annualPct: number;
  planAnnual: number;
  adjustSum: number;
  projAnnual: number;
  prevAnnual: number;
  projAnnualYoyAmt: number;
  projAnnualYoyPct: number | null;
  border?: "right";
  lang: Lang;
}) {
  const adjustCls = tone === "rose" ? "text-rose-700" : "text-blue-700";
  const amtCls = tone === "rose" ? "text-rose-800" : "text-blue-800";
  return (
    <div className={`grid ${GRID_TRACKS} gap-1 px-3 py-1.5 items-center ${border === "right" ? "border-r-2 border-slate-400" : ""}`}>
      <div className="text-[12px] font-bold text-slate-900 truncate">{t("합계", lang)}</div>
      <div className="text-[11px] text-right text-slate-800 tabular-nums font-semibold">{formatK(actual)}</div>
      <div className="text-[11px] text-right text-slate-700 tabular-nums font-semibold">{formatPercent(annualPct, 0)}</div>
      <div className="text-[11px] text-right text-slate-600 tabular-nums">{formatK(planAnnual)}</div>
      <div className={`text-[11px] text-right font-bold tabular-nums -my-1.5 py-1.5 pr-1.5 ${adjustCls} ${tone === "rose" ? "bg-rose-100/60" : "bg-blue-100/60"}`}>
        {adjustSum > 0 ? `${tone === "rose" ? "+" : "−"}${formatK(adjustSum)}` : "-"}
      </div>
      <div className={`text-[11px] text-right font-bold tabular-nums ${amtCls}`}>{formatK(projAnnual)}</div>
      <div className="text-[11px] text-right text-slate-600 tabular-nums">{formatK(prevAnnual)}</div>
      <div className={`-my-1.5 py-1.5 ${tone === "rose" ? "bg-rose-50/60" : "bg-blue-50/60"}`}>
        <YoyCell amount={projAnnualYoyAmt} pct={projAnnualYoyPct} />
      </div>
    </div>
  );
}

// YoY 셀 (금액 + 율 2줄)
function YoyCell({ amount, pct }: { amount: number; pct: number | null }) {
  const cls = amount >= 0 ? "text-rose-600" : "text-blue-600";
  return (
    <div className="text-center leading-tight">
      <div className={`text-[11px] font-semibold tabular-nums ${cls}`}>
        {amount >= 0 ? "+" : "−"}{formatK(Math.abs(amount))}
      </div>
      <div className={`text-[9.5px] tabular-nums ${cls}`}>{pct != null ? formatPercent(pct, 0) : "-"}</div>
    </div>
  );
}

function SubHeaderRow({ lang, border, tone }: { lang: Lang; border?: "right"; tone: "rose" | "blue" }) {
  return (
    <div className={`grid ${GRID_TRACKS} gap-1 px-3 py-1.5 ${border === "right" ? "border-r-2 border-slate-400" : ""}`}>
      <div className="text-center truncate">{t("소분류", lang)}</div>
      <div className="text-center">{t("실적", lang)}</div>
      <div className="text-center">{t("진척률", lang)}</div>
      <div className="text-center">{t("연간계획", lang)}</div>
      <div className={`text-center -my-1.5 py-1.5 ${tone === "rose" ? "text-rose-800 bg-rose-100/60" : "text-blue-800 bg-blue-100/60"}`}>
        {tone === "rose" ? t("초과예상", lang) : t("감축가능(예상)", lang)}
      </div>
      <div className={`text-center leading-tight ${tone === "rose" ? "text-rose-700" : "text-blue-700"}`}>
        {tone === "rose" ? t("예산초과 후 연간", lang) : t("감축 후 연간", lang)}
      </div>
      <div className="text-center">{t("전년 연간", lang)}</div>
      <div className={`text-center leading-tight -my-1.5 py-1.5 ${tone === "rose" ? "bg-rose-50/60" : "bg-blue-50/60"}`}>
        YoY<br />
        <span className="text-[9px] opacity-70">({t("금액", lang)}, {t("율", lang)})</span>
      </div>
    </div>
  );
}

function Lv1HeaderCell({ lv1, group, tone, border, adjustSum, isOpen, confirmed, lang }: {
  lv1: string;
  group?: Lv1Group;
  tone: "rose" | "blue";
  border?: "right";
  adjustSum?: number;
  isOpen?: boolean;
  confirmed?: boolean;
  lang: Lang;
}) {
  const ratioCls = tone === "rose" ? "text-rose-600" : "text-blue-600";
  return (
    <div className={`grid ${GRID_TRACKS} gap-1 px-3 py-1.5 items-center ${border === "right" ? "border-r-2 border-slate-400" : ""}`}>
      <div className="text-[12px] font-bold text-slate-800 truncate flex items-center gap-1">
        {isOpen != null && (
          isOpen
            ? <ChevronDown className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
            : <ChevronRight className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
        )}
        <span className="truncate">{lv1 ? t(lv1, lang) : "-"}</span>
      </div>
      {group ? (
        <>
          <div className="text-[11px] text-right text-slate-700 tabular-nums">{formatK(group.actualSum)}</div>
          <div className={`text-[11px] text-right font-semibold tabular-nums ${ratioCls}`}>{formatPercent(group.usagePct, 0)}</div>
          <div className="text-[11px] text-right text-slate-500 tabular-nums">{formatK(group.planSum)}</div>
          <div className={`flex flex-col items-end justify-center -my-1.5 py-1.5 pr-1.5 ${tone === "rose" ? "bg-rose-100/60" : "bg-blue-100/60"}`}>
            <div className={`text-[11px] text-right font-bold tabular-nums ${ratioCls}`}>
              {adjustSum != null && adjustSum > 0 ? `${tone === "rose" ? "+" : "−"}${formatK(adjustSum)}` : "-"}
            </div>
            {confirmed && <div className="text-[9px] text-emerald-700 font-semibold">✔ {t("확정", lang)}</div>}
          </div>
          <div className={`text-[11px] text-right font-bold tabular-nums ${tone === "rose" ? "text-rose-800" : "text-blue-800"}`}>
            {formatK(group.adjustedAnnualSum)}
          </div>
          <div className="text-[11px] text-right text-slate-600 tabular-nums">{formatK(group.prevAnnualActualSum)}</div>
          <div className={`-my-1.5 py-1.5 ${tone === "rose" ? "bg-rose-50/60" : "bg-blue-50/60"}`}>
            <YoyCell amount={group.projAnnualYoyAmountSum} pct={group.projAnnualYoyPctSum} />
          </div>
        </>
      ) : (
        <div className="col-span-7 text-[10.5px] text-slate-400 italic text-right">— {tone === "rose" ? t("초과 없음", lang) : t("감축 대상 없음", lang)}</div>
      )}
    </div>
  );
}

const VERDICT_STYLE: Record<Verdict, { bg: string; text: string; labelKey: string }> = {
  "over-clear": { bg: "bg-rose-100", text: "text-rose-800", labelKey: "예산 초과" },
  "under-cut":  { bg: "bg-blue-100", text: "text-blue-800", labelKey: "감축 가능" },
  normal:       { bg: "bg-emerald-50", text: "text-emerald-700", labelKey: "정상" },
};

function ItemColumn({ items, tone, border, lang }: {
  items: BudgetItem[];
  tone: "rose" | "blue";
  border?: "right";
  lang: Lang;
}) {
  void lang;
  const deltaCls = tone === "rose" ? "text-rose-600" : "text-blue-600";
  if (items.length === 0) {
    return (
      <div className={`px-3 py-2 text-[10.5px] text-slate-400 italic ${border === "right" ? "border-r-2 border-slate-400" : ""}`}>
        —
      </div>
    );
  }
  const ratioCls = tone === "rose" ? "text-rose-600" : "text-blue-600";
  return (
    <div className={`${border === "right" ? "border-r-2 border-slate-400" : ""}`}>
      {items.map((it) => {
        // 승인 오버라이드 매칭 (예: DISCOVERY 광고비)
        const approvalKey = `${it.bu}|${it.lv1}`;
        const approval = APPROVED_ADDITIONS[approvalKey];
        // 실사용액 승인 대분류 (예: 수주회)
        const isApprovedByActual = APPROVED_BY_ACTUAL_LV1.has(it.lv1);

        const vs = VERDICT_STYLE[it.verdict];
        const rawAdjust = tone === "rose"
          ? it.projectedIfFollowPlan - it.planAnnual
          : it.planAnnual - it.projectedIfFollowPlan;
        const showAdjust = (tone === "rose" && it.verdict === "over-clear") || (tone === "blue" && it.verdict === "under-cut");
        const adjust = showAdjust ? Math.max(0, rawAdjust) : 0;
        // 실사용액 승인 항목의 조정금액 = actual - planAnnual (초과분)
        const actualApprovalAmt = isApprovedByActual ? Math.max(0, it.actual - it.planAnnual) : 0;
        return (
          <div key={it.key} className={`grid ${GRID_TRACKS} gap-1 px-3 py-1 items-start border-t border-slate-100 hover:bg-slate-50/50`}>
            <div className="text-[11px] text-slate-600 truncate pl-3 pt-0.5" title={it.subLabel}>
              {(() => {
                // 렌더 시점에 lang 반영 (LV2_FIRST_LV1이면 lv2 → bu 순서)
                const parts = LV2_FIRST_LV1.has(it.lv1)
                  ? [it.lv2, it.bu, it.lv3]
                  : [it.bu, it.lv2, it.lv3];
                const localized = parts.filter(Boolean).map((p) => t(p, lang));
                return localized.join(" · ") || "-";
              })()}
            </div>
            <div className="text-[11px] text-right text-slate-700 tabular-nums pt-0.5">{formatK(it.actual)}</div>
            <div className={`text-[11px] text-right font-semibold tabular-nums pt-0.5 ${ratioCls}`}>{formatPercent(it.annualPct, 0)}</div>
            <div className="text-[11px] text-right text-slate-500 tabular-nums pt-0.5">{formatK(it.planAnnual)}</div>
            {/* 조정금액 셀 — 금액 위, 승인표/확정 배지 아래 */}
            <div className="flex flex-col items-stretch">
              <div className={`text-[11px] text-right font-bold tabular-nums pt-0.5 ${ratioCls}`}>
                {approval
                  ? `+${approval.totalAlloc26.toLocaleString()}K`
                  : isApprovedByActual
                  ? (actualApprovalAmt > 0 ? `+${formatK(actualApprovalAmt)}` : "-")
                  : (adjust > 0 ? `${tone === "rose" ? "+" : "−"}${formatK(adjust)}` : "-")}
              </div>
              {approval && (
                <div className="mt-0.5 space-y-0.5">
                  <span className="inline-block px-1 py-0.5 rounded text-[9px] font-semibold bg-emerald-100 text-emerald-800" title={approval.note}>
                    {t("✔ 추가 사용 승인", lang)}
                  </span>
                  <table className="w-full text-[9px] border border-emerald-200 border-collapse mt-0.5">
                    <thead className="bg-emerald-100/70">
                      <tr>
                        <th className="px-1 py-0 border border-emerald-200 text-center text-emerald-900 font-semibold leading-tight">{t("항목", lang)}</th>
                        <th className="px-1 py-0 border border-emerald-200 text-center text-emerald-900 font-semibold leading-tight">
                          <div>{t("MKT 추가승인", lang)}</div>
                          <div className="text-[8px] font-normal text-emerald-700">(26.08~27.07)</div>
                        </th>
                        <th className="px-1 py-0 border border-emerald-200 text-center text-emerald-900 font-semibold leading-tight">{t("26년 배분", lang)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {approval.items.map((row) => (
                        <tr key={row.name}>
                          <td className="px-1 py-0 border border-emerald-100 text-emerald-900">{row.name}</td>
                          <td className="px-1 py-0 border border-emerald-100 text-right text-emerald-800 tabular-nums">{row.mkt.toLocaleString()}K</td>
                          <td className="px-1 py-0 border border-emerald-100 text-right text-emerald-900 tabular-nums font-semibold">{row.alloc26.toLocaleString()}K</td>
                        </tr>
                      ))}
                      <tr className="bg-emerald-50 font-bold">
                        <td className="px-1 py-0 border border-emerald-100 text-emerald-900">{t("합계", lang)}</td>
                        <td className="px-1 py-0 border border-emerald-100 text-right text-emerald-800 tabular-nums">{approval.totalMkt.toLocaleString()}K</td>
                        <td className="px-1 py-0 border border-emerald-100 text-right text-emerald-900 tabular-nums">{approval.totalAlloc26.toLocaleString()}K</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              {!approval && isApprovedByActual && (
                <div className="mt-0.5 text-right">
                  <span className="inline-block px-1 py-0.5 rounded text-[9px] font-semibold bg-emerald-100 text-emerald-800" title={it.conclusion}>
                    {t("✔ 확정", lang)}
                  </span>
                </div>
              )}
            </div>
            {/* 예산초과 후 연간 (금액만) */}
            <div className={`text-[11px] text-right font-bold tabular-nums pt-0.5 ${tone === "rose" ? "text-rose-800" : "text-blue-800"}`}>
              {formatK(it.adjustedAnnual)}
            </div>
            {/* 전년 연간 */}
            <div className="text-[11px] text-right text-slate-600 tabular-nums pt-0.5">{formatK(it.prevAnnualActual)}</div>
            {/* YoY */}
            <div className="pt-0.5"><YoyCell amount={it.projAnnualYoyAmount} pct={it.projAnnualYoyPct} /></div>
          </div>
        );
      })}
    </div>
  );
}

function BudgetSection({
  icon, title, subtitle, tone, groups, emptyMsg, lang,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  tone: "rose" | "blue" | "emerald";
  groups: Lv1Group[];
  emptyMsg: string;
  lang: Lang;
}) {
  const toneCls = {
    rose: { border: "border-l-rose-500", head: "bg-rose-50 text-rose-900", lv1Bg: "bg-rose-50/50", delta: "text-rose-600" },
    blue: { border: "border-l-blue-500", head: "bg-blue-50 text-blue-900", lv1Bg: "bg-blue-50/50", delta: "text-blue-600" },
    emerald: { border: "border-l-emerald-500", head: "bg-emerald-50 text-emerald-900", lv1Bg: "bg-emerald-50/50", delta: "text-slate-600" },
  }[tone];

  // lv1 접기/펼침 상태 - 정상 진행은 기본 접힘 (참고용이라 클릭 시 펼침)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleLv1 = (lv1: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(lv1)) next.delete(lv1);
      else next.add(lv1);
      return next;
    });
  };

  return (
    <div className={`rounded-lg border border-slate-200 border-l-4 ${toneCls.border} bg-white flex flex-col`}>
      <div className={`flex items-center gap-2 px-4 py-2 ${toneCls.head} rounded-tr-lg`}>
        {icon}
        <h3 className="text-[13px] font-bold">{title}</h3>
        <span className="text-[11px] font-normal opacity-70">— {subtitle}</span>
      </div>
      {groups.length === 0 ? (
        <div className="px-4 py-4 text-[12px] text-slate-500 text-center">{emptyMsg}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11.5px]">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr className="whitespace-nowrap">
                <th className="text-center font-semibold px-3 py-1.5">{t("대분류 / 소분류", lang)}</th>
                <th className="text-center font-semibold px-2 py-1.5">{t("실적", lang)}</th>
                <th className="text-center font-semibold px-2 py-1.5">{t("진척률", lang)}</th>
                <th className="text-center font-semibold px-2 py-1.5">{t("연간계획", lang)}</th>
                <th className="text-center font-semibold px-2 py-1.5">{t("예상소진", lang)}</th>
                <th className="text-center font-semibold px-2 py-1.5">{t("전년 연간", lang)}</th>
                <th className="text-center font-semibold px-2 py-1.5 leading-tight">
                  YoY<br /><span className="text-[9px] opacity-70">({t("금액", lang)}, {t("율", lang)})</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const isOpen = expanded.has(g.lv1);
                return (
                <Fragment key={`lv1-${g.lv1}`}>
                  {/* lv1 헤더 행 — 클릭 시 토글 */}
                  <tr
                    className={`${toneCls.lv1Bg} font-bold text-slate-800 cursor-pointer hover:bg-slate-100`}
                    onClick={() => toggleLv1(g.lv1)}
                  >
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-1">
                        {isOpen
                          ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                          : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
                        {g.lv1 ? t(g.lv1, lang) : "-"}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatK(g.actualSum)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatPercent(g.usagePct, 0)}</td>
                    <td className="px-2 py-1.5 text-right text-slate-500 tabular-nums">{formatK(g.planSum)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatPercent(g.projectedPct, 0)}</td>
                    <td className="px-2 py-1.5 text-right text-slate-600 tabular-nums">{formatK(g.prevAnnualActualSum)}</td>
                    <td className="px-2 py-1.5"><YoyCell amount={g.projAnnualYoyAmountSum} pct={g.projAnnualYoyPctSum} /></td>
                  </tr>
                  {/* 하위 소분류 (한 칸 들여쓰기) — 펼침 시에만 노출 */}
                  {isOpen && g.items.map((item) => {
                    return (
                      <tr key={item.key} className="border-b border-slate-100 hover:bg-slate-50/50">
                        <td className="px-3 py-1 pl-6 text-slate-600">
                          {(() => {
                            const parts = LV2_FIRST_LV1.has(item.lv1)
                              ? [item.lv2, item.bu, item.lv3]
                              : [item.bu, item.lv2, item.lv3];
                            const localized = parts.filter(Boolean).map((p) => t(p, lang));
                            return localized.join(" · ") || "-";
                          })()}
                        </td>
                        <td className="px-2 py-1 text-right text-slate-700 tabular-nums">{formatK(item.actual)}</td>
                        <td className="px-2 py-1 text-right font-semibold tabular-nums">{formatPercent(item.annualPct, 0)}</td>
                        <td className="px-2 py-1 text-right text-slate-500 tabular-nums">{formatK(item.planAnnual)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{formatPercent(item.projectedPct, 0)}</td>
                        <td className="px-2 py-1 text-right text-slate-600 tabular-nums">{formatK(item.prevAnnualActual)}</td>
                        <td className="px-2 py-1"><YoyCell amount={item.projAnnualYoyAmount} pct={item.projAnnualYoyPct} /></td>
                      </tr>
                    );
                  })}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
