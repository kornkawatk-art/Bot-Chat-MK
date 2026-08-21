import { messagingApi, validateSignature } from "@line/bot-sdk";

/** Verifies the x-line-signature header against the raw request body. */
export function verifySignature(body: string, signature: string | null, channelSecret: string): boolean {
  if (!signature) return false;
  return validateSignature(body, channelSecret, signature);
}

interface ReplyClient {
  replyMessage: (params: { replyToken: string; messages: Array<{ type: "text"; text: string }> }) => Promise<unknown>;
}

let defaultClient: messagingApi.MessagingApiClient | null = null;
function getDefaultClient(): messagingApi.MessagingApiClient {
  if (!defaultClient) {
    const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!channelAccessToken) throw new Error("LINE_CHANNEL_ACCESS_TOKEN not set");
    defaultClient = new messagingApi.MessagingApiClient({ channelAccessToken });
  }
  return defaultClient;
}

export async function replyText(
  replyToken: string,
  text: string,
  client: ReplyClient = getDefaultClient(),
): Promise<void> {
  await client.replyMessage({ replyToken, messages: [{ type: "text", text }] });
}
