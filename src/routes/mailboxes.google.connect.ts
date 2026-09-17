import { createFileRoute } from "@tanstack/react-router";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { handleMailboxConnectStart } from "@/server/mailboxes/connect-http";

export const Route = createFileRoute("/mailboxes/google/connect")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const config = getConfig();
        return handleMailboxConnectStart(request, { config, db: config.mode === "live" ? getDb() : ({} as never) });
      },
    },
  },
});
