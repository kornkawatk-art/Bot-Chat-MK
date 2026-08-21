import { describe, expect, it, vi } from "vitest";
import { askGemini, buildPrompt } from "./gemini";

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

  it("includes the required role, constraints and output_format sections", () => {
    const prompt = buildPrompt("faq-content", "question-content");

    expect(prompt).toContain("<role>");
    expect(prompt).toContain("<constraints>");
    expect(prompt).toContain("<output_format>");
    expect(prompt).toContain("แม็คโคร สาขาระนอง");
  });
});

describe("askGemini", () => {
  function fakeClient(response: unknown) {
    return { models: { generateContent: vi.fn().mockResolvedValue(response) } };
  }

  it("calls gemini-3.5-flash with temperature 1.0 and maxOutputTokens 1024", async () => {
    const client = fakeClient({
      text: "hello",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { thoughtsTokenCount: 5, candidatesTokenCount: 10 },
    });

    await askGemini("some prompt", client);

    expect(client.models.generateContent).toHaveBeenCalledWith({
      model: "gemini-3.5-flash",
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
