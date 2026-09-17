import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  abandonIntake,
  activateIntake,
  answerIntake,
  editIntakeField,
  startIntake,
  updateIntakeSettings,
} from "../../src/server/commands/intake";
import * as t from "../../src/server/db/schema";
import { DEFAULT_MAILBOX_LIMITS } from "../../src/server/domain/mailbox";
import { FakeLlm } from "../../src/server/llm/fake";
import type { LlmCallRecord } from "../../src/server/llm/structured";
import { solidityPlannerOutput } from "../../src/server/intake/testing";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());

const BRIEF = `I want to make £3,000 from Solidity consulting in the next 60 days.
I sell pre-audit security reviews of smart contracts.
Target launch-stage protocol teams that are close to mainnet.
I can do 10 new prospects and 8 follow-ups a day, by email.`;
const TODAY = "2026-09-17";

function planner(responses: unknown[] = [solidityPlannerOutput()]) {
  const records: LlmCallRecord[] = [];
  return { llm: new FakeLlm(responses), model: "claude-opus-5", record: async (r: LlmCallRecord) => void records.push(r), records };
}

async function mailbox(id = "mbx_intake", status: "connected" | "disconnected" = "connected") {
  await db.insert(t.mailboxes).values({
    id,
    address: `${id}@example.com`,
    displayName: id,
    provider: "google",
    status,
    limits: DEFAULT_MAILBOX_LIMITS,
  });
  return id;
}

/** Fills everything the operator must supply for the fixture brief. */
async function completeDraft(intakeId: string, mailboxId: string) {
  await editIntakeField(db, { intakeId, field: "pricing", action: "set", value: { model: "package", amount: 750, currency: "GBP" } });
  await editIntakeField(db, { intakeId, field: "proof", action: "not_applicable", reason: "New practice, no public work yet" });
  await editIntakeField(db, { intakeId, field: "exclusions", action: "set", value: [] });
  return editIntakeField(db, { intakeId, field: "mailboxId", action: "set", value: mailboxId });
}

beforeEach(() => truncateAll(handle));

describe("startIntake", () => {
  it("stores the draft, asks about every open field and reports blockers", async () => {
    const deps = planner();
    const view = await startIntake(db, deps, { brief: BRIEF, today: TODAY });
    expect(view.status).toBe("interviewing");
    expect(view.spec?.objective.state).toBe("stated");
    expect(view.spec?.channels).toEqual(["email"]);
    expect(view.questions.map((q) => q.field)).toEqual(expect.arrayContaining(["pricing", "proof", "exclusions"]));
    expect(view.ready).toBe(false);
    expect(view.blockers.map((b) => b.field)).toContain("mailboxId");
    expect(deps.records[0]).toMatchObject({ role: "intake.planner", status: "ok" });
  });

  it("refuses a brief that says almost nothing", async () => {
    await expect(startIntake(db, planner(), { brief: "sell stuff", today: TODAY })).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("answerIntake", () => {
  it("re-plans with the answer and keeps answered questions", async () => {
    const deps = planner([
      solidityPlannerOutput(),
      solidityPlannerOutput({
        pricing: { state: "stated", quote: "£750 per review", value: { model: "package", amount: 750, currency: "GBP" } },
      }),
    ]);
    const started = await startIntake(db, deps, { brief: BRIEF, today: TODAY });
    const view = await answerIntake(db, deps, {
      intakeId: started.id,
      answers: [{ field: "pricing", answer: "£750 per review" }],
      today: TODAY,
    });
    expect(view.spec?.pricing.state).toBe("stated");
    expect(view.questions.find((q) => q.field === "pricing")?.answer).toBe("£750 per review");
    expect(deps.llm.requests[1]!.user).toContain("£750 per review");
  });

  it("needs at least one answer", async () => {
    const deps = planner();
    const started = await startIntake(db, deps, { brief: BRIEF, today: TODAY });
    await expect(
      answerIntake(db, deps, { intakeId: started.id, answers: [{ field: "pricing", answer: "  " }], today: TODAY }),
    ).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("editIntakeField", () => {
  it("confirms proposals, validates replacements and records reasons", async () => {
    const started = await startIntake(db, planner(), { brief: BRIEF, today: TODAY });
    const confirmed = await editIntakeField(db, { intakeId: started.id, field: "pricing", action: "confirm" });
    expect(confirmed.spec?.pricing.state).toBe("confirmed");

    await expect(
      editIntakeField(db, { intakeId: started.id, field: "cadence", action: "set", value: { dailyNewTarget: -1 } }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      editIntakeField(db, { intakeId: started.id, field: "proof", action: "confirm" }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      editIntakeField(db, { intakeId: started.id, field: "proof", action: "not_applicable", reason: " " }),
    ).rejects.toMatchObject({ code: "invalid" });

    const na = await editIntakeField(db, { intakeId: started.id, field: "proof", action: "not_applicable", reason: "New practice" });
    expect(na.spec?.proof).toEqual({ state: "not_applicable", reason: "New practice" });
  });

  it("refuses autonomy levels that are disabled in v1", async () => {
    const started = await startIntake(db, planner(), { brief: BRIEF, today: TODAY });
    await expect(updateIntakeSettings(db, { intakeId: started.id, autonomyLevel: "DELEGATED" })).rejects.toThrow("not available");
    const view = await updateIntakeSettings(db, { intakeId: started.id, name: "Solidity sprint", autonomyLevel: "OBSERVE" });
    expect(view.spec).toMatchObject({ name: "Solidity sprint", autonomyLevel: "OBSERVE" });
  });
});

describe("activateIntake", () => {
  it("refuses while anything is unresolved", async () => {
    const started = await startIntake(db, planner(), { brief: BRIEF, today: TODAY });
    await expect(activateIntake(db, { intakeId: started.id })).rejects.toMatchObject({ code: "conflict" });
    expect(await db.select().from(t.endeavours)).toHaveLength(0);
  });

  it("refuses a mailbox that is not connected", async () => {
    const id = await mailbox("mbx_off", "disconnected");
    const started = await startIntake(db, planner(), { brief: BRIEF, today: TODAY });
    await completeDraft(started.id, id);
    await expect(activateIntake(db, { intakeId: started.id })).rejects.toThrow("not connected");
  });

  it("creates the endeavour, its first spec version, segments and offer once", async () => {
    const id = await mailbox();
    const started = await startIntake(db, planner(), { brief: BRIEF, today: TODAY });
    const ready = await completeDraft(started.id, id);
    expect(ready.ready).toBe(true);

    const { endeavourId } = await activateIntake(db, { intakeId: started.id });
    const [endeavour] = await db.select().from(t.endeavours);
    expect(endeavour).toMatchObject({ id: endeavourId, status: "active", mailboxId: id, specVersion: 1, brief: BRIEF });
    expect(endeavour!.activatedAt).not.toBeNull();

    expect(await db.select().from(t.endeavourSpecVersions)).toHaveLength(1);
    const segments = await db.select().from(t.segments);
    expect(segments[0]).toMatchObject({ name: "Launch-stage protocols", priority: 1, specVersion: 1 });
    const offers = await db.select().from(t.offers);
    expect(offers[0]!.proposition).toContain("Written findings note");
    expect(offers[0]!.pricing).toMatchObject({ amount: 750 });

    const [session] = await db.select().from(t.intakeSessions).where(eq(t.intakeSessions.id, started.id));
    expect(session).toMatchObject({ status: "activated", endeavourId });
    await expect(activateIntake(db, { intakeId: started.id })).rejects.toMatchObject({ code: "conflict" });

    const events = (await db.select().from(t.events)).map((e) => e.eventType);
    expect(events).toEqual(expect.arrayContaining(["intake.started", "endeavour.activated"]));
  });
});

describe("abandonIntake", () => {
  it("closes an intake so it can no longer be edited", async () => {
    const started = await startIntake(db, planner(), { brief: BRIEF, today: TODAY });
    await abandonIntake(db, { intakeId: started.id });
    const [row] = await db.select().from(t.intakeSessions);
    expect(row!.status).toBe("abandoned");
  });
});
