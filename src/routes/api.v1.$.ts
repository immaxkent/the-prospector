import { createFileRoute } from "@tanstack/react-router";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import {
  checkApiKey,
  endeavourEvents,
  endeavourInsights,
  endeavourProspects,
  endeavourSummary,
  listEndeavours,
  receiveEvent,
  receiveSignal,
} from "@/server/api/v1";
import { EXPORT_TABLES, exportCsv, exportJson, type ExportTable } from "@/server/api/export";

const notFound = () =>
  new Response(JSON.stringify({ error: "no such endpoint" }), { status: 404, headers: { "content-type": "application/json" } });

/** Everything under /api/v1. One file so the key check cannot be forgotten on a route. */
export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const config = getConfig();
        const denied = checkApiKey(request, config);
        if (denied) return denied;
        const deps = { db: getDb(), config };
        const url = new URL(request.url);
        const path = url.pathname.replace(/^\/api\/v1\/?/, "").split("/").filter(Boolean);

        if (path[0] === "endeavours" && path.length === 1) return listEndeavours(deps);
        if (path[0] === "endeavours" && path[1]) {
          const id = path[1];
          if (path[2] === "summary") return endeavourSummary(deps, id);
          if (path[2] === "prospects") return endeavourProspects(deps, id, Number(url.searchParams.get("limit") ?? 100));
          if (path[2] === "insights") return endeavourInsights(deps, id);
          if (path[2] === "events") return endeavourEvents(deps, id, Number(url.searchParams.get("since") ?? 0));
        }
        if (path[0] === "export") {
          const endeavourId = url.searchParams.get("endeavourId");
          const format = url.searchParams.get("format") ?? "json";
          if (format === "csv") {
            const table = (url.searchParams.get("table") ?? "prospects") as ExportTable;
            if (!EXPORT_TABLES.includes(table)) {
              return new Response(JSON.stringify({ error: `table must be one of ${EXPORT_TABLES.join(", ")}` }), {
                status: 400,
                headers: { "content-type": "application/json" },
              });
            }
            return new Response(await exportCsv(getDb(), table, endeavourId), {
              headers: {
                "content-type": "text/csv; charset=utf-8",
                "content-disposition": `attachment; filename="prospector-${table}.csv"`,
              },
            });
          }
          return new Response(JSON.stringify(await exportJson(getDb(), endeavourId), null, 2), {
            headers: {
              "content-type": "application/json; charset=utf-8",
              "content-disposition": 'attachment; filename="prospector-export.json"',
            },
          });
        }
        return notFound();
      },
      POST: async ({ request }) => {
        const config = getConfig();
        const denied = checkApiKey(request, config);
        if (denied) return denied;
        const deps = { db: getDb(), config };
        const path = new URL(request.url).pathname.replace(/^\/api\/v1\/?/, "").split("/").filter(Boolean);
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "the body must be JSON" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        if (path[0] === "events") return receiveEvent(deps, body);
        if (path[0] === "signals") return receiveSignal(deps, body);
        return notFound();
      },
    },
  },
});
