/**
 * Operator actions. Every function requires a session, validates its input,
 * and refuses to run in demo mode where there is no database.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";
import { requireSession } from "./session";

const id = z.string().trim().min(1).max(64);

async function live() {
  const [{ getConfig }, { getDb }] = await Promise.all([import("../server/config"), import("../server/db/client")]);
  if (getConfig().mode !== "live") throw new Error("Demo mode is read-only. Connect a database to make changes.");
  return getDb();
}

export const decideApprovalFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(
    z.object({
      approvalId: id,
      decision: z.enum(["approve", "reject"]),
      editedCopy: z.string().max(20_000).optional(),
      note: z.string().max(2_000).optional(),
      prospectId: id.optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { decideApproval } = await import("../server/commands/approvals");
    await decideApproval(await live(), data);
    return { ok: true as const };
  });

export const rejectProspectFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(z.object({ prospectId: id, reason: z.string().max(500) }))
  .handler(async ({ data }) => {
    const { rejectProspect } = await import("../server/commands/prospects");
    await rejectProspect(await live(), data);
    return { ok: true as const };
  });

export const restoreProspectFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(z.object({ prospectId: id }))
  .handler(async ({ data }) => {
    const { restoreProspect } = await import("../server/commands/prospects");
    await restoreProspect(await live(), data);
    return { ok: true as const };
  });

export const suppressProspectFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(z.object({ prospectId: id, scope: z.enum(["email", "domain"]), reason: z.string().max(500) }))
  .handler(async ({ data }) => {
    const { suppressProspect } = await import("../server/commands/prospects");
    return suppressProspect(await live(), data);
  });

const STAGES = ["discovered", "researched", "qualified", "contacted", "replied", "meeting", "proposal", "won", "lost", "nurture"] as const;

export const moveProspectStageFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(z.object({ prospectId: id, to: z.enum(STAGES) }))
  .handler(async ({ data }) => {
    const { moveProspectStage } = await import("../server/commands/prospects");
    await moveProspectStage(await live(), data);
    return { ok: true as const };
  });

export const updateOpportunityFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(
    z.object({
      opportunityId: id,
      value: z.number().int().min(0).optional(),
      probability: z.number().min(0).max(1).nullable().optional(),
      expectedClose: z.iso.date().nullable().optional(),
      outcome: z.object({ stage: z.enum(["won", "lost"]), reason: z.string().trim().min(1).max(500) }).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { updateOpportunity } = await import("../server/commands/pipeline");
    await updateOpportunity(await live(), data);
    return { ok: true as const };
  });

export const setEndeavourStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(z.object({ endeavourId: id, status: z.enum(["active", "paused", "archived"]) }))
  .handler(async ({ data }) => {
    const { setEndeavourStatus } = await import("../server/commands/pipeline");
    await setEndeavourStatus(await live(), data);
    return { ok: true as const };
  });

export const markThreadReadFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(z.object({ threadId: id, unread: z.boolean().optional() }))
  .handler(async ({ data }) => {
    const { markThreadRead } = await import("../server/commands/pipeline");
    await markThreadRead(await live(), data);
    return { ok: true as const };
  });
