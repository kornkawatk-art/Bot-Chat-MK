import { recordEscalation } from "./escalations";
import { getProfile, pushText } from "./line";
import { isStaffMember } from "./staff";

const THAI_MONTHS = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];
const BUDDHIST_ERA_OFFSET = 543;

/** Formats an instant as Bangkok local time with a Buddhist-era year, e.g. "21 ส.ค. 2569 15:32". */
export function formatThaiTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = Number(get("year")) + BUDDHIST_ERA_OFFSET;
  const month = THAI_MONTHS[Number(get("month")) - 1];

  return `${get("day")} ${month} ${year} ${get("hour")}:${get("minute")}`;
}

interface AdminNotificationInput {
  customerName: string;
  question: string;
  timestamp: Date;
}

export function buildAdminNotification({ customerName, question, timestamp }: AdminNotificationInput): string {
  return `🔔 คำถามที่บอทตอบไม่ได้\n\nจาก: ${customerName}\nเวลา: ${formatThaiTimestamp(timestamp)}\n\nคำถาม: "${question}"\n\nรบกวนแอดมินตอบลูกค้าใน LINE OA Manager ด้วยค่ะ`;
}

interface NotifyAdminDeps {
  getProfileFn?: typeof getProfile;
  pushTextFn?: typeof pushText;
  recordEscalationFn?: typeof recordEscalation;
  isStaffMemberFn?: typeof isStaffMember;
  now?: () => Date;
}

/**
 * Pushes an escalation message to the admin group when the bot couldn't answer a customer.
 * Skips entirely for known staff (see lib/staff.ts) — their messages to the OA are personal use,
 * not customer questions, so they shouldn't page the admin group.
 * Best-effort: never throws, so a broken/unconfigured notification never breaks the customer reply.
 */
export async function notifyAdmin(question: string, userId: string | undefined, deps: NotifyAdminDeps = {}): Promise<void> {
  const groupId = process.env.LINE_ADMIN_GROUP_ID;
  if (!groupId) return;

  const getProfileFn = deps.getProfileFn ?? getProfile;
  const pushTextFn = deps.pushTextFn ?? pushText;
  const recordEscalationFn = deps.recordEscalationFn ?? recordEscalation;
  const isStaffMemberFn = deps.isStaffMemberFn ?? isStaffMember;
  const now = deps.now ?? (() => new Date());

  if (userId && (await isStaffMemberFn(userId))) return;

  let customerName = "ลูกค้า";
  if (userId) {
    try {
      const profile = await getProfileFn(userId);
      customerName = profile.displayName;
    } catch {
      customerName = `ลูกค้า (${userId.slice(-6)})`;
    }
  }

  const message = buildAdminNotification({ customerName, question, timestamp: now() });

  try {
    const messageId = await pushTextFn(groupId, message);
    await recordEscalationFn(question, userId, customerName, messageId);
  } catch (err) {
    console.error(
      JSON.stringify({ level: "error", msg: "admin_notify_failed", error: String(err) }),
    );
  }
}
