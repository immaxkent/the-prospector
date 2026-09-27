/**
 * WP-18 T1 — the living pipeline, derived.
 *
 * One node per prospect, placed at the furthest stage it has reached, clustered under the
 * stage it sits in. Nothing here draws; it is the arithmetic of "where is everything right
 * now", kept apart so it can be tested without a DOM and so the view cannot quietly invent
 * a state while laying it out.
 *
 * A prospect appears exactly once. It is tempting to show it at every stage it has passed
 * through — that is what a funnel does — but this view answers "what is happening", and a
 * prospect that replied last week is not also still being drafted.
 */
import type { Approval, Prospect, Thread } from "./types";
import type { AgentRun } from "./types";

export type FieldStage = "researching" | "qualified" | "drafting" | "awaiting" | "sent" | "replied";

export interface FieldNode {
  /** The prospect's id: stable across polls, which is what lets movement be detected. */
  id: string;
  label: string;
  /** Set only for "awaiting": the decision this node is blocked on. */
  approvalId?: string;
}

export interface FieldStageNode {
  id: FieldStage;
  label: string;
  nodes: FieldNode[];
  /** Everything past the cap, counted rather than drawn. */
  overflow: number;
  total: number;
}

export interface AgentState {
  phase: string | null;
  lastRunAt: string | null;
  running: boolean;
  /** No run within the endeavour's own cadence: the field says so rather than looking tidy. */
  stalled: boolean;
}

export interface PipelineField {
  stages: FieldStageNode[];
  /** What research has digested and is ready to feed back in, as a second small cluster. */
  readyToFeedIn: number;
  agent: AgentState;
}

/** Past this many dots a cluster stops being information and becomes a texture. */
export const CLUSTER_CAP = 12;

const STAGE_LABELS: Record<FieldStage, string> = {
  researching: "RESEARCHING",
  qualified: "QUALIFIED",
  drafting: "DRAFTING",
  awaiting: "AWAITING YOU",
  sent: "SENT",
  replied: "REPLIED",
};

export const FIELD_STAGES = Object.keys(STAGE_LABELS) as FieldStage[];

/**
 * The furthest stage a prospect has reached.
 *
 * Read backwards, because the answer is the last thing that became true: a prospect whose
 * draft is awaiting approval is also, still, qualified.
 */
export function stageOf(
  prospect: Prospect,
  threads: readonly Thread[],
  approvals: readonly Approval[],
): FieldStage | null {
  const mine = threads.filter((t) => t.prospectId === prospect.id);
  const messages = mine.flatMap((t) => t.messages);

  if (messages.some((m) => m.author === "PROSPECT")) return "replied";
  if (messages.some((m) => m.sendState === "sent")) return "sent";

  const waiting = messages.find(
    (m) => m.draft && m.sendState !== "sent" && approvals.some((a) => a.subjectType === "message" && a.subjectId === m.id),
  );
  if (waiting) return "awaiting";
  if (messages.some((m) => m.draft && m.sendState !== "sent")) return "drafting";

  if (prospect.status === "QUALIFIED") return "qualified";
  // A rejected prospect is out of the pipeline, not at the start of it.
  if (prospect.status === "REJECTED") return null;
  return "researching";
}

const approvalFor = (prospectId: string, approvals: readonly Approval[]) =>
  approvals.find((a) => a.prospectId === prospectId)?.id;

export interface FieldInput {
  prospects: readonly Prospect[];
  threads: readonly Thread[];
  approvals: readonly Approval[];
  runs: readonly AgentRun[];
  /** Days the endeavour expects between runs; past this with no run, the field is stalled. */
  cadenceDays?: number;
  now: Date;
}

export function buildPipelineField(input: FieldInput): PipelineField {
  const buckets = new Map<FieldStage, FieldNode[]>(FIELD_STAGES.map((s) => [s, []]));

  for (const prospect of input.prospects) {
    const stage = stageOf(prospect, input.threads, input.approvals);
    if (!stage) continue;
    const node: FieldNode = { id: prospect.id, label: prospect.company || prospect.person };
    if (stage === "awaiting") {
      const id = approvalFor(prospect.id, input.approvals);
      if (id) node.approvalId = id;
    }
    buckets.get(stage)!.push(node);
  }

  const stages = FIELD_STAGES.map((id) => {
    const all = buckets.get(id)!;
    return {
      id,
      label: STAGE_LABELS[id],
      nodes: all.slice(0, CLUSTER_CAP),
      overflow: Math.max(0, all.length - CLUSTER_CAP),
      total: all.length,
    };
  });

  return { stages, readyToFeedIn: readyToFeedIn(input), agent: agentState(input) };
}

/**
 * Replies the agent has read but not yet acted on: what it will feed back in next run.
 * Counted from threads rather than the run log, so it is true between runs as well as
 * during one.
 */
function readyToFeedIn(input: FieldInput): number {
  return input.threads.filter((t) => t.unread && t.messages.some((m) => m.author === "PROSPECT")).length;
}

function agentState(input: FieldInput): AgentState {
  // Runs arrive newest first everywhere else in the app; sort so this does not depend on it.
  const runs = [...input.runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const latest = runs[0];
  const running = runs.some((r) => r.state === "RUNNING");
  if (!latest) return { phase: null, lastRunAt: null, running: false, stalled: true };

  const days = input.cadenceDays ?? 1;
  const since = (input.now.getTime() - new Date(latest.startedAt).getTime()) / 86_400_000;
  return {
    phase: running ? latest.phase : null,
    lastRunAt: latest.startedAt,
    running,
    // A run in progress is never stalled, however old the last completed one is.
    stalled: !running && since > days,
  };
}
