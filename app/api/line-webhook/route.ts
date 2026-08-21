import { NextResponse } from "next/server";
import type { webhook } from "@line/bot-sdk";
import { formatFaqCsv } from "../../../lib/csv";
import { askGemini, buildPrompt } from "../../../lib/gemini";
import { replyText, verifySignature } from "../../../lib/line";
import { DEFAULT_REPLY } from "../../../lib/replies";
import { getFaq } from "../../../lib/sheet";

export const maxDuration = 10;

const GEMINI_TIMEOUT_MS = 8_000;

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
  if (event.type !== "message" || event.message.type !== "text" || !event.replyToken) return;

  const replyToken = event.replyToken;
  const question = event.message.text;
  const userId = event.source?.type === "user" ? event.source.userId : undefined;

  let faq;
  try {
    faq = await getFaq();
  } catch (err) {
    log("error", "faq_fetch_failed", { userId, question, error: String(err) });
    await replyText(replyToken, DEFAULT_REPLY);
    return;
  }

  const prompt = buildPrompt(formatFaqCsv(faq), question);
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
  } catch (err) {
    log("error", "gemini_call_failed", { userId, question, error: String(err) });
    await replyText(replyToken, DEFAULT_REPLY);
  } finally {
    clearTimeout(timeout);
  }
}
