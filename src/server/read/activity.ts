import type { ActivityEvent, ActivityKind, AgentRun, AgentState, Insight, RunLogLine } from "@/data/types";
import { iso, type EventRow, type InsightRow, type RunLogRow, type RunRow } from "./rows";

export function buildRun(r: RunRow, now: Date): AgentRun {
  const metric = (k: string) => r.metrics[k] ?? 0;
  return {
    id: r.id,
    endeavourId: r.endeavourId,
    phase: r.phase,
    startedAt: iso(r.startedAt),
    durationMs: (r.finishedAt ?? now).getTime() - r.startedAt.getTime(),
    state: r.status === "running" ? "RUNNING" : r.status === "succeeded" ? "OK" : "FAILED",
    discovered: metric("discovered"),
    qualified: metric("qualified"),
    drafted: metric("drafted"),
    sent: metric("sent"),
  };
}

export function buildRunLog(lines: readonly RunLogRow[]): RunLogLine[] {
  return [...lines]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((l) => ({ id: l.id, at: iso(l.at), level: l.level.toUpperCase() as RunLogLine["level"], text: l.text }));
}

export const EVENT_ACTIVITY: Record<string, ActivityKind> = {
  "prospect.researched": "RESEARCHED",
  "prospect.qualified": "QUALIFIED",
  "message.drafted": "DRAFTED",
  "message.sent": "SENT",
  "message.received": "REPLY_RECEIVED",
  "activity.followup_due": "FOLLOWUP_DUE",
  "prospect.meeting_set": "MEETING_SET",
  "opportunity.won": "WON",
  "run.failed": "RUN_FAILED",
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The activity tape shows only events it knows how to describe, newest first. */
export function buildActivity(events: readonly EventRow[], limit = 50): ActivityEvent[] {
  return [...events]
    .filter((e) => EVENT_ACTIVITY[e.eventType])
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, limit)
    .map((e) => ({
      id: e.id,
      at: iso(e.occurredAt),
      kind: EVENT_ACTIVITY[e.eventType]!,
      endeavourId: str(e.payload["endeavourId"]) || (e.entityType === "endeavour" ? e.entityId : ""),
      subject: str(e.payload["subject"]) || e.entityId,
      detail: str(e.payload["detail"]),
    }));
}

export function buildInsight(i: InsightRow): Insight | null {
  if (i.status === "dismissed") return null;
  const summary = i.evidence["summary"];
  return {
    id: i.id,
    endeavourId: i.endeavourId,
    type: i.type === "recommendation" ? "RECOMMENDATION" : "OBSERVATION",
    statement: i.statement,
    evidence: typeof summary === "string" ? summary : JSON.stringify(i.evidence),
    confidence: i.confidence,
    createdAt: iso(i.createdAt),
  };
}

export function agentState(runs: readonly RunRow[], activeEndeavours: number): AgentState {
  if (runs.some((r) => r.status === "running")) return "RUNNING";
  const latest = [...runs].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
  if (latest && (latest.status === "failed" || latest.status === "interrupted")) return "ERROR";
  return activeEndeavours > 0 ? "ONLINE" : "WAITING";
}
