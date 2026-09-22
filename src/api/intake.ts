/**
 * Intake server functions: plan a brief, answer questions, confirm fields, activate.
 * The planner runs against Claude, or against a fixture in e2e.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";
import { requireSession } from "./session";

const id = z.string().trim().min(1).max(64);
const FIELDS = ["objective", "horizon", "offering", "pricing", "proof", "buyers", "exclusions", "mailboxId", "cadence"] as const;

async function live() {
  const [{ getConfig }, { getDb }] = await Promise.all([import("../server/config"), import("../server/db/client")]);
  const config = getConfig();
  if (config.mode !== "live") throw new Error("Demo mode is read-only. Connect a database to make changes.");
  return { config, db: getDb() };
}

/** Planner dependencies: the real Claude client, or the scripted fixture used by e2e. */
async function planner() {
  const { config, db } = await live();
  const [{ dbRecorder }] = await Promise.all([import("../server/llm/recorder")]);
  const record = dbRecorder(db);
  if (config.plannerFixture) {
    const [{ FakeLlm }, { solidityPlannerPasses }] = await Promise.all([
      import("../server/llm/fake"),
      import("../server/intake/testing"),
    ]);
    return { db, deps: { llm: new FakeLlm([...solidityPlannerPasses(), ...solidityPlannerPasses()]), model: config.model, record } };
  }
  if (!config.anthropicApiKey) throw new Error("Claude is not configured on this server: set ANTHROPIC_API_KEY.");
  const [{ AnthropicLlm }, AnthropicModule] = await Promise.all([import("../server/llm/anthropic"), import("@anthropic-ai/sdk")]);
  const client = new AnthropicModule.default({ apiKey: config.anthropicApiKey });
  return { db, deps: { llm: new AnthropicLlm(client), model: config.model, record } };
}

const today = () => new Date().toISOString().slice(0, 10);

export const startIntakeFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(z.object({ brief: z.string().max(20_000) }))
  .handler(async ({ data }) => {
    const [{ startIntake }, { db, deps }] = await Promise.all([import("../server/commands/intake"), planner()]);
    return startIntake(db, deps, { brief: data.brief, today: today() });
  });

export const answerIntakeFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(
    z.object({
      intakeId: id,
      answers: z.array(z.object({ field: z.enum(FIELDS), answer: z.string().max(4_000) })).min(1),
    }),
  )
  .handler(async ({ data }) => {
    const [{ answerIntake }, { db, deps }] = await Promise.all([import("../server/commands/intake"), planner()]);
    return answerIntake(db, deps, { intakeId: data.intakeId, answers: data.answers, today: today() });
  });

export const editIntakeFieldFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(
    z.discriminatedUnion("action", [
      z.object({ intakeId: id, field: z.enum(FIELDS), action: z.literal("confirm") }),
      z.object({ intakeId: id, field: z.enum(FIELDS), action: z.literal("set"), value: z.unknown() }),
      z.object({ intakeId: id, field: z.enum(FIELDS), action: z.literal("not_applicable"), reason: z.string().max(500) }),
    ]),
  )
  .handler(async ({ data }) => {
    const [{ editIntakeField }, { db }] = await Promise.all([import("../server/commands/intake"), live()]);
    return editIntakeField(db, data);
  });

export const updateIntakeSettingsFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(
    z.object({
      intakeId: id,
      name: z.string().max(120).optional(),
      kind: z.enum(["sprint", "ongoing"]).optional(),
      autonomyLevel: z.enum(["OBSERVE", "DRAFT", "GUARDED", "DELEGATED"]).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const [{ updateIntakeSettings }, { db }] = await Promise.all([import("../server/commands/intake"), live()]);
    return updateIntakeSettings(db, data);
  });

export const activateIntakeFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(z.object({ intakeId: id }))
  .handler(async ({ data }) => {
    const [{ activateIntake }, { db }] = await Promise.all([import("../server/commands/intake"), live()]);
    return activateIntake(db, data);
  });
