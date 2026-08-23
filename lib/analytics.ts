import { formatThaiTimestamp } from "./admin-notify";
import { getRedisClient, type RedisLike } from "./redis-client";

const LOG_KEY = "unanswered_questions";
const MAX_STORED = 200;
const DISPLAY_LIMIT = 20;

type AnalyticsRedis = Pick<RedisLike, "lPush" | "lTrim" | "lRange">;

export interface LoggedQuestion {
  question: string;
  timestamp: number;
}

function log(msg: string, error: unknown) {
  console.warn(JSON.stringify({ level: "warn", msg, error: String(error) }));
}

/**
 * Logs a question the FAQ couldn't answer, for later review (not price/stock "code not found" —
 * that's a data-file problem, not a content gap). Never throws.
 */
export async function logUnansweredQuestion(
  question: string,
  deps: { redis?: AnalyticsRedis; now?: () => number } = {},
): Promise<void> {
  try {
    const redis = deps.redis ?? (await getRedisClient());
    const now = deps.now ?? Date.now;
    const entry: LoggedQuestion = { question, timestamp: now() };
    await redis.lPush(LOG_KEY, JSON.stringify(entry));
    await redis.lTrim(LOG_KEY, 0, MAX_STORED - 1);
  } catch (err) {
    log("analytics_log_failed", err);
  }
}

/** Reads the most recent unanswered questions, newest first. Never throws. */
export async function getRecentUnansweredQuestions(deps: { redis?: AnalyticsRedis } = {}): Promise<LoggedQuestion[]> {
  try {
    const redis = deps.redis ?? (await getRedisClient());
    const raw = await redis.lRange(LOG_KEY, 0, DISPLAY_LIMIT - 1);
    return raw.map((r) => JSON.parse(r) as LoggedQuestion);
  } catch (err) {
    log("analytics_read_failed", err);
    return [];
  }
}

/** Renders the log as a numbered LINE message for the admin group's "สรุปคำถาม" command. */
export function formatUnansweredQuestionsSummary(entries: LoggedQuestion[]): string {
  if (entries.length === 0) return "ยังไม่มีคำถามที่ตอบไม่ได้ในระบบค่ะ";

  const lines = entries.map(
    (e, i) => `${i + 1}. ${formatThaiTimestamp(new Date(e.timestamp))} — "${e.question}"`,
  );
  return `📋 คำถามที่ตอบไม่ได้ล่าสุด (${entries.length} รายการ)\n\n${lines.join("\n")}`;
}
