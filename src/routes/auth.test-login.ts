import { createFileRoute } from "@tanstack/react-router";
import { handleTestLogin } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { getConfig } from "@/server/config";

// E2E only. Returns 404 unless AUTH_TEST_LOGIN_SECRET is set outside production.
export const Route = createFileRoute("/auth/test-login")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const config = getConfig();
        if (config.mode !== "live" || config.production || !config.testLoginSecret) {
          return new Response("not found", { status: 404 });
        }
        return handleTestLogin(request, { config, db: getDb() });
      },
    },
  },
});
