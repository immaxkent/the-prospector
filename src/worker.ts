/**
 * Worker process: drains the job queue and fires the day's runs.
 * Runs alongside the web server on the box; stop it with SIGINT or SIGTERM.
 */
import { hostname } from "node:os";
import { closeDb, getDb } from "./server/db/client";
import { getConfig } from "./server/config";
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
  console.log(`worker ${workerId} started · daily runs queue after ${config.dailyRunHour}:00`);
  await startWorker(getDb(), {
    workerId,
    scheduleHour: config.dailyRunHour,
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
