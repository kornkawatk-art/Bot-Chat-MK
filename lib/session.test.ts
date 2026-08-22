import { describe, expect, it, vi } from "vitest";
import { appendToHistory, formatHistory, getHistory } from "./session";

function fakeRedis(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    }),
  };
}

describe("formatHistory", () => {
  it("renders each entry with a role label", () => {
    const text = formatHistory([
      { role: "user", text: "เปิดกี่โมง" },
      { role: "assistant", text: "เปิด 06:00-22:00 น. ค่ะ" },
    ]);

    expect(text).toBe("ลูกค้า: เปิดกี่โมง\nแอดมิน: เปิด 06:00-22:00 น. ค่ะ");
  });

  it("returns an empty string for no history", () => {
    expect(formatHistory([])).toBe("");
  });
});

describe("getHistory", () => {
  it("returns an empty array when there is no stored session", async () => {
    const redis = fakeRedis();

    const result = await getHistory("U123", redis);

    expect(redis.get).toHaveBeenCalledWith("session:U123");
    expect(result).toEqual([]);
  });

  it("parses the stored JSON history", async () => {
    const stored = [{ role: "user", text: "เปิดกี่โมง" }];
    const redis = fakeRedis({ "session:U123": JSON.stringify(stored) });

    const result = await getHistory("U123", redis);

    expect(result).toEqual(stored);
  });

  it("returns an empty array and does not throw when redis errors", async () => {
    const redis = { get: vi.fn().mockRejectedValue(new Error("connection lost")), set: vi.fn() };

    await expect(getHistory("U123", redis)).resolves.toEqual([]);
  });
});

describe("appendToHistory", () => {
  it("appends new entries onto the existing history", async () => {
    const stored = [{ role: "user", text: "เปิดกี่โมง" }];
    const redis = fakeRedis({ "session:U123": JSON.stringify(stored) });

    await appendToHistory("U123", [{ role: "assistant", text: "เปิด 06:00-22:00 น. ค่ะ" }], redis);

    const saved = JSON.parse(redis.store.get("session:U123")!);
    expect(saved).toEqual([
      { role: "user", text: "เปิดกี่โมง" },
      { role: "assistant", text: "เปิด 06:00-22:00 น. ค่ะ" },
    ]);
  });

  it("keeps only the last 6 entries", async () => {
    const stored = Array.from({ length: 6 }, (_, i) => ({ role: "user", text: `q${i}` }));
    const redis = fakeRedis({ "session:U123": JSON.stringify(stored) });

    await appendToHistory("U123", [{ role: "assistant", text: "newest" }], redis);

    const saved = JSON.parse(redis.store.get("session:U123")!);
    expect(saved).toHaveLength(6);
    expect(saved[0]).toEqual({ role: "user", text: "q1" });
    expect(saved[5]).toEqual({ role: "assistant", text: "newest" });
  });

  it("sets a 30-minute expiry on the session", async () => {
    const redis = fakeRedis();

    await appendToHistory("U123", [{ role: "user", text: "hi" }], redis);

    expect(redis.set).toHaveBeenCalledWith("session:U123", expect.any(String), { EX: 30 * 60 });
  });

  it("does not throw when redis errors", async () => {
    const redis = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockRejectedValue(new Error("down")) };

    await expect(appendToHistory("U123", [{ role: "user", text: "hi" }], redis)).resolves.toBeUndefined();
  });
});
