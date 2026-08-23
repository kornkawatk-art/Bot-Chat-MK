import { describe, expect, it, vi } from "vitest";
import { formatUnansweredQuestionsSummary, getRecentUnansweredQuestions, logUnansweredQuestion } from "./analytics";

function fakeRedis(initial: string[] = []) {
  let list = [...initial];
  return {
    list,
    lPush: vi.fn(async (_key: string, element: string) => {
      list.unshift(element);
      return list.length;
    }),
    lTrim: vi.fn(async (_key: string, start: number, stop: number) => {
      list = list.slice(start, stop + 1);
      return "OK";
    }),
    lRange: vi.fn(async (_key: string, start: number, stop: number) => list.slice(start, stop + 1)),
  };
}

describe("logUnansweredQuestion", () => {
  it("stores the question with a timestamp, newest first", async () => {
    const redis = fakeRedis();

    await logUnansweredQuestion("เปิดกี่โมง", { redis, now: () => 1000 });

    expect(redis.lPush).toHaveBeenCalledWith("unanswered_questions", JSON.stringify({ question: "เปิดกี่โมง", timestamp: 1000 }));
  });

  it("trims the stored list to the last 200 entries", async () => {
    const redis = fakeRedis();

    await logUnansweredQuestion("q", { redis, now: () => 0 });

    expect(redis.lTrim).toHaveBeenCalledWith("unanswered_questions", 0, 199);
  });

  it("does not throw when redis fails", async () => {
    const redis = fakeRedis();
    redis.lPush.mockRejectedValue(new Error("down"));

    await expect(logUnansweredQuestion("q", { redis, now: () => 0 })).resolves.toBeUndefined();
  });
});

describe("getRecentUnansweredQuestions", () => {
  it("returns the most recent 20 entries, parsed", async () => {
    const stored = [
      JSON.stringify({ question: "q2", timestamp: 2000 }),
      JSON.stringify({ question: "q1", timestamp: 1000 }),
    ];
    const redis = fakeRedis(stored);

    const result = await getRecentUnansweredQuestions({ redis });

    expect(result).toEqual([
      { question: "q2", timestamp: 2000 },
      { question: "q1", timestamp: 1000 },
    ]);
  });

  it("returns an empty array and does not throw when redis fails", async () => {
    const redis = fakeRedis();
    redis.lRange.mockRejectedValue(new Error("down"));

    await expect(getRecentUnansweredQuestions({ redis })).resolves.toEqual([]);
  });
});

describe("formatUnansweredQuestionsSummary", () => {
  it("numbers each question with its Thai timestamp", () => {
    const summary = formatUnansweredQuestionsSummary([
      { question: "เปิดกี่โมง", timestamp: new Date("2026-08-21T08:32:00Z").getTime() },
    ]);

    expect(summary).toBe('📋 คำถามที่ตอบไม่ได้ล่าสุด (1 รายการ)\n\n1. 21 ส.ค. 2569 15:32 — "เปิดกี่โมง"');
  });

  it("says there are none when the list is empty", () => {
    expect(formatUnansweredQuestionsSummary([])).toBe("ยังไม่มีคำถามที่ตอบไม่ได้ในระบบค่ะ");
  });
});
