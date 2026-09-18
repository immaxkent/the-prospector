import { expect, test } from "@playwright/test";
import { dbScript, query, resetDatabase } from "./db";
import { signIn } from "./env";

test.describe("daily brief", () => {
  test.beforeEach(async () => {
    await resetDatabase();
    dbScript("seed-fixtures");
    for (const [index, day] of ["2026-09-15", "2026-09-16"].entries()) {
      await query(
        `insert into daily_runs (id, endeavour_id, run_date, trigger, status, brief, started_at)
         values ($1, 'end_fixture_solidity', $2, 'schedule', 'succeeded', $3, $4)`,
        [
          `run_${day}`,
          day,
          JSON.stringify({ date: day, changed: [`Day ${index} summary`], learned: [], today: [], risks: [] }),
          `${day}T07:00:00Z`,
        ],
      );
    }
  });
  test.afterAll(() => resetDatabase());

  test("shows the latest brief and lets you read an earlier day", async ({ page }) => {
    await signIn(page, "/command");
    await expect(page.getByText("Day 1 summary")).toBeVisible();

    await page.getByLabel("Brief day").selectOption("2026-09-15");
    await expect(page.getByText("Day 0 summary")).toBeVisible();
    await expect(page.getByText("Day 1 summary")).toHaveCount(0);
  });
});
