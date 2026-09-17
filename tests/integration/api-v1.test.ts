import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  API_SCHEMA_VERSION,
  checkApiKey,
  endeavourEvents,
  endeavourInsights,
  endeavourProspects,
  endeavourSummary,
  listEndeavours,
  receiveEvent,
  receiveSignal,
} from "../../src/server/api/v1";
import { exportCsv, exportJson, toCsv } from "../../src/server/api/export";
import { loadConfig } from "../../src/server/config";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());

const KEY = "a-long-enough-api-key-for-tests";
const config = loadConfig({ DATABASE_URL: process.env["DATABASE_URL"], API_KEYS: KEY });
const deps = { db, config };
const authed = (init: RequestInit = {}) =>
  new Request("http://localhost/api/v1/endeavours", { ...init, headers: { authorization: `Bearer ${KEY}`, ...(init.headers ?? {}) } });
const body = async (res: Response) => res.json() as Promise<Record<string, unknown>>;

beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
});

describe("authentication", () => {
  it("accepts a bearer token or an X-API-Key header", () => {
    expect(checkApiKey(authed(), config)).toBeNull();
    expect(checkApiKey(new Request("http://localhost/api/v1", { headers: { "x-api-key": KEY } }), config)).toBeNull();
  });

  it("refuses a missing, wrong or unconfigured key", async () => {
    expect((await checkApiKey(new Request("http://localhost/api/v1"), config)!).status).toBe(401);
    const wrong = new Request("http://localhost/api/v1", { headers: { authorization: "Bearer not-the-right-key-at-all" } });
    expect((await checkApiKey(wrong, config)!).status).toBe(403);
    expect(checkApiKey(authed(), { ...config, apiKeys: [] })!.status).toBe(503);
    expect(checkApiKey(authed(), { ...config, mode: "demo" })!.status).toBe(503);
  });
});

describe("reads", () => {
  it("lists endeavours with their objective and status", async () => {
    const result = await body(await listEndeavours(deps));
    expect(result["schemaVersion"]).toBe(API_SCHEMA_VERSION);
    const [endeavour] = result["endeavours"] as Record<string, unknown>[];
    expect(endeavour).toMatchObject({ id: FIXTURE_IDS.endeavour, status: "active", kind: "sprint" });
    expect(endeavour!["objective"]).toMatchObject({ metric: "revenue", target: 3000 });
  });

  it("summarises the pipeline by stage", async () => {
    const result = await body(await endeavourSummary(deps, FIXTURE_IDS.endeavour));
    expect(result["prospects"]).toMatchObject({ total: 1, rejected: 0, byStage: { replied: 1 } });
    expect((await endeavourSummary(deps, "end_missing")).status).toBe(404);
  });

  it("returns prospect state without contact details", async () => {
    const result = await body(await endeavourProspects(deps, FIXTURE_IDS.endeavour));
    const [prospect] = result["prospects"] as Record<string, unknown>[];
    expect(prospect).toMatchObject({ company: "Northbridge Protocol", person: "Ilse Vermeer", stage: "replied", score: 92 });
    expect(JSON.stringify(result)).not.toContain("ilse@northbridge.example");
  });

  it("returns open insights only", async () => {
    await db.insert(t.insights).values([
      { id: "ins_open", endeavourId: FIXTURE_IDS.endeavour, type: "recommendation", statement: "Send more to launch-stage", evidence: {}, confidence: 0.8 },
      { id: "ins_done", endeavourId: FIXTURE_IDS.endeavour, type: "observation", statement: "Old news", evidence: {}, confidence: 0.5, status: "dismissed" },
    ]);
    const result = await body(await endeavourInsights(deps, FIXTURE_IDS.endeavour));
    expect((result["insights"] as unknown[]).map((i) => (i as { id: string }).id)).toEqual(["ins_open"]);
  });

  it("pages events from a cursor without repeating them", async () => {
    const base = { sourceSystem: "prospector", entityType: "endeavour", entityId: FIXTURE_IDS.endeavour, payload: {} };
    await db.insert(t.events).values([
      { id: "evt_1", eventType: "endeavour.activated", ...base },
      { id: "evt_2", eventType: "message.sent", ...base },
    ]);
    const first = await body(await endeavourEvents(deps, FIXTURE_IDS.endeavour, 0));
    expect((first["events"] as unknown[]).length).toBe(2);
    const next = await body(await endeavourEvents(deps, FIXTURE_IDS.endeavour, first["cursor"] as number));
    expect(next["events"]).toEqual([]);
    expect(next["cursor"]).toBe(first["cursor"]);
  });
});

describe("writes", () => {
  it("accepts an external event and marks whether it is canonical", async () => {
    const accepted = await receiveEvent(deps, {
      type: "product.milestone.completed",
      entityId: "milestone_7",
      endeavourId: FIXTURE_IDS.endeavour,
      payload: { name: "Testnet live" },
    });
    expect(accepted.status).toBe(202);
    expect(await body(accepted)).toMatchObject({ accepted: true, canonical: true });
    const [stored] = await db.select().from(t.events).where(eq(t.events.eventType, "product.milestone.completed"));
    expect(stored).toMatchObject({ sourceSystem: "external" });
    expect(stored!.payload).toMatchObject({ name: "Testnet live", endeavourId: FIXTURE_IDS.endeavour });

    expect(await body(await receiveEvent(deps, { type: "something.custom", entityId: "x" }))).toMatchObject({ canonical: false });
    expect((await receiveEvent(deps, { entityId: "missing type" })).status).toBe(400);
  });

  it("records an external signal as an insight for the operator", async () => {
    const res = await receiveSignal(deps, {
      endeavourId: FIXTURE_IDS.endeavour,
      statement: "Three customers asked for SOC 2",
      evidence: { source: "support inbox" },
      confidence: 0.6,
    });
    expect(res.status).toBe(202);
    const [insight] = await db.select().from(t.insights).where(eq(t.insights.type, "signal"));
    expect(insight).toMatchObject({ statement: "Three customers asked for SOC 2", confidence: 0.6 });
    expect(insight!.evidence).toMatchObject({ source: "external" });
    expect((await receiveSignal(deps, { endeavourId: "end_missing", statement: "x" })).status).toBe(404);
  });
});

describe("export", () => {
  it("quotes CSV fields that need it", () => {
    const csv = toCsv([{ a: 'say "hi", please', b: "line\nbreak", c: null }], ["a", "b", "c"]);
    expect(csv).toBe('a,b,c\r\n"say ""hi"", please","line\nbreak",');
  });

  it("exports the whole account as JSON", async () => {
    const data = await exportJson(db);
    expect(data.endeavours).toHaveLength(1);
    expect(data.prospects).toHaveLength(1);
    expect(data.messages).toHaveLength(2);
    expect(data.evidence).toHaveLength(1);
  });

  it("exports one table as CSV with a header row", async () => {
    const csv = await exportCsv(db, "prospects");
    const [header, row] = csv.split("\r\n");
    expect(header).toBe("id,endeavourId,company,person,email,stage,reviewStatus,score,nextAction,createdAt");
    expect(row).toContain("Northbridge Protocol");
    expect(row).toContain("ilse@northbridge.example");
  });

  it("exports nothing but a header when there is nothing to export", async () => {
    await db.delete(t.endeavours);
    expect(await exportCsv(db, "prospects")).toBe("id");
    expect((await exportJson(db)).endeavours).toEqual([]);
  });
});
