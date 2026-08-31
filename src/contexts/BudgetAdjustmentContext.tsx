"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { normalizeAdjustments, type BudgetAdjustment } from "@/lib/budgetAdjustments";

interface SaveResult {
  ok: boolean;
  /** 배포 환경에서 비밀번호가 필요/틀린 경우 */
  needPassword?: boolean;
  error?: string;
}

interface BudgetAdjustmentContextValue {
  adjustments: BudgetAdjustment[];
  loaded: boolean;
  /** false = 원 계획(수기조정 미반영), true = 조정 후 */
  applyAdjustments: boolean;
  setApplyAdjustments: (v: boolean) => void;
  save: (list: BudgetAdjustment[], password?: string) => Promise<SaveResult>;
  reload: () => Promise<void>;
}

const BudgetAdjustmentContext = createContext<BudgetAdjustmentContextValue | null>(null);

export function BudgetAdjustmentProvider({ children }: { children: React.ReactNode }) {
  const [adjustments, setAdjustments] = useState<BudgetAdjustment[]>([]);
  const [loaded, setLoaded] = useState(false);
  // 기본은 "조정 후" — 입력한 값이 바로 보이도록. 토글로 원 계획과 비교 가능.
  const [applyAdjustments, setApplyAdjustments] = useState(true);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/budget-adjustments", { cache: "no-store" });
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      setAdjustments(normalizeAdjustments(json?.data));
    } catch {
      // 조회 실패는 조정 없음으로 취급 — 대시보드 본체는 그대로 동작해야 한다
      setAdjustments([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async (list: BudgetAdjustment[], password?: string): Promise<SaveResult> => {
    try {
      const res = await fetch("/api/budget-adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustments: list, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, needPassword: res.status === 401, error: json?.error };
      }
      setAdjustments(normalizeAdjustments(json?.data ?? list));
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || "저장 중 오류가 발생했습니다." };
    }
  }, []);

  const value = useMemo(
    () => ({ adjustments, loaded, applyAdjustments, setApplyAdjustments, save, reload }),
    [adjustments, loaded, applyAdjustments, save, reload]
  );

  return (
    <BudgetAdjustmentContext.Provider value={value}>
      {children}
    </BudgetAdjustmentContext.Provider>
  );
}

/**
 * Provider 밖에서 호출돼도 안전하도록 빈 목록을 돌려준다.
 * (조정 기능이 없는 화면에서도 컴포넌트가 그대로 동작해야 하므로)
 */
export function useBudgetAdjustments(): BudgetAdjustmentContextValue {
  const ctx = useContext(BudgetAdjustmentContext);
  const fallback = useMemo<BudgetAdjustmentContextValue>(
    () => ({
      adjustments: [],
      loaded: true,
      applyAdjustments: false,
      setApplyAdjustments: () => {},
      save: async () => ({ ok: false, error: "저장할 수 없는 화면입니다." }),
      reload: async () => {},
    }),
    []
  );
  return ctx ?? fallback;
}
