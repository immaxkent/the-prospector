/**
 * Loads everything the screens read in live mode and assembles the view models.
 * Single operator, modest volumes: one round of queries per request is acceptable for v1.
 */
import { desc, inArray, ne } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { DailyBrief, SystemInterface } from "@/data/types";
import type { Dataset } from "@/data/store";
import { fixtureInterfaces } from "@/data/fixtures";
import type { Database } from "../db/client";
import * as t from "../db/schema";
import { agentState, buildActivity, buildInsight, buildRun, buildRunLog } from "./activity";
import { buildApproval } from "./approvals";
import { buildThread } from "./conversations";
import { buildEndeavour } from "./endeavours";
import { buildMailbox } from "./mailboxes";
import { buildOpportunity, buildSegmentPerformance } from "./pipeline";
import { buildObjectionClusters } from "./performance";
import { buildProspect } from "./prospects";
import { iso } from "./rows";

export interface DatasetOptions {
  now?: Date;
  model: string;
  provider: string;
}

const byId = <T extends { id: string }>(rows: readonly T[]) => new Map(rows.map((r) => [r.id, r]));

function isBrief(v: unknown): v is DailyBrief {
  const b = v as Partial<DailyBrief> | null;
  return !!b && typeof b.date === "string" && [b.changed, b.learned, b.today, b.risks].every(Array.isArray);
}

/** Interfaces describe the integration seam; counters come from the event log in W12. */
const INTERFACES: SystemInterface[] = fixtureInterfaces.map((i) => ({
  ...i,
  inbound: 0,
  outbound: 0,
  lastEventAt: null,
  events: [],
}));

export async function loadDataset(db: Database, opts: DatasetOptions): Promise<Dataset> {
  const now = opts.now ?? new Date();
  const endeavours = await db.select().from(t.endeavours).where(ne(t.endeavours.status, "archived")).orderBy(t.endeavours.createdAt);
  const endeavourIds = endeavours.map((e) => e.id);
  const inEndeavours = (col: AnyPgColumn) => inArray(col, endeavourIds.length ? endeavourIds : ["-"]);

  const [mailboxes, segments, prospects, threads, messages, approvals, opportunities, insights, runs, events] =
    await Promise.all([
      db.select().from(t.mailboxes).orderBy(t.mailboxes.createdAt),
      db.select().from(t.segments).where(inEndeavours(t.segments.endeavourId)),
      db.select().from(t.prospects).where(inEndeavours(t.prospects.endeavourId)).orderBy(desc(t.prospects.qualificationScore)),
      db.select().from(t.threads).orderBy(desc(t.threads.lastActivityAt)),
      db.select().from(t.messages),
      db.select().from(t.approvals).where(inEndeavours(t.approvals.endeavourId)).orderBy(t.approvals.createdAt),
      db.select().from(t.opportunities).where(inEndeavours(t.opportunities.endeavourId)).orderBy(desc(t.opportunities.updatedAt)),
      db.select().from(t.insights).where(inEndeavours(t.insights.endeavourId)).orderBy(desc(t.insights.createdAt)),
      db.select().from(t.dailyRuns).where(inEndeavours(t.dailyRuns.endeavourId)).orderBy(desc(t.dailyRuns.startedAt)).limit(100),
      db.select().from(t.events).orderBy(desc(t.events.occurredAt)).limit(200),
    ]);

  const companyIds = [...new Set(prospects.map((p) => p.companyId).filter((x): x is string => !!x))];
  const personIds = [...new Set(prospects.map((p) => p.personId).filter((x): x is string => !!x))];
  const prospectIds = prospects.map((p) => p.id);
  const entityIds = [...companyIds, ...personIds, ...prospectIds];
  const [companies, people, evidence, triggers, runLog] = await Promise.all([
    companyIds.length ? db.select().from(t.companies).where(inArray(t.companies.id, companyIds)) : [],
    personIds.length ? db.select().from(t.people).where(inArray(t.people.id, personIds)) : [],
    entityIds.length ? db.select().from(t.evidence).where(inArray(t.evidence.entityId, entityIds)) : [],
    prospectIds.length ? db.select().from(t.triggers).where(inArray(t.triggers.prospectId, prospectIds)) : [],
    runs[0] ? db.select().from(t.runLog).where(inArray(t.runLog.runId, [runs[0].id])) : [],
  ]);

  const maps = {
    companies: byId(companies),
    people: byId(people),
    segments: byId(segments),
    prospects: byId(prospects),
    threads: byId(threads),
    messages: byId(messages),
    evidence: byId(evidence),
  };

  const of = <R extends { endeavourId: string | null }>(rows: readonly R[], id: string) => rows.filter((r) => r.endeavourId === id);
  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const latestBrief = runs.find((r) => r.status === "succeeded" && isBrief(r.brief))?.brief;
  const activeCount = endeavours.filter((e) => e.status === "active").length;

  return {
    status: {
      agent: agentState(runs, activeCount),
      lastRunAt: iso(runs[0]?.startedAt),
      db: "REMOTE",
      model: opts.model,
      provider: opts.provider,
      autonomy: "DRAFT",
      researchSources: ["Claude web search"],
    },
    endeavours: endeavours.map((e) =>
      buildEndeavour({
        endeavour: e,
        prospects: of(prospects, e.id),
        opportunities: of(opportunities, e.id),
        messages: of(messages, e.id),
        approvals: of(approvals, e.id),
        runs: of(runs, e.id),
        insights: of(insights, e.id),
        now,
      }),
    ),
    mailboxes: mailboxes.map((m) => buildMailbox(m, endeavours, maps.threads, messages, now)),
    prospects: prospects.map((p) =>
      buildProspect(p, { ...maps, evidence, triggers, messages, opportunities }),
    ),
    threads: threads.map((th) => buildThread(th, messages, approvals)).filter((x) => x !== null),
    activity: buildActivity(events),
    approvals: pendingApprovals.map((a) => buildApproval(a, { ...maps, opportunities })),
    brief: isBrief(latestBrief) ? latestBrief : null,
    opportunities: opportunities.map((o) => buildOpportunity(o, maps.prospects, maps.companies)),
    insights: insights.map(buildInsight).filter((x) => x !== null),
    segments: buildSegmentPerformance(segments, prospects, messages),
    experiments: [],
    objections: buildObjectionClusters(messages),
    runs: runs.map((r) => buildRun(r, now)),
    runLog: buildRunLog(runLog),
    interfaces: INTERFACES,
    isEmpty: endeavours.length === 0,
  };
}
