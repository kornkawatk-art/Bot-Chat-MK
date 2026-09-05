import { describe, expect, it, vi } from "vitest";
import {
  addExcludedGroup,
  formatExcludedGroupsSummary,
  isExcludedGroup,
  listExcludedGroups,
  removeExcludedGroupByIndex,
} from "./excluded-groups";

function fakeRedis() {
  const list: string[] = [];
  return {
    list,
    lPush: vi.fn(async (_key: string, element: string) => {
      list.unshift(element);
      return list.length;
    }),
    lRange: vi.fn(async (_key: string, start: number, stop: number) => {
      const end = stop === -1 ? list.length : stop + 1;
      return list.slice(start, end);
    }),
    lRem: vi.fn(async (_key: string, _count: number, element: string) => {
      const idx = list.indexOf(element);
      if (idx === -1) return 0;
      list.splice(idx, 1);
      return 1;
    }),
  };
}

describe("addExcludedGroup", () => {
  it("adds a new group to the list", async () => {
    const redis = fakeRedis();

    await addExcludedGroup("G123", "กลุ่มลูกค้า A", { redis, now: () => 1000 });

    const groups = await listExcludedGroups({ redis });
    expect(groups).toEqual([{ groupId: "G123", groupName: "กลุ่มลูกค้า A", addedAt: 1000 }]);
  });

  it("does not add a duplicate when the groupId is already in the list", async () => {
    const redis = fakeRedis();
    await addExcludedGroup("G123", "กลุ่มลูกค้า A", { redis, now: () => 1000 });

    await addExcludedGroup("G123", "กลุ่มลูกค้า A (อีกชื่อ)", { redis, now: () => 2000 });

    const groups = await listExcludedGroups({ redis });
    expect(groups).toHaveLength(1);
  });

  it("does not throw when redis fails", async () => {
    const redis = fakeRedis();
    redis.lPush.mockRejectedValue(new Error("down"));

    await expect(addExcludedGroup("G123", "กลุ่มลูกค้า A", { redis, now: () => 0 })).resolves.toBeUndefined();
  });
});

describe("isExcludedGroup", () => {
  it("returns true when the groupId is in the list", async () => {
    const redis = fakeRedis();
    await addExcludedGroup("G123", "กลุ่มลูกค้า A", { redis, now: () => 0 });

    expect(await isExcludedGroup("G123", { redis })).toBe(true);
  });

  it("returns false when the groupId is not in the list", async () => {
    const redis = fakeRedis();
    await addExcludedGroup("G123", "กลุ่มลูกค้า A", { redis, now: () => 0 });

    expect(await isExcludedGroup("G999", { redis })).toBe(false);
  });

  it("fails closed (returns false) when redis errors, so the bot behaves normally", async () => {
    const redis = fakeRedis();
    redis.lRange.mockRejectedValue(new Error("down"));

    expect(await isExcludedGroup("G123", { redis })).toBe(false);
  });
});

describe("removeExcludedGroupByIndex", () => {
  it("removes and returns the group at the given 1-based index", async () => {
    const redis = fakeRedis();
    await addExcludedGroup("G1", "กลุ่ม A", { redis, now: () => 0 });
    await addExcludedGroup("G2", "กลุ่ม B", { redis, now: () => 1 });

    const removed = await removeExcludedGroupByIndex(1, { redis });

    expect(removed?.groupName).toBe("กลุ่ม B");
    const remaining = await listExcludedGroups({ redis });
    expect(remaining).toEqual([{ groupId: "G1", groupName: "กลุ่ม A", addedAt: 0 }]);
  });

  it("returns null when the index doesn't match any entry", async () => {
    const redis = fakeRedis();
    await addExcludedGroup("G1", "กลุ่ม A", { redis, now: () => 0 });

    expect(await removeExcludedGroupByIndex(5, { redis })).toBeNull();
  });

  it("does not throw when redis fails", async () => {
    const redis = fakeRedis();
    redis.lRange.mockRejectedValue(new Error("down"));

    await expect(removeExcludedGroupByIndex(1, { redis })).resolves.toBeNull();
  });
});

describe("formatExcludedGroupsSummary", () => {
  it("renders an empty-state message when there are no excluded groups", () => {
    expect(formatExcludedGroupsSummary([])).toBe("ยังไม่มีกลุ่มยกเว้นในระบบค่ะ");
  });

  it("renders a numbered list of group names", () => {
    const summary = formatExcludedGroupsSummary([
      { groupId: "G1", groupName: "กลุ่ม A", addedAt: 0 },
      { groupId: "G2", groupName: "กลุ่ม B", addedAt: 1 },
    ]);

    expect(summary).toContain("1. กลุ่ม A");
    expect(summary).toContain("2. กลุ่ม B");
  });
});
