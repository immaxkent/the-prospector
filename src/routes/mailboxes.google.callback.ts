import { createFileRoute } from "@tanstack/react-router";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { handleMailboxConnectCallback } from "@/server/mailboxes/connect-http";

export const Route = createFileRoute("/mailboxes/google/callback")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const config = getConfig();
        return handleMailboxConnectCallback(request, { config, db: config.mode === "live" ? getDb() : ({} as never) });
      },
    },
  },
});
