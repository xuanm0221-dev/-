// 최신 실적월의 AI 보고서를 monthly·ytd 두 벌 모두 다시 만든다.
// 사용: node scripts/build-latest-ai-reports.mjs [--year 2026] [--month 8]
//
// 왜 필요한가
//  - /api/ai-report 는 "파일이 없을 때만" 빌드한다. 있으면 낡았어도 그대로 서빙한다.
//    그래서 CSV 를 고치고 전처리를 다시 돌려도 기존 리포트는 옛날 숫자로 남는다.
//  - 배포(Vercel)는 파일시스템이 읽기 전용이라 그 자동 빌드 경로 자체가 동작하지 않는다.
//    커밋된 .txt 만 서빙되므로 미리 만들어 두어야 한다.
//  - 화면에서 열어 봐야 생기는 구조라, 당월을 안 열어보면 monthly 파일이 통째로 빠진다.
//    (2026-8-actual-monthly.txt 가 실제로 그렇게 누락됐었다)
// 그래서 전처리 끝에 이 스크립트를 붙여 사람 손을 뺀다. 과거월 파일은 건드리지 않는다.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data", "aggregated-expense.json");
const BUILDER = path.join(ROOT, "scripts", "build-ai-report.mjs");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

/** 실적 금액이 0이 아닌 마지막 연/월 — 대시보드의 getAvailableMonths 와 같은 기준 */
function findLatestActual(data) {
  const rows = data.monthly_total ?? [];
  const sums = new Map(); // "year-month" -> amount
  for (const r of rows) {
    if ((r.year_type ?? "actual") !== "actual") continue;
    const k = `${r.year}-${r.month}`;
    sums.set(k, (sums.get(k) ?? 0) + (r.amount ?? 0));
  }
  let best = null;
  for (const [k, sum] of sums) {
    if (sum === 0) continue;
    const [year, month] = k.split("-").map(Number);
    if (!best || year > best.year || (year === best.year && month > best.month)) {
      best = { year, month };
    }
  }
  return best;
}

function run(year, month, mode) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [BUILDER, "--year", String(year), "--month", String(month), "--yearType", "actual", "--mode", mode],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }
    );
    let err = "";
    child.stdout.on("data", (c) => process.stdout.write(c));
    child.stderr.on("data", (c) => { err += c.toString(); });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${mode} 실패 (exit ${code})${err ? ` — ${err.trim()}` : ""}`))
    );
  });
}

const args = parseArgs(process.argv);

if (!fs.existsSync(DATA)) {
  console.error(`오류: ${DATA} 가 없습니다. 먼저 preprocess_expense.py 를 실행하세요.`);
  process.exit(1);
}
if (!fs.existsSync(BUILDER)) {
  console.error(`오류: 빌드 스크립트를 찾지 못했습니다 — ${BUILDER}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(DATA, "utf-8"));
const latest = findLatestActual(data);
const year = Number(args.year ?? latest?.year);
const month = Number(args.month ?? latest?.month);

if (!Number.isFinite(year) || !Number.isFinite(month)) {
  console.error("오류: 실적이 있는 월을 찾지 못했습니다. --year --month 로 직접 지정하세요.");
  process.exit(1);
}

console.log(`AI 보고서 생성 대상: ${year}년 ${month}월 (실적) — monthly · ytd`);

try {
  for (const mode of ["monthly", "ytd"]) {
    await run(year, month, mode);
  }
  console.log(`AI 보고서 갱신 완료: ${year}-${month} (monthly, ytd)`);
} catch (e) {
  console.error(`AI 보고서 생성 실패: ${e.message}`);
  process.exit(1);
}
