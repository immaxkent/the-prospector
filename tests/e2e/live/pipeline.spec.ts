import { expect, test } from "@playwright/test";
import { dbScript, query, resetDatabase } from "./db";
import { signIn } from "./env";

test.describe("pipeline ledger", () => {
  test.beforeEach(async () => {
    await resetDatabase();
    dbScript("seed-fixtures");
    await query(
      `insert into opportunities (id, endeavour_id, prospect_id, name, value, currency, stage)
       values ('opp_e2e', 'end_fixture_solidity', 'pro_fixture_northbridge', 'Bridge pre-audit', 750, 'GBP', 'proposal')`,
    );
  });
  test.afterAll(() => resetDatabase());

  const row = (page: import("@playwright/test").Page) =>
    page.getByRole("row").filter({ hasText: "Bridge pre-audit" }).getByTestId("opportunity-actions");

  test("edits value and probability", async ({ page }) => {
    await signIn(page, "/pipeline");
    await row(page).getByRole("button", { name: "Edit" }).click();
    await row(page).getByLabel("Value").fill("1200");
    await row(page).getByLabel("Probability %").fill("70");
    await row(page).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Opportunity updated")).toBeVisible();
    expect(await query("select value, probability_user_defined from opportunities")).toEqual([
      { value: 1200, probability_user_defined: 0.7 },
    ]);
  });

  test("closing as won needs a reason and moves the prospect to won", async ({ page }) => {
    await signIn(page, "/pipeline");
    await row(page).getByRole("button", { name: "Won" }).click();
    await expect(row(page).getByRole("button", { name: "Confirm won" })).toBeDisabled();
    await row(page).getByLabel("Why it was won").fill("Needed review before mainnet");
    await row(page).getByRole("button", { name: "Confirm won" }).click();
    await expect(page.getByText("Opportunity updated")).toBeVisible();
    await expect(row(page).getByRole("button", { name: "Won" })).toHaveCount(0);
    expect(await query("select stage from prospects")).toEqual([{ stage: "won" }]);
  });
});
