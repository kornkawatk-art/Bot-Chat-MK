import { randomUUID } from "node:crypto";
import { startHandoff } from "./handoff";
import { pushText } from "./line";
import { getRedisClient, type RedisLike } from "./redis-client";

const PENDING_SET_KEY = "escalations:pending";
const RE_ALERT_INTERVAL_MS = 30 * 60 * 1000;

interface Escalation {
  id: string;
  messageId: string;
  createdAt: number;
  lastAlertAt: number;
  question: string;
  userId?: string;
  customerName: string;
}

function escalationKey(id: string): string {
  return `escalation:${id}`;
}

function log(level: "warn" | "error", msg: string, error: unknown) {
  const write = level === "warn" ? console.warn : console.error;
  write(JSON.stringify({ level, msg, error: String(error) }));
}

interface WithRedis {
  redis?: RedisLike;
}

/** Tracks a new escalation so it can be re-alerted if nobody acknowledges it. Never throws. */
export async function recordEscalation(
  question: string,
  userId: string | undefined,
  customerName: string,
  messageId: string,
  deps: WithRedis & { now?: () => number } = {},
): Promise<void> {
  try {
    const redis = deps.redis ?? (await getRedisClient());
    const now = deps.now ?? Date.now;
    const nowMs = now();
    const escalation: Escalation = {
      id: randomUUID(),
      messageId,
      createdAt: nowMs,
      lastAlertAt: nowMs,
      question,
      userId,
      customerName,
    };
    await redis.set(escalationKey(escalation.id), JSON.stringify(escalation));
    await redis.sAdd(PENDING_SET_KEY, escalation.id);
  } catch (err) {
    log("warn", "escalation_record_failed", err);
  }
}

/**
 * Marks the escalation whose alert message matches `quotedMessageId` as handled (an admin
 * replied/quoted it in the group). Returns whether a matching escalation was found. Never throws.
 */
export async function acknowledgeEscalation(
  quotedMessageId: string,
  deps: WithRedis & { startHandoffFn?: typeof startHandoff } = {},
): Promise<boolean> {
  try {
    const redis = deps.redis ?? (await getRedisClient());
    const startHandoffFn = deps.startHandoffFn ?? startHandoff;
    const ids = await redis.sMembers(PENDING_SET_KEY);
    for (const id of ids) {
      const raw = await redis.get(escalationKey(id));
      if (!raw) {
        await redis.sRem(PENDING_SET_KEY, id);
        continue;
      }
      const escalation: Escalation = JSON.parse(raw);
      if (escalation.messageId === quotedMessageId) {
        await redis.sRem(PENDING_SET_KEY, id);
        await redis.del(escalationKey(id));
        if (escalation.userId) {
          await startHandoffFn(escalation.userId);
        }
        return true;
      }
    }
    return false;
  } catch (err) {
    log("warn", "escalation_ack_failed", err);
    return false;
  }
}

/**
 * Re-alerts the admin group for any pending escalation that hasn't been acknowledged in the last
 * 30 minutes. Called opportunistically on incoming webhook traffic (Vercel's Hobby plan can't run
 * Cron more often than daily), so timing follows real traffic rather than a precise timer. Never throws.
 */
export async function reAlertOverdueEscalations(
  deps: WithRedis & { now?: () => number; pushTextFn?: typeof pushText } = {},
): Promise<void> {
  const groupId = process.env.LINE_ADMIN_GROUP_ID;
  if (!groupId) return;

  try {
    const redis = deps.redis ?? (await getRedisClient());
    const now = deps.now ?? Date.now;
    const pushTextFn = deps.pushTextFn ?? pushText;
    const nowMs = now();
    const ids = await redis.sMembers(PENDING_SET_KEY);

    for (const id of ids) {
      const raw = await redis.get(escalationKey(id));
      if (!raw) {
        await redis.sRem(PENDING_SET_KEY, id);
        continue;
      }
      const escalation: Escalation = JSON.parse(raw);
      if (nowMs - escalation.lastAlertAt < RE_ALERT_INTERVAL_MS) continue;

      const message = `⏰ ยังไม่มีใครรับเรื่องนี้ (เกิน 30 นาทีแล้ว)\n\nจาก: ${escalation.customerName}\nคำถาม: "${escalation.question}"\n\nรบกวน reply (quote) ข้อความนี้เพื่อรับเรื่องด้วยนะคะ 🙏`;
      const newMessageId = await pushTextFn(groupId, message);
      escalation.messageId = newMessageId;
      escalation.lastAlertAt = nowMs;
      await redis.set(escalationKey(id), JSON.stringify(escalation));
    }
  } catch (err) {
    log("warn", "escalation_realert_failed", err);
  }
}
