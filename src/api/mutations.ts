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

const limitsSchema = z.object({
  dailyCap: z.number().int().positive().max(2000),
  weeklyCap: z.number().int().positive().max(10000),
  warmup: z
    .object({ startedOn: z.iso.date(), startCap: z.number().int().positive(), incrementPerDay: z.number().int().min(0) })
    .nullable(),
  quietHours: z.object({ start: z.number().int().min(0).max(23), end: z.number().int().min(0).max(23) }),
  timezone: z.string().min(1).max(64),
});

export const updateMailboxLimitsFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(z.object({ mailboxId: id, limits: limitsSchema }))
  .handler(async ({ data }) => {
    const { updateMailboxLimits } = await import("../server/commands/mailboxes");
    await updateMailboxLimits(await live(), data);
    return { ok: true as const };
  });

export const disconnectMailboxFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(z.object({ mailboxId: id }))
  .handler(async ({ data }) => {
    const { disconnectMailbox } = await import("../server/commands/mailboxes");
    await disconnectMailbox(await live(), data);
    return { ok: true as const };
  });

export const assignEndeavourMailboxFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(z.object({ endeavourId: id, mailboxId: id }))
  .handler(async ({ data }) => {
    const { assignEndeavourMailbox } = await import("../server/commands/mailboxes");
    await assignEndeavourMailbox(await live(), data);
    return { ok: true as const };
  });

export const importProspectsFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(
    z.object({
      endeavourId: id,
      segmentId: id.optional(),
      /** CSV text with a header row, or JSON rows. */
      csv: z.string().max(2_000_000),
    }),
  )
  .handler(async ({ data }) => {
    const [{ importProspects, parseCsv, importRowSchema }] = await Promise.all([import("../server/commands/import")]);
    const parsed = parseCsv(data.csv);
    if (parsed.length === 0) throw new Error("That file has no rows. A header row with at least a company column is required.");
    const rows = parsed.map((row, index) => {
      const candidate = importRowSchema.safeParse(
        Object.fromEntries(Object.entries(row).filter(([, value]) => value !== "")),
      );
      if (!candidate.success) throw new Error(`Row ${index + 2}: ${z.prettifyError(candidate.error)}`);
      return candidate.data;
    });
    return importProspects(await live(), {
      endeavourId: data.endeavourId,
      ...(data.segmentId ? { segmentId: data.segmentId } : {}),
      rows,
    });
  });
