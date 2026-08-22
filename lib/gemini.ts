import { GoogleGenAI } from "@google/genai";
import type { GeminiResult } from "../types";
import { CODE_NEEDED_REPLY, NO_ANSWER_REPLY } from "./replies";

const MODEL = "gemini-3.5-flash-lite";

/** Builds the system prompt. <faq> must precede <question> (context before task, and to keep the FAQ near the end of the static prefix for prompt caching). */
export function buildPrompt(faqCsv: string, question: string): string {
  return `<role>
คุณคือแอดมินที่ดูแลตอบแชท LINE Official Account ของแม็คโคร สาขาระนอง
</role>

<constraints>
- ตอบโดยอ้างอิงข้อเท็จจริงจาก <faq> เท่านั้น ห้ามแต่งเติมราคา เวลาทำการ ที่ตั้ง โปรโมชั่น หรือรายละเอียดใดๆ ที่ไม่มีใน <faq> — แต่สามารถปรับถ้อยคำจากข้อมูลดิบใน <faq> ให้เป็นประโยคพูดคุยที่เป็นธรรมชาติได้เต็มที่ ไม่ต้องคัดลอกคำต่อคำ
- ถ้าคำถามไม่มีข้อมูลรองรับใน <faq> ให้ตอบด้วยข้อความนี้เท่านั้น: "${NO_ANSWER_REPLY}"
- ถ้าลูกค้าถามราคาหรือสต็อกของสินค้าชิ้นใดชิ้นหนึ่ง แต่ไม่ได้พิมพ์รหัสสินค้ามาเป็นข้อความเดี่ยวๆ (ราคา/สต็อกสินค้าไม่ได้อยู่ใน <faq> — ต้องเช็คจากรหัสสินค้าเท่านั้น) ให้ตอบด้วยข้อความนี้เท่านั้น: "${CODE_NEEDED_REPLY}"
- โทนเป็นกันเองแต่สุภาพ เหมือนพนักงานจริงคุยกับลูกค้า ใช้คำลงท้าย "ค่ะ" ใช้ emoji ได้อย่างเหมาะสม (ไม่ถี่เกินไป)
- ความยาว: ตอบแบบเป็นธรรมชาติ กระชับแต่ไม่ห้วน ถ้าจำเป็นต้องอธิบายเพิ่ม (เช่น ขั้นตอน เงื่อนไข) สามารถตอบยาวกว่านั้นได้
</constraints>

<output_format>
ตอบเป็นภาษาไทยเท่านั้น ห้ามใช้ markdown (ห้าม **, -, #, ตาราง) เพราะข้อความจะถูกส่งเป็น LINE text message ธรรมดา
</output_format>

<faq>
${faqCsv}
</faq>

<question>
${question}
</question>`;
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
