import { describe, expect, it } from "vitest";
import type { AgentRun, Approval, Prospect, Thread } from "./types";
import { CLUSTER_CAP, FIELD_STAGES, buildPipelineField, stageOf, type FieldInput } from "./pipeline-field";

const NOW = new Date("2026-09-27T12:00:00Z");

const prospect = (id: string, over: Partial<Prospect> = {}): Prospect =>
  ({ id, endeavourId: "e1", person: `Person ${id}`, company: `Co ${id}`, status: "QUALIFIED", ...over }) as Prospect;

const thread = (prospectId: string, messages: Partial<Thread["messages"][number]>[], over: Partial<Thread> = {}): Thread =>
  ({ id: `t_${prospectId}`, prospectId, endeavourId: "e1", unread: false, messages, ...over }) as Thread;

const draft = (id = "m1") => ({ id, author: "AGENT", draft: true, sendState: "pending_approval" }) as const;
const sent = { id: "m_sent", author: "AGENT", draft: false, sendState: "sent" } as const;
const reply = { id: "m_reply", author: "PROSPECT", draft: false, sendState: null } as const;

const approval = (subjectId: string, prospectId: string): Approval =>
  ({ id: `a_${subjectId}`, subjectType: "message", subjectId, prospectId, endeavourId: "e1" }) as Approval;

const run = (over: Partial<AgentRun> = {}): AgentRun =>
  ({ id: "r1", endeavourId: "e1", phase: "research", startedAt: "2026-09-27T09:00:00Z", state: "OK", ...over }) as AgentRun;

const input = (over: Partial<FieldInput> = {}): FieldInput => ({
  prospects: [],
  threads: [],
  approvals: [],
  runs: [run()],
  now: NOW,
  ...over,
});

const at = (stage: string, f = buildPipelineField(input())) => f.stages.find((s) => s.id === stage)!;

describe("stageOf", () => {
  it("reads backwards: the answer is the last thing that became true", () => {
    // This prospect is qualified, drafted, approved, sent and replied to. It is replied.
    const t = thread("p1", [draft(), sent, reply]);
    expect(stageOf(prospect("p1"), [t], [approval("m1", "p1")])).toBe("replied");
  });

  it("is sent once anything has gone, before a reply", () => {
    expect(stageOf(prospect("p1"), [thread("p1", [draft(), sent])], [approval("m1", "p1")])).toBe("sent");
  });

  it("is awaiting only when a draft actually has a decision against it", () => {
    const t = thread("p1", [draft()]);
    expect(stageOf(prospect("p1"), [t], [approval("m1", "p1")])).toBe("awaiting");
    expect(stageOf(prospect("p1"), [t], [])).toBe("drafting");
  });

  it("stops treating a draft as pending once it has been sent", () => {
    const gone = thread("p1", [{ ...draft(), sendState: "sent" }]);
    expect(stageOf(prospect("p1"), [gone], [approval("m1", "p1")])).toBe("sent");
  });

  it("falls back to the prospect's own status when there is no outreach", () => {
    expect(stageOf(prospect("p1", { status: "QUALIFIED" }), [], [])).toBe("qualified");
    expect(stageOf(prospect("p1", { status: "RESEARCHING" }), [], [])).toBe("researching");
    expect(stageOf(prospect("p1", { status: "DISCOVERED" }), [], [])).toBe("researching");
  });

  it("drops a rejected prospect rather than parking it at the start", () => {
    expect(stageOf(prospect("p1", { status: "REJECTED" }), [], [])).toBeNull();
  });

  it("ignores threads belonging to another prospect", () => {
    expect(stageOf(prospect("p1"), [thread("p2", [sent])], [])).toBe("qualified");
  });
});

describe("buildPipelineField", () => {
  it("lays out every stage, in flow order, even when empty", () => {
    const field = buildPipelineField(input());
    expect(field.stages.map((s) => s.id)).toEqual(FIELD_STAGES);
    expect(field.stages.every((s) => s.total === 0)).toBe(true);
  });

  it("places each prospect exactly once, at its furthest stage", () => {
    const field = buildPipelineField(
      input({
        prospects: [prospect("p1"), prospect("p2"), prospect("p3", { status: "RESEARCHING" })],
        threads: [thread("p1", [draft(), sent, reply]), thread("p2", [draft("m2")])],
        approvals: [approval("m2", "p2")],
      }),
    );
    const total = field.stages.reduce((n, s) => n + s.total, 0);
    expect(total).toBe(3);
    expect(at("replied", field).nodes.map((n) => n.id)).toEqual(["p1"]);
    expect(at("awaiting", field).nodes.map((n) => n.id)).toEqual(["p2"]);
    expect(at("researching", field).nodes.map((n) => n.id)).toEqual(["p3"]);
    expect(at("sent", field).total).toBe(0);
  });

  it("labels a node by company, falling back to the person", () => {
    const field = buildPipelineField(input({ prospects: [prospect("p1", { company: "" })] }));
    expect(at("qualified", field).nodes[0]!.label).toBe("Person p1");
  });

  it("carries the decision id only on the nodes that are blocked on one", () => {
    const field = buildPipelineField(
      input({
        prospects: [prospect("p1"), prospect("p2")],
        threads: [thread("p1", [draft("m1")]), thread("p2", [sent])],
        approvals: [approval("m1", "p1")],
      }),
    );
    expect(at("awaiting", field).nodes[0]!.approvalId).toBe("a_m1");
    expect(at("sent", field).nodes[0]!.approvalId).toBeUndefined();
  });

  it("caps a cluster and counts the rest rather than drawing a texture", () => {
    const many = Array.from({ length: CLUSTER_CAP + 7 }, (_, i) => prospect(`p${i}`));
    const field = buildPipelineField(input({ prospects: many }));
    const qualified = at("qualified", field);
    expect(qualified.nodes).toHaveLength(CLUSTER_CAP);
    expect(qualified.overflow).toBe(7);
    expect(qualified.total).toBe(CLUSTER_CAP + 7);
  });

  it("has no overflow when the cluster fits exactly", () => {
    const exact = Array.from({ length: CLUSTER_CAP }, (_, i) => prospect(`p${i}`));
    expect(at("qualified", buildPipelineField(input({ prospects: exact }))).overflow).toBe(0);
  });
});

describe("ready to feed in", () => {
  it("counts unread replies, which is what the next run will digest", () => {
    const field = buildPipelineField(
      input({ threads: [thread("p1", [reply], { unread: true }), thread("p2", [reply])] }),
    );
    expect(field.readyToFeedIn).toBe(1);
  });

  it("does not count an unread thread with nothing from the prospect in it", () => {
    expect(buildPipelineField(input({ threads: [thread("p1", [sent], { unread: true })] })).readyToFeedIn).toBe(0);
  });
});

describe("agent state", () => {
  it("reports the phase only while something is running", () => {
    const running = buildPipelineField(input({ runs: [run({ state: "RUNNING", phase: "draft" })] }));
    expect(running.agent).toMatchObject({ running: true, phase: "draft", stalled: false });
    expect(buildPipelineField(input()).agent.phase).toBeNull();
  });

  it("takes the newest run whatever order they arrive in", () => {
    const field = buildPipelineField(
      input({
        runs: [run({ id: "old", startedAt: "2026-09-20T09:00:00Z" }), run({ id: "new", startedAt: "2026-09-27T09:00:00Z" })],
      }),
    );
    expect(field.agent.lastRunAt).toBe("2026-09-27T09:00:00Z");
  });

  it("is stalled when nothing has run inside the cadence", () => {
    const stale = buildPipelineField(input({ runs: [run({ startedAt: "2026-09-20T09:00:00Z" })], cadenceDays: 1 }));
    expect(stale.agent.stalled).toBe(true);
    // A weekly endeavour is not stalled at the same age.
    expect(buildPipelineField(input({ runs: [run({ startedAt: "2026-09-25T09:00:00Z" })], cadenceDays: 7 })).agent.stalled).toBe(
      false,
    );
  });

  it("is never stalled while a run is in progress, however old the last one", () => {
    const field = buildPipelineField(
      input({ runs: [run({ startedAt: "2026-01-01T09:00:00Z", state: "RUNNING" })], cadenceDays: 1 }),
    );
    expect(field.agent.stalled).toBe(false);
  });

  it("treats an endeavour that has never run as stalled, and says it has no last run", () => {
    const field = buildPipelineField(input({ runs: [] }));
    expect(field.agent).toEqual({ phase: null, lastRunAt: null, running: false, stalled: true });
  });
});
