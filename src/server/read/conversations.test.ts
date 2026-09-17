import { describe, expect, it } from "vitest";
import { buildMessage, buildThread } from "./conversations";
import { T0, approvalRow, messageRow, threadRow } from "./testing";

describe("buildMessage", () => {
  it("marks unsent outbound copy as an agent draft", () => {
    expect(buildMessage(messageRow({ sendState: "pending_approval", sentAt: null }))).toMatchObject({
      author: "AGENT",
      draft: true,
      sendState: "pending_approval",
      sentAt: T0.toISOString(),
    });
  });

  it("shows sent, failed and inbound messages as they are", () => {
    expect(buildMessage(messageRow({ sendState: "failed" }))).toMatchObject({ draft: false, sendState: "failed" });
    expect(
      buildMessage(messageRow({ direction: "inbound", sendState: null, sentAt: null, receivedAt: new Date("2026-09-18") })),
    ).toMatchObject({ author: "PROSPECT", draft: false, sendState: null, sentAt: "2026-09-18T00:00:00.000Z" });
  });
});

describe("buildThread", () => {
  const inbound = messageRow({
    id: "in",
    direction: "inbound",
    sendState: null,
    sentAt: null,
    receivedAt: new Date("2026-09-18T09:00:00Z"),
    classification: { objections: ["Price too high", "Price too high", 3] },
  });

  it("orders messages, hides rejected drafts and surfaces objections and the reply draft", () => {
    const thread = buildThread(
      threadRow({ unread: true, intent: "Wants pricing" }),
      [inbound, messageRow({ id: "out" }), messageRow({ id: "rej", sendState: "rejected" }), messageRow({ id: "x", threadId: "other" })],
      [approvalRow({ kind: "reply_approval", subjectType: "thread", subjectId: "thr_1", payload: { draft: "Happy to explain" } })],
    );
    expect(thread?.messages.map((m) => m.id)).toEqual(["out", "in"]);
    expect(thread).toMatchObject({ unread: true, intent: "Wants pricing", objections: ["Price too high"], suggestedResponse: "Happy to explain" });
  });

  it("excludes threads that are not mapped to a prospect", () => {
    expect(buildThread(threadRow({ mappingState: "needs_review" }), [], [])).toBeNull();
    expect(buildThread(threadRow({ prospectId: null }), [], [])).toBeNull();
  });

  it("ignores decided reply approvals", () => {
    const thread = buildThread(threadRow(), [], [approvalRow({ kind: "reply_approval", subjectType: "thread", subjectId: "thr_1", status: "approved", payload: { draft: "old" } })]);
    expect(thread?.suggestedResponse).toBe("");
    expect(thread?.intent).toBe("Not classified");
  });
});
