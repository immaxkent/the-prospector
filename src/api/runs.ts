/** Triggering the daily loop by hand. The worker executes it; inline mode is for dev and e2e. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";
import { requireSession } from "./session";

export const runNowFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(z.object({ endeavourId: z.string().trim().min(1).max(64).optional() }))
  .handler(async ({ data }) => {
    const [{ getConfig }, { getDb }, { eq }, schema, queue, worker] = await Promise.all([
      import("../server/config"),
      import("../server/db/client"),
      import("drizzle-orm"),
      import("../server/db/schema"),
      import("../server/jobs/queue"),
      import("../server/jobs/worker"),
    ]);
    const { createAgentDeps } = await import("../server/agent/deps");
    const config = getConfig();
    if (config.mode !== "live") throw new Error("Demo mode has no worker. Connect a database to run the loop.");
    const db = getDb();

    const active = await db
      .select({ id: schema.endeavours.id })
      .from(schema.endeavours)
      .where(eq(schema.endeavours.status, "active"));
    const targets = data.endeavourId ? active.filter((e) => e.id === data.endeavourId) : active;
    if (targets.length === 0) throw new Error("There is no active endeavour to run.");

    // Minute-grained key: repeated clicks do not stack up runs, a later click still works.
    const minute = new Date().toISOString().slice(0, 16);
    let queued = 0;
    for (const target of targets) {
      const { created } = await queue.enqueue(db, {
        type: worker.DAILY_RUN_JOB,
        payload: { endeavourId: target.id, trigger: "manual" },
        idempotencyKey: `manual:${target.id}:${minute}`,
      });
      if (created) queued += 1;
    }

    if (config.workerMode === "inline") {
      await worker.tick(db, {
        workerId: "inline",
        scheduleHour: config.dailyRunHour,
        agent: await createAgentDeps(config, db),
      });
    }
    return { queued, endeavours: targets.length, executedInline: config.workerMode === "inline" };
  });
