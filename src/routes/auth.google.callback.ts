import { createFileRoute } from "@tanstack/react-router";
import { handleGoogleCallback } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { getConfig } from "@/server/config";

export const Route = createFileRoute("/auth/google/callback")({
  server: {
    handlers: {
      GET: ({ request }) => handleGoogleCallback(request, { config: getConfig(), db: getDb() }),
    },
  },
});
