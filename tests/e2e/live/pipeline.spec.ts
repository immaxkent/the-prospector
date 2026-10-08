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

/**
 * WP-28: the stage is a control on the deal, and closing it moves the objective.
 */
test.describe("moving and closing a deal", () => {
  test.beforeEach(async () => {
    await resetDatabase();
    dbScript("seed-fixtures");
    await query(
      `insert into opportunities (id, endeavour_id, prospect_id, name, value, currency, stage)
       values ('opp_live', 'end_fixture_solidity', 'pro_fixture_northbridge', 'Pre-audit review', 1200, 'GBP', 'proposal')`,
    );
  });
  test.afterAll(() => resetDatabase());

  test("moves the stage, and the prospect follows it", async ({ page }) => {
    await signIn(page, "/pipeline");
    const actions = page.getByTestId("opportunity-actions").first();
    await actions.getByLabel("Stage for Pre-audit review").selectOption("meeting");

    await expect(page.locator("[data-sonner-toast]").first()).toContainText("Opportunity updated");
    expect(await query("select stage from opportunities where id = 'opp_live'")).toEqual([{ stage: "meeting" }]);
    // They were two records saying different things about the same conversation.
    expect(await query("select stage from prospects where id = 'pro_fixture_northbridge'")).toEqual([{ stage: "meeting" }]);
  });

  test("closing it as won records the reason and moves the objective", async ({ page }) => {
    await signIn(page, "/pipeline");
    const actions = page.getByTestId("opportunity-actions").first();
    await actions.getByRole("button", { name: "Won" }).click();
    await actions.getByLabel("Why it was won").fill("Signed the fixed-scope review");
    await actions.getByRole("button", { name: /Confirm won/ }).click();

    expect(await query("select stage, outcome_reason from opportunities where id = 'opp_live'")).toEqual([
      { stage: "won", outcome_reason: "Signed the fixed-scope review" },
    ]);

    // And the objective reads it: £1,200 won against a £3,000 target.
    await page.goto("/endeavours/end_fixture_solidity");
    await expect(page.locator("#overview")).toContainText("£1,200");
  });

  test("the weighted number is on the objective, with what it rests on", async ({ page }) => {
    await signIn(page, "/endeavours/end_fixture_solidity");
    const overview = page.locator("#overview");
    await expect(overview).toContainText("WEIGHTED");
    await expect(overview).toContainText(/\d+ judged · \d+ assumed|not a forecast yet/);
  });
});
