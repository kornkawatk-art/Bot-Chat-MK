import { randomUUID } from "node:crypto";
import { startHandoff } from "./handoff";
import { pushText } from "./line";
import { getRedisClient, type RedisLike } from "./redis-client";
import { addStaffMember } from "./staff";

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

type EscalationRedis = Pick<RedisLike, "get" | "set" | "del" | "sAdd" | "sMembers" | "sRem">;

interface WithRedis {
  redis?: EscalationRedis;
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
 * Marks the escalation whose alert message matches `quotedMessageId` as a staff member's message
 * rather than a real customer's — clears it from pending (so it stops being re-alerted) and adds
 * the customer to the staff list so future messages from them skip admin escalation entirely.
 * Returns the customer's name when a staff member was added, or null (no match, or the escalation
 * had no userId to add). Never throws.
 */
export async function markEscalationAsStaff(
  quotedMessageId: string,
  deps: WithRedis & { addStaffMemberFn?: typeof addStaffMember } = {},
): Promise<string | null> {
  try {
    const redis = deps.redis ?? (await getRedisClient());
    const addStaffMemberFn = deps.addStaffMemberFn ?? addStaffMember;
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
        if (!escalation.userId) return null;
        await addStaffMemberFn(escalation.userId, escalation.customerName);
        return escalation.customerName;
      }
    }
    return null;
  } catch (err) {
    log("warn", "escalation_mark_staff_failed", err);
    return null;
  }
}

/**
 * Deletes every pending escalation (e.g. to clear out stale/stuck entries, like ones left over from
 * testing) without starting a Handoff or adding anyone to the staff list. Returns how many were
 * cleared. Never throws.
 */
export async function clearAllPendingEscalations(deps: WithRedis = {}): Promise<number> {
  try {
    const redis = deps.redis ?? (await getRedisClient());
    const ids = await redis.sMembers(PENDING_SET_KEY);
    for (const id of ids) {
      await redis.del(escalationKey(id));
      await redis.sRem(PENDING_SET_KEY, id);
    }
    return ids.length;
  } catch (err) {
    log("warn", "escalation_clear_all_failed", err);
    return 0;
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

      // Isolated per-escalation: one failed push (e.g. LINE rate limit) must not stop the rest of
      // this batch from being checked, and must still back off lastAlertAt so a failed escalation
      // doesn't get retried on every single subsequent webhook request until it succeeds.
      try {
        const message = `⏰ ยังไม่มีใครรับเรื่องนี้ (เกิน 30 นาทีแล้ว)\n\nจาก: ${escalation.customerName}\nคำถาม: "${escalation.question}"\n\nรบกวน reply (quote) ข้อความนี้เพื่อรับเรื่องด้วยนะคะ 🙏`;
        escalation.messageId = await pushTextFn(groupId, message);
      } catch (err) {
        log("warn", "escalation_realert_push_failed", err);
      }
      escalation.lastAlertAt = nowMs;
      await redis.set(escalationKey(id), JSON.stringify(escalation));
    }
  } catch (err) {
    log("warn", "escalation_realert_failed", err);
  }
}
