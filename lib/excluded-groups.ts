import { getRedisClient, type RedisLike } from "./redis-client";

const EXCLUDED_GROUPS_KEY = "excluded_groups";

export interface ExcludedGroup {
  groupId: string;
  groupName: string;
  addedAt: number;
}

type ExcludedGroupsRedis = Pick<RedisLike, "lPush" | "lRange" | "lRem">;

interface WithRedis {
  redis?: ExcludedGroupsRedis;
}

function log(msg: string, error: unknown) {
  console.warn(JSON.stringify({ level: "warn", msg, error: String(error) }));
}

/**
 * Lists all excluded groups. Order is not meaningful beyond what formatExcludedGroupsSummary
 * shows — removeExcludedGroupByIndex relies on this same order matching what the admin last saw.
 * Never throws.
 */
export async function listExcludedGroups(deps: WithRedis = {}): Promise<ExcludedGroup[]> {
  try {
    const redis = deps.redis ?? (await getRedisClient());
    const raw = await redis.lRange(EXCLUDED_GROUPS_KEY, 0, -1);
    return raw.map((r) => JSON.parse(r) as ExcludedGroup);
  } catch (err) {
    log("excluded_groups_list_failed", err);
    return [];
  }
}

/** Adds a groupId to the excluded list, skipping if it's already present. Never throws. */
export async function addExcludedGroup(
  groupId: string,
  groupName: string,
  deps: WithRedis & { now?: () => number } = {},
): Promise<void> {
  try {
    const redis = deps.redis ?? (await getRedisClient());
    const now = deps.now ?? Date.now;
    const existing = await listExcludedGroups({ redis });
    if (existing.some((g) => g.groupId === groupId)) return;
    const group: ExcludedGroup = { groupId, groupName, addedAt: now() };
    await redis.lPush(EXCLUDED_GROUPS_KEY, JSON.stringify(group));
  } catch (err) {
    log("excluded_groups_add_failed", err);
  }
}

/**
 * True when groupId is a known excluded group — the bot stays completely silent there (no replies,
 * no escalations), since it's a group where human staff already cover customers directly. Fails
 * closed (returns false, i.e. behave normally) on Redis errors. Never throws.
 */
export async function isExcludedGroup(groupId: string, deps: WithRedis = {}): Promise<boolean> {
  const groups = await listExcludedGroups(deps);
  return groups.some((g) => g.groupId === groupId);
}

/**
 * Removes the excluded group at `index` (1-based, matching what formatExcludedGroupsSummary
 * displayed). Returns the removed group, or null if nothing was at that index. Never throws.
 */
export async function removeExcludedGroupByIndex(index: number, deps: WithRedis = {}): Promise<ExcludedGroup | null> {
  try {
    const redis = deps.redis ?? (await getRedisClient());
    const raw = await redis.lRange(EXCLUDED_GROUPS_KEY, 0, -1);
    const targetRaw = raw[index - 1];
    if (!targetRaw) return null;
    await redis.lRem(EXCLUDED_GROUPS_KEY, 1, targetRaw);
    return JSON.parse(targetRaw) as ExcludedGroup;
  } catch (err) {
    log("excluded_groups_remove_failed", err);
    return null;
  }
}

/** Renders the excluded-group list as a numbered LINE message for the admin group's "รายชื่อกลุ่มยกเว้น" command. */
export function formatExcludedGroupsSummary(groups: ExcludedGroup[]): string {
  if (groups.length === 0) return "ยังไม่มีกลุ่มยกเว้นในระบบค่ะ";

  const lines = groups.map((g, i) => `${i + 1}. ${g.groupName}`);
  return `🔕 กลุ่มยกเว้น (${groups.length} กลุ่ม)\n\n${lines.join("\n")}`;
}
