import { describe, expect, it } from "vitest";
import { NAMED_LIMIT, buildReview, plainCovering, segmentLine, type ReviewFacts, type ReviewItem } from "./review";

const item = (company: string, days: number): ReviewItem => ({ prospectId: `pro_${company}`, company, days });

const facts = (over: Partial<ReviewFacts> = {}): ReviewFacts => ({
  endeavourId: "end_1",
  endeavourName: "£3K Solidity Sprint",
  followUp: [],
  decide: [],
  silent: [],
  offChannel: [],
  segments: [],
  pending: 31,
  pendingCap: 50,
  active: 6,
  activeGoal: 20,
  minSample: 15,
  ...over,
});

describe("buildReview", () => {
  it("puts the longest wait first, because that is the one gone coldest", () => {
    const review = buildReview(facts({ followUp: [item("Near", 1), item("Far", 9), item("Middle", 4)] }), "x");
    expect(review.sections[0]!.lines).toEqual([
      "· Far — replied 9 days ago, waiting on you",
      "· Middle — replied 4 days ago, waiting on you",
      "· Near — replied 1 day ago, waiting on you",
    ]);
  });

  it("names a readable number and counts the rest", () => {
    const many = Array.from({ length: NAMED_LIMIT + 3 }, (_, i) => item(`Co${i}`, i));
    const review = buildReview(facts({ decide: many }), "x");
    expect(review.sections[0]!.lines).toHaveLength(NAMED_LIMIT + 1);
    expect(review.sections[0]!.lines.at(-1)).toBe("· and 3 more");
  });

  it("leaves out a section with nothing in it, rather than printing an empty heading", () => {
    const review = buildReview(facts(), "x");
    expect(review.sections.map((s) => s.title)).toEqual(["NEWS"]);
  });

  it("asks one question about anything that may have died, however it got there", () => {
    // Silent and off-channel are different causes and the same question: is this alive?
    const review = buildReview(facts({ silent: [item("Quiet", 20)], offChannel: [item("Discord", 9)] }), "x");
    const update = review.sections.find((s) => s.title === "UPDATE ON THESE");
    expect(update?.lines).toEqual([
      "· Quiet — silent 20 days",
      "· Discord — in talks elsewhere, nothing logged for 9 days",
    ]);
  });

  it("always carries NEWS, and leads it with where the buffer stands", () => {
    const review = buildReview(facts(), "x");
    expect(review.sections.at(-1)!.lines[0]).toBe("· 31/50 pending · 6/20 live conversations");
  });

  it("counts only what needs the operator in the title, not what it is telling them", () => {
    const quiet = buildReview(facts(), "x");
    expect(quiet.notification.title).toBe("£3K Solidity Sprint · this week");
    const busy = buildReview(facts({ followUp: [item("A", 1)], decide: [item("B", 2)] }), "x");
    expect(busy.notification.title).toBe("£3K Solidity Sprint · this week, 2 things for you");
  });

  it("leads the body with the covering sentence it was given", () => {
    expect(buildReview(facts(), "Two replies and a quiet week otherwise.").notification.body).toMatch(
      /^Two replies and a quiet week otherwise\./,
    );
  });
});

describe("segmentLine", () => {
  const seg = { name: "Launch-stage", pending: 12, share: 17, sent: 0, replies: 0 };

  it("says nothing has been sent rather than printing a rate of zero", () => {
    expect(segmentLine(seg, 15)).toBe("· Launch-stage — 12/17 held, nothing sent yet");
  });

  it("refuses to rate a sample too small to mean anything", () => {
    // A reply rate off nine sends is noise, and a percentage invites acting on it.
    expect(segmentLine({ ...seg, sent: 9, replies: 1 }, 15)).toBe(
      "· Launch-stage — 12/17 held, 1 reply from 9 sent (too few to rate)",
    );
  });

  it("gives the rate once there is enough, with the sample beside it", () => {
    expect(segmentLine({ ...seg, sent: 40, replies: 6 }, 15)).toBe("· Launch-stage — 12/17 held, 15% reply rate from 40 sent");
  });
});

describe("plainCovering", () => {
  it("says so when nothing needs the operator", () => {
    expect(plainCovering(facts())).toBe("Nothing is waiting on you this week.");
  });

  it("counts everything that does, across every section", () => {
    expect(plainCovering(facts({ followUp: [item("A", 1)], silent: [item("B", 2)], offChannel: [item("C", 3)] }))).toBe(
      "3 things need you this week.",
    );
  });
});
