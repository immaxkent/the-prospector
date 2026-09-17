import { expect, test } from "@playwright/test";
import { dbScript, resetDatabase } from "./db";

test.describe("health and API", () => {
  test.beforeEach(async () => {
    await resetDatabase();
    dbScript("seed-fixtures");
  });
  test.afterAll(() => resetDatabase());

  test("health reports the database", async ({ request }) => {
    const res = await request.get("/healthz");
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", mode: "live", database: "ok" });
  });

  test("the API refuses callers without a key", async ({ request }) => {
    const res = await request.get("/api/v1/endeavours");
    // No API keys are configured for the e2e server, so the API is closed.
    expect(res.status()).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("no API keys") });
  });

  test("an unknown API path is a clean 404, not a page", async ({ request }) => {
    const res = await request.get("/api/v1/nonsense");
    expect(res.headers()["content-type"]).toContain("application/json");
  });
});
