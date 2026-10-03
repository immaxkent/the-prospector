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
  usdToPence,
  type BudgetSettings,
  type BudgetState,
} from "../domain/budget";
import { STAT_TILE_COUNT, STAT_TILE_IDS } from "@/data/stat-tiles";
import { localDate, OPERATOR_TIMEZONE } from "../read/rows";
import { phaseOf, type RunPhase } from "../domain/phase-budget";
import { invalid } from "./errors";
import { recordEvent } from "./events";

const SINGLETON = "singleton";

/** The stored settings, or the defaults when nothing has been chosen yet. */
export async function loadSettings(db: Database): Promise<BudgetSettings> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.id, SINGLETON));
  if (!row) return DEFAULT_BUDGET;
  return { model: row.model, monthlyBudgetPence: row.monthlyBudgetPence };
}

/** Which headline numbers the endeavour page leads with. Empty means the defaults. */
export async function loadStatTiles(db: Database): Promise<string[]> {
  const [row] = await db.select({ statTiles: appSettings.statTiles }).from(appSettings).where(eq(appSettings.id, SINGLETON));
  return row?.statTiles ?? [];
}

/**
 * Sets the headline numbers.
 *
 * Unlike the budget, this is only a display preference — but it is still checked, because
 * an id that does not exist would silently become one of the defaults and the operator
 * would be told their choice was saved when a different one was shown.
 */
export async function updateStatTiles(db: Database, tiles: readonly string[]) {
  if (tiles.length > STAT_TILE_COUNT) throw invalid(`the row shows ${STAT_TILE_COUNT} numbers, not ${tiles.length}`);
  const unknown = tiles.filter((id) => !STAT_TILE_IDS.includes(id));
  if (unknown.length > 0) throw invalid(`there is no such number: ${unknown.join(", ")}`);
  if (new Set(tiles).size !== tiles.length) throw invalid("the same number cannot fill two places in the row");

  const values = { statTiles: [...tiles] };
  await db
    .insert(appSettings)
    .values({ id: SINGLETON, ...DEFAULT_BUDGET, ...values })
    .onConflictDoUpdate({ target: appSettings.id, set: { ...values, updatedAt: new Date() } });
  return values.statTiles;
}

/**
 * Today's spend in pence, by the phase of the run that caused it.
 *
 * Derived from the prompt role each call recorded, so no column had to be added and every
 * call already made is counted correctly.
 */
export async function loadPhaseSpend(db: Database, usdPerGbp: number, now = new Date(), timeZone = OPERATOR_TIMEZONE) {
  const today = localDate(now, timeZone);
  const rows = await db
    .select({
      day: sql<string>`(${llmCalls.createdAt} at time zone ${sql.raw(`'${timeZone}'`)})::date::text`,
      role: llmCalls.role,
      cost: llmCalls.costUsd,
    })
    .from(llmCalls)
    .where(gte(llmCalls.createdAt, sql`${today}::date`));

  const usdByPhase: Partial<Record<RunPhase, number>> = {};
  for (const row of rows) {
    if (row.day !== today) continue;
    const phase = phaseOf(row.role);
    if (!phase) continue;
    usdByPhase[phase] = (usdByPhase[phase] ?? 0) + row.cost;
  }
  // Converted once at the end: rounding every call to the penny would lose most of them.
  return Object.fromEntries(
    Object.entries(usdByPhase).map(([phase, usd]) => [phase, usdToPence(usd, usdPerGbp)]),
  ) as Partial<Record<RunPhase, number>>;
}

/** A month of spend costs one round trip: the model is the same for all of it. */
export async function loadSpend(db: Database, now = new Date(), timeZone = OPERATOR_TIMEZONE) {
  const today = localDate(now, timeZone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const rows = await db
    .select({ day: sql<string>`(${llmCalls.createdAt} at time zone ${sql.raw(`'${timeZone}'`)})::date::text`, cost: llmCalls.costUsd })
    .from(llmCalls)
    .where(gte(llmCalls.createdAt, sql`${monthStart}::date`));
  // All-time is a separate sum rather than a wider fetch: it grows without bound, and
  // nothing needs the rows — only the total.
  const [total] = await db.select({ sum: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)` }).from(llmCalls);
  return {
    todayUsd: rows.filter((r) => r.day === today).reduce((sum, r) => sum + r.cost, 0),
    monthUsd: rows.reduce((sum, r) => sum + r.cost, 0),
    allTimeUsd: Number(total?.sum ?? 0),
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
