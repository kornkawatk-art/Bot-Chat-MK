import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SHEET_CSV_URL = "https://example.com/faq.csv";
const CSV_V1 = "question,answer\nQ1,A1";
const CSV_V2 = "question,answer\nQ2,A2";

function textResponse(csv: string) {
  return { ok: true, status: 200, text: async () => csv };
}

describe("getFaq", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SHEET_CSV_URL = SHEET_CSV_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the sheet and parses it on the first call", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse(CSV_V1));
    const { getFaq } = await import("./sheet");

    const result = await getFaq({ fetchImpl, now: () => 0 });

    expect(fetchImpl).toHaveBeenCalledWith(SHEET_CSV_URL);
    expect(result).toEqual([{ question: "Q1", answer: "A1" }]);
  });

  it("serves from cache within the TTL without re-fetching", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse(CSV_V1));
    const { getFaq } = await import("./sheet");

    await getFaq({ fetchImpl, now: () => 0 });
    const result = await getFaq({ fetchImpl, now: () => 59_000 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ question: "Q1", answer: "A1" }]);
  });

  it("re-fetches once the TTL has expired", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(textResponse(CSV_V1)).mockResolvedValueOnce(textResponse(CSV_V2));
    const { getFaq } = await import("./sheet");

    await getFaq({ fetchImpl, now: () => 0 });
    const result = await getFaq({ fetchImpl, now: () => 61_000 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toEqual([{ question: "Q2", answer: "A2" }]);
  });

  it("falls back to the stale cache when a later fetch fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(textResponse(CSV_V1)).mockRejectedValueOnce(new Error("network down"));
    const { getFaq } = await import("./sheet");

    await getFaq({ fetchImpl, now: () => 0 });
    const result = await getFaq({ fetchImpl, now: () => 61_000 });

    expect(result).toEqual([{ question: "Q1", answer: "A1" }]);
  });

  it("throws when the fetch fails and there is no cache yet", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const { getFaq } = await import("./sheet");

    await expect(getFaq({ fetchImpl, now: () => 0 })).rejects.toThrow();
  });
});
