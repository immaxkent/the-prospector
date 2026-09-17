import { describe, expect, it } from "vitest";
import {
  MAX_SEND_ATTEMPTS,
  OUTBOUND_STATES,
  OutboundTransitionError,
  assertMove,
  canMove,
  canRetry,
  routeDraft,
  type ApprovalInput,
} from "./outbound";

describe("outbound lifecycle", () => {
  it("follows the approval and send path", () => {
    const path = ["drafted", "pending_approval", "approved", "queued", "sending", "sent"] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canMove(path[i]!, path[i + 1]!)).toBe(true);
  });

  it("cannot skip approval-to-send steps or leave terminal states", () => {
    expect(canMove("pending_approval", "sent")).toBe(false);
    expect(canMove("approved", "sending")).toBe(false);
    for (const to of OUTBOUND_STATES) {
      expect(canMove("sent", to)).toBe(false);
      expect(canMove("rejected", to)).toBe(false);
    }
  });

  it("retries failed sends up to the attempt limit", () => {
    expect(canMove("failed", "queued")).toBe(true);
    expect(canRetry("failed", MAX_SEND_ATTEMPTS - 1)).toBe(true);
    expect(canRetry("failed", MAX_SEND_ATTEMPTS)).toBe(false);
    expect(canRetry("sent", 0)).toBe(false);
  });

  it("throws a typed error on an illegal move", () => {
    expect(() => assertMove("drafted", "sent")).toThrow(OutboundTransitionError);
  });
});

describe("routeDraft", () => {
  const base: ApprovalInput = { autonomyLevel: "DRAFT", messageClass: "new_outreach", novelCopy: false, sensitive: false };

  it("discards drafts under OBSERVE", () => {
    expect(routeDraft({ ...base, autonomyLevel: "OBSERVE" })).toBe("discard");
  });

  it("always needs a human under DRAFT", () => {
    expect(routeDraft(base)).toBe("pending_approval");
    expect(routeDraft({ ...base, messageClass: "follow_up" })).toBe("pending_approval");
  });

  it("lets GUARDED send approved copy but not novel copy or replies", () => {
    expect(routeDraft({ ...base, autonomyLevel: "GUARDED" })).toBe("approved");
    expect(routeDraft({ ...base, autonomyLevel: "GUARDED", novelCopy: true })).toBe("pending_approval");
    expect(routeDraft({ ...base, autonomyLevel: "GUARDED", messageClass: "reply" })).toBe("pending_approval");
  });

  it("escalates sensitive drafts at every sending level", () => {
    expect(routeDraft({ ...base, autonomyLevel: "DELEGATED", sensitive: true })).toBe("pending_approval");
    expect(routeDraft({ ...base, autonomyLevel: "DELEGATED" })).toBe("approved");
  });
});
