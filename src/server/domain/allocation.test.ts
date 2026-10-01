import { describe, expect, it } from "vitest";
import {
  EXPLORATION_FLOOR,
  allocate,
  allocateWithinCap,
  automaticShares,
  type SegmentAllocationInput,
} from "./allocation";

const seg = (id: string, priority: number, pinned: number | null = null): SegmentAllocationInput => ({ id, priority, pinned });
const three = [seg("a", 1), seg("b", 2), seg("c", 3)];
const none = new Map<string, number>();

describe("allocate", () => {
  it("gives every segment a floor, which is the whole point", () => {
    // The bug this replaces: one pool in priority order, so the broadest segment filled the
    // day and the two with real constraints were never asked.
    const shares = allocate(three, 50, none).map((a) => a.share);
    expect(shares).toEqual([17, 17, 16]);
    expect(shares.reduce((a, b) => a + b)).toBe(50);
  });

  it("hands the odd one to the higher priority, because somebody has to have it", () => {
    expect(allocate(three, 50, none).map((a) => `${a.segmentId}:${a.share}`)).toEqual(["a:17", "b:17", "c:16"]);
  });

  it("divides evenly when it divides evenly", () => {
    expect(allocate([seg("a", 1), seg("b", 2)], 50, none).map((a) => a.share)).toEqual([25, 25]);
  });

  it("subtracts what a segment already holds", () => {
    const rooms = allocate(three, 50, new Map([["a", 17], ["b", 5]]));
    expect(rooms).toEqual([
      { segmentId: "a", share: 17, room: 0 },
      { segmentId: "b", share: 17, room: 12 },
      { segmentId: "c", share: 16, room: 16 },
    ]);
  });

  it("does not ask a segment over its share to give anything back", () => {
    // The cap was lowered, or a segment was added. Prospects are not deleted to balance a
    // ledger; it gets nothing new until what it holds resolves.
    const [a] = allocate(three, 30, new Map([["a", 25]]));
    expect(a).toMatchObject({ share: 10, room: 0 });
  });

  it("starts a new segment at its share, not at nothing", () => {
    // Adding a fourth lowers every floor rather than raising the cap. The new one is below
    // its floor and the others are above theirs, so only it has room.
    const four = [...three, seg("d", 4)];
    const held = new Map([["a", 17], ["b", 17], ["c", 16]]);
    expect(allocate(four, 50, held)).toEqual([
      { segmentId: "a", share: 13, room: 0 },
      { segmentId: "b", share: 13, room: 0 },
      { segmentId: "c", share: 12, room: 0 },
      { segmentId: "d", share: 12, room: 12 },
    ]);
  });

  it("gives a single segment the lot", () => {
    expect(allocate([seg("a", 1)], 50, none)).toEqual([{ segmentId: "a", share: 50, room: 50 }]);
  });

  it("has nothing to say about no segments", () => {
    expect(allocate([], 50, none)).toEqual([]);
  });

  it("copes with more segments than the cap", () => {
    const many = Array.from({ length: 4 }, (_, i) => seg(`s${i}`, i + 1));
    const shares = allocate(many, 3, none).map((a) => a.share);
    expect(shares).toEqual([1, 1, 1, 0]);
    expect(shares.reduce((a, b) => a + b)).toBe(3);
  });
});

describe("pinned shares", () => {
  it("come off the top, and the rest is divided between the others", () => {
    expect(allocate([seg("a", 1, 30), seg("b", 2), seg("c", 3)], 50, none).map((x) => x.share)).toEqual([30, 10, 10]);
  });

  it("cannot exceed the operator's own cap", () => {
    // Pinning 80 of a 50 buffer is a mistake, not an instruction to hold 80.
    expect(allocate([seg("a", 1, 80), seg("b", 2)], 50, none).map((x) => x.share)).toEqual([50, 0]);
  });

  it("leaves nothing for the rest when they take everything", () => {
    expect(allocate([seg("a", 1, 25), seg("b", 2, 25), seg("c", 3)], 50, none).map((x) => x.share)).toEqual([25, 25, 0]);
  });
});

describe("allocateWithinCap", () => {
  it("is the same as the floors when nothing else is holding the buffer", () => {
    expect(allocateWithinCap(three, 50, none, 0).map((a) => a.room)).toEqual([17, 17, 16]);
  });

  it("refuses to exceed the buffer, whatever the floors add up to", () => {
    // Prospects with no segment, or whose segment was retired, still occupy the buffer, so
    // the floors can promise more than the cap has left. The cap wins.
    const rooms = allocateWithinCap(three, 50, new Map([["a", 5]]), 45);
    expect(rooms.reduce((sum, a) => sum + a.room, 0)).toBe(5);
  });

  it("gives the headroom to the highest priority first when it will not go round", () => {
    expect(allocateWithinCap(three, 50, none, 48).map((a) => a.room)).toEqual([2, 0, 0]);
  });

  it("gives nothing at all once the buffer is full", () => {
    expect(allocateWithinCap(three, 50, none, 50).every((a) => a.room === 0)).toBe(true);
    expect(allocateWithinCap(three, 50, none, 60).every((a) => a.room === 0)).toBe(true);
  });
});

describe("automaticShares", () => {
  const evidence = (entries: Record<string, { sent: number; replies: number }>) => new Map(Object.entries(entries));

  it("holds its hand until every segment has a sample worth reading", () => {
    // A reply rate off nine sends is noise, and a split built on noise is worse than an
    // even one because it looks like a decision.
    const thin = evidence({ a: { sent: 40, replies: 8 }, b: { sent: 40, replies: 1 }, c: { sent: 9, replies: 0 } });
    expect(automaticShares(three, 50, thin, 15)).toBeNull();
  });

  it("waits on the quiet segment too, not just the ones doing well", () => {
    // Weighting while c is unmeasured would starve it on figures it never had the chance
    // to produce, after which it can never disprove them.
    expect(automaticShares(three, 50, evidence({ a: { sent: 90, replies: 20 }, b: { sent: 90, replies: 2 } }), 15)).toBeNull();
  });

  it("weights by reply rate once there is evidence from all of them", () => {
    const shares = automaticShares(
      three,
      50,
      evidence({ a: { sent: 100, replies: 20 }, b: { sent: 100, replies: 10 }, c: { sent: 100, replies: 10 } }),
      15,
    )!;
    expect([...shares.values()].reduce((x, y) => x + y)).toBe(50);
    // Twice the rate, so more of the shared remainder — but never twice the share, because
    // the floor is held back from the weighting.
    expect(shares.get("a")!).toBeGreaterThan(shares.get("b")!);
    expect(shares.get("a")!).toBeLessThan(shares.get("b")! * 2);
    // Equal rates, so equal within the one prospect that cannot be divided. Somebody has
    // to have it, and the higher priority does.
    expect(shares.get("b")! - shares.get("c")!).toBe(1);
  });

  it("gives the same answer whatever order the rows arrived in", () => {
    const ev = evidence({ a: { sent: 100, replies: 20 }, b: { sent: 100, replies: 10 }, c: { sent: 100, replies: 10 } });
    const forwards = automaticShares(three, 50, ev, 15)!;
    const backwards = automaticShares([...three].reverse(), 50, ev, 15)!;
    expect([...backwards.entries()].sort()).toEqual([...forwards.entries()].sort());
  });

  it("never starves a segment, however badly it is doing", () => {
    // The floor is what makes the weighting falsifiable instead of self-fulfilling.
    const shares = automaticShares(
      three,
      50,
      evidence({ a: { sent: 100, replies: 40 }, b: { sent: 100, replies: 0 }, c: { sent: 100, replies: 0 } }),
      15,
    )!;
    expect(shares.get("b")!).toBeGreaterThanOrEqual(Math.floor((50 / 3) * EXPLORATION_FLOOR));
    expect([...shares.values()].reduce((x, y) => x + y)).toBe(50);
  });

  it("stays even when there is a sample and no signal in it", () => {
    expect(
      automaticShares(three, 50, evidence({ a: { sent: 50, replies: 0 }, b: { sent: 50, replies: 0 }, c: { sent: 50, replies: 0 } }), 15),
    ).toBeNull();
  });

  it("has nothing to say about no segments", () => {
    expect(automaticShares([], 50, new Map(), 15)).toBeNull();
  });
});

describe("allocate with weighted targets", () => {
  const targets = new Map([["a", 30], ["b", 10], ["c", 10]]);

  it("uses them instead of the even split, and still adds up to the cap", () => {
    const shares = allocate(three, 50, none, targets).map((x) => x.share);
    expect(shares).toEqual([30, 10, 10]);
    expect(shares.reduce((x, y) => x + y)).toBe(50);
  });

  it("lets a pin overrule the arithmetic, and scales the rest to what is left", () => {
    // The operator asked for that number explicitly. A weighting does not get to overrule it.
    const shares = allocate([seg("a", 1, 20), seg("b", 2), seg("c", 3)], 50, none, targets).map((x) => x.share);
    expect(shares[0]).toBe(20);
    expect(shares.reduce((x, y) => x + y)).toBe(50);
    expect(shares[1]).toBe(shares[2]);
  });

  it("falls back to the even split when the targets say nothing", () => {
    expect(allocate(three, 50, none, new Map()).map((x) => x.share)).toEqual([17, 17, 16]);
  });
});
