"use client";

import React, { useState, useMemo, useEffect } from "react";
import { ChevronRight, ChevronDown, ChevronsDownUp, Edit2, Check, X, PieChart, Calendar, Info, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCategoryDetail, getAnnualData, getAggregatedData, getMonthlyTotal, getYTDHeadcountSum, aggregateCategoryDetailToAnnual, type BizUnit, type Mode } from "@/lib/expenseData";
import { useToast } from "@/components/ui/toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { getDisplayLabel, t } from "@/lib/translations";

type BizUnitOrAll = BizUnit | "ALL";
import { formatK, formatPercent, calculateYOY } from "@/lib/utils";

import { ExpenseAccountRow } from "@/types/expense";
import { PasswordModal } from "@/components/dashboard/PasswordModal";

interface ExpenseAccountHierTableProps {
  bizUnit?: BizUnit | "ALL";
  year: number;
  month: number;
  title?: string;
  onHierarchyReady?: (rows: ExpenseAccountRow[]) => void;
  onAnnualTotalsChange?: (totals: { prevYear: number; currYear: number }) => void;
  yearType?: 'actual' | 'plan';
  /** 실적(actual)일 때만 전달: 페이지 mode와 동기화 */
  mode?: Mode;
  onModeChange?: (mode: Mode) => void;
  /** 인쇄/PDF용: true이면 모든 행을 펼친 상태로 렌더 (expandedRows 무시) */
  forceExpandAll?: boolean;
}

export function ExpenseAccountHierTable({
  bizUnit = "ALL",
  year,
  month,
  title,
  onHierarchyReady,
  onAnnualTotalsChange,
  yearType = 'actual',
  mode: modeProp,
  onModeChange,
  forceExpandAll = false,
}: ExpenseAccountHierTableProps) {
  const [viewMode, setViewMode] = useState<Mode | "annual">("ytd");
  const is2026AnnualOnly = year === 2026 && yearType === 'plan';

  // 실적(actual)일 때 mode prop과 동기화, 2026년(예산)이면 연간 뷰 강제
  useEffect(() => {
    if (is2026AnnualOnly) {
      setViewMode("annual");
    } else if (modeProp != null) {
      setViewMode(modeProp);
    }
  }, [modeProp, is2026AnnualOnly]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  // forceExpandAll=true면 모든 행을 펼친 것으로 간주 (인쇄/PDF용)
  const isRowExpanded = (key: string) => forceExpandAll || expandedRows.has(key);
  
  // 설명 편집을 위한 상태 관리 (언어별 ko/zh)
  type DescByLang = { ko?: string; zh?: string };
  const [descriptions, setDescriptions] = useState<Map<string, DescByLang>>(new Map());
  const [basisMap, setBasisMap] = useState<Map<string, string>>(new Map());
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [basisPopoverRowId, setBasisPopoverRowId] = useState<string | null>(null);
  const [basisEditValue, setBasisEditValue] = useState<string>("");
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [pendingSaveType, setPendingSaveType] = useState<"description" | "basis" | "reset" | null>(null);
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const { addToast } = useToast();
  const { lang } = useLanguage();

  // 2026 예산(yearType=plan) 전용 저장/조회 키 — 실적과 분리
  const descYm = is2026AnnualOnly ? "202612" : `${year}${String(month).padStart(2, "0")}`;
  const descMode = is2026AnnualOnly ? "ytd" : (viewMode === "annual" ? "ytd" : viewMode);
  const descYearType = is2026AnnualOnly ? "plan" : yearType;

  // API에서 설명 데이터 로드
  useEffect(() => {
    const loadDescriptions = async () => {
      try {
        const response = await fetch(
          `/api/cost-descriptions?brand=${bizUnit}&ym=${descYm}&mode=${descMode}&yearType=${descYearType}`
        );
        
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data) {
            const raw = result.data as Record<string, unknown>;
            const normalized = new Map<string, DescByLang>();
            for (const [k, v] of Object.entries(raw)) {
              if (typeof v === "string" && v.trim()) normalized.set(k, { ko: v });
              else if (v && typeof v === "object" && !Array.isArray(v)) {
                const o = v as Record<string, unknown>;
                const ko = typeof o.ko === "string" ? o.ko.trim() : "";
                const zh = typeof o.zh === "string" ? o.zh.trim() : "";
                if (ko || zh) normalized.set(k, { ko: ko || undefined, zh: zh || undefined });
              }
            }
            setDescriptions(normalized);
          }
          if (result.success && result.basis) {
            setBasisMap(new Map(Object.entries(result.basis)));
          }
        }
      } catch (error) {
        console.error("설명 데이터 로드 실패:", error);
        // 실패 시 localStorage에서 fallback (선택적)
        const storageKey = `expense-descriptions-${bizUnit}-${parseInt(descYm.slice(0, 4), 10)}-${parseInt(descYm.slice(4, 6), 10)}-${descYearType}`;
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          try {
            const parsed = JSON.parse(saved) as Record<string, unknown>;
            const normalized = new Map<string, DescByLang>();
            for (const [k, v] of Object.entries(parsed)) {
              if (typeof v === "string" && v.trim()) normalized.set(k, { ko: v });
              else if (v && typeof v === "object" && !Array.isArray(v)) {
                const o = v as Record<string, unknown>;
                const ko = typeof o.ko === "string" ? o.ko.trim() : "";
                const zh = typeof o.zh === "string" ? o.zh.trim() : "";
                if (ko || zh) normalized.set(k, { ko: ko || undefined, zh: zh || undefined });
              }
            }
            setDescriptions(normalized);
          } catch (e) {
            console.error("localStorage fallback 실패:", e);
          }
        }
      }
    };

    loadDescriptions();
  }, [bizUnit, descYm, descMode, descYearType, refreshKey]);

  const getDescCurrent = (rowId: string, fallback: string) => descriptions.get(rowId)?.[lang] ?? fallback;
  const getDescOther = (rowId: string) => descriptions.get(rowId)?.[lang === "ko" ? "zh" : "ko"];

  // 편집 시작
  const startEdit = (rowId: string, currentDescription: string) => {
    setEditingRowId(rowId);
    setEditValue(currentDescription);
  };

  // 편집 취소
  const cancelEdit = () => {
    setEditingRowId(null);
    setEditValue("");
  };

  const isLocalHost = typeof window !== "undefined" && window.location.hostname === "localhost";

  const performSaveOrReset = async (
    password: string,
    type: "description" | "basis" | "reset",
    rowId?: string,
    descValue?: string,
    basisVal?: string
  ) => {
    if (type === "reset") {
      const response = await fetch("/api/cost-descriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset",
          brand: bizUnit,
          ym: descYm,
          mode: descMode,
          yearType: descYearType,
          password,
        }),
      });
      const result = await response.json();
      if (response.status === 401) {
        addToast({ type: "error", message: "비밀번호가 올바르지 않습니다." });
        throw new Error("비밀번호 불일치");
      }
      if (!response.ok || !result.success) {
        throw new Error(result.error || "초기화에 실패했습니다.");
      }
      addToast({ type: "success", message: "초기화되었습니다." });
      setRefreshKey((k) => k + 1);
      return;
    }
    if (!rowId) return;
    const isDescription = type === "description";
    const body: Record<string, unknown> = {
      brand: bizUnit,
      ym: descYm,
      mode: descMode,
      accountPath: rowId,
      yearType: descYearType,
      password,
      lang,
    };
    if (isDescription) body.description = descValue ?? editValue;
    else body.basis = basisVal ?? basisEditValue;
    const response = await fetch("/api/cost-descriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (response.status === 401) {
      addToast({ type: "error", message: "비밀번호가 올바르지 않습니다." });
      throw new Error("비밀번호 불일치");
    }
    if (!response.ok || !result.success) {
      throw new Error(result.error || "저장에 실패했습니다.");
    }
    const valueToSet = isDescription ? (descValue ?? editValue) : (basisVal ?? basisEditValue);
    if (isDescription) {
      const newDescriptions = new Map(descriptions);
      const existing = newDescriptions.get(rowId) || {};
      const langKey = lang === "zh" ? "zh" : "ko";
      const updated = { ...existing, [langKey]: (valueToSet ?? "").trim() || undefined };
      if (updated.ko || updated.zh) newDescriptions.set(rowId, updated);
      else newDescriptions.delete(rowId);
      setDescriptions(newDescriptions);
      const storageKey = `expense-descriptions-${bizUnit}-${parseInt(descYm.slice(0, 4), 10)}-${parseInt(descYm.slice(4, 6), 10)}-${descYearType}`;
      localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(newDescriptions)));
      addToast({ type: "success", message: "설명이 저장되었습니다." });
      setEditingRowId(null);
      setEditValue("");
    } else {
      const newBasis = new Map(basisMap);
      if (valueToSet.trim()) newBasis.set(rowId, valueToSet);
      else newBasis.delete(rowId);
      setBasisMap(newBasis);
      addToast({ type: "success", message: "계산 근거가 저장되었습니다." });
      closeBasisPopover();
    }
  };

  const requestSaveEdit = (rowId: string) => {
    setPendingSaveType("description");
    setPendingRowId(rowId);
    if (isLocalHost) {
      performSaveOrReset("", "description", rowId, editValue).then(() => {
        setPasswordModalOpen(false);
        setPendingSaveType(null);
        setPendingRowId(null);
      }).catch(() => {});
      return;
    }
    setPasswordModalOpen(true);
  };

  const requestSaveBasis = (rowId: string) => {
    setPendingSaveType("basis");
    setPendingRowId(rowId);
    if (isLocalHost) {
      performSaveOrReset("", "basis", rowId, undefined, basisEditValue).then(() => {
        setPasswordModalOpen(false);
        setPendingSaveType(null);
        setPendingRowId(null);
      }).catch(() => {});
      return;
    }
    setPasswordModalOpen(true);
  };

  const requestReset = () => {
    setPendingSaveType("reset");
    if (isLocalHost) {
      performSaveOrReset("", "reset").then(() => {
        setPasswordModalOpen(false);
        setPendingSaveType(null);
        setPendingRowId(null);
      }).catch(() => {});
      return;
    }
    setPasswordModalOpen(true);
  };

  const handlePasswordConfirm = async (password: string) => {
    if (!pendingSaveType) return;
    if (pendingSaveType !== "reset" && !pendingRowId) return;
    try {
      await performSaveOrReset(
        password,
        pendingSaveType,
        pendingSaveType === "reset" ? undefined : pendingRowId ?? undefined,
        pendingSaveType === "description" ? editValue : undefined,
        pendingSaveType === "basis" ? basisEditValue : undefined
      );
      setPasswordModalOpen(false);
      setPendingSaveType(null);
      setPendingRowId(null);
    } catch (_) {}
  };

  const openBasisPopover = (rowId: string) => {
    setBasisPopoverRowId(rowId);
    setBasisEditValue(basisMap.get(rowId) || "");
  };

  const closeBasisPopover = () => {
    setBasisPopoverRowId(null);
    setBasisEditValue("");
  };

  const saveBasis = async (rowId: string) => {
    try {
      const response = await fetch("/api/cost-descriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: bizUnit,
          ym: descYm,
          mode: descMode,
          accountPath: rowId,
          basis: basisEditValue,
          yearType: descYearType,
        }),
      });
      const result = await response.json();
      if (response.ok && result.success) {
        const newBasis = new Map(basisMap);
        if (basisEditValue.trim()) newBasis.set(rowId, basisEditValue);
        else newBasis.delete(rowId);
        setBasisMap(newBasis);
        addToast({ type: "success", message: "계산 근거가 저장되었습니다." });
        closeBasisPopover();
      } else {
        throw new Error(result.error || "저장에 실패했습니다.");
      }
    } catch (error: any) {
      addToast({ type: "error", message: error.message || "계산 근거 저장 중 오류가 발생했습니다." });
    }
  };

  // 계층 데이터 변환 및 집계
  const hierarchicalData = useMemo(() => {
    // bizUnit이 "ALL"이면 모든 사업부(MLB, KIDS, DISCOVERY, 공통) 포함
    // 모든 대분류 가져오기 (costLv1을 빈 문자열로 전달하면 모든 대분류 반환)
    const bizUnitFilter: BizUnitOrAll = bizUnit || "ALL";
    // 2026년(예산)이면 연간만 사용하므로 YTD로 가져옴. viewMode가 "annual"이면 "ytd"로 변환
    const modeForDataFetch: Mode = (is2026AnnualOnly || viewMode === "annual") ? "ytd" : viewMode;
    const allDetails = getCategoryDetail(bizUnitFilter, year, month, "", modeForDataFetch, yearType);
    // 2026년(예산)일 때는 전년도를 2025년 12월 YTD actual로 가져옴
    const prevYearDetails = is2026AnnualOnly
      ? getCategoryDetail(bizUnitFilter, 2025, 12, "", "ytd", 'actual')
      : getCategoryDetail(bizUnitFilter, year - 1, month, "", modeForDataFetch, yearType);

    // 대분류별로 그룹화
    const l1Map = new Map<string, ExpenseAccountRow>();
    const l2Map = new Map<string, ExpenseAccountRow>();
    const l3Map = new Map<string, ExpenseAccountRow>();

    // 전년도 데이터를 먼저 처리하여 구조 생성 (전년도에만 존재하는 데이터도 포함)
    prevYearDetails.forEach((detail) => {
      const l1Key = detail.cost_lv1 || "";
      if (!l1Key) return;

      const isAdExpense = l1Key === "광고비";
      const isInteriorDev = l1Key === "지급수수료" && detail.cost_lv2 === "인테리어 개발";
      const isTravelExpense = l1Key === "출장비" && (detail.cost_lv2 === "국내출장비" || detail.cost_lv2 === "해외출장비");
      
      // 디버깅: 복리후생비 KIDS 데이터 확인
      if (l1Key === "복리후생비" && detail.biz_unit === "KIDS" && modeForDataFetch === "ytd") {
        console.log(`[전년도] 복리후생비 KIDS: cost_lv2=${detail.cost_lv2}, cost_lv3=${detail.cost_lv3}, amount=${detail.amount}`);
      }

      // 대분류 생성 또는 가져오기
      if (!l1Map.has(l1Key)) {
        l1Map.set(l1Key, {
          id: `l1-${l1Key}`,
          level: 1,
          category_l1: l1Key,
          category_l2: "",
          category_l3: "",
          category_l1_cn: detail.cost_lv1_cn,
          prev_month: 0,
          curr_month: 0,
          prev_ytd: 0,
          curr_ytd: 0,
          prev_year_annual: null,
          curr_year_annual: null,
          description: "",
          isExpanded: isRowExpanded(`l1-${l1Key}`),
          children: [],
        });
      }
      const l1Row = l1Map.get(l1Key)!;

      if (isAdExpense) {
        // 광고비인 경우
        const bizUnitKey = detail.biz_unit || "기타";
        
        if (bizUnitFilter === "ALL" || bizUnitFilter === "법인") {
          // 홈 페이지 & 법인 페이지: 대분류 → 사업부구분 → 중분류(L3). L3 합계 = L2
          const l2Key = `${l1Key}|${bizUnitKey}`;
          let l2Row = l2Map.get(l2Key);
          if (!l2Row) {
            l2Row = {
              id: `l2-${l1Key}-${bizUnitKey}`,
              level: 2,
              category_l1: l1Key,
              biz_unit: bizUnitKey,
              category_l2: bizUnitKey,
              category_l3: "",
              biz_unit_cn: detail.biz_unit_cn,
              category_l1_cn: detail.cost_lv1_cn,
              prev_month: 0,
              curr_month: 0,
              prev_ytd: 0,
              curr_ytd: 0,
              prev_year_annual: null,
              curr_year_annual: null,
              description: "",
              isExpanded: isRowExpanded(`l2-${l1Key}-${bizUnitKey}`),
              children: [],
            };
            l2Map.set(l2Key, l2Row);
            l1Row.children!.push(l2Row);
          }

          if (detail.cost_lv2 && detail.cost_lv2.trim() !== "") {
            const l3Key = `${l2Key}|${detail.cost_lv2}`;
            let l3Row = l3Map.get(l3Key);
            if (!l3Row) {
              l3Row = {
                id: `l3-${l1Key}-${bizUnitKey}-${detail.cost_lv2}`,
                level: 3,
                category_l1: l1Key,
                biz_unit: bizUnitKey,
                category_l2: detail.cost_lv2,
                category_l3: detail.cost_lv2,
                category_l2_cn: detail.cost_lv2_cn,
                biz_unit_cn: detail.biz_unit_cn,
                category_l1_cn: detail.cost_lv1_cn,
                prev_month: 0,
                curr_month: 0,
                prev_ytd: 0,
                curr_ytd: 0,
                prev_year_annual: null,
                curr_year_annual: null,
                description: "",
                isExpanded: false,
              };
              l3Map.set(l3Key, l3Row);
              l2Row.children!.push(l3Row);
            }
            if (viewMode !== "ytd") {
              l3Row.prev_month += detail.amount;
            } else {
              l3Row.prev_ytd += detail.amount;
            }
          } else {
            if (viewMode !== "ytd") {
              l2Row.prev_month += detail.amount;
            } else {
              l2Row.prev_ytd += detail.amount;
            }
          }
        } else {
          // 브랜드 페이지: 대분류 → 중분류 (사업부구분 스킵)
          if (detail.cost_lv2 && detail.cost_lv2.trim() !== "") {
            const l2Key = `${l1Key}|${detail.cost_lv2}`;
            let l2Row = l2Map.get(l2Key);
            if (!l2Row) {
              l2Row = {
                id: `l2-${l1Key}-${detail.cost_lv2}`,
                level: 2,
                category_l1: l1Key,
                category_l2: detail.cost_lv2,
                category_l3: "",
                category_l2_cn: detail.cost_lv2_cn,
                category_l1_cn: detail.cost_lv1_cn,
                prev_month: 0,
                curr_month: 0,
                prev_ytd: 0,
                curr_ytd: 0,
                prev_year_annual: null,
                curr_year_annual: null,
                description: "",
                isExpanded: isRowExpanded(`l2-${l1Key}-${detail.cost_lv2}`),
                children: [],
              };
              l2Map.set(l2Key, l2Row);
              l1Row.children!.push(l2Row);
            }
            if (viewMode !== "ytd") {
              l2Row.prev_month += detail.amount;
            } else {
              l2Row.prev_ytd += detail.amount;
            }
          } else {
            // 중분류가 없으면 대분류에 직접 집계
            if (viewMode !== "ytd") {
              l1Row.prev_month += detail.amount;
            } else {
              l1Row.prev_ytd += detail.amount;
            }
          }
        }
      } else if (isInteriorDev) {
        // 지급수수료 > 인테리어 개발인 경우
        if (detail.cost_lv2 && detail.cost_lv2.trim() !== "") {
          const l2Key = `${l1Key}|${detail.cost_lv2}`;
          let l2Row = l2Map.get(l2Key);
          if (!l2Row) {
            l2Row = {
              id: `l2-${l1Key}-${detail.cost_lv2}`,
              level: 2,
              category_l1: l1Key,
              category_l2: detail.cost_lv2,
              category_l3: "",
              category_l2_cn: detail.cost_lv2_cn,
              category_l1_cn: detail.cost_lv1_cn,
              prev_month: 0,
              curr_month: 0,
              prev_ytd: 0,
              curr_ytd: 0,
              prev_year_annual: null,
              curr_year_annual: null,
              description: "",
              isExpanded: isRowExpanded(`l2-${l1Key}-${detail.cost_lv2}`),
              children: [],
            };
            l2Map.set(l2Key, l2Row);
            l1Row.children!.push(l2Row);
          }

          const bizUnitKey = detail.biz_unit || "기타";
          
          if (bizUnitFilter === "ALL" || bizUnitFilter === "법인") {
            // 홈 페이지 & 법인 페이지: 대분류 → 중분류 → 사업부구분 → 소분류
            const l3Key = `${l2Key}|${bizUnitKey}`;
            let l3Row = l3Map.get(l3Key);
            if (!l3Row) {
              l3Row = {
                id: `l3-${l1Key}-${detail.cost_lv2}-${bizUnitKey}`,
                level: 3,
                category_l1: l1Key,
                biz_unit: bizUnitKey,
                category_l2: detail.cost_lv2,
                category_l3: bizUnitKey,
                category_l2_cn: detail.cost_lv2_cn,
                biz_unit_cn: detail.biz_unit_cn,
                category_l1_cn: detail.cost_lv1_cn,
                prev_month: 0,
                curr_month: 0,
                prev_ytd: 0,
                curr_ytd: 0,
                prev_year_annual: null,
                curr_year_annual: null,
                description: "",
                isExpanded: isRowExpanded(`l3-${l1Key}-${detail.cost_lv2}-${bizUnitKey}`),
                children: [],
              };
              l3Map.set(l3Key, l3Row);
              l2Row.children!.push(l3Row);
            }

            if (detail.cost_lv3 && detail.cost_lv3.trim() !== "") {
              const l4Key = `${l3Key}|${detail.cost_lv3}`;
              let l4Row = l3Map.get(l4Key);
              if (!l4Row) {
                l4Row = {
                  id: `l4-${l1Key}-${detail.cost_lv2}-${bizUnitKey}-${detail.cost_lv3}`,
                  level: 4,
                  category_l1: l1Key,
                  biz_unit: bizUnitKey,
                  category_l2: detail.cost_lv2,
                  category_l3: detail.cost_lv3,
                  category_l2_cn: detail.cost_lv2_cn,
                  category_l3_cn: detail.cost_lv3_cn,
                  biz_unit_cn: detail.biz_unit_cn,
                  category_l1_cn: detail.cost_lv1_cn,
                  prev_month: 0,
                  curr_month: 0,
                  prev_ytd: 0,
                  curr_ytd: 0,
                  prev_year_annual: null,
                  curr_year_annual: null,
                  description: "",
                  isExpanded: false,
                };
                l3Map.set(l4Key, l4Row);
                l3Row.children!.push(l4Row);
              }
              if (viewMode !== "ytd") {
                l4Row.prev_month += detail.amount;
              } else {
                l4Row.prev_ytd += detail.amount;
              }
            } else {
              if (viewMode !== "ytd") {
                l3Row.prev_month += detail.amount;
              } else {
                l3Row.prev_ytd += detail.amount;
              }
            }
          } else {
            // 브랜드 페이지: 대분류 → 중분류 → 소분류 (사업부구분 스킵)
            if (detail.cost_lv3 && detail.cost_lv3.trim() !== "") {
              const l3Key = `${l2Key}|${detail.cost_lv3}`;
              let l3Row = l3Map.get(l3Key);
              if (!l3Row) {
                l3Row = {
                  id: `l3-${l1Key}-${detail.cost_lv2}-${detail.cost_lv3}`,
                  level: 3,
                  category_l1: l1Key,
                  category_l2: detail.cost_lv2,
                  category_l3: detail.cost_lv3,
                  category_l2_cn: detail.cost_lv2_cn,
                  category_l3_cn: detail.cost_lv3_cn,
                  biz_unit_cn: detail.biz_unit_cn,
                  category_l1_cn: detail.cost_lv1_cn,
                  prev_month: 0,
                  curr_month: 0,
                  prev_ytd: 0,
                  curr_ytd: 0,
                  prev_year_annual: null,
                  curr_year_annual: null,
                  description: "",
                  isExpanded: false,
                };
                l3Map.set(l3Key, l3Row);
                l2Row.children!.push(l3Row);
              }
              if (viewMode !== "ytd") {
                l3Row.prev_month += detail.amount;
              } else {
                l3Row.prev_ytd += detail.amount;
              }
            } else {
              if (viewMode !== "ytd") {
                l2Row.prev_month += detail.amount;
              } else {
                l2Row.prev_ytd += detail.amount;
              }
            }
          }
        } else {
          if (viewMode !== "ytd") {
            l1Row.prev_month += detail.amount;
          } else {
            l1Row.prev_ytd += detail.amount;
          }
        }
      } else if (isTravelExpense) {
        // 출장비 > 국내출장비/해외출장비인 경우
        if (detail.cost_lv2 && detail.cost_lv2.trim() !== "") {
          const l2Key = `${l1Key}|${detail.cost_lv2}`;
          let l2Row = l2Map.get(l2Key);
          if (!l2Row) {
            l2Row = {
              id: `l2-${l1Key}-${detail.cost_lv2}`,
              level: 2,
              category_l1: l1Key,
              category_l2: detail.cost_lv2,
              category_l3: "",
              category_l2_cn: detail.cost_lv2_cn,
              category_l1_cn: detail.cost_lv1_cn,
              prev_month: 0,
              curr_month: 0,
              prev_ytd: 0,
              curr_ytd: 0,
              prev_year_annual: null,
              curr_year_annual: null,
              description: "",
              isExpanded: isRowExpanded(`l2-${l1Key}-${detail.cost_lv2}`),
              children: [],
            };
            l2Map.set(l2Key, l2Row);
            l1Row.children!.push(l2Row);
          }

          const bizUnitKey = detail.biz_unit || "기타";
          
          if (bizUnitFilter === "ALL" || bizUnitFilter === "법인") {
            // 홈 페이지 & 법인 페이지: 대분류 → 중분류 → 사업부구분 → 소분류
            const l3Key = `${l2Key}|${bizUnitKey}`;
            let l3Row = l3Map.get(l3Key);
            if (!l3Row) {
              l3Row = {
                id: `l3-${l1Key}-${detail.cost_lv2}-${bizUnitKey}`,
                level: 3,
                category_l1: l1Key,
                biz_unit: bizUnitKey,
                category_l2: detail.cost_lv2,
                category_l3: bizUnitKey,
                category_l2_cn: detail.cost_lv2_cn,
                biz_unit_cn: detail.biz_unit_cn,
                category_l1_cn: detail.cost_lv1_cn,
                prev_month: 0,
                curr_month: 0,
                prev_ytd: 0,
                curr_ytd: 0,
                prev_year_annual: null,
                curr_year_annual: null,
                description: "",
                isExpanded: isRowExpanded(`l3-${l1Key}-${detail.cost_lv2}-${bizUnitKey}`),
                children: [],
              };
              l3Map.set(l3Key, l3Row);
              l2Row.children!.push(l3Row);
            }

            if (detail.cost_lv3 && detail.cost_lv3.trim() !== "") {
              const l4Key = `${l3Key}|${detail.cost_lv3}`;
              let l4Row = l3Map.get(l4Key);
              if (!l4Row) {
                l4Row = {
                  id: `l4-${l1Key}-${detail.cost_lv2}-${bizUnitKey}-${detail.cost_lv3}`,
                  level: 4,
                  category_l1: l1Key,
                  biz_unit: bizUnitKey,
                  category_l2: detail.cost_lv2,
                  category_l3: detail.cost_lv3,
                  category_l2_cn: detail.cost_lv2_cn,
                  category_l3_cn: detail.cost_lv3_cn,
                  biz_unit_cn: detail.biz_unit_cn,
                  category_l1_cn: detail.cost_lv1_cn,
                  prev_month: 0,
                  curr_month: 0,
                  prev_ytd: 0,
                  curr_ytd: 0,
                  prev_year_annual: null,
                  curr_year_annual: null,
                  description: "",
                  isExpanded: false,
                };
                l3Map.set(l4Key, l4Row);
                l3Row.children!.push(l4Row);
              }
              if (viewMode !== "ytd") {
                l4Row.prev_month += detail.amount;
              } else {
                l4Row.prev_ytd += detail.amount;
              }
            } else {
              if (viewMode !== "ytd") {
                l3Row.prev_month += detail.amount;
              } else {
                l3Row.prev_ytd += detail.amount;
              }
            }
          } else {
            // 브랜드 페이지: 대분류 → 중분류 → 소분류 (사업부구분 스킵)
            if (detail.cost_lv3 && detail.cost_lv3.trim() !== "") {
              const l3Key = `${l2Key}|${detail.cost_lv3}`;
              let l3Row = l3Map.get(l3Key);
              if (!l3Row) {
                l3Row = {
                  id: `l3-${l1Key}-${detail.cost_lv2}-${detail.cost_lv3}`,
                  level: 3,
                  category_l1: l1Key,
                  category_l2: detail.cost_lv2,
                  category_l3: detail.cost_lv3,
                  category_l2_cn: detail.cost_lv2_cn,
                  category_l3_cn: detail.cost_lv3_cn,
                  biz_unit_cn: detail.biz_unit_cn,
                  category_l1_cn: detail.cost_lv1_cn,
                  prev_month: 0,
                  curr_month: 0,
                  prev_ytd: 0,
                  curr_ytd: 0,
                  prev_year_annual: null,
                  curr_year_annual: null,
                  description: "",
                  isExpanded: false,
                };
                l3Map.set(l3Key, l3Row);
                l2Row.children!.push(l3Row);
              }
              if (viewMode !== "ytd") {
                l3Row.prev_month += detail.amount;
              } else {
                l3Row.prev_ytd += detail.amount;
              }
            } else {
              if (viewMode !== "ytd") {
                l2Row.prev_month += detail.amount;
              } else {
                l2Row.prev_ytd += detail.amount;
              }
            }
          }
        } else {
          if (viewMode !== "ytd") {
            l1Row.prev_month += detail.amount;
          } else {
            l1Row.prev_ytd += detail.amount;
          }
        }
      } else {
        // 광고비가 아닌 경우: 기존 로직 (대분류 → 중분류 → 소분류)
        if (detail.cost_lv2 && detail.cost_lv2.trim() !== "") {
          const l2Key = `${l1Key}|${detail.cost_lv2}`;
          let l2Row = l2Map.get(l2Key);
          if (!l2Row) {
            l2Row = {
              id: `l2-${l1Key}-${detail.cost_lv2}`,
              level: 2,
              category_l1: l1Key,
              category_l2: detail.cost_lv2,
              category_l3: "",
              category_l2_cn: detail.cost_lv2_cn,
              category_l1_cn: detail.cost_lv1_cn,
              prev_month: 0,
              curr_month: 0,
              prev_ytd: 0,
              curr_ytd: 0,
              prev_year_annual: null,
              curr_year_annual: null,
              description: "",
              isExpanded: isRowExpanded(`l2-${l1Key}-${detail.cost_lv2}`),
              children: [],
            };
            l2Map.set(l2Key, l2Row);
            l1Row.children!.push(l2Row);
          }

          if (detail.cost_lv3 && detail.cost_lv3.trim() !== "") {
            const l3Key = `${l2Key}|${detail.cost_lv3}`;
            let l3Row = l3Map.get(l3Key);
            if (!l3Row) {
              l3Row = {
                id: `l3-${l1Key}-${detail.cost_lv2}-${detail.cost_lv3}`,
                level: 3,
                category_l1: l1Key,
                category_l2: detail.cost_lv2,
                category_l3: detail.cost_lv3,
                category_l2_cn: detail.cost_lv2_cn,
                category_l3_cn: detail.cost_lv3_cn,
                category_l1_cn: detail.cost_lv1_cn,
                prev_month: 0,
                curr_month: 0,
                prev_ytd: 0,
                curr_ytd: 0,
                prev_year_annual: null,
                curr_year_annual: null,
                description: "",
                isExpanded: false,
              };
              l3Map.set(l3Key, l3Row);
              l2Row.children!.push(l3Row);
            }
            if (viewMode !== "ytd") {
              l3Row.prev_month += detail.amount;
            } else {
              l3Row.prev_ytd += detail.amount;
            }
          } else {
            if (viewMode !== "ytd") {
              l2Row.prev_month += detail.amount;
            } else {
              l2Row.prev_ytd += detail.amount;
            }
          }
        } else {
          if (viewMode !== "ytd") {
            l1Row.prev_month += detail.amount;
          } else {
            l1Row.prev_ytd += detail.amount;
          }
        }
      }
    });

    // 당년 데이터 처리
    allDetails.forEach((detail) => {
      const l1Key = detail.cost_lv1 || "";
      if (!l1Key) return;

      // 광고비인지 확인
      const isAdExpense = l1Key === "광고비";
      const isInteriorDev = l1Key === "지급수수료" && detail.cost_lv2 === "인테리어 개발";
      const isTravelExpense = l1Key === "출장비" && (detail.cost_lv2 === "국내출장비" || detail.cost_lv2 === "해외출장비");

      // 대분류 생성 또는 가져오기
      if (!l1Map.has(l1Key)) {
        l1Map.set(l1Key, {
          id: `l1-${l1Key}`,
          level: 1,
          category_l1: l1Key,
          category_l2: "",
          category_l3: "",
          category_l1_cn: detail.cost_lv1_cn,
          prev_month: 0,
          curr_month: 0,
          prev_ytd: 0,
          curr_ytd: 0,
          prev_year_annual: null,
          curr_year_annual: null,
          description: "",
          isExpanded: isRowExpanded(`l1-${l1Key}`),
          children: [],
        });
      }
      const l1Row = l1Map.get(l1Key)!;

      // 광고비인 경우
      if (isAdExpense) {
        const bizUnitKey = detail.biz_unit || "기타";
        
        if (bizUnitFilter === "ALL" || bizUnitFilter === "법인") {
          // 홈/법인: 대분류 → 사업부구분(L2) → 중분류(L3). L3 하단에 별도 L2로 나오던 중복 제거(법인도 동일 구조)
          const l2Key = `${l1Key}|${bizUnitKey}`;
          let l2Row = l2Map.get(l2Key);
          if (!l2Row) {
            l2Row = {
              id: `l2-${l1Key}-${bizUnitKey}`,
              level: 2,
              category_l1: l1Key,
              biz_unit: bizUnitKey,
              category_l2: bizUnitKey,
              category_l3: "",
              biz_unit_cn: detail.biz_unit_cn,
              category_l1_cn: detail.cost_lv1_cn,
              prev_month: 0,
              curr_month: 0,
              prev_ytd: 0,
              curr_ytd: 0,
              prev_year_annual: null,
              curr_year_annual: null,
              description: "",
              isExpanded: isRowExpanded(`l2-${l1Key}-${bizUnitKey}`),
              children: [],
            };
            l2Map.set(l2Key, l2Row);
            l1Row.children!.push(l2Row);
          }

          if (detail.cost_lv2 && detail.cost_lv2.trim() !== "") {
            const l3Key = `${l2Key}|${detail.cost_lv2}`;
            let l3Row = l3Map.get(l3Key);
            if (!l3Row) {
              l3Row = {
                id: `l3-${l1Key}-${bizUnitKey}-${detail.cost_lv2}`,
                level: 3,
                category_l1: l1Key,
                biz_unit: bizUnitKey,
                category_l2: detail.cost_lv2,
                category_l3: detail.cost_lv2,
                category_l2_cn: detail.cost_lv2_cn,
                biz_unit_cn: detail.biz_unit_cn,
                category_l1_cn: detail.cost_lv1_cn,
                prev_month: 0,
                curr_month: 0,
                prev_ytd: 0,
                curr_ytd: 0,
                prev_year_annual: null,
                curr_year_annual: null,
                description: "",
                isExpanded: false,
              };
              l3Map.set(l3Key, l3Row);
              l2Row.children!.push(l3Row);
            }
            if (viewMode !== "ytd") {
              l3Row.curr_month += detail.amount;
            } else {
              l3Row.curr_ytd += detail.amount;
            }
          } else {
            if (viewMode !== "ytd") {
              l2Row.curr_month += detail.amount;
            } else {
              l2Row.curr_ytd += detail.amount;
            }
          }
        } else {
          // 브랜드 페이지: 대분류 → 중분류 (사업부구분 스킵)
          if (detail.cost_lv2 && detail.cost_lv2.trim() !== "") {
            const l2Key = `${l1Key}|${detail.cost_lv2}`;
            let l2Row = l2Map.get(l2Key);
            if (!l2Row) {
              l2Row = {
                id: `l2-${l1Key}-${detail.cost_lv2}`,
                level: 2,
                category_l1: l1Key,
                category_l2: detail.cost_lv2,
                category_l3: "",
                category_l2_cn: detail.cost_lv2_cn,
                category_l1_cn: detail.cost_lv1_cn,
                prev_month: 0,
                curr_month: 0,
                prev_ytd: 0,
                curr_ytd: 0,
                prev_year_annual: null,
                curr_year_annual: null,
                description: "",
                isExpanded: isRowExpanded(`l2-${l1Key}-${detail.cost_lv2}`),
                children: [],
              };
              l2Map.set(l2Key, l2Row);
              l1Row.children!.push(l2Row);
            }
            if (viewMode !== "ytd") {
              l2Row.curr_month += detail.amount;
            } else {
              l2Row.curr_ytd += detail.amount;
            }
          } else {
            // 중분류가 없으면 대분류에 직접 집계
            if (viewMode !== "ytd") {
              l1Row.curr_month += detail.amount;
            } else {
              l1Row.curr_ytd += detail.amount;
            }
          }
        }
      } else if (isInteriorDev) {
        // 지급수수료 > 인테리어 개발인 경우
        if (detail.cost_lv2 && detail.cost_lv2.trim() !== "") {
          const l2Key = `${l1Key}|${detail.cost_lv2}`;
          let l2Row = l2Map.get(l2Key);
          if (!l2Row) {
            l2Row = {
              id: `l2-${l1Key}-${detail.cost_lv2}`,
              level: 2,
              category_l1: l1Key,
              category_l2: detail.cost_lv2,
              category_l3: "",
              category_l2_cn: detail.cost_lv2_cn,
              category_l1_cn: detail.cost_lv1_cn,
              prev_month: 0,
              curr_month: 0,
              prev_ytd: 0,
              curr_ytd: 0,
              prev_year_annual: null,
              curr_year_annual: null,
              description: "",
              isExpanded: isRowExpanded(`l2-${l1Key}-${detail.cost_lv2}`),
              children: [],
            };
            l2Map.set(l2Key, l2Row);
            l1Row.children!.push(l2Row);
          }

          const bizUnitKey = detail.biz_unit || "기타";
          
          if (bizUnitFilter === "ALL" || bizUnitFilter === "법인") {
            // 홈 페이지 & 법인 페이지: 대분류 → 중분류 → 사업부구분 → 소분류
            const l3Key = `${l2Key}|${bizUnitKey}`;
            let l3Row = l3Map.get(l3Key);
            if (!l3Row) {
              l3Row = {
                id: `l3-${l1Key}-${detail.cost_lv2}-${bizUnitKey}`,
                level: 3,
                category_l1: l1Key,
                biz_unit: bizUnitKey,
                category_l2: detail.cost_lv2,
                category_l3: bizUnitKey,
                category_l2_cn: detail.cost_lv2_cn,
                biz_unit_cn: detail.biz_unit_cn,
                category_l1_cn: detail.cost_lv1_cn,
                prev_month: 0,
                curr_month: 0,
                prev_ytd: 0,
                curr_ytd: 0,
                prev_year_annual: null,
                curr_year_annual: null,
                description: "",
                isExpanded: isRowExpanded(`l3-${l1Key}-${detail.cost_lv2}-${bizUnitKey}`),
                children: [],
              };
              l3Map.set(l3Key, l3Row);
              l2Row.children!.push(l3Row);
            }

            if (detail.cost_lv3 && detail.cost_lv3.trim() !== "") {
              const l4Key = `${l3Key}|${detail.cost_lv3}`;
              let l4Row = l3Map.get(l4Key);
              if (!l4Row) {
                l4Row = {
                  id: `l4-${l1Key}-${detail.cost_lv2}-${bizUnitKey}-${detail.cost_lv3}`,
                  level: 4,
                  category_l1: l1Key,
                  biz_unit: bizUnitKey,
                  category_l2: detail.cost_lv2,
                  category_l3: detail.cost_lv3,
                  category_l2_cn: detail.cost_lv2_cn,
                  category_l3_cn: detail.cost_lv3_cn,
                  biz_unit_cn: detail.biz_unit_cn,
                  category_l1_cn: detail.cost_lv1_cn,
                  prev_month: 0,
                  curr_month: 0,
                  prev_ytd: 0,
                  curr_ytd: 0,
                  prev_year_annual: null,
                  curr_year_annual: null,
                  description: "",
                  isExpanded: false,
                };
                l3Map.set(l4Key, l4Row);
                l3Row.children!.push(l4Row);
              }
              if (viewMode !== "ytd") {
                l4Row.curr_month += detail.amount;
              } else {
                l4Row.curr_ytd += detail.amount;
              }
            } else {
              if (viewMode !== "ytd") {
                l3Row.curr_month += detail.amount;
              } else {
                l3Row.curr_ytd += detail.amount;
              }
            }
          } else {
            // 브랜드 페이지: 대분류 → 중분류 → 소분류 (사업부구분 스킵)
            if (detail.cost_lv3 && detail.cost_lv3.trim() !== "") {
              const l3Key = `${l2Key}|${detail.cost_lv3}`;
              let l3Row = l3Map.get(l3Key);
              if (!l3Row) {
                l3Row = {
                  id: `l3-${l1Key}-${detail.cost_lv2}-${detail.cost_lv3}`,
                  level: 3,
                  category_l1: l1Key,
                  category_l2: detail.cost_lv2,
                  category_l3: detail.cost_lv3,
                  category_l2_cn: detail.cost_lv2_cn,
                  category_l3_cn: detail.cost_lv3_cn,
                  biz_unit_cn: detail.biz_unit_cn,
                  category_l1_cn: detail.cost_lv1_cn,
                  prev_month: 0,
                  curr_month: 0,
                  prev_ytd: 0,
                  curr_ytd: 0,
                  prev_year_annual: null,
                  curr_year_annual: null,
                  description: "",
                  isExpanded: false,
                };
                l3Map.set(l3Key, l3Row);
                l2Row.children!.push(l3Row);
              }
              if (viewMode !== "ytd") {
                l3Row.curr_month += detail.amount;
              } else {
                l3Row.curr_ytd += detail.amount;
              }
            } else {
              if (viewMode !== "ytd") {
                l2Row.curr_month += detail.amount;
              } else {
                l2Row.curr_ytd += detail.amount;
              }
            }
          }
        } else {
          if (viewMode !== "ytd") {
            l1Row.curr_month += detail.amount;
          } else {
            l1Row.curr_ytd += detail.amount;
          }
        }
      } else if (isTravelExpense) {
        // 출장비 > 국내출장비/해외출장비인 경우
        if (detail.cost_lv2 && detail.cost_lv2.trim() !== "") {
          const l2Key = `${l1Key}|${detail.cost_lv2}`;
          let l2Row = l2Map.get(l2Key);
          if (!l2Row) {
            l2Row = {
              id: `l2-${l1Key}-${detail.cost_lv2}`,
              level: 2,
              category_l1: l1Key,
              category_l2: detail.cost_lv2,
              category_l3: "",
              category_l2_cn: detail.cost_lv2_cn,
              category_l1_cn: detail.cost_lv1_cn,
              prev_month: 0,
              curr_month: 0,
              prev_ytd: 0,
              curr_ytd: 0,
              prev_year_annual: null,
              curr_year_annual: null,
              description: "",
              isExpanded: isRowExpanded(`l2-${l1Key}-${detail.cost_lv2}`),
              children: [],
            };
            l2Map.set(l2Key, l2Row);
            l1Row.children!.push(l2Row);
          }

          const bizUnitKey = detail.biz_unit || "기타";
          
          if (bizUnitFilter === "ALL" || bizUnitFilter === "법인") {
            // 홈 페이지 & 법인 페이지: 대분류 → 중분류 → 사업부구분 → 소분류
            const l3Key = `${l2Key}|${bizUnitKey}`;
            let l3Row = l3Map.get(l3Key);
            if (!l3Row) {
              l3Row = {
                id: `l3-${l1Key}-${detail.cost_lv2}-${bizUnitKey}`,
                level: 3,
                category_l1: l1Key,
                biz_unit: bizUnitKey,
                category_l2: detail.cost_lv2,
                category_l3: bizUnitKey,
                category_l2_cn: detail.cost_lv2_cn,
                biz_unit_cn: detail.biz_unit_cn,
                category_l1_cn: detail.cost_lv1_cn,
                prev_month: 0,
                curr_month: 0,
                prev_ytd: 0,
                curr_ytd: 0,
                prev_year_annual: null,
                curr_year_annual: null,
                description: "",
                isExpanded: isRowExpanded(`l3-${l1Key}-${detail.cost_lv2}-${bizUnitKey}`),
                children: [],
              };
              l3Map.set(l3Key, l3Row);
              l2Row.children!.push(l3Row);
            }

            if (detail.cost_lv3 && detail.cost_lv3.trim() !== "") {
              const l4Key = `${l3Key}|${detail.cost_lv3}`;
              let l4Row = l3Map.get(l4Key);
              if (!l4Row) {
                l4Row = {
                  id: `l4-${l1Key}-${detail.cost_lv2}-${bizUnitKey}-${detail.cost_lv3}`,
                  level: 4,
                  category_l1: l1Key,
                  biz_unit: bizUnitKey,
                  category_l2: detail.cost_lv2,
                  category_l3: detail.cost_lv3,
                  category_l2_cn: detail.cost_lv2_cn,
                  category_l3_cn: detail.cost_lv3_cn,
                  biz_unit_cn: detail.biz_unit_cn,
                  category_l1_cn: detail.cost_lv1_cn,
                  prev_month: 0,
                  curr_month: 0,
                  prev_ytd: 0,
                  curr_ytd: 0,
                  prev_year_annual: null,
                  curr_year_annual: null,
                  description: "",
                  isExpanded: false,
                };
                l3Map.set(l4Key, l4Row);
                l3Row.children!.push(l4Row);
              }
              if (viewMode !== "ytd") {
                l4Row.curr_month += detail.amount;
              } else {
                l4Row.curr_ytd += detail.amount;
              }
            } else {
              if (viewMode !== "ytd") {
                l3Row.curr_month += detail.amount;
              } else {
                l3Row.curr_ytd += detail.amount;
              }
            }
          } else {
            // 브랜드 페이지: 대분류 → 중분류 → 소분류 (사업부구분 스킵)
            if (detail.cost_lv3 && detail.cost_lv3.trim() !== "") {
              const l3Key = `${l2Key}|${detail.cost_lv3}`;
              let l3Row = l3Map.get(l3Key);
              if (!l3Row) {
                l3Row = {
                  id: `l3-${l1Key}-${detail.cost_lv2}-${detail.cost_lv3}`,
                  level: 3,
                  category_l1: l1Key,
                  category_l2: detail.cost_lv2,
                  category_l3: detail.cost_lv3,
                  category_l2_cn: detail.cost_lv2_cn,
                  category_l3_cn: detail.cost_lv3_cn,
                  biz_unit_cn: detail.biz_unit_cn,
                  category_l1_cn: detail.cost_lv1_cn,
                  prev_month: 0,
                  curr_month: 0,
                  prev_ytd: 0,
                  curr_ytd: 0,
                  prev_year_annual: null,
                  curr_year_annual: null,
                  description: "",
                  isExpanded: false,
                };
                l3Map.set(l3Key, l3Row);
                l2Row.children!.push(l3Row);
              }
              if (viewMode !== "ytd") {
                l3Row.curr_month += detail.amount;
              } else {
                l3Row.curr_ytd += detail.amount;
              }
            } else {
              if (viewMode !== "ytd") {
                l2Row.curr_month += detail.amount;
              } else {
                l2Row.curr_ytd += detail.amount;
              }
            }
          }
        } else {
          if (viewMode !== "ytd") {
            l1Row.curr_month += detail.amount;
          } else {
            l1Row.curr_ytd += detail.amount;
          }
        }
      } else {
        // 광고비가 아닌 경우: 기존 로직 (대분류 → 중분류 → 소분류)
        if (detail.cost_lv2 && detail.cost_lv2.trim() !== "") {
          const l2Key = `${l1Key}|${detail.cost_lv2}`;
          let l2Row = l2Map.get(l2Key);
          if (!l2Row) {
            l2Row = {
              id: `l2-${l1Key}-${detail.cost_lv2}`,
              level: 2,
              category_l1: l1Key,
              category_l2: detail.cost_lv2,
              category_l3: "",
              category_l2_cn: detail.cost_lv2_cn,
              category_l1_cn: detail.cost_lv1_cn,
              prev_month: 0,
              curr_month: 0,
              prev_ytd: 0,
              curr_ytd: 0,
              prev_year_annual: null,
              curr_year_annual: null,
              description: "",
              isExpanded: isRowExpanded(`l2-${l1Key}-${detail.cost_lv2}`),
              children: [],
            };
            l2Map.set(l2Key, l2Row);
            l1Row.children!.push(l2Row);
          }

          // 소분류 처리
          if (detail.cost_lv3 && detail.cost_lv3.trim() !== "") {
            const l3Key = `${l2Key}|${detail.cost_lv3}`;
            let l3Row = l3Map.get(l3Key);
            if (!l3Row) {
              l3Row = {
                id: `l3-${l1Key}-${detail.cost_lv2}-${detail.cost_lv3}`,
                level: 3,
                category_l1: l1Key,
                category_l2: detail.cost_lv2,
                category_l3: detail.cost_lv3,
                category_l2_cn: detail.cost_lv2_cn,
                category_l3_cn: detail.cost_lv3_cn,
                category_l1_cn: detail.cost_lv1_cn,
                prev_month: 0,
                curr_month: 0,
                prev_ytd: 0,
                curr_ytd: 0,
                prev_year_annual: null,
                curr_year_annual: null,
                description: "",
                isExpanded: false,
              };
              l3Map.set(l3Key, l3Row);
              l2Row.children!.push(l3Row);
            }

            // 소분류에 금액 추가
            if (viewMode !== "ytd") {
              l3Row.curr_month += detail.amount;
            } else {
              l3Row.curr_ytd += detail.amount;
            }
          } else {
            // 소분류가 없으면 중분류에 직접 추가
            if (viewMode !== "ytd") {
              l2Row.curr_month += detail.amount;
            } else {
              l2Row.curr_ytd += detail.amount;
            }
          }
        } else {
          // 중분류가 없으면 대분류에 직접 추가
          if (viewMode !== "ytd") {
            l1Row.curr_month += detail.amount;
          } else {
            l1Row.curr_ytd += detail.amount;
          }
        }
      }
    });

    // 실적 2026년 YTD 모드: 2026 예산(plan) 선택월까지 누적 → plan_ytd
    const is2026ActualYtd = year === 2026 && yearType === "actual" && viewMode === "ytd";
    if (is2026ActualYtd) {
      const planDetails = getCategoryDetail(bizUnitFilter, 2026, month, "", "ytd", "plan");
      const addPlanYtd = (detail: { cost_lv1?: string; cost_lv2?: string; cost_lv3?: string; biz_unit?: string; amount: number }) => {
        const l1Key = detail.cost_lv1 || "";
        if (!l1Key) return;
        const l1Row = l1Map.get(l1Key);
        if (!l1Row) return;
        const isAdExpense = l1Key === "광고비";
        const isInteriorDev = l1Key === "지급수수료" && detail.cost_lv2 === "인테리어 개발";
        const isTravelExpense = l1Key === "출장비" && (detail.cost_lv2 === "국내출장비" || detail.cost_lv2 === "해외출장비");
        const amt = detail.amount || 0;

        if (isAdExpense) {
          const bizUnitKey = detail.biz_unit || "기타";
          if (bizUnitFilter === "ALL" || bizUnitFilter === "법인") {
            const l2Key = `${l1Key}|${bizUnitKey}`;
            const l2Row = l2Map.get(l2Key);
            if (l2Row) {
              if (detail.cost_lv2 && detail.cost_lv2.trim() !== "") {
                const l3Key = `${l2Key}|${detail.cost_lv2}`;
                const l3Row = l3Map.get(l3Key);
                if (l3Row) { l3Row.plan_ytd = (l3Row.plan_ytd || 0) + amt; return; }
              }
              l2Row.plan_ytd = (l2Row.plan_ytd || 0) + amt;
            }
          } else {
            if (detail.cost_lv2 && detail.cost_lv2.trim() !== "") {
              const l2Key = `${l1Key}|${detail.cost_lv2}`;
              const l2Row = l2Map.get(l2Key);
              if (l2Row) { l2Row.plan_ytd = (l2Row.plan_ytd || 0) + amt; return; }
            }
            l1Row.plan_ytd = (l1Row.plan_ytd || 0) + amt;
          }
        } else if (isInteriorDev && detail.cost_lv2) {
          const l2Key = `${l1Key}|${detail.cost_lv2}`;
          const l2Row = l2Map.get(l2Key);
          if (l2Row) {
            const bizUnitKey = detail.biz_unit || "기타";
            if (bizUnitFilter === "ALL" || bizUnitFilter === "법인") {
              const l3Key = `${l2Key}|${bizUnitKey}`;
              let l3Row = l3Map.get(l3Key);
              if (l3Row) {
                if (detail.cost_lv3 && detail.cost_lv3.trim() !== "") {
                  const l4Key = `${l3Key}|${detail.cost_lv3}`;
                  const l4Row = l3Map.get(l4Key);
                  if (l4Row) { l4Row.plan_ytd = (l4Row.plan_ytd || 0) + amt; return; }
                }
                l3Row.plan_ytd = (l3Row.plan_ytd || 0) + amt;
              }
            } else {
              if (detail.cost_lv3) {
                const l3Key = `${l2Key}|${detail.cost_lv3}`;
                const l3Row = l3Map.get(l3Key);
                if (l3Row) { l3Row.plan_ytd = (l3Row.plan_ytd || 0) + amt; return; }
              }
              l2Row.plan_ytd = (l2Row.plan_ytd || 0) + amt;
            }
          }
        } else if (isTravelExpense && detail.cost_lv2) {
          const l2Key = `${l1Key}|${detail.cost_lv2}`;
          const l2Row = l2Map.get(l2Key);
          if (l2Row) {
            const bizUnitKey = detail.biz_unit || "기타";
            if (bizUnitFilter === "ALL" || bizUnitFilter === "법인") {
              const l3Key = `${l2Key}|${bizUnitKey}`;
              const l3Row = l3Map.get(l3Key);
              if (l3Row) {
                if (detail.cost_lv3 && detail.cost_lv3.trim() !== "") {
                  const l4Key = `${l3Key}|${detail.cost_lv3}`;
                  const l4Row = l3Map.get(l4Key);
                  if (l4Row) { l4Row.plan_ytd = (l4Row.plan_ytd || 0) + amt; return; }
                }
                l3Row.plan_ytd = (l3Row.plan_ytd || 0) + amt;
              }
            } else {
              if (detail.cost_lv3) {
                const l3Key = `${l2Key}|${detail.cost_lv3}`;
                const l3Row = l3Map.get(l3Key);
                if (l3Row) { l3Row.plan_ytd = (l3Row.plan_ytd || 0) + amt; return; }
              }
              l2Row.plan_ytd = (l2Row.plan_ytd || 0) + amt;
            }
          }
        } else {
          if (detail.cost_lv2 && detail.cost_lv2.trim() !== "") {
            const l2Key = `${l1Key}|${detail.cost_lv2}`;
            const l2Row = l2Map.get(l2Key);
            if (l2Row) {
              if (detail.cost_lv3 && detail.cost_lv3.trim() !== "") {
                const l3Key = `${l2Key}|${detail.cost_lv3}`;
                const l3Row = l3Map.get(l3Key);
                if (l3Row) { l3Row.plan_ytd = (l3Row.plan_ytd || 0) + amt; return; }
              }
              l2Row.plan_ytd = (l2Row.plan_ytd || 0) + amt;
            }
          } else {
            l1Row.plan_ytd = (l1Row.plan_ytd || 0) + amt;
          }
        }
      };
      planDetails.forEach(addPlanYtd);
    }

    // 전년 데이터는 이미 위에서 처리했으므로 여기서는 제거

    // 재귀적으로 하위 노드의 합계를 계산하는 헬퍼 함수
    const aggregateNode = (node: ExpenseAccountRow): {
      prevYtd: number;
      currYtd: number;
      prevYearAnnual: number;
      currYearAnnual: number;
      planYtd: number;
    } => {
      if (!node.children || node.children.length === 0) {
        return {
          prevYtd: node.prev_ytd,
          currYtd: node.curr_ytd,
          prevYearAnnual: node.prev_year_annual ?? 0,
          currYearAnnual: node.curr_year_annual ?? 0,
          planYtd: node.plan_ytd ?? 0,
        };
      }

      const childAggs = node.children.map(aggregateNode);
      const prevYtdSum = childAggs.reduce((sum, agg) => sum + agg.prevYtd, 0);
      const currYtdSum = childAggs.reduce((sum, agg) => sum + agg.currYtd, 0);
      const prevYearAnnualSum = childAggs.reduce((sum, agg) => sum + agg.prevYearAnnual, 0);
      const currYearAnnualSum = childAggs.reduce((sum, agg) => sum + agg.currYearAnnual, 0);
      const planYtdSum = childAggs.reduce((sum, agg) => sum + agg.planYtd, 0);

      return {
        prevYtd: prevYtdSum,
        currYtd: currYtdSum,
        prevYearAnnual: prevYearAnnualSum,
        currYearAnnual: currYearAnnualSum,
        planYtd: planYtdSum,
      };
    };

    // 연간 계획 데이터 처리 (먼저 개별 노드에 할당)
    const aggData = getAggregatedData();
    if (aggData.annual_data && aggData.annual_data.length > 0) {
      const bizUnitFilter: BizUnitOrAll = bizUnit || "ALL";
      // 당년 연간: 실적 2026년이면 2026 예산 연간 사용
      const currAnnualData = (year === 2026 && yearType === "actual")
        ? getAnnualData(bizUnitFilter, 2026, "", "", "", "plan")
        : getAnnualData(bizUnitFilter, year, "", "", "", yearType);
      currAnnualData.forEach((annual) => {
        const l1Key = annual.cost_lv1 || "";
        const l1Row = l1Map.get(l1Key);
        if (l1Row) {
          const isAdExpense = l1Key === "광고비";
          const isInteriorDev = l1Key === "지급수수료" && annual.cost_lv2 === "인테리어 개발";
          const isTravelExpense = l1Key === "출장비" && (annual.cost_lv2 === "국내출장비" || annual.cost_lv2 === "해외출장비");
          
          if (isAdExpense) {
            // 광고비인 경우: L2(브랜드) 하위 L3(비용상세)에 할당, L3 합계 = L2
            const bizUnitKey = annual.biz_unit || "기타";
            
            if (bizUnitFilter === "ALL" || bizUnitFilter === "법인") {
              const l2Key = `${l1Key}|${bizUnitKey}`;
              const l2Row = l2Map.get(l2Key);
              if (l2Row) {
                if (annual.cost_lv2 && annual.cost_lv2.trim() !== "") {
                  const l3Key = `${l2Key}|${annual.cost_lv2}`;
                  const l3Row = l3Map.get(l3Key);
                  if (l3Row) {
                    l3Row.curr_year_annual = annual.annual_amount;
                  }
                } else {
                  l2Row.curr_year_annual = annual.annual_amount;
                }
              }
            } else {
              // 브랜드 페이지: 대분류 → 중분류 (사업부구분 스킵)
              if (annual.cost_lv2 && annual.cost_lv2.trim() !== "") {
                const l2Key = `${l1Key}|${annual.cost_lv2}`;
                const l2Row = l2Map.get(l2Key);
                if (l2Row) {
                  l2Row.curr_year_annual = annual.annual_amount;
                }
              } else {
                l1Row.curr_year_annual = (l1Row.curr_year_annual || 0) + annual.annual_amount;
              }
            }
          } else if (isInteriorDev) {
            // 지급수수료 > 인테리어 개발인 경우
            if (annual.cost_lv2 && annual.cost_lv2.trim() !== "") {
              const l2Key = `${l1Key}|${annual.cost_lv2}`;
              const l2Row = l2Map.get(l2Key);
              if (l2Row) {
                const bizUnitKey = annual.biz_unit || "기타";
                
                if (bizUnitFilter === "ALL" || bizUnitFilter === "법인") {
                  // 홈 페이지 & 법인 페이지: 대분류 → 중분류 → 사업부구분 → 소분류
                  const l3Key = `${l2Key}|${bizUnitKey}`;
                  const l3Row = l3Map.get(l3Key);
                  if (l3Row) {
                    if (annual.cost_lv3 && annual.cost_lv3.trim() !== "") {
                      const l4Key = `${l3Key}|${annual.cost_lv3}`;
                      const l4Row = l3Map.get(l4Key);
                      if (l4Row) {
                        l4Row.curr_year_annual = annual.annual_amount;
                      }
                    } else {
                      l3Row.curr_year_annual = annual.annual_amount;
                    }
                  }
                } else {
                  // 브랜드 페이지: 대분류 → 중분류 → 소분류 (사업부구분 스킵)
                  if (annual.cost_lv3 && annual.cost_lv3.trim() !== "") {
                    const l3Key = `${l2Key}|${annual.cost_lv3}`;
                    const l3Row = l3Map.get(l3Key);
                    if (l3Row) {
                      l3Row.curr_year_annual = annual.annual_amount;
                    }
                  } else {
                    l2Row.curr_year_annual = (l2Row.curr_year_annual || 0) + annual.annual_amount;
                  }
                }
              }
            }
          } else if (isTravelExpense) {
            // 출장비 > 국내출장비/해외출장비인 경우
            if (annual.cost_lv2 && annual.cost_lv2.trim() !== "") {
              const l2Key = `${l1Key}|${annual.cost_lv2}`;
              const l2Row = l2Map.get(l2Key);
              if (l2Row) {
                const bizUnitKey = annual.biz_unit || "기타";
                
                if (bizUnitFilter === "ALL" || bizUnitFilter === "법인") {
                  // 홈 페이지 & 법인 페이지: 대분류 → 중분류 → 사업부구분 → 소분류
                  const l3Key = `${l2Key}|${bizUnitKey}`;
                  const l3Row = l3Map.get(l3Key);
                  if (l3Row) {
                    if (annual.cost_lv3 && annual.cost_lv3.trim() !== "") {
                      const l4Key = `${l3Key}|${annual.cost_lv3}`;
                      const l4Row = l3Map.get(l4Key);
                      if (l4Row) {
                        l4Row.curr_year_annual = annual.annual_amount;
                      }
                    } else {
                      l3Row.curr_year_annual = annual.annual_amount;
                    }
                  }
                } else {
                  // 브랜드 페이지: 대분류 → 중분류 → 소분류 (사업부구분 스킵)
                  if (annual.cost_lv3 && annual.cost_lv3.trim() !== "") {
                    const l3Key = `${l2Key}|${annual.cost_lv3}`;
                    const l3Row = l3Map.get(l3Key);
                    if (l3Row) {
                      l3Row.curr_year_annual = annual.annual_amount;
                    }
                  } else {
                    l2Row.curr_year_annual = (l2Row.curr_year_annual || 0) + annual.annual_amount;
                  }
                }
              }
            }
          } else {
            // 광고비가 아닌 경우: 기존 로직
            if (annual.cost_lv2 && annual.cost_lv2.trim() !== "") {
              const l2Key = `${l1Key}|${annual.cost_lv2}`;
              const l2Row = l2Map.get(l2Key);
              if (l2Row) {
                if (annual.cost_lv3 && annual.cost_lv3.trim() !== "") {
                  const l3Key = `${l2Key}|${annual.cost_lv3}`;
                  const l3Row = l3Map.get(l3Key);
                  if (l3Row) {
                    l3Row.curr_year_annual = annual.annual_amount;
                  }
                } else {
                  l2Row.curr_year_annual = annual.annual_amount;
                }
              }
            } else {
              l1Row.curr_year_annual = annual.annual_amount;
            }
          }
        }
      });

      // 전년 연간 데이터
      // 2026년(예산)은 prevYearDetails(2025년 12월 YTD actual)에서 이미 처리했으므로 빈 배열
      // 실적 2026 YTD: 2025년 연간 = 2025년 12월 YTD(1~12월 실적) 사용 (2026 예산과 동일)
      // 그 외 2026년: 전년(2025)은 이미 종료되어 실적만 사용
      const prevAnnualData = is2026AnnualOnly
        ? []
        : is2026ActualYtd
          ? aggregateCategoryDetailToAnnual(getCategoryDetail(bizUnitFilter, 2025, 12, "", "ytd", "actual"))
          : getAnnualData(bizUnitFilter, year - 1, "", "", "", year === 2026 ? "actual" : yearType);
      prevAnnualData.forEach((annual) => {
        const l1Key = annual.cost_lv1 || "";
        const l1Row = l1Map.get(l1Key);
        if (l1Row) {
          const isAdExpense = l1Key === "광고비";
          const isInteriorDev = l1Key === "지급수수료" && annual.cost_lv2 === "인테리어 개발";
          const isTravelExpense = l1Key === "출장비" && (annual.cost_lv2 === "국내출장비" || annual.cost_lv2 === "해외출장비");
          
          if (isAdExpense) {
            // 광고비인 경우: L2(브랜드) 하위 L3(비용상세)에 할당, L3 합계 = L2
            const bizUnitKey = annual.biz_unit || "기타";
            
            if (bizUnitFilter === "ALL" || bizUnitFilter === "법인") {
              const l2Key = `${l1Key}|${bizUnitKey}`;
              const l2Row = l2Map.get(l2Key);
              if (l2Row) {
                if (annual.cost_lv2 && annual.cost_lv2.trim() !== "") {
                  const l3Key = `${l2Key}|${annual.cost_lv2}`;
                  const l3Row = l3Map.get(l3Key);
                  if (l3Row) {
                    l3Row.prev_year_annual = annual.annual_amount;
                  }
                } else {
                  l2Row.prev_year_annual = annual.annual_amount;
                }
              }
            } else {
              // 브랜드 페이지: 대분류 → 중분류 (사업부구분 스킵)
              if (annual.cost_lv2 && annual.cost_lv2.trim() !== "") {
                const l2Key = `${l1Key}|${annual.cost_lv2}`;
                const l2Row = l2Map.get(l2Key);
                if (l2Row) {
                  l2Row.prev_year_annual = annual.annual_amount;
                }
              } else {
                l1Row.prev_year_annual = (l1Row.prev_year_annual || 0) + annual.annual_amount;
              }
            }
          } else if (isInteriorDev) {
            // 지급수수료 > 인테리어 개발인 경우
            if (annual.cost_lv2 && annual.cost_lv2.trim() !== "") {
              const l2Key = `${l1Key}|${annual.cost_lv2}`;
              const l2Row = l2Map.get(l2Key);
              if (l2Row) {
                const bizUnitKey = annual.biz_unit || "기타";
                
                if (bizUnitFilter === "ALL" || bizUnitFilter === "법인") {
                  // 홈 페이지 & 법인 페이지: 대분류 → 중분류 → 사업부구분 → 소분류
                  const l3Key = `${l2Key}|${bizUnitKey}`;
                  const l3Row = l3Map.get(l3Key);
                  if (l3Row) {
                    if (annual.cost_lv3 && annual.cost_lv3.trim() !== "") {
                      const l4Key = `${l3Key}|${annual.cost_lv3}`;
                      const l4Row = l3Map.get(l4Key);
                      if (l4Row) {
                        l4Row.prev_year_annual = annual.annual_amount;
                      }
                    } else {
                      l3Row.prev_year_annual = annual.annual_amount;
                    }
                  }
                } else {
                  // 브랜드 페이지: 대분류 → 중분류 → 소분류 (사업부구분 스킵)
                  if (annual.cost_lv3 && annual.cost_lv3.trim() !== "") {
                    const l3Key = `${l2Key}|${annual.cost_lv3}`;
                    const l3Row = l3Map.get(l3Key);
                    if (l3Row) {
                      l3Row.prev_year_annual = annual.annual_amount;
                    }
                  } else {
                    l2Row.prev_year_annual = (l2Row.prev_year_annual || 0) + annual.annual_amount;
                  }
                }
              }
            }
          } else if (isTravelExpense) {
            // 출장비 > 국내출장비/해외출장비인 경우
            if (annual.cost_lv2 && annual.cost_lv2.trim() !== "") {
              const l2Key = `${l1Key}|${annual.cost_lv2}`;
              const l2Row = l2Map.get(l2Key);
              if (l2Row) {
                const bizUnitKey = annual.biz_unit || "기타";
                
                if (bizUnitFilter === "ALL" || bizUnitFilter === "법인") {
                  // 홈 페이지 & 법인 페이지: 대분류 → 중분류 → 사업부구분 → 소분류
                  const l3Key = `${l2Key}|${bizUnitKey}`;
                  const l3Row = l3Map.get(l3Key);
                  if (l3Row) {
                    if (annual.cost_lv3 && annual.cost_lv3.trim() !== "") {
                      const l4Key = `${l3Key}|${annual.cost_lv3}`;
                      const l4Row = l3Map.get(l4Key);
                      if (l4Row) {
                        l4Row.prev_year_annual = annual.annual_amount;
                      }
                    } else {
                      l3Row.prev_year_annual = annual.annual_amount;
                    }
                  }
                } else {
                  // 브랜드 페이지: 대분류 → 중분류 → 소분류 (사업부구분 스킵)
                  if (annual.cost_lv3 && annual.cost_lv3.trim() !== "") {
                    const l3Key = `${l2Key}|${annual.cost_lv3}`;
                    const l3Row = l3Map.get(l3Key);
                    if (l3Row) {
                      l3Row.prev_year_annual = annual.annual_amount;
                    }
                  } else {
                    l2Row.prev_year_annual = (l2Row.prev_year_annual || 0) + annual.annual_amount;
                  }
                }
              }
            }
          } else {
            // 광고비가 아닌 경우: 기존 로직
            if (annual.cost_lv2 && annual.cost_lv2.trim() !== "") {
              const l2Key = `${l1Key}|${annual.cost_lv2}`;
              const l2Row = l2Map.get(l2Key);
              if (l2Row) {
                if (annual.cost_lv3 && annual.cost_lv3.trim() !== "") {
                  const l3Key = `${l2Key}|${annual.cost_lv3}`;
                  const l3Row = l3Map.get(l3Key);
                  if (l3Row) {
                    l3Row.prev_year_annual = annual.annual_amount;
                  }
                } else {
                  l2Row.prev_year_annual = annual.annual_amount;
                }
              }
            } else {
              l1Row.prev_year_annual = annual.annual_amount;
            }
          }
        }
      });
    }

    // Level 3 합계 계산 (하위 Level 4 합계) - 모든 Level 3에 대해 처리
    // Level 3 합계를 먼저 계산해야 Level 2 합계 계산 시 올바른 값이 반영됨
    l3Map.forEach((l3Row) => {
      if (l3Row.level === 3 && l3Row.children && l3Row.children.length > 0) {
        if (viewMode !== "ytd") {
          // 당월 모드: 소분류(level 4) 합계 계산
          let totalCurr = 0;
          let totalPrev = 0;
          l3Row.children.forEach((l4Row) => {
            totalCurr += l4Row.curr_month;
            totalPrev += l4Row.prev_month;
          });
          l3Row.curr_month = totalCurr;
          l3Row.prev_month = totalPrev;
        } else {
          const aggregated = aggregateNode(l3Row);
          l3Row.prev_ytd = aggregated.prevYtd;
          l3Row.curr_ytd = aggregated.currYtd;
          l3Row.prev_year_annual = aggregated.prevYearAnnual > 0 ? aggregated.prevYearAnnual : null;
          l3Row.curr_year_annual = aggregated.currYearAnnual > 0 ? aggregated.currYearAnnual : null;
          if (is2026ActualYtd && aggregated.planYtd > 0) l3Row.plan_ytd = aggregated.planYtd;
        }
      }
    });

    // 중분류 합계 계산 (하위 Level 3 합계) - 연간 계획 데이터 할당 후 실행
    // Level 3 합계 계산 후 실행하여 올바른 합계 반영
    l2Map.forEach((l2Row) => {
      if (l2Row.children && l2Row.children.length > 0) {
        if (viewMode !== "ytd") {
          // 당월 모드: Level 3 합계 계산
          let totalCurr = 0;
          let totalPrev = 0;
          l2Row.children.forEach((l3Row) => {
            totalCurr += l3Row.curr_month;
            totalPrev += l3Row.prev_month;
          });
          l2Row.curr_month = totalCurr;
          l2Row.prev_month = totalPrev;
        } else {
          const aggregated = aggregateNode(l2Row);
          l2Row.prev_ytd = aggregated.prevYtd;
          l2Row.curr_ytd = aggregated.currYtd;
          l2Row.prev_year_annual = aggregated.prevYearAnnual > 0 ? aggregated.prevYearAnnual : null;
          l2Row.curr_year_annual = aggregated.currYearAnnual > 0 ? aggregated.currYearAnnual : null;
          if (is2026ActualYtd && aggregated.planYtd > 0) l2Row.plan_ytd = aggregated.planYtd;
        }
      }
    });

    // 대분류 합계 계산 (하위 Level 2 합계) - 연간 계획 데이터 할당 후 실행
    l1Map.forEach((l1Row) => {
      if (l1Row.children && l1Row.children.length > 0) {
        if (viewMode !== "ytd") {
          // 당월 모드: 이미 계산된 Level 2 합계를 사용
          let totalCurr = 0;
          let totalPrev = 0;
          l1Row.children.forEach((l2Row) => {
            totalCurr += l2Row.curr_month;
            totalPrev += l2Row.prev_month;
          });
          l1Row.curr_month = totalCurr;
          l1Row.prev_month = totalPrev;
        } else {
          const aggregated = aggregateNode(l1Row);
          l1Row.prev_ytd = aggregated.prevYtd;
          l1Row.curr_ytd = aggregated.currYtd;
          l1Row.prev_year_annual = aggregated.prevYearAnnual > 0 ? aggregated.prevYearAnnual : null;
          l1Row.curr_year_annual = aggregated.currYearAnnual > 0 ? aggregated.currYearAnnual : null;
          if (is2026ActualYtd && aggregated.planYtd > 0) l1Row.plan_ytd = aggregated.planYtd;
        }
      }
    });

    // 2026(예산) 연간 전용 뷰: 2025년 연간(실적) = 2025년 12월 YTD 실적로 통일 (prev_ytd 사용)
    if (is2026AnnualOnly && !(viewMode !== "ytd")) {
      const setPrevYearAnnualFromYtd = (row: ExpenseAccountRow) => {
        row.prev_year_annual = row.prev_ytd > 0 ? row.prev_ytd : null;
        row.children?.forEach(setPrevYearAnnualFromYtd);
      };
      l1Map.forEach(setPrevYearAnnualFromYtd);
    }

    // 대분류 순서 정의 (홈 대시보드와 동일)
    const categoryOrder = [
      "인건비",
      "복리후생비",
      "광고비",
      "수주회",
      "출장비",
      "지급수수료",
      "IT수수료",
      "감가상각비",
      "임차료",
      "세금과공과",
      "기타",
      "차량렌트비",
    ];

    // 사업부구분 순서 정의 (광고비의 경우)
    const bizUnitOrder = ["MLB", "KIDS", "DISCOVERY", "공통"];

    // 인건비 하위항목 순서 정의
    const laborCostOrder = ["기본급", "Red pack", "성과급충당금", "실제 지급 성과급", "잡급"];

    // 지급수수료 하위항목 순서 정의
    const paymentFeeOrder = ["인사", "법무", "재무", "Supply Chain", "Office Service", "인테리어 개발"];

    // 소분류 레벨 사업부구분 순서 정의 (경영지원 있는 경우 / 수주회는 경영지원 없음)
    const subcategoryOrderWithSupport = ["경영지원", "MLB", "KIDS", "DISCOVERY"];
    const subcategoryOrderNoSupport = ["MLB", "KIDS", "DISCOVERY"];

    // 광고비의 사업부구분 children 정렬
    l1Map.forEach((l1Row) => {
      if (l1Row.category_l1 === "광고비" && l1Row.children) {
        l1Row.children.sort((a, b) => {
          const bizUnitA = a.biz_unit || "";
          const bizUnitB = b.biz_unit || "";
          const indexA = bizUnitOrder.indexOf(bizUnitA);
          const indexB = bizUnitOrder.indexOf(bizUnitB);
          
          // 순서에 없는 항목은 맨 뒤로
          if (indexA === -1 && indexB === -1) return 0;
          if (indexA === -1) return 1;
          if (indexB === -1) return -1;
          
          return indexA - indexB;
        });
      }
      
      // 인건비의 중분류 children 정렬
      if (l1Row.category_l1 === "인건비" && l1Row.children) {
        l1Row.children.sort((a, b) => {
          const categoryA = a.category_l2 || "";
          const categoryB = b.category_l2 || "";
          const indexA = laborCostOrder.indexOf(categoryA);
          const indexB = laborCostOrder.indexOf(categoryB);
          
          // 순서에 없는 항목은 맨 뒤로
          if (indexA === -1 && indexB === -1) return 0;
          if (indexA === -1) return 1;
          if (indexB === -1) return -1;
          
          return indexA - indexB;
        });
      }

      // 지급수수료의 중분류 children 정렬
      if (l1Row.category_l1 === "지급수수료" && l1Row.children) {
        l1Row.children.sort((a, b) => {
          const categoryA = a.category_l2 || "";
          const categoryB = b.category_l2 || "";
          const indexA = paymentFeeOrder.indexOf(categoryA);
          const indexB = paymentFeeOrder.indexOf(categoryB);
          
          // 순서에 없는 항목은 맨 뒤로
          if (indexA === -1 && indexB === -1) return 0;
          if (indexA === -1) return 1;
          if (indexB === -1) return -1;
          
          return indexA - indexB;
        });
      }

      // IT수수료의 중분류 children 정렬 (당년도 금액 크기 순)
      if (l1Row.category_l1 === "IT수수료" && l1Row.children) {
        l1Row.children.sort((a, b) => {
          // viewMode에 따라 당년도 값 결정
          const valueA = viewMode !== "ytd" ? (a.curr_month ?? 0) : (a.curr_ytd ?? 0);
          const valueB = viewMode !== "ytd" ? (b.curr_month ?? 0) : (b.curr_ytd ?? 0);
          
          // 내림차순 (큰 금액부터)
          return valueB - valueA;
        });
      }
    });

    // 중분류의 소분류 children 정렬 (소분류가 있는 경우)
    l2Map.forEach((l2Row) => {
      if (l2Row.children && l2Row.children.length > 0) {
        const order = l2Row.category_l1 === "수주회" ? subcategoryOrderNoSupport : subcategoryOrderWithSupport;
        l2Row.children.sort((a, b) => {
          const subcategoryA = a.category_l3 || "";
          const subcategoryB = b.category_l3 || "";
          const indexA = order.indexOf(subcategoryA);
          const indexB = order.indexOf(subcategoryB);
          
          // 순서에 없는 항목은 맨 뒤로
          if (indexA === -1 && indexB === -1) return 0;
          if (indexA === -1) return 1;
          if (indexB === -1) return -1;
          
          return indexA - indexB;
        });
      }
    });

    // 순서에 따라 정렬
    const sortedL1Rows = Array.from(l1Map.values()).sort((a, b) => {
      const indexA = categoryOrder.indexOf(a.category_l1);
      const indexB = categoryOrder.indexOf(b.category_l1);
      
      // 순서에 없는 항목은 맨 뒤로
      if (indexA === -1 && indexB === -1) return 0;
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      
      return indexA - indexB;
    });

    return sortedL1Rows;
  }, [bizUnit, year, month, viewMode, expandedRows, is2026AnnualOnly, yearType]);

  // 계층 데이터가 준비되면 부모에게 전달
  useEffect(() => {
    if (onHierarchyReady) {
      onHierarchyReady(hierarchicalData);
    }
  }, [hierarchicalData, onHierarchyReady]);

  // 평면화된 행 리스트 생성 (렌더링용) - 전년·당년 모두 없으면 해당 항목 숨김
  const flattenedRows = useMemo(() => {
    const result: ExpenseAccountRow[] = [];

    const traverse = (rows: ExpenseAccountRow[]) => {
      rows.forEach((row) => {
        let shouldHide = false;
        if (viewMode !== "ytd") {
          shouldHide = (row.curr_month ?? 0) === 0 && (row.prev_month ?? 0) === 0;
        } else if (is2026AnnualOnly) {
          shouldHide = (row.prev_year_annual ?? 0) === 0 && (row.curr_year_annual ?? 0) === 0;
        } else {
          shouldHide = (row.prev_ytd ?? 0) === 0 && (row.curr_ytd ?? 0) === 0;
        }
        if (shouldHide) {
          if (row.isExpanded && row.children && row.children.length > 0) {
            traverse(row.children);
          }
          return;
        }

        result.push(row);
        if (row.isExpanded && row.children && row.children.length > 0) {
          traverse(row.children);
        }
      });
    };

    traverse(hierarchicalData);
    return result;
  }, [hierarchicalData, viewMode, is2026AnnualOnly]);

  const toggleRow = (rowId: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(rowId)) {
      newExpanded.delete(rowId);
    } else {
      newExpanded.add(rowId);
    }
    setExpandedRows(newExpanded);
  };

  const expandAll = () => {
    // 대분류(level 1)까지만 펼치기
    const level1Ids = new Set<string>();
    hierarchicalData.forEach((row) => {
      // level 1이고 자식이 있는 경우만 추가
      if (row.level === 1 && row.children && row.children.length > 0) {
        level1Ids.add(row.id);
      }
    });
    setExpandedRows(level1Ids);
  };

  const collapseAll = () => {
    setExpandedRows(new Set());
  };

  const isAllExpanded = useMemo(() => {
    // 대분류(level 1)까지만 확인
    const level1Ids = new Set<string>();
    hierarchicalData.forEach((row) => {
      if (row.level === 1 && row.children && row.children.length > 0) {
        level1Ids.add(row.id);
      }
    });
    // level 1 행이 있고, 모두 펼쳐져 있는지 확인
    return level1Ids.size > 0 && Array.from(level1Ids).every((id) => expandedRows.has(id));
  }, [hierarchicalData, expandedRows]);

  const handleExpandCollapseAll = () => {
    if (isAllExpanded) {
      collapseAll();
    } else {
      expandAll();
    }
  };

  // 계산 헬퍼 함수
  const getDifference = (current: number, previous: number): number => {
    return current - previous;
  };

  const getYOY = (current: number, previous: number): number | null => {
    return calculateYOY(current, previous);
  };

  const getProgressRate = (ytd: number, annual: number | null): number | null => {
    if (annual === null || annual === 0) return null;
    return (ytd / annual) * 100;
  };

  const getYOYColor = (yoy: number | null): string => {
    if (yoy === null) return "text-gray-600";
    if (Math.abs(yoy - 100) < 0.1) return "text-gray-600";
    if (yoy > 100) return "text-red-500";
    return "text-blue-600";
  };

  // 차이금액 포맷 (양수는 +, 마이너스는 △로 표시)
  const formatDifference = (value: number | null | undefined): string => {
    if (value === null || value === undefined || isNaN(value)) {
      return "-";
    }
    if (value === 0) {
      return "0";
    }
    if (value < 0) {
      // 마이너스는 △로 표시하고 절댓값 사용
      return `△${formatK(Math.abs(value))}`;
    }
    // 양수는 + 표시
    return `+${formatK(value)}`;
  };

  // 인건비 대분류 행의 설명 자동 계산 (기본급 설명 재사용)
  const calculateLaborCostDescription = (row: ExpenseAccountRow): string => {
    // 인건비 대분류(level 1)이고 당월 모드인 경우만 계산
    if (
      row.category_l1 !== "인건비" ||
      row.level !== 1 ||
      viewMode !== "monthly"
    ) {
      return "";
    }

    // 인건비 대분류의 children에서 기본급 행 찾기
    if (!row.children || row.children.length === 0) {
      return "";
    }

    const basicSalaryRow = row.children.find(
      (child) => child.category_l2 === "기본급"
    );

    if (!basicSalaryRow) {
      return "";
    }

    // 기본급 행의 설명 가져오기
    const basicSalaryDescription = calculateBasicSalaryDescription(basicSalaryRow);

    // 기본급 설명이 "-"이면 그대로 반환
    if (basicSalaryDescription === "-" || !basicSalaryDescription) {
      return "-";
    }

    // "인당 인건비"를 "인당 기본급"으로 치환 (언어별)
    return basicSalaryDescription.replace(t("인당 인건비", lang), t("인당 기본급", lang));
  };

  // 인건비 > 기본급 행의 설명 자동 계산 (KPI 카드 상세보기와 동일하게 getMonthlyTotal 사용)
  // 기본급(level 2): 법인 전체 headcount. 하위(경영지원, MLB, KIDS, DISCOVERY): 각 사업부별 headcount
  const SUB_CATEGORY_TO_BIZ: Record<string, BizUnit> = {
    경영지원: "공통",
    MLB: "MLB",
    KIDS: "KIDS",
    DISCOVERY: "DISCOVERY",
  };
  const calculateBasicSalaryDescription = (row: ExpenseAccountRow): string => {
    // 인건비 > 기본급이고 당월 또는 YTD 모드인 경우만 계산
    if (
      row.category_l1 !== "인건비" ||
      row.category_l2 !== "기본급" ||
      (viewMode !== "monthly" && viewMode !== "ytd")
    ) {
      return "";
    }

    // 기본급(level 2) 또는 하위(경영지원, MLB, KIDS, DISCOVERY)만 적용
    const isSubLevel =
      row.level === 3 && row.category_l3 && SUB_CATEGORY_TO_BIZ[row.category_l3];
    const isBasicSalaryTotal = row.level === 2;
    if (!isBasicSalaryTotal && !isSubLevel) {
      return "";
    }

    try {
      // KPI 카드 상세보기와 동일: level 2는 법인 전체, level 3은 해당 사업부 headcount
      const effectiveBizUnit: BizUnit = isSubLevel
        ? SUB_CATEGORY_TO_BIZ[row.category_l3!]
        : bizUnit === "ALL"
          ? "법인"
          : bizUnit;

      const yoyLabel = t("전년비", lang);
      const unitName = t("명", lang);
      const perCapitaLabel = t("인당 인건비", lang);

      // ── YTD 모드 ──
      if (viewMode === "ytd") {
        // 평균 인원수 = 1~N월 headcount 합계 / 월수
        const currYtdSum = getYTDHeadcountSum(effectiveBizUnit, year, month, yearType);
        const prevYtdSum = getYTDHeadcountSum(effectiveBizUnit, year - 1, month, yearType);
        const currAvgHeadcount = currYtdSum / month;
        const prevAvgHeadcount = prevYtdSum / month;

        if (currAvgHeadcount === 0 || isNaN(currAvgHeadcount)) {
          return "-";
        }

        // 누적 인당 인건비 = curr_ytd / 누적인원수합계 / 1000 (K 단위)
        const currAmount = row.curr_ytd;
        const prevAmount = row.prev_ytd;
        const currPerPersonCostK = currAmount / currYtdSum / 1000;

        let prevPerPersonCostK: number | null = null;
        let ratioPercent: number | null = null;

        if (
          prevYtdSum > 0 &&
          !isNaN(prevAvgHeadcount) &&
          prevAmount !== null &&
          prevAmount !== undefined &&
          !isNaN(prevAmount)
        ) {
          prevPerPersonCostK = prevAmount / prevYtdSum / 1000;
          if (prevPerPersonCostK > 0) {
            ratioPercent = (currPerPersonCostK / prevPerPersonCostK) * 100;
          }
        }

        let result = `[평균 인원수 ${Math.round(currAvgHeadcount)}${unitName}`;

        // 인원수 전년비: 절대값 차이(명)
        if (prevAvgHeadcount > 0 && !isNaN(prevAvgHeadcount)) {
          const headcountDiff = currAvgHeadcount - prevAvgHeadcount;
          const diffSign = headcountDiff >= 0 ? "+" : "";
          result += `, ${yoyLabel} ${diffSign}${Math.round(headcountDiff)}${unitName}`;
        }

        result += ` | ${perCapitaLabel} ${currPerPersonCostK.toFixed(1)}K`;

        // 인당 인건비 전년비: 전년 대비 비율 (전년=100% 기준)
        if (ratioPercent !== null && !isNaN(ratioPercent)) {
          result += `, ${yoyLabel} ${ratioPercent.toFixed(0)}%`;
        } else {
          result += `, ${yoyLabel} -`;
        }

        result += `]`;
        return result;
      }

      // ── 당월 모드 ──
      const currHeadcount =
        getMonthlyTotal(effectiveBizUnit, year, month, "monthly", yearType)?.headcount ?? 0;
      const prevHeadcount =
        getMonthlyTotal(effectiveBizUnit, year - 1, month, "monthly", yearType)?.headcount ?? 0;

      // 인원수가 0이면 "-" 반환
      if (currHeadcount === 0 || isNaN(currHeadcount)) {
        return "-";
      }

      // 당년 인당 인건비 계산
      const currAmount = row.curr_month;
      const currPerPersonCostK = currAmount / currHeadcount / 1000; // K 단위

      // 전년 인당 인건비 계산
      const prevAmount = row.prev_month;
      let prevPerPersonCostK: number | null = null;
      let ratioPercent: number | null = null;

      if (
        prevHeadcount > 0 &&
        !isNaN(prevHeadcount) &&
        prevAmount !== null &&
        prevAmount !== undefined &&
        !isNaN(prevAmount)
      ) {
        prevPerPersonCostK = prevAmount / prevHeadcount / 1000; // K 단위

        // 전년 대비 비율: (당년 / 전년) × 100
        if (prevPerPersonCostK > 0) {
          ratioPercent = (currPerPersonCostK / prevPerPersonCostK) * 100;
        }
      }

      // 포맷팅 (언어별)
      const prefix = t("당월 인원수", lang);
      let result = `[${prefix} ${Math.round(currHeadcount)}${unitName}`;

      // 전년 동월 대비 인원수 증감 계산 및 표시
      if (prevHeadcount > 0 && !isNaN(prevHeadcount)) {
        const headcountDiff = currHeadcount - prevHeadcount;
        if (headcountDiff !== 0) {
          const diffSign = headcountDiff > 0 ? "+" : "";
          result += `, ${yoyLabel} ${diffSign}${Math.round(headcountDiff)}${unitName}`;
        } else {
          result += `, ${yoyLabel} 0${unitName}`;
        }
      }

      result += ` | ${perCapitaLabel} ${currPerPersonCostK.toFixed(1)}K`;

      // 인당 인건비 전년비: 전년 대비 비율 (전년=100% 기준)
      if (ratioPercent !== null && !isNaN(ratioPercent)) {
        result += `, ${yoyLabel} ${ratioPercent.toFixed(0)}%`;
      } else {
        result += `, ${yoyLabel} -`;
      }

      result += `]`;
      return result;
    } catch (error) {
      console.error("기본급 설명 계산 오류:", error);
      return "-";
    }
  };

  // YOY 포맷 (소수점 없이)
  const formatYOY = (value: number | null | undefined): string => {
    if (value === null || value === undefined || isNaN(value)) {
      return "-";
    }
    return `${Math.round(value)}%`;
  };

  // Leaf 노드만 추출하는 함수
  const getLeafNodes = (rows: ExpenseAccountRow[]): ExpenseAccountRow[] => {
    const leaves: ExpenseAccountRow[] = [];
    const traverse = (nodes: ExpenseAccountRow[]) => {
      nodes.forEach((node) => {
        if (!node.children || node.children.length === 0) {
          // Leaf 노드
          leaves.push(node);
        } else {
          // 자식이 있으면 재귀적으로 탐색
          traverse(node.children);
        }
      });
    };
    traverse(rows);
    return leaves;
  };

  // 전체 합계 계산 함수
  const computeTotals = useMemo(() => {
    const leaves = getLeafNodes(hierarchicalData);
    
    if (viewMode !== "ytd") {
      // 당월 모드
      const prevTotal = leaves.reduce((sum, leaf) => sum + leaf.prev_month, 0);
      const currTotal = leaves.reduce((sum, leaf) => sum + leaf.curr_month, 0);
      const diffTotal = currTotal - prevTotal;
      const yoyTotal = prevTotal > 0 ? (currTotal / prevTotal) * 100 : null;
      
      return {
        prevTotal,
        currTotal,
        diffTotal,
        yoyTotal,
        prevYtdTotal: null,
        currYtdTotal: null,
        diffYtdTotal: null,
        yoyYtdTotal: null,
        planYtdTotal: 0,
        planDiffTotal: null,
        annual2024Total: null,
        annual2025Total: null,
        diffAnnualTotal: null,
        yoyAnnualTotal: null,
        progressTotal: null,
        usageRateTotal: null,
      };
    } else {
      // 누적(YTD) 모드: 전체 합계 = 표시되는 L1(대분류) 행 합계와 정확히 일치하도록 L1 기준으로 계산
      const prevYtdTotal = hierarchicalData.reduce((sum, row) => sum + row.prev_ytd, 0);
      const currYtdTotal = hierarchicalData.reduce((sum, row) => sum + row.curr_ytd, 0);
      const diffYtdTotal = currYtdTotal - prevYtdTotal;
      const yoyYtdTotal = prevYtdTotal > 0 ? (currYtdTotal / prevYtdTotal) * 100 : null;

      const is2026ActualYtd = year === 2026 && yearType === "actual";
      const planYtdTotal = is2026ActualYtd
        ? hierarchicalData.reduce((sum, row) => sum + (row.plan_ytd ?? 0), 0)
        : 0;

      let annual2024Total: number;
      let annual2025Total: number;
      if (is2026AnnualOnly && bizUnit !== "ALL") {
        annual2024Total = getMonthlyTotal(bizUnit as BizUnit, 2025, 12, "ytd", "actual")?.amount ?? 0;
        annual2025Total = hierarchicalData.reduce((sum, row) => sum + (row.curr_year_annual ?? row.curr_ytd ?? 0), 0);
      } else {
        annual2024Total = hierarchicalData.reduce((sum, row) => sum + (row.prev_year_annual ?? 0), 0);
        annual2025Total = hierarchicalData.reduce((sum, row) => sum + (is2026AnnualOnly ? (row.curr_year_annual ?? row.curr_ytd ?? 0) : (row.curr_year_annual ?? 0)), 0);
      }
      const diffAnnualTotal = annual2025Total - annual2024Total;
      const yoyAnnualTotal = annual2024Total > 0 ? (annual2025Total / annual2024Total) * 100 : null;
      const progressTotal = is2026ActualYtd
        ? (planYtdTotal > 0 ? (currYtdTotal / planYtdTotal) * 100 : null)
        : (annual2025Total > 0 ? (currYtdTotal / annual2025Total) * 100 : null);
      const planDiffTotal = is2026ActualYtd
        ? currYtdTotal - planYtdTotal
        : currYtdTotal - annual2025Total;

      // 사용률 합계: 당년누적 / 2026년연간계획 × 100 (2026실적YTD 전용)
      const usageRateTotal = is2026ActualYtd && annual2025Total > 0
        ? (currYtdTotal / annual2025Total) * 100
        : null;
      
      return {
        prevTotal: null,
        currTotal: null,
        diffTotal: null,
        yoyTotal: null,
        prevYtdTotal,
        currYtdTotal,
        diffYtdTotal,
        yoyYtdTotal,
        planYtdTotal,
        planDiffTotal,
        annual2024Total,
        annual2025Total,
        diffAnnualTotal,
        yoyAnnualTotal,
        progressTotal,
        usageRateTotal,
      };
    }
  }, [hierarchicalData, viewMode, is2026AnnualOnly, bizUnit, year, yearType]);

  // 2026 연간 뷰 시 부모에 연간 합계 전달 (KPI 카드 등에서 표 합계 재사용용)
  useEffect(() => {
    if (
      is2026AnnualOnly &&
      bizUnit !== "ALL" &&
      onAnnualTotalsChange &&
      computeTotals.annual2024Total != null &&
      computeTotals.annual2025Total != null
    ) {
      onAnnualTotalsChange({
        prevYear: computeTotals.annual2024Total,
        currYear: computeTotals.annual2025Total,
      });
    }
  }, [is2026AnnualOnly, bizUnit, onAnnualTotalsChange, computeTotals]);

  // 전체 합계의 대분류별 당월 차이 설명 자동 생성 (항상 당월 기준)
  const totalDescription = useMemo(() => {
    if (hierarchicalData.length === 0) return "-";
    
    // 대분류별 당월 차이 계산 (언어별 표시명 사용)
    const diffs: { name: string; diff: number }[] = hierarchicalData.map((l1Row) => ({
      name: getDisplayLabel(l1Row.category_l1, l1Row.category_l1_cn, lang),
      diff: l1Row.curr_month - l1Row.prev_month,
    }));
    
    // 차이가 0이 아닌 항목만 필터링하고 절대값 기준 내림차순 정렬
    const significantDiffs = diffs
      .filter((d) => Math.abs(d.diff) >= 1000) // 1K 이상만 표시
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    
    if (significantDiffs.length === 0) return "-";
    
    // 포맷팅: "광고비 +225K, 인건비 △444K, ..."
    const formatted = significantDiffs.map((d) => {
      const sign = d.diff >= 0 ? "+" : "△";
      const absValue = Math.abs(d.diff);
      return `${d.name} ${sign}${formatK(absValue)}`;
    });
    
    return formatted.join(", ");
  }, [hierarchicalData, lang]);

  // YOY/진척률 Badge 스타일 함수
  const getYOYBadgeClass = (value: number | null): string => {
    if (value === null || value === undefined || isNaN(value)) {
      return "inline-flex items-center rounded-full px-2 py-0.5 text-[15px] font-semibold bg-gray-100 text-gray-500";
    }
    if (value >= 100) {
      return "inline-flex items-center rounded-full px-2 py-0.5 text-[15px] font-semibold bg-pink-100 text-pink-700";
    }
    return "inline-flex items-center rounded-full px-2 py-0.5 text-[15px] font-semibold bg-blue-100 text-blue-700";
  };

  return (
    <>
      <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden backdrop-blur-sm">
      {/* 상단 헤더 */}
      <div className="bg-slate-800 border-b-2 border-slate-600">
        <div className="px-4 py-4 sm:px-6 sm:py-5 md:px-8 md:py-6">
          <div className="flex items-center justify-between">
            {/* 왼쪽: 제목 + 날짜 태그 */}
            <div className="flex items-center gap-2 sm:gap-3 md:gap-4">
              <h2 className="font-bold text-slate-50 text-[12px] sm:text-[13.5px] md:text-[15px] lg:text-[21px] xl:text-[24px]">
                {title || t("전체 비용 계정 상세 분석", lang)}
              </h2>
              <div className="flex items-center gap-1.5 sm:gap-2 px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-1.5 rounded-full border border-slate-600 bg-slate-700/50">
                <Calendar className="w-3 h-3 sm:w-4 sm:h-4 text-slate-200" />
                <span className="text-[13.5px] sm:text-[15px] font-medium text-slate-200">
                  {is2026AnnualOnly
                    ? t("2026년 연간기준", lang)
                    : viewMode === "monthly" ? `${year}${t("년", lang)} ${month}${t("월", lang)} ${t("기준", lang)}`
                    : viewMode === "ytd" ? `${year}${t("년", lang)} 1~${month}${t("월", lang)} ${t("누적", lang)}`
                    : `${year}${t("년", lang)} ${viewMode.slice(1)}${t("분기", lang)} ${t("기준", lang)}`}
                </span>
              </div>
            </div>
            {/* 우측: 현재 모드 표시 (상단 페이지 탭에서 이미 전환하므로 내부 탭은 제거) */}
            <div className="flex items-center gap-2 sm:gap-3">
              {is2026AnnualOnly && (
                <span className="text-[13.5px] sm:text-[15px] font-medium text-slate-200 px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 rounded-lg border border-slate-600 bg-slate-700/50">
                  {t("연간 계획 (2025 실적 vs 2026 계획)", lang)}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleExpandCollapseAll}
                className="flex items-center gap-2 min-w-[100px] sm:min-w-[120px] md:min-w-[140px] justify-center px-2 py-1.5 sm:px-3 sm:py-2 md:px-4 md:py-2 bg-slate-700/50 border-slate-600 text-slate-200 hover:bg-slate-600 hover:text-slate-50 font-medium shadow-md hover:shadow-lg transition-all duration-200 text-[13.5px] sm:text-[15px]"
              >
                <ChevronsDownUp className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="whitespace-nowrap">{isAllExpanded ? t("모두 접기", lang) : t("모두 펼치기", lang)}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={requestReset}
                className="flex items-center gap-2 min-w-[80px] sm:min-w-[90px] justify-center px-2 py-1.5 sm:px-3 sm:py-2 md:px-4 md:py-2 bg-slate-700/50 border-slate-600 text-slate-200 hover:bg-slate-600 hover:text-slate-50 font-medium shadow-md hover:shadow-lg transition-all duration-200 text-[13.5px] sm:text-[15px]"
              >
                <RotateCcw className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="whitespace-nowrap">{t("초기화", lang)}</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 테이블 */}
      <div className="overflow-x-auto bg-white">
        <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
          <colgroup>
            {viewMode !== "ytd" && !is2026AnnualOnly ? (
              <>
                {/* 당월 모드: 구분 15% + 당월 데이터 4개 각 10% + 설명 45% */}
                <col style={{ width: "15%" }} />
                <col style={{ width: "0%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "0%" }} />
                <col style={{ width: "45%" }} />
              </>
            ) : is2026AnnualOnly ? (
              <>
                {/* 2026 연간만: 구분 20%, 전년/당년/차이/YOY 각 6%, 계산근거·설명 각 28% */}
                <col style={{ width: "20%" }} />
                <col style={{ width: "6%" }} />
                <col style={{ width: "6%" }} />
                <col style={{ width: "6%" }} />
                <col style={{ width: "6%" }} />
                <col style={{ width: "28%" }} />
                <col style={{ width: "28%" }} />
              </>
            ) : (
              <>
                {/* 누적(YTD) 모드: 구분 13% + 전년/당년/차이/YOY/계획누적/계획비증감/계획비(%) + 연간계획 + 설명 */}
                <col style={{ width: "13%" }} />
                <col style={{ width: "0%" }} />
                <col style={{ width: "6%" }} />
                <col style={{ width: "6%" }} />
                <col style={{ width: "6%" }} />
                <col style={{ width: "5%" }} />
                <col style={{ width: "5%" }} />
                <col style={{ width: "5%" }} />
                <col style={{ width: "5%" }} />
                <col style={{ width: "5%" }} />
                <col style={{ width: "0%" }} />
                <col style={{ width: "6%" }} />
                <col style={{ width: "6%" }} />
                <col style={{ width: "6%" }} />
                <col style={{ width: "6%" }} />
                <col style={{ width: "0%" }} />
                <col style={{ width: "22%" }} />
              </>
            )}
          </colgroup>
          <thead className="sticky top-0 z-10">
            {/* 첫 번째 헤더 행 */}
            <tr className="bg-slate-800 border-b border-slate-600">
              {is2026AnnualOnly ? (
                <>
                  <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-left text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">구분</th>
                  <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    <div>{year - 1}{t("년 연간", lang)}</div>
                    <div>{t("(실적)", lang)}</div>
                  </th>
                  <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    <div>{year}{t("년 연간", lang)}</div>
                    <div>{t("(계획)", lang)}</div>
                  </th>
                  <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    <div>YOY</div>
                    <div>({t("금액", lang)})</div>
                  </th>
                  <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    <div>YOY</div>
                    <div>(%)</div>
                  </th>
                  <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">계산근거</th>
                  <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-left text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">{t("설명", lang)}</th>
                </>
              ) : (
                <>
              <th rowSpan={2} className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-left text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    {t("구분", lang)}
              </th>
              <th className="border-r border-slate-600"></th>
              {viewMode !== "ytd" ? (
                <>
                  <th colSpan={4} className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    {viewMode === "monthly" ? t("당월 데이터", lang) : `${viewMode.slice(1)}${t("분기 데이터", lang)}`}
                  </th>
                  <th className="border-r border-slate-600"></th>
                  <th rowSpan={2} className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-left text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    {t("설명", lang)}
                  </th>
                </>
              ) : (
                <>
                  <th colSpan={year === 2026 && yearType === "actual" ? 8 : 7} className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    {t("누적(YTD)", lang)}
                  </th>
                  <th className="border-r border-slate-600"></th>
                  <th colSpan={4} className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    {t("연간 계획", lang)}
                  </th>
                  <th className="border-r border-slate-600"></th>
                  <th rowSpan={2} className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-left text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    {t("설명", lang)}
                  </th>
                </>
              )}
                </>
              )}
            </tr>
            {/* 두 번째 헤더 행: 2026 연간만일 때는 렌더하지 않음 (헤더 1줄) */}
            {!is2026AnnualOnly && (
            <tr className="bg-slate-800 border-b-2 border-slate-600">
              <th className="border-r border-slate-600"></th>
              {viewMode !== "ytd" ? (
                <>
                  <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    {t("전년", lang)}
                  </th>
                  <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    {viewMode === "monthly" ? t("당월", lang) : `${viewMode.slice(1)}${t("분기", lang)}`}
                  </th>
                  <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    {t("차이(금액)", lang)}
                  </th>
                  <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    YOY (%)
                  </th>
                  <th className="border-r border-slate-600"></th>
                </>
              ) : (
                <>
                  <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    <div>{t("전년", lang)}</div>
                    <div>{t("누적", lang)}</div>
                  </th>
                  <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    <div>{t("당년", lang)}</div>
                    <div>{t("누적", lang)}</div>
                  </th>
                  <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    <div>YOY</div>
                    <div>({t("금액", lang)})</div>
                  </th>
                  <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    <div>YOY</div>
                    <div>(%)</div>
                  </th>
                  <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    <div>{t("계획", lang)}</div>
                    <div>{t("누적", lang)}</div>
                  </th>
                  <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    <div>{t("계획비", lang)}</div>
                    <div>({t("금액", lang)})</div>
                  </th>
                  <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    <div>{t("계획비", lang)}</div>
                    <div>(%)</div>
                  </th>
                  {year === 2026 && yearType === "actual" && (
                    <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center align-middle text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-amber-200 min-w-[3.5rem]">
                      <div className="flex flex-col items-center justify-center text-center">
                        <div className="whitespace-nowrap">{t("사용률", lang)}</div>
                        <div>(%)</div>
                      </div>
                    </th>
                  )}
                  <th className="border-r border-slate-600"></th>
                  <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    <div>{year - 1}{t("년", lang)}</div>
                    <div>{t("연간", lang)}</div>
                  </th>
                  <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    <div>{year}{t("년", lang)}</div>
                    <div>{t("연간", lang)}</div>
                  </th>
                  <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    <div>YOY</div>
                    <div>({t("금액", lang)})</div>
                  </th>
                  <th className="border-r border-slate-600 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-[12px] sm:text-[13.5px] md:text-[15px] font-semibold text-slate-50">
                    <div>YOY</div>
                    <div>(%)</div>
                  </th>
                  <th className="border-r border-slate-600"></th>
                </>
              )}
            </tr>
            )}
          </thead>
          <tbody>
            {/* 전체 합계 행 */}
            <tr className="bg-indigo-50 border-b border-indigo-100">
              <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] font-semibold text-gray-800">
                <div className="flex items-center gap-2">
                  <PieChart className="w-3 h-3 sm:w-4 sm:h-4 text-indigo-600" />
                  <span>{t("전체 합계", lang)}</span>
                </div>
              </td>
              {!is2026AnnualOnly && <td className="border-r border-gray-200"></td>}
              {is2026AnnualOnly ? (
                <>
                  <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                    {formatK(computeTotals.annual2024Total)}
                  </td>
                  <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                    {formatK(computeTotals.annual2025Total)}
                  </td>
                  <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                    {formatDifference(computeTotals.diffAnnualTotal)}
                  </td>
                  <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right">
                    <span className={getYOYBadgeClass(computeTotals.yoyAnnualTotal)}>
                      {formatYOY(computeTotals.yoyAnnualTotal)}
                    </span>
                  </td>
                  <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-gray-500">-</td>
                  <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-gray-600">
                    {totalDescription}
                  </td>
                </>
              ) : viewMode !== "ytd" ? (
                <>
                  <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                    {formatK(computeTotals.prevTotal)}
                  </td>
                  <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                    {formatK(computeTotals.currTotal)}
                  </td>
                  <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                    {formatDifference(computeTotals.diffTotal)}
                  </td>
                  <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right">
                    <span className={getYOYBadgeClass(computeTotals.yoyTotal)}>
                      {formatYOY(computeTotals.yoyTotal)}
                    </span>
                  </td>
                  <td className="border-r border-gray-200"></td>
                  <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-gray-600">
                    {totalDescription}
                  </td>
                </>
              ) : (
                <>
                  <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                    {formatK(computeTotals.prevYtdTotal)}
                  </td>
                  <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                    {formatK(computeTotals.currYtdTotal)}
                  </td>
                  <td className={`border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium ${yearType === "actual" && viewMode === "ytd" ? "bg-amber-50" : ""}`}>
                    {formatDifference(computeTotals.diffYtdTotal)}
                  </td>
                  <td className={`border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right ${yearType === "actual" && viewMode === "ytd" ? "bg-amber-50" : ""}`}>
                    <span className={getYOYBadgeClass(computeTotals.yoyYtdTotal)}>
                      {formatYOY(computeTotals.yoyYtdTotal)}
                    </span>
                  </td>
                  <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                    {year === 2026 && yearType === "actual" ? formatK(computeTotals.planYtdTotal ?? 0) : "-"}
                  </td>
                  <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium bg-teal-50">
                    {formatDifference(computeTotals.planDiffTotal)}
                  </td>
                  <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right bg-teal-50">
                    <span className={getYOYBadgeClass(computeTotals.progressTotal)}>
                      {formatYOY(computeTotals.progressTotal)}
                    </span>
                  </td>
                  {year === 2026 && yearType === "actual" && (
                    <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium bg-amber-50">
                      {computeTotals.usageRateTotal != null ? (
                        <span className={`block w-full text-right ${computeTotals.usageRateTotal > (month / 12) * 100 ? "text-red-600 font-bold" : "text-green-700"}`}>
                          {computeTotals.usageRateTotal.toFixed(1)}%
                        </span>
                      ) : "-"}
                    </td>
                  )}
                  <td className="border-r border-gray-200"></td>
                  <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                    {formatK(computeTotals.annual2024Total)}
                  </td>
                  <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                    {formatK(computeTotals.annual2025Total)}
                  </td>
                  <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                    {formatDifference(computeTotals.diffAnnualTotal)}
                  </td>
                  <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right">
                    <span className={getYOYBadgeClass(computeTotals.yoyAnnualTotal)}>
                      {formatYOY(computeTotals.yoyAnnualTotal)}
                    </span>
                  </td>
                  <td className="border-r border-gray-200"></td>
                  <td className="border-r border-gray-200 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-gray-600">
                    {totalDescription}
                  </td>
                </>
              )}
            </tr>
            {flattenedRows.map((row) => {
              const hasChildren = row.children && row.children.length > 0;
              
              // 들여쓰기 및 폰트 스타일 결정
              const getIndentClass = (level: number): string => {
                if (level === 1) return "pl-2";
                if (level === 2) return "pl-8";  // 적당한 들여쓰기
                if (level === 3) return "pl-12";
                return "pl-16"; // level 4
              };
              
              const getFontWeight = (level: number): string => {
                if (level === 1) return "font-bold";
                if (level === 2) return "font-semibold";
                return "font-normal";
              };
              
              // 표시할 텍스트 결정 (중국어 지원)
              const getDisplayText = (row: ExpenseAccountRow): string => {
                if (row.level === 1) return getDisplayLabel(row.category_l1 || "", row.category_l1_cn, lang) || "-";
                if (row.level === 2) {
                  if (row.category_l1 === "광고비" && row.biz_unit) {
                    return getDisplayLabel(row.biz_unit, row.biz_unit_cn, lang);
                  }
                  if (row.category_l1 === "지급수수료" && row.category_l2 === "인테리어 개발") {
                    return getDisplayLabel(row.category_l2 || "", row.category_l2_cn, lang) || "-";
                  }
                  if (row.category_l1 === "출장비" && (row.category_l2 === "국내출장비" || row.category_l2 === "해외출장비")) {
                    return getDisplayLabel(row.category_l2 || "", row.category_l2_cn, lang) || "-";
                  }
                  return getDisplayLabel(row.category_l2 || "", row.category_l2_cn, lang) || "-";
                }
                if (row.level === 3) {
                  if (row.category_l1 === "광고비") {
                    return getDisplayLabel(row.category_l2 || "", row.category_l2_cn, lang) || "-";
                  }
                  if (row.category_l1 === "지급수수료" && row.category_l2 === "인테리어 개발" && row.biz_unit) {
                    return getDisplayLabel(row.biz_unit, row.biz_unit_cn, lang);
                  }
                  if (row.category_l1 === "출장비" && (row.category_l2 === "국내출장비" || row.category_l2 === "해외출장비") && row.biz_unit) {
                    return getDisplayLabel(row.biz_unit, row.biz_unit_cn, lang);
                  }
                  return getDisplayLabel(row.category_l3 || "", row.category_l3_cn, lang) || "-";
                }
                if (row.level === 4) {
                  return getDisplayLabel(row.category_l3 || "", row.category_l3_cn, lang) || "-";
                }
                return getDisplayLabel(row.category_l3 || "", row.category_l3_cn, lang) || "-";
              };
              
              const indentClass = getIndentClass(row.level);
              const fontWeight = getFontWeight(row.level);
              const displayText = getDisplayText(row);

              const prevValue = (viewMode !== "ytd" ? row.prev_month : row.prev_ytd) ?? 0;
              const currValue = (viewMode !== "ytd" ? row.curr_month : row.curr_ytd) ?? 0;
              const diff = getDifference(currValue, prevValue);
              const yoy = getYOY(currValue, prevValue);

              const effectiveCurrAnnual = is2026AnnualOnly ? row.curr_year_annual : (row.curr_year_annual ?? row.curr_ytd);
              const rowIs2026ActualYtd = year === 2026 && yearType === "actual" && viewMode === "ytd";
              const planYtd = row.plan_ytd ?? 0;

              // 계획비(%) = 당년누적 / 계획누적. 실적 2026년 YTD면 plan_ytd 사용
              const progressRate = viewMode === "ytd" 
                ? (rowIs2026ActualYtd ? (planYtd > 0 ? (currValue / planYtd) * 100 : null) : getProgressRate(currValue, effectiveCurrAnnual))
                : null;

              // 계획비 증감 = 당년누적 - 계획누적. 실적 2026년 YTD면 plan_ytd 사용
              const planDiff = viewMode === "ytd"
                ? (rowIs2026ActualYtd ? currValue - planYtd : (effectiveCurrAnnual !== null ? currValue - effectiveCurrAnnual : null))
                : null;

              // 사용률: 당년누적 / 2026년연간계획 × 100 (2026실적YTD 전용)
              const usageRate = rowIs2026ActualYtd && row.curr_year_annual != null && row.curr_year_annual > 0
                ? (currValue / row.curr_year_annual) * 100
                : null;
              const expectedUsageRate = (month / 12) * 100;
              const isOverUsage = usageRate != null && usageRate > expectedUsageRate;

              // 연간 계획 데이터 계산 (누적 모드 또는 2026 예산 연간 뷰에서 사용)
              const useAnnualPlanData = viewMode === "ytd" || is2026AnnualOnly;
              const annualDiff = useAnnualPlanData
                ? getDifference(effectiveCurrAnnual ?? 0, row.prev_year_annual ?? 0)
                : null;
              const annualYOY = useAnnualPlanData
                ? getYOY(effectiveCurrAnnual ?? 0, row.prev_year_annual ?? 0)
                : null;

              // 대분류(L1) 연한 하늘색, 그다음 분류(L2) 연한 회색
              const isLevel1 = row.level === 1;
              const isLevel2 = row.level === 2;
              
              return (
                <tr
                  key={row.id}
                  className={`transition-colors duration-150 cursor-pointer border-b border-gray-100 ${
                    isLevel1 
                      ? "bg-sky-50 hover:bg-sky-100" 
                      : isLevel2 
                        ? "bg-gray-100 hover:bg-gray-200"
                        : "hover:bg-blue-50/50"
                  }`}
                  onClick={() => hasChildren && toggleRow(row.id)}
                >
                  {/* 구분 영역 (단일 컬럼, 들여쓰기로 계층 표현) */}
                  <td
                    className={`border-r border-gray-100 pr-2 py-1.5 sm:pr-3 sm:py-2 text-[13.5px] sm:text-[15px] ${fontWeight} ${indentClass} transition-colors`}
                  >
                    <div className="flex items-center gap-2">
                      {hasChildren && (
                        <span className="flex-shrink-0">
                          {row.isExpanded ? (
                            <ChevronDown className="w-3 h-3 sm:w-4 sm:h-4" />
                          ) : (
                            <ChevronRight className="w-3 h-3 sm:w-4 sm:h-4" />
                          )}
                        </span>
                      )}
                      {!hasChildren && <span className="w-4" />}
                      <span>{displayText}</span>
                    </div>
                  </td>
                  {!is2026AnnualOnly && <td className="border-r border-gray-200"></td>}
                  
                  {/* 당월/누적 데이터 영역 */}
                  {viewMode !== "ytd" ? (
                    <>
                      {/* 당월 모드: 전년, 당월, 차이, YOY */}
                      <td className="border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                        {formatK(prevValue)}
                      </td>
                      <td className="border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                        {formatK(currValue)}
                      </td>
                      <td className="border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                        {formatDifference(diff)}
                      </td>
                      <td className={`border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium ${getYOYColor(yoy)}`}>
                        {yoy != null ? formatYOY(yoy) : formatDifference(diff)}
                      </td>
                      <td className="border-r border-gray-200"></td>
                      {/* 설명 (편집 가능) */}
                      <td 
                        className="border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-gray-600 relative group"
                        onClick={(e) => {
                          // 편집 모드가 아니고, 편집 버튼이 아닌 경우에만 편집 시작
                          if (editingRowId !== row.id && !(e.target as HTMLElement).closest('button')) {
                            const currentDesc = getDescCurrent(row.id, row.description || "");
                            startEdit(row.id, currentDesc);
                          }
                        }}
                      >
                        {editingRowId === row.id ? (
                          <div className="flex items-center gap-2">
                            <textarea
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && e.ctrlKey) {
                                  requestSaveEdit(row.id);
                                } else if (e.key === "Escape") {
                                  cancelEdit();
                                }
                              }}
                              className="flex-1 px-2 py-1 text-sm border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                              rows={2}
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div className="flex flex-col gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  requestSaveEdit(row.id);
                                }}
                                className="p-1 text-green-600 hover:bg-green-50 rounded"
                                title="저장 (Ctrl+Enter)"
                              >
                                <Check className="w-3 h-3 sm:w-4 sm:h-4" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  cancelEdit();
                                }}
                                className="p-1 text-red-600 hover:bg-red-50 rounded"
                                title="취소 (Esc)"
                              >
                                <X className="w-3 h-3 sm:w-4 sm:h-4" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className="flex-1 min-w-0"
                              title={getDescOther(row.id) ? (lang === "ko" ? `중국어: ${getDescOther(row.id)}` : `한국어: ${getDescOther(row.id)}`) : undefined}
                            >
                              {(() => {
                                // 사용자가 저장한 설명이 있으면 우선 표시
                                const savedDesc = descriptions.get(row.id)?.[lang];
                                if (savedDesc != null && String(savedDesc).trim() !== "") return savedDesc;
                                // 인건비 대분류(level 1) 또는 기본급 행: 자동 계산된 설명 표시
                                const laborCostDescription = calculateLaborCostDescription(row);
                                if (laborCostDescription) return laborCostDescription;
                                const autoDescription = calculateBasicSalaryDescription(row);
                                if (autoDescription) return autoDescription;
                                return getDescCurrent(row.id, row.description || "") || "-";
                              })()}
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const currentDesc = getDescCurrent(row.id, row.description || "");
                                  startEdit(row.id, currentDesc);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-blue-600 transition-opacity"
                                title="편집"
                              >
                                <Edit2 className="w-3 h-3 sm:w-4 sm:h-4" />
                              </button>
                            </div>
                          </div>
                        )}
                      </td>
                    </>
                  ) : is2026AnnualOnly ? (
                    <>
                      {/* 2026 연간만: 2025 실적, 2026 계획(금액만), 차이, YOY, 계산근거, 설명 */}
                      <td className="border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                        {formatK(row.prev_year_annual)}
                      </td>
                      <td className="border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                        {effectiveCurrAnnual != null ? formatK(effectiveCurrAnnual) : "-"}
                      </td>
                      <td className="border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                        {formatDifference(annualDiff)}
                      </td>
                      <td className={`border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium ${getYOYColor(annualYOY)}`}>
                        {annualYOY != null ? formatYOY(annualYOY) : formatDifference(annualDiff)}
                      </td>
                      {/* 계산근거 (텍스트 편집 가능) */}
                      <td
                        className="border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-gray-600 relative group"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {basisPopoverRowId === row.id ? (
                          <div className="absolute left-0 top-0 z-20 min-w-[280px] rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
                            <p className="text-xs font-semibold text-slate-700 mb-2">계산 근거 (연간 계획)</p>
                            <textarea
                              value={basisEditValue}
                              onChange={(e) => setBasisEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") closeBasisPopover();
                              }}
                              className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none mb-2"
                              rows={3}
                              autoFocus
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => closeBasisPopover()}
                                className="px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 rounded"
                              >
                                취소
                              </button>
                              <button
                                type="button"
                                onClick={() => requestSaveBasis(row.id)}
                                className="px-2 py-1 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded flex items-center gap-1"
                              >
                                <Check className="w-3.5 h-3.5" />
                                저장
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex-1 min-w-0">{basisMap.get(row.id) || "-"}</span>
                            <button
                              type="button"
                              title="계산 근거 편집 (클릭)"
                              onClick={() => openBasisPopover(row.id)}
                              className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-blue-600 transition-opacity"
                            >
                              <Edit2 className="w-3 h-3 sm:w-4 sm:h-4" />
                            </button>
                          </div>
                        )}
                      </td>
                      {/* 설명 (편집 가능) */}
                      <td
                        className="border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-gray-600 relative group"
                        onClick={(e) => {
                          if (editingRowId !== row.id && !(e.target as HTMLElement).closest("button")) {
                            startEdit(row.id, getDescCurrent(row.id, row.description || ""));
                          }
                        }}
                      >
                        {editingRowId === row.id ? (
                          <div className="flex items-center gap-2">
                            <textarea
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && e.ctrlKey) requestSaveEdit(row.id);
                                else if (e.key === "Escape") cancelEdit();
                              }}
                              className="flex-1 px-2 py-1 text-sm border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                              rows={2}
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div className="flex flex-col gap-1">
                              <button onClick={(e) => { e.stopPropagation(); requestSaveEdit(row.id); }} className="p-1 text-green-600 hover:bg-green-50 rounded" title="저장"><Check className="w-3 h-3 sm:w-4 sm:h-4" /></button>
                              <button onClick={(e) => { e.stopPropagation(); cancelEdit(); }} className="p-1 text-red-600 hover:bg-red-50 rounded" title="취소"><X className="w-3 h-3 sm:w-4 sm:h-4" /></button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className="flex-1 min-w-0"
                              title={getDescOther(row.id) ? (lang === "ko" ? `중국어: ${getDescOther(row.id)}` : `한국어: ${getDescOther(row.id)}`) : undefined}
                            >
                              {getDescCurrent(row.id, row.description || "") || "-"}
                            </span>
                            <button onClick={(e) => { e.stopPropagation(); startEdit(row.id, getDescCurrent(row.id, row.description || "")); }} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-blue-600 transition-opacity" title="편집"><Edit2 className="w-3 h-3 sm:w-4 sm:h-4" /></button>
                          </div>
                        )}
                      </td>
                    </>
                  ) : (
                    <>
                      {/* 누적(YTD) 모드: 전년누적, 당년누적, 차이, YOY, 계획비 증감, 계획비(%) */}
                      <td className="border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                        {formatK(prevValue)}
                      </td>
                      <td className="border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                        {formatK(currValue)}
                      </td>
                      <td className={`border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium ${yearType === "actual" && viewMode === "ytd" ? "bg-amber-50" : ""}`}>
                        {formatDifference(diff)}
                      </td>
                      <td className={`border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium ${yearType === "actual" && viewMode === "ytd" ? "bg-amber-50" : ""} ${getYOYColor(yoy)}`}>
                        {yoy != null ? formatYOY(yoy) : formatDifference(diff)}
                      </td>
                      <td className="border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                        {rowIs2026ActualYtd ? formatK(planYtd) : "-"}
                      </td>
                      <td className="border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium bg-teal-50">
                        {formatDifference(planDiff)}
                      </td>
                      <td className={`border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium bg-teal-50 ${getYOYColor(progressRate)}`}>
                        {progressRate != null ? formatYOY(progressRate) : "-"}
                      </td>
                      {rowIs2026ActualYtd && (
                        <td className="border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium bg-amber-50">
                          {usageRate != null ? (
                            <span className={`block w-full text-right ${isOverUsage ? "text-red-600 font-bold" : "text-green-700"}`}>
                              {usageRate.toFixed(1)}%
                            </span>
                          ) : "-"}
                        </td>
                      )}
                      <td className="border-r border-gray-200"></td>
                      {/* 연간 계획 영역 */}
                      <td className="border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                        {formatK(row.prev_year_annual)}
                      </td>
                      <td className="border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                        {row.curr_year_annual != null ? formatK(row.curr_year_annual) : "-"}
                      </td>
                      <td className="border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium">
                        {formatDifference(annualDiff)}
                      </td>
                      <td className={`border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-right font-medium ${getYOYColor(annualYOY)}`}>
                        {annualYOY != null ? formatYOY(annualYOY) : formatDifference(annualDiff)}
                      </td>
                      <td className="border-r border-gray-200"></td>
                      {/* 설명 (편집 가능) */}
                      <td 
                        className="border-r border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 text-[13.5px] sm:text-[15px] text-gray-600 relative group"
                        onClick={(e) => {
                          // 편집 모드가 아니고, 편집 버튼이 아닌 경우에만 편집 시작
                          if (editingRowId !== row.id && !(e.target as HTMLElement).closest('button')) {
                            const currentDesc = getDescCurrent(row.id, row.description || "");
                            startEdit(row.id, currentDesc);
                          }
                        }}
                      >
                        {editingRowId === row.id ? (
                          <div className="flex items-center gap-2">
                            <textarea
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && e.ctrlKey) {
                                  requestSaveEdit(row.id);
                                } else if (e.key === "Escape") {
                                  cancelEdit();
                                }
                              }}
                              className="flex-1 px-2 py-1 text-sm border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                              rows={2}
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div className="flex flex-col gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  requestSaveEdit(row.id);
                                }}
                                className="p-1 text-green-600 hover:bg-green-50 rounded"
                                title="저장 (Ctrl+Enter)"
                              >
                                <Check className="w-3 h-3 sm:w-4 sm:h-4" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  cancelEdit();
                                }}
                                className="p-1 text-red-600 hover:bg-red-50 rounded"
                                title="취소 (Esc)"
                              >
                                <X className="w-3 h-3 sm:w-4 sm:h-4" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className="flex-1 min-w-0"
                              title={getDescOther(row.id) ? (lang === "ko" ? `중국어: ${getDescOther(row.id)}` : `한국어: ${getDescOther(row.id)}`) : undefined}
                            >
                              {(() => {
                                // 사용자가 저장한 설명이 있으면 우선 표시
                                const savedDesc = descriptions.get(row.id)?.[lang];
                                if (savedDesc != null && String(savedDesc).trim() !== "") return savedDesc;
                                // 인건비 대분류(level 1) 또는 기본급 행: 자동 계산된 설명 표시 (당월 모드만)
                                const laborCostDescription = calculateLaborCostDescription(row);
                                if (laborCostDescription) return laborCostDescription;
                                const autoDescription = calculateBasicSalaryDescription(row);
                                if (autoDescription) return autoDescription;
                                return getDescCurrent(row.id, row.description || "") || "-";
                              })()}
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const currentDesc = getDescCurrent(row.id, row.description || "");
                                  startEdit(row.id, currentDesc);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-blue-600 transition-opacity"
                                title="편집"
                              >
                                <Edit2 className="w-3 h-3 sm:w-4 sm:h-4" />
                              </button>
                            </div>
                          </div>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
    <PasswordModal
      open={passwordModalOpen}
      onClose={() => {
        setPasswordModalOpen(false);
        setPendingSaveType(null);
        setPendingRowId(null);
      }}
      onConfirm={handlePasswordConfirm}
    />
    </>
  );
}
