"use client";

import React, { useEffect, useMemo, useState } from "react";
import { X, Plus, Trash2, Save, Loader2, RotateCcw, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatK } from "@/lib/utils";
import { autoCnLabel } from "@/lib/accountLabels";
import { t } from "@/lib/translations";
import { useBudgetAdjustments } from "@/contexts/BudgetAdjustmentContext";
import {
  ADJUST_BIZ_UNITS,
  isBlankAdjustment,
  makeAdjustmentId,
  type BudgetAdjustment,
} from "@/lib/budgetAdjustments";

type Lang = "ko" | "zh";

interface Props {
  open: boolean;
  onClose: () => void;
  year: number;
  /** 현재 보고 있는 브랜드 — 새 행의 기본값 */
  defaultBizUnit: string;
  /** 대분류 자동완성 후보 (좌측 카드 항목명) */
  lv1Options: string[];
  /** 대분류별 항목명(중분류) 자동완성 후보 */
  lv2OptionsByLv1: Record<string, string[]>;
  lang: Lang;
}

/** 입력은 K 단위, 저장은 원 단위 */
const K = 1000;

function emptyRow(year: number, bizUnit: string): BudgetAdjustment {
  return {
    id: makeAdjustmentId(),
    year,
    bizUnit,
    lv1: "",
    lv2: "",
    lv2Cn: "",
    amount: 0,
    note: "",
    noteCn: "",
    updatedAt: new Date().toISOString(),
  };
}

export function BudgetAdjustmentModal({
  open,
  onClose,
  year,
  defaultBizUnit,
  lv1Options,
  lv2OptionsByLv1,
  lang,
}: Props) {
  const { adjustments, requiresPassword, save } = useBudgetAdjustments();
  const { addToast } = useToast();

  const [rows, setRows] = useState<BudgetAdjustment[]>([]);
  // 금액 입력칸은 "-" 나 "" 같은 중간 상태를 허용해야 하므로 문자열로 따로 들고 있는다
  const [amountText, setAmountText] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState("");
  // 비밀번호 입력 화면 (배포 환경에서 저장 클릭 시 노출)
  const [pwOpen, setPwOpen] = useState(false);
  const [pwError, setPwError] = useState("");

  // 열릴 때마다 서버 상태로 초기화 (해당 연도만 편집)
  useEffect(() => {
    if (!open) return;
    const mine = adjustments.filter((a) => a.year === year);
    const initial = mine.length > 0 ? mine : [emptyRow(year, defaultBizUnit)];
    setRows(initial);
    setAmountText(
      Object.fromEntries(initial.map((a) => [a.id, a.amount ? String(a.amount / K) : ""]))
    );
    setPwOpen(false);
    setPwError("");
    setPassword("");
  }, [open, adjustments, year, defaultBizUnit]);

  const total = useMemo(() => rows.reduce((s, r) => s + (r.amount || 0), 0), [rows]);

  if (!open) return null;

  const patch = (id: string, next: Partial<BudgetAdjustment>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...next } : r)));

  const onAmountChange = (id: string, raw: string) => {
    // 숫자·마이너스·소수점만 허용 (천단위 콤마는 지우고 받는다)
    const cleaned = raw.replace(/,/g, "");
    if (cleaned !== "" && cleaned !== "-" && !/^-?\d*\.?\d*$/.test(cleaned)) return;
    setAmountText((prev) => ({ ...prev, [id]: cleaned }));
    const n = parseFloat(cleaned);
    patch(id, { amount: Number.isFinite(n) ? Math.round(n * K) : 0 });
  };

  const addRow = () => {
    const row = emptyRow(year, defaultBizUnit);
    setRows((prev) => [...prev, row]);
    setAmountText((prev) => ({ ...prev, [row.id]: "" }));
  };

  const removeRow = (id: string) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== id);
      return next.length > 0 ? next : [emptyRow(year, defaultBizUnit)];
    });
  };

  /** 저장 대상 행 정리 — 유효하지 않으면 null */
  const collectRows = () => {
    const filled = rows
      .filter((r) => !isBlankAdjustment(r))
      .map((r) => ({
        ...r,
        lv1: r.lv1.trim(),
        lv2: r.lv2.trim(),
        lv2Cn: r.lv2Cn.trim(),
        note: r.note.trim(),
        noteCn: r.noteCn.trim(),
        updatedAt: new Date().toISOString(),
      }));

    if (filled.some((r) => !r.lv1)) {
      addToast({ type: "error", message: t("대분류를 입력해주세요.", lang) });
      return null;
    }
    return filled;
  };

  const persist = async (filled: BudgetAdjustment[], pw?: string) => {
    setSaving(true);
    // 다른 연도 조정은 건드리지 않고 이번 연도만 교체
    const others = adjustments.filter((a) => a.year !== year);
    const result = await save([...others, ...filled], pw);
    setSaving(false);

    if (result.ok) {
      addToast({ type: "success", message: t("저장되었습니다. 카드에 바로 반영됩니다.", lang) });
      setPwOpen(false);
      setPassword("");
      setPwError("");
      onClose();
      return;
    }
    if (result.needPassword) {
      // 비밀번호가 틀렸거나 아직 안 받은 경우 — 입력 화면을 열어 그 안에서 안내
      setPwOpen(true);
      setPwError(t("비밀번호가 올바르지 않습니다.", lang));
      return;
    }
    addToast({ type: "error", message: result.error || t("저장에 실패했습니다.", lang) });
  };

  /** [저장] 클릭 — 배포 환경이면 비밀번호 입력 화면을 먼저 띄운다 */
  const handleSaveClick = () => {
    const filled = collectRows();
    if (!filled) return;
    if (requiresPassword) {
      setPassword("");
      setPwError("");
      setPwOpen(true);
      return;
    }
    void persist(filled);
  };

  const submitPassword = () => {
    if (!password.trim()) {
      setPwError(t("비밀번호를 입력해주세요.", lang));
      return;
    }
    const filled = collectRows();
    if (!filled) return;
    void persist(filled, password);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-start justify-between px-4 py-3 border-b border-slate-200">
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold text-slate-900">
              ✏️ {t("예산 수기조정", lang)} · {year}
              {t("년", lang)}
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
              {t("입력한 금액이 해당 브랜드·대분류의 연간계획에 가산됩니다. 미집행 예정이면 마이너스로 입력하세요.", lang)}
              {" "}
              {t("항목명은 어떤 세부 항목 때문인지 표기용입니다 (선택). 中文 칸은 비워두면 자동 표기됩니다.", lang)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100 flex-shrink-0" aria-label="close">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {/* 표 */}
        <div className="flex-1 overflow-auto px-4 py-3">
          <div className="min-w-[720px]">
            {/* 헤더 행 */}
            <div
              className="grid gap-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide px-2 py-1.5 bg-slate-50 rounded"
              style={{ gridTemplateColumns: "100px 130px 130px 110px minmax(0,1fr) 32px" }}
            >
              <div>{t("브랜드", lang)}</div>
              <div>{t("대분류", lang)}</div>
              <div>{t("항목명", lang)}</div>
              <div className="text-right">{t("예산", lang)} (K)</div>
              <div>{t("비고", lang)}</div>
              <div />
            </div>

            {/* 입력 행 */}
            <div className="space-y-1 mt-1">
              {rows.map((r) => (
                <React.Fragment key={r.id}>
                <div
                  className="grid gap-2 items-center px-2 py-1"
                  style={{ gridTemplateColumns: "100px 130px 130px 110px minmax(0,1fr) 32px" }}
                >
                  <select
                    value={r.bizUnit}
                    onChange={(e) => patch(r.id, { bizUnit: e.target.value })}
                    className="text-[12px] border border-slate-300 rounded px-1.5 py-1 bg-white text-slate-800 outline-none focus:border-slate-500"
                  >
                    {ADJUST_BIZ_UNITS.map((b) => (
                      <option key={b} value={b}>
                        {t(b, lang)}
                      </option>
                    ))}
                  </select>

                  <select
                    value={r.lv1}
                    onChange={(e) => patch(r.id, { lv1: e.target.value, lv2: "" })}
                    className={`text-[12px] border border-slate-300 rounded px-1.5 py-1 bg-white outline-none focus:border-slate-500 ${
                      r.lv1 ? "text-slate-800" : "text-slate-400"
                    }`}
                  >
                    <option value="">{t("대분류 선택", lang)}</option>
                    {lv1Options.map((o) => (
                      <option key={o} value={o}>
                        {t(o, lang)}
                      </option>
                    ))}
                  </select>

                  <input
                    list={`budget-adj-lv2-${r.lv1.trim()}`}
                    value={r.lv2}
                    onChange={(e) => patch(r.id, { lv2: e.target.value })}
                    placeholder={t("예: OMS", lang)}
                    className="text-[12px] border border-slate-300 rounded px-1.5 py-1 outline-none focus:border-slate-500"
                  />

                  <input
                    inputMode="text"
                    value={amountText[r.id] ?? ""}
                    onChange={(e) => onAmountChange(r.id, e.target.value)}
                    placeholder="0"
                    className={`text-[12px] text-right tabular-nums border border-slate-300 rounded px-1.5 py-1 outline-none focus:border-slate-500 ${
                      r.amount < 0 ? "text-blue-700" : r.amount > 0 ? "text-rose-700" : "text-slate-800"
                    }`}
                  />

                  <input
                    value={r.note}
                    onChange={(e) => patch(r.id, { note: e.target.value })}
                    placeholder={t("예: OMS 하반기 미사용 확정", lang)}
                    className="text-[12px] border border-slate-300 rounded px-1.5 py-1 outline-none focus:border-slate-500"
                  />

                  <button
                    type="button"
                    onClick={() => removeRow(r.id)}
                    className="p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600 justify-self-center"
                    aria-label="delete row"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* 中文 보조행 — 비우면 자동 표기(항목명) / 한국어 그대로(비고) */}
                <div
                  className="grid gap-2 items-center px-2 pb-1"
                  style={{ gridTemplateColumns: "100px 130px 130px 110px minmax(0,1fr) 32px" }}
                >
                  <div className="text-[10px] text-slate-400 text-right pr-1">中文</div>
                  <div />
                  <input
                    value={r.lv2Cn}
                    onChange={(e) => patch(r.id, { lv2Cn: e.target.value })}
                    placeholder={autoCnLabel(r.lv2) ?? (r.lv2 ? t("직접 입력 필요", lang) : "")}
                    className="text-[11.5px] border border-slate-200 bg-slate-50/60 rounded px-1.5 py-1 outline-none focus:border-slate-400 focus:bg-white"
                  />
                  <div />
                  <input
                    value={r.noteCn}
                    onChange={(e) => patch(r.id, { noteCn: e.target.value })}
                    placeholder={r.note ? t("비우면 한국어 비고 그대로 표시", lang) : ""}
                    className="text-[11.5px] border border-slate-200 bg-slate-50/60 rounded px-1.5 py-1 outline-none focus:border-slate-400 focus:bg-white"
                  />
                  <div />
                </div>
              </React.Fragment>
              ))}
            </div>

            {Object.entries(lv2OptionsByLv1).map(([lv1, opts]) => (
              <datalist key={lv1} id={`budget-adj-lv2-${lv1}`}>
                {opts.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            ))}

            <button
              type="button"
              onClick={addRow}
              className="mt-2 inline-flex items-center gap-1 text-[12px] text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100"
            >
              <Plus className="w-3.5 h-3.5" />
              {t("행 추가", lang)}
            </button>
          </div>
        </div>

        {/* 푸터 */}
        <div className="border-t border-slate-200 px-4 py-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[12px] text-slate-600">
              {t("조정 합계", lang)}{" "}
              <b className={`tabular-nums ${total < 0 ? "text-blue-700" : total > 0 ? "text-rose-700" : "text-slate-800"}`}>
                {total >= 0 ? "+" : ""}
                {formatK(total)}
              </b>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose} className="text-[12px]">
                <RotateCcw className="w-3.5 h-3.5 mr-1" />
                {t("취소", lang)}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSaveClick}
                disabled={saving}
                className="text-[12px] bg-slate-800 text-white hover:bg-slate-900"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                {t("저장", lang)}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 비밀번호 입력 화면 — 저장 클릭 시 (배포 환경) */}
      {pwOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !saving && setPwOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-1">
              <Lock className="w-4 h-4 text-slate-600" />
              <h4 className="text-[14px] font-bold text-slate-900">{t("비밀번호 입력", lang)}</h4>
            </div>
            <p className="text-[11.5px] text-slate-500 leading-snug mb-3">
              {t("저장하려면 편집 비밀번호가 필요합니다.", lang)}
            </p>

            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (pwError) setPwError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !saving) submitPassword();
                if (e.key === "Escape" && !saving) setPwOpen(false);
              }}
              placeholder={t("비밀번호", lang)}
              className={`w-full text-[13px] border rounded px-2.5 py-2 outline-none ${
                pwError
                  ? "border-rose-400 focus:border-rose-500"
                  : "border-slate-300 focus:border-slate-500"
              }`}
            />
            {pwError && <p className="text-[11.5px] text-rose-600 mt-1.5">{pwError}</p>}

            <div className="flex justify-end gap-2 mt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPwOpen(false)}
                disabled={saving}
                className="text-[12px]"
              >
                {t("취소", lang)}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={submitPassword}
                disabled={saving}
                className="text-[12px] bg-slate-800 text-white hover:bg-slate-900"
              >
                {saving ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5 mr-1" />
                )}
                {t("저장", lang)}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
