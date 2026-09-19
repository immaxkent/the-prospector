import { expect, test } from "@playwright/test";
import { query, resetDatabase } from "./db";
import { signIn } from "./env";

test.describe("model budget", () => {
  test.beforeEach(async () => {
    await resetDatabase();
    await query("delete from app_settings");
    await query("delete from llm_calls");
  });
  test.afterAll(async () => {
    await query("delete from app_settings");
    await resetDatabase();
  });

  test("starts on the cheapest model with a fifteen pound month", async ({ page }) => {
    await signIn(page, "/settings");
    const panel = page.getByTestId("budget-panel");
    await expect(panel.getByLabel("Model")).toHaveValue("claude-haiku-4-5");
    await expect(panel.getByLabel("Monthly budget")).toHaveValue("15.00");
    await expect(panel).toContainText("THIS MONTH £0.00 OF £15.00");
    await expect(panel).toContainText("A DAY");
  });

  test("saves a different model and budget, and says what it costs a day", async ({ page }) => {
    await signIn(page, "/settings");
    const panel = page.getByTestId("budget-panel");
    await panel.getByLabel("Model").selectOption("claude-sonnet-5");
    await panel.getByLabel("Monthly budget").fill("30.00");
    await expect(panel).toContainText("ABOUT £1.00 A DAY");
    await panel.getByRole("button", { name: "Save" }).click();

    await expect(page.locator("[data-sonner-toast]").first()).toContainText("£30.00 a month");
    const [stored] = await query<{ model: string; monthly_budget_pence: number }>(
      "select model, monthly_budget_pence from app_settings",
    );
    expect(stored).toMatchObject({ model: "claude-sonnet-5", monthly_budget_pence: 3000 });
  });

  test("refuses a budget it will not set, without saving", async ({ page }) => {
    await signIn(page, "/settings");
    const panel = page.getByTestId("budget-panel");
    await panel.getByLabel("Monthly budget").fill("-5");
    await expect(panel).toContainText("NOT A BUDGET THIS APP WILL SET");
    await expect(panel.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(await query("select 1 from app_settings")).toHaveLength(0);
  });
});
