import { expect, test } from "@playwright/test";

/**
 * WP-28. The pipeline was a count: a deal has a value, a probability, a stage and a date, and
 * those change — the screen should be where they change.
 */
test.describe("the objective read against real deals", () => {
  test("shows face value and weighted value, because they answer different questions", async ({ page }) => {
    await page.goto("/endeavours/end_solidity");
    const panel = page.locator("#overview");
    await expect(panel).toContainText("PIPELINE");
    // Face value answers what is on the table; weighted answers what to expect off it, and a
    // reader asked only the first will read it as the second.
    await expect(panel).toContainText("WEIGHTED");
  });

  test("always says what the weighted number rests on, one way or the other", async ({ page }) => {
    // Either the count of judged and assumed deals, or a plain statement that it is mostly
    // defaults. Never the number on its own.
    await page.goto("/endeavours/end_solidity");
    await expect(page.locator("#overview")).toContainText(/\d+ judged · \d+ assumed|not a forecast yet/);
  });
});

test.describe("moving a deal", () => {
  test("the stage is a control on the deal, not a label", async ({ page }) => {
    await page.goto("/pipeline");
    const actions = page.getByTestId("opportunity-actions").first();
    await expect(actions).toBeVisible();
    const stage = actions.getByRole("combobox");
    await expect(stage).toBeVisible();
    // Won and lost are not in it: closing needs a reason, so it has its own buttons.
    await expect(stage.locator("option")).not.toContainText(["won"]);
    await expect(actions.getByRole("button", { name: "Won" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Lost" })).toBeVisible();
  });

  test("closing asks why before it will take it", async ({ page }) => {
    await page.goto("/pipeline");
    const actions = page.getByTestId("opportunity-actions").first();
    await actions.getByRole("button", { name: "Won" }).click();
    await expect(actions.getByRole("button", { name: /Confirm won/ })).toBeDisabled();
    await actions.getByLabel("Why it was won").fill("Signed the fixed-scope review");
    await expect(actions.getByRole("button", { name: /Confirm won/ })).toBeEnabled();
  });
});
