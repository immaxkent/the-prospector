import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { FixtureAgentLlm } from "../../src/server/agent/fixture";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { runDailyLoop } from "../../src/server/jobs/daily-run";
import { dbRecorder } from "../../src/server/llm/recorder";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());
beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
});

const NOW = new Date("2026-09-17T09:00:00Z");
const agent = () => ({ llm: new FixtureAgentLlm(), model: "claude-opus-5", record: dbRecorder(db) });
const run = (over: Partial<Parameters<typeof runDailyLoop>[1]> = {}) =>
  runDailyLoop(db, { endeavourId: FIXTURE_IDS.endeavour, trigger: "manual", now: NOW, ...over });

const logText = async () => (await db.select().from(t.runLog)).map((l) => l.text).join("\n");

describe("daily run with an agent", () => {
  it("researches, stores evidence and qualifies what it found", async () => {
    const { runId } = await run({ agent: agent() });

    const found = await db.select().from(t.prospects).where(eq(t.prospects.source, "web_research"));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ reviewStatus: "needs_review", segmentId: FIXTURE_IDS.segment });
    expect(found[0]!.qualificationScore).toBe(76);
    expect(found[0]!.scoreFactors).toHaveLength(7);
    expect(found[0]!.scoreReason).toContain("Fixture qualification");

    const claims = await db.select().from(t.evidence).where(eq(t.evidence.entityId, found[0]!.id));
    expect(claims[0]).toMatchObject({ sourceRef: "https://havsledd.example/postmortem", runId });

    const text = await logText();
    expect(text).toContain("1 proposed");
    expect(text).toContain("needs_review");

    const calls = await db.select().from(t.llmCalls);
    expect(calls.map((c) => c.role).sort()).toEqual(["research.discover", "research.qualify"]);
    expect(calls.every((c) => c.status === "ok" && c.costUsd > 0)).toBe(true);
  });

  it("reports honestly when Claude is not configured", async () => {
    await run();
    const [row] = await db.select().from(t.dailyRuns);
    const brief = row!.brief as { risks: string[] };
    expect(brief.risks.join(" ")).toContain("Claude is not configured");
    expect(await db.select().from(t.prospects).where(eq(t.prospects.source, "web_research"))).toHaveLength(0);
  });

  it("stops researching once the day's target is met", async () => {
    await run({ agent: agent() });
    await db.delete(t.dailyRuns);
    await run({ agent: agent(), now: new Date("2026-09-17T11:00:00Z") });
    // The fixture agent offers the same candidate; it is already known, so nothing is added.
    expect(await db.select().from(t.prospects).where(eq(t.prospects.source, "web_research"))).toHaveLength(1);
    expect(await logText()).toContain("already known");
  });
});
