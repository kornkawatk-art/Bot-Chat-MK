import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAdminNotification, formatThaiTimestamp, notifyAdmin } from "./admin-notify";

describe("formatThaiTimestamp", () => {
  it("formats a UTC instant as Bangkok local time with a Buddhist-era year", () => {
    const date = new Date("2026-08-21T08:32:00Z"); // 15:32 in Asia/Bangkok (UTC+7)

    expect(formatThaiTimestamp(date)).toBe("21 ส.ค. 2569 15:32");
  });

  it("zero-pads single-digit hours and minutes", () => {
    const date = new Date("2026-01-05T01:05:00Z"); // 08:05 in Asia/Bangkok

    expect(formatThaiTimestamp(date)).toBe("5 ม.ค. 2569 08:05");
  });
});

describe("buildAdminNotification", () => {
  it("renders the customer name, timestamp and question into the template", () => {
    const message = buildAdminNotification({
      customerName: "สมชาย",
      question: "เปิดกี่โมง",
      timestamp: new Date("2026-08-21T08:32:00Z"),
    });

    expect(message).toBe(
      '🔔 คำถามที่บอทตอบไม่ได้\n\nจาก: สมชาย\nเวลา: 21 ส.ค. 2569 15:32\n\nคำถาม: "เปิดกี่โมง"\n\nรบกวนแอดมินตอบลูกค้าใน LINE OA Manager ด้วยค่ะ',
    );
  });
});

describe("notifyAdmin", () => {
  const now = () => new Date("2026-08-21T08:32:00Z");

  beforeEach(() => {
    process.env.LINE_ADMIN_GROUP_ID = "group-123";
  });

  afterEach(() => {
    delete process.env.LINE_ADMIN_GROUP_ID;
  });

  it("does nothing when LINE_ADMIN_GROUP_ID is not configured", async () => {
    delete process.env.LINE_ADMIN_GROUP_ID;
    const pushTextFn = vi.fn().mockResolvedValue("msg-1");
    const getProfileFn = vi.fn();

    await notifyAdmin("เปิดกี่โมง", "U123", { pushTextFn, getProfileFn, now });

    expect(pushTextFn).not.toHaveBeenCalled();
  });

  it("pushes to the configured group using the customer's display name", async () => {
    const pushTextFn = vi.fn().mockResolvedValue("msg-1");
    const getProfileFn = vi.fn().mockResolvedValue({ userId: "U123", displayName: "สมชาย" });

    await notifyAdmin("เปิดกี่โมง", "U123", { pushTextFn, getProfileFn, now });

    expect(getProfileFn).toHaveBeenCalledWith("U123");
    expect(pushTextFn).toHaveBeenCalledWith(
      "group-123",
      '🔔 คำถามที่บอทตอบไม่ได้\n\nจาก: สมชาย\nเวลา: 21 ส.ค. 2569 15:32\n\nคำถาม: "เปิดกี่โมง"\n\nรบกวนแอดมินตอบลูกค้าใน LINE OA Manager ด้วยค่ะ',
    );
  });

  it("falls back to a short userId label when the profile lookup fails", async () => {
    const pushTextFn = vi.fn().mockResolvedValue("msg-1");
    const getProfileFn = vi.fn().mockRejectedValue(new Error("profile unavailable"));

    await notifyAdmin("เปิดกี่โมง", "U1234567890123456", { pushTextFn, getProfileFn, now });

    const [, message] = pushTextFn.mock.calls[0];
    expect(message).toContain("ลูกค้า (123456)");
  });

  it("uses a generic label when there is no userId to look up", async () => {
    const pushTextFn = vi.fn().mockResolvedValue("msg-1");
    const getProfileFn = vi.fn();

    await notifyAdmin("เปิดกี่โมง", undefined, { pushTextFn, getProfileFn, now });

    expect(getProfileFn).not.toHaveBeenCalled();
    const [, message] = pushTextFn.mock.calls[0];
    expect(message).toContain("จาก: ลูกค้า\n");
  });

  it("never throws even when the push itself fails", async () => {
    const pushTextFn = vi.fn().mockRejectedValue(new Error("push failed"));
    const getProfileFn = vi.fn().mockResolvedValue({ userId: "U123", displayName: "สมชาย" });

    await expect(notifyAdmin("เปิดกี่โมง", "U123", { pushTextFn, getProfileFn, now })).resolves.toBeUndefined();
  });

  it("records the escalation with the pushed message id so it can be re-alerted later", async () => {
    const pushTextFn = vi.fn().mockResolvedValue("msg-1");
    const getProfileFn = vi.fn().mockResolvedValue({ userId: "U123", displayName: "สมชาย" });
    const recordEscalationFn = vi.fn();

    await notifyAdmin("เปิดกี่โมง", "U123", { pushTextFn, getProfileFn, now, recordEscalationFn });

    expect(recordEscalationFn).toHaveBeenCalledWith("เปิดกี่โมง", "U123", "msg-1");
  });

  it("does not record an escalation when the push fails", async () => {
    const pushTextFn = vi.fn().mockRejectedValue(new Error("push failed"));
    const getProfileFn = vi.fn().mockResolvedValue({ userId: "U123", displayName: "สมชาย" });
    const recordEscalationFn = vi.fn();

    await notifyAdmin("เปิดกี่โมง", "U123", { pushTextFn, getProfileFn, now, recordEscalationFn });

    expect(recordEscalationFn).not.toHaveBeenCalled();
  });
});
