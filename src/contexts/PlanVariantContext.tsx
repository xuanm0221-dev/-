"use client";

import React, { createContext, useContext, useMemo, useState } from "react";
import type { PlanVariant } from "@/lib/expenseData";

interface PlanVariantContextValue {
  /** 계획 소스 — "plan" = 원계획(2026년비용_plan.csv), "plan_adj" = 중간점검 연간 실제 사용예상 */
  planVariant: PlanVariant;
  setPlanVariant: (v: PlanVariant) => void;
}

const PlanVariantContext = createContext<PlanVariantContextValue | null>(null);

export function PlanVariantProvider({ children }: { children: React.ReactNode }) {
  // 기본은 "연간 실제 사용예상" — 지금 페이스로 본 전망이 실무 기준이므로. 토글로 원계획과 비교 가능.
  const [planVariant, setPlanVariant] = useState<PlanVariant>("plan_adj");
  const value = useMemo(() => ({ planVariant, setPlanVariant }), [planVariant]);
  return <PlanVariantContext.Provider value={value}>{children}</PlanVariantContext.Provider>;
}

/** Provider 밖에서 호출돼도 안전하도록 원계획을 돌려준다. */
export function usePlanVariant(): PlanVariantContextValue {
  const ctx = useContext(PlanVariantContext);
  const fallback = useMemo<PlanVariantContextValue>(
    () => ({ planVariant: "plan", setPlanVariant: () => {} }),
    []
  );
  return ctx ?? fallback;
}
