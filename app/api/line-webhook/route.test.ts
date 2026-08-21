import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/line", () => ({
  verifySignature: vi.fn(),
  replyText: vi.fn(),
}));
vi.mock("../../../lib/sheet", () => ({
  getFaq: vi.fn(),
}));
vi.mock("../../../lib/gemini", () => ({
  askGemini: vi.fn(),
  buildPrompt: vi.fn((faqCsv: string, question: string) => `PROMPT(${faqCsv})(${question})`),
}));

import { askGemini } from "../../../lib/gemini";
import { replyText, verifySignature } from "../../../lib/line";
import { DEFAULT_REPLY } from "../../../lib/replies";
import { getFaq } from "../../../lib/sheet";
import { POST } from "./route";

const mockedVerifySignature = vi.mocked(verifySignature);
const mockedReplyText = vi.mocked(replyText);
const mockedGetFaq = vi.mocked(getFaq);
const mockedAskGemini = vi.mocked(askGemini);

function messageEvent(text: string, replyToken = "reply-1") {
  return {
    type: "message",
    replyToken,
    message: { type: "text", id: "msg1", text, quoteToken: "qt" },
    timestamp: 0,
    mode: "active",
    webhookEventId: "wh1",
    deliveryContext: { isRedelivery: false },
    source: { type: "user", userId: "U123" },
  };
}

function request(events: unknown[]) {
  return new Request("http://localhost/api/line-webhook", {
    method: "POST",
    headers: { "x-line-signature": "sig" },
    body: JSON.stringify({ destination: "Uxxxx", events }),
  });
}

describe("POST /api/line-webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetFaq.mockResolvedValue([{ question: "Q1", answer: "A1" }]);
  });

  it("returns 401 and does nothing else when the signature is invalid", async () => {
    mockedVerifySignature.mockReturnValue(false);

    const res = await POST(request([messageEvent("hi")]));

    expect(res.status).toBe(401);
    expect(mockedGetFaq).not.toHaveBeenCalled();
    expect(mockedReplyText).not.toHaveBeenCalled();
  });

  it("replies with Gemini's text on a normal answer", async () => {
    mockedVerifySignature.mockReturnValue(true);
    mockedAskGemini.mockResolvedValue({
      text: "เปิด 06:00-22:00 ค่ะ",
      finishReason: "STOP",
      thoughtsTokenCount: 1,
      candidatesTokenCount: 2,
    });

    const res = await POST(request([messageEvent("เปิดกี่โมง")]));

    expect(res.status).toBe(200);
    expect(mockedReplyText).toHaveBeenCalledWith("reply-1", "เปิด 06:00-22:00 ค่ะ");
  });

  it("replies with the default message when finishReason is MAX_TOKENS", async () => {
    mockedVerifySignature.mockReturnValue(true);
    mockedAskGemini.mockResolvedValue({
      text: "ตัดข้อความ...",
      finishReason: "MAX_TOKENS",
      thoughtsTokenCount: 1,
      candidatesTokenCount: 2,
    });

    await POST(request([messageEvent("เปิดกี่โมง")]));

    expect(mockedReplyText).toHaveBeenCalledWith("reply-1", DEFAULT_REPLY);
  });

  it("replies with the default message and skips Gemini when the FAQ sheet has no cache and fails", async () => {
    mockedVerifySignature.mockReturnValue(true);
    mockedGetFaq.mockRejectedValue(new Error("sheet unavailable"));

    await POST(request([messageEvent("เปิดกี่โมง")]));

    expect(mockedAskGemini).not.toHaveBeenCalled();
    expect(mockedReplyText).toHaveBeenCalledWith("reply-1", DEFAULT_REPLY);
  });

  it("replies with the default message when Gemini errors or times out", async () => {
    mockedVerifySignature.mockReturnValue(true);
    mockedAskGemini.mockRejectedValue(new Error("timeout"));

    await POST(request([messageEvent("เปิดกี่โมง")]));

    expect(mockedReplyText).toHaveBeenCalledWith("reply-1", DEFAULT_REPLY);
  });

  it("ignores non-text message events without replying", async () => {
    mockedVerifySignature.mockReturnValue(true);

    const res = await POST(
      request([{ ...messageEvent(""), message: { type: "sticker", id: "1", packageId: "1", stickerId: "1" } }]),
    );

    expect(res.status).toBe(200);
    expect(mockedReplyText).not.toHaveBeenCalled();
  });
});
