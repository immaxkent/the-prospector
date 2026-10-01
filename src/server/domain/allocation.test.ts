import { describe, expect, it } from "vitest";
import { allocate, allocateWithinCap, type SegmentAllocationInput } from "./allocation";

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
