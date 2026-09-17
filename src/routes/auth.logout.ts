import { createFileRoute } from "@tanstack/react-router";
import { handleLogout } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { getConfig } from "@/server/config";

export const Route = createFileRoute("/auth/logout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const config = getConfig();
        return handleLogout(request, { config, db: config.mode === "live" ? getDb() : ({} as never) });
      },
    },
  },
});
