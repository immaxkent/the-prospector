/**
 * Worker process: drains the job queue and fires the day's runs.
 * Runs alongside the web server on the box; stop it with SIGINT or SIGTERM.
 */
import { hostname } from "node:os";
import { closeDb, getDb } from "./server/db/client";
import { getConfig } from "./server/config";
import { createAgentDeps } from "./server/agent/deps";
import { createSendDeps } from "./server/commands/send-deps";
import { channelFor } from "./server/notify/channels";
import { startWorker } from "./server/jobs/worker";

async function main() {
  const config = getConfig();
  if (config.mode !== "live") throw new Error("the worker needs DATABASE_URL");
  const workerId = `${hostname()}:${process.pid}`;
  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log(`${signal} received; finishing the current job`);
      controller.abort();
    });
  }
  const agent = await createAgentDeps(config, getDb());
  const mail = createSendDeps(config);
  const notifications = channelFor(config);
  console.log(
    `worker ${workerId} started · daily runs queue after ${config.dailyRunHour}:00 · ${agent ? `model ${config.model}` : "no Claude configured: research and qualification will be skipped"} · notifications via ${notifications.name}`,
  );
  await startWorker(getDb(), {
    workerId,
    scheduleHour: config.dailyRunHour,
    agent,
    mail,
    notifications,
    signal: controller.signal,
    onTick: (r) => {
      if (r.recovered || r.queued || r.processed || r.failed) {
        console.log(`tick: recovered ${r.recovered} · queued ${r.queued} · processed ${r.processed} · failed ${r.failed}`);
      }
    },
  });
  await closeDb();
  console.log("worker stopped");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
