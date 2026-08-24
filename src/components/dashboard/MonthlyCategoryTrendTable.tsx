"use client";

import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { getAggregatedData, type BizUnit } from "@/lib/expenseData";

interface Props {
  bizUnit: BizUnit;
  year: number;
  yearType?: "actual" | "plan";
  /** 표시할 최대 월 (기본: 데이터가 있는 마지막 월) */
  upToMonth?: number;
}

const CORPORATE_BIZ_UNITS = ["MLB", "KIDS", "DISCOVERY", "공통"] as const;

// 대분류 표시 순서 (관리식 우선, 그 외 알파벳)
const CATEGORY_ORDER = [
  "인건비", "복리후생비", "광고비", "수주회", "출장비",
  "지급수수료", "IT수수료", "임차료", "감가상각비", "세금과공과", "기타", "차량렌트비",
];

// YTD/분기 강조 배경 (참고 디자인)
const YTD_HEAD_BG = "bg-slate-200/70";
const YTD_CELL_BG = "bg-slate-50";

/** 셀 값 = 금액 + 전년비 증감 + 지수(전년=100) */
type CellMetrics = { curr: number; prev: number; delta: number; index: number | null };

function fmtN(n: number): string {
  if (n === 0) return "0";
  return Math.round(n / 1000).toLocaleString("en-US"); // K 단위 (raw는 원, /1000 → K)
}
function fmtDelta(delta: number): string {
  if (delta === 0) return "0";
  const sign = delta > 0 ? "+" : "△";
  return `${sign}${Math.round(Math.abs(delta) / 1000).toLocaleString("en-US")}`;
}
function fmtIndex(idx: number | null): string {
  return idx == null ? "" : `${Math.round(idx)}%`;
}

/** 셀 내부 렌더 */
function CellContent({ m, strong = false, isSub = false }: { m: CellMetrics; strong?: boolean; isSub?: boolean }) {
  const noData = m.curr === 0 && m.prev === 0;
  const main = noData ? "—" : fmtN(m.curr);
  const up = m.delta > 0;
  const subTone = m.index == null ? "text-slate-400" : up ? "text-rose-500" : "text-sky-600";
  return (
    <div className="text-right">
      <div className={`tabular-nums leading-tight ${strong ? "font-semibold" : "font-medium"} ${main === "—" ? "text-slate-300" : ""}`}>
        {main}
      </div>
      {!noData && (
        <div className={`tabular-nums leading-tight text-[10px] ${subTone} ${isSub ? "text-[9.5px]" : ""}`}>
          {fmtDelta(m.delta)}
          {m.index != null && <span className="ml-1">{fmtIndex(m.index)}</span>}
        </div>
      )}
    </div>
  );
}

export function MonthlyCategoryTrendTable({ bizUnit, year, yearType = "actual", upToMonth }: Props) {
  const data = getAggregatedData();
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const toggle = (cat: string) => setExpanded((s) => { const n = new Set(s); n.has(cat) ? n.delete(cat) : n.add(cat); return n; });

  const targetBUs: string[] = bizUnit === "법인" ? [...CORPORATE_BIZ_UNITS] : [bizUnit];

  // 카테고리 × 월별 금액 집계 (당년 + 전년)
  const buildMap = (yr: number, yt: "actual" | "plan"): Map<string, number[]> => {
    const map = new Map<string, number[]>();
    for (const r of data.monthly_aggregated) {
      if (r.year !== yr) continue;
      if ((r.year_type ?? "actual") !== yt) continue;
      if (!targetBUs.includes(r.biz_unit)) continue;
      if (!map.has(r.cost_lv1)) map.set(r.cost_lv1, new Array(12).fill(0));
      map.get(r.cost_lv1)![r.month - 1] += r.amount || 0;
    }
    return map;
  };
  const currMap = buildMap(year, yearType);
  const prevMap = buildMap(year - 1, "actual");

  // 하위(lv2) 데이터
  const buildSubMap = (yr: number, yt: "actual" | "plan", lv1: string): Map<string, number[]> => {
    const map = new Map<string, number[]>();
    for (const r of data.category_detail) {
      if (r.year !== yr) continue;
      if ((r.year_type ?? "actual") !== yt) continue;
      if (!targetBUs.includes(r.biz_unit)) continue;
      if (r.cost_lv1 !== lv1) continue;
      const key = r.cost_lv2 || "-";
      if (!map.has(key)) map.set(key, new Array(12).fill(0));
      map.get(key)![r.month - 1] += r.amount || 0;
    }
    return map;
  };

  // 데이터가 있는 마지막 월 (또는 upToMonth)
  const dataMonths = new Set<number>();
  for (const arr of currMap.values()) arr.forEach((v, i) => { if (v !== 0) dataMonths.add(i + 1); });
  const maxMonth = upToMonth ?? (dataMonths.size > 0 ? Math.max(...Array.from(dataMonths)) : 12);
  const months = Array.from({ length: maxMonth }, (_, i) => i + 1);

  // 카테고리 정렬
  const allCats = new Set<string>([...currMap.keys(), ...prevMap.keys()]);
  const orderedCats: string[] = [];
  for (const c of CATEGORY_ORDER) if (allCats.has(c)) orderedCats.push(c);
  for (const c of Array.from(allCats).sort()) if (!orderedCats.includes(c)) orderedCats.push(c);

  const cellSum = (m: number, cat: string, map: Map<string, number[]>) => (map.get(cat)?.[m - 1] ?? 0);
  // 분기 합계 — 당년/전년 모두 s ~ min(e, maxMonth)까지만 (동일 기간 비교)
  const quarterSum = (q: 1 | 2 | 3 | 4, cat: string, map: Map<string, number[]>) => {
    const [s, e] = ({ 1: [1, 3], 2: [4, 6], 3: [7, 9], 4: [10, 12] } as const)[q];
    const effEnd = Math.min(e, maxMonth);
    let sum = 0;
    for (let m = s; m <= effEnd; m++) sum += cellSum(m, cat, map);
    return sum;
  };
  const ytdSum = (cat: string, map: Map<string, number[]>) => {
    let sum = 0; for (let m = 1; m <= maxMonth; m++) sum += cellSum(m, cat, map); return sum;
  };

  // 분기 노출: 시작월이 maxMonth 이하면 (한 달이라도 있으면) 노출
  const activeQuarters: (1 | 2 | 3 | 4)[] = ([1, 2, 3, 4] as const).filter((q) => {
    const [s] = ({ 1: [1, 3], 2: [4, 6], 3: [7, 9], 4: [10, 12] } as const)[q];
    return maxMonth >= s;
  });

  const metrics = (curr: number, prev: number): CellMetrics => ({
    curr, prev,
    delta: curr - prev,
    index: prev > 0 ? (curr / prev) * 100 : null,
  });

  const yy = String(year).slice(2);
  const monthLabel = (m: number) => `${yy}.${String(m).padStart(2, "0")}`;

  // 사업부 라벨
  const buLabel = bizUnit === "법인" ? "법인" : bizUnit;

  return (
    <div className="w-full min-w-0 rounded-2xl border border-slate-200/80 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.08)] overflow-hidden">
      {/* 다크 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-slate-800 text-white">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <h2 className="text-[19px] font-bold tracking-tight">{year}년 월별 계정 추이</h2>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 ring-1 ring-white/20">{buLabel}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="px-2 py-0.5 rounded-md bg-slate-700/70 ring-1 ring-white/10">단위 천위안(K)</span>
          <span className="px-2 py-0.5 rounded-md bg-slate-700/70 ring-1 ring-white/10 text-slate-300">셀 = 금액 / 전년비 증감 · 지수</span>
        </div>
      </div>

      {/* 표 (폰트: 좌측 카드와 통일 — 본문 12.5px, 헤더 10.5px, sub 11.5px) */}
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px] border-collapse">
          <thead>
            <tr className="bg-slate-100 text-slate-600 text-[10.5px]">
              <th className="sticky left-0 z-20 bg-slate-100 text-left font-semibold px-2 py-2 border-b border-slate-200 w-[4.3rem] min-w-[4.3rem] max-w-[4.3rem] whitespace-nowrap">대분류</th>
              {months.map((m) => (
                <th key={`hm${m}`} className="text-right font-medium px-2 py-2 border-b border-slate-200 tabular-nums whitespace-nowrap min-w-[5rem]">
                  {monthLabel(m)}
                </th>
              ))}
              {activeQuarters.map((q, i) => {
                const [s, e] = ({ 1: [1, 3], 2: [4, 6], 3: [7, 9], 4: [10, 12] } as const)[q];
                const partial = e > maxMonth;
                return (
                  <th key={`hq${q}`} className={`text-right font-semibold px-2 py-2 border-b border-slate-200 whitespace-nowrap min-w-[5rem] ${YTD_HEAD_BG} ${i === 0 ? "border-l-2 border-l-slate-300" : ""}`}>
                    {q}분기
                    {partial && <span className="ml-0.5 text-[9.5px] font-normal text-slate-500">({s}~{maxMonth}월)</span>}
                  </th>
                );
              })}
              <th className={`text-right font-semibold px-2 py-2 border-b border-l border-slate-300 whitespace-nowrap min-w-[5.5rem] ${YTD_HEAD_BG}`}>
                누계(1~{maxMonth})
              </th>
            </tr>
          </thead>
          <tbody className="text-slate-800">
            {/* 전체 합계 */}
            <tr className="border-b border-slate-300 font-semibold text-slate-900">
              <td className="sticky left-0 z-10 bg-white px-3 py-1.5 whitespace-nowrap">전체 합계</td>
              {months.map((m) => {
                const curr = orderedCats.reduce((s, c) => s + cellSum(m, c, currMap), 0);
                const prev = orderedCats.reduce((s, c) => s + cellSum(m, c, prevMap), 0);
                return (
                  <td key={`sm${m}`} className="text-right px-2 py-1.5 align-top">
                    <CellContent m={metrics(curr, prev)} strong />
                  </td>
                );
              })}
              {activeQuarters.map((q, i) => {
                const curr = orderedCats.reduce((s, c) => s + quarterSum(q, c, currMap), 0);
                const prev = orderedCats.reduce((s, c) => s + quarterSum(q, c, prevMap), 0);
                return (
                  <td key={`sq${q}`} className={`text-right px-2 py-1.5 align-top ${YTD_CELL_BG} ${i === 0 ? "border-l-2 border-l-slate-300" : ""}`}>
                    <CellContent m={metrics(curr, prev)} strong />
                  </td>
                );
              })}
              {(() => {
                const curr = orderedCats.reduce((s, c) => s + ytdSum(c, currMap), 0);
                const prev = orderedCats.reduce((s, c) => s + ytdSum(c, prevMap), 0);
                return (
                  <td className={`text-right px-2 py-1.5 align-top border-l border-slate-300 ${YTD_CELL_BG}`}>
                    <CellContent m={metrics(curr, prev)} strong />
                  </td>
                );
              })()}
            </tr>

            {/* 카테고리별 */}
            {orderedCats.map((cat) => {
              const rowTotal = months.reduce((s, m) => s + cellSum(m, cat, currMap), 0);
              if (rowTotal === 0) return null;
              const isOpen = expanded.has(cat);
              const subCurr = isOpen ? buildSubMap(year, yearType, cat) : new Map<string, number[]>();
              const subPrev = isOpen ? buildSubMap(year - 1, "actual", cat) : new Map<string, number[]>();
              const subKeys = isOpen
                ? Array.from(new Set([...subCurr.keys(), ...subPrev.keys()]))
                    .filter((k) => k !== "-")
                    .sort((a, b) => (subCurr.get(b)?.reduce((s, v) => s + v, 0) ?? 0) - (subCurr.get(a)?.reduce((s, v) => s + v, 0) ?? 0))
                : [];
              return (
                <React.Fragment key={cat}>
                  <tr className="border-b border-slate-100 hover:bg-slate-50/70">
                    <td className="sticky left-0 z-10 bg-white px-3 py-1.5 whitespace-nowrap font-medium">
                      <button type="button" onClick={() => toggle(cat)} className="flex items-center gap-1.5 w-full text-left cursor-pointer hover:text-slate-950">
                        <span className="text-slate-400 w-3 shrink-0" aria-hidden>
                          {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </span>
                        <span>{cat}</span>
                      </button>
                    </td>
                    {months.map((m) => (
                      <td key={`c${cat}-m${m}`} className="text-right px-2 py-1.5 align-top">
                        <CellContent m={metrics(cellSum(m, cat, currMap), cellSum(m, cat, prevMap))} />
                      </td>
                    ))}
                    {activeQuarters.map((q, i) => (
                      <td key={`c${cat}-q${q}`} className={`text-right px-2 py-1.5 align-top ${YTD_CELL_BG} ${i === 0 ? "border-l-2 border-l-slate-300" : ""}`}>
                        <CellContent m={metrics(quarterSum(q, cat, currMap), quarterSum(q, cat, prevMap))} />
                      </td>
                    ))}
                    <td className={`text-right px-2 py-1.5 align-top border-l border-slate-300 ${YTD_CELL_BG}`}>
                      <CellContent m={metrics(ytdSum(cat, currMap), ytdSum(cat, prevMap))} />
                    </td>
                  </tr>
                  {/* 하위 lv2 (펼침 시) */}
                  {isOpen && subKeys.map((k) => (
                    <tr key={`${cat}-sub-${k}`} className="border-b border-slate-50 text-slate-600">
                      <td className="sticky left-0 z-10 bg-white px-3 py-1.5 whitespace-nowrap">
                        <span className="pl-[1.35rem] block text-[10.5px]">{k}</span>
                      </td>
                      {months.map((m) => (
                        <td key={`s-${cat}-${k}-m${m}`} className="text-right px-2 py-1.5 align-top text-[10.5px]">
                          <CellContent m={metrics(subCurr.get(k)?.[m - 1] ?? 0, subPrev.get(k)?.[m - 1] ?? 0)} isSub />
                        </td>
                      ))}
                      {activeQuarters.map((q, i) => {
                        const [s, e] = ({ 1: [1, 3], 2: [4, 6], 3: [7, 9], 4: [10, 12] } as const)[q];
                        let curr = 0, prev = 0;
                        for (let m = s; m <= e; m++) { curr += subCurr.get(k)?.[m - 1] ?? 0; prev += subPrev.get(k)?.[m - 1] ?? 0; }
                        return (
                          <td key={`s-${cat}-${k}-q${q}`} className={`text-right px-2 py-1.5 align-top text-[10.5px] ${YTD_CELL_BG} ${i === 0 ? "border-l-2 border-l-slate-300" : ""}`}>
                            <CellContent m={metrics(curr, prev)} isSub />
                          </td>
                        );
                      })}
                      {(() => {
                        let curr = 0, prev = 0;
                        for (let m = 1; m <= maxMonth; m++) { curr += subCurr.get(k)?.[m - 1] ?? 0; prev += subPrev.get(k)?.[m - 1] ?? 0; }
                        return (
                          <td className={`text-right px-2 py-1.5 align-top text-[10.5px] border-l border-slate-300 ${YTD_CELL_BG}`}>
                            <CellContent m={metrics(curr, prev)} isSub />
                          </td>
                        );
                      })()}
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
