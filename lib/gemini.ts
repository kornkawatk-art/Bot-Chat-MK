import { GoogleGenAI } from "@google/genai";
import type { GeminiResult } from "../types";
import { CODE_NEEDED_REPLY, NO_ANSWER_REPLY } from "./replies";

const MODEL = "gemini-3.5-flash-lite";

/**
 * Builds the system prompt. Order: role, constraints, output_format, faq, history, question.
 * <faq> must precede <question>, and stay near the end of the static prefix (with only the
 * per-message <history>/<question> after it) so repeated calls share a stable prefix for
 * prompt caching. <history> is per-conversation (changes every message) so it comes after
 * <faq> but before <question>; omitted entirely when there's no history yet.
 */
export function buildPrompt(faqCsv: string, question: string, history: string = ""): string {
  const historyBlock = history ? `\n\n<history>\n${history}\n</history>` : "";

  return `<role>
คุณคือแอดมินที่ดูแลตอบแชท LINE Official Account ของแม็คโคร สาขาระนอง
</role>

<constraints>
- ตอบโดยอ้างอิงข้อเท็จจริงจาก <faq> เท่านั้น ห้ามแต่งเติมราคา เวลาทำการ ที่ตั้ง โปรโมชั่น หรือรายละเอียดใดๆ ที่ไม่มีใน <faq> — แต่สามารถปรับถ้อยคำจากข้อมูลดิบใน <faq> ให้เป็นประโยคพูดคุยที่เป็นธรรมชาติได้เต็มที่ ไม่ต้องคัดลอกคำต่อคำ
- ถ้าคำถามไม่มีข้อมูลรองรับใน <faq> ให้ตอบด้วยข้อความนี้เท่านั้น: "${NO_ANSWER_REPLY}"
- ถ้าลูกค้าถามราคาหรือสต็อกของสินค้าชิ้นใดชิ้นหนึ่ง แต่ไม่ได้พิมพ์รหัสสินค้ามาเป็นข้อความเดี่ยวๆ (ราคา/สต็อกสินค้าไม่ได้อยู่ใน <faq> — ต้องเช็คจากรหัสสินค้าเท่านั้น) ให้ตอบด้วยข้อความนี้เท่านั้น: "${CODE_NEEDED_REPLY}"
- ถ้ามีประวัติการสนทนาก่อนหน้าแนบมาด้วย ให้ใช้ประกอบความเข้าใจคำถามต่อเนื่อง (เช่น "แล้วอันนี้ล่ะ") แต่กฎอื่นทั้งหมดข้างต้นยังใช้เหมือนเดิม
- โทนเป็นกันเองแต่สุภาพ เหมือนพนักงานจริงคุยกับลูกค้า ใช้คำลงท้าย "ค่ะ" ใช้ emoji ได้อย่างเหมาะสม (ไม่ถี่เกินไป)
- ความยาว: ตอบแบบเป็นธรรมชาติ กระชับแต่ไม่ห้วน ถ้าจำเป็นต้องอธิบายเพิ่ม (เช่น ขั้นตอน เงื่อนไข) สามารถตอบยาวกว่านั้นได้
</constraints>

<output_format>
ตอบเป็นภาษาเดียวกับที่ลูกค้าใช้พิมพ์ถามมาทั้งข้อความ ห้ามตอบเป็นภาษาไทยถ้าลูกค้าถามเป็นภาษาอื่น แม้ข้อความจะสั้นหรือเป็นคำทักทายก็ตาม เช่น ถ้าลูกค้าพิมพ์ "Hello" หรือคำถามเป็นภาษาอังกฤษ ต้องตอบกลับเป็นภาษาอังกฤษทั้งหมด ไม่ใช่ภาษาไทย ถ้าดูจริงๆ ไม่ออกว่าเป็นภาษาอะไร ให้ตอบเป็นภาษาไทยเป็นค่าเริ่มต้นเท่านั้น ห้ามใช้ markdown (ห้าม **, -, #, ตาราง) เพราะข้อความจะถูกส่งเป็น LINE text message ธรรมดา
</output_format>

<faq>
${faqCsv}
</faq>${historyBlock}

<question>
${question}
</question>

อย่าลืม: ตอบเป็นภาษาเดียวกับที่ลูกค้าใช้พิมพ์ถามในข้อความข้างบน ห้ามตอบเป็นภาษาไทยถ้าคำถามเป็นภาษาอื่น`;
}

interface GenerateContentClient {
  models: {
    generateContent: (params: {
      model: string;
      contents: string;
      config: { temperature: number; maxOutputTokens: number; abortSignal?: AbortSignal };
    }) => Promise<{
      text?: string;
      candidates?: Array<{ finishReason?: string }>;
      usageMetadata?: { thoughtsTokenCount?: number; candidatesTokenCount?: number };
    }>;
  };
}

let defaultClient: GenerateContentClient | null = null;
function getDefaultClient(): GenerateContentClient {
  if (!defaultClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY not set");
    defaultClient = new GoogleGenAI({ apiKey });
  }
  return defaultClient;
}

/** Calls Gemini and logs finishReason/token counts on every call. temperature stays 1.0 — do not change. */
export async function askGemini(
  prompt: string,
  client: GenerateContentClient = getDefaultClient(),
  abortSignal?: AbortSignal,
): Promise<GeminiResult> {
  const response = await client.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: { temperature: 1.0, maxOutputTokens: 1024, abortSignal },
  });

  const finishReason = response.candidates?.[0]?.finishReason ?? "UNKNOWN";
  const thoughtsTokenCount = response.usageMetadata?.thoughtsTokenCount ?? 0;
  const candidatesTokenCount = response.usageMetadata?.candidatesTokenCount ?? 0;

  console.log(
    JSON.stringify({
      level: "info",
      msg: "gemini_call",
      finishReason,
      thoughtsTokenCount,
      candidatesTokenCount,
    }),
  );

  return { text: response.text ?? "", finishReason, thoughtsTokenCount, candidatesTokenCount };
}
