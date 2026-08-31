import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

/**
 * Redis 보관(archival) 방지용 하트비트.
 *
 * Upstash 는 일정 기간 요청이 없는 DB 를 보관 처리하고, 그러면 엔드포인트가
 * 사라져 저장 기능이 통째로 멈춘다 (2026-08 실제 발생). 요금제와 무관한 정책이라
 * vercel.json 의 cron 으로 매일 한 번 호출해 활동을 만들어 둔다.
 */
const HEARTBEAT_KEY = "keep-alive:last-ping";

// 정적 프리렌더되면 빌드 때 한 번만 실행되어 cron 이 Redis 를 건드리지 못한다.
// 호출될 때마다 실제로 돌게 강제한다.
export const dynamic = "force-dynamic";

function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function GET() {
  const at = new Date().toISOString();
  const redis = getRedis();

  // 로컬처럼 Redis 가 없는 환경에서는 할 일이 없다 (실패로 취급하지 않는다)
  if (!redis) {
    return NextResponse.json({ ok: true, at, redis: "설정 없음 — 건너뜀" });
  }

  try {
    // 읽기 + 쓰기 모두 한 번씩 — 어느 쪽을 활동으로 집계하든 걸리도록
    await redis.set(HEARTBEAT_KEY, at);
    const readBack = await redis.get(HEARTBEAT_KEY);
    return NextResponse.json({ ok: true, at, redis: "정상", readBack });
  } catch (error: any) {
    console.error("keep-alive Redis 오류:", error);
    return NextResponse.json(
      { ok: false, at, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
