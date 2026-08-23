import { getRedisClient, type RedisLike } from "./redis-client";

const STAFF_LIST_KEY = "staff_members";

export interface StaffMember {
  userId: string;
  customerName: string;
  addedAt: number;
}

type StaffRedis = Pick<RedisLike, "lPush" | "lRange" | "lRem">;

interface WithRedis {
  redis?: StaffRedis;
}

function log(msg: string, error: unknown) {
  console.warn(JSON.stringify({ level: "warn", msg, error: String(error) }));
}

/**
 * Lists all staff members. Order is not meaningful beyond what formatStaffListSummary shows —
 * removeStaffMemberByIndex relies on this same order matching what the admin last saw. Never throws.
 */
export async function listStaffMembers(deps: WithRedis = {}): Promise<StaffMember[]> {
  try {
    const redis = deps.redis ?? (await getRedisClient());
    const raw = await redis.lRange(STAFF_LIST_KEY, 0, -1);
    return raw.map((r) => JSON.parse(r) as StaffMember);
  } catch (err) {
    log("staff_list_failed", err);
    return [];
  }
}

/** Adds a userId to the staff list, skipping if it's already present. Never throws. */
export async function addStaffMember(
  userId: string,
  customerName: string,
  deps: WithRedis & { now?: () => number } = {},
): Promise<void> {
  try {
    const redis = deps.redis ?? (await getRedisClient());
    const now = deps.now ?? Date.now;
    const existing = await listStaffMembers({ redis });
    if (existing.some((m) => m.userId === userId)) return;
    const member: StaffMember = { userId, customerName, addedAt: now() };
    await redis.lPush(STAFF_LIST_KEY, JSON.stringify(member));
  } catch (err) {
    log("staff_add_failed", err);
  }
}

/**
 * True when userId is a known staff member — their messages skip admin escalation entirely, but
 * the bot still replies to them normally otherwise. Fails closed (returns false, i.e. treat as a
 * regular customer) on Redis errors, since under-suppressing one alert is safer than silently
 * dropping a real customer's escalation. Never throws.
 */
export async function isStaffMember(userId: string, deps: WithRedis = {}): Promise<boolean> {
  const members = await listStaffMembers(deps);
  return members.some((m) => m.userId === userId);
}

/**
 * Removes the staff member at `index` (1-based, matching what formatStaffListSummary displayed).
 * Returns the removed member, or null if nothing was at that index. Never throws.
 */
export async function removeStaffMemberByIndex(index: number, deps: WithRedis = {}): Promise<StaffMember | null> {
  try {
    const redis = deps.redis ?? (await getRedisClient());
    const raw = await redis.lRange(STAFF_LIST_KEY, 0, -1);
    const targetRaw = raw[index - 1];
    if (!targetRaw) return null;
    await redis.lRem(STAFF_LIST_KEY, 1, targetRaw);
    return JSON.parse(targetRaw) as StaffMember;
  } catch (err) {
    log("staff_remove_failed", err);
    return null;
  }
}

/** Renders the staff list as a numbered LINE message for the admin group's "รายชื่อพนักงาน" command. */
export function formatStaffListSummary(members: StaffMember[]): string {
  if (members.length === 0) return "ยังไม่มีพนักงานในลิสต์ค่ะ";

  const lines = members.map((m, i) => `${i + 1}. ${m.customerName}`);
  return `👥 รายชื่อพนักงาน (${members.length} คน)\n\n${lines.join("\n")}`;
}
