"use client";

/**
 * 연간 실제 사용예상 분석 (BudgetAdjustedView)
 *
 * 사용예상 계획(plan_adj)은 중간점검 시트의 "연간 실제 사용예상" — 예산을 고친 게
 * 아니라 지금 페이스로 연말까지 갔을 때 실제로 얼마를 쓸지 다시 취합한 전망이다.
 * 연간 금액만 있고 월별 배분이 없어, 기존계획 뷰의 초과/감축 판정(월별 계획 대비
 * 페이스)은 여기서 성립하지 않는다. 기존계획 대비 얼마나 늘고 줄 전망인지와
 * 지금 어디까지 썼는지만 본다.
 *
 * 항목별 "빠르다/느리다" 판정은 하지 않는다 — 사용예상엔 월별 계획이 없고 실적도
 * 항목마다 편중이 커서(예: 지급수수료는 4월 한 달에 42% 집중) 균등소비를 전제한
 * 판정이 근거를 갖지 못한다. 진척률은 숫자로만 보여주고 해석은 사람에게 맡긴다.
 */

import { Fragment, useMemo, useState } from "react";
import { TrendingUp, TrendingDown, ChevronDown, ChevronRight } from "lucide-react";
import { getCategoryDetail, type BizUnit } from "@/lib/expenseData";
import { formatK, formatPercent } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { t } from "@/lib/translations";
import { tLabel } from "@/lib/accountLabels";

type Lang = "ko" | "zh";

// 한 번에 발생하는 비용 — 연중 고르게 쓰는 게 아니라 진척률이 성립하지 않는다.
// (수주회: 시즌 행사라 상반기에 몰려 끝남)
const LUMP_SUM_LV1 = new Set(["수주회"]);

// 법인 뷰에서 브랜드(biz_unit)로 갈라 보는 게 자연스러운 대분류 (좌측 카드와 동일 규칙)
const BRAND_FIRST_LV1 = new Set(["광고비", "출장비"]);

interface Child {
  key: string;
  name: string;
  isBrand: boolean; // 라벨이 브랜드명이면 계정 번역을 태우지 않는다
  base: number;
  adj: number;
  actual: number;
  delta: number;
  deltaPct: number | null;
  usageAfter: number | null;
}

interface Lv1Stat {
  lv1: string;
  base: number;
  adj: number;
  actual: number;
  delta: number;
  deltaPct: number | null;
  usageAfter: number | null;
  children: Child[]; // 증감액이 0이 아닌 하위 항목만
}

export interface BudgetAdjustedViewProps {
  bizUnit: BizUnit;
  year: number;
  month: number;
}

export function BudgetAdjustedView({ bizUnit, year, month }: BudgetAdjustedViewProps) {
  const { lang } = useLanguage();
  const L = lang as Lang;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const s = useMemo(() => {
    const isCorporate = bizUnit === "법인";
    // 하위 키: 법인 뷰의 광고비·출장비는 브랜드로, 그 외는 중분류로 나눈다
    const subKey = (lv1: string, r: { biz_unit?: string; cost_lv2?: string }) =>
      isCorporate && BRAND_FIRST_LV1.has(lv1)
        ? (r.biz_unit || "-").trim()
        : (r.cost_lv2 || "-").trim();

    const collect = (rows: ReturnType<typeof getCategoryDetail>) => {
      const lv1 = new Map<string, number>();
      const sub = new Map<string, number>();
      for (const r of rows) {
        const k1 = (r.cost_lv1 || "").trim();
        if (!k1) continue;
        const amt = r.amount || 0;
        lv1.set(k1, (lv1.get(k1) ?? 0) + amt);
        const k2 = `${k1}|${subKey(k1, r)}`;
        sub.set(k2, (sub.get(k2) ?? 0) + amt);
      }
      return { lv1, sub };
    };

    const base = collect(getCategoryDetail(bizUnit, year, 12, "", "ytd", "plan"));
    const adj = collect(getCategoryDetail(bizUnit, year, 12, "", "ytd", "plan_adj"));
    const act = collect(getCategoryDetail(bizUnit, year, month, "", "ytd", "actual"));

    const subKeys = new Set([...Array.from(base.sub.keys()), ...Array.from(adj.sub.keys())]);
    const childrenByLv1 = new Map<string, Child[]>();
    for (const k of Array.from(subKeys)) {
      const [lv1, name] = k.split("|");
      const b = base.sub.get(k) ?? 0;
      const a = adj.sub.get(k) ?? 0;
      const ac = act.sub.get(k) ?? 0;
      const d = a - b;
      if (d === 0) continue; // 증감이 있는 항목만 노출
      const arr = childrenByLv1.get(lv1) ?? [];
      arr.push({
        key: k, name,
        isBrand: isCorporate && BRAND_FIRST_LV1.has(lv1),
        base: b, adj: a, actual: ac, delta: d,
        deltaPct: b > 0 ? (d / b) * 100 : null,
        usageAfter: a > 0 ? (ac / a) * 100 : null,
      });
      childrenByLv1.set(lv1, arr);
    }
    for (const arr of Array.from(childrenByLv1.values())) {
      arr.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    }

    const stats: Lv1Stat[] = Array.from(
      new Set([...Array.from(base.lv1.keys()), ...Array.from(adj.lv1.keys())])
    )
      .map((lv1) => {
        const b = base.lv1.get(lv1) ?? 0;
        const a = adj.lv1.get(lv1) ?? 0;
        const ac = act.lv1.get(lv1) ?? 0;
        return {
          lv1, base: b, adj: a, actual: ac,
          delta: a - b,
          deltaPct: b > 0 ? ((a - b) / b) * 100 : null,
          usageAfter: a > 0 ? (ac / a) * 100 : null,
          children: childrenByLv1.get(lv1) ?? [],
        };
      })
      .filter((x) => Math.abs(x.base) > 0 || Math.abs(x.adj) > 0);

    const tBase = stats.reduce((n, x) => n + x.base, 0);
    const tAdj = stats.reduce((n, x) => n + x.adj, 0);
    const tAct = stats.reduce((n, x) => n + x.actual, 0);
    const ups = stats.filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta);
    const downs = stats.filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta);
    const upSum = ups.reduce((n, x) => n + x.delta, 0);
    const downSum = downs.reduce((n, x) => n + Math.abs(x.delta), 0);
    const top3 = ups.slice(0, 3);
    const top3Share = upSum > 0 ? (top3.reduce((n, x) => n + x.delta, 0) / upSum) * 100 : 0;

    return {
      stats, tBase, tAdj, tAct, ups, downs, upSum, downSum, top3, top3Share,
      pace: (month / 12) * 100,
      usageBefore: tBase > 0 ? (tAct / tBase) * 100 : null,
      usageAfter: tAdj > 0 ? (tAct / tAdj) * 100 : null,
      delta: tAdj - tBase,
      deltaPct: tBase > 0 ? ((tAdj - tBase) / tBase) * 100 : null,
    };
  }, [bizUnit, year, month]);

  const label = (ko: string) => tLabel(ko, L);
  const paceGap = s.usageAfter != null ? s.usageAfter - s.pace : null;
  const tone = paceGap == null ? "slate" : paceGap > 2 ? "rose" : paceGap < -2 ? "blue" : "slate";
  const toneCls = {
    rose: { br: "border-rose-300", bg: "from-rose-50/70 to-white", tx: "text-rose-800", bd: "bg-rose-600", fill: "bg-rose-500" },
    blue: { br: "border-blue-300", bg: "from-blue-50/70 to-white", tx: "text-blue-800", bd: "bg-blue-600", fill: "bg-blue-500" },
    slate: { br: "border-slate-300", bg: "from-slate-50/70 to-white", tx: "text-slate-800", bd: "bg-slate-600", fill: "bg-slate-500" },
  }[tone];
  const paceVerdict =
    paceGap == null ? "-"
      : paceGap > 2 ? t("예상 페이스 초과", L)
        : paceGap < -2 ? t("예상 페이스 미만", L)
          : t("예상 페이스 부합", L);
  const clamp = (v: number) => Math.max(0, Math.min(100, v));

  return (
    <div className="space-y-3">
      {/* ── 결론 배너 — 숫자 + 진척률 게이지 ── */}
      <div className={`rounded-lg border-2 ${toneCls.br} bg-gradient-to-br ${toneCls.bg} p-3`}>
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded text-white ${toneCls.bd}`}>
            {t("사용예상 요약", L)}
          </span>
          <span className="text-[11px] text-slate-500">
            {year}{t("년", L)} {month}{t("월", L)} YTD
          </span>
        </div>

        <div className="flex items-end gap-3 flex-wrap mb-3">
          <div>
            <div className="text-[10px] text-slate-500">{t("기존계획", L)}</div>
            <div className="text-[15px] font-bold text-slate-500 tabular-nums leading-tight">{formatK(s.tBase)}</div>
          </div>
          <div className="text-[16px] text-slate-400 leading-tight pb-0.5">→</div>
          <div>
            <div className="text-[10px] text-slate-500">{t("연간 실제 사용예상", L)}</div>
            <div className={`text-[22px] font-black tabular-nums leading-tight ${toneCls.tx}`}>{formatK(s.tAdj)}</div>
          </div>
          <div className={`ml-auto rounded-md px-2.5 py-1 text-right ${s.delta >= 0 ? "bg-rose-100 text-rose-800" : "bg-blue-100 text-blue-800"}`}>
            <div className="text-[17px] font-black tabular-nums leading-tight">
              {s.delta >= 0 ? "+" : "−"}{formatK(Math.abs(s.delta))}
            </div>
            <div className="text-[10.5px] font-semibold tabular-nums">
              {s.deltaPct != null ? `${s.deltaPct >= 0 ? "+" : ""}${s.deltaPct.toFixed(1)}%` : "-"}
            </div>
          </div>
        </div>

        {/* 진척률 게이지 — 기존계획/사용예상 기준 위치와 예상 페이스 눈금 */}
        <div>
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="text-[11px] font-semibold text-slate-600">
              {t("진척률", L)}
              <span className="ml-1 font-normal text-slate-400">
                YTD {t("실적", L)} {formatK(s.tAct)}
              </span>
            </span>
            <span className="text-[11px] tabular-nums text-slate-500">
              {t("기존계획 기준", L)} <b className="text-slate-600">{s.usageBefore != null ? formatPercent(s.usageBefore, 1) : "-"}</b>
              <span className="mx-1 text-slate-300">→</span>
              <b className={`text-[14px] ${toneCls.tx}`}>{s.usageAfter != null ? formatPercent(s.usageAfter, 1) : "-"}</b>
            </span>
          </div>
          <div className="relative h-4 rounded bg-slate-200/70 overflow-hidden">
            <div className={`h-full ${toneCls.fill}`} style={{ width: `${clamp(s.usageAfter ?? 0)}%` }} />
            <div
              className="absolute top-0 bottom-0 w-px bg-slate-900/25"
              style={{ left: `${clamp(s.usageBefore ?? 0)}%` }}
              title={`${t("기존계획 기준", L)} ${formatPercent(s.usageBefore ?? 0, 1)}`}
            />
            <div className="absolute top-0 bottom-0 w-0.5 bg-slate-900" style={{ left: `${clamp(s.pace)}%` }} />
          </div>
          <div className="relative h-3 mt-0.5">
            <span
              className="absolute text-[9.5px] font-semibold text-slate-600 -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${clamp(s.pace)}%` }}
            >
              ▲ {t("예상", L)} {s.pace.toFixed(0)}%
            </span>
          </div>
          <div className="text-[11px] text-slate-600 mt-0.5">{paceVerdict}</div>
        </div>

        {s.top3.length > 0 && (
          <p className="text-[12px] text-slate-700 leading-snug border-t border-slate-200/70 pt-1.5 mt-1.5">
            {t("증액은 {names} 에 집중 — 전체 증액 {sum} 의 {share}", L)
              .replace("{names}", s.top3.map((x) => label(x.lv1)).join(" · "))
              .replace("{sum}", formatK(s.upSum))
              .replace("{share}", `${s.top3Share.toFixed(0)}%`)}
          </p>
        )}
      </div>

      {/* ── 무엇이 늘고 줄었나 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <RankPanel
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          title={t("증액 주도", L)}
          sum={`+${formatK(s.upSum)}`}
          tone="rose"
          empty={t("증액 항목 없음", L)}
          items={s.ups}
          pace={s.pace}
          open={open}
          toggle={toggle}
          label={label}
          lang={L}
        />
        <RankPanel
          icon={<TrendingDown className="w-3.5 h-3.5" />}
          title={t("감액", L)}
          sum={`−${formatK(s.downSum)}`}
          tone="blue"
          empty={t("감액 항목 없음", L)}
          items={s.downs}
          pace={s.pace}
          open={open}
          toggle={toggle}
          label={label}
          lang={L}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────

const COLS = { gridTemplateColumns: "minmax(0,1fr) 74px 54px 64px" };

function RankPanel({
  icon, title, sum, tone, items, pace, open, toggle, empty, label, lang,
}: {
  icon: React.ReactNode;
  title: string;
  sum: string;
  tone: "rose" | "blue";
  items: Lv1Stat[];
  pace: number;
  open: Set<string>;
  toggle: (k: string) => void;
  empty: string;
  label: (ko: string) => string;
  lang: Lang;
}) {
  const c = tone === "rose"
    ? { br: "border-rose-200", hd: "text-rose-800 bg-rose-50", tx: "text-rose-700" }
    : { br: "border-blue-200", hd: "text-blue-800 bg-blue-50", tx: "text-blue-700" };

  const pill = (lump: boolean, usage: number | null, small?: boolean) =>
    lump ? (
      <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-400">
        {t("일시발생", lang)}
      </span>
    ) : (
      <span className={`inline-block rounded px-1.5 py-0.5 font-bold tabular-nums bg-slate-100 text-slate-800 ${small ? "text-[10.5px]" : "text-[12px]"}`}>
        {usage != null ? formatPercent(usage, 0) : "-"}
      </span>
    );

  return (
    <div className={`rounded-lg border ${c.br} bg-white overflow-hidden`}>
      <div className={`flex items-center justify-between gap-2 px-3 py-1.5 ${c.hd} border-b ${c.br}`}>
        <span className="inline-flex items-center gap-1 text-[12px] font-bold">{icon}{title}</span>
        <span className="text-[12.5px] font-bold tabular-nums">{sum}</span>
      </div>
      <div
        className="grid gap-1 px-2 py-1 text-[9.5px] font-semibold uppercase tracking-wide text-slate-400 bg-slate-50/70 border-b border-slate-100 whitespace-nowrap"
        style={COLS}
      >
        <span>{t("대분류", lang)}</span>
        <span className="text-right">{t("증감액", lang)}</span>
        <span className="text-right">{t("증감률", lang)}</span>
        <span className="text-right">
          {t("진척률", lang)}
          <span className="ml-0.5 normal-case text-slate-300">({pace.toFixed(0)}%)</span>
        </span>
      </div>
      <div className="px-2 py-1 divide-y divide-slate-100">
        {items.length === 0 && <div className="text-[11.5px] text-slate-400 px-1 py-2">{empty}</div>}
        {items.map((x) => {
          const lump = LUMP_SUM_LV1.has(x.lv1);
          const hasKids = x.children.length > 0;
          const isOpen = open.has(x.lv1);
          return (
            <Fragment key={x.lv1}>
              <div
                className={`grid gap-1 items-center py-1 text-[11.5px] ${hasKids ? "cursor-pointer hover:bg-sky-50/60" : ""}`}
                style={COLS}
                onClick={hasKids ? () => toggle(x.lv1) : undefined}
                role={hasKids ? "button" : undefined}
              >
                <span className="inline-flex items-center gap-0.5 min-w-0">
                  {hasKids ? (
                    isOpen
                      ? <ChevronDown className="w-3 h-3 text-slate-400 flex-shrink-0" />
                      : <ChevronRight className="w-3 h-3 text-slate-400 flex-shrink-0" />
                  ) : (
                    <span className="w-3 flex-shrink-0" />
                  )}
                  <span className="font-semibold text-slate-800 truncate">{label(x.lv1)}</span>
                </span>
                <b className={`text-right tabular-nums ${c.tx}`}>
                  {x.delta >= 0 ? "+" : "−"}{formatK(Math.abs(x.delta))}
                </b>
                <span className="text-right tabular-nums text-slate-400">
                  {x.deltaPct != null ? `${x.deltaPct >= 0 ? "+" : ""}${x.deltaPct.toFixed(1)}%` : t("신규편성", lang)}
                </span>
                <span className="text-right">{pill(lump, x.usageAfter)}</span>
              </div>

              {isOpen &&
                x.children.map((k) => (
                  <div key={k.key} className="grid gap-1 items-center py-0.5 text-[11px] bg-slate-50/40" style={COLS}>
                    <span className="min-w-0 pl-4 text-slate-600 truncate">
                      <span className="text-slate-300 mr-1">ㄴ</span>
                      {k.isBrand ? k.name : label(k.name)}
                    </span>
                    <span className={`text-right tabular-nums font-semibold ${c.tx}`}>
                      {k.delta >= 0 ? "+" : "−"}{formatK(Math.abs(k.delta))}
                    </span>
                    <span className="text-right tabular-nums text-slate-400">
                      {k.deltaPct != null ? `${k.deltaPct >= 0 ? "+" : ""}${k.deltaPct.toFixed(1)}%` : t("신규편성", lang)}
                    </span>
                    <span className="text-right">{pill(lump, k.usageAfter, true)}</span>
                  </div>
                ))}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
