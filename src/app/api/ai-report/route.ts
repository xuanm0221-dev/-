import { NextRequest } from "next/server";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";

/**
 * AI 리포트 서빙.
 * 우선 `data/ai-reports/<year>-<month>-<yearType>-<mode>.txt` 정적 파일을 반환하고,
 * 없으면 서버에서 `scripts/build-ai-report.mjs` 를 즉시 실행해 생성 후 반환한다.
 * (기존에는 404 만 반환하여 수동 빌드가 필요했음.)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const year = searchParams.get("year") ?? "2026";
  const month = searchParams.get("month") ?? "1";
  const mode = searchParams.get("mode") ?? "ytd";
  const yearType = searchParams.get("yearType") ?? "actual";

  const outDir = path.join(process.cwd(), "data", "ai-reports");
  const staticPath = path.join(outDir, `${year}-${month}-${yearType}-${mode}.txt`);

  // 파일이 없으면 스크립트를 즉시 실행해 생성 시도
  if (!fs.existsSync(staticPath)) {
    try {
      await runBuilder({ year, month, yearType, mode });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json(
        {
          error: "BUILD_FAILED",
          message: `보고서 자동 생성 실패: ${message}`,
        },
        { status: 500 }
      );
    }
    if (!fs.existsSync(staticPath)) {
      return Response.json(
        {
          error: "NOT_FOUND",
          message: "보고서 자동 생성이 완료됐지만 파일을 찾지 못했습니다.",
        },
        { status: 404 }
      );
    }
  }

  const content = fs.readFileSync(staticPath, "utf-8");
  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Cache": "STATIC",
    },
  });
}

function runBuilder(params: { year: string; month: string; yearType: string; mode: string }) {
  return new Promise<void>((resolve, reject) => {
    const script = path.join(process.cwd(), "scripts", "build-ai-report.mjs");
    if (!fs.existsSync(script)) {
      reject(new Error(`빌드 스크립트를 찾지 못했습니다: ${script}`));
      return;
    }
    const child = spawn(
      process.execPath,
      [
        script,
        "--year", params.year,
        "--month", params.month,
        "--yearType", params.yearType,
        "--mode", params.mode,
      ],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`exit ${code}${stderr ? ` — ${stderr.trim()}` : ""}`));
    });
    // 60초 안전 타임아웃
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
        reject(new Error("빌드 타임아웃 (60초 초과)"));
      }
    }, 60_000);
  });
}
