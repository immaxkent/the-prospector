/**
 * Operator settings and what has been spent against them. The budget is enforced before a
 * call is made, not reported after the bill arrives.
 */
import { eq, gte, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { appSettings, llmCalls } from "../db/schema";
import {
  budgetState,
  DEFAULT_BUDGET,
  isSelectableModel,
  type BudgetSettings,
  type BudgetState,
} from "../domain/budget";
import { localDate, OPERATOR_TIMEZONE } from "../read/rows";
import { invalid } from "./errors";
import { recordEvent } from "./events";

const SINGLETON = "singleton";

/** The stored settings, or the defaults when nothing has been chosen yet. */
export async function loadSettings(db: Database): Promise<BudgetSettings> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.id, SINGLETON));
  if (!row) return DEFAULT_BUDGET;
  return { model: row.model, monthlyBudgetPence: row.monthlyBudgetPence };
}

/** A month of spend costs one round trip: the model is the same for all of it. */
export async function loadSpend(db: Database, now = new Date(), timeZone = OPERATOR_TIMEZONE) {
  const today = localDate(now, timeZone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const rows = await db
    .select({ day: sql<string>`(${llmCalls.createdAt} at time zone ${sql.raw(`'${timeZone}'`)})::date::text`, cost: llmCalls.costUsd })
    .from(llmCalls)
    .where(gte(llmCalls.createdAt, sql`${monthStart}::date`));
  return {
    todayUsd: rows.filter((r) => r.day === today).reduce((sum, r) => sum + r.cost, 0),
    monthUsd: rows.reduce((sum, r) => sum + r.cost, 0),
  };
}

export async function loadBudgetState(db: Database, usdPerGbp: number, now = new Date()): Promise<BudgetState> {
  const [settings, spend] = await Promise.all([loadSettings(db), loadSpend(db, now)]);
  return budgetState(settings, spend, usdPerGbp, now);
}

export interface UpdateSettingsInput {
  model: string;
  monthlyBudgetPence: number;
}

/** Ceiling on what can be set by hand, so a typo cannot authorise a fortune. */
export const MAX_MONTHLY_BUDGET_PENCE = 100_000;

export async function updateSettings(db: Database, input: UpdateSettingsInput) {
  if (!isSelectableModel(input.model)) throw invalid("that is not a model this app can price");
  const pence = Math.round(input.monthlyBudgetPence);
  if (!Number.isFinite(pence) || pence < 0) throw invalid("the budget cannot be negative");
  if (pence > MAX_MONTHLY_BUDGET_PENCE) throw invalid("that budget is higher than this app will set by hand");

  const before = await loadSettings(db);
  const values = { model: input.model, monthlyBudgetPence: pence };
  await db
    .insert(appSettings)
    .values({ id: SINGLETON, ...values })
    .onConflictDoUpdate({ target: appSettings.id, set: { ...values, updatedAt: new Date() } });

  if (before.model !== values.model || before.monthlyBudgetPence !== values.monthlyBudgetPence) {
    await recordEvent(db, {
      eventType: "settings.updated",
      entityType: "settings",
      entityId: SINGLETON,
      subject: values.model,
      detail: `model ${values.model} · £${(pence / 100).toFixed(2)} a month`,
      data: { ...values, previous: before },
    });
  }
  return values;
}
