/**
 * Reading what came back.
 *
 * The daily run does this once a morning; the worker also does it through the day, so a reply
 * is read and answered while the person who sent it is still at their desk. Both go through
 * here, because two implementations of "what does this reply mean" would drift apart.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { companies, endeavours, messages, people, prospects } from "../db/schema";
import type { AgentDeps } from "../agent/deps";
import { classifyReply } from "../agent/reply";
import { ingestReplies } from "../mailboxes/ingest";
import type { DeliveryChannel } from "../notify/channels";
import { localDate } from "../read/rows";
import { applyReplyClassification } from "./conversations";
import { notFound } from "./errors";
import { notify } from "./notify";
import type { SendDeps } from "./send";

/** Intents that should reach the operator the day they arrive, rather than waiting for the brief. */
export const WORTH_TELLING_YOU = new Set(["interested", "referral", "question"]);

/** How many unread replies one pass will read. A backlog is worked through over several passes. */
export const INBOUND_BATCH = 20;

export interface InboundDeps {
  agent: AgentDeps | null;
  mail: SendDeps | null;
  notifications: DeliveryChannel;
}

export interface InboundInput {
  endeavourId: string;
  now: Date;
  runId?: string | null;
  /** Where to narrate; the daily run writes to its log, the worker to nothing. */
  log?: (level: "info" | "warn" | "error", text: string) => Promise<void>;
}

export interface InboundResult {
  fetched: number;
  needsReview: number;
  classified: number;
  notified: number;
  /** Things the operator should know were not done, for the daily brief. */
  gaps: string[];
}

export async function processInbound(db: Database, deps: InboundDeps, input: InboundInput): Promise<InboundResult> {
  const log = input.log ?? (async () => {});
  const result: InboundResult = { fetched: 0, needsReview: 0, classified: 0, notified: 0, gaps: [] };

  const [endeavour] = await db.select().from(endeavours).where(eq(endeavours.id, input.endeavourId));
  if (!endeavour) throw notFound("endeavour");

  // Fetching needs Google; reading what already arrived only needs Claude.
  if (!endeavour.mailboxId) {
    await log("warn", "no mailbox is connected, so no new replies were fetched");
    result.gaps.push("Replies were not fetched: the endeavour has no mailbox");
  } else if (!deps.mail) {
    await log("warn", "Google is not configured on this server, so no new replies were fetched");
    result.gaps.push("Replies were not fetched: Google is not configured");
  } else {
    const ingested = await ingestReplies(db, deps.mail, { mailboxId: endeavour.mailboxId, now: input.now });
    result.fetched = ingested.stored;
    result.needsReview = ingested.needsReview;
    await log(
      "info",
      `${ingested.stored} new reply(ies) · ${ingested.matched} matched · ${ingested.needsReview} need review · ${ingested.alreadyKnown} already known`,
    );
    if (ingested.needsReview > 0) {
      result.gaps.push(`${ingested.needsReview} reply(ies) could not be matched and are waiting for you`);
    }
  }

  if (!deps.agent) {
    await log("warn", "Claude is not configured, so replies were stored but not read");
    result.gaps.push("Replies were not classified: Claude is not configured");
    return result;
  }

  const spec = specValues(endeavour.spec);
  const unread = await db
    .select()
    .from(messages)
    .where(and(eq(messages.endeavourId, input.endeavourId), eq(messages.direction, "inbound"), isNull(messages.classification)))
    .limit(INBOUND_BATCH);

  for (const reply of unread) {
    const [prospect] = reply.prospectId ? await db.select().from(prospects).where(eq(prospects.id, reply.prospectId)) : [];
    const [company] = prospect?.companyId ? await db.select().from(companies).where(eq(companies.id, prospect.companyId)) : [];
    const history = await db
      .select({ direction: messages.direction, body: messages.body })
      .from(messages)
      .where(and(eq(messages.threadId, reply.threadId), inArray(messages.sendState, ["sent"])));

    const classification = await classifyReply(
      { ...deps.agent, runId: input.runId ?? null },
      {
        offering: spec.offering ?? endeavour.name,
        pricing: spec.pricing,
        prospect: { company: company?.name ?? "unknown company", person: await personName(db, prospect?.personId ?? null) },
        history: history.map((h) => ({ direction: h.direction, body: h.body })),
        reply: reply.body,
        today: localDate(input.now),
      },
    );
    const applied = await applyReplyClassification(db, { messageId: reply.id, classification, now: input.now });
    result.classified += 1;
    await log("info", `${company?.name ?? reply.id}: ${classification.intent} · ${applied.outcome}`);
    if (applied.outcome === "unsubscribed") {
      await log("warn", `${company?.name ?? reply.id} asked not to be contacted: suppressed and outreach stopped`);
    }
    if (WORTH_TELLING_YOU.has(classification.intent)) {
      const sent = await notify(db, deps.notifications, {
        kind: `reply_${classification.intent}`,
        title: `${company?.name ?? "A prospect"} replied: ${classification.intent.replace("_", " ")}`,
        body: classification.summary,
        endeavourId: input.endeavourId,
        path: "/inbox",
        priority: "high",
      }, input.now);
      if (sent) result.notified += 1;
    }
  }
  return result;
}

async function personName(db: Database, personId: string | null) {
  if (!personId) return null;
  const [person] = await db.select({ name: people.name }).from(people).where(eq(people.id, personId));
  return person?.name ?? null;
}

/** The parts of the spec a reply needs for context, when they were actually settled. */
function specValues(spec: { offering: { state: string }; pricing: { state: string } }) {
  const value = <T>(f: { state: string } & Record<string, unknown>) =>
    f.state === "stated" || f.state === "confirmed" ? (f["value"] as T) : undefined;
  const offering = value<{ summary: string; deliverables: string[] }>(spec.offering);
  const pricing = value<{ model: string; amount?: number; currency?: string }>(spec.pricing);
  return {
    offering: offering ? [offering.summary, ...offering.deliverables].join(" · ") : null,
    pricing: pricing?.amount ? `${pricing.currency ?? ""} ${pricing.amount} (${pricing.model})`.trim() : null,
  };
}
