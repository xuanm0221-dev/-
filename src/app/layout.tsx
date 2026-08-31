import type { Metadata } from "next";
import { Inter } from "next/font/google";
import fs from "fs";
import path from "path";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";
import { ExpenseDataProvider } from "@/components/dashboard/ExpenseDataProvider";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { BudgetAdjustmentProvider } from "@/contexts/BudgetAdjustmentContext";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "F&F China Expense Dashboard",
  description: "F&F 중국 법인 비용 대시보드 — 월별 / YTD 비용 효율 분석, AI 리포트 (MLB, KIDS, DISCOVERY, 공통)",
};

// 서버에서 모든 AI 리포트 .txt를 읽어와 초기 HTML에 임베드.
// NotebookLM 등 JS 미실행 크롤러/AI 도구가 루트 URL만 받아도 본문을 읽을 수 있도록.
// 정렬 우선순위: 최신 월 → 과거 월, 동일 월 내에서는 YTD → monthly.
function loadAllReportsServerSide(): { name: string; content: string; year: number; month: number; mode: string; isCurrent: boolean }[] {
  try {
    const dir = path.join(process.cwd(), "data", "ai-reports");
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".txt"));
    const parsed = files.map((f) => {
      const m = f.match(/^(\d{4})-(\d{1,2})-([a-z]+)-([a-z]+)\.txt$/);
      return {
        name: f,
        content: fs.readFileSync(path.join(dir, f), "utf-8"),
        year: m ? parseInt(m[1], 10) : 0,
        month: m ? parseInt(m[2], 10) : 0,
        mode: m ? m[4] : "",
      };
    });
    // 최신 월/YTD 우선
    parsed.sort((a, b) => {
      if (b.year !== a.year) return b.year - a.year;
      if (b.month !== a.month) return b.month - a.month;
      if (a.mode !== b.mode) return a.mode === "ytd" ? -1 : 1;
      return 0;
    });
    const latest = parsed[0];
    return parsed.map((r) => ({
      ...r,
      isCurrent: !!latest && r.year === latest.year && r.month === latest.month,
    }));
  } catch {
    return [];
  }
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const reports = loadAllReportsServerSide();
  return (
    <html lang="ko">
      <body className={inter.className}>
        <ToastProvider>
          <LanguageProvider>
            <ExpenseDataProvider>
              <BudgetAdjustmentProvider>{children}</BudgetAdjustmentProvider>
            </ExpenseDataProvider>
          </LanguageProvider>
        </ToastProvider>
        {/*
          크롤러/AI 분석 도구용 SSR 본문 임베드.
          시각적으로는 숨김(off-screen)이지만 DOM에는 존재하므로
          NotebookLM/ChatGPT/Claude 등이 URL fetch 시 본문 텍스트를 그대로 읽을 수 있음.
        */}
        {reports.length > 0 && (
          <div
            id="ssr-ai-report-content"
            aria-label="AI 분석용 보고서 텍스트 (시각적 비표시)"
            style={{
              position: "absolute",
              left: "-10000px",
              top: "auto",
              width: "1px",
              height: "1px",
              overflow: "hidden",
            }}
          >
            <h1>F&amp;F 중국법인 비용 대시보드 — AI 분석 리포트</h1>
            {(() => {
              const latest = reports.find((r) => r.isCurrent);
              return (
                <p>
                  현재 결산월: <strong>{latest ? `${latest.year}년 ${latest.month}월` : "-"}</strong>.
                  분석 기준: 결산월 당월 실적 + 결산월까지의 YTD(누적) 실적, 법인전체 + 브랜드별(MLB, KIDS, DISCOVERY, 공통).
                  분석 항목: 비용률(=비용×1.13÷매출), 인건비(기본급/Red pack/성과급충당금/잡급), 광고비
                  (APP/ACC/Branding/Retailing/Products/CRM), 세금과공과, 지급수수료, 임차료, 복리후생비,
                  비용 구조(고정/준고정/변동), 리스크 플래그, YOY 이상 신호, 종합 스코어(A/B/C/D),
                  운영 관리 기준 제안(A~F). 모든 금액 단위 K(천위안).
                </p>
              );
            })()}
            {reports.map((r) => (
              <article key={r.name}>
                <h2>
                  {r.year}년 {r.month}월 {r.mode === "ytd" ? "YTD 누적" : "당월"}
                  {r.isCurrent ? " (현재 결산월)" : ""}
                </h2>
                <pre style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}>{r.content}</pre>
              </article>
            ))}
          </div>
        )}
      </body>
    </html>
  );
}

