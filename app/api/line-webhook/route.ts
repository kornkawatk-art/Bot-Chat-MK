import { NextResponse } from "next/server";
import type { webhook } from "@line/bot-sdk";
import { notifyAdmin } from "../../../lib/admin-notify";
import { formatFaqCsv } from "../../../lib/csv";
import { askGemini, buildPrompt } from "../../../lib/gemini";
import { replyText, verifySignature } from "../../../lib/line";
import { buildProductReply, getProducts, isProductCode } from "../../../lib/products";
import { DEFAULT_REPLY, NO_ANSWER_REPLY, PRODUCT_NOT_FOUND_REPLY } from "../../../lib/replies";
import { appendToHistory, formatHistory, getHistory } from "../../../lib/session";
import { getFaq } from "../../../lib/sheet";

export const maxDuration = 10;

const GEMINI_TIMEOUT_MS = 8_000;

const NON_TEXT_MESSAGE_LABELS: Record<string, string> = {
  image: "รูปภาพ",
  video: "วิดีโอ",
  audio: "ข้อความเสียง",
  sticker: "สติกเกอร์",
  file: "ไฟล์",
  location: "ตำแหน่งที่ตั้ง",
};

function log(level: "info" | "warn" | "error", msg: string, fields: Record<string, unknown>) {
  const write = level === "info" ? console.log : level === "warn" ? console.warn : console.error;
  write(JSON.stringify({ level, msg, timestamp: new Date().toISOString(), ...fields }));
}

export async function POST(request: Request): Promise<Response> {
  // Raw text first: signature must be verified against the exact bytes LINE sent, before any JSON parsing.
  const body = await request.text();
  const signature = request.headers.get("x-line-signature");
  const channelSecret = process.env.LINE_CHANNEL_SECRET ?? "";

  if (!verifySignature(body, signature, channelSecret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: webhook.CallbackRequest;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  await Promise.all(
    payload.events.map((event) =>
      handleEvent(event).catch((err) => {
        log("error", "handle_event_failed", { error: String(err) });
      }),
    ),
  );

  return NextResponse.json({}, { status: 200 });
}

async function handleEvent(event: webhook.Event): Promise<void> {
  if (event.type === "join") {
    await handleJoinEvent(event);
    return;
  }

  if (event.type !== "message" || !event.replyToken) return;

  const replyToken = event.replyToken;
  const userId = event.source?.type === "user" ? event.source.userId : undefined;

  if (event.message.type !== "text") {
    const label = NON_TEXT_MESSAGE_LABELS[event.message.type] ?? "ข้อความ";
    await replyText(replyToken, NO_ANSWER_REPLY);
    await notifyAdmin(`[ลูกค้าส่ง${label}มา]`, userId);
    return;
  }

  const question = event.message.text;

  if (isProductCode(question)) {
    await handleProductLookup(replyToken, question.trim(), userId);
    return;
  }

  let faq;
  try {
    faq = await getFaq();
  } catch (err) {
    log("error", "faq_fetch_failed", { userId, question, error: String(err) });
    await replyText(replyToken, DEFAULT_REPLY);
    return;
  }

  const history = userId ? await getHistory(userId) : [];
  const prompt = buildPrompt(formatFaqCsv(faq), question, formatHistory(history));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const result = await askGemini(prompt, undefined, controller.signal);

    if (result.finishReason === "MAX_TOKENS") {
      log("warn", "gemini_max_tokens", {
        userId,
        question,
        finishReason: result.finishReason,
        thoughtsTokenCount: result.thoughtsTokenCount,
        candidatesTokenCount: result.candidatesTokenCount,
      });
      await replyText(replyToken, DEFAULT_REPLY);
      return;
    }

    log("info", "gemini_reply", {
      userId,
      question,
      finishReason: result.finishReason,
      thoughtsTokenCount: result.thoughtsTokenCount,
      candidatesTokenCount: result.candidatesTokenCount,
    });
    await replyText(replyToken, result.text);
    if (userId) {
      await appendToHistory(userId, [
        { role: "user", text: question },
        { role: "assistant", text: result.text },
      ]);
    }
    if (result.text === NO_ANSWER_REPLY) {
      await notifyAdmin(question, userId);
    }
  } catch (err) {
    log("error", "gemini_call_failed", { userId, question, error: String(err) });
    await replyText(replyToken, DEFAULT_REPLY);
  } finally {
    clearTimeout(timeout);
  }
}

async function handleProductLookup(replyToken: string, code: string, userId: string | undefined): Promise<void> {
  let products;
  try {
    products = await getProducts();
  } catch (err) {
    log("error", "products_fetch_failed", { userId, code, error: String(err) });
    await replyText(replyToken, DEFAULT_REPLY);
    return;
  }

  const product = products.get(code);
  if (!product) {
    log("warn", "product_not_found", { userId, code });
    await replyText(replyToken, PRODUCT_NOT_FOUND_REPLY);
    await notifyAdmin(`[ลูกค้าถามรหัสสินค้า ${code} แต่ไม่พบในระบบ]`, userId);
    return;
  }

  await replyText(replyToken, buildProductReply(product));
}

async function handleJoinEvent(event: webhook.Event & { type: "join" }): Promise<void> {
  if (!event.replyToken) return;
  const groupId = event.source?.type === "group" ? event.source.groupId : undefined;
  if (!groupId) return;

  await replyText(
    event.replyToken,
    `เพิ่มบอทเข้ากลุ่มนี้เรียบร้อยค่ะ\nGroup ID: ${groupId}\n\nนำ Group ID นี้ไปตั้งเป็นค่า LINE_ADMIN_GROUP_ID เพื่อเปิดใช้การแจ้งเตือนแอดมินอัตโนมัติ`,
  );
}
