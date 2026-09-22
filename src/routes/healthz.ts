import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { BUILD_INFO } from "@/build-info";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";

/** Liveness and readiness for the box: reports the database rather than assuming it. */
export const Route = createFileRoute("/healthz")({
  server: {
    handlers: {
      GET: async () => {
        const config = getConfig();
        const body: Record<string, unknown> = {
          mode: config.mode,
          model: config.model,
          version: BUILD_INFO.version,
          commit: BUILD_INFO.commit,
          builtAt: BUILD_INFO.builtAt,
          time: new Date().toISOString(),
        };
        if (config.mode !== "live") {
          return new Response(JSON.stringify({ status: "ok", ...body }), {
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
        try {
          await getDb().execute(sql`select 1`);
          body["database"] = "ok";
        } catch (err) {
          body["database"] = "unreachable";
          body["error"] = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ status: "degraded", ...body }), {
            status: 503,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
        return new Response(JSON.stringify({ status: "ok", ...body }), {
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
