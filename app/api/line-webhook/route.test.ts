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
  buildPrompt: vi.fn((faqCsv: string, question: string, history?: string) => `PROMPT(${faqCsv})(${question})(${history ?? ""})`),
}));
vi.mock("../../../lib/admin-notify", () => ({
  notifyAdmin: vi.fn(),
}));
vi.mock("../../../lib/products", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/products")>();
  return { ...actual, getProducts: vi.fn() };
});
vi.mock("../../../lib/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/session")>();
  return { ...actual, getHistory: vi.fn(), appendToHistory: vi.fn() };
});
vi.mock("../../../lib/escalations", () => ({
  acknowledgeEscalation: vi.fn(),
  markEscalationAsStaff: vi.fn(),
  clearAllPendingEscalations: vi.fn(),
  reAlertOverdueEscalations: vi.fn(),
}));
vi.mock("../../../lib/handoff", () => ({
  isInHandoff: vi.fn(),
}));
vi.mock("../../../lib/analytics", () => ({
  logUnansweredQuestion: vi.fn(),
  getRecentUnansweredQuestions: vi.fn(),
  formatUnansweredQuestionsSummary: vi.fn(() => "SUMMARY"),
}));
vi.mock("../../../lib/staff", () => ({
  listStaffMembers: vi.fn(),
  formatStaffListSummary: vi.fn(() => "STAFF_SUMMARY"),
  removeStaffMemberByIndex: vi.fn(),
}));

import { notifyAdmin } from "../../../lib/admin-notify";
import {
  formatUnansweredQuestionsSummary,
  getRecentUnansweredQuestions,
  logUnansweredQuestion,
} from "../../../lib/analytics";
import {
  acknowledgeEscalation,
  clearAllPendingEscalations,
  markEscalationAsStaff,
  reAlertOverdueEscalations,
} from "../../../lib/escalations";
import { askGemini, buildPrompt } from "../../../lib/gemini";
import { isInHandoff } from "../../../lib/handoff";
import { replyText, verifySignature } from "../../../lib/line";
import { getProducts } from "../../../lib/products";
import {
  CODE_NEEDED_REPLY,
  DEFAULT_REPLY,
  NO_ANSWER_REPLY,
  NO_ANSWER_REPLY_EN,
  PRODUCT_NOT_FOUND_REPLY,
} from "../../../lib/replies";
import { appendToHistory, getHistory } from "../../../lib/session";
import { getFaq } from "../../../lib/sheet";
import { formatStaffListSummary, listStaffMembers, removeStaffMemberByIndex } from "../../../lib/staff";
import { POST } from "./route";

const mockedVerifySignature = vi.mocked(verifySignature);
const mockedReplyText = vi.mocked(replyText);
const mockedGetFaq = vi.mocked(getFaq);
const mockedAskGemini = vi.mocked(askGemini);
const mockedBuildPrompt = vi.mocked(buildPrompt);
const mockedNotifyAdmin = vi.mocked(notifyAdmin);
const mockedIsInHandoff = vi.mocked(isInHandoff);
const mockedGetProducts = vi.mocked(getProducts);
const mockedGetHistory = vi.mocked(getHistory);
const mockedAppendToHistory = vi.mocked(appendToHistory);
const mockedAcknowledgeEscalation = vi.mocked(acknowledgeEscalation);
const mockedMarkEscalationAsStaff = vi.mocked(markEscalationAsStaff);
const mockedClearAllPendingEscalations = vi.mocked(clearAllPendingEscalations);
const mockedReAlertOverdueEscalations = vi.mocked(reAlertOverdueEscalations);
const mockedLogUnansweredQuestion = vi.mocked(logUnansweredQuestion);
const mockedGetRecentUnansweredQuestions = vi.mocked(getRecentUnansweredQuestions);
const mockedFormatUnansweredQuestionsSummary = vi.mocked(formatUnansweredQuestionsSummary);
const mockedListStaffMembers = vi.mocked(listStaffMembers);
const mockedFormatStaffListSummary = vi.mocked(formatStaffListSummary);
const mockedRemoveStaffMemberByIndex = vi.mocked(removeStaffMemberByIndex);

const ADMIN_GROUP_ID = "C-admin-group";

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

function roomMessageEvent(text: string, replyToken = "reply-room") {
  return {
    type: "message",
    replyToken,
    message: { type: "text", id: "msg-room", text, quoteToken: "qt" },
    timestamp: 0,
    mode: "active",
    webhookEventId: "wh-room",
    deliveryContext: { isRedelivery: false },
    source: { type: "room", roomId: "R123", userId: "U999" },
  };
}

function adminGroupMessageEvent(text: string, quotedMessageId?: string) {
  return {
    type: "message",
    replyToken: "reply-admin",
    message: { type: "text", id: "msg-admin", text, quoteToken: "qt", quotedMessageId },
    timestamp: 0,
    mode: "active",
    webhookEventId: "wh-admin",
    deliveryContext: { isRedelivery: false },
    source: { type: "group", groupId: ADMIN_GROUP_ID, userId: "U-admin" },
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
    mockedGetHistory.mockResolvedValue([]);
    mockedIsInHandoff.mockResolvedValue(false);
    mockedGetRecentUnansweredQuestions.mockResolvedValue([]);
    delete process.env.LINE_ADMIN_GROUP_ID;
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

  it("logs the question for analytics when Gemini gives the exact no-FAQ-match reply", async () => {
    mockedVerifySignature.mockReturnValue(true);
    mockedAskGemini.mockResolvedValue({
      text: NO_ANSWER_REPLY,
      finishReason: "STOP",
      thoughtsTokenCount: 1,
      candidatesTokenCount: 2,
    });

    await POST(request([messageEvent("ราคาสินค้า X เท่าไหร่")]));

    expect(mockedLogUnansweredQuestion).toHaveBeenCalledWith("ราคาสินค้า X เท่าไหร่");
  });

  it("notifies admin when Gemini gives the exact English no-FAQ-match reply", async () => {
    mockedVerifySignature.mockReturnValue(true);
    mockedAskGemini.mockResolvedValue({
      text: NO_ANSWER_REPLY_EN,
      finishReason: "STOP",
      thoughtsTokenCount: 1,
      candidatesTokenCount: 2,
    });

    await POST(request([messageEvent("How much is product X?")]));

    expect(mockedNotifyAdmin).toHaveBeenCalledWith("How much is product X?", "U123");
    expect(mockedLogUnansweredQuestion).toHaveBeenCalledWith("How much is product X?");
  });

  it("does not log a question for analytics on a normal FAQ-backed answer", async () => {
    mockedVerifySignature.mockReturnValue(true);
    mockedAskGemini.mockResolvedValue({
      text: "เปิด 06:00-22:00 ค่ะ",
      finishReason: "STOP",
      thoughtsTokenCount: 1,
      candidatesTokenCount: 2,
    });

    await POST(request([messageEvent("เปิดกี่โมง")]));

    expect(mockedLogUnansweredQuestion).not.toHaveBeenCalled();
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

  it("replies with price, stock, and the update timestamp for a bare product code, without calling Gemini", async () => {
    mockedVerifySignature.mockReturnValue(true);
    mockedGetProducts.mockResolvedValue({
      products: new Map([["4323", { code: "4323", name: "ขนมปัง A", price: "25", stock: "40" }]]),
      updatedAt: "22 ส.ค. 2569 08:15 น.",
    });

    await POST(request([messageEvent("4323")]));

    expect(mockedReplyText).toHaveBeenCalledWith(
      "reply-1",
      "ขนมปัง A (รหัสสินค้า 4323)\nราคา 25 บาทค่ะ\nคงเหลือในสต็อก 40 ชิ้นค่ะ\n(ข้อมูล ณ 22 ส.ค. 2569 08:15 น.)",
    );
    expect(mockedAskGemini).not.toHaveBeenCalled();
  });

  it("replies not-found and notifies admin when the product code isn't in the sheet", async () => {
    mockedVerifySignature.mockReturnValue(true);
    mockedGetProducts.mockResolvedValue({ products: new Map(), updatedAt: undefined });

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

  it("fetches conversation history and passes it into the prompt", async () => {
    mockedVerifySignature.mockReturnValue(true);
    mockedGetHistory.mockResolvedValue([{ role: "user", text: "เปิดกี่โมง" }]);
    mockedAskGemini.mockResolvedValue({
      text: "เปิด 06:00-22:00 ค่ะ",
      finishReason: "STOP",
      thoughtsTokenCount: 1,
      candidatesTokenCount: 2,
    });

    await POST(request([messageEvent("แล้ววันอาทิตย์ล่ะ")]));

    expect(mockedGetHistory).toHaveBeenCalledWith("U123");
    expect(mockedBuildPrompt).toHaveBeenCalledWith(
      "category,question,answer,updated_at\n,Q1,A1,",
      "แล้ววันอาทิตย์ล่ะ",
      "ลูกค้า: เปิดกี่โมง",
    );
  });

  it("appends the question and answer to history after a normal FAQ-answered reply", async () => {
    mockedVerifySignature.mockReturnValue(true);
    mockedAskGemini.mockResolvedValue({
      text: "เปิด 06:00-22:00 ค่ะ",
      finishReason: "STOP",
      thoughtsTokenCount: 1,
      candidatesTokenCount: 2,
    });

    await POST(request([messageEvent("เปิดกี่โมง")]));

    expect(mockedAppendToHistory).toHaveBeenCalledWith("U123", [
      { role: "user", text: "เปิดกี่โมง" },
      { role: "assistant", text: "เปิด 06:00-22:00 ค่ะ" },
    ]);
  });

  it("does not append to history for MAX_TOKENS or system-error fallbacks", async () => {
    mockedVerifySignature.mockReturnValue(true);
    mockedAskGemini.mockResolvedValue({
      text: "ตัดข้อความ...",
      finishReason: "MAX_TOKENS",
      thoughtsTokenCount: 1,
      candidatesTokenCount: 2,
    });

    await POST(request([messageEvent("เปิดกี่โมง")]));

    expect(mockedAppendToHistory).not.toHaveBeenCalled();
  });

  it("does not touch history for a bare product code lookup", async () => {
    mockedVerifySignature.mockReturnValue(true);
    mockedGetProducts.mockResolvedValue({
      products: new Map([["4323", { code: "4323", name: "ขนมปัง A", price: "25", stock: "40" }]]),
      updatedAt: undefined,
    });

    await POST(request([messageEvent("4323")]));

    expect(mockedGetHistory).not.toHaveBeenCalled();
    expect(mockedAppendToHistory).not.toHaveBeenCalled();
  });

  it("checks for overdue escalations to re-alert on every request", async () => {
    mockedVerifySignature.mockReturnValue(true);

    await POST(request([]));

    expect(mockedReAlertOverdueEscalations).toHaveBeenCalledTimes(1);
  });

  describe("messages from the admin alert group", () => {
    beforeEach(() => {
      process.env.LINE_ADMIN_GROUP_ID = ADMIN_GROUP_ID;
    });

    it("never replies, calls Gemini, or does a product lookup for messages in the admin group", async () => {
      mockedVerifySignature.mockReturnValue(true);

      const res = await POST(request([adminGroupMessageEvent("4323")]));

      expect(res.status).toBe(200);
      expect(mockedReplyText).not.toHaveBeenCalled();
      expect(mockedAskGemini).not.toHaveBeenCalled();
      expect(mockedGetProducts).not.toHaveBeenCalled();
    });

    it("acknowledges the escalation when an admin quote-replies to an alert message", async () => {
      mockedVerifySignature.mockReturnValue(true);

      await POST(request([adminGroupMessageEvent("รับแล้วค่ะ", "alert-msg-1")]));

      expect(mockedAcknowledgeEscalation).toHaveBeenCalledWith("alert-msg-1");
    });

    it("does not try to acknowledge when the message isn't a quote-reply", async () => {
      mockedVerifySignature.mockReturnValue(true);

      await POST(request([adminGroupMessageEvent("สวัสดีทุกคน")]));

      expect(mockedAcknowledgeEscalation).not.toHaveBeenCalled();
    });

    it('replies with the unanswered-questions summary for the exact "สรุปคำถาม" command', async () => {
      mockedVerifySignature.mockReturnValue(true);
      const entries = [{ question: "เปิดกี่โมง", timestamp: 1000 }];
      mockedGetRecentUnansweredQuestions.mockResolvedValue(entries);

      await POST(request([adminGroupMessageEvent("สรุปคำถาม")]));

      expect(mockedGetRecentUnansweredQuestions).toHaveBeenCalled();
      expect(mockedFormatUnansweredQuestionsSummary).toHaveBeenCalledWith(entries);
      expect(mockedReplyText).toHaveBeenCalledWith("reply-admin", "SUMMARY");
    });

    it('does not treat a message merely containing "สรุปคำถาม" as the command', async () => {
      mockedVerifySignature.mockReturnValue(true);

      await POST(request([adminGroupMessageEvent("ขอสรุปคำถามหน่อยได้ไหม")]));

      expect(mockedGetRecentUnansweredQuestions).not.toHaveBeenCalled();
      expect(mockedReplyText).not.toHaveBeenCalled();
    });

    it('marks the escalation as staff and confirms by name when quote-replying "พนักงาน"', async () => {
      mockedVerifySignature.mockReturnValue(true);
      mockedMarkEscalationAsStaff.mockResolvedValue("สมชาย");

      await POST(request([adminGroupMessageEvent("พนักงาน", "alert-msg-1")]));

      expect(mockedMarkEscalationAsStaff).toHaveBeenCalledWith("alert-msg-1");
      expect(mockedAcknowledgeEscalation).not.toHaveBeenCalled();
      expect(mockedReplyText).toHaveBeenCalledWith("reply-admin", expect.stringContaining("สมชาย"));
    });

    it('replies that nothing matched when "พนักงาน" doesn\'t quote a real pending escalation', async () => {
      mockedVerifySignature.mockReturnValue(true);
      mockedMarkEscalationAsStaff.mockResolvedValue(null);

      await POST(request([adminGroupMessageEvent("พนักงาน", "alert-msg-1")]));

      expect(mockedReplyText).toHaveBeenCalledWith("reply-admin", expect.any(String));
    });

    it('does nothing for "พนักงาน" when it is not a quote-reply', async () => {
      mockedVerifySignature.mockReturnValue(true);

      await POST(request([adminGroupMessageEvent("พนักงาน")]));

      expect(mockedMarkEscalationAsStaff).not.toHaveBeenCalled();
      expect(mockedAcknowledgeEscalation).not.toHaveBeenCalled();
    });

    it('replies with the staff list summary for the exact "รายชื่อพนักงาน" command', async () => {
      mockedVerifySignature.mockReturnValue(true);
      const members = [{ userId: "U1", customerName: "สมชาย", addedAt: 0 }];
      mockedListStaffMembers.mockResolvedValue(members);

      await POST(request([adminGroupMessageEvent("รายชื่อพนักงาน")]));

      expect(mockedListStaffMembers).toHaveBeenCalled();
      expect(mockedFormatStaffListSummary).toHaveBeenCalledWith(members);
      expect(mockedReplyText).toHaveBeenCalledWith("reply-admin", "STAFF_SUMMARY");
    });

    it('removes the staff member at the given index for "ลบพนักงาน <n>"', async () => {
      mockedVerifySignature.mockReturnValue(true);
      mockedRemoveStaffMemberByIndex.mockResolvedValue({ userId: "U1", customerName: "สมชาย", addedAt: 0 });

      await POST(request([adminGroupMessageEvent("ลบพนักงาน 1")]));

      expect(mockedRemoveStaffMemberByIndex).toHaveBeenCalledWith(1);
      expect(mockedReplyText).toHaveBeenCalledWith("reply-admin", expect.stringContaining("สมชาย"));
    });

    it('replies that nothing matched when "ลบพนักงาน <n>" points at an out-of-range index', async () => {
      mockedVerifySignature.mockReturnValue(true);
      mockedRemoveStaffMemberByIndex.mockResolvedValue(null);

      await POST(request([adminGroupMessageEvent("ลบพนักงาน 99")]));

      expect(mockedReplyText).toHaveBeenCalledWith("reply-admin", expect.any(String));
    });

    it('clears all pending escalations and confirms the count for the exact "ล้าง escalation ค้าง" command', async () => {
      mockedVerifySignature.mockReturnValue(true);
      mockedClearAllPendingEscalations.mockResolvedValue(3);

      await POST(request([adminGroupMessageEvent("ล้าง escalation ค้าง")]));

      expect(mockedClearAllPendingEscalations).toHaveBeenCalled();
      expect(mockedReplyText).toHaveBeenCalledWith("reply-admin", expect.stringContaining("3"));
    });
  });

  describe("customer in an active human handoff", () => {
    it("stays completely silent for a normal question", async () => {
      mockedVerifySignature.mockReturnValue(true);
      mockedIsInHandoff.mockResolvedValue(true);

      const res = await POST(request([messageEvent("เปิดกี่โมง")]));

      expect(res.status).toBe(200);
      expect(mockedReplyText).not.toHaveBeenCalled();
      expect(mockedAskGemini).not.toHaveBeenCalled();
    });

    it("stays silent for a bare product code lookup too", async () => {
      mockedVerifySignature.mockReturnValue(true);
      mockedIsInHandoff.mockResolvedValue(true);

      await POST(request([messageEvent("4323")]));

      expect(mockedReplyText).not.toHaveBeenCalled();
      expect(mockedGetProducts).not.toHaveBeenCalled();
    });

    it("stays silent instead of escalating for a non-text message", async () => {
      mockedVerifySignature.mockReturnValue(true);
      mockedIsInHandoff.mockResolvedValue(true);

      await POST(
        request([{ ...messageEvent(""), message: { type: "sticker", id: "1", packageId: "1", stickerId: "1" } }]),
      );

      expect(mockedReplyText).not.toHaveBeenCalled();
      expect(mockedNotifyAdmin).not.toHaveBeenCalled();
    });

    it("checks handoff status using the customer's userId", async () => {
      mockedVerifySignature.mockReturnValue(true);

      await POST(request([messageEvent("เปิดกี่โมง")]));

      expect(mockedIsInHandoff).toHaveBeenCalledWith("U123");
    });
  });

  it("extracts the sender's userId even when the message comes from a room/group source", async () => {
    mockedVerifySignature.mockReturnValue(true);
    mockedGetHistory.mockResolvedValue([{ role: "user", text: "เปิดกี่โมง" }]);
    mockedAskGemini.mockResolvedValue({
      text: "เปิด 06:00-22:00 ค่ะ",
      finishReason: "STOP",
      thoughtsTokenCount: 1,
      candidatesTokenCount: 2,
    });

    await POST(request([roomMessageEvent("แล้ววันอาทิตย์ล่ะ")]));

    expect(mockedIsInHandoff).toHaveBeenCalledWith("U999");
    expect(mockedGetHistory).toHaveBeenCalledWith("U999");
    expect(mockedAppendToHistory).toHaveBeenCalledWith("U999", expect.anything());
  });
});
