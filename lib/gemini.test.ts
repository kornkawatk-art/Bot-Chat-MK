import { describe, expect, it, vi } from "vitest";
import { askGemini, buildPrompt } from "./gemini";
import { CODE_NEEDED_REPLY, CODE_NEEDED_REPLY_EN, NO_ANSWER_REPLY, NO_ANSWER_REPLY_EN } from "./replies";

describe("buildPrompt", () => {
  it("embeds the FAQ CSV and the question inside the system prompt", () => {
    const prompt = buildPrompt("category,question,answer\nA,B,C", "เปิดกี่โมง");

    expect(prompt).toContain("category,question,answer\nA,B,C");
    expect(prompt).toContain("เปิดกี่โมง");
  });

  it("places <faq> before <question>", () => {
    const prompt = buildPrompt("faq-content", "question-content");

    expect(prompt.indexOf("<faq>")).toBeLessThan(prompt.indexOf("<question>"));
  });

  it("omits the <history> block entirely when there is no history", () => {
    const prompt = buildPrompt("faq-content", "question-content");

    expect(prompt).not.toContain("<history>");
  });

  it("embeds non-empty history between <faq> and <question>", () => {
    const prompt = buildPrompt("faq-content", "question-content", "ลูกค้า: เปิดกี่โมง\nแอดมิน: 06:00-22:00 ค่ะ");

    expect(prompt).toContain("<history>");
    expect(prompt).toContain("ลูกค้า: เปิดกี่โมง");
    expect(prompt.indexOf("<faq>")).toBeLessThan(prompt.indexOf("<history>"));
    expect(prompt.indexOf("<history>")).toBeLessThan(prompt.indexOf("<question>"));
  });

  it("includes the required role, constraints and output_format sections", () => {
    const prompt = buildPrompt("faq-content", "question-content");

    expect(prompt).toContain("<role>");
    expect(prompt).toContain("<constraints>");
    expect(prompt).toContain("<output_format>");
    expect(prompt).toContain("แม็คโคร สาขาระนอง");
  });

  it("instructs the model to reply with the exact NO_ANSWER_REPLY text when the FAQ has no match", () => {
    const prompt = buildPrompt("faq-content", "question-content");

    expect(prompt).toContain(NO_ANSWER_REPLY);
  });

  it("permits rephrasing FAQ answers into natural sentences instead of copying them verbatim", () => {
    const prompt = buildPrompt("faq-content", "question-content");

    expect(prompt).toContain("ปรับถ้อยคำ");
    expect(prompt).not.toContain("ตอบให้กระชับที่สุดเท่าที่จะทำได้");
  });

  it("instructs the model to answer in the customer's own language instead of Thai-only", () => {
    const prompt = buildPrompt("faq-content", "question-content");

    expect(prompt).toContain("ภาษาเดียวกับ");
    expect(prompt).not.toContain("ตอบเป็นภาษาไทยเท่านั้น");
  });

  it("gives a concrete example so a short English greeting isn't answered in Thai", () => {
    const prompt = buildPrompt("faq-content", "question-content");

    expect(prompt).toContain("Hello");
    expect(prompt).toContain("ห้ามตอบเป็นภาษาไทย");
  });

  it("repeats the language instruction after <question> so it stays fresh for the model", () => {
    const prompt = buildPrompt("faq-content", "question-content");
    const questionIdx = prompt.indexOf("<question>");
    const reminderIdx = prompt.indexOf("ภาษาเดียวกับ", questionIdx);

    expect(reminderIdx).toBeGreaterThan(questionIdx);
  });

  it("instructs the model to reply with the exact CODE_NEEDED_REPLY text for a price/stock question without a bare product code", () => {
    const prompt = buildPrompt("faq-content", "question-content");

    expect(prompt).toContain(CODE_NEEDED_REPLY);
  });

  it("instructs the model to use the English NO_ANSWER_REPLY_EN when the question is in English", () => {
    const prompt = buildPrompt("faq-content", "question-content");

    expect(prompt).toContain(NO_ANSWER_REPLY_EN);
  });

  it("instructs the model to use the English CODE_NEEDED_REPLY_EN when the question is in English", () => {
    const prompt = buildPrompt("faq-content", "question-content");

    expect(prompt).toContain(CODE_NEEDED_REPLY_EN);
  });
});

describe("askGemini", () => {
  function fakeClient(response: unknown) {
    return { models: { generateContent: vi.fn().mockResolvedValue(response) } };
  }

  it("calls gemini-3.5-flash-lite with temperature 1.0 and maxOutputTokens 1024", async () => {
    const client = fakeClient({
      text: "hello",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { thoughtsTokenCount: 5, candidatesTokenCount: 10 },
    });

    await askGemini("some prompt", client);

    expect(client.models.generateContent).toHaveBeenCalledWith({
      model: "gemini-3.5-flash-lite",
      contents: "some prompt",
      config: expect.objectContaining({ temperature: 1.0, maxOutputTokens: 1024 }),
    });
  });

  it("returns text, finishReason and token counts from the response", async () => {
    const client = fakeClient({
      text: "hello there",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { thoughtsTokenCount: 5, candidatesTokenCount: 10 },
    });

    const result = await askGemini("some prompt", client);

    expect(result).toEqual({
      text: "hello there",
      finishReason: "STOP",
      thoughtsTokenCount: 5,
      candidatesTokenCount: 10,
    });
  });

  it("defaults token counts to 0 when usageMetadata is missing", async () => {
    const client = fakeClient({ text: "hi", candidates: [{ finishReason: "STOP" }] });

    const result = await askGemini("some prompt", client);

    expect(result.thoughtsTokenCount).toBe(0);
    expect(result.candidatesTokenCount).toBe(0);
  });

  it("reports finishReason UNKNOWN when there are no candidates", async () => {
    const client = fakeClient({ text: "" });

    const result = await askGemini("some prompt", client);

    expect(result.finishReason).toBe("UNKNOWN");
  });

  it("passes the abort signal through to generateContent when given", async () => {
    const client = fakeClient({ text: "hi", candidates: [{ finishReason: "STOP" }] });
    const controller = new AbortController();

    await askGemini("some prompt", client, controller.signal);

    expect(client.models.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ abortSignal: controller.signal }) }),
    );
  });
});
