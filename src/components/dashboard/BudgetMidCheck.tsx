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
import { getCategoryDetail, type BizUnit } from "@/lib/expenseData";
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

// 인건비는 브랜드 하위 lv2 (기본급/성과급/성과급충당금/퇴사보상금 등)까지 확인 필요
// — 성과급충당금은 쌓았다가 연말 차감되므로 성과급/기본급 구분이 중요
const BU_LV2_ONLY = new Set(["인건비"]);

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

  const { overGroups, underGroups, onTrackGroups, expectedPace, totals, overCount, underCount } = useMemo(() => {
    // 3개 소스: 연간 계획 · YTD 계획 · YTD 실적
    const planAnnualItems = getCategoryDetail(bizUnit, year, 12, "", "ytd", "plan");
    const planYtdItems = getCategoryDetail(bizUnit, year, month, "", "ytd", "plan");
    const actualItems = getCategoryDetail(bizUnit, year, month, "", "ytd", "actual");

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

    const expectedPace = (month / 12) * 100;
    const items: BudgetItem[] = [];
    for (const k of infoMap.keys()) {
      const planAnnual = planAnnualMap.get(k) || 0;
      const planYtd = planYtdMap.get(k) || 0;
      const actual = actualMap.get(k) || 0;
      if (planAnnual <= 0) continue;
      const info = infoMap.get(k)!;
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
      const hasApproval = !!APPROVED_ADDITIONS[`${info.bu}|${info.lv1}`];
      const isApprovedByActual = APPROVED_BY_ACTUAL_LV1.has(info.lv1);
      const verdict: Verdict = (hasApproval || isApprovedByActual) ? "over-clear" : raw.verdict;
      const conclusion = hasApproval
        ? t("추가 사용 승인 완료 (실 승인액 반영)", lang)
        : isApprovedByActual
        ? t("이미 발생 완료 · 승인 완료", lang)
        : raw.conclusion;
      items.push({
        key: k, bu: info.bu, lv1: info.lv1, lv2: info.lv2, lv3: info.lv3, subLabel,
        actual, planYtd, planAnnual,
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
        const usagePct = planSum > 0 ? (actualSum / planSum) * 100 : 0;
        const ytdRatio = planYtdSum > 0 ? (actualSum / planYtdSum) * 100 : 0;
        const planRemaining = Math.max(0, planSum - planYtdSum);
        const projectedIfFollowPlan = actualSum + planRemaining;
        const projectedPct = planSum > 0 ? (projectedIfFollowPlan / planSum) * 100 : 0;
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
        return { lv1, planSum, planYtdSum, actualSum, usagePct, ytdRatio, projectedPct, deltaP, items: its };
      });
    };

    const overGroups = groupByLv1(overItems).sort((a, b) => (b.actualSum - b.planYtdSum) - (a.actualSum - a.planYtdSum));
    const underGroups = groupByLv1(underItems).sort((a, b) => (b.planSum - b.actualSum - b.planYtdSum) - (a.planSum - a.actualSum - a.planYtdSum));
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

    return {
      overGroups,
      underGroups,
      onTrackGroups,
      expectedPace,
      totals,
      overCount: overItems.length,
      underCount: underItems.length,
    };
  }, [bizUnit, year, month]);

  return (
    <div className="space-y-4">
      {/* 헤더 요약 */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-baseline gap-2 mb-1">
          <h2 className="text-[19px] font-bold tracking-tight text-slate-900">
            {t(bizUnit, lang)} · {t("예산 중간점검", lang)}
          </h2>
          <span className="text-[11px] text-slate-500">
            {year}년 {month}월 YTD · 예상 진척률 <b className="text-slate-700">{expectedPace.toFixed(0)}%</b>
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3">
          {/* 순서: 추가 증액 검토 · 감축 예상 · 증액 승인완료 · 총 예산(원계획) · 조정후 총예산 */}
          <SummaryBox
            label={t("추가 증액 검토", lang)}
            value={`+${formatK(totals.reviewAmount)}`}
            sub={`${overCount}${t("개 항목", lang)}`}
            tone="rose"
            emphasize
          />
          <SummaryBox
            label={t("감축 예상", lang)}
            value={`−${formatK(totals.underAmount)}`}
            sub={`${underCount}${t("개 항목 · 남은 계획 소진 시 여유", lang)}`}
            tone="blue"
            emphasize
          />
          <SummaryBox
            label={t("증액 승인완료", lang)}
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
        <div className="mt-3 grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-2">
          {/* 좌: 판정 기준 */}
          <p className="text-[11px] text-gray-600 bg-amber-50 border-l-4 border-amber-400 px-3 py-2 rounded leading-snug">
            {lang === "zh" ? (
              <>
                ※ <b>预计消耗 = (实绩 + 剩余月计划金额) / 年度预算</b>. 剩余计划 = 年度预算 − YTD 计划 (若计划已全部消耗则为 0).
                <br />
                <b>≥ 102% → 需要增加</b>, <b>≤ 95% → 可减少</b>, <b className="text-blue-600">中间(95~102%)按误差范围视为正常.</b>
                <br />
                <b>广告费·内饰开发</b>汇总至品牌, <b>人工费</b>汇总至品牌×lv2(基本工资/绩效奖金/绩效奖金准备金), <b>车辆租赁费·租金</b>仅按大分类判定.
              </>
            ) : (
              <>
                ※ <b>예상소진 = (실적 + 남은 개월 계획금액) / 연간계획</b>. 남은 계획 = 연간계획 − YTD계획 (이미 다 소진했으면 0).
                <br />
                <b>≥ 102% → 증액 필요</b>, <b>≤ 95% → 감축 가능</b>, <b className="text-blue-600">그 사이(95~102%)는 오차 범위로 정상.</b>
                <br />
                <b>광고비·인테리어개발</b>은 브랜드까지, <b>인건비</b>는 브랜드×lv2(기본급/성과급/성과급충당금)까지, <b>차량렌트비·임차료</b>는 대분류만.
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
          subtitle={`${onTrackGroups.reduce((s, g) => s + g.items.length, 0)}${t("개 · 예산 규모 상위 대분류", lang)}`}
          tone="emerald"
          groups={onTrackGroups.slice(0, 4)}
          emptyMsg={t("정상 진행 항목이 없습니다.", lang)}
          lang={lang as Lang}
        />
        <div />
      </div>
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
    <div className={`${emphasize ? "border-2" : "border"} rounded-md px-3 py-2 ${cls}`}>
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
  const allLv1 = Array.from(new Set([...overMap.keys(), ...underMap.keys()]));
  // 정렬: (초과 planSum + 감축 planSum) 큰 순
  allLv1.sort((a, b) => {
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
  const outerGridCls = bothByCat ? "grid grid-cols-[1fr_1fr_128px]" : "grid grid-cols-2";

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      {/* 최상단 섹션 헤더 (증액 · 감축 · 종합판정) */}
      <div className={`${outerGridCls} border-b border-slate-200`}>
        <div className="flex items-center gap-2 px-4 py-2 bg-rose-50 text-rose-900 border-r border-slate-200">
          <AlertCircle className="w-4 h-4 text-rose-600" />
          <h3 className="text-[13px] font-bold">{t("예산 증액 검토", lang)}</h3>
          <span className="text-[11px] font-normal opacity-70">— {overCount}{t("개 항목 (실적+남은계획 > 연간계획)", lang)}</span>
          <SortToggle value={overSort} onChange={setOverSort} tone="rose" lang={lang} />
        </div>
        <div className={`flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-900 ${bothByCat ? "border-r-2 border-slate-400" : ""}`}>
          <TrendingDown className="w-4 h-4 text-blue-600" />
          <h3 className="text-[13px] font-bold">{t("예산 감축 검토", lang)}</h3>
          <span className="text-[11px] font-normal opacity-70">— {underCount}{t("개 항목 (실적+남은계획 < 연간계획)", lang)}</span>
          <SortToggle value={underSort} onChange={setUnderSort} tone="blue" lang={lang} />
        </div>
        {bothByCat && (
          <div className="flex items-center justify-center gap-1 px-2 py-2 bg-amber-50 text-amber-900">
            <h3 className="text-[12px] font-bold">{t("종합 판정", lang)}</h3>
          </div>
        )}
      </div>

      {/* 컬럼 헤더 (증액 · 감축 · 종합판정) */}
      <div className={`${outerGridCls} border-b border-slate-200 text-[10.5px] text-slate-500 font-semibold bg-slate-50`}>
        <SubHeaderRow lang={lang} border="right" tone="rose" />
        <div className={bothByCat ? "border-r-2 border-slate-400" : ""}>
          <SubHeaderRow lang={lang} tone="blue" />
        </div>
        {bothByCat && (
          <div className="text-center py-1.5 bg-amber-50/60">
            <span className="text-slate-700">{t("순액 (증액−감축)", lang)}</span>
          </div>
        )}
      </div>

      {/* 합계 기준 행 (증액검토·감축검토 전체 합계) */}
      {(() => {
        // 좌: over items 전체 합계 (승인은 실 승인액 우선)
        let overActual = 0, overPlanAnnual = 0, overAdjustSum = 0;
        for (const g of overGroups) {
          for (const it of g.items) {
            overActual += it.actual;
            overPlanAnnual += it.planAnnual;
            const approval = APPROVED_ADDITIONS[`${it.bu}|${it.lv1}`];
            if (approval) overAdjustSum += approval.totalAlloc26 * 1000;
            else if (APPROVED_BY_ACTUAL_LV1.has(it.lv1)) overAdjustSum += Math.max(0, it.actual - it.planAnnual);
            else if (it.verdict === "over-clear") overAdjustSum += Math.max(0, it.projectedIfFollowPlan - it.planAnnual);
          }
        }
        let underActual = 0, underPlanAnnual = 0, underAdjustSum = 0;
        for (const g of underGroups) {
          for (const it of g.items) {
            underActual += it.actual;
            underPlanAnnual += it.planAnnual;
            if (it.verdict === "under-cut") underAdjustSum += Math.max(0, it.planAnnual - it.projectedIfFollowPlan);
          }
        }
        const overAnnualPct = overPlanAnnual > 0 ? (overActual / overPlanAnnual) * 100 : 0;
        const underAnnualPct = underPlanAnnual > 0 ? (underActual / underPlanAnnual) * 100 : 0;
        return (
          <div className={`${outerGridCls} bg-slate-100/80 border-b border-slate-200 font-bold text-slate-800`}>
            <TotalRow
              tone="rose"
              actual={overActual}
              annualPct={overAnnualPct}
              planAnnual={overPlanAnnual}
              adjustSum={overAdjustSum}
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
                lang={lang}
              />
            </div>
            {bothByCat && (
              <NetVerdictCell net={overAdjustSum - underAdjustSum} lang={lang} bg="bg-amber-100/60" />
            )}
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
          return (
            <div key={lv1} className="border-b border-slate-200 last:border-b-0">
              <button
                type="button"
                onClick={() => toggleLv1(lv1)}
                className={`w-full ${outerGridCls} bg-slate-100/70 hover:bg-slate-200/60 transition-colors text-left`}
                aria-expanded={isOpen}
              >
                <Lv1HeaderCell lv1={lv1} group={over} tone="rose" border="right" adjustSum={overSum} isOpen={isOpen} confirmed={overConfirmed} lang={lang} />
                <div className="border-r-2 border-slate-400">
                  <Lv1HeaderCell lv1={lv1} group={under} tone="blue" adjustSum={underSum} isOpen={isOpen} confirmed={false} lang={lang} />
                </div>
                <NetVerdictCell net={netVerdict.net} lang={lang} bg="bg-amber-50/60" />
              </button>
              {isOpen && (
                <div className={outerGridCls}>
                  <ItemColumn items={over?.items ?? []} tone="rose" border="right" lang={lang} />
                  <div className="border-r-2 border-slate-400">
                    <ItemColumn items={under?.items ?? []} tone="blue" lang={lang} />
                  </div>
                  <div className="bg-amber-50/60" />
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
      <div className={border === "right" ? "border-r border-slate-200" : ""}>
        <ItemColumn items={flatItems} tone={tone} lang={lang} />
      </div>
    );
  }
  // 계정별 (독립 - 상대편 lv1과 sync 안 함)
  return (
    <div className={border === "right" ? "border-r border-slate-200" : ""}>
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

// 그리드 5+1 트랙: [소분류(1.2배) · 실적 · 진척률 · 연간계획 · 조정금액 · 결론(축소)]
const GRID_TRACKS = "grid-cols-[minmax(0,1.2fr)_64px_54px_64px_70px_minmax(80px,0.85fr)]";

// 종합 판정 셀 (byCat 모드에서 3번째 섹션으로 분리)
function NetVerdictCell({ net, lang, bg }: { net: number; lang: Lang; bg?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center py-1.5 ${bg ?? ""}`}>
      {net === 0 ? (
        <span className="text-[9.5px] text-slate-400">-</span>
      ) : net > 0 ? (
        <>
          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">{t("증액", lang)}</span>
          <span className="text-[10px] text-rose-600 font-semibold tabular-nums mt-0.5">+{formatK(net)}</span>
        </>
      ) : (
        <>
          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">{t("감축", lang)}</span>
          <span className="text-[10px] text-blue-600 font-semibold tabular-nums mt-0.5">−{formatK(Math.abs(net))}</span>
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

function TotalRow({ tone, actual, annualPct, planAnnual, adjustSum, border, lang }: {
  tone: "rose" | "blue";
  actual: number;
  annualPct: number;
  planAnnual: number;
  adjustSum: number;
  border?: "right";
  lang: Lang;
}) {
  const adjustCls = tone === "rose" ? "text-rose-700" : "text-blue-700";
  return (
    <div className={`grid ${GRID_TRACKS} gap-1 px-3 py-1.5 items-center ${border === "right" ? "border-r border-slate-200" : ""}`}>
      <div className="text-[12px] font-bold text-slate-900 truncate">{t("합계", lang)}</div>
      <div className="text-[11px] text-right text-slate-800 tabular-nums font-semibold">{formatK(actual)}</div>
      <div className="text-[11px] text-right text-slate-700 tabular-nums font-semibold">{formatPercent(annualPct, 0)}</div>
      <div className="text-[11px] text-right text-slate-600 tabular-nums">{formatK(planAnnual)}</div>
      <div className={`text-[11px] text-right font-bold tabular-nums ${adjustCls}`}>
        {adjustSum > 0 ? `${tone === "rose" ? "+" : "−"}${formatK(adjustSum)}` : "-"}
      </div>
      <div />
    </div>
  );
}

function SubHeaderRow({ lang, border, tone }: { lang: Lang; border?: "right"; tone: "rose" | "blue" }) {
  return (
    <div className={`grid ${GRID_TRACKS} gap-1 px-3 py-1.5 ${border === "right" ? "border-r border-slate-200" : ""}`}>
      <div className="text-center truncate">{t("소분류", lang)}</div>
      <div className="text-center">{t("실적", lang)}</div>
      <div className="text-center">{t("진척률", lang)}</div>
      <div className="text-center">{t("연간계획", lang)}</div>
      <div className={`text-center ${tone === "rose" ? "text-rose-700" : "text-blue-700"}`}>
        {tone === "rose" ? t("증액예상", lang) : t("감축예상", lang)}
      </div>
      <div className="text-center">{t("결론", lang)}</div>
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
    <div className={`grid ${GRID_TRACKS} gap-1 px-3 py-1.5 items-center ${border === "right" ? "border-r border-slate-200" : ""}`}>
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
          <div className={`text-[11px] text-right font-bold tabular-nums ${ratioCls}`}>
            {adjustSum != null && adjustSum > 0 ? `${tone === "rose" ? "+" : "−"}${formatK(adjustSum)}` : "-"}
          </div>
          <div className={`text-[10px] ${confirmed ? "text-emerald-700 font-semibold" : "text-slate-500"}`}>
            {confirmed ? `✔ ${t("확정", lang)}` : `${formatPercent(group.projectedPct, 0)} ${t("예상", lang)}`}
          </div>
        </>
      ) : (
        <div className="col-span-5 text-[10.5px] text-slate-400 italic text-right">— {tone === "rose" ? t("초과 없음", lang) : t("감축 대상 없음", lang)}</div>
      )}
    </div>
  );
}

const VERDICT_STYLE: Record<Verdict, { bg: string; text: string; labelKey: string }> = {
  "over-clear": { bg: "bg-rose-100", text: "text-rose-800", labelKey: "증액 검토" },
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
      <div className={`px-3 py-2 text-[10.5px] text-slate-400 italic ${border === "right" ? "border-r border-slate-200" : ""}`}>
        —
      </div>
    );
  }
  const ratioCls = tone === "rose" ? "text-rose-600" : "text-blue-600";
  return (
    <div className={`${border === "right" ? "border-r border-slate-200" : ""}`}>
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
            <div className={`text-[11px] text-right font-bold tabular-nums pt-0.5 ${ratioCls}`}>
              {approval
                ? `+${approval.totalAlloc26.toLocaleString()}K`
                : isApprovedByActual
                ? (actualApprovalAmt > 0 ? `+${formatK(actualApprovalAmt)}` : "-")
                : (adjust > 0 ? `${tone === "rose" ? "+" : "−"}${formatK(adjust)}` : "-")}
            </div>
            <div className="text-center">
              {approval ? (
                <div className="space-y-0.5">
                  <span className="inline-block px-1.5 py-0.5 rounded text-[9.5px] font-semibold bg-emerald-100 text-emerald-800" title={approval.note}>
                    {t("✔ 추가 사용 승인", lang)}
                  </span>
                  {/* 승인 내역 미니 표 */}
                  <table className="w-full text-[9.5px] border border-emerald-200 border-collapse mt-0.5">
                    <thead className="bg-emerald-100/70">
                      <tr>
                        <th className="px-1 py-0.5 border border-emerald-200 text-center text-emerald-900 font-semibold leading-tight">{t("항목", lang)}</th>
                        <th className="px-1 py-0.5 border border-emerald-200 text-center text-emerald-900 font-semibold leading-tight">
                          <div>{t("MKT 추가승인", lang)}</div>
                          <div className="text-[8.5px] font-normal text-emerald-700">(26.08~27.07)</div>
                        </th>
                        <th className="px-1 py-0.5 border border-emerald-200 text-center text-emerald-900 font-semibold leading-tight">{t("26년 배분", lang)}</th>
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
              ) : isApprovedByActual ? (
                <span className="inline-block px-1.5 py-0.5 rounded text-[9.5px] font-semibold bg-emerald-100 text-emerald-800" title={it.conclusion}>
                  {t("✔ 확정", lang)}
                </span>
              ) : (
                <span className={`inline-block px-1.5 py-0.5 rounded text-[9.5px] font-semibold ${vs.bg} ${vs.text}`} title={it.conclusion}>
                  {t(vs.labelKey, lang)}
                </span>
              )}
            </div>
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
                <th className="text-center font-semibold px-2 py-1.5">{t("결론", lang)}</th>
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
                    <td className="px-2 py-1.5" />
                  </tr>
                  {/* 하위 소분류 (한 칸 들여쓰기) — 펼침 시에만 노출 */}
                  {isOpen && g.items.map((item) => {
                    const vs = VERDICT_STYLE[item.verdict];
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
                        <td className="px-2 py-1 text-center">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[9.5px] font-semibold ${vs.bg} ${vs.text}`} title={item.conclusion}>
                            {t(vs.labelKey, lang)}
                          </span>
                        </td>
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
