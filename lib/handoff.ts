import { getRedisClient, type RedisLike } from "./redis-client";

const HANDOFF_TTL_SECONDS = 60 * 60;

type HandoffRedis = Pick<RedisLike, "get" | "set">;

function handoffKey(userId: string): string {
  return `handoff:${userId}`;
}

function log(msg: string, error: unknown) {
  console.warn(JSON.stringify({ level: "warn", msg, error: String(error) }));
}

/** Marks a customer as being actively handled by a human admin — the bot goes silent for them. Never throws. */
export async function startHandoff(userId: string, redis?: HandoffRedis): Promise<void> {
  try {
    const client = redis ?? (await getRedisClient());
    await client.set(handoffKey(userId), "1", { EX: HANDOFF_TTL_SECONDS });
  } catch (err) {
    log("handoff_start_failed", err);
  }
}

/**
 * True while a customer is in an active handoff to a human admin. Sliding window: checking while
 * handed off extends the expiry, so the bot stays quiet through an ongoing conversation and only
 * resumes after a stretch of real inactivity. Never throws.
 */
export async function isInHandoff(userId: string, redis?: HandoffRedis): Promise<boolean> {
  try {
    const client = redis ?? (await getRedisClient());
    const value = await client.get(handoffKey(userId));
    if (!value) return false;
    await client.set(handoffKey(userId), "1", { EX: HANDOFF_TTL_SECONDS });
    return true;
  } catch (err) {
    log("handoff_check_failed", err);
    return false;
  }
}
