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
  /**
   * Shares to use instead of the even split, from {@link automaticShares}. A pinned share
   * still wins: the operator asked for that number explicitly, and arithmetic does not get
   * to overrule it.
   */
  targets?: ReadonlyMap<string, number> | undefined,
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

  // Weighted shares are scaled to whatever the pins left behind, so pinning one segment
  // does not quietly hand the rest more than the cap allows.
  if (targets && rest.length > 0) {
    const wanted = rest.map((s) => ({ id: s.id, want: targets.get(s.id) ?? 0 }));
    const total = wanted.reduce((sum, w) => sum + w.want, 0);
    if (total > 0) {
      const scaled = wanted.map((w) => ({ id: w.id, want: (w.want / total) * remaining }));
      const shares = new Map<string, number>(pinned);
      for (const entry of scaled) shares.set(entry.id, Math.floor(entry.want));
      let spare = remaining - scaled.reduce((sum, e) => sum + Math.floor(e.want), 0);
      for (const entry of [...scaled].sort((a, b) => (b.want % 1) - (a.want % 1))) {
        if (spare <= 0) break;
        shares.set(entry.id, (shares.get(entry.id) ?? 0) + 1);
        spare -= 1;
      }
      return ordered.map((segment) => {
        const share = shares.get(segment.id) ?? 0;
        const held = pendingBySegment.get(segment.id) ?? 0;
        return { segmentId: segment.id, share, room: Math.max(0, share - held) };
      });
    }
  }

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

/* ---------- weighting the split by what the segments actually did ---------- */

export interface SegmentEvidence {
  /** Outbound messages actually sent for this segment. */
  sent: number;
  /** Prospects of this segment that replied. One each, however many messages they sent. */
  replies: number;
}

/**
 * The share of its even allocation a segment keeps whatever the evidence says.
 *
 * Without it, a segment that performs badly early is given less, sends less, and can never
 * gather the evidence to disprove the first impression. The floor is what makes the
 * weighting falsifiable rather than self-fulfilling.
 */
export const EXPLORATION_FLOOR = 0.5;

/**
 * Shares weighted by reply rate, or null when the evidence is too thin to use.
 *
 * Null is the important return. A reply rate off nine sends is noise, and a split built on
 * noise is worse than an even one because it looks like a decision. So this holds its hand
 * until **every** active segment has reached the sample — not just the ones doing well. The
 * alternative starves the quiet segment on the strength of figures it was never given the
 * chance to produce, which is exactly the trap the floor exists to avoid, one level up.
 *
 * Rates are cumulative rather than weekly on purpose: a fortnight's figures swing on one
 * reply, and nothing here should move that fast.
 */
export function automaticShares(
  segments: readonly SegmentAllocationInput[],
  maximumPending: number,
  evidence: ReadonlyMap<string, SegmentEvidence>,
  minSample: number,
): Map<string, number> | null {
  if (segments.length === 0) return null;
  // Priority order, so the result does not depend on the order rows came back in. Somebody
  // has to get the odd prospect when two segments tie, and priority is the only ordering
  // this module has.
  const ordered = [...segments].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const facts = ordered.map((s) => ({ id: s.id, ...(evidence.get(s.id) ?? { sent: 0, replies: 0 }) }));
  if (facts.some((f) => f.sent < minSample)) return null;

  const even = maximumPending / ordered.length;
  const floor = Math.max(1, Math.floor(even * EXPLORATION_FLOOR));
  const floors = Math.min(maximumPending, floor * ordered.length);
  const toShare = maximumPending - floors;

  const weights = facts.map((f) => ({ id: f.id, weight: f.replies / f.sent }));
  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  // Armed, but nobody has replied to anything. There is a sample and no signal in it, so
  // the even split is still the honest answer.
  if (total <= 0) return null;

  // Largest remainder, so the shares are whole numbers that still add up to the cap.
  const exact = weights.map((w) => ({ id: w.id, want: (w.weight / total) * toShare }));
  const shares = new Map(exact.map((e) => [e.id, floor + Math.floor(e.want)]));
  let left = maximumPending - [...shares.values()].reduce((sum, n) => sum + n, 0);
  for (const entry of [...exact].sort((a, b) => (b.want % 1) - (a.want % 1))) {
    if (left <= 0) break;
    shares.set(entry.id, (shares.get(entry.id) ?? 0) + 1);
    left -= 1;
  }
  return shares;
}
