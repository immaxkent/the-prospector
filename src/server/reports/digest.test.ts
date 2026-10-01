import { describe, expect, it } from "vitest";
import { buildDigest, type DigestInput } from "./digest";

const input = (over: Partial<DigestInput> = {}): DigestInput => ({
  endeavourId: "end_1",
  endeavourName: "£3K Solidity Sprint",
  waitingOnYou: 0,
  waitingLongestDays: 0,
  stuckSends: 0,
  haltNotice: null,
  budgetExhausted: false,
  ...over,
});

describe("buildDigest", () => {
  it("says nothing at all when nothing qualifies", () => {
    // A digest that arrives every day whatever happened stops being read, and then the one
    // that mattered is missed too.
    expect(buildDigest(input())).toBeNull();
  });

  it("leads with people waiting, and says how long the oldest has been", () => {
    const digest = buildDigest(input({ waitingOnYou: 3, waitingLongestDays: 4 }));
    expect(digest?.lines[0]).toBe("3 people have replied and are waiting on you, the oldest 4 days ago.");
  });

  it("counts one person as a person", () => {
    expect(buildDigest(input({ waitingOnYou: 1, waitingLongestDays: 1 }))?.lines[0]).toBe(
      "1 person has replied and is waiting on you, the oldest 1 day ago.",
    );
  });

  it("leaves out the age when nothing has been waiting a whole day", () => {
    expect(buildDigest(input({ waitingOnYou: 2 }))?.lines[0]).toBe("2 people have replied and are waiting on you.");
  });

  it("says a failed send is the mailbox, not the operator", () => {
    // These are messages they already approved. Without saying so it reads as another task.
    expect(buildDigest(input({ stuckSends: 2 }))?.lines[0]).toContain("That is the mailbox, not you");
  });

  it("passes the halt through in the words it was already given", () => {
    const notice = "Prospecting is paused: 50/50 pending. Dequeue or reject to resume.";
    expect(buildDigest(input({ haltNotice: notice }))?.lines).toEqual([notice]);
  });

  it("raises its priority only for people, not for its own housekeeping", () => {
    // Someone else's time waiting is different from the operator's own backlog.
    expect(buildDigest(input({ waitingOnYou: 1 }))?.notification.priority).toBe("high");
    expect(buildDigest(input({ budgetExhausted: true }))?.notification.priority).toBe("normal");
  });

  it("counts what it is about in the title, and links to the endeavour", () => {
    const digest = buildDigest(input({ waitingOnYou: 1, budgetExhausted: true }));
    expect(digest?.notification.title).toBe("£3K Solidity Sprint · 2 things this morning");
    expect(digest?.notification.path).toBe("/endeavours/end_1");
  });
});
