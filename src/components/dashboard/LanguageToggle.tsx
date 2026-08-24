"use client";

import React from "react";
import { useLanguage, type Lang } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

interface LanguageToggleProps {
  compact?: boolean;
}

export function LanguageToggle({ compact }: LanguageToggleProps = {}) {
  const { lang, setLang } = useLanguage();

  return (
    <div className="inline-flex items-center rounded-xl bg-slate-100/90 p-1 ring-1 ring-slate-200/80 shadow-sm shadow-slate-200/40">
      <button
        type="button"
        onClick={() => setLang("ko")}
        className={cn(
          "px-3 py-1 text-[13px] font-semibold rounded-lg transition-all",
          lang === "ko"
            ? "bg-white text-blue-600 shadow-sm shadow-slate-200/60"
            : "text-slate-500 hover:text-slate-700"
        )}
      >
        한국어
      </button>
      <button
        type="button"
        onClick={() => setLang("zh")}
        className={cn(
          "px-3 py-1 text-[13px] font-semibold rounded-lg transition-all",
          lang === "zh"
            ? "bg-white text-blue-600 shadow-sm shadow-slate-200/60"
            : "text-slate-500 hover:text-slate-700"
        )}
      >
        中文
      </button>
    </div>
  );
}
