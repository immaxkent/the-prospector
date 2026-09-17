import { createFileRoute } from "@tanstack/react-router";
import { handleGoogleStart } from "@/server/auth/http";
import { getConfig } from "@/server/config";

export const Route = createFileRoute("/auth/google")({
  server: {
    handlers: {
      GET: ({ request }) => handleGoogleStart(request, getConfig()),
    },
  },
});
