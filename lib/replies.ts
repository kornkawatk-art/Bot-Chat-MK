export const DEFAULT_REPLY =
  "ขอบคุณที่ทักมานะคะ ตอนนี้ระบบขัดข้องชั่วคราว รบกวนรอสักครู่แล้วทักมาใหม่อีกครั้งนะคะ 🙏";

/**
 * The exact reply Gemini is instructed to send verbatim when nothing in the FAQ answers the
 * question (see buildPrompt's <constraints>). Used elsewhere to detect that case by exact match,
 * so it must stay in sync with the wording baked into the system prompt.
 */
export const NO_ANSWER_REPLY = "ขอบคุณที่ทักมานะคะ เรื่องนี้ขอให้แอดมินตัวจริงช่วยตอบอีกทีนะคะ 🙏";

/** English counterpart of NO_ANSWER_REPLY, used when the customer's question was in English. */
export const NO_ANSWER_REPLY_EN = "Thanks for reaching out! For this one, let me have a member of our team get back to you shortly. 🙏";

/**
 * The exact reply Gemini is instructed to send verbatim when the customer asks about a product's
 * price or stock without sending a bare product code (see buildPrompt's <constraints>). Detected
 * elsewhere by exact match, same as NO_ANSWER_REPLY — must stay in sync with the system prompt.
 */
export const CODE_NEEDED_REPLY =
  "รบกวนพิมพ์รหัสสินค้าเดี่ยวๆ มาเลยนะคะ (ไม่ต้องมีคำอื่นปน) เดี๋ยวเช็คราคาและสต็อกให้ค่ะ 🙏";

/** English counterpart of CODE_NEEDED_REPLY, used when the customer's question was in English. */
export const CODE_NEEDED_REPLY_EN =
  "Could you send just the product code by itself (no other text)? I'll check the price and stock for you right away. 🙏";

/** Sent when a customer sends a bare product code that isn't found in the product list. */
export const PRODUCT_NOT_FOUND_REPLY =
  "ไม่พบสินค้ารหัสนี้ค่ะ รบกวนตรวจสอบรหัสอีกครั้ง หรือรอแอดมินตรวจสอบให้นะคะ 🙏";
