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
vi.mock("../../../lib/admin-notify", () => ({
  notifyAdmin: vi.fn(),
}));
vi.mock("../../../lib/products", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/products")>();
  return { ...actual, getProducts: vi.fn() };
});

import { notifyAdmin } from "../../../lib/admin-notify";
import { askGemini } from "../../../lib/gemini";
import { replyText, verifySignature } from "../../../lib/line";
import { getProducts } from "../../../lib/products";
import { CODE_NEEDED_REPLY, DEFAULT_REPLY, NO_ANSWER_REPLY, PRODUCT_NOT_FOUND_REPLY } from "../../../lib/replies";
import { getFaq } from "../../../lib/sheet";
import { POST } from "./route";

const mockedVerifySignature = vi.mocked(verifySignature);
const mockedReplyText = vi.mocked(replyText);
const mockedGetFaq = vi.mocked(getFaq);
const mockedAskGemini = vi.mocked(askGemini);
const mockedNotifyAdmin = vi.mocked(notifyAdmin);
const mockedGetProducts = vi.mocked(getProducts);

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

  it("replies with the fallback and notifies admin (with a placeholder) for non-text message events", async () => {
    mockedVerifySignature.mockReturnValue(true);

    const res = await POST(
      request([{ ...messageEvent(""), message: { type: "sticker", id: "1", packageId: "1", stickerId: "1" } }]),
    );

    expect(res.status).toBe(200);
    expect(mockedReplyText).toHaveBeenCalledWith("reply-1", NO_ANSWER_REPLY);
    expect(mockedNotifyAdmin).toHaveBeenCalledWith("[ลูกค้าส่งสติกเกอร์มา]", "U123");
    expect(mockedAskGemini).not.toHaveBeenCalled();
  });

  it("notifies admin when Gemini gives the exact no-FAQ-match reply", async () => {
    mockedVerifySignature.mockReturnValue(true);
    mockedAskGemini.mockResolvedValue({
      text: NO_ANSWER_REPLY,
      finishReason: "STOP",
      thoughtsTokenCount: 1,
      candidatesTokenCount: 2,
    });

    await POST(request([messageEvent("ราคาสินค้า X เท่าไหร่")]));

    expect(mockedNotifyAdmin).toHaveBeenCalledWith("ราคาสินค้า X เท่าไหร่", "U123");
  });

  it("does not notify admin for a normal FAQ-backed answer", async () => {
    mockedVerifySignature.mockReturnValue(true);
    mockedAskGemini.mockResolvedValue({
      text: "เปิด 06:00-22:00 ค่ะ",
      finishReason: "STOP",
      thoughtsTokenCount: 1,
      candidatesTokenCount: 2,
    });

    await POST(request([messageEvent("เปิดกี่โมง")]));

    expect(mockedNotifyAdmin).not.toHaveBeenCalled();
  });

  it("does not notify admin for MAX_TOKENS or system-error fallbacks", async () => {
    mockedVerifySignature.mockReturnValue(true);
    mockedAskGemini.mockResolvedValue({
      text: "ตัดข้อความ...",
      finishReason: "MAX_TOKENS",
      thoughtsTokenCount: 1,
      candidatesTokenCount: 2,
    });

    await POST(request([messageEvent("เปิดกี่โมง")]));

    expect(mockedNotifyAdmin).not.toHaveBeenCalled();
  });

  it("replies with the group id when the bot is added to a group", async () => {
    mockedVerifySignature.mockReturnValue(true);

    const res = await POST(
      request([
        {
          type: "join",
          replyToken: "reply-join",
          timestamp: 0,
          mode: "active",
          webhookEventId: "wh2",
          deliveryContext: { isRedelivery: false },
          source: { type: "group", groupId: "C123456" },
        },
      ]),
    );

    expect(res.status).toBe(200);
    expect(mockedReplyText).toHaveBeenCalledWith("reply-join", expect.stringContaining("C123456"));
  });

  it("replies with price and stock for a bare product code, without calling Gemini", async () => {
    mockedVerifySignature.mockReturnValue(true);
    mockedGetProducts.mockResolvedValue(
      new Map([["4323", { code: "4323", name: "ขนมปัง A", price: "25", stock: "40" }]]),
    );

    await POST(request([messageEvent("4323")]));

    expect(mockedReplyText).toHaveBeenCalledWith("reply-1", "ขนมปัง A (รหัสสินค้า 4323)\nราคา 25 บาทค่ะ\nคงเหลือในสต็อก 40 ชิ้นค่ะ");
    expect(mockedAskGemini).not.toHaveBeenCalled();
  });

  it("replies not-found and notifies admin when the product code isn't in the sheet", async () => {
    mockedVerifySignature.mockReturnValue(true);
    mockedGetProducts.mockResolvedValue(new Map());

    await POST(request([messageEvent("999999")]));

    expect(mockedReplyText).toHaveBeenCalledWith("reply-1", PRODUCT_NOT_FOUND_REPLY);
    expect(mockedNotifyAdmin).toHaveBeenCalledWith(expect.stringContaining("999999"), "U123");
    expect(mockedAskGemini).not.toHaveBeenCalled();
  });

  it("replies with the default message when the product sheet can't be fetched", async () => {
    mockedVerifySignature.mockReturnValue(true);
    mockedGetProducts.mockRejectedValue(new Error("sheet unavailable"));

    await POST(request([messageEvent("4323")]));

    expect(mockedReplyText).toHaveBeenCalledWith("reply-1", DEFAULT_REPLY);
    expect(mockedNotifyAdmin).not.toHaveBeenCalled();
  });

  it("replies with CODE_NEEDED_REPLY without notifying admin when Gemini asks for a code", async () => {
    mockedVerifySignature.mockReturnValue(true);
    mockedAskGemini.mockResolvedValue({
      text: CODE_NEEDED_REPLY,
      finishReason: "STOP",
      thoughtsTokenCount: 1,
      candidatesTokenCount: 2,
    });

    await POST(request([messageEvent("ขนมปัง A ราคาเท่าไหร่")]));

    expect(mockedReplyText).toHaveBeenCalledWith("reply-1", CODE_NEEDED_REPLY);
    expect(mockedNotifyAdmin).not.toHaveBeenCalled();
  });
});
