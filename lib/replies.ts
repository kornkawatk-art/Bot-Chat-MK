export const DEFAULT_REPLY =
  "ขอบคุณที่ทักมานะคะ ตอนนี้ระบบขัดข้องชั่วคราว รบกวนรอสักครู่แล้วทักมาใหม่อีกครั้งนะคะ 🙏";

/**
 * The exact reply Gemini is instructed to send verbatim when nothing in the FAQ answers the
 * question (see buildPrompt's <constraints>). Used elsewhere to detect that case by exact match,
 * so it must stay in sync with the wording baked into the system prompt.
 */
export const NO_ANSWER_REPLY = "ขอบคุณที่ทักมานะคะ เรื่องนี้ขอให้แอดมินตัวจริงช่วยตอบอีกทีนะคะ 🙏";
