# Bot Chat MK

LINE Official Account chatbot for Makro Ranong that answers customer questions from a Google Sheet FAQ via Gemini, and escalates to a human admin when it can't answer.

## Language

**FAQ Answer**:
The `answer` text for a matched FAQ row. The bot may rephrase it into a natural, conversational sentence, but every fact in the reply (price, hours, location, promotion, or any other detail) must come from the FAQ — never invented. Fact-fidelity is required; wording-fidelity is not.

**No-Answer Reply**:
The fixed, verbatim message the bot sends when no FAQ row answers the question (`NO_ANSWER_REPLY`). Always identical text — other code (admin escalation) detects this case by exact string match, so it must never be paraphrased or varied.
_Avoid_: fallback message (too broad, see Default Reply)

**Default Reply**:
The fixed message sent when something technical goes wrong (FAQ sheet unreachable with no cache, Gemini error/timeout, MAX_TOKENS). Distinct from the No-Answer Reply: this is a system-failure case, not "the FAQ doesn't cover this" — it does not trigger admin escalation.

**Admin Escalation**:
Pushing a message to the Admin Group when the bot sends a No-Answer Reply (or receives a non-text message it can't handle), so a human can follow up with the customer. Not triggered by Default Reply / system failures.

**Admin Group**:
The LINE group (`LINE_ADMIN_GROUP_ID`) that receives Admin Escalation notifications. The bot announces its own group ID in-chat when first added to a group.
