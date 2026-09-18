/** Reading and revising a running endeavour's strategy. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";
import { requireSession } from "./session";

const id = z.string().trim().min(1).max(64);

async function live() {
  const [{ getConfig }, { getDb }] = await Promise.all([import("../server/config"), import("../server/db/client")]);
  if (getConfig().mode !== "live") throw new Error("Demo mode is read-only. Connect a database to make changes.");
  return getDb();
}

export const fetchEndeavourSpecFn = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(z.object({ endeavourId: id }))
  .handler(async ({ data }) => {
    const [{ eq }, schema, { specHistory }] = await Promise.all([
      import("drizzle-orm"),
      import("../server/db/schema"),
      import("../server/commands/revise"),
    ]);
    const db = await live();
    const [endeavour] = await db.select().from(schema.endeavours).where(eq(schema.endeavours.id, data.endeavourId));
    if (!endeavour) throw new Error("No endeavour with that id.");
    const history = await specHistory(db, data.endeavourId);
    return {
      spec: endeavour.spec,
      version: endeavour.specVersion,
      brief: endeavour.brief,
      status: endeavour.status,
      history: history.map((h) => ({ version: h.version, reason: h.reason, createdAt: h.createdAt.toISOString() })),
    };
  });

export const reviseEndeavourSpecFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(z.object({ endeavourId: id, spec: z.unknown(), reason: z.string().max(500) }))
  .handler(async ({ data }) => {
    const { reviseEndeavourSpec } = await import("../server/commands/revise");
    return reviseEndeavourSpec(await live(), {
      endeavourId: data.endeavourId,
      spec: data.spec as never,
      reason: data.reason,
    });
  });
