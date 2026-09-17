import { expect, test } from "@playwright/test";
import { dbScript, query, resetDatabase } from "./db";
import { signIn } from "./env";

test.describe("run now", () => {
  test.beforeEach(async () => {
    await resetDatabase();
    dbScript("seed-fixtures");
  });
  test.afterAll(() => resetDatabase());

  test("runs the daily loop and records an honest brief", async ({ page }) => {
    await signIn(page, "/command");
    await page.getByRole("button", { name: "RUN NOW" }).click();
    await expect(page.getByText(/Ran 1 endeavour/)).toBeVisible({ timeout: 20_000 });

    const [run] = await query<{ status: string; phase: string; checkpoint: number }>(
      "select status, phase, checkpoint from daily_runs",
    );
    expect(run).toMatchObject({ status: "succeeded", phase: "done" });

    const [brief] = await query<{ brief: { risks: string[] } }>("select brief from daily_runs");
    // Gaps name what is unconfigured or short, never a step that does not exist.
    const risks = brief!.brief.risks.join(" ");
    expect(risks).toContain("Sending did not run: Google is not configured");
    expect(risks).not.toContain("not built yet");

    const [job] = await query<{ status: string; type: string }>("select status, type from jobs");
    expect(job).toMatchObject({ status: "succeeded", type: "endeavour.daily_run" });
  });

  test("the run appears on the endeavour with its phase", async ({ page }) => {
    await signIn(page, "/command");
    await page.getByRole("button", { name: "RUN NOW" }).click();
    await expect(page.getByText(/Ran 1 endeavour/)).toBeVisible({ timeout: 20_000 });

    await page.goto("/endeavours/end_fixture_solidity");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "RUNS" }).click();
    const row = page.getByRole("row").filter({ hasText: "run_" });
    await expect(row).toContainText("OK");
  });

  test("the research screen lists the run log", async ({ page }) => {
    await signIn(page, "/command");
    await page.getByRole("button", { name: "RUN NOW" }).click();
    await expect(page.getByText(/Ran 1 endeavour/)).toBeVisible({ timeout: 20_000 });

    await page.goto("/research");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("daily brief written")).toBeVisible();
    await expect(page.getByText(/is not configured/).first()).toBeVisible();
  });
});
