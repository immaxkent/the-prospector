import { describe, expect, it } from "vitest";
import { FakeLlm } from "../llm/fake";
import type { LlmCallRecord } from "../llm/structured";
import { REPLY_PROMPT, classifyReply, renderReplyInput, type ReplyClassification } from "./reply";

const output = (over: Partial<ReplyClassification> = {}): ReplyClassification => ({
  intent: "interested",
  summary: "Wants the review before Friday and asked for the price",
  objections: [],
  commitments: ["They will send the repository link"],
  requestedNextStep: "Send cost and scope",
  unsubscribeRequested: false,
  suggestedReply: "Friday works. Fixed scope, £750, five working days.",
  confidence: 0.8,
  ...over,
});

const request = {
  offering: "Pre-audit security review",
  pricing: "£750 package",
  prospect: { company: "Northbridge", person: "Ilse" },
  history: [{ direction: "outbound" as const, body: "Saw your mainnet date." }],
  reply: "Yes — what does it cost?",
  today: "2026-09-18",
};

function run(response: ReplyClassification) {
  const records: LlmCallRecord[] = [];
  const llm = new FakeLlm([response]);
  return { llm, records, promise: classifyReply({ llm, model: "claude-opus-5", record: async (r) => void records.push(r) }, request) };
}

describe("renderReplyInput", () => {
  it("shows the thread and the reply to read separately", () => {
    const text = renderReplyInput(request);
    expect(text).toContain('<message from="us">');
    expect(text).toContain("<reply-to-read>");
    expect(text).toContain("Yes — what does it cost?");
  });

  it("says when price must not be mentioned", () => {
    expect(renderReplyInput({ ...request, pricing: null })).toContain("do not mention price");
  });
});

describe("classifyReply", () => {
  it("returns the reading and records the call", async () => {
    const { promise, llm, records } = run(output());
    const result = await promise;
    expect(result).toMatchObject({ intent: "interested", requestedNextStep: "Send cost and scope" });
    expect(llm.requests[0]).toMatchObject({ system: REPLY_PROMPT.system, effort: "medium" });
    expect(records[0]).toMatchObject({ role: "conversation.classify", status: "ok" });
  });

  it("never proposes a sales reply to an unsubscribe request", async () => {
    const { promise } = run(output({ intent: "unsubscribe", unsubscribeRequested: true, suggestedReply: "Happy to keep in touch!" }));
    expect(await promise).toMatchObject({ unsubscribeRequested: true, suggestedReply: null });
  });

  it("treats a stop request as an unsubscribe even when the intent says otherwise", async () => {
    const { promise } = run(output({ intent: "not_interested", unsubscribeRequested: true, suggestedReply: "One more thought…" }));
    expect((await promise).suggestedReply).toBeNull();
  });

  it("does not reply to an out-of-office or an automated bounce", async () => {
    const { promise } = run(output({ intent: "out_of_office", suggestedReply: "Welcome back!" }));
    expect((await promise).suggestedReply).toBeNull();
  });

  it("keeps objections as the prospect expressed them", async () => {
    const { promise } = run(output({ intent: "objection", objections: ["We already have an auditor lined up"] }));
    expect((await promise).objections).toEqual(["We already have an auditor lined up"]);
  });
});
