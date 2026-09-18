import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { changedFields, reviseEndeavourSpec, specHistory } from "../../src/server/commands/revise";
import { FIXTURE_IDS, fixtureSpec, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import type { EndeavourSpec } from "../../src/server/domain/endeavour-spec";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());
beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
});

const base = () => fixtureSpec(FIXTURE_IDS.mailbox);
const revise = (spec: EndeavourSpec, reason = "Narrowing the segment") =>
  reviseEndeavourSpec(db, { endeavourId: FIXTURE_IDS.endeavour, spec, reason });

const endeavour = async () => (await db.select().from(t.endeavours).where(eq(t.endeavours.id, FIXTURE_IDS.endeavour)))[0]!;

describe("changedFields", () => {
  it("names only what actually changed", () => {
    const before = base();
    const after = { ...before, name: "New name" };
    expect(changedFields(before, after)).toEqual(["name"]);
    expect(changedFields(before, before)).toEqual([]);
  });
});

describe("reviseEndeavourSpec", () => {
  it("stores a new version, keeps the old one and records the reason", async () => {
    const spec = { ...base(), name: "£5K Solidity Sprint" };
    spec.objective = { state: "confirmed", value: { metric: "revenue", target: 5000, unit: "GBP", currency: "GBP" } };

    const result = await revise(spec, "Raising the target after two wins");
    expect(result).toMatchObject({ version: 2 });
    expect(result.changed).toEqual(expect.arrayContaining(["name", "objective"]));

    const row = await endeavour();
    expect(row).toMatchObject({ specVersion: 2, name: "£5K Solidity Sprint" });
    expect(row.spec.objective).toMatchObject({ value: { target: 5000 } });

    const history = await specHistory(db, FIXTURE_IDS.endeavour);
    expect(history.map((h) => h.version)).toEqual([2]);
    expect(history[0]).toMatchObject({ reason: "Raising the target after two wins" });
    expect((await db.select().from(t.events)).map((e) => e.eventType)).toContain("endeavour.spec_revised");
  });

  it("adds a new segment and retires one that was dropped, keeping its prospects", async () => {
    const spec = base();
    spec.buyers = {
      state: "confirmed",
      value: [
        {
          name: "Bridges and cross-chain",
          definition: "Teams shipping bridge contracts",
          signals: ["Bridge deployed in the last 60 days"],
          painHypothesis: "Bridges are the highest-value target",
          priority: 1,
        },
      ],
    };
    const result = await revise(spec, "Bridges reply more often");
    expect(result).toMatchObject({ active: 1, retired: 1 });

    const rows = await db.select().from(t.segments).where(eq(t.segments.endeavourId, FIXTURE_IDS.endeavour));
    expect(rows.find((s) => s.name === "Launch-stage protocols")).toMatchObject({ status: "retired" });
    expect(rows.find((s) => s.name === "Bridges and cross-chain")).toMatchObject({ status: "active", specVersion: 2 });
    // The prospect found under the retired segment is untouched.
    const [prospect] = await db.select().from(t.prospects).where(eq(t.prospects.id, FIXTURE_IDS.prospect));
    expect(prospect!.segmentId).toBe(FIXTURE_IDS.segment);
  });

  it("updates the offer in place when the offering changes", async () => {
    const spec = base();
    spec.offering = {
      state: "confirmed",
      value: { summary: "Pre-audit review and fix verification", deliverables: ["Findings report", "Fix review"] },
    };
    await revise(spec, "Adding fix verification");
    const rows = await db.select().from(t.offers).where(eq(t.offers.endeavourId, FIXTURE_IDS.endeavour));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Pre-audit review and fix verification", specVersion: 2 });
    expect(rows[0]!.proposition).toContain("Fix review");
  });

  it("refuses a revision that would not pass the activation checks", async () => {
    const spec = base();
    spec.pricing = { state: "suggested", value: { model: "package" }, rationale: "guessing" };
    await expect(revise(spec)).rejects.toMatchObject({ code: "conflict" });
    expect(await endeavour()).toMatchObject({ specVersion: 1 });
  });

  it("refuses an empty reason, an unchanged spec and an archived endeavour", async () => {
    await expect(revise(base(), "  ")).rejects.toMatchObject({ code: "invalid" });
    await expect(revise(base())).rejects.toMatchObject({ code: "conflict" });

    await db.update(t.endeavours).set({ status: "archived" }).where(eq(t.endeavours.id, FIXTURE_IDS.endeavour));
    await expect(revise({ ...base(), name: "Another name" })).rejects.toThrow("archived");
  });
});
