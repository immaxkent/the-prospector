/**
 * Sending a report, and recording that it went.
 *
 * Recorded in the app first and sent second, deliberately. A notification that was
 * delivered but not recorded is a thing the operator saw and the app cannot show them
 * again; the other way round is merely a thing they have to come and look at.
 *
 * The record is also what stops a second copy: the scheduler asks when one last went out,
 * so a box restarted an hour after the digest must not send another.
 */
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { endeavours } from "../db/schema";
import { recordEvent } from "../commands/events";
import type { DeliveryChannel } from "../notify/channels";
import type { AgentDeps } from "../agent/deps";
import { z } from "zod/v4";
import { runStructured } from "../llm/structured";
import { buildDigest } from "./digest";
import { DIGEST_SENT, REVIEW_SENT, collectDigest, collectReview } from "./collect";
import { buildReview, plainCovering, type ReviewFacts } from "./review";
import { REVIEW_PROMPT, renderReviewInput } from "./review-prompt";

export interface ReportDeps {
  notifications: DeliveryChannel;
  /** Needed by the weekly review, which Claude writes the covering text for. */
  agent: AgentDeps | null;
  /** Null when nothing can read the budget, which is not grounds to withhold the digest. */
  budgetRemainingPence?: number | null;
}

export interface SendReportInput {
  endeavourId: string;
  kind: "digest" | "review";
  now: Date;
}

export async function sendReport(db: Database, deps: ReportDeps, input: SendReportInput) {
  const [endeavour] = await db.select().from(endeavours).where(eq(endeavours.id, input.endeavourId));
  if (!endeavour) return { sent: false, reason: "no such endeavour" as const };

  if (input.kind === "digest") return sendDigest(db, deps, input, endeavour.name);
  return sendReview(db, deps, input, endeavour.name);
}

async function sendDigest(db: Database, deps: ReportDeps, input: SendReportInput, name: string) {
  const facts = await collectDigest(db, input.endeavourId, input.now, {
    // Unknown is not exhausted. Saying the budget is gone when nobody could read it would
    // send the operator looking for a problem that may not exist.
    budgetExhausted: typeof deps.budgetRemainingPence === "number" && deps.budgetRemainingPence <= 0,
  });
  if (!facts) return { sent: false, reason: "no such endeavour" as const };

  const digest = buildDigest(facts);

  /*
   * Nothing to say is still worth recording.
   *
   * The scheduler asks when the last digest went out to decide whether today's is due. If
   * a quiet morning recorded nothing, every tick for the rest of the day would find no
   * digest, build an empty one, and ask again — and the morning something did happen, it
   * would arrive at whatever hour the first event landed rather than at the hour the
   * operator chose.
   */
  await recordEvent(db, {
    eventType: DIGEST_SENT,
    entityType: "endeavour",
    entityId: input.endeavourId,
    endeavourId: input.endeavourId,
    subject: name,
    detail: digest ? digest.lines.join(" · ") : "nothing needed saying",
    data: { lines: digest?.lines ?? [] },
  });

  if (!digest) return { sent: false, reason: "nothing to report" as const };

  await deps.notifications.deliver(digest.notification);
  return { sent: true, lines: digest.lines };
}

export { REVIEW_SENT };

const coveringSchema = z.object({ covering: z.string().trim().min(1) });

/**
 * The covering sentence, or the flat one.
 *
 * A model that is unavailable, over budget or returns something unusable must not cost the
 * operator the review: the lists are the part that matters and they are already counted.
 * So every failure here falls back to a plain sentence rather than propagating.
 */
async function covering(deps: ReportDeps, facts: ReviewFacts, runId: string | null): Promise<string> {
  if (!deps.agent) return plainCovering(facts);
  try {
    const { output } = await runStructured({
      llm: deps.agent.llm,
      record: deps.agent.record,
      prompt: REVIEW_PROMPT,
      schema: coveringSchema,
      user: renderReviewInput(facts),
      model: deps.agent.model,
      depth: "light",
      maxTokens: 400,
      runId,
    });
    return output.covering;
  } catch (err) {
    console.error(`weekly review covering text failed, falling back to the plain one: ${err instanceof Error ? err.message : String(err)}`);
    return plainCovering(facts);
  }
}

async function sendReview(db: Database, deps: ReportDeps, input: SendReportInput, name: string) {
  const facts = await collectReview(db, input.endeavourId, input.now);
  if (!facts) return { sent: false, reason: "no such endeavour" as const };

  const review = buildReview(facts, await covering(deps, facts, null));

  // Always recorded and always sent, unlike the digest. A week in which nothing needed the
  // operator is itself worth saying once: silence for a day means nothing happened, and
  // silence for a week means nobody knows whether anything is running.
  await recordEvent(db, {
    eventType: REVIEW_SENT,
    entityType: "endeavour",
    entityId: input.endeavourId,
    endeavourId: input.endeavourId,
    subject: name,
    detail: review.notification.title,
    data: { sections: review.sections },
  });

  await deps.notifications.deliver(review.notification);
  return { sent: true, sections: review.sections };
}
