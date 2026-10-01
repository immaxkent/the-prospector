import type { PromptDefinition } from "../llm/structured";
import type { ReviewFacts } from "./review";

/**
 * The covering sentence, and nothing else.
 *
 * The lists underneath it are queried and exact. The model is given the figures and asked
 * only to join them up, because a review that invents a number is worse than no review:
 * the operator has no way of telling which figures were counted and which were recalled.
 *
 * So the prompt hands it the counts, forbids new ones, and keeps it to two sentences. Its
 * job is the sentence a colleague would open with, not the data.
 */
export const REVIEW_PROMPT: PromptDefinition = {
  role: "report.review",
  version: "2026-10-01.1",
  system: `You write the opening line of a weekly review for one operator running an outreach campaign. It sits above lists that have already been counted exactly.

Write at most two sentences. Say what kind of week it was and what most needs their attention, in plain British English.

Rules:
- Use only the figures given to you. Never state a number that is not in the input, and never round one that is.
- Do not repeat the lists. They are directly below and the reader can see them.
- No greeting, no sign-off, no "here is your weekly review".
- Flat and specific rather than encouraging. "Three replies are waiting, the oldest nine days" is useful; "great progress this week" is not.
- If nothing needs them, say so in one short sentence.
- If a warning is given to you, it outranks everything else: lead with it.`,
};

export function renderReviewInput(facts: ReviewFacts): string {
  const oldest = (items: readonly { days: number }[]) => (items.length ? Math.max(...items.map((i) => i.days)) : 0);
  return [
    `Endeavour: ${facts.endeavourName}`,
    `Replies waiting on the operator: ${facts.followUp.length} (oldest ${oldest(facts.followUp)} days)`,
    `Found but not yet released: ${facts.decide.length} (oldest ${oldest(facts.decide)} days)`,
    `Silent for a fortnight or more: ${facts.silent.length}`,
    `In talks elsewhere with nothing logged recently: ${facts.offChannel.length}`,
    `Pending buffer: ${facts.pending} of ${facts.pendingCap}`,
    `Live conversations: ${facts.active} of a goal of ${facts.activeGoal}`,
    `Segments: ${facts.segments.map((s) => `${s.name} (${s.sent} sent, ${s.replies} replies)`).join("; ") || "none"}`,
    ...(facts.objectiveWarning ? [`Warning to carry: ${facts.objectiveWarning}`] : []),
    `How the buffer is divided: ${facts.allocation.mode}${facts.allocation.armed ? " (acting)" : " (not enough evidence yet)"}`,
  ].join("\n");
}
