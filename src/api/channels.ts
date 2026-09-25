/** Connecting notification channels. Credentials reach the server and stop there. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";
import { requireSession } from "./session";

const id = z.string().trim().min(1).max(64);

async function deps() {
  const [{ getConfig }, { getDb }] = await Promise.all([import("../server/config"), import("../server/db/client")]);
  const config = getConfig();
  if (config.mode !== "live") throw new Error("Demo mode has no database, so channels cannot be connected.");
  if (!config.tokenKey) throw new Error("TOKEN_ENCRYPTION_KEY is not set, so a credential cannot be stored safely.");
  return { db: getDb(), deps: { tokenKey: config.tokenKey, appUrl: config.appUrl } };
}

export const listChannelsFn = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(async () => {
    const { db } = await deps();
    const { listChannels } = await import("../server/commands/channels");
    return listChannels(db);
  });

export const connectChannelFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(
    z.object({
      provider: z.string().trim().min(1).max(30),
      values: z.record(z.string(), z.string().max(500)),
    }),
  )
  .handler(async ({ data }) => {
    const { db, deps: channelDeps } = await deps();
    const { connectChannel } = await import("../server/commands/channels");
    return connectChannel(db, channelDeps, data);
  });

export const testChannelFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(z.object({ channelId: id }))
  .handler(async ({ data }) => {
    const { db, deps: channelDeps } = await deps();
    const { testChannel } = await import("../server/commands/channels");
    return testChannel(db, channelDeps, data);
  });

export const disconnectChannelFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(z.object({ channelId: id }))
  .handler(async ({ data }) => {
    const { db } = await deps();
    const { disconnectChannel } = await import("../server/commands/channels");
    await disconnectChannel(db, data);
    return { ok: true as const };
  });
