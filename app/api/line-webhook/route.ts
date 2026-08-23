import { NextResponse } from "next/server";
import type { webhook } from "@line/bot-sdk";
import { notifyAdmin } from "../../../lib/admin-notify";
import {
  formatUnansweredQuestionsSummary,
  getRecentUnansweredQuestions,
  logUnansweredQuestion,
} from "../../../lib/analytics";
import { formatFaqCsv } from "../../../lib/csv";
import { acknowledgeEscalation, markEscalationAsStaff, reAlertOverdueEscalations } from "../../../lib/escalations";
import { askGemini, buildPrompt } from "../../../lib/gemini";
import { isInHandoff } from "../../../lib/handoff";
import { replyText, verifySignature } from "../../../lib/line";
import { buildProductReply, getProducts, isProductCode } from "../../../lib/products";
import { DEFAULT_REPLY, NO_ANSWER_REPLY, PRODUCT_NOT_FOUND_REPLY } from "../../../lib/replies";
import { appendToHistory, formatHistory, getHistory } from "../../../lib/session";
import { getFaq } from "../../../lib/sheet";
import { formatStaffListSummary, listStaffMembers, removeStaffMemberByIndex } from "../../../lib/staff";

export const maxDuration = 10;

const GEMINI_TIMEOUT_MS = 9_000;

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

  await Promise.all([
    reAlertOverdueEscalations(),
    ...payload.events.map((event) =>
      handleEvent(event).catch((err) => {
        log("error", "handle_event_failed", { error: String(err) });
      }),
    ),
  ]);

  return NextResponse.json({}, { status: 200 });
}

async function handleEvent(event: webhook.Event): Promise<void> {
  if (event.type === "join") {
    await handleJoinEvent(event);
    return;
  }

  if (event.type !== "message") return;

  if (event.source?.type === "group" && event.source.groupId === process.env.LINE_ADMIN_GROUP_ID) {
    await handleAdminGroupMessage(event);
    return;
  }

  if (!event.replyToken) return;

  const replyToken = event.replyToken;
  // userId identifies the individual sender on User, Group, AND Room sources alike (LINE includes
  // it on all three for message events) — narrowing to just "user" here silently dropped it for
  // anyone messaging from a group/room, breaking their memory, handoff, and escalation naming.
  const userId = event.source?.userId;

  // A human admin is actively handling this customer (they acknowledged an escalation) — stay
  // fully silent rather than risk answering on top of what the admin is already saying.
  if (userId && (await isInHandoff(userId))) return;

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
      await logUnansweredQuestion(question);
    }
  } catch (err) {
    log("error", "gemini_call_failed", { userId, question, error: String(err) });
    await replyText(replyToken, DEFAULT_REPLY);
  } finally {
    clearTimeout(timeout);
  }
}

async function handleProductLookup(replyToken: string, code: string, userId: string | undefined): Promise<void> {
  let catalog;
  try {
    catalog = await getProducts();
  } catch (err) {
    log("error", "products_fetch_failed", { userId, code, error: String(err) });
    await replyText(replyToken, DEFAULT_REPLY);
    return;
  }

  const product = catalog.products.get(code);
  if (!product) {
    log("warn", "product_not_found", { userId, code });
    await replyText(replyToken, PRODUCT_NOT_FOUND_REPLY);
    await notifyAdmin(`[ลูกค้าถามรหัสสินค้า ${code} แต่ไม่พบในระบบ]`, userId);
    return;
  }

  await replyText(replyToken, buildProductReply(product, catalog.updatedAt));
}

const SUMMARY_COMMAND = "สรุปคำถาม";
const STAFF_LIST_COMMAND = "รายชื่อพนักงาน";
const STAFF_TAG_COMMAND = "พนักงาน";
const STAFF_REMOVE_COMMAND = /^ลบพนักงาน\s+(\d+)$/;

/**
 * The admin group never gets a conversational reply from the bot (it's an alert channel, not a
 * customer chat) — the only things it responds to are the exact commands below, and a quote-reply
 * to an alert message (which either acknowledges it — starting a Handoff — or, for the exact
 * "พนักงาน" text, tags that customer as staff so future messages from them skip escalation).
 */
async function handleAdminGroupMessage(event: webhook.Event & { type: "message" }): Promise<void> {
  if (event.message.type !== "text") return;
  const text = event.message.text.trim();

  if (text === SUMMARY_COMMAND) {
    if (!event.replyToken) return;
    const entries = await getRecentUnansweredQuestions();
    await replyText(event.replyToken, formatUnansweredQuestionsSummary(entries));
    return;
  }

  if (text === STAFF_LIST_COMMAND) {
    if (!event.replyToken) return;
    const members = await listStaffMembers();
    await replyText(event.replyToken, formatStaffListSummary(members));
    return;
  }

  const removeMatch = text.match(STAFF_REMOVE_COMMAND);
  if (removeMatch) {
    if (!event.replyToken) return;
    const removed = await removeStaffMemberByIndex(Number(removeMatch[1]));
    await replyText(
      event.replyToken,
      removed ? `ลบ${removed.customerName}ออกจากลิสต์พนักงานแล้วค่ะ` : "ไม่พบรายชื่อพนักงานที่ตรงกับเลขนี้ค่ะ",
    );
    return;
  }

  const quotedMessageId = event.message.quotedMessageId;
  if (!quotedMessageId) return;

  if (text === STAFF_TAG_COMMAND) {
    if (!event.replyToken) return;
    const customerName = await markEscalationAsStaff(quotedMessageId);
    await replyText(
      event.replyToken,
      customerName ? `บันทึก${customerName}เป็นพนักงานแล้วค่ะ จะไม่แจ้งเตือนกลุ่มนี้อีก` : "ไม่พบข้อความ alert ที่ quote มาค่ะ",
    );
    return;
  }

  await acknowledgeEscalation(quotedMessageId);
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
