import { messagingApi, validateSignature } from "@line/bot-sdk";

/** Verifies the x-line-signature header against the raw request body. */
export function verifySignature(body: string, signature: string | null, channelSecret: string): boolean {
  if (!signature) return false;
  return validateSignature(body, channelSecret, signature);
}

interface ReplyClient {
  replyMessage: (params: { replyToken: string; messages: Array<{ type: "text"; text: string }> }) => Promise<unknown>;
}

interface PushClient {
  pushMessage: (params: {
    to: string;
    messages: Array<{ type: "text"; text: string }>;
  }) => Promise<{ sentMessages: Array<{ id: string }> }>;
}

interface ProfileClient {
  getProfile: (userId: string) => Promise<{ userId: string; displayName: string }>;
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

/** Pushes a single text message to a user, group, or room id (unprompted, unlike replyText). Returns the sent message's id. */
export async function pushText(to: string, text: string, client: PushClient = getDefaultClient()): Promise<string> {
  const result = await client.pushMessage({ to, messages: [{ type: "text", text }] });
  return result.sentMessages[0].id;
}

export async function getProfile(
  userId: string,
  client: ProfileClient = getDefaultClient(),
): Promise<{ userId: string; displayName: string }> {
  return client.getProfile(userId);
}
