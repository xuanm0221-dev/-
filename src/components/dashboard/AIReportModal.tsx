"use client";

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { X, Loader2, Download, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface KpiItem {
  label: string;
  monthlyCurrent: string;
  monthlyYoy: string;
  ytdCurrent: string;
  ytdYoy: string;
  direction: string;
}

interface CostRow {
  type: string;
  items: string;
  amount: string;
  ratio: string;
  yoy: string;
}

interface TopSummary {
  overall?: { delta: string; verdict: string; mainDriverCls: string; mainDriverDelta: string; worstBrand: string; worstDelta: string };
  notableWorst?: { brand: string; ratio: string; prev: string; delta: string };
  notableBest?: { brand: string; ratio: string; prev: string; delta: string };
  top3: { rank: number; brand: string; category: string; delta: string; amount: string }[];
}
interface BrandOverviewRow {
  brand: string;
  sales: string;
  ratio: string;
  prevRatio: string;
  delta: string;
  labRatio: string;
  adRatio: string;
  maxItem: string;
  signal: string;
}
interface ChangeDriverItem {
  brand: string;
  category: string;
  change: string;   // "0.00%→0.65%"
  delta: string;    // "+0.65%p"
  amount: string;
  action?: string;  // 카테고리 기반 액션 권고
}
interface ChangeDriverBrand {
  brand: string;
  verdict: string; // 악화/개선/유지
  ratio: string;
  delta: string;
  up: ChangeDriverItem[];
  down: ChangeDriverItem[];
}
interface ScoreCard {
  brand: string;
  grade: string;       // A/B/C/D
  total: number;       // 0-100
  ratio: number;       // 비용률 %
  yoyDelta: string;    // "+0.40%p"
  trend: { score: number; note: string };
  level: { score: number; note: string };
  ad: { score: number; note: string };
  plan: { score: number; note: string };
}
interface CheckpointItem {
  brand: string;
  severity: string;    // "🔴 즉시" / "🟡 모니터링" / "✅ 개선" / "📌 구조"
  category: string;
  change: string;      // "0.00%→0.65%" or "MLB 3.6% vs MLB 3.6%"
  delta: string;       // "+0.65%p"
  amount: string;      // "5,000K" or "-"
  note: string;
}
interface CheckpointGroup {
  brand: string;
  grade: string;
  items: CheckpointItem[];
}
interface FixedVarRow {
  brand: string;
  classification: string;  // 고정비/준고정비/변동비
  amount: string;
  prev: string;
  yoy: string;
  share: string;
  characteristics?: string;  // 구조 특성 (첫 행에만)
  trend?: string;            // 변동 추이 (첫 행에만)
  action?: string;           // 액션 (첫 행에만)
}

interface ParsedReport {
  meta: { year: string; yearType: string; title: string } | null;
  bullets: string[];
  kpi: KpiItem[];
  topSummary: TopSummary;
  scoreCards: ScoreCard[];
  checkpoints: CheckpointGroup[];
  brandOverview: BrandOverviewRow[];
  changeDrivers: ChangeDriverBrand[];
  fixedVar: FixedVarRow[];
  brandTable: string;
  riskTable: string;
  yoyTable: string;
  costRows: CostRow[];
  costInsight: string;
  keyInsight: string;
  detailed: string;
}

// ─────────────────────────────────────────────
// Parsing utilities
// ─────────────────────────────────────────────
function getSection(text: string, name: string): string {
  const marker = `===${name}===`;
  const start = text.indexOf(marker);
  if (start === -1) return "";
  const contentStart = start + marker.length;
  const rest = text.slice(contentStart);
  const nextIdx = rest.indexOf("\n===");
  return nextIdx === -1 ? rest.trim() : rest.slice(0, nextIdx).trim();
}

function parseMeta(s: string) {
  const p = s.split("|");
  if (p.length < 3) return null;
  return { year: p[0].trim(), yearType: p[1].trim(), title: p[2].trim() };
}

function parseBullets(s: string): string[] {
  return s
    .split("\n")
    .map((l) => l.replace(/^[•▸\-*]\s*/, "").trim())
    .filter(Boolean);
}

function parseKpi(s: string): KpiItem[] {
  return s
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = line.split("|").map((x) => x.trim());
      return {
        label: p[0] || "",
        monthlyCurrent: p[1] || "-",
        monthlyYoy: p[2] || "-",
        ytdCurrent: p[3] || "-",
        ytdYoy: p[4] || "-",
        direction: p[5] || "",
      };
    });
}

const COST_ROW_TYPES = ["고정비", "준고정비", "변동비", "합계"];

function parseCostRows(s: string): CostRow[] {
  return s
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("※"))
    .map((line) => {
      const p = line.split("|").map((x) => x.trim());
      return { type: p[0] || "", items: p[1] || "", amount: p[2] || "-", ratio: p[3] || "-", yoy: p[4] || "-" };
    })
    .filter((row) => COST_ROW_TYPES.includes(row.type));
}

function parseTopSummary(s: string): TopSummary {
  const result: TopSummary = { top3: [] };
  for (const line of s.split("\n").filter(Boolean)) {
    const p = line.split("|").map((x) => x.trim());
    if (p[0] === "OVERALL") {
      result.overall = { delta: p[1], verdict: p[2], mainDriverCls: p[3], mainDriverDelta: p[4], worstBrand: p[5], worstDelta: p[6] };
    } else if (p[0] === "NOTABLE_WORST") {
      result.notableWorst = { brand: p[1], ratio: p[2], prev: p[3], delta: p[4] };
    } else if (p[0] === "NOTABLE_BEST") {
      result.notableBest = { brand: p[1], ratio: p[2], prev: p[3], delta: p[4] };
    } else if (/^TOP\d+$/.test(p[0])) {
      result.top3.push({ rank: parseInt(p[0].slice(3), 10), brand: p[1], category: p[2], delta: p[3], amount: p[4] });
    }
  }
  return result;
}

function parseBrandOverview(s: string): BrandOverviewRow[] {
  return s.split("\n").filter(Boolean).map((line) => {
    const p = line.split("|").map((x) => x.trim());
    return {
      brand: p[0] || "", sales: p[1] || "-", ratio: p[2] || "-", prevRatio: p[3] || "-",
      delta: p[4] || "-", labRatio: p[5] || "-", adRatio: p[6] || "-",
      maxItem: p[7] || "-", signal: p[8] || "",
    };
  });
}

function parseChangeDrivers(s: string): ChangeDriverBrand[] {
  const groups: ChangeDriverBrand[] = [];
  let current: ChangeDriverBrand | null = null;
  for (const line of s.split("\n").filter(Boolean)) {
    const p = line.split("|").map((x) => x.trim());
    if (p[0] === "BRAND") {
      current = { brand: p[1] || "", verdict: p[2] || "", ratio: p[3] || "-", delta: p[4] || "-", up: [], down: [] };
      groups.push(current);
    } else if ((p[0] === "UP" || p[0] === "DOWN") && current) {
      const item: ChangeDriverItem = { brand: p[1] || "", category: p[2] || "", change: p[3] || "", delta: p[4] || "", amount: p[5] || "", action: p[6] || "" };
      if (p[0] === "UP") current.up.push(item);
      else current.down.push(item);
    }
  }
  return groups;
}

function parseScoreCards(s: string): ScoreCard[] {
  return s.split("\n").filter(Boolean).map((line) => {
    const p = line.split("|").map((x) => x.trim());
    return {
      brand: p[0] || "",
      grade: p[1] || "C",
      total: Number(p[2]) || 0,
      ratio: Number(p[3]) || 0,
      yoyDelta: p[4] || "+0.00%p",
      trend: { score: Number(p[5]) || 0, note: p[6] || "" },
      level: { score: Number(p[7]) || 0, note: p[8] || "" },
      ad: { score: Number(p[9]) || 0, note: p[10] || "" },
      plan: { score: Number(p[11]) || 0, note: p[12] || "" },
    };
  });
}

function parseCheckpoints(s: string): CheckpointGroup[] {
  const groups: CheckpointGroup[] = [];
  let current: CheckpointGroup | null = null;
  for (const line of s.split("\n").filter(Boolean)) {
    const p = line.split("|").map((x) => x.trim());
    if (p[0] === "BRAND_HEADER") {
      current = { brand: p[1] || "", grade: p[2] || "", items: [] };
      groups.push(current);
    } else if (p[0] === "ITEM" && current) {
      current.items.push({
        brand: p[1] || "",
        severity: p[2] || "",
        category: p[3] || "",
        change: p[4] || "",
        delta: p[5] || "",
        amount: p[6] || "-",
        note: p[7] || "",
      });
    }
  }
  return groups;
}

function parseFixedVar(s: string): FixedVarRow[] {
  return s.split("\n")
    .filter((l) => l.trim() && !l.startsWith("BY_BRAND_HEADER"))
    .map((line) => {
      const p = line.split("|").map((x) => x.trim());
      return {
        brand: p[0] || "",
        classification: p[1] || "",
        amount: p[2] || "-",
        prev: p[3] || "-",
        yoy: p[4] || "-",
        share: p[5] || "-",
        characteristics: p[6] || "",
        trend: p[7] || "",
        action: p[8] || "",
      };
    });
}

function parseReport(text: string): ParsedReport {
  return {
    meta: parseMeta(getSection(text, "META")),
    bullets: parseBullets(getSection(text, "BULLETS")),
    kpi: parseKpi(getSection(text, "KPI")),
    topSummary: parseTopSummary(getSection(text, "TOP_SUMMARY")),
    scoreCards: parseScoreCards(getSection(text, "SCORE_CARDS")),
    checkpoints: parseCheckpoints(getSection(text, "CHECKPOINTS")),
    brandOverview: parseBrandOverview(getSection(text, "BRAND_OVERVIEW")),
    changeDrivers: parseChangeDrivers(getSection(text, "CHANGE_DRIVERS")),
    fixedVar: parseFixedVar(getSection(text, "FIXED_VAR")),
    brandTable: getSection(text, "BRAND_TABLE"),
    riskTable: getSection(text, "RISK_TABLE"),
    yoyTable: getSection(text, "YOY_TABLE"),
    costRows: parseCostRows(getSection(text, "COST_STRUCTURE")),
    costInsight: getSection(text, "COST_INSIGHT"),
    keyInsight: getSection(text, "KEY_INSIGHT"),
    detailed: getSection(text, "DETAILED"),
  };
}

// ─────────────────────────────────────────────
// Markdown table renderer (compact, styled)
// ─────────────────────────────────────────────
// React 자식에서 plain text 추출 (마크다운이 <strong> 등으로 감싼 경우 포함)
function extractCellText(children: React.ReactNode): string {
  if (children == null || children === false) return "";
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractCellText).join("");
  if (React.isValidElement(children)) {
    return extractCellText((children.props as { children?: React.ReactNode }).children);
  }
  return "";
}
// children이 순수 string/number만으로 구성됐는지 (마크다운 인라인 포맷이 없는지)
function isPlainTextChildren(children: React.ReactNode): boolean {
  if (children == null || children === false) return true;
  if (typeof children === "string" || typeof children === "number") return true;
  if (Array.isArray(children)) return children.every(isPlainTextChildren);
  return false;
}

// 리스크 플래그 마크다운을 좌우 분할: 좌=법인전체+공통, 우=브랜드(MLB/KIDS/DISCOVERY)
function splitRiskTableMarkdown(md: string): [string, string] {
  if (!md || !md.trim()) return [md, ""];
  const lines = md.split("\n");
  if (lines.length < 3) return [md, ""];
  const header = lines.slice(0, 2);
  const rows = lines.slice(2).filter((l) => l.trim().length > 0);
  const brandStarts: number[] = [];
  rows.forEach((line, i) => {
    if (/^\|\s*\*\*[^*]+\*\*\s*\|/.test(line)) brandStarts.push(i);
  });
  if (brandStarts.length < 2) return [md, ""];
  const groups: string[][] = [];
  const groupNames: string[] = [];
  for (let i = 0; i < brandStarts.length; i++) {
    const s = brandStarts[i];
    const e = i + 1 < brandStarts.length ? brandStarts[i + 1] : rows.length;
    groups.push(rows.slice(s, e));
    const nm = rows[s].match(/\*\*\s*([^*]+?)\s*\*\*/)?.[1] ?? "";
    groupNames.push(nm);
  }
  // 좌측: 법인전체 + 공통 / 우측: 브랜드 (MLB, KIDS, DISCOVERY 등)
  const isLeftSide = (name: string) => /^(법인전체|법인|공통)$/.test(name);
  const leftGroups: string[][] = [];
  const rightGroups: string[][] = [];
  groups.forEach((g, i) => {
    if (isLeftSide(groupNames[i])) leftGroups.push(g);
    else rightGroups.push(g);
  });
  if (leftGroups.length === 0 || rightGroups.length === 0) {
    // 한쪽이 비면 행 수 기반 fallback
    const splitAt = Math.ceil(groups.length / 2);
    return [
      [...header, ...groups.slice(0, splitAt).flat()].join("\n"),
      [...header, ...groups.slice(splitAt).flat()].join("\n"),
    ];
  }
  return [
    [...header, ...leftGroups.flat()].join("\n"),
    [...header, ...rightGroups.flat()].join("\n"),
  ];
}

// Risk 셀: "메트릭1 / 메트릭2 / ... — 설명" 형태 → 번호 칩 + 설명 줄바꿈
function StructuredRiskCell({ text }: { text: string }) {
  const dashIdx = text.indexOf(" — ");
  const metricsPart = dashIdx >= 0 ? text.slice(0, dashIdx) : text;
  const explainPart = dashIdx >= 0 ? text.slice(dashIdx + 3) : "";
  const metrics = metricsPart.split(" / ").map((s) => s.trim()).filter(Boolean);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-x-2 gap-y-1">
        {metrics.map((m, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-700">
            <span className="inline-flex items-center justify-center w-[16px] h-[16px] rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold leading-none">
              {i + 1}
            </span>
            <span>{highlightInsight(m)}</span>
          </span>
        ))}
      </div>
      {explainPart && (
        <div className="flex items-start gap-1.5 text-[12.5px] text-slate-600 leading-[1.55]">
          <span className="text-slate-400 mt-px">└</span>
          <span>{highlightInsight(explainPart)}</span>
        </div>
      )}
    </div>
  );
}

// 판단 셀: "🟡 ... — ..." or "정상 — ..." 등 — 단일 줄로 강조 + 설명 분리
function StructuredJudgeCell({ text }: { text: string }) {
  // 선두 이모지/태그 분리
  const tagMatch = text.match(/^(🔴|🟡|🟢|정상(?:\([^)]+\))?|시즌 선집행 정상 패턴|개선|악화)\s*(.*)$/);
  const tag = tagMatch ? tagMatch[1] : "";
  const rest = tagMatch ? tagMatch[2] : text;
  const dashIdx = rest.indexOf(" — ");
  const head = dashIdx >= 0 ? rest.slice(0, dashIdx) : rest;
  const tail = dashIdx >= 0 ? rest.slice(dashIdx + 3) : "";

  // 이모지 신호등(🔴/🟡/🟢)은 자체 색상 신호이므로 박스 없이 그대로 표시
  // 텍스트 라벨(정상/개선/악화/시즌)만 컬러 칩 처리
  const isEmojiTag = tag === "🔴" || tag === "🟡" || tag === "🟢";
  const tagColor =
    tag === "악화" ? "bg-rose-50 text-rose-700 border border-rose-200"
    : tag === "개선" ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
    : tag.startsWith("정상") ? "bg-slate-50 text-slate-700 border border-slate-200"
    : tag === "시즌 선집행 정상 패턴" ? "bg-blue-50 text-blue-700 border border-blue-200"
    : "";

  return (
    <div className="space-y-0.5 text-[12.5px] leading-[1.55]">
      <div className="flex items-start gap-1.5 flex-wrap">
        {tag && isEmojiTag && (
          <span className="text-[14px] leading-none mt-px">{tag}</span>
        )}
        {tag && !isEmojiTag && (
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${tagColor}`}>
            {tag}
          </span>
        )}
        {head && <span className="text-slate-700">{highlightInsight(head)}</span>}
      </div>
      {tail && (
        <div className="flex items-start gap-1.5 text-slate-500">
          <span className="text-slate-400 mt-px">└</span>
          <span>{highlightInsight(tail)}</span>
        </div>
      )}
    </div>
  );
}

const mdTableComponents = {
  table: ({ ...props }: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="rpt-tbl" {...props} />
    </div>
  ),
  thead: ({ ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <thead {...props} />
  ),
  th: ({ children, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => {
    const text = String(children ?? "").trim();
    // 판정/판단 컬럼 헤더는 중앙 정렬 (신호등 셀과 일관성)
    if (text === "판정" || text === "판단") {
      return <th style={{ textAlign: "center" }} {...props}>{children}</th>;
    }
    return <th {...props}>{children}</th>;
  },
  td: ({ children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => {
    const text = extractCellText(children).trim();
    const isPlain = isPlainTextChildren(children);
    // 신호등/대시 단독 셀 → 중앙 정렬
    if (/^(🔴|🟡|🟢|—|-)$/.test(text)) {
      return (
        <td style={{ textAlign: "center", padding: "6px 8px" }} {...props}>
          {/^(🔴|🟡|🟢)$/.test(text)
            ? <span className="text-[14px] leading-none">{text}</span>
            : <span className="text-slate-400">{text}</span>}
        </td>
      );
    }
    // Risk 셀: 메트릭들 / 로 구분 + — 설명
    if (isPlain && text.includes(" / ") && /YTD\s*실적|계획비|사용률|연간계획/.test(text)) {
      return (
        <td {...props}>
          <StructuredRiskCell text={text} />
        </td>
      );
    }
    // 판단/최종판정 셀
    if (isPlain && /^(🔴|🟡|🟢|정상|개선|악화|시즌)/.test(text)) {
      return (
        <td {...props}>
          <StructuredJudgeCell text={text} />
        </td>
      );
    }
    // RISK_TABLE 카테고리 셀: "지급수수료 (인테리어 개발)" 등 → (lv2) 연한 회색 처리
    // 공통비용 오해 방지 라벨
    const lv2Match = isPlain && text.match(/^(지급수수료|복리후생비|IT수수료)\s*\(([^)]+)\)$/);
    if (lv2Match) {
      return (
        <td {...props}>
          <span>{lv2Match[1]}</span>
          <span className="ml-1 text-[10.5px] text-slate-400 font-normal">({lv2Match[2]})</span>
        </td>
      );
    }
    // 기본 렌더
    let cls = "";
    if (/개선/.test(text)) cls += " text-emerald-700 font-semibold";
    else if (/악화|경고/.test(text)) cls += " text-rose-700 font-semibold";
    else if (/주의/.test(text)) cls += " text-amber-700 font-semibold";
    return (
      <td className={cls.trim()} {...props}>
        {children}
      </td>
    );
  },
  tr: ({ children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => {
    const cells = React.Children.toArray(children);
    const firstCell = cells[0];
    const isGroupHeader =
      React.isValidElement(firstCell) &&
      React.Children.toArray(
        (firstCell as React.ReactElement<{ children?: React.ReactNode }>).props.children
      ).some(
        (c) =>
          React.isValidElement(c) &&
          (c.type === "strong" ||
            (c as React.ReactElement).type?.toString?.() === "strong")
      );
    return (
      <tr
        className={isGroupHeader ? "brand-header" : "hover:bg-gray-50"}
        {...props}
      >
        {children}
      </tr>
    );
  },
  p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="text-[12px] text-gray-600 leading-5 my-1.5" {...props}>
      {children}
    </p>
  ),
};

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

// 카테고리 키워드 (강조 대상 — 의미 단위)
const CATEGORY_RX = /(?:인당\s*인건비|인당매출|판매매출|총비용|비용률|인건비|광고비|수주회|세금과공과|복리후생비|지급수수료|출장비|IT수수료|임차료|감가상각비|차량렌트비|매출|기타)/.source;
const BRAND_RX = /(?:법인전체|법인|MLB|KIDS|DISCOVERY|공통)/.source;
const CHANNEL_RX = /(?:APP|ACC|Branding|Retailing|Products|CRM)\s*채널/.source;
const METRIC_RX = /(?:YOY|YTD|계획비|사용률|매출比)\s*\d+(?:\.\d+)?%/.source;
const CHANGE_RX = /\d+(?:\.\d+)?%\s*→\s*\d+(?:\.\d+)?%/.source;
const KEYWORD_RX = /(?:악화|개선|급감|급증|시점차|리스크|정상화|과집행|주의)/.source;

// 다크 배경용 하이라이트 (슬레이트 다크 위에 가독성 보장)
function highlightInsightDark(text: string): React.ReactNode[] {
  const regex = new RegExp(`(${CHANGE_RX})|(${METRIC_RX})|(${CATEGORY_RX})|(${CHANNEL_RX})|(${BRAND_RX})|(${KEYWORD_RX})`, "g");
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
    const [m, gChange, gMetric, gCat, gChannel, gBrand, gKw] = match;
    if (gChange) {
      parts.push(<strong key={key++} className="font-semibold text-purple-300">{m}</strong>);
    } else if (gMetric) {
      const numMatch = m.match(/(\d+(?:\.\d+)?)/);
      const num = numMatch ? parseFloat(numMatch[1]) : NaN;
      let color = "text-white";
      if (m.startsWith("YOY") || m.startsWith("계획비") || m.startsWith("사용률")) {
        color = num >= 110 ? "text-rose-300" : num <= 90 ? "text-sky-300" : "text-emerald-300";
      }
      parts.push(<strong key={key++} className={`font-semibold ${color}`}>{m}</strong>);
    } else if (gCat || gChannel) {
      parts.push(<strong key={key++} className="font-semibold text-white">{m}</strong>);
    } else if (gBrand) {
      parts.push(<strong key={key++} className="font-semibold text-indigo-200">{m}</strong>);
    } else if (gKw) {
      const kw = gKw;
      const color =
        kw === "악화" || kw === "급감" || kw === "리스크" || kw === "과집행" || kw === "급증" ? "text-rose-300"
        : kw === "개선" || kw === "정상화" ? "text-emerald-300"
        : kw === "시점차" || kw === "주의" ? "text-amber-300"
        : "text-white";
      parts.push(<strong key={key++} className={`font-semibold ${color}`}>{m}</strong>);
    }
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

// 텍스트에서 핵심 수치/키워드를 하이라이트해 React 노드 배열로 변환
// 강조 대상: 카테고리(총비용/매출/...), 율(YOY 90%), 율 변화(X% → Y%), 방향 키워드
// 강조 제외: K-금액 (배경 정보, 카테고리/율과 동시에 강조하면 시각 혼란)
function highlightInsight(text: string): React.ReactNode[] {
  const regex = new RegExp(`(${CHANGE_RX})|(${METRIC_RX})|(${CATEGORY_RX})|(${CHANNEL_RX})|(${BRAND_RX})|(${KEYWORD_RX})`, "g");
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
    const [m, gChange, gMetric, gCat, gChannel, gBrand, gKw] = match;
    if (gChange) {
      parts.push(<strong key={key++} className="font-semibold text-purple-700">{m}</strong>);
    } else if (gMetric) {
      const numMatch = m.match(/(\d+(?:\.\d+)?)/);
      const num = numMatch ? parseFloat(numMatch[1]) : NaN;
      let color = "text-slate-900";
      if (m.startsWith("YOY") || m.startsWith("계획비") || m.startsWith("사용률")) {
        color = num >= 110 ? "text-rose-700" : num <= 90 ? "text-blue-700" : "text-emerald-700";
      }
      parts.push(<strong key={key++} className={`font-semibold ${color}`}>{m}</strong>);
    } else if (gCat || gChannel) {
      parts.push(<strong key={key++} className="font-semibold text-slate-900">{m}</strong>);
    } else if (gBrand) {
      parts.push(<strong key={key++} className="font-semibold text-indigo-700">{m}</strong>);
    } else if (gKw) {
      const kw = gKw;
      const color =
        kw === "악화" || kw === "급감" || kw === "리스크" || kw === "과집행" || kw === "급증" ? "text-rose-700"
        : kw === "개선" || kw === "정상화" ? "text-emerald-700"
        : kw === "시점차" || kw === "주의" ? "text-amber-700"
        : "text-slate-900";
      parts.push(<strong key={key++} className={`font-semibold ${color}`}>{m}</strong>);
    }
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

// 그라데이션 헤더 — F&F CHINA 비용 적정성 검토
function GradientHeader({ year, month, mode, yearType }: { year: number; month: number; mode: string; yearType: string }) {
  const periodLabel = mode === "ytd"
    ? `${year}년 1~${month}월 누적`
    : `${year}년 ${month}월 (당월) · YTD 동반 분석`;
  const typeLabel = yearType === "plan" ? "예산 기준" : "실적 기준";
  return (
    <div
      className="mb-3 rounded-xl px-5 py-3.5 flex items-center justify-between text-white"
      style={{ background: "linear-gradient(135deg, #1E3A5F 0%, #4338CA 100%)" }}
    >
      <div>
        <div className="text-[15.5px] font-bold tracking-tight">F&amp;F CHINA 비용 적정성 검토</div>
        <div className="text-[11.5px] mt-0.5 opacity-80">
          {periodLabel} <span className="opacity-60">|</span> {typeLabel} <span className="opacity-60">|</span> 비용률 = 비용 × 1.13 / 리테일 매출
        </div>
      </div>
      <div className="text-[11px] opacity-60">생성 {new Date().toLocaleDateString("ko-KR")}</div>
    </div>
  );
}

// 상단 3카드: 전체 총평 · 주목 브랜드 · 변동 TOP 3
function TopSummaryCards({ data }: { data: TopSummary }) {
  if (!data.overall && data.top3.length === 0) return null;
  const verdictColor = data.overall?.verdict.includes("악화") ? "#B91C1C" : data.overall?.verdict.includes("개선") ? "#15803D" : "#4B5563";
  const rankIcon = ["🥇", "🥈", "🥉"];
  return (
    <div className="mb-3 grid grid-cols-1 lg:grid-cols-3 gap-2.5">
      {/* 전체 총평 */}
      <div className="rounded-lg p-3 bg-[#F8FAFF] border border-[#E0E7FF]">
        <div className="text-[11px] font-bold text-[#4338CA] mb-1.5">📊 YTD 전체 총평 · 해석</div>
        {data.overall && (
          <div className="text-[12px] leading-[1.65] text-slate-700">
            <div>
              법인 누적 비용률 (리테일매출 대비) YoY <b className="text-slate-900">{data.overall.delta}</b> ·{" "}
              <b style={{ color: verdictColor }}>{data.overall.verdict}</b>
            </div>
            <div className="mt-0.5">
              주도 분류 → <b>{data.overall.mainDriverCls}</b>{" "}
              <span className="text-slate-500">({data.overall.mainDriverDelta})</span>
            </div>
            {data.overall.worstBrand && (
              <div className="mt-1.5 px-2 py-1 bg-white border-l-2 border-rose-500 rounded-r text-[11.5px]">
                💡 가장 큰 변동 브랜드: <b>{data.overall.worstBrand}</b>{" "}
                <span className="text-rose-700 font-semibold">({data.overall.worstDelta})</span>
              </div>
            )}
          </div>
        )}
      </div>
      {/* 주목 브랜드 */}
      <div className="rounded-lg p-3 bg-[#F8FAFF] border border-[#E0E7FF]">
        <div className="text-[11px] font-bold text-[#4338CA] mb-1.5">🔍 YTD 주목 브랜드 · 동인</div>
        <div className="space-y-1.5">
          {data.notableWorst && (
            <div className="bg-rose-50 border-l-2 border-rose-600 rounded-r px-2 py-1.5">
              <div className="text-[12px]">
                <b className="text-rose-700">⚠ 주의: {data.notableWorst.brand}</b>{" "}
                비용률 <b>{data.notableWorst.ratio}</b>{" "}
                <span className="text-slate-400">(전년 {data.notableWorst.prev})</span>{" "}
                <b className="text-rose-700">{data.notableWorst.delta}</b>
              </div>
            </div>
          )}
          {data.notableBest && (
            <div className="bg-emerald-50 border-l-2 border-emerald-600 rounded-r px-2 py-1.5">
              <div className="text-[12px]">
                <b className="text-emerald-700">✅ 우수: {data.notableBest.brand}</b>{" "}
                비용률 <b>{data.notableBest.ratio}</b>{" "}
                <span className="text-slate-400">(전년 {data.notableBest.prev})</span>{" "}
                <b className="text-emerald-700">{data.notableBest.delta}</b>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* TOP 3 */}
      <div className="rounded-lg p-3 bg-[#F8FAFF] border border-[#E0E7FF]">
        <div className="text-[11px] font-bold text-[#4338CA] mb-1.5">📌 YTD 주요 비용 변동 원인 TOP 3</div>
        <div className="text-[12px] leading-[1.7] space-y-0.5">
          {data.top3.map((t, i) => {
            const positive = t.delta.startsWith("+");
            return (
              <div key={i} className="flex items-baseline gap-1.5">
                <span>{rankIcon[i] ?? `${t.rank}.`}</span>
                <span>
                  <b>{t.brand}</b> {t.category}{" "}
                  <b className={positive ? "text-rose-700" : "text-emerald-700"}>
                    {positive ? "▲" : "▼"} {t.delta.replace(/[+\-]/, "")}
                  </b>{" "}
                  <span className="text-slate-400">({t.amount})</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ExecSummaryHeader({
  meta,
  bullets,
}: {
  meta: ParsedReport["meta"];
  bullets: string[];
}) {
  return (
    <div className="mb-5 rounded-2xl overflow-hidden border border-purple-200 shadow-sm">
      <div className="flex items-center justify-between bg-gradient-to-r from-purple-700 to-indigo-600 px-5 py-3.5">
        <span className="text-white font-bold text-[13px] tracking-[0.18em]">
          EXECUTIVE SUMMARY
        </span>
        <span className="text-purple-100 text-[12px]">
          {meta?.title ?? "중국법인 연간 예산 구조 진단 요약"}
        </span>
      </div>
      <div className="bg-purple-50 px-5 py-3 space-y-1.5">
        {bullets.length > 0 ? (
          bullets.map((b, i) => (
            <div key={i} className="flex items-start gap-2.5 text-[13.5px] text-slate-700 leading-[1.6]">
              <span className="text-purple-600 font-bold flex-shrink-0 mt-px">▸</span>
              <span>{highlightInsight(b)}</span>
            </div>
          ))
        ) : (
          <div className="text-[11px] text-slate-400 animate-pulse py-1">분석 중...</div>
        )}
      </div>
    </div>
  );
}

const KPI_STYLES: Record<string, { border: string; bg: string; label: string }> = {
  판매매출: { border: "border-blue-200", bg: "bg-blue-50/60", label: "text-blue-600" },
  총비용: { border: "border-orange-200", bg: "bg-orange-50/60", label: "text-orange-600" },
  광고비: { border: "border-rose-200", bg: "bg-rose-50/60", label: "text-rose-600" },
  비용률: { border: "border-emerald-200", bg: "bg-emerald-50/60", label: "text-emerald-600" },
  인원: { border: "border-violet-200", bg: "bg-violet-50/60", label: "text-violet-600" },
};

function YoyBadge({ value, isBad, isGood }: { value: string; isBad: boolean; isGood: string | boolean }) {
  if (!value || value === "-") return null;
  return (
    <span
      className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${
        isBad ? "bg-red-100 text-red-700" : isGood ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
      }`}
    >
      {value}
    </span>
  );
}

// 광고비 카드: BRAND:VALUE:YOY 형식의 필드를 파싱해 브랜드별 행으로 변환
function parseAdBrands(item: KpiItem): { name: string; value: string; yoy: string }[] {
  const fields = [item.monthlyCurrent, item.monthlyYoy, item.ytdCurrent, item.ytdYoy, item.direction];
  return fields
    .filter((s) => s && s !== "-" && s.includes(":"))
    .map((s) => {
      const [name, value, yoy] = s.split(":");
      return { name: name.trim(), value: value?.trim() ?? "", yoy: yoy?.trim() ?? "" };
    });
}

function KpiCards({ kpi }: { kpi: KpiItem[] }) {
  if (kpi.length === 0) return null;
  // 카드 폭을 콘텐츠 길이에 맞게 차등 부여 (단순 숫자 카드는 좁게, 복잡 카드는 넓게)
  const widthFr: Record<string, number> = {
    판매매출: 0.85,
    총비용: 0.85,
    광고비: 1.05,
    비용률: 1.15,
    인원: 1.25,
  };
  const gridTemplateColumns = kpi.map((it) => `${widthFr[it.label] ?? 1}fr`).join(" ");
  return (
    <div className="grid gap-2 mb-5 items-stretch" style={{ gridTemplateColumns }}>
      {kpi.map((item) => {
        const s = KPI_STYLES[item.label] ?? {
          border: "border-slate-200",
          bg: "bg-slate-50/40",
          label: "text-slate-500",
        };
        const isGood =
          item.direction === "개선" ||
          (item.label === "판매매출" && item.ytdYoy && parseFloat(item.ytdYoy) > 100);
        const isBad = item.direction === "악화";
        const isInwon = item.label === "인원";
        const isBiyongYul = item.label === "비용률";
        const isAd = item.label === "광고비";

        const row1Label = isInwon ? "(기말/평균)" : "(당월)";
        const row2Label = isInwon ? "(인당매출 YTD)" : "(YTD누적)";

        const labelW = "w-[78px] text-[11.5px] text-slate-500 shrink-0";
        const valW = "text-[14.5px] font-bold text-slate-900 leading-tight";

        return (
          <div
            key={item.label}
            className={`border ${s.border} ${s.bg} rounded-2xl px-4 py-2.5 flex flex-col shadow-sm`}
          >
            <div className={`text-[12.5px] font-semibold tracking-wide uppercase ${s.label}`}>
              {item.label}
              {isAd && <span className="ml-1 text-[10.5px] font-normal text-slate-400 normal-case">YTD</span>}
            </div>

            {isAd ? (
              <div className="mt-2 space-y-1">
                {parseAdBrands(item).map((b, i) => (
                  <div key={i} className="flex items-baseline gap-1.5">
                    <span className="w-[68px] text-[11px] font-semibold text-slate-600 shrink-0">{b.name}</span>
                    <span className="text-[13px] font-bold text-slate-900 leading-tight">{b.value}</span>
                    <YoyBadge value={b.yoy} isBad={parseFloat(b.yoy) > 130 || parseFloat(b.yoy) < 70} isGood={parseFloat(b.yoy) >= 90 && parseFloat(b.yoy) <= 110} />
                  </div>
                ))}
              </div>
            ) : (
              <>
                {/* row 1 — label · value · YOY 한 줄 */}
                <div className="mt-2 flex items-baseline gap-2">
                  <span className={labelW}>{row1Label}</span>
                  <span className={valW}>{item.monthlyCurrent}</span>
                  {isInwon ? (
                    <span className={`text-[12px] font-medium ${
                      item.monthlyYoy?.startsWith("+") ? "text-emerald-600" :
                      item.monthlyYoy?.startsWith("-") ? "text-rose-600" : "text-slate-400"
                    }`}>
                      {item.monthlyYoy}
                    </span>
                  ) : isBiyongYul ? (
                    <span className="text-[12px] text-slate-500">{item.monthlyYoy}</span>
                  ) : (
                    <YoyBadge value={item.monthlyYoy} isBad={isBad} isGood={isGood} />
                  )}
                </div>

                {/* row 2 */}
                <div className="mt-1 flex items-baseline gap-2">
                  <span className={labelW}>{row2Label}</span>
                  <span className={valW}>{item.ytdCurrent}</span>
                  {isBiyongYul ? (
                    <span className="text-[12px] text-slate-500">{item.ytdYoy}</span>
                  ) : (
                    <YoyBadge value={item.ytdYoy} isBad={isBad} isGood={isGood} />
                  )}
                </div>
                {/* row 3 — 비용률 코멘트: 값 컬럼 아래에 정렬 (라벨 폭 78px + gap 8px) */}
                {isBiyongYul && item.direction && (
                  <div className={`mt-0.5 pl-[86px] text-[11.5px] font-semibold ${isGood ? "text-emerald-600" : isBad ? "text-rose-600" : "text-slate-500"}`}>
                    {item.direction}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TableBox({
  title,
  markdown,
  className = "",
  accent = "indigo",
}: {
  title: string;
  markdown: string;
  className?: string;
  accent?: "indigo" | "rose" | "amber" | "emerald";
}) {
  const accentMap: Record<string, { border: string; headerBg: string; bar: string; title: string }> = {
    indigo: { border: "border-indigo-200", headerBg: "bg-indigo-50/70", bar: "bg-indigo-500", title: "text-indigo-900" },
    rose: { border: "border-rose-200", headerBg: "bg-rose-50/70", bar: "bg-rose-500", title: "text-rose-900" },
    amber: { border: "border-amber-200", headerBg: "bg-amber-50/70", bar: "bg-amber-500", title: "text-amber-900" },
    emerald: { border: "border-emerald-200", headerBg: "bg-emerald-50/70", bar: "bg-emerald-500", title: "text-emerald-900" },
  };
  const a = accentMap[accent];
  return (
    <div className={`border ${a.border} rounded-2xl bg-white shadow-sm overflow-hidden ${className}`}>
      <div className={`px-5 py-2.5 border-b ${a.border} ${a.headerBg} flex items-center gap-2`}>
        <span className={`inline-block w-1 h-3.5 rounded-sm ${a.bar}`} />
        <span className={`text-[13px] font-semibold tracking-tight ${a.title}`}>
          {title}
        </span>
      </div>
      <div className="p-4 overflow-x-auto">
        {markdown ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdTableComponents as never}>
            {markdown}
          </ReactMarkdown>
        ) : (
          <div className="text-xs text-slate-400 animate-pulse py-4 text-center">
            생성 중...
          </div>
        )}
      </div>
    </div>
  );
}

const COST_TYPE_STYLES: Record<string, string> = {
  고정비:   "bg-blue-50/70 text-blue-700 font-semibold rounded-md",
  준고정비: "bg-amber-50/70 text-amber-700 font-semibold rounded-md",
  변동비:   "bg-emerald-50/70 text-emerald-700 font-semibold rounded-md",
  합계:     "bg-slate-100 text-slate-900 font-bold rounded-md",
};

function CostStructureSection({
  rows,
  insight,
}: {
  rows: CostRow[];
  insight: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
      <div className="border border-slate-200 rounded-2xl bg-white shadow-sm overflow-hidden lg:col-span-2">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
          <span className="inline-block w-1 h-3.5 bg-emerald-500 rounded-sm" />
          <span className="text-[12.5px] font-semibold text-slate-800">
            YTD 비용 구조 (고정 / 준고정 / 변동)
          </span>
        </div>
        <div className="p-4 overflow-x-auto">
          <table className="w-full text-[12px] leading-[1.55]" style={{ borderCollapse: "separate", borderSpacing: 0, fontVariantNumeric: "tabular-nums" }}>
            <colgroup>
              <col style={{ width: "84px" }} />
              <col />
              <col style={{ width: "100px" }} />
              <col style={{ width: "84px" }} />
              <col style={{ width: "84px" }} />
            </colgroup>
            <thead>
              <tr className="bg-slate-50">
                <th className="px-3 py-2 text-center font-semibold text-slate-600 text-[11px] border-y border-slate-200">분류</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-600 text-[11px] border-y border-slate-200">포함 항목</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600 text-[11px] border-y border-slate-200 whitespace-nowrap">금액</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600 text-[11px] border-y border-slate-200 whitespace-nowrap">구성비</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600 text-[11px] border-y border-slate-200 whitespace-nowrap">YOY</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isTotal = r.type === "합계";
                const cellCls = isTotal
                  ? "px-3 py-2.5 border-t-2 border-slate-300 border-b border-slate-100 bg-slate-50/40"
                  : "px-3 py-2.5 border-b border-slate-100";
                return (
                  <tr key={i} className={isTotal ? "" : "hover:bg-slate-50/60"}>
                    <td className={`${cellCls} text-center ${COST_TYPE_STYLES[r.type] ?? ""}`}>
                      {r.type}
                    </td>
                    <td className={`${cellCls} ${isTotal ? "text-slate-700 font-semibold" : "text-slate-600"}`}>
                      {r.items}
                    </td>
                    <td className={`${cellCls} text-right whitespace-nowrap ${isTotal ? "text-slate-900 font-bold" : "text-slate-800 font-medium"}`}>
                      {r.amount}
                    </td>
                    <td className={`${cellCls} text-right whitespace-nowrap ${isTotal ? "text-slate-900 font-bold" : "text-slate-700"}`}>
                      {r.ratio}
                    </td>
                    <td className={`${cellCls} text-right whitespace-nowrap ${isTotal ? "text-slate-900 font-bold" : "text-slate-700"}`}>
                      {r.yoy}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[10.5px] text-slate-400 mt-2.5">※ YTD 법인 전체 기준</p>
        </div>
      </div>
      {insight && <CostStructureInsightCard insight={insight} />}
    </div>
  );
}

// 비용 구조 인사이트 — 핵심 수치 강조 카드
function CostStructureInsightCard({ insight }: { insight: string }) {
  // 빌더 출력 패턴: "▶ YTD 총비용의 X%를 광고비·수주회 중심 변동비가 차지하며, 광고비 단독으로 전체 비용의 Y% 점유 — 결론"
  const cleaned = insight.replace(/^▶\s*/, "").trim();
  const dashIdx = cleaned.indexOf(" — ");
  const main = dashIdx >= 0 ? cleaned.slice(0, dashIdx) : cleaned;
  const conclusion = dashIdx >= 0 ? cleaned.slice(dashIdx + 3).trim() : "";
  const pcts = main.match(/\d+(?:\.\d+)?%/g) ?? [];
  const varShare = pcts[0];
  const adShare = pcts[1];
  const isStructured = !!(varShare && adShare && conclusion);

  return (
    <div className="border border-indigo-200 rounded-2xl bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-2.5 border-b border-indigo-100 bg-gradient-to-r from-indigo-50 to-slate-50 flex items-center gap-2">
        <span className="inline-block w-1 h-3.5 bg-indigo-500 rounded-sm" />
        <span className="text-[13px] font-semibold text-indigo-900">비용 구조 인사이트</span>
      </div>
      {isStructured ? (
        <div className="px-4 py-3.5 space-y-3">
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-lg border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white px-3 py-2.5">
              <div className="text-[10px] font-semibold text-emerald-700 tracking-wide uppercase">변동비 점유</div>
              <div className="mt-0.5 text-[22px] font-bold leading-tight text-emerald-700" style={{ fontVariantNumeric: "tabular-nums" }}>
                {varShare}
              </div>
              <div className="text-[10.5px] text-slate-500 mt-0.5">광고비·수주회 중심</div>
            </div>
            <div className="rounded-lg border border-rose-200 bg-gradient-to-br from-rose-50 to-white px-3 py-2.5">
              <div className="text-[10px] font-semibold text-rose-700 tracking-wide uppercase">광고비 단독</div>
              <div className="mt-0.5 text-[22px] font-bold leading-tight text-rose-700" style={{ fontVariantNumeric: "tabular-nums" }}>
                {adShare}
              </div>
              <div className="text-[10.5px] text-slate-500 mt-0.5">전체 비용 점유율</div>
            </div>
          </div>
          <div className="rounded-md border-l-4 border-indigo-500 bg-indigo-50/60 px-3 py-2">
            <div className="text-[9.5px] font-bold tracking-wider text-indigo-600 uppercase mb-0.5">📌 핵심 결론</div>
            <div className="text-[13px] font-semibold text-slate-800 leading-[1.5]">
              {highlightInsight(conclusion)}
            </div>
          </div>
        </div>
      ) : (
        <div className="px-5 py-3.5 text-[13.5px] leading-[1.55] text-slate-700">
          {highlightInsight(insight)}
        </div>
      )}
    </div>
  );
}

// ② 브랜드별 비용 효율 종합 스코어 카드 (예시.html 톤)
function ScoreCardsGrid({ scoreCards }: { scoreCards: ScoreCard[] }) {
  if (scoreCards.length === 0) return null;
  // 예시 HTML의 정확한 색상 매핑
  const GRADE_STYLE: Record<string, { border: string; bg: string; text: string; label: string }> = {
    A: { border: "#A7F3D0", bg: "#F0FDF4", text: "#15803D", label: "우수" },
    B: { border: "#BFDBFE", bg: "#EFF6FF", text: "#0369A1", label: "양호" },
    C: { border: "#FDE68A", bg: "#FFFBEB", text: "#B45309", label: "주의" },
    D: { border: "#FECACA", bg: "#FEF2F2", text: "#B91C1C", label: "위험" },
  };
  const Bar = ({ value, max, color }: { value: number; max: number; color: string }) => (
    <div className="rounded-[3px] h-1 overflow-hidden" style={{ background: "#E5E7EB" }}>
      <div className="h-1" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color, borderRadius: 3 }} />
    </div>
  );
  return (
    <div className="mb-3 rounded-xl border border-[#E5E7EB] bg-white px-4 py-3">
      <div className="text-[13px] font-bold text-[#1E3A5F] border-l-[3px] border-[#6366F1] pl-2 mb-2.5">
        ② 브랜드별 YTD 비용 효율 종합 스코어
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
        {scoreCards.map((s) => {
          const g = GRADE_STYLE[s.grade] ?? GRADE_STYLE.C;
          const deltaPositive = s.yoyDelta.startsWith("+");
          return (
            <div
              key={s.brand}
              className="rounded-xl p-3"
              style={{ border: `2px solid ${g.border}`, background: g.bg }}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-bold text-slate-900">{s.brand}</span>
              </div>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="font-black leading-none" style={{ fontSize: 36, color: g.text }}>{s.grade}</span>
                <span className="text-[12px] font-bold" style={{ color: g.text }}>{g.label}</span>
              </div>
              <div className="text-[10.5px] text-slate-500 mt-0.5">종합 {s.total}점 / 100점</div>
              <div className="mt-1.5 space-y-1">
                <div>
                  <div className="flex justify-between text-[10px] text-slate-500"><span>추세</span><span className="font-semibold" style={{ color: "#15803D" }}>{s.trend.score}점</span></div>
                  <Bar value={s.trend.score} max={35} color="#15803D" />
                  <div className="text-[9.5px] text-slate-400 mt-0.5 truncate">{s.trend.note}</div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-slate-500"><span>수준</span><span className="font-semibold" style={{ color: "#0369A1" }}>{s.level.score}점</span></div>
                  <Bar value={s.level.score} max={30} color="#0369A1" />
                  <div className="text-[9.5px] text-slate-400 mt-0.5 truncate">{s.level.note}</div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-slate-500"><span>광고비율</span><span className="font-semibold" style={{ color: "#B45309" }}>{s.ad.score}점</span></div>
                  <Bar value={s.ad.score} max={20} color="#B45309" />
                  <div className="text-[9.5px] text-slate-400 mt-0.5 truncate">{s.ad.note}</div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-slate-500"><span>계획집행</span><span className="font-semibold" style={{ color: "#7C3AED" }}>{s.plan.score}점</span></div>
                  <Bar value={s.plan.score} max={15} color="#7C3AED" />
                  <div className="text-[9.5px] text-slate-400 mt-0.5 truncate">{s.plan.note}</div>
                </div>
              </div>
              <div className="mt-2 pt-1.5 border-t text-[11px]" style={{ borderColor: g.border }}>
                총비용률 <strong className="text-slate-900">{s.ratio.toFixed(2)}%</strong>{" "}
                <span className="font-semibold" style={{ color: deltaPositive ? "#B91C1C" : "#15803D" }}>{s.yoyDelta}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2.5 text-[10.5px] text-slate-500 flex flex-wrap gap-x-3">
        <span><strong style={{ color: "#15803D" }}>A(75+)</strong> 우수</span>
        <span><strong style={{ color: "#0369A1" }}>B(55~74)</strong> 양호</span>
        <span><strong style={{ color: "#B45309" }}>C(35~54)</strong> 주의</span>
        <span><strong style={{ color: "#B91C1C" }}>D(~34)</strong> 위험</span>
        <span className="ml-2">· 추세(35) + 수준(30) + 광고비율(20) + 계획집행(15) = 100</span>
      </div>
    </div>
  );
}

// ③ 브랜드별 체크포인트 (예시.html 톤)
function CheckpointsGrid({ groups }: { groups: CheckpointGroup[] }) {
  if (groups.length === 0) return null;
  // 예시 HTML의 정확한 색상 매핑
  const SEV_STYLE: Record<string, { border: string; bg: string }> = {
    "🔴": { border: "#FECACA", bg: "#FEF2F2" },
    "🟡": { border: "#FDE68A", bg: "#FFFBEB" },
    "✅": { border: "#A7F3D0", bg: "#F0FDF4" },
    "📌": { border: "#BFDBFE", bg: "#EFF6FF" },
    "📊": { border: "#E5E7EB", bg: "#F9FAFB" },
    "🔵": { border: "#BAE6FD", bg: "#F0F9FF" },
    "▸": { border: "#E5E7EB", bg: "#FAFAFA" },
    "ℹ": { border: "#DDD6FE", bg: "#F5F3FF" },
    "💧": { border: "#A5F3FC", bg: "#ECFEFF" },
    "🔀": { border: "#FDE68A", bg: "#FFFBEB" },
    "📈": { border: "#C7D2FE", bg: "#EEF2FF" },
  };
  return (
    <div className="mb-3 rounded-xl border border-[#E5E7EB] bg-white px-4 py-3">
      <div className="text-[13px] font-bold text-[#1E3A5F] border-l-[3px] border-[#6366F1] pl-2 mb-2.5">
        ③ 브랜드별 YTD 체크포인트 — 지금 바로 확인해야 할 것
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
        {groups.map((g) => {
          const gradeIcon = g.grade === "A" ? "🟢" : g.grade === "B" ? "🟢" : g.grade === "C" ? "🟡" : "🔴";
          return (
            <div key={g.brand} className="rounded-[10px] border border-[#E5E7EB] bg-white px-3 py-2.5">
              <div className="text-[13px] font-bold text-slate-900 border-b-2 border-[#E5E7EB] pb-1 mb-1">
                {g.brand} {gradeIcon}
              </div>
              {g.items.length === 0 ? (
                <div className="text-[11px] text-slate-400 py-1.5">특이사항 없음</div>
              ) : (
                <div className="space-y-1.5 mt-1">
                  {g.items.map((it, i) => {
                    const key = it.severity.charAt(0);
                    const st = SEV_STYLE[key] ?? SEV_STYLE["📌"];
                    return (
                      <div key={i} className="rounded-[7px] px-2 py-1.5" style={{ border: `1px solid ${st.border}`, background: st.bg }}>
                        <div className="text-[11.5px] font-semibold text-slate-900 leading-snug">
                          {it.severity} {it.category} — {it.change}
                          {it.delta && <span className="font-semibold"> ({it.delta})</span>}
                        </div>
                        <div className="text-[10.5px] text-slate-500 mt-0.5 leading-snug">
                          {it.amount !== "-" && <span>당해 {it.amount} 발생. </span>}{it.note}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 고정/변동/준고정 비용 구조 분석 (예시 톤)
function FixedVarTable({ rows }: { rows: FixedVarRow[] }) {
  if (rows.length === 0) return null;
  const byBrand: Record<string, FixedVarRow[]> = {};
  for (const r of rows) {
    if (!byBrand[r.brand]) byBrand[r.brand] = [];
    byBrand[r.brand].push(r);
  }
  const CLS_STYLE: Record<string, { bg: string; color: string }> = {
    고정비: { bg: "#EFF6FF", color: "#0369A1" },
    준고정비: { bg: "#FFFBEB", color: "#B45309" },
    변동비: { bg: "#F0FDF4", color: "#15803D" },
  };
  return (
    <div className="mb-3 rounded-xl border border-[#E5E7EB] bg-white px-4 py-3">
      <div className="text-[13px] font-bold text-[#1E3A5F] border-l-[3px] border-[#6366F1] pl-2 mb-2.5">
        ⑦ 브랜드별 YTD 비용 구조 (고정 / 준고정 / 변동)
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]" style={{ borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr className="bg-[#F9FAFB] text-[11px] text-[#4B5563]">
              <th className="border border-[#E5E7EB] px-2 py-1.5 text-left">브랜드</th>
              <th className="border border-[#E5E7EB] px-2 py-1.5">분류</th>
              <th className="border border-[#E5E7EB] px-2 py-1.5">당해K</th>
              <th className="border border-[#E5E7EB] px-2 py-1.5">전년K</th>
              <th className="border border-[#E5E7EB] px-2 py-1.5">YoY</th>
              <th className="border border-[#E5E7EB] px-2 py-1.5">구성비</th>
              <th className="border border-[#E5E7EB] px-2 py-1.5 text-left min-w-[260px]">구조 분석 · 액션</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(byBrand).map(([brand, brandRows]) => {
              const head = brandRows.find((r) => r.characteristics) ?? brandRows[0];
              return (
                <React.Fragment key={brand}>
                  {brandRows.map((r, i) => {
                    const cls = CLS_STYLE[r.classification];
                    return (
                      <tr key={i}>
                        {i === 0 && (
                          <td className="border border-[#E5E7EB] px-2 py-1.5 font-bold text-slate-900 align-top" rowSpan={brandRows.length}>{brand}</td>
                        )}
                        <td className="border border-[#E5E7EB] px-2 py-1.5 text-center font-semibold" style={cls ? { background: cls.bg, color: cls.color } : undefined}>
                          {r.classification}
                        </td>
                        <td className="border border-[#E5E7EB] px-2 py-1.5 text-right font-medium">{r.amount}</td>
                        <td className="border border-[#E5E7EB] px-2 py-1.5 text-right text-slate-400">{r.prev}</td>
                        <td className="border border-[#E5E7EB] px-2 py-1.5 text-right font-semibold">{r.yoy}</td>
                        <td className="border border-[#E5E7EB] px-2 py-1.5 text-right">{r.share}</td>
                        {i === 0 && (
                          <td className="border border-[#E5E7EB] px-3 py-2 text-left align-top text-[11.5px] leading-[1.55]" rowSpan={brandRows.length}>
                            {head.characteristics && (
                              <div className="text-slate-700"><span className="font-semibold text-slate-900">▸ 특성:</span> {head.characteristics}</div>
                            )}
                            {head.trend && (
                              <div className="text-slate-600 mt-1"><span className="font-semibold text-slate-700">▸ 추이:</span> {head.trend}</div>
                            )}
                            {head.action && (
                              <div className="text-indigo-700 mt-1.5 bg-indigo-50 border-l-2 border-indigo-400 pl-2 py-1 rounded-r">
                                <span className="font-semibold">▸ 액션:</span> {head.action}
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ④ 브랜드별 한눈에 보기 (BRAND_OVERVIEW)
function BrandOverviewTable({ rows }: { rows: BrandOverviewRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-3 rounded-xl border border-[#E5E7EB] bg-white px-4 py-3">
      <div className="text-[13px] font-bold text-[#1E3A5F] border-l-[3px] border-[#6366F1] pl-2 mb-2.5">
        ④ 브랜드별 YTD 비용 현황 한눈에 보기
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]" style={{ borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr className="bg-[#F9FAFB] text-[11px] text-[#4B5563]">
              <th className="border border-[#E5E7EB] px-2 py-1.5 text-left">브랜드</th>
              <th className="border border-[#E5E7EB] px-2 py-1.5">매출(K)</th>
              <th className="border border-[#E5E7EB] px-2 py-1.5">총비용률</th>
              <th className="border border-[#E5E7EB] px-2 py-1.5">전년</th>
              <th className="border border-[#E5E7EB] px-2 py-1.5">YoY</th>
              <th className="border border-[#E5E7EB] px-2 py-1.5">인건비율</th>
              <th className="border border-[#E5E7EB] px-2 py-1.5">광고비율</th>
              <th className="border border-[#E5E7EB] px-2 py-1.5 text-left min-w-[180px]">최대 변동 항목</th>
              <th className="border border-[#E5E7EB] px-2 py-1.5">신호</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const positive = r.delta.startsWith("+");
              return (
                <tr key={i}>
                  <td className="border border-[#E5E7EB] px-2 py-1.5 font-bold text-slate-900">{r.brand}</td>
                  <td className="border border-[#E5E7EB] px-2 py-1.5 text-right">{r.sales}</td>
                  <td className="border border-[#E5E7EB] px-2 py-1.5 text-right font-bold text-[13px]">{r.ratio}</td>
                  <td className="border border-[#E5E7EB] px-2 py-1.5 text-right text-slate-400">{r.prevRatio}</td>
                  <td className={`border border-[#E5E7EB] px-2 py-1.5 text-right font-bold ${positive ? "text-rose-700" : "text-emerald-700"}`}>{r.delta}</td>
                  <td className="border border-[#E5E7EB] px-2 py-1.5 text-right">{r.labRatio}</td>
                  <td className="border border-[#E5E7EB] px-2 py-1.5 text-right">{r.adRatio}</td>
                  <td className="border border-[#E5E7EB] px-2 py-1.5 text-[11px] text-slate-600">{r.maxItem}</td>
                  <td className="border border-[#E5E7EB] px-2 py-1.5 text-center text-[15px]">{r.signal}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ⑤ 변동 원인 분석 (CHANGE_DRIVERS) — 브랜드별 상승/하락 grid
function ChangeDriversGrid({ groups }: { groups: ChangeDriverBrand[] }) {
  if (groups.length === 0) return null;
  const cardBg = (verdict: string) => {
    if (verdict === "악화") return "bg-rose-50 border-rose-200";
    if (verdict === "개선") return "bg-emerald-50 border-emerald-200";
    if (verdict === "매출효과") return "bg-cyan-50 border-cyan-200";
    return "bg-slate-50 border-slate-200";
  };
  return (
    <div className="mb-3 rounded-xl border border-[#E5E7EB] bg-white px-4 py-3">
      <div className="text-[13px] font-bold text-[#1E3A5F] border-l-[3px] border-[#6366F1] pl-2 mb-2.5">
        ⑤ YTD 비용 변동 원인 분석 — 왜 늘었나 / 왜 줄었나
      </div>
      {/* CSS columns 레이아웃 — 카드 자연 높이 + 열별 패킹 (공백 최소화) */}
      <div className="columns-1 lg:columns-2 gap-3 [column-fill:balance]">
        {groups.map((g) => {
          const positive = g.delta.startsWith("+");
          return (
            <div key={g.brand} className={`border rounded-lg p-3 mb-3 break-inside-avoid ${cardBg(g.verdict)}`}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[13.5px] font-bold text-slate-900">{g.brand}</span>
                <span className="text-[15px]">{g.verdict === "악화" ? "🔴" : g.verdict === "개선" ? "🟢" : g.verdict === "매출효과" ? "💧" : "🟡"}</span>
                <span className="ml-auto text-[11px] text-slate-600">
                  총비용률 <b className="text-slate-900 text-[12.5px]">{g.ratio}</b>{" "}
                  <b className={positive ? "text-rose-700" : "text-emerald-700"}>{g.delta}</b>
                </span>
              </div>
              {g.up.length > 0 && (
                <>
                  <div className="text-[10.5px] font-bold text-rose-700 mt-2 mb-1.5">📈 상승 원인</div>
                  <div className="space-y-1.5">
                    {g.up.map((it, i) => (
                      <div key={i} className="bg-white/70 rounded px-2 py-1.5 border border-rose-100">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-[12px] font-semibold text-slate-900">{it.category}</span>
                          <span className="text-[10.5px] text-slate-400 whitespace-nowrap">{it.change}</span>
                          <span className="text-[12px] font-bold text-rose-700 whitespace-nowrap">{it.delta}</span>
                          <span className="text-[10.5px] text-slate-500 whitespace-nowrap">{it.amount}</span>
                        </div>
                        {it.action && (
                          <div className="text-[10.5px] text-slate-600 mt-0.5 leading-snug">
                            <span className="text-rose-600 font-semibold">▸ 액션:</span> {it.action}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
              {g.down.length > 0 && (
                <>
                  <div className="text-[10.5px] font-bold text-emerald-700 mt-2 mb-1.5">📉 하락 요인</div>
                  <div className="space-y-1.5">
                    {g.down.map((it, i) => (
                      <div key={i} className="bg-white/70 rounded px-2 py-1.5 border border-emerald-100">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-[12px] font-semibold text-slate-900">{it.category}</span>
                          <span className="text-[10.5px] text-slate-400 whitespace-nowrap">{it.change}</span>
                          <span className="text-[12px] font-bold text-emerald-700 whitespace-nowrap">{it.delta}</span>
                          <span className="text-[10.5px] text-slate-500 whitespace-nowrap">{it.amount}</span>
                        </div>
                        {it.action && (
                          <div className="text-[10.5px] text-slate-600 mt-0.5 leading-snug">
                            <span className="text-emerald-600 font-semibold">▸ 액션:</span> {it.action}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
              {g.up.length === 0 && g.down.length === 0 && (
                <div className="mt-2 px-2 py-2 bg-white/60 rounded border border-slate-200">
                  <div className="text-[11.5px] font-semibold text-slate-700">▸ 현황: 비용 구조 안정적</div>
                  <div className="text-[10.5px] text-slate-500 mt-0.5 leading-snug">
                    전년 대비 카테고리 단위 의미 있는 변동 없음. 현 추세 유지 시 양호한 비용 효율 지속 예상.
                    분기 단위 모니터링 권고.
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KeyInsightBar({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="flex items-start gap-4 bg-slate-900 text-slate-100 px-5 py-3 rounded-2xl mb-5 shadow-sm">
      <span className="font-semibold text-[11.5px] tracking-[0.18em] uppercase whitespace-nowrap pt-0.5 shrink-0 text-indigo-300">
        Key Insight
      </span>
      <div className="text-[13.5px] leading-[1.55] text-slate-100/95">
        {highlightInsightDark(text)}
      </div>
    </div>
  );
}

// h2(##) 기준으로 섹션 분리 → 카드 박스로 렌더링
function DetailedSections({ markdown }: { markdown: string }) {
  if (!markdown) return null;

  // "## " 로 시작하는 h2 헤더 기준으로 분리
  const parts = markdown.split(/(?=^## )/m).filter(Boolean);

  // ── 컬럼 그룹 배경 헬퍼 ──────────────────────────────
  // level1: 그룹별 컬러 / level2(들여쓰기): 흰색 — 단, 그룹 경계선(borderLeft)은 유지
  const getGroupBg = (idx: number, isHeaderRow: boolean, isLevel2 = false): React.CSSProperties => {
    const BL = "2px solid #D1D5DB";
    if (idx === 0)               return {};
    const bg = (lv1: string) => (isLevel2 ? "#FFFFFF" : lv1);
    if (idx >= 1 && idx <= 3)   return { background: bg(isHeaderRow ? "#DBEAFE" : "#EFF6FF"), ...(idx === 1 ? { borderLeft: BL } : {}) };
    if (idx >= 4 && idx <= 6)   return { background: bg(isHeaderRow ? "#DCFCE7" : "#F0FDF4"), ...(idx === 4 ? { borderLeft: BL } : {}) };
    if (idx >= 7 && idx <= 10)  return { background: bg(isHeaderRow ? "#FEF9C3" : "#FEFCE8"), ...(idx === 7 ? { borderLeft: BL } : {}) };
    /* idx === 11 */             return { background: bg(isHeaderRow ? "#F3F4F6" : "#F9FAFB"), borderLeft: BL };
  };

  // YOY 수치 색상 (순수 %숫자 패턴)
  const getYoyColor = (text: string): string | undefined => {
    const m = text.trim().match(/^(\d+)%$/);
    if (!m) return undefined;
    const v = parseInt(m[1]);
    if (v >= 110) return "#DC2626";
    if (v < 90)   return "#2563EB";
    return undefined;
  };

  const detailMdComponents = {
    ...mdTableComponents,
    // DETAILED: 표 컨테이너에 .rpt-detail-tbl 클래스 적용
    table: ({ ...props }: React.HTMLAttributes<HTMLTableElement>) => (
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="rpt-detail-tbl" {...props} />
      </div>
    ),
    // DETAILED: thead → 12열 이상이면 그룹 헤더 행 주입
    thead: ({ children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => {
      const rows = React.Children.toArray(children);
      const firstRow = rows[0];
      const colCount = React.isValidElement(firstRow)
        ? React.Children.count((firstRow as React.ReactElement<{ children?: React.ReactNode }>).props.children)
        : 0;
      const GH: React.CSSProperties = {
        fontSize: "10.5px",
        fontWeight: 700,
        padding: "6px 10px",
        textAlign: "center",
        letterSpacing: "0.02em",
      };
      return (
        <thead {...props}>
          {colCount >= 12 && (
            <tr>
              <th style={{ background: "#F8FAFC", padding: "6px 10px" }} />
              <th colSpan={3} style={{ ...GH, background: "#EFF6FF", color: "#1D4ED8", borderLeft: "2px solid #CBD5E1" }}>당월</th>
              <th colSpan={3} style={{ ...GH, background: "#ECFDF5", color: "#047857", borderLeft: "2px solid #CBD5E1" }}>YTD 누적</th>
              <th colSpan={4} style={{ ...GH, background: "#FFFBEB", color: "#B45309", borderLeft: "2px solid #CBD5E1" }}>계획 대비</th>
              <th style={{ background: "#F8FAFC", padding: "6px 10px", borderLeft: "2px solid #CBD5E1" }} />
            </tr>
          )}
          {children}
        </thead>
      );
    },
    // tbody tr: 그룹 배경을 각 셀에 cloneElement로 주입
    // level2(들여쓰기 행)는 흰 배경 — 첫 셀이 U+3000(전각공백)으로 시작하면 level2로 판정
    tr: ({ children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => {
      const cells = React.Children.toArray(children);
      const firstCell = cells[0];
      const isBrandHeader =
        React.isValidElement(firstCell) &&
        React.Children.toArray((firstCell as React.ReactElement<{ children?: React.ReactNode }>).props.children).some(
          (c) => React.isValidElement(c) && (c.type === "strong" || (c as React.ReactElement).type?.toString?.() === "strong")
        );
      const isThRow = cells.some((c) => React.isValidElement(c) && (c as React.ReactElement).type === "th");
      const firstCellRaw = React.isValidElement(firstCell)
        ? extractCellText((firstCell as React.ReactElement<{ children?: React.ReactNode }>).props.children)
        : "";
      const isLevel2 = firstCellRaw.startsWith("　");
      const styledCells = isBrandHeader
        ? cells
        : cells.map((cell, idx) => {
            if (!React.isValidElement(cell)) return cell;
            const existing = ((cell as React.ReactElement).props as { style?: React.CSSProperties }).style ?? {};
            return React.cloneElement(cell as React.ReactElement, {
              style: { ...getGroupBg(idx, isThRow, isLevel2), ...existing },
            });
          });
      return (
        <tr className={isBrandHeader ? "brand-header" : isLevel2 ? "hover:bg-slate-50/60" : "hover:bg-gray-50"} {...props}>
          {styledCells}
        </tr>
      );
    },
    td: ({ children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => {
      const rawText = extractCellText(children);
      // ⚠ U+3000(전각공백)이 trim()에 의해 제거되므로, indented 감지는 raw 기준
      const isIndented = rawText.startsWith("　");
      const text = rawText.trim();
      const isPlain = isPlainTextChildren(children);
      const cleanText = text;
      const yoyColor = getYoyColor(cleanText);
      // 숫자/율 전용 셀
      if (yoyColor || /^[-]$/.test(cleanText) || /^[\d,.\-+%]+$/.test(cleanText)) {
        const cls = isIndented ? "text-slate-500" : "";
        return (
          <td className={cls} style={yoyColor ? { color: yoyColor, fontWeight: 600 } : undefined} {...props}>
            {children}
          </td>
        );
      }
      // 판정/분석 셀 (plain text only)
      if (isPlain && (/^(🔴|🟡|🟢|정상|개선|악화|시즌|Red pack)/.test(cleanText) || cleanText.includes(" — "))) {
        return (
          <td className={isIndented ? "text-slate-500" : ""} {...props}>
            <StructuredJudgeCell text={cleanText} />
          </td>
        );
      }
      // 첫 컬럼 라벨 (들여쓰기 적용)
      if (isIndented) {
        return (
          <td className="text-slate-600 pl-7" {...props}>
            <span className="inline-flex items-center gap-1.5">
              <span className="text-slate-300 text-[11px]">└</span>
              <span>{cleanText}</span>
            </span>
          </td>
        );
      }
      // 일반 텍스트
      let cls = "";
      if (/개선/.test(cleanText)) cls += " text-emerald-700 font-semibold";
      else if (/악화|경고/.test(cleanText)) cls += " text-rose-700 font-semibold";
      else if (/주의/.test(cleanText)) cls += " text-amber-700 font-semibold";
      return (
        <td className={cls.trim()} {...props}>
          {isPlain ? highlightInsight(cleanText) : children}
        </td>
      );
    },
    h2: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h2 className="text-[14.5px] font-semibold text-slate-800 flex items-center gap-2 mt-1 mb-2" {...props}>
        {children}
      </h2>
    ),
    h3: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h3 className="text-[13.5px] font-semibold text-slate-700 mt-4 mb-1.5" {...props}>
        {children}
      </h3>
    ),
    h4: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h4 className="text-[13px] font-semibold text-slate-700 mt-3 mb-1 tracking-tight" {...props}>
        {children}
      </h4>
    ),
    h5: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h5 className="text-[12.5px] font-semibold text-slate-600 mt-2 mb-1" {...props}>
        {children}
      </h5>
    ),
    p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
      <p className="text-[13.5px] text-slate-700 leading-[1.55] my-1" {...props}>
        {children}
      </p>
    ),
    ul: ({ children, ...props }: React.HTMLAttributes<HTMLUListElement>) => (
      <ul className="my-1 ml-4 list-disc space-y-0.5" {...props}>
        {children}
      </ul>
    ),
    ol: ({ children, ...props }: React.OlHTMLAttributes<HTMLOListElement>) => (
      <ol className="my-1 ml-4 list-decimal space-y-0.5" {...props}>
        {children}
      </ol>
    ),
    li: ({ children, ...props }: React.LiHTMLAttributes<HTMLLIElement>) => (
      <li className="text-[13.5px] text-slate-700 leading-[1.55]" {...props}>
        {children}
      </li>
    ),
    strong: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
      <strong className="font-semibold text-slate-900" {...props}>
        {children}
      </strong>
    ),
    hr: () => <hr className="border-slate-100 my-4" />,
    blockquote: ({ children, ...props }: React.HTMLAttributes<HTMLQuoteElement>) => (
      <blockquote
        className="border-l-2 border-indigo-300 pl-3.5 text-[13px] text-slate-700 bg-indigo-50/60 py-2.5 my-2 rounded-r-md leading-[1.6]"
        {...props}
      >
        {children}
      </blockquote>
    ),
  };

  return (
    <div className="border-t border-slate-200 pt-5 mt-2 space-y-4">
      {parts.map((section, i) => {
        const lines = section.trimStart().split("\n");
        const titleLine = lines[0] ?? "";
        const body = lines.slice(1).join("\n").trim();
        // 이모지 + 제목 추출
        const titleText = titleLine.replace(/^##\s*/, "");
        const isOpGuide = /연간\s*예산\s*운영\s*관리/.test(titleText);

        return (
          <div
            key={i}
            className="border border-slate-200 rounded-2xl bg-white shadow-sm overflow-hidden"
          >
            {/* 섹션 헤더 */}
            <div className="px-5 py-2.5 bg-slate-50/50 border-b border-slate-100 flex items-center gap-2">
              <span className="inline-block w-1 h-4 bg-slate-400 rounded-sm" />
              <span className="text-[14px] font-semibold text-slate-800 tracking-tight">{titleText}</span>
            </div>
            {/* 섹션 본문 */}
            <div className="px-5 py-3.5">
              {isOpGuide ? (
                <OperationGuideGrid body={body} />
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={detailMdComponents as never}
                >
                  {body}
                </ReactMarkdown>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ③ 연간 예산 운영 관리 기준 — 액션 카드 그리드 (가독성 강화)
function OperationGuideGrid({ body }: { body: string }) {
  // 빌더 출력 패턴: 각 항목은 "**A. 제목**\n- 본문" 형태로 이어짐
  const items: { letter: string; title: string; data: string; action: string }[] = [];
  const blocks = body.split(/\n(?=\*\*[A-Z]\.\s)/);
  for (const block of blocks) {
    const m = block.match(/^\*\*([A-Z])\.\s*([^*]+?)\*\*\s*\n-\s*([\s\S]+?)\s*$/);
    if (!m) continue;
    const letter = m[1];
    const title = m[2].trim();
    const raw = m[3].replace(/\s+/g, " ").trim();
    const dashIdx = raw.indexOf(" — ");
    const data = dashIdx >= 0 ? raw.slice(0, dashIdx).trim() : raw;
    const action = dashIdx >= 0 ? raw.slice(dashIdx + 3).trim() : "";
    items.push({ letter, title, data, action });
  }
  if (items.length === 0) return <div className="text-[13px] text-slate-500">{body}</div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
      {items.map((it) => (
        <div key={it.letter} className="rounded-lg border border-slate-200 bg-white overflow-hidden flex flex-col">
          <div className="px-3 py-1.5 bg-slate-50/70 border-b border-slate-100 flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-slate-200 text-slate-600 text-[11px] font-semibold flex-shrink-0">
              {it.letter}
            </span>
            <span className="text-[12.5px] font-semibold text-slate-800 leading-tight">{it.title}</span>
          </div>
          <div className="px-3 py-2.5 space-y-2 flex-1">
            <div className="text-[12.5px] text-slate-700 leading-[1.55]">{highlightInsight(it.data)}</div>
            {it.action && (
              <div className="border-l-2 border-indigo-300 pl-2.5 text-[12.5px] text-slate-700 leading-[1.55]">
                <span className="text-[9.5px] font-semibold tracking-wider text-indigo-600 uppercase mr-1.5">▸ 권고</span>
                {highlightInsight(it.action)}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Modal
// ─────────────────────────────────────────────
interface AIReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  year: number;
  month: number;
  mode: import("@/lib/expenseData").Mode;
  yearType: "actual" | "plan";
  /** true면 모달 오버레이 없이 인라인 렌더 (탭 내부용) */
  inline?: boolean;
}

export function AIReportModal({
  isOpen,
  onClose,
  inline = false,
  year,
  month,
  mode,
  yearType,
}: AIReportModalProps) {
  const [rawText, setRawText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerated, setIsGenerated] = useState(false);
  const [isNotFound, setIsNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const reportBodyRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // 조건별 캐시: key = "year-month-mode-yearType"
  const cacheRef = useRef<Record<string, string>>({});

  const report = useMemo(() => parseReport(rawText), [rawText]);

  // 분기 모드는 해당 분기 마지막 월의 YTD 리포트를 사용 (사전 생성된 파일이 있어야 함)
  const QUARTER_END_MONTH: Record<string, number> = { q1: 3, q2: 6, q3: 9, q4: 12 };
  const effectiveMode: "monthly" | "ytd" = mode === "monthly" ? "monthly" : "ytd";
  const effectiveMonth = QUARTER_END_MONTH[mode] ?? month;
  const cacheKey = `${year}-${effectiveMonth}-${effectiveMode}-${yearType}`;

  const generate = useCallback(async () => {
    if (cacheRef.current[cacheKey]) {
      setRawText(cacheRef.current[cacheKey]);
      setIsGenerated(true);
      setIsNotFound(false);
      setIsLoading(false);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      return;
    }

    setIsLoading(true);
    setRawText("");
    setError(null);
    setIsGenerated(false);
    setIsNotFound(false);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;

    abortRef.current = new AbortController();
    try {
      const params = new URLSearchParams({ year: String(year), month: String(effectiveMonth), mode: effectiveMode, yearType });
      const res = await fetch(`/api/ai-report?${params.toString()}`, {
        signal: abortRef.current.signal,
      });
      if (res.status === 404) {
        setIsNotFound(true);
        setIsLoading(false);
        return;
      }
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = await res.clone().json();
          if (j?.message) msg = j.message;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }
      const text = await res.text();
      cacheRef.current[cacheKey] = text;
      setRawText(text);
      setIsGenerated(true);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "보고서 로드 오류");
    } finally {
      setIsLoading(false);
    }
  }, [year, effectiveMonth, effectiveMode, yearType, cacheKey]);

  useEffect(() => {
    if (isOpen) generate();
    return () => abortRef.current?.abort();
  }, [isOpen, generate]);

  const handleDownload = useCallback(() => {
    if (!reportBodyRef.current) return;
    const inner = reportBodyRef.current.innerHTML;
    const title = `AI보고서_${year}년_${yearType === "plan" ? "예산" : "실적"}_${month}월`;
    const fullDoc = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    /* ── 전체 레이아웃 ── */
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #F3F4F6;
      padding: 16px;
      color: #374151;
    }
    .report-container {
      max-width: 1100px;
      margin: 0 auto;
      padding: 16px;
      background: #F3F4F6;
    }
    .section-card {
      background: white;
      border-radius: 12px;
      border: 1px solid #E5E7EB;
      padding: 16px 20px;
      margin-bottom: 16px;
    }

    /* ── 표 스타일 ── */
    .table-wrap { overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; }
    th {
      font-size: 12px;
      font-weight: 600;
      color: #4B5563;
      background: #F9FAFB;
      padding: 5px 8px;
      white-space: nowrap;
      text-align: center;
      border: 1px solid #E5E7EB;
    }
    td {
      font-size: 12px;
      color: #374151;
      padding: 4px 8px;
      line-height: 1.4;
      border: 1px solid #E5E7EB;
    }
    td.number { text-align: right; white-space: nowrap; }
    td.label  { text-align: left; min-width: 90px; }
    .badge {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 9999px;
      white-space: nowrap;
    }

    /* ── 섹션 제목 ── */
    h2.section-title {
      font-size: 14px;
      font-weight: 700;
      color: #1E3A5F;
      margin-bottom: 12px;
      margin-top: 24px;
      border-left: 3px solid #6366F1;
      padding-left: 8px;
    }
    h3.sub-title {
      font-size: 13px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 8px;
      margin-top: 16px;
    }

    /* ── 본문 텍스트 ── */
    .insight-text {
      font-size: 12px;
      line-height: 1.7;
      color: #374151;
      margin-bottom: 6px;
    }
    .proposal-item {
      font-size: 12px;
      line-height: 1.8;
      color: #374151;
      margin-bottom: 10px;
      padding-left: 4px;
    }
    .proposal-bullet {
      font-size: 12px;
      line-height: 1.7;
      color: #4B5563;
      margin-bottom: 4px;
    }

    /* ── KPI 카드 ── */
    .kpi-label  { font-size: 11px; color: #6B7280; }
    .kpi-value  { font-size: 14px; font-weight: 700; color: #111827; }
    .kpi-badge  { font-size: 11px; padding: 2px 7px; border-radius: 9999px; }
  </style>
</head>
<body>
<div class="report-container">
${inner}
</div>
</body>
</html>`;
    const blob = new Blob([fullDoc], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${title}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [year, month, yearType]);

  if (!isOpen) return null;

  const chrome = (
    <div className={inline
      ? "flex flex-col bg-gray-100 rounded-2xl border border-slate-200 w-full"
      : "relative flex flex-col bg-gray-100 rounded-2xl shadow-2xl w-[96vw] max-w-6xl h-[94vh]"}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 bg-white rounded-t-2xl border-b shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-purple-600" />
          <span className="font-bold text-gray-800 text-sm">
            AI 리포트
          </span>
          <span className="text-[10px] text-gray-400 ml-1">
            {year}년 {yearType === "plan" ? "예산" : "실적"} /{" "}
            {mode === "ytd" ? "연누계" : `${month}월`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isGenerated && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              className="text-xs h-7 gap-1"
            >
              <Download className="w-3 h-3" />
              HTML
            </Button>
          )}
          {!inline && (
            <button
              onClick={() => {
                abortRef.current?.abort();
                onClose();
              }}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div ref={scrollRef} className={inline ? "p-4" : "flex-1 overflow-y-auto p-4"}>
          {/* Loading initial */}
          {isLoading && rawText === "" && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
              <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
              <p className="text-sm">보고서를 불러오는 중...</p>
            </div>
          )}

          {/* Not found (정적 파일 없음) */}
          {isNotFound && !isLoading && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-500">
              <Bot className="w-10 h-10 text-gray-300" />
              <p className="text-sm font-medium">
                {year}년 {yearType === "plan" ? "예산" : "실적"} / {mode === "ytd" ? "연누계" : `${month}월`} 보고서가 아직 생성되지 않았습니다.
              </p>
              <p className="text-xs text-gray-400 text-center max-w-md">
                로컬에서 <code className="bg-gray-100 px-1 rounded text-[11px]">node scripts/build-ai-report.mjs --year {year} --month {month} --mode {mode} --yearType {yearType}</code> 실행 후 커밋/배포하세요.
              </p>
            </div>
          )}

          {/* Error */}
          {error && !isNotFound && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-red-500">
              <p className="text-sm font-medium">오류: {error}</p>
              <Button variant="outline" size="sm" onClick={() => generate()}>
                다시 시도
              </Button>
            </div>
          )}

          {/* Dashboard content */}
          {rawText && (
            <div ref={reportBodyRef} id="ai-report-body" data-ai-report-state={isGenerated ? "ready" : "loading"}>
              {/* 표 공통 scoped 스타일 */}
              <style>{`
                /* ── 공통 표 베이스 ── */
                .rpt-tbl, .rpt-detail-tbl {
                  width: 100%;
                  border-collapse: separate;
                  border-spacing: 0;
                  font-variant-numeric: tabular-nums;
                }
                .rpt-tbl th, .rpt-detail-tbl th {
                  font-size: 12px;
                  font-weight: 600;
                  padding: 6px 10px;
                  line-height: 1.4;
                  color: #475569;
                  background: #F8FAFC;
                  border-top: 1px solid #E2E8F0;
                  border-bottom: 1px solid #E2E8F0;
                  border-right: 1px solid #E2E8F0;
                  white-space: nowrap;
                  vertical-align: middle;
                }
                .rpt-tbl th:first-child, .rpt-detail-tbl th:first-child { border-left: 1px solid #E2E8F0; }
                .rpt-tbl td, .rpt-detail-tbl td {
                  font-size: 13px;
                  padding: 6px 10px;
                  line-height: 1.45;
                  border-bottom: 1px solid #EEF2F6;
                  border-right: 1px solid #EEF2F6;
                  vertical-align: middle;
                  color: #334155;
                  height: 30px;
                }
                .rpt-tbl td:first-child, .rpt-detail-tbl td:first-child { border-left: 1px solid #EEF2F6; }
                .rpt-tbl tbody tr:hover td, .rpt-detail-tbl tbody tr:hover td { background: #FAFBFD; }
                .rpt-tbl tr.brand-header td, .rpt-detail-tbl tr.brand-header td {
                  padding: 6px 10px;
                  background: #E2E8F0;
                  font-weight: 700;
                  font-size: 13px;
                  color: #1E3A5F;
                }
                .rpt-detail-tbl tr.brand-header td:first-child {
                  border-left: 3px solid #6366F1;
                  padding-left: 8px;
                }

                /* ── Risk/YOY 등 단순 표 ── */
                .rpt-tbl td:first-child, .rpt-tbl th:first-child {
                  width: 130px; min-width: 110px; max-width: 160px;
                  text-align: left; white-space: normal;
                }
                .rpt-tbl td:not(:first-child):not(:last-child),
                .rpt-tbl th:not(:first-child):not(:last-child) {
                  width: 92px; min-width: 80px;
                  text-align: right; white-space: nowrap;
                }
                .rpt-tbl td:last-child, .rpt-tbl th:last-child {
                  width: auto; min-width: 220px;
                  text-align: left;
                  white-space: normal;
                  word-break: keep-all;
                  line-height: 1.55;
                }

                /* ── DETAILED 표 (모든 표 첫 컬럼 폭 통일 → 스크롤 시 정연) ── */
                .rpt-detail-tbl { table-layout: auto; }
                .rpt-detail-tbl td, .rpt-detail-tbl th {
                  text-align: right;
                  white-space: nowrap;
                }
                .rpt-detail-tbl td:first-child, .rpt-detail-tbl th:first-child {
                  text-align: left;
                  white-space: nowrap;
                  width: 200px;
                  min-width: 200px;
                  max-width: 200px;
                  overflow: hidden;
                  text-overflow: ellipsis;
                }
                .rpt-detail-tbl td:last-child, .rpt-detail-tbl th:last-child {
                  text-align: left;
                  white-space: normal;
                  word-break: keep-all;
                  min-width: 220px;
                  max-width: 280px;
                  line-height: 1.55;
                  color: #475569;
                }

                /* zebra subtle */
                .rpt-tbl tbody tr:nth-child(even) td:not(:first-child),
                .rpt-detail-tbl tbody tr:nth-child(even) td:not(:first-child) {
                  background: #FCFCFD;
                }
              `}</style>
              {/* 그라데이션 헤더 */}
              <GradientHeader year={year} month={month} mode={mode} yearType={yearType} />

              {/* 상단 3카드 */}
              <TopSummaryCards data={report.topSummary} />

              {/* Executive Summary */}
              <ExecSummaryHeader meta={report.meta} bullets={report.bullets} />

              {/* KPI Cards */}
              <KpiCards kpi={report.kpi} />

              {/* ② 종합 스코어 */}
              <ScoreCardsGrid scoreCards={report.scoreCards} />

              {/* ③ 체크포인트 */}
              <CheckpointsGrid groups={report.checkpoints} />

              {/* ④ 브랜드별 한눈에 보기 */}
              <BrandOverviewTable rows={report.brandOverview} />

              {/* ⑤ 변동 원인 분석 */}
              <ChangeDriversGrid groups={report.changeDrivers} />

              {/* 3. YOY 풀폭 위, Risk 좌우 분할 아래 (공백 최소화) */}
              {(() => {
                const [riskLeft, riskRight] = splitRiskTableMarkdown(report.riskTable);
                return (
                  <div className="mb-5 space-y-4">
                    <TableBox title="YOY 이상 신호" markdown={report.yoyTable} accent="amber" />
                    {riskRight ? (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <TableBox title="리스크 플래그" markdown={riskLeft} accent="rose" />
                        <TableBox title="리스크 플래그 (계속)" markdown={riskRight} accent="rose" />
                      </div>
                    ) : (
                      <TableBox title="리스크 플래그" markdown={riskLeft} accent="rose" />
                    )}
                  </div>
                );
              })()}

              {/* 4. Cost Structure */}
              <CostStructureSection
                rows={report.costRows}
                insight={report.costInsight}
              />

              {/* ⑦ 고정/변동/준고정 비용 구조 (브랜드별) */}
              <FixedVarTable rows={report.fixedVar} />

              {/* 5. Key Insight */}
              <KeyInsightBar text={report.keyInsight} />

              {/* 6. Detailed Analysis */}
              <DetailedSections markdown={report.detailed} />

              {/* Streaming indicator */}
              {isLoading && (
                <div className="flex items-center gap-2 mt-3 text-gray-400 text-xs">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                  <span>상세 분석 생성 중...</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
  );

  if (inline) return chrome;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      {chrome}
    </div>
  );
}
