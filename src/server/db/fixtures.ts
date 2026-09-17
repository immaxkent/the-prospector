/**
 * DEVELOPMENT FIXTURES ONLY.
 * Seeded rows are flagged is_fixture on root tables; purgeFixtures removes all of them in one transaction.
 */
import { eq, inArray, or } from "drizzle-orm";
import type { EndeavourSpec } from "../domain/endeavour-spec";
import { DEFAULT_MAILBOX_LIMITS } from "../domain/mailbox";
import type { Database } from "./client";
import * as t from "./schema";

export const FIXTURE_BRIEF = `I want to make £3,000 from Solidity consulting in the next 60 days.
I sell pre-audit security reviews at £750 per fixed five-day package.
Target launch-stage protocol teams before their first audit.`;

export function fixtureSpec(mailboxId: string): EndeavourSpec {
  return {
    name: "£3K Solidity Sprint",
    kind: "sprint",
    objective: {
      state: "stated",
      quote: "make £3,000 from Solidity consulting",
      value: { metric: "revenue", target: 3000, unit: "GBP", currency: "GBP" },
    },
    horizon: { state: "confirmed", value: { kind: "sprint", endsOn: "2026-11-16" } },
    offering: {
      state: "stated",
      quote: "pre-audit security reviews",
      value: { summary: "Fixed-scope pre-audit security review", deliverables: ["Findings report", "Privileged-role map"] },
    },
    pricing: {
      state: "stated",
      quote: "£750 per fixed five-day package",
      value: { model: "package", amount: 750, currency: "GBP" },
    },
    proof: {
      state: "confirmed",
      value: [{ kind: "repo", title: "Arcaidia", url: "https://github.com/immaxkent/arcaidia", claim: "Designed and built the protocol" }],
    },
    buyers: {
      state: "stated",
      quote: "launch-stage protocol teams before their first audit",
      value: [
        {
          name: "Launch-stage protocols",
          definition: "Protocol teams preparing for mainnet without an external audit",
          signals: ["Mainnet date announced", "Unaudited contracts in a public repo"],
          painHypothesis: "Audit firms are booked months ahead of launch",
          priority: 1,
        },
      ],
    },
    exclusions: { state: "confirmed", value: [] },
    mailboxId: { state: "confirmed", value: mailboxId },
    cadence: { state: "confirmed", value: { dailyNewTarget: 10, dailyFollowupTarget: 8 } },
    channels: ["email"],
    autonomyLevel: "DRAFT",
  };
}

export const FIXTURE_IDS = {
  mailbox: "mbx_fixture_consulting",
  endeavour: "end_fixture_solidity",
  segment: "seg_fixture_launch",
  offer: "off_fixture_preaudit",
  company: "com_fixture_northbridge",
  person: "per_fixture_ilse",
  prospect: "pro_fixture_northbridge",
  evidence: "ev_fixture_bridge",
  thread: "thr_fixture_bridge",
  outbound: "msg_fixture_intro",
  inbound: "msg_fixture_reply",
  approval: "apr_fixture_reply",
} as const;

export async function seedFixtures(db: Database) {
  const ids = FIXTURE_IDS;
  await db.transaction(async (tx) => {
    await tx.insert(t.mailboxes).values({
      id: ids.mailbox,
      address: "max@consulting.example",
      displayName: "Max — Solidity consulting",
      provider: "google",
      limits: DEFAULT_MAILBOX_LIMITS,
      isFixture: true,
    });
    const spec = fixtureSpec(ids.mailbox);
    await tx.insert(t.endeavours).values({
      id: ids.endeavour,
      name: spec.name,
      kind: spec.kind,
      status: "active",
      autonomyLevel: spec.autonomyLevel,
      mailboxId: ids.mailbox,
      spec,
      brief: FIXTURE_BRIEF,
      activatedAt: new Date("2026-09-17T08:00:00Z"),
      isFixture: true,
    });
    await tx.insert(t.segments).values({
      id: ids.segment,
      endeavourId: ids.endeavour,
      name: "Launch-stage protocols",
      definition: "Protocol teams preparing for mainnet without an external audit",
      signals: ["Mainnet date announced"],
      painHypothesis: "Audit firms are booked months ahead of launch",
      priority: 1,
      specVersion: 1,
    });
    await tx.insert(t.offers).values({
      id: ids.offer,
      endeavourId: ids.endeavour,
      name: "Pre-audit review",
      proposition: "Fixed-scope pre-audit security review in five working days",
      pricing: { model: "package", amount: 750, currency: "GBP" },
      specVersion: 1,
    });
    await tx.insert(t.companies).values({
      id: ids.company,
      name: "Northbridge Protocol",
      domain: "northbridge.example",
      isFixture: true,
    });
    await tx.insert(t.people).values({
      id: ids.person,
      companyId: ids.company,
      name: "Ilse Vermeer",
      role: "Technical Co-founder",
      email: "ilse@northbridge.example",
      isFixture: true,
    });
    await tx.insert(t.prospects).values({
      id: ids.prospect,
      endeavourId: ids.endeavour,
      companyId: ids.company,
      personId: ids.person,
      segmentId: ids.segment,
      stage: "replied",
      reviewStatus: "qualified",
      qualificationScore: 92,
      scoreFactors: [
        { factor: "trigger_strength", score: 9, weight: 0.3, note: "Mainnet date published", evidenceIds: [ids.evidence] },
      ],
      scoreReason: "Unaudited bridge contract ahead of a published mainnet date",
      source: "fixture",
      nextAction: "Approve reply proposing Friday review window",
    });
    await tx.insert(t.evidence).values({
      id: ids.evidence,
      entityType: "prospect",
      entityId: ids.prospect,
      sourceType: "web",
      sourceRef: "https://northbridge.example/blog/mainnet",
      excerpt: "Mainnet launches 30 October.",
      claim: "Mainnet launch scheduled for 30 October",
      confidence: 0.9,
    });
    await tx.insert(t.threads).values({
      id: ids.thread,
      mailboxId: ids.mailbox,
      endeavourId: ids.endeavour,
      prospectId: ids.prospect,
      externalThreadId: "fixture-thread-1",
      subject: "Bridge contract review before mainnet",
      unread: true,
      intent: "Wants a review before Friday; asked for cost and scope",
    });
    await tx.insert(t.messages).values([
      {
        id: ids.outbound,
        threadId: ids.thread,
        endeavourId: ids.endeavour,
        prospectId: ids.prospect,
        direction: "outbound",
        messageClass: "new_outreach",
        externalMessageId: "fixture-message-1",
        subject: "Bridge contract review before mainnet",
        body: "Saw the mainnet date for 30 October. We run a fixed-scope pre-audit review in five working days.",
        evidenceIds: [ids.evidence],
        sendState: "sent",
        sendAttempts: 1,
        sentAt: new Date("2026-09-14T10:02:00Z"),
      },
      {
        id: ids.inbound,
        threadId: ids.thread,
        endeavourId: ids.endeavour,
        prospectId: ids.prospect,
        direction: "inbound",
        externalMessageId: "fixture-message-2",
        subject: "Re: Bridge contract review before mainnet",
        body: "Yes, we would want this reviewed before Friday. What is the cost and what is covered?",
        receivedAt: new Date("2026-09-16T06:41:00Z"),
      },
    ]);
    await tx.insert(t.approvals).values({
      id: ids.approval,
      endeavourId: ids.endeavour,
      kind: "reply_approval",
      subjectType: "thread",
      subjectId: ids.thread,
      payload: { draft: "We can start Friday. Fixed scope, £750, five working days." },
    });
  });
}

/** Removes every fixture row. Non-fixture data is untouched. */
export async function purgeFixtures(db: Database) {
  await db.transaction(async (tx) => {
    const fixtureEndeavours = tx.select({ id: t.endeavours.id }).from(t.endeavours).where(eq(t.endeavours.isFixture, true));
    const fixtureCompanies = tx.select({ id: t.companies.id }).from(t.companies).where(eq(t.companies.isFixture, true));
    const fixturePeople = tx.select({ id: t.people.id }).from(t.people).where(eq(t.people.isFixture, true));
    const fixtureProspects = tx
      .select({ id: t.prospects.id })
      .from(t.prospects)
      .where(inArray(t.prospects.endeavourId, fixtureEndeavours));

    // Evidence is polymorphic, so it does not cascade.
    await tx
      .delete(t.evidence)
      .where(
        or(
          inArray(t.evidence.entityId, fixtureEndeavours),
          inArray(t.evidence.entityId, fixtureCompanies),
          inArray(t.evidence.entityId, fixturePeople),
          inArray(t.evidence.entityId, fixtureProspects),
        ),
      );
    await tx.delete(t.endeavours).where(eq(t.endeavours.isFixture, true));
    await tx.delete(t.people).where(eq(t.people.isFixture, true));
    await tx.delete(t.companies).where(eq(t.companies.isFixture, true));
    await tx.delete(t.mailboxes).where(eq(t.mailboxes.isFixture, true));
  });
}
