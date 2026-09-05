import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { getGroupSummary, getProfile, pushText, replyText, verifySignature } from "./line";

const SECRET = "test-channel-secret";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

describe("verifySignature", () => {
  it("returns true for a signature computed from the same body and secret", () => {
    const body = '{"events":[]}';

    expect(verifySignature(body, sign(body, SECRET), SECRET)).toBe(true);
  });

  it("returns false when the body was tampered with", () => {
    const body = '{"events":[]}';
    const signature = sign(body, SECRET);

    expect(verifySignature('{"events":["tampered"]}', signature, SECRET)).toBe(false);
  });

  it("returns false when the signature header is missing", () => {
    expect(verifySignature('{"events":[]}', null, SECRET)).toBe(false);
  });
});

describe("replyText", () => {
  it("sends a single text message to the given replyToken", async () => {
    const client = { replyMessage: vi.fn().mockResolvedValue({}) };

    await replyText("reply-token-123", "สวัสดีค่ะ", client);

    expect(client.replyMessage).toHaveBeenCalledWith({
      replyToken: "reply-token-123",
      messages: [{ type: "text", text: "สวัสดีค่ะ" }],
    });
  });
});

describe("pushText", () => {
  it("sends a single text message to the given target id", async () => {
    const client = { pushMessage: vi.fn().mockResolvedValue({ sentMessages: [{ id: "msg-1" }] }) };

    await pushText("group-123", "แจ้งเตือนค่ะ", client);

    expect(client.pushMessage).toHaveBeenCalledWith({
      to: "group-123",
      messages: [{ type: "text", text: "แจ้งเตือนค่ะ" }],
    });
  });

  it("returns the id of the sent message", async () => {
    const client = { pushMessage: vi.fn().mockResolvedValue({ sentMessages: [{ id: "msg-1" }] }) };

    const messageId = await pushText("group-123", "แจ้งเตือนค่ะ", client);

    expect(messageId).toBe("msg-1");
  });
});

describe("getProfile", () => {
  it("returns the profile for the given userId", async () => {
    const profile = { userId: "U123", displayName: "สมชาย" };
    const client = { getProfile: vi.fn().mockResolvedValue(profile) };

    const result = await getProfile("U123", client);

    expect(client.getProfile).toHaveBeenCalledWith("U123");
    expect(result).toEqual(profile);
  });
});

describe("getGroupSummary", () => {
  it("returns the group summary for the given groupId", async () => {
    const summary = { groupId: "G123", groupName: "กลุ่มลูกค้า A", pictureUrl: undefined };
    const client = { getGroupSummary: vi.fn().mockResolvedValue(summary) };

    const result = await getGroupSummary("G123", client);

    expect(client.getGroupSummary).toHaveBeenCalledWith("G123");
    expect(result).toEqual(summary);
  });
});
