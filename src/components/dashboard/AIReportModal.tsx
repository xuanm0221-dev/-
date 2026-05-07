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
import { X, Loader2, Download, Bot, RefreshCw } from "lucide-react";
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

interface ParsedReport {
  meta: { year: string; yearType: string; title: string } | null;
  bullets: string[];
  kpi: KpiItem[];
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

const COST_ROW_TYPES = ["고정비", "준고정비", "변동비"];

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

function parseReport(text: string): ParsedReport {
  return {
    meta: parseMeta(getSection(text, "META")),
    bullets: parseBullets(getSection(text, "BULLETS")),
    kpi: parseKpi(getSection(text, "KPI")),
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
            비용 구조 (고정 / 준고정 / 변동)
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
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-slate-50/60">
                  <td className={`px-3 py-2.5 text-center border-b border-slate-100 ${COST_TYPE_STYLES[r.type] ?? ""}`}>
                    {r.type}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 border-b border-slate-100">
                    {r.items}
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium text-slate-800 whitespace-nowrap border-b border-slate-100">
                    {r.amount}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-700 whitespace-nowrap border-b border-slate-100">
                    {r.ratio}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-700 whitespace-nowrap border-b border-slate-100">
                    {r.yoy}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10.5px] text-slate-400 mt-2.5">※ YTD 법인 전체 기준</p>
        </div>
      </div>
      {insight && (
        <div className="border border-slate-200 rounded-2xl bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-2.5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
            <span className="inline-block w-1 h-3.5 bg-indigo-500 rounded-sm" />
            <span className="text-[13px] font-semibold text-slate-800">비용 구조 인사이트</span>
          </div>
          <div className="px-5 py-3.5 text-[13.5px] leading-[1.55] text-slate-700">
            {highlightInsight(insight)}
          </div>
        </div>
      )}
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
  const getGroupBg = (idx: number, isHeaderRow: boolean): React.CSSProperties => {
    const BL = "2px solid #D1D5DB";
    if (idx === 0)               return {};
    if (idx >= 1 && idx <= 3)   return { background: isHeaderRow ? "#DBEAFE" : "#EFF6FF", ...(idx === 1 ? { borderLeft: BL } : {}) };
    if (idx >= 4 && idx <= 6)   return { background: isHeaderRow ? "#DCFCE7" : "#F0FDF4", ...(idx === 4 ? { borderLeft: BL } : {}) };
    if (idx >= 7 && idx <= 10)  return { background: isHeaderRow ? "#FEF9C3" : "#FEFCE8", ...(idx === 7 ? { borderLeft: BL } : {}) };
    /* idx === 11 */             return { background: isHeaderRow ? "#F3F4F6" : "#F9FAFB", borderLeft: BL };
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
    tr: ({ children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => {
      const cells = React.Children.toArray(children);
      const firstCell = cells[0];
      const isBrandHeader =
        React.isValidElement(firstCell) &&
        React.Children.toArray((firstCell as React.ReactElement<{ children?: React.ReactNode }>).props.children).some(
          (c) => React.isValidElement(c) && (c.type === "strong" || (c as React.ReactElement).type?.toString?.() === "strong")
        );
      const isThRow = cells.some((c) => React.isValidElement(c) && (c as React.ReactElement).type === "th");
      const styledCells = isBrandHeader
        ? cells
        : cells.map((cell, idx) => {
            if (!React.isValidElement(cell)) return cell;
            const existing = ((cell as React.ReactElement).props as { style?: React.CSSProperties }).style ?? {};
            return React.cloneElement(cell as React.ReactElement, {
              style: { ...getGroupBg(idx, isThRow), ...existing },
            });
          });
      return (
        <tr className={isBrandHeader ? "brand-header" : "hover:bg-gray-50"} {...props}>
          {styledCells}
        </tr>
      );
    },
    td: ({ children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => {
      const text = extractCellText(children).trim();
      const isPlain = isPlainTextChildren(children);
      const isIndented = text.startsWith("　");
      const yoyColor = getYoyColor(text);
      // 숫자/율 전용 셀
      if (yoyColor || /^[-]$/.test(text) || /^[\d,.\-+%]+$/.test(text)) {
        const cls = isIndented ? "pl-5" : "";
        return (
          <td className={cls} style={yoyColor ? { color: yoyColor, fontWeight: 600 } : undefined} {...props}>
            {children}
          </td>
        );
      }
      // 판정/분석 셀 (plain text only)
      if (isPlain && (/^(🔴|🟡|🟢|정상|개선|악화|시즌|Red pack)/.test(text) || text.includes(" — "))) {
        return (
          <td {...props}>
            <StructuredJudgeCell text={text} />
          </td>
        );
      }
      // 일반 텍스트 — plain이면 하이라이트, 리치 콘텐츠(굵은글씨 등)면 그대로
      let cls = isIndented ? "pl-5" : "";
      if (/개선/.test(text)) cls += " text-emerald-700 font-semibold";
      else if (/악화|경고/.test(text)) cls += " text-rose-700 font-semibold";
      else if (/주의/.test(text)) cls += " text-amber-700 font-semibold";
      return (
        <td className={cls.trim()} {...props}>
          {isPlain ? highlightInsight(text) : children}
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
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={detailMdComponents as never}
              >
                {body}
              </ReactMarkdown>
            </div>
          </div>
        );
      })}
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
  mode: "monthly" | "ytd";
  yearType: "actual" | "plan";
}

export function AIReportModal({
  isOpen,
  onClose,
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

  const cacheKey = `${year}-${month}-${mode}-${yearType}`;
  const canRegenerate = process.env.NEXT_PUBLIC_AI_REPORT_ALLOW_REGENERATE === "true";

  const generate = useCallback(async (forceRefresh = false) => {
    // 캐시 히트 시 즉시 반환 (조건이 같고 강제 재생성 아닌 경우)
    if (!forceRefresh && cacheRef.current[cacheKey]) {
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
      const res = await fetch("/api/ai-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month, mode, yearType, forceRefresh }),
        signal: abortRef.current.signal,
      });
      if (res.status === 404) {
        setIsNotFound(true);
        setIsLoading(false);
        return;
      }
      if (!res.ok || !res.body) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = await res.clone().json();
          if (j?.message) msg = j.message;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setRawText(acc);
      }
      // 완료 후 캐시 저장
      cacheRef.current[cacheKey] = acc;
      setIsGenerated(true);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "보고서 로드 오류");
    } finally {
      setIsLoading(false);
    }
  }, [year, month, mode, yearType, cacheKey]);

  useEffect(() => {
    if (isOpen) generate();
    return () => abortRef.current?.abort();
  }, [isOpen, generate]);

  const staticFileName = `${year}-${month}-${yearType}-${mode}.txt`;

  const handleDownloadTxt = useCallback(() => {
    if (!rawText) return;
    const blob = new Blob([rawText], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = staticFileName;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [rawText, staticFileName]);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative flex flex-col bg-gray-100 rounded-2xl shadow-2xl w-[96vw] max-w-6xl h-[94vh]">
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
            {canRegenerate && (isGenerated || isNotFound) && !isLoading && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => generate(true)}
                className="text-xs h-7 gap-1 bg-green-50 border-green-200 text-green-800 hover:bg-green-100"
                title="Claude로 새 보고서를 생성하고 data/ai-reports/에 덮어쓰기 (로컬 전용)"
              >
                <RefreshCw className="w-3 h-3" />
                재생성 & 저장
              </Button>
            )}
            {isGenerated && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadTxt}
                  className="text-xs h-7 gap-1"
                  title="다운로드"
                >
                  <Download className="w-3 h-3" />
                  TXT
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownload}
                  className="text-xs h-7 gap-1"
                >
                  <Download className="w-3 h-3" />
                  HTML
                </Button>
              </>
            )}
            <button
              onClick={() => {
                abortRef.current?.abort();
                onClose();
              }}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
          {/* Loading initial */}
          {isLoading && rawText === "" && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
              <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
              <p className="text-sm">Claude가 CEO 보고서를 생성하고 있습니다...</p>
              <p className="text-xs text-gray-300">약 30~60초 소요</p>
            </div>
          )}

          {/* Not found (정적 파일 없음) */}
          {isNotFound && !isLoading && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-500">
              <Bot className="w-10 h-10 text-gray-300" />
              <p className="text-sm font-medium">
                {year}년 {yearType === "plan" ? "예산" : "실적"} / {mode === "ytd" ? "연누계" : `${month}월`} 보고서가 아직 생성되지 않았습니다.
              </p>
              {canRegenerate ? (
                <>
                  <p className="text-xs text-gray-400 text-center max-w-md">
                    상단 <span className="font-semibold text-green-700">&quot;재생성 &amp; 저장&quot;</span> 버튼을 눌러 Claude 보고서를 생성하세요.
                    <br />생성된 내용은 <code className="bg-gray-100 px-1 rounded text-[11px]">data/ai-reports/{staticFileName}</code>에 자동 저장됩니다.
                    <br />이후 git add &amp; commit &amp; push 하면 배포 환경에도 반영됩니다.
                  </p>
                </>
              ) : (
                <p className="text-xs text-gray-400 text-center max-w-md">
                  배포 환경에서는 보고서 생성이 차단됩니다. 로컬에서 보고서를 생성하고 커밋/배포해주세요.
                </p>
              )}
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
            <div ref={reportBodyRef}>
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
                  padding: 5px 10px;
                  background: #F1F5F9;
                  font-weight: 600;
                  font-size: 13px;
                  color: #1E3A5F;
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
              {/* 1. Executive Summary */}
              <ExecSummaryHeader meta={report.meta} bullets={report.bullets} />

              {/* 2. KPI Cards */}
              <KpiCards kpi={report.kpi} />

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
    </div>
  );
}
