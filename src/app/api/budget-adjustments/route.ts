import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Redis } from "@upstash/redis";
import { normalizeAdjustments, type BudgetAdjustment } from "@/lib/budgetAdjustments";

// 저장 위치: 배포(Vercel)+Redis 설정 시 Redis, 그 외(로컬)는 파일.
// cost-descriptions 라우트와 동일한 규칙.
const REDIS_KEY = "budget-adjustments";

function shouldUseRedis(): boolean {
  if (process.env.VERCEL !== "1") return false;
  const withKv = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;
  const withUpstash = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;
  return !!(withKv || withUpstash);
}

function redisSource(): "kv" | "upstash" | null {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) return "kv";
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return "upstash";
  return null;
}

function getRedis(): Redis | null {
  if (!shouldUseRedis()) return null;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/** 원인 파악용 요약 — URL/토큰 값은 절대 담지 않는다 */
function describeRedisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  return {
    vercel: process.env.VERCEL === "1",
    source: redisSource(),
    urlScheme: url ? url.split(":")[0] : null,
    urlIsRest: url.startsWith("https://"),
    urlHostSuffix: url
      ? url.replace("https://", "").replace("http://", "").split(".").slice(-2).join(".")
      : null,
    hasEditPassword: !!process.env.EDIT_PASSWORD,
  };
}

/**
 * undici 의 "fetch failed" 는 진짜 원인이 error.cause 에 들어있다.
 * 호스트명이 섞여 나올 수 있어 코드/요약만 추린다 (health 응답은 공개이므로).
 */
function describeCause(e: any): { message: string; code: string | null } {
  const chain: any[] = [];
  let cur = e;
  for (let i = 0; i < 5 && cur; i++) {
    chain.push(cur);
    cur = cur.cause;
  }
  const withCode = chain.find((c) => c?.code);
  const deepest = chain[chain.length - 1];
  const raw = String(deepest?.message ?? e?.message ?? e);
  // 호스트명(xxx.upstash.io 등) 은 마스킹
  const HOST_SUFFIXES = ["upstash.io", "vercel-storage.com"];
  let message = raw;
  for (const suffix of HOST_SUFFIXES) {
    let at = message.indexOf(suffix);
    while (at !== -1) {
      let start = at;
      while (start > 0 && /[\w.-]/.test(message[start - 1])) start--;
      message = message.slice(0, start) + "<host>" + message.slice(at + suffix.length);
      at = message.indexOf(suffix);
    }
  }
  return { message, code: withCode?.code ?? null };
}

/** Upstash REST 에 직접 /ping 을 쳐서 DNS·TLS·인증 중 무엇이 문제인지 가른다 */
async function probeRedisRest(): Promise<Record<string, unknown>> {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  if (!url || !token) return { probe: "설정 없음" };
  try {
    const base = url.endsWith("/") ? url.slice(0, -1) : url;
    const res = await fetch(base + "/ping", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    return {
      probe: "응답 받음",
      httpStatus: res.status,
      verdict:
        res.status === 200 ? "정상 — 연결·인증 모두 OK"
        : res.status === 401 || res.status === 403 ? "토큰이 유효하지 않음 (URL·호스트는 살아있음)"
        : `예상 밖 응답 코드 ${res.status}`,
    };
  } catch (e: any) {
    const c = describeCause(e);
    return {
      probe: "연결 실패",
      errorCode: c.code,
      errorMessage: c.message,
      verdict:
        c.code === "ENOTFOUND" ? "호스트를 찾을 수 없음 — DB 가 삭제되었거나 URL 이 잘못됨"
        : c.code === "ECONNREFUSED" ? "연결 거부 — DB 가 중지/삭제된 상태로 보임"
        : c.code === "CERT_HAS_EXPIRED" ? "TLS 인증서 만료"
        : "네트워크 단계에서 실패 (인증 이전)",
    };
  }
}

function getFilePath(): string {
  return path.join(process.cwd(), "data", "budget-adjustments", "adjustments.json");
}

function readFromFile(): BudgetAdjustment[] {
  try {
    const filePath = getFilePath();
    if (!fs.existsSync(filePath)) return [];
    return normalizeAdjustments(JSON.parse(fs.readFileSync(filePath, "utf-8")));
  } catch (error) {
    console.error("예산 수기조정 파일 읽기 오류:", error);
    return [];
  }
}

async function readAdjustments(): Promise<BudgetAdjustment[]> {
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(REDIS_KEY);
      if (raw != null) {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        const list = normalizeAdjustments(parsed);
        if (list.length > 0) return list;
      }
    } catch (error) {
      console.error("예산 수기조정 Redis 읽기 오류:", error);
    }
    // Redis 가 비었으면 배포된 파일 fallback
    return readFromFile();
  }
  return readFromFile();
}

async function writeAdjustments(list: BudgetAdjustment[]): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(REDIS_KEY, JSON.stringify(list));
    } catch (e: any) {
      const cfg = describeRedisConfig();
      const c = describeCause(e);
      throw new Error(
        `Redis 저장 실패 [${c.code ?? "원인코드 없음"}] ${c.message} · 변수=${cfg.source}` +
          ` · 진단: /api/budget-adjustments?health=1`
      );
    }
    return;
  }
  // Vercel 은 파일시스템이 읽기 전용이라 파일 저장이 불가능하다.
  // Redis 환경변수(KV_REST_API_URL/TOKEN)가 빠진 채 배포되면 여기서 명확히 실패시킨다.
  if (process.env.VERCEL === "1") {
    throw new Error(
      "배포 환경에 Redis 설정이 없어 저장할 수 없습니다. Vercel 환경변수 KV_REST_API_URL / KV_REST_API_TOKEN 을 확인해주세요."
    );
  }
  const filePath = getFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(list, null, 2), "utf-8");
}

// GET: 전체 조회 (공개) / ?health=1 이면 저장소 상태 진단
export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.get("health")) {
      const cfg = describeRedisConfig();
      const redis = getRedis();
      let redisReachable: boolean | null = null;
      let redisError: string | null = null;
      if (redis) {
        try {
          await redis.get(REDIS_KEY);
          redisReachable = true;
        } catch (e: any) {
          redisReachable = false;
          const c = describeCause(e);
          redisError = c.code ? `${c.code}: ${c.message}` : c.message;
        }
      }
      return NextResponse.json({
        success: true,
        ...cfg,
        redisConfigured: !!redis,
        redisReachable,
        redisError,
        restProbe: await probeRedisRest(),
        storage: redis ? "redis" : cfg.vercel ? "없음 (저장 불가)" : "file",
      });
    }
    const data = await readAdjustments();
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error("예산 수기조정 조회 오류:", error);
    return NextResponse.json(
      { error: error.message || "예산 수기조정 조회 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// POST: 전체 저장 (배포 환경에서만 비밀번호 필요)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { adjustments, password } = body ?? {};

    if (process.env.VERCEL === "1") {
      const expectedPassword = process.env.EDIT_PASSWORD;
      if (!expectedPassword || password !== expectedPassword) {
        return NextResponse.json(
          { error: "비밀번호가 올바르지 않습니다.", needPassword: true },
          { status: 401 }
        );
      }
    }

    if (!Array.isArray(adjustments)) {
      return NextResponse.json(
        { error: "adjustments 배열이 필요합니다." },
        { status: 400 }
      );
    }

    // 빈 행(대분류 없음)은 저장하지 않는다
    const cleaned = normalizeAdjustments(adjustments).filter((a) => a.lv1.trim());
    await writeAdjustments(cleaned);

    return NextResponse.json({ success: true, data: cleaned });
  } catch (error: any) {
    console.error("예산 수기조정 저장 오류:", error);
    return NextResponse.json(
      { error: error.message || "예산 수기조정 저장 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
