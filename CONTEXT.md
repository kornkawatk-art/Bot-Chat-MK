# Bot Chat MK

LINE Official Account chatbot for Makro Ranong that answers customer questions from a Google Sheet FAQ via Gemini, and escalates to a human admin when it can't answer.

## Language

**FAQ Answer**:
The `answer` text for a matched FAQ row. The bot may rephrase it into a natural, conversational sentence, but every fact in the reply (price, hours, location, promotion, or any other detail) must come from the FAQ — never invented. Fact-fidelity is required; wording-fidelity is not. Rephrased in whichever language the customer asked in (defaulting to Thai when unclear) — see Output Language.

**Output Language**:
For FAQ Answers only, the bot replies in the same language the customer's question was written in (Gemini detects this itself; defaults to Thai if unclear). The fixed reply constants (No-Answer Reply, Code-Needed Reply, Default Reply, Product Not Found Reply) and the Product Reply template stay Thai-only regardless of the customer's language — changing those would break the exact-string-match escalation detection and hasn't been tackled yet.

**No-Answer Reply**:
The fixed, verbatim message the bot sends when no FAQ row answers the question (`NO_ANSWER_REPLY`). Always identical text — other code (admin escalation) detects this case by exact string match, so it must never be paraphrased or varied.
_Avoid_: fallback message (too broad, see Default Reply)

**Default Reply**:
The fixed message sent when something technical goes wrong (FAQ sheet unreachable with no cache, Gemini error/timeout, MAX_TOKENS). Distinct from the No-Answer Reply: this is a system-failure case, not "the FAQ doesn't cover this" — it does not trigger admin escalation.

**Admin Escalation**:
Pushing a message to the Admin Group when the bot sends a No-Answer Reply (or receives a non-text message it can't handle), so a human can follow up with the customer. Not triggered by Default Reply / system failures.

**Admin Group**:
The LINE group (`LINE_ADMIN_GROUP_ID`) that receives Admin Escalation notifications. The bot announces its own group ID in-chat when first added to a group. The bot never gives a conversational reply to messages sent here — it's an alert channel, not a customer chat — it only watches for an Acknowledge.

**Product Code**:
A digits-only identifier (variable length, no leading zeros) for one ERP-tracked product. A message counts as a Product Code lookup only when the *entire* message is digits — a code mixed with other words does not trigger a lookup, to avoid misreading an unrelated number in a sentence as a code.

**Code-Needed Reply**:
The fixed, verbatim message the bot sends when Gemini recognizes a price/stock question that didn't arrive as a bare Product Code (`CODE_NEEDED_REPLY`). Guides the customer to resend just the code. Unlike No-Answer Reply, this does not trigger Admin Escalation — the customer can self-resolve by retyping.

**Product Not Found Reply**:
The fixed message sent when a bare Product Code doesn't match any row in the product sheet (`PRODUCT_NOT_FOUND_REPLY`). Unlike Code-Needed Reply, this *does* trigger Admin Escalation — an unrecognized code may mean the product sheet is missing data.

**Product Reply**:
The price/stock answer for a matched Product Code. Built from the product sheet data directly (name, price, stock) with no Gemini call — deterministic by design, since price/stock accuracy is business-critical and the code lookup is already exact.

**Session**:
A customer's recent conversation history (last 6 messages, keyed by LINE userId, stored in Redis with a 30-minute TTL that resets on each message). Only covers the FAQ+Gemini flow — Product Code lookups are stateless and never read or write a Session, since an exact-code lookup needs no prior context.

**Pending Escalation**:
A tracked, unresolved Admin Escalation, stored in Redis with the LINE message id of its most recent alert. Re-alerted to the Admin Group every 30 minutes until Acknowledged. Timing follows real webhook traffic rather than a precise timer, since Vercel's Hobby plan can only run Cron Jobs once a day. Each pending escalation is re-alerted independently — one failed push (e.g. a transient LINE rate limit) doesn't stop the others in the same batch from being checked, and always backs off the 30-minute clock regardless of success, so a failing escalation is retried on the next opportunistic check rather than on every single webhook request until it succeeds.

**Acknowledge**:
An admin quote-replying (LINE's reply-to-a-specific-message feature) to an alert in the Admin Group — any text works, only the quote target matters. Clears that Pending Escalation so it stops being re-alerted, and starts a Handoff for that customer.

**Handoff**:
A window (sliding, ~1 hour of inactivity) during which the bot goes completely silent for one specific customer, started the moment an admin Acknowledges that customer's escalation. Covers every reply path (FAQ+Gemini and Product Code lookups alike) — the problem it solves is the bot answering on top of a human who's mid-conversation with the same customer, so partial silence (e.g. still answering Product Code questions) would defeat the point. Checking a customer's Handoff status while it's active extends it, so an ongoing human conversation doesn't get interrupted by the bot waking back up mid-thread.

**Update Timestamp**:
The "as of" time for the product price/stock data (`updatedAt`), hand-typed into cell E1 of the price sheet by whoever refreshes it — never derived from when the bot happened to fetch the file. A bot-derived fetch time would look fresh even when the underlying export was forgotten; a human-entered one stays visibly stale if nobody updated it. Shown on every Product Reply so a customer's screenshot can be checked against how current the price actually was.

**Unanswered Question Log**:
The last 200 questions that got a No-Answer Reply, kept in Redis for spotting FAQ content gaps — deliberately scoped to that one case, not Product Not Found (a data-file problem, not a content one) or Default Reply (system noise, not a real question). An admin reads the last 20 via the exact "สรุปคำถาม" command in the Admin Group; no attempt is made to cluster similar phrasings, since that needs a human eye anyway.

**Clear Escalations**:
An admin recovery command — typing the exact "ล้าง escalation ค้าง" in the Admin Group deletes every currently-tracked Pending Escalation, regardless of age or whether it's real. Exists because a stuck or stale escalation (e.g. left over from testing, or one whose push keeps failing) previously kept retrying on every single webhook request forever; that specific failure mode is now fixed (see Pending Escalation's back-off behavior), but this command stays as a manual safety valve for whatever else might leave escalations stuck.

**Staff Member**:
A LINE userId (with the display name captured when tagged) that's known to be an employee using the OA for personal purposes (e.g. passing files to themselves), not a real customer. Tagged by an admin quote-replying the exact word "พนักงาน" to that person's Admin Escalation alert — this both tags them and clears that one escalation from Pending so it stops being re-alerted. From then on, every Admin Escalation trigger (No-Answer Reply, non-text message, Product Not Found) is skipped for their userId — but the bot still replies to them completely normally otherwise, since they might occasionally ask a real question. Managed in the Admin Group via "รายชื่อพนักงาน" (numbered list) and "ลบพนักงาน &lt;เลข&gt;" (remove by that number) — the same list-then-act pattern as the Unanswered Question Log's "สรุปคำถาม" command. Deliberately permanent (no TTL) and separate from Handoff, which is temporary and silences the bot entirely — Staff Member exclusion only ever touches the escalation path.

