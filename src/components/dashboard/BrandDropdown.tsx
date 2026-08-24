"use client";

import { useRef, useState, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import type { BizUnit } from "@/lib/expenseData";
import { useLanguage } from "@/contexts/LanguageContext";
import { t } from "@/lib/translations";

interface BrandOption {
  bizUnit: BizUnit;
  label: string;
}

interface BrandDropdownProps {
  value: BizUnit;
  options: BrandOption[];
  onChange: (bu: BizUnit) => void;
  /** true면 흰 글씨/투명 배경 (그라데이션 헤더 위에 사용) */
  onDark?: boolean;
}

/**
 * 홈 대시보드 상단 카드 헤더에 들어가는 브랜드 선택 드롭다운.
 * 그라데이션 컬러 헤더 위에 놓이므로 반투명 흰색 스타일이 기본.
 */
export function BrandDropdown({ value, options, onChange, onDark = true }: BrandDropdownProps) {
  const { lang } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const currentLabel = options.find((o) => o.bizUnit === value)?.label ?? value;

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-bold text-sm sm:text-base transition-colors ${
          onDark
            ? "bg-white/15 hover:bg-white/25 border border-white/30 text-white"
            : "bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800"
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{t(currentLabel, lang)}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 top-full mt-1 z-20 min-w-[140px] rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden"
        >
          {options.map((opt) => {
            const selected = opt.bizUnit === value;
            return (
              <li key={opt.bizUnit}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt.bizUnit);
                    setOpen(false);
                  }}
                  className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors ${
                    selected
                      ? "bg-indigo-50 text-indigo-700 font-semibold"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className="w-3.5 h-3.5 flex-shrink-0">
                    {selected && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                  </span>
                  <span>{t(opt.label, lang)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
