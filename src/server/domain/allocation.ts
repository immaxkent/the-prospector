/**
 * Dividing the pending buffer between segments.
 *
 * The bug this replaces: the run held one target for the whole endeavour and let segments
 * take from it in priority order, stopping when it was full. The first segment filled the
 * day and the others were never asked — and because the first segment was the broad one,
 * the run produced ten prospects and nothing that qualified.
 *
 * So every segment gets a floor and keeps it. Priority still decides who gets the remainder
 * when the arithmetic does not divide evenly, which is the honest use of a priority: a
 * tie-break, not a queue.
 */

export interface SegmentAllocationInput {
  id: string;
  /** Lower runs first, and takes the remainder when the split is uneven. */
  priority: number;
  /** A share the operator fixed by hand. Null to take the equal split. */
  pinned?: number | null;
}

export interface SegmentAllocation {
  segmentId: string;
  /** How many pending prospects this segment may hold in total. */
  share: number;
  /** How many it may add now: its share less what it is already holding, never negative. */
  room: number;
}

/**
 * Shares first, then room.
 *
 * A segment over its share — the cap was lowered, or a segment was added — is not asked to
 * give anything back. Prospects are not deleted to balance a ledger; it simply gets nothing
 * new until the ones it has resolve.
 */
export function allocate(
  segments: readonly SegmentAllocationInput[],
  maximumPending: number,
  pendingBySegment: ReadonlyMap<string, number>,
): SegmentAllocation[] {
  if (segments.length === 0) return [];

  const ordered = [...segments].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  // Pinned shares are honoured first and come off the top. Beyond the cap they are held to
  // it: the operator's arithmetic does not get to exceed the operator's own limit.
  let pinnedTotal = 0;
  const pinned = new Map<string, number>();
  for (const segment of ordered) {
    if (segment.pinned === null || segment.pinned === undefined) continue;
    const want = Math.max(0, Math.round(segment.pinned));
    const given = Math.min(want, Math.max(0, maximumPending - pinnedTotal));
    pinned.set(segment.id, given);
    pinnedTotal += given;
  }

  const rest = ordered.filter((s) => !pinned.has(s.id));
  const remaining = Math.max(0, maximumPending - pinnedTotal);
  const each = rest.length === 0 ? 0 : Math.floor(remaining / rest.length);
  // What does not divide evenly goes to the highest priorities, one each. Somebody has to
  // get the odd one and priority is the only ordering there is.
  let spare = remaining - each * rest.length;

  const shares = new Map<string, number>(pinned);
  for (const segment of rest) {
    const extra = spare > 0 ? 1 : 0;
    spare -= extra;
    shares.set(segment.id, each + extra);
  }

  return ordered.map((segment) => {
    const share = shares.get(segment.id) ?? 0;
    const held = pendingBySegment.get(segment.id) ?? 0;
    return { segmentId: segment.id, share, room: Math.max(0, share - held) };
  });
}

/**
 * What the run may actually add, once the whole-endeavour cap has its say.
 *
 * The floors are about fairness between segments; the cap is about the operator. A prospect
 * with no segment, or one whose segment was retired, still occupies the buffer, so the sum
 * of the floors can exceed what the buffer has left. The cap wins.
 */
export function allocateWithinCap(
  segments: readonly SegmentAllocationInput[],
  maximumPending: number,
  pendingBySegment: ReadonlyMap<string, number>,
  totalPending: number,
): SegmentAllocation[] {
  const headroom = Math.max(0, maximumPending - totalPending);
  const allocations = allocate(segments, maximumPending, pendingBySegment);

  let left = headroom;
  return allocations.map((allocation) => {
    const room = Math.min(allocation.room, left);
    left -= room;
    return { ...allocation, room };
  });
}
