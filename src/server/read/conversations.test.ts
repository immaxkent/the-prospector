import { describe, expect, it } from "vitest";
import { buildMessage, buildThread, buildUnattributed } from "./conversations";
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

describe("buildUnattributed", () => {
  const thread = (over: Partial<Parameters<typeof buildUnattributed>[0][number]> = {}) =>
    threadRow({ mappingState: "needs_review", prospectId: null, endeavourId: null, ...over });

  it("surfaces a thread that could not be placed, which the inbox dropped entirely", () => {
    const [reply] = buildUnattributed(
      [thread({ id: "thr_x", subject: "Re: Bridge contract" })],
      [messageRow({ threadId: "thr_x", direction: "inbound", body: "Who is this?", receivedAt: new Date("2026-10-07T09:00:00Z") })],
      [],
    );
    expect(reply).toMatchObject({
      id: "thr_x",
      subject: "Re: Bridge contract",
      preview: "Who is this?",
      receivedAt: "2026-10-07T09:00:00.000Z",
      guessedProspectId: null,
      guessedBy: null,
    });
  });

  it("prefers the sender and preview the approval recorded", () => {
    const [reply] = buildUnattributed(
      [thread({ id: "thr_x" })],
      [messageRow({ threadId: "thr_x", direction: "inbound", body: "body" })],
      [approvalRow({ kind: "thread_mapping", subjectId: "thr_x", payload: { from: "who@elsewhere.example", preview: "Hello" } })],
    );
    expect(reply).toMatchObject({ from: "who@elsewhere.example", preview: "Hello" });
  });

  it("carries the guess when there was one, so confirming it is a click", () => {
    const [reply] = buildUnattributed(
      [thread({ id: "thr_x", prospectId: "pro_1" })],
      [messageRow({ threadId: "thr_x", direction: "inbound", attributedBy: "domain" })],
      [],
    );
    expect(reply).toMatchObject({ guessedProspectId: "pro_1", guessedBy: "domain" });
  });

  it("holds together for a thread with no endeavour, the case that was invisible", () => {
    // These never got an approval, so there was nothing to read them off at all.
    const [reply] = buildUnattributed([thread({ id: "thr_x" })], [], []);
    expect(reply).toMatchObject({ from: "unknown sender", preview: "" });
  });

  it("leaves mapped and ignored threads alone", () => {
    const rows = buildUnattributed(
      [threadRow({ id: "mapped", mappingState: "mapped" }), threadRow({ id: "ignored", mappingState: "ignored" })],
      [],
      [],
    );
    expect(rows).toEqual([]);
  });

  it("is newest first, and does not wobble between reads", () => {
    const rows = buildUnattributed(
      [thread({ id: "a" }), thread({ id: "b" })],
      [
        messageRow({ id: "m_a", threadId: "a", direction: "inbound", receivedAt: new Date("2026-10-05T09:00:00Z") }),
        messageRow({ id: "m_b", threadId: "b", direction: "inbound", receivedAt: new Date("2026-10-07T09:00:00Z") }),
      ],
      [],
    );
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});
