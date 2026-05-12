import { NextRequest } from "next/server";
import path from "path";
import fs from "fs";

/**
 * AI 리포트 정적 파일 서빙.
 * 보고서는 로컬에서 `node scripts/build-ai-report.mjs` 로 생성한 뒤
 * data/ai-reports/<year>-<month>-<yearType>-<mode>.txt 로 저장됩니다.
 * 이 라우트는 그 파일을 읽어 반환만 하며, 런타임 생성/저장은 하지 않습니다.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const year = searchParams.get("year") ?? "2026";
  const month = searchParams.get("month") ?? "1";
  const mode = searchParams.get("mode") ?? "ytd";
  const yearType = searchParams.get("yearType") ?? "actual";

  const staticPath = path.join(process.cwd(), "data", "ai-reports", `${year}-${month}-${yearType}-${mode}.txt`);

  if (!fs.existsSync(staticPath)) {
    return Response.json(
      {
        error: "NOT_FOUND",
        message: "보고서가 아직 생성되지 않았습니다. 로컬에서 scripts/build-ai-report.mjs 실행 후 커밋/배포하세요.",
      },
      { status: 404 }
    );
  }

  const content = fs.readFileSync(staticPath, "utf-8");
  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Cache": "STATIC",
    },
  });
}
