import { createClient } from "redis";
import type { HistoryEntry } from "../types";

const HISTORY_LIMIT = 6;
const SESSION_TTL_SECONDS = 30 * 60;

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX: number }): Promise<unknown>;
}

let defaultClient: RedisLike | null = null;
let connecting: Promise<RedisLike> | null = null;

function getDefaultClient(): Promise<RedisLike> {
  if (defaultClient) return Promise.resolve(defaultClient);
  if (!connecting) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL not set");
    connecting = createClient({ url })
      .connect()
      .then((client) => {
        defaultClient = client as unknown as RedisLike;
        return defaultClient;
      });
  }
  return connecting;
}

function sessionKey(userId: string): string {
  return `session:${userId}`;
}

/** Renders history entries into the <history> block for the prompt. Empty history renders as "". */
export function formatHistory(entries: HistoryEntry[]): string {
  return entries.map((e) => `${e.role === "user" ? "ลูกค้า" : "แอดมิน"}: ${e.text}`).join("\n");
}

/** Reads the customer's recent conversation history. Never throws — a broken/unconfigured session store just degrades to no memory. */
export async function getHistory(userId: string, client?: RedisLike): Promise<HistoryEntry[]> {
  try {
    const redis = client ?? (await getDefaultClient());
    const raw = await redis.get(sessionKey(userId));
    if (!raw) return [];
    return JSON.parse(raw) as HistoryEntry[];
  } catch (err) {
    console.warn(JSON.stringify({ level: "warn", msg: "session_read_failed", error: String(err) }));
    return [];
  }
}

/** Appends entries to the customer's history, keeping only the last HISTORY_LIMIT and refreshing the session TTL. Never throws. */
export async function appendToHistory(
  userId: string,
  entries: HistoryEntry[],
  client?: RedisLike,
): Promise<void> {
  try {
    const redis = client ?? (await getDefaultClient());
    const existingRaw = await redis.get(sessionKey(userId));
    const existing: HistoryEntry[] = existingRaw ? JSON.parse(existingRaw) : [];
    const updated = [...existing, ...entries].slice(-HISTORY_LIMIT);
    await redis.set(sessionKey(userId), JSON.stringify(updated), { EX: SESSION_TTL_SECONDS });
  } catch (err) {
    console.warn(JSON.stringify({ level: "warn", msg: "session_write_failed", error: String(err) }));
  }
}
