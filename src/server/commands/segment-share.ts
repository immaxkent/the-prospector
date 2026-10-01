/**
 * Fixing a segment's share of the pending buffer by hand.
 *
 * The equal split is a default, not a judgement: it divides the buffer evenly because at
 * the volumes this runs at there is no evidence to divide it any other way. An operator who
 * has read the replies has better evidence than the arithmetic does, and this is how they
 * use it.
 *
 * Deliberately not automatic. Weighting the split towards whichever segment looks best
 * needs a sample this does not have — a hundred sends at a five per cent reply rate is
 * about five replies across every segment — and reallocating on that would starve a segment
 * on an unlucky first sixteen, after which it can never disprove it.
 */
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { endeavours, segments } from "../db/schema";
import { PENDING_CAP_RANGE } from "../domain/prospecting";
import { conflict, invalid, notFound } from "./errors";
import { recordEvent } from "./events";

export interface PinSegmentShareInput {
  segmentId: string;
  /** Null returns the segment to the equal split. */
  share: number | null;
}

export async function pinSegmentShare(db: Database, input: PinSegmentShareInput) {
  if (input.share !== null) {
    if (!Number.isInteger(input.share)) throw invalid("a share must be a whole number of prospects");
    if (input.share < 0 || input.share > PENDING_CAP_RANGE.max) {
      throw invalid(`a share must be between 0 and ${PENDING_CAP_RANGE.max}`);
    }
  }

  return db.transaction(async (tx) => {
    const [segment] = await tx.select().from(segments).where(eq(segments.id, input.segmentId)).for("update");
    if (!segment) throw notFound("segment");
    if (segment.status !== "active") throw conflict("a retired segment has no share of the buffer");

    const [endeavour] = await tx.select().from(endeavours).where(eq(endeavours.id, segment.endeavourId));
    if (!endeavour) throw notFound("endeavour");
    if (endeavour.status === "archived") throw conflict("an archived endeavour cannot be reconfigured");

    await tx.update(segments).set({ pinnedShare: input.share }).where(eq(segments.id, segment.id));

    // What the other segments are left with is the part worth recording: pinning one share
    // is a decision about all of them, and the number alone does not say that.
    const siblings = await tx
      .select({ id: segments.id, pinnedShare: segments.pinnedShare })
      .from(segments)
      .where(and(eq(segments.endeavourId, segment.endeavourId), eq(segments.status, "active")));
    const pinnedTotal = siblings.reduce((sum, s) => sum + (s.id === segment.id ? (input.share ?? 0) : (s.pinnedShare ?? 0)), 0);
    const unpinned = siblings.filter((s) => (s.id === segment.id ? input.share === null : s.pinnedShare === null)).length;

    await recordEvent(tx, {
      eventType: "segment.share_pinned",
      entityType: "segment",
      entityId: segment.id,
      endeavourId: segment.endeavourId,
      subject: segment.name,
      detail:
        input.share === null
          ? `${segment.name} returned to the equal split`
          : `${segment.name} pinned at ${input.share} of ${endeavour.settings.prospecting?.maximumPending ?? "the"} pending · ${unpinned} segment(s) share what is left`,
      data: { segmentId: segment.id, share: input.share, pinnedTotal },
    });

    return { segmentId: segment.id, share: input.share };
  }, { isolationLevel: "read committed" });
}
