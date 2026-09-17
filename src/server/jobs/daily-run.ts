/**
 * The daily operating loop (handoff §4). Each step is checkpointed, so a run that is
 * interrupted resumes after the last completed step instead of repeating work.
 *
 * Steps that depend on unbuilt work packages record an explicit "pending" line and a
 * coverage gap in the brief. Nothing is ever reported as done when it did not run.
 */
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { draftOutreach, type ProofItemRef } from "../agent/draft";
import { qualifyProspect, type EvidenceForQualification } from "../agent/qualify";
import { researchCandidates } from "../agent/research";
import type { AgentDeps } from "../agent/deps";
import { createOutreachDraft } from "../commands/outreach";
import { applyQualification, knownTargetNames, storeCandidates } from "../commands/research";
import type { Database } from "../db/client";
import { activities, companies, dailyRuns, endeavours, evidence, messages, people, prospects, runLog, segments, triggers } from "../db/schema";
import { PROGRESSION } from "../domain/pipeline";
import { newId } from "../ids";
import { localDate, OPERATOR_TIMEZONE } from "../read/rows";
import { notFound } from "../commands/errors";
import { recordEvent } from "../commands/events";

export interface RunContext {
  db: Database;
  /** Null when Claude is not configured: agent steps then report themselves as skipped. */
  agent: AgentDeps | null;
  runId: string;
  endeavourId: string;
  now: Date;
  metrics: Record<string, number>;
  gaps: string[];
  log: (level: "info" | "warn" | "error", text: string) => Promise<void>;
}

export interface RunStep {
  name: string;
  run: (ctx: RunContext) => Promise<void>;
}

/** Marks work that a later work package delivers. It never pretends to have run. */
const pending = (name: string, workPackage: string, what: string): RunStep => ({
  name,
  run: async (ctx) => {
    await ctx.log("warn", `${what} is not built yet (${workPackage}) — nothing was done in this step`);
    ctx.gaps.push(`${what} did not run: ${workPackage} is not built yet`);
  },
});

const startOfLocalDay = (now: Date) => new Date(`${localDate(now)}T00:00:00Z`);

export const DAILY_RUN_STEPS: RunStep[] = [
  {
    name: "load",
    run: async (ctx) => {
      const [e] = await ctx.db.select().from(endeavours).where(eq(endeavours.id, ctx.endeavourId));
      if (!e) throw notFound("endeavour");
      if (e.status !== "active") throw new Error(`endeavour is ${e.status}, not active`);
      await ctx.log("info", `loaded ${e.name} · autonomy ${e.autonomyLevel}`);
    },
  },
  {
    name: "review_yesterday",
    run: async (ctx) => {
      const today = startOfLocalDay(ctx.now);
      const due = await ctx.db
        .select({ id: activities.id })
        .from(activities)
        .where(and(eq(activities.endeavourId, ctx.endeavourId), eq(activities.status, "due"), lt(activities.dueAt, ctx.now)));
      const sentYesterday = await ctx.db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.endeavourId, ctx.endeavourId), eq(messages.direction, "outbound"), lt(messages.sentAt, today)));
      ctx.metrics["actionsDue"] = due.length;
      await ctx.log("info", `${due.length} action(s) due · ${sentYesterday.length} message(s) sent before today`);
    },
  },
  pending("process_inbound", "W10", "Reading replies from the mailbox"),
  {
    name: "recalculate",
    run: async (ctx) => {
      const rows = await ctx.db
        .select({ stage: prospects.stage, reviewStatus: prospects.reviewStatus })
        .from(prospects)
        .where(eq(prospects.endeavourId, ctx.endeavourId));
      const active = rows.filter((p) => p.reviewStatus !== "rejected");
      for (const [i, stage] of PROGRESSION.entries()) {
        ctx.metrics[stage] = active.filter((p) => PROGRESSION.indexOf(p.stage) >= i).length;
      }
      ctx.metrics["prospects"] = active.length;
      await ctx.log("info", `pipeline recalculated from ${active.length} active prospect(s)`);
    },
  },
  {
    name: "research",
    run: async (ctx) => {
      if (!ctx.agent) {
        await ctx.log("warn", "Claude is not configured (ANTHROPIC_API_KEY), so no research ran");
        ctx.gaps.push("Research did not run: Claude is not configured");
        return;
      }
      const { offering, exclusions, dailyNewTarget } = await endeavourBrief(ctx);
      const found = await ctx.db
        .select({ id: prospects.id })
        .from(prospects)
        .where(and(eq(prospects.endeavourId, ctx.endeavourId), gte(prospects.createdAt, startOfLocalDay(ctx.now))));
      const wanted = Math.max(0, dailyNewTarget - found.length);
      if (wanted === 0) {
        await ctx.log("info", `today's target of ${dailyNewTarget} new prospect(s) is already met`);
        return;
      }

      const active = await ctx.db
        .select()
        .from(segments)
        .where(and(eq(segments.endeavourId, ctx.endeavourId), eq(segments.status, "active")));
      if (active.length === 0) {
        await ctx.log("warn", "no active segment to research");
        ctx.gaps.push("Research did not run: the endeavour has no active segment");
        return;
      }
      const known = await knownTargetNames(ctx.db, ctx.endeavourId);
      let created = 0;
      for (const segment of active.sort((a, b) => a.priority - b.priority)) {
        if (created >= wanted) break;
        const result = await researchCandidates(
          { ...ctx.agent, runId: ctx.runId },
          {
            segment: { name: segment.name, definition: segment.definition, signals: segment.signals, painHypothesis: segment.painHypothesis },
            offering,
            exclusions,
            knownTargets: known,
            wanted: wanted - created,
            today: localDate(ctx.now),
          },
        );
        const stored = await storeCandidates(ctx.db, {
          endeavourId: ctx.endeavourId,
          segmentId: segment.id,
          candidates: result.candidates,
          runId: ctx.runId,
        });
        created += stored.created.length;
        await ctx.log(
          "info",
          `${segment.name}: ${result.proposed} proposed · ${result.droppedCandidates} unverifiable · ${stored.suppressed} suppressed · ${stored.duplicates} already known · ${stored.created.length} added`,
        );
        if (result.droppedClaims > 0) {
          await ctx.log("warn", `${result.droppedClaims} claim(s) cited a page search never returned and were dropped`);
        }
      }
      ctx.metrics["discovered"] = created;
      if (created < wanted) ctx.gaps.push(`Research found ${created} of ${wanted} new prospect(s) wanted today`);
    },
  },
  {
    name: "qualify",
    run: async (ctx) => {
      if (!ctx.agent) {
        await ctx.log("warn", "Claude is not configured (ANTHROPIC_API_KEY), so nothing was qualified");
        ctx.gaps.push("Qualification did not run: Claude is not configured");
        return;
      }
      const { offering, exclusions } = await endeavourBrief(ctx);
      const waiting = await ctx.db
        .select()
        .from(prospects)
        .where(and(eq(prospects.endeavourId, ctx.endeavourId), eq(prospects.reviewStatus, "researching")))
        .limit(20);
      if (waiting.length === 0) {
        await ctx.log("info", "nothing waiting to be qualified");
        return;
      }

      let qualified = 0;
      for (const prospect of waiting) {
        const [company] = prospect.companyId ? await ctx.db.select().from(companies).where(eq(companies.id, prospect.companyId)) : [];
        const [person] = prospect.personId ? await ctx.db.select().from(people).where(eq(people.id, prospect.personId)) : [];
        const [segment] = prospect.segmentId ? await ctx.db.select().from(segments).where(eq(segments.id, prospect.segmentId)) : [];
        const claims = await ctx.db.select().from(evidence).where(eq(evidence.entityId, prospect.id));
        const [trigger] = await ctx.db.select().from(triggers).where(eq(triggers.prospectId, prospect.id));

        const result = await qualifyProspect(
          { ...ctx.agent, runId: ctx.runId },
          {
            segment: segment
              ? { name: segment.name, definition: segment.definition, signals: segment.signals, painHypothesis: segment.painHypothesis }
              : { name: "unspecified", definition: "no segment recorded", signals: [], painHypothesis: "unknown" },
            offering,
            exclusions,
            prospect: {
              company: company?.name ?? "unknown company",
              person: person?.name ?? null,
              role: person?.role ?? null,
              hasEmail: !!person?.email,
              trigger: trigger?.description ?? null,
            },
            evidence: claims.map(
              (c): EvidenceForQualification => ({
                id: c.id,
                claim: c.claim,
                sourceRef: c.sourceRef,
                capturedAt: c.capturedAt.toISOString().slice(0, 10),
                confidence: c.confidence,
              }),
            ),
            today: localDate(ctx.now),
          },
        );
        await applyQualification(ctx.db, { prospectId: prospect.id, ...result });
        if (result.outcome === "qualified") qualified += 1;
        await ctx.log("info", `${company?.name ?? prospect.id}: ${result.score}/100 · ${result.outcome}`);
        if (result.droppedCitations > 0) {
          await ctx.log("warn", `${result.droppedCitations} citation(s) pointed at evidence that does not exist and were dropped`);
        }
      }
      ctx.metrics["qualified"] = qualified;
    },
  },
  {
    name: "build_queue",
    run: async (ctx) => {
      const today = startOfLocalDay(ctx.now);
      const dueToday = await ctx.db
        .select({ id: activities.id })
        .from(activities)
        .where(and(eq(activities.endeavourId, ctx.endeavourId), eq(activities.status, "due"), gte(activities.dueAt, today)));
      ctx.metrics["queued"] = dueToday.length;
      await ctx.log("info", `${dueToday.length} action(s) queued for today`);
    },
  },
  {
    name: "draft",
    run: async (ctx) => {
      if (!ctx.agent) {
        await ctx.log("warn", "Claude is not configured (ANTHROPIC_API_KEY), so nothing was drafted");
        ctx.gaps.push("Drafting did not run: Claude is not configured");
        return;
      }
      const { endeavour, offering, pricing, proof, dailyNewTarget } = await endeavourBrief(ctx);
      const today = startOfLocalDay(ctx.now);
      const alreadyToday = await ctx.db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.endeavourId, ctx.endeavourId),
            eq(messages.direction, "outbound"),
            eq(messages.messageClass, "new_outreach"),
            gte(messages.createdAt, today),
          ),
        );
      const room = Math.max(0, dailyNewTarget - alreadyToday.length);
      if (room === 0) {
        await ctx.log("info", `today's outreach target of ${dailyNewTarget} is already prepared`);
        return;
      }

      const ready = await ctx.db
        .select()
        .from(prospects)
        .where(and(eq(prospects.endeavourId, ctx.endeavourId), eq(prospects.reviewStatus, "qualified"), eq(prospects.stage, "qualified")))
        .limit(room);
      if (ready.length === 0) {
        await ctx.log("info", "no qualified prospect is waiting for a first email");
        return;
      }

      let drafted = 0;
      let refused = 0;
      for (const prospect of ready) {
        const [company] = prospect.companyId ? await ctx.db.select().from(companies).where(eq(companies.id, prospect.companyId)) : [];
        const [person] = prospect.personId ? await ctx.db.select().from(people).where(eq(people.id, prospect.personId)) : [];
        const [segment] = prospect.segmentId ? await ctx.db.select().from(segments).where(eq(segments.id, prospect.segmentId)) : [];
        const claims = await ctx.db.select().from(evidence).where(eq(evidence.entityId, prospect.id));
        if (!person?.email) {
          await ctx.log("warn", `${company?.name ?? prospect.id}: no email address, so no draft was written`);
          continue;
        }

        const result = await draftOutreach(
          { ...ctx.agent, runId: ctx.runId },
          {
            prospect: { company: company?.name ?? "unknown company", person: person.name, role: person.role },
            segment: { name: segment?.name ?? "unspecified", painHypothesis: segment?.painHypothesis ?? "unknown" },
            offering,
            pricing,
            evidence: claims.map((c) => ({ id: c.id, claim: c.claim, sourceRef: c.sourceRef })),
            proof,
            senderName: endeavour.name,
            messageClass: "new_outreach",
            history: [],
            today: localDate(ctx.now),
          },
        );

        if (!result.ok) {
          refused += 1;
          await ctx.log("warn", `${company?.name ?? prospect.id}: draft refused — ${result.violations.map((v) => v.detail).join("; ")}`);
          continue;
        }
        const created = await createOutreachDraft(ctx.db, {
          prospectId: prospect.id,
          subject: result.draft.subject,
          body: result.draft.body,
          evidenceIds: result.citedEvidenceIds,
          messageClass: "new_outreach",
          templateVersion: "outreach.draft/2026-09-17.1",
          why: prospect.scoreReason ?? "",
          runId: ctx.runId,
        });
        if (created.created) {
          drafted += 1;
          await ctx.log("info", `${company?.name ?? prospect.id}: draft ready for approval`);
        } else {
          await ctx.log("info", `${company?.name ?? prospect.id}: no draft (${created.reason})`);
        }
      }
      ctx.metrics["drafted"] = drafted;
      if (refused > 0) ctx.gaps.push(`${refused} draft(s) were refused because their claims were not supported by evidence`);
    },
  },
  pending("send", "W10", "Sending approved messages"),
  {
    name: "escalate",
    run: async (ctx) => {
      const waiting = await ctx.db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.endeavourId, ctx.endeavourId), inArray(messages.sendState, ["approved", "failed"])));
      ctx.metrics["awaitingSend"] = waiting.length;
      if (waiting.length) await ctx.log("info", `${waiting.length} approved message(s) waiting to be sent`);
    },
  },
  pending("learn", "W11", "Learning from replies and objections"),
  {
    name: "brief",
    run: async (ctx) => {
      const brief = {
        date: localDate(ctx.now),
        changed: [`${ctx.metrics["prospects"] ?? 0} active prospect(s) in the pipeline`],
        learned: [],
        today: [`${ctx.metrics["queued"] ?? 0} action(s) due today`, `${ctx.metrics["awaitingSend"] ?? 0} message(s) awaiting send`],
        risks: ctx.gaps,
      };
      await ctx.db.update(dailyRuns).set({ brief, metrics: ctx.metrics }).where(eq(dailyRuns.id, ctx.runId));
      await ctx.log("info", "daily brief written");
    },
  },
];

export interface DailyRunInput {
  endeavourId: string;
  trigger: "schedule" | "manual";
  now?: Date;
  steps?: RunStep[];
  agent?: AgentDeps | null;
}

/** Spec values the agent steps need, with the endeavour's own words. */
async function endeavourBrief(ctx: RunContext) {
  const [e] = await ctx.db.select().from(endeavours).where(eq(endeavours.id, ctx.endeavourId));
  if (!e) throw notFound("endeavour");
  const value = <T>(f: { state: string } & Record<string, unknown>) =>
    f.state === "stated" || f.state === "confirmed" ? (f["value"] as T) : undefined;
  const offering = value<{ summary: string; deliverables: string[] }>(e.spec.offering);
  const exclusions = value<{ rule: string }[]>(e.spec.exclusions) ?? [];
  const cadence = value<{ dailyNewTarget: number }>(e.spec.cadence);
  const pricing = value<{ model: string; amount?: number; currency?: string }>(e.spec.pricing);
  const proofItems = value<{ kind: string; title: string; claim: string; url?: string }[]>(e.spec.proof) ?? [];
  return {
    endeavour: e,
    offering: offering ? [offering.summary, ...offering.deliverables].join(" · ") : e.name,
    exclusions: exclusions.map((x) => x.rule),
    dailyNewTarget: cadence?.dailyNewTarget ?? 0,
    pricing: pricing?.amount ? `${pricing.currency ?? ""} ${pricing.amount} (${pricing.model})`.trim() : null,
    proof: proofItems.map((p, i): ProofItemRef => ({ id: `proof_${i + 1}`, title: p.title, claim: p.claim, url: p.url })),
  };
}

/** Starts today's run, or returns the existing one so a repeated trigger never duplicates work. */
async function openRun(db: Database, input: Required<Pick<DailyRunInput, "endeavourId" | "trigger">> & { now: Date }) {
  const runDate = localDate(input.now, OPERATOR_TIMEZONE);
  const [existing] = await db
    .select()
    .from(dailyRuns)
    .where(and(eq(dailyRuns.endeavourId, input.endeavourId), eq(dailyRuns.runDate, runDate)));
  if (existing) {
    if (existing.status === "succeeded") return { run: existing, resumed: false, alreadyDone: true };
    await db.update(dailyRuns).set({ status: "running", finishedAt: null }).where(eq(dailyRuns.id, existing.id));
    return { run: existing, resumed: existing.checkpoint > 0, alreadyDone: false };
  }
  const id = newId("run");
  const [created] = await db
    .insert(dailyRuns)
    .values({ id, endeavourId: input.endeavourId, runDate, trigger: input.trigger, status: "running", startedAt: input.now })
    .returning();
  return { run: created!, resumed: false, alreadyDone: false };
}

export async function runDailyLoop(db: Database, input: DailyRunInput) {
  const now = input.now ?? new Date();
  const steps = input.steps ?? DAILY_RUN_STEPS;
  const { run, resumed, alreadyDone } = await openRun(db, { endeavourId: input.endeavourId, trigger: input.trigger, now });
  if (alreadyDone) return { runId: run.id, status: "succeeded" as const, skipped: true };

  const ctx: RunContext = {
    db,
    agent: input.agent ?? null,
    runId: run.id,
    endeavourId: input.endeavourId,
    now,
    metrics: { ...run.metrics },
    gaps: [],
    log: async (level, text) => {
      await db.insert(runLog).values({ id: newId("runLog"), runId: run.id, level, text });
    },
  };
  if (resumed) await ctx.log("warn", `resuming after step ${run.checkpoint} of ${steps.length}`);

  for (const [index, step] of steps.entries()) {
    if (index < run.checkpoint) continue;
    await db.update(dailyRuns).set({ phase: step.name }).where(eq(dailyRuns.id, run.id));
    try {
      await step.run(ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.log("error", `${step.name} failed: ${message}`);
      await db
        .update(dailyRuns)
        .set({ status: "failed", finishedAt: new Date(), metrics: ctx.metrics })
        .where(eq(dailyRuns.id, run.id));
      await recordEvent(db, {
        eventType: "run.failed",
        entityType: "run",
        entityId: run.id,
        endeavourId: input.endeavourId,
        subject: step.name,
        detail: message,
      });
      throw err;
    }
    await db.update(dailyRuns).set({ checkpoint: index + 1, metrics: ctx.metrics }).where(eq(dailyRuns.id, run.id));
  }

  await db
    .update(dailyRuns)
    .set({ status: "succeeded", phase: "done", finishedAt: new Date(), metrics: ctx.metrics })
    .where(eq(dailyRuns.id, run.id));
  await recordEvent(db, {
    eventType: "run.completed",
    entityType: "run",
    entityId: run.id,
    endeavourId: input.endeavourId,
    detail: `${steps.length} steps · ${ctx.gaps.length} coverage gap(s)`,
  });
  return { runId: run.id, status: "succeeded" as const, skipped: false };
}
