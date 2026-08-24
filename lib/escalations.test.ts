import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeEscalation,
  clearAllPendingEscalations,
  markEscalationAsStaff,
  reAlertOverdueEscalations,
  recordEscalation,
} from "./escalations";

function fakeRedis() {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  return {
    store,
    sets,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    sAdd: vi.fn(async (key: string, member: string) => {
      if (!sets.has(key)) sets.set(key, new Set());
      sets.get(key)!.add(member);
      return 1;
    }),
    sMembers: vi.fn(async (key: string) => Array.from(sets.get(key) ?? [])),
    sRem: vi.fn(async (key: string, member: string) => {
      sets.get(key)?.delete(member);
      return 1;
    }),
  };
}

describe("recordEscalation", () => {
  it("stores the escalation and tracks it as pending", async () => {
    const redis = fakeRedis();

    await recordEscalation("เปิดกี่โมง", "U123", "สมชาย", "msg-1", { redis, now: () => 1000 });

    const ids = await redis.sMembers("escalations:pending");
    expect(ids).toHaveLength(1);
    const stored = JSON.parse(redis.store.get(`escalation:${ids[0]}`)!);
    expect(stored).toMatchObject({
      messageId: "msg-1",
      createdAt: 1000,
      lastAlertAt: 1000,
      question: "เปิดกี่โมง",
      userId: "U123",
      customerName: "สมชาย",
    });
  });

  it("does not throw when redis fails", async () => {
    const redis = fakeRedis();
    redis.sAdd.mockRejectedValue(new Error("down"));

    await expect(recordEscalation("q", "U1", "ลูกค้า", "msg-1", { redis, now: () => 0 })).resolves.toBeUndefined();
  });
});

describe("acknowledgeEscalation", () => {
  it("removes and returns true when a pending escalation matches the message id", async () => {
    const redis = fakeRedis();
    await recordEscalation("เปิดกี่โมง", "U123", "สมชาย", "msg-1", { redis, now: () => 0 });

    const acked = await acknowledgeEscalation("msg-1", { redis });

    expect(acked).toBe(true);
    expect(await redis.sMembers("escalations:pending")).toHaveLength(0);
  });

  it("returns false when no pending escalation matches", async () => {
    const redis = fakeRedis();
    await recordEscalation("เปิดกี่โมง", "U123", "สมชาย", "msg-1", { redis, now: () => 0 });

    const acked = await acknowledgeEscalation("msg-999", { redis });

    expect(acked).toBe(false);
  });

  it("does not throw when redis fails", async () => {
    const redis = fakeRedis();
    redis.sMembers.mockRejectedValue(new Error("down"));

    await expect(acknowledgeEscalation("msg-1", { redis })).resolves.toBe(false);
  });

  it("starts a handoff for the customer so the bot goes quiet for them", async () => {
    const redis = fakeRedis();
    const startHandoffFn = vi.fn();
    await recordEscalation("เปิดกี่โมง", "U123", "สมชาย", "msg-1", { redis, now: () => 0 });

    await acknowledgeEscalation("msg-1", { redis, startHandoffFn });

    expect(startHandoffFn).toHaveBeenCalledWith("U123");
  });

  it("does not start a handoff when the escalation has no userId", async () => {
    const redis = fakeRedis();
    const startHandoffFn = vi.fn();
    await recordEscalation("เปิดกี่โมง", undefined, "ลูกค้า", "msg-1", { redis, now: () => 0 });

    await acknowledgeEscalation("msg-1", { redis, startHandoffFn });

    expect(startHandoffFn).not.toHaveBeenCalled();
  });

  it("does not start a handoff when nothing matched", async () => {
    const redis = fakeRedis();
    const startHandoffFn = vi.fn();
    await recordEscalation("เปิดกี่โมง", "U123", "สมชาย", "msg-1", { redis, now: () => 0 });

    await acknowledgeEscalation("msg-999", { redis, startHandoffFn });

    expect(startHandoffFn).not.toHaveBeenCalled();
  });
});

describe("markEscalationAsStaff", () => {
  it("clears the pending escalation and adds the customer as staff, returning their name", async () => {
    const redis = fakeRedis();
    const addStaffMemberFn = vi.fn();
    await recordEscalation("รูปภาพ", "U123", "สมชาย", "msg-1", { redis, now: () => 0 });

    const result = await markEscalationAsStaff("msg-1", { redis, addStaffMemberFn });

    expect(result).toBe("สมชาย");
    expect(addStaffMemberFn).toHaveBeenCalledWith("U123", "สมชาย");
    expect(await redis.sMembers("escalations:pending")).toHaveLength(0);
  });

  it("returns null when no pending escalation matches", async () => {
    const redis = fakeRedis();
    const addStaffMemberFn = vi.fn();
    await recordEscalation("รูปภาพ", "U123", "สมชาย", "msg-1", { redis, now: () => 0 });

    const result = await markEscalationAsStaff("msg-999", { redis, addStaffMemberFn });

    expect(result).toBeNull();
    expect(addStaffMemberFn).not.toHaveBeenCalled();
  });

  it("clears the escalation but returns null and skips adding staff when there's no userId", async () => {
    const redis = fakeRedis();
    const addStaffMemberFn = vi.fn();
    await recordEscalation("รูปภาพ", undefined, "ลูกค้า", "msg-1", { redis, now: () => 0 });

    const result = await markEscalationAsStaff("msg-1", { redis, addStaffMemberFn });

    expect(result).toBeNull();
    expect(addStaffMemberFn).not.toHaveBeenCalled();
    expect(await redis.sMembers("escalations:pending")).toHaveLength(0);
  });

  it("does not throw when redis fails", async () => {
    const redis = fakeRedis();
    redis.sMembers.mockRejectedValue(new Error("down"));

    await expect(markEscalationAsStaff("msg-1", { redis })).resolves.toBeNull();
  });
});

describe("clearAllPendingEscalations", () => {
  it("deletes every pending escalation and returns how many were cleared", async () => {
    const redis = fakeRedis();
    await recordEscalation("q1", "U1", "ลูกค้า1", "msg-1", { redis, now: () => 0 });
    await recordEscalation("q2", "U2", "ลูกค้า2", "msg-2", { redis, now: () => 0 });

    const count = await clearAllPendingEscalations({ redis });

    expect(count).toBe(2);
    expect(await redis.sMembers("escalations:pending")).toHaveLength(0);
  });

  it("returns 0 when there is nothing pending", async () => {
    const redis = fakeRedis();

    expect(await clearAllPendingEscalations({ redis })).toBe(0);
  });

  it("does not throw and returns 0 when redis fails", async () => {
    const redis = fakeRedis();
    redis.sMembers.mockRejectedValue(new Error("down"));

    await expect(clearAllPendingEscalations({ redis })).resolves.toBe(0);
  });
});

describe("reAlertOverdueEscalations", () => {
  const THIRTY_MIN = 30 * 60 * 1000;

  beforeEach(() => {
    process.env.LINE_ADMIN_GROUP_ID = "group-123";
  });

  afterEach(() => {
    delete process.env.LINE_ADMIN_GROUP_ID;
  });

  it("does nothing when LINE_ADMIN_GROUP_ID is not configured", async () => {
    delete process.env.LINE_ADMIN_GROUP_ID;
    const redis = fakeRedis();
    const pushTextFn = vi.fn();
    await recordEscalation("q", "U1", "ลูกค้า", "msg-1", { redis, now: () => 0 });

    await reAlertOverdueEscalations({ redis, pushTextFn, now: () => THIRTY_MIN });

    expect(pushTextFn).not.toHaveBeenCalled();
  });

  it("does not re-alert escalations younger than 30 minutes", async () => {
    const redis = fakeRedis();
    const pushTextFn = vi.fn();
    await recordEscalation("q", "U1", "ลูกค้า", "msg-1", { redis, now: () => 0 });

    await reAlertOverdueEscalations({ redis, pushTextFn, now: () => THIRTY_MIN - 1000 });

    expect(pushTextFn).not.toHaveBeenCalled();
  });

  it("re-alerts with the customer name and question, and updates the tracked message id", async () => {
    const redis = fakeRedis();
    const pushTextFn = vi.fn().mockResolvedValue("msg-2");
    await recordEscalation("เปิดกี่โมง", "U123", "สมชาย", "msg-1", { redis, now: () => 0 });

    await reAlertOverdueEscalations({ redis, pushTextFn, now: () => THIRTY_MIN });

    const [, message] = pushTextFn.mock.calls[0];
    expect(message).toContain("สมชาย");
    expect(message).toContain("เปิดกี่โมง");
    const ids = await redis.sMembers("escalations:pending");
    const stored = JSON.parse(redis.store.get(`escalation:${ids[0]}`)!);
    expect(stored.messageId).toBe("msg-2");
    expect(stored.lastAlertAt).toBe(THIRTY_MIN);
  });

  it("never throws even when the push fails", async () => {
    const redis = fakeRedis();
    const pushTextFn = vi.fn().mockRejectedValue(new Error("down"));
    await recordEscalation("q", "U1", "ลูกค้า", "msg-1", { redis, now: () => 0 });

    await expect(reAlertOverdueEscalations({ redis, pushTextFn, now: () => THIRTY_MIN })).resolves.toBeUndefined();
  });

  it("still re-alerts the other pending escalations when one of them fails to push", async () => {
    const redis = fakeRedis();
    const pushTextFn = vi.fn().mockRejectedValueOnce(new Error("429")).mockResolvedValueOnce("msg-new");
    await recordEscalation("q1", "U1", "ลูกค้า1", "msg-1", { redis, now: () => 0 });
    await recordEscalation("q2", "U2", "ลูกค้า2", "msg-2", { redis, now: () => 0 });

    await reAlertOverdueEscalations({ redis, pushTextFn, now: () => THIRTY_MIN });

    expect(pushTextFn).toHaveBeenCalledTimes(2);
  });

  it("backs off (updates lastAlertAt) even when the push fails, so it isn't retried on the very next check", async () => {
    const redis = fakeRedis();
    const pushTextFn = vi.fn().mockRejectedValue(new Error("429"));
    await recordEscalation("q", "U1", "ลูกค้า", "msg-1", { redis, now: () => 0 });

    await reAlertOverdueEscalations({ redis, pushTextFn, now: () => THIRTY_MIN });
    pushTextFn.mockClear();
    await reAlertOverdueEscalations({ redis, pushTextFn, now: () => THIRTY_MIN + 1000 });

    expect(pushTextFn).not.toHaveBeenCalled();
  });
});
