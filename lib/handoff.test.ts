import { describe, expect, it, vi } from "vitest";
import { isInHandoff, startHandoff } from "./handoff";

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

describe("startHandoff", () => {
  it("marks the customer as handed off with a 1-hour expiry", async () => {
    const redis = fakeRedis();

    await startHandoff("U123", redis);

    expect(redis.set).toHaveBeenCalledWith("handoff:U123", "1", { EX: 60 * 60 });
  });

  it("does not throw when redis fails", async () => {
    const redis = fakeRedis();
    redis.set.mockRejectedValue(new Error("down"));

    await expect(startHandoff("U123", redis)).resolves.toBeUndefined();
  });
});

describe("isInHandoff", () => {
  it("returns false when the customer has no active handoff", async () => {
    const redis = fakeRedis();

    expect(await isInHandoff("U123", redis)).toBe(false);
  });

  it("returns true when the customer is in an active handoff", async () => {
    const redis = fakeRedis({ "handoff:U123": "1" });

    expect(await isInHandoff("U123", redis)).toBe(true);
  });

  it("slides the expiry forward when the customer is checked while handed off", async () => {
    const redis = fakeRedis({ "handoff:U123": "1" });

    await isInHandoff("U123", redis);

    expect(redis.set).toHaveBeenCalledWith("handoff:U123", "1", { EX: 60 * 60 });
  });

  it("does not extend anything when there is no active handoff", async () => {
    const redis = fakeRedis();

    await isInHandoff("U123", redis);

    expect(redis.set).not.toHaveBeenCalled();
  });

  it("returns false and does not throw when redis fails", async () => {
    const redis = fakeRedis();
    redis.get.mockRejectedValue(new Error("down"));

    await expect(isInHandoff("U123", redis)).resolves.toBe(false);
  });
});
