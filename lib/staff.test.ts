import { describe, expect, it, vi } from "vitest";
import {
  addStaffMember,
  formatStaffListSummary,
  isStaffMember,
  listStaffMembers,
  removeStaffMemberByIndex,
} from "./staff";

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

describe("addStaffMember", () => {
  it("adds a new member to the list", async () => {
    const redis = fakeRedis();

    await addStaffMember("U123", "สมชาย", { redis, now: () => 1000 });

    const members = await listStaffMembers({ redis });
    expect(members).toEqual([{ userId: "U123", customerName: "สมชาย", addedAt: 1000 }]);
  });

  it("does not add a duplicate when the userId is already in the list", async () => {
    const redis = fakeRedis();
    await addStaffMember("U123", "สมชาย", { redis, now: () => 1000 });

    await addStaffMember("U123", "สมชาย (อีกชื่อ)", { redis, now: () => 2000 });

    const members = await listStaffMembers({ redis });
    expect(members).toHaveLength(1);
  });

  it("does not throw when redis fails", async () => {
    const redis = fakeRedis();
    redis.lPush.mockRejectedValue(new Error("down"));

    await expect(addStaffMember("U123", "สมชาย", { redis, now: () => 0 })).resolves.toBeUndefined();
  });
});

describe("isStaffMember", () => {
  it("returns true when the userId is in the list", async () => {
    const redis = fakeRedis();
    await addStaffMember("U123", "สมชาย", { redis, now: () => 0 });

    expect(await isStaffMember("U123", { redis })).toBe(true);
  });

  it("returns false when the userId is not in the list", async () => {
    const redis = fakeRedis();
    await addStaffMember("U123", "สมชาย", { redis, now: () => 0 });

    expect(await isStaffMember("U999", { redis })).toBe(false);
  });

  it("fails closed (returns false) when redis errors, so escalation still happens", async () => {
    const redis = fakeRedis();
    redis.lRange.mockRejectedValue(new Error("down"));

    expect(await isStaffMember("U123", { redis })).toBe(false);
  });
});

describe("removeStaffMemberByIndex", () => {
  it("removes and returns the member at the given 1-based index", async () => {
    const redis = fakeRedis();
    await addStaffMember("U1", "สมชาย", { redis, now: () => 0 });
    await addStaffMember("U2", "สมหญิง", { redis, now: () => 1 });

    const removed = await removeStaffMemberByIndex(1, { redis });

    expect(removed?.customerName).toBe("สมหญิง");
    const remaining = await listStaffMembers({ redis });
    expect(remaining).toEqual([{ userId: "U1", customerName: "สมชาย", addedAt: 0 }]);
  });

  it("returns null when the index doesn't match any entry", async () => {
    const redis = fakeRedis();
    await addStaffMember("U1", "สมชาย", { redis, now: () => 0 });

    expect(await removeStaffMemberByIndex(5, { redis })).toBeNull();
  });

  it("does not throw when redis fails", async () => {
    const redis = fakeRedis();
    redis.lRange.mockRejectedValue(new Error("down"));

    await expect(removeStaffMemberByIndex(1, { redis })).resolves.toBeNull();
  });
});

describe("formatStaffListSummary", () => {
  it("renders an empty-state message when there are no staff members", () => {
    expect(formatStaffListSummary([])).toBe("ยังไม่มีพนักงานในลิสต์ค่ะ");
  });

  it("renders a numbered list of staff names", () => {
    const summary = formatStaffListSummary([
      { userId: "U1", customerName: "สมชาย", addedAt: 0 },
      { userId: "U2", customerName: "สมหญิง", addedAt: 1 },
    ]);

    expect(summary).toContain("1. สมชาย");
    expect(summary).toContain("2. สมหญิง");
  });
});
