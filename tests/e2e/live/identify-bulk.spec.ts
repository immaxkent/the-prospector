import { expect, test } from "@playwright/test";
import { dbScript, query, resetDatabase } from "./db";
import { signIn } from "./env";

/**
 * Release, reject and dequeue were built in WP-20 and lived only on the endeavour page, so
 * the screen where a person actually reads prospects was the one screen that could not act
 * on them. These assert the decision reaches the database from the list.
 *
 * The live fixture carries one prospect, so the selection here is one row. What the bar does
 * with several — refusing a selection that spans two endeavours, keeping a tick across a
 * change of filter — is asserted against the demo fixtures, which have more than one.
 */
test.describe("deciding from the list", () => {
  test.beforeEach(async () => {
    await resetDatabase();
    dbScript("seed-fixtures");
  });
  test.afterAll(() => resetDatabase());

  test("releases from the list, and the row leaves the ones waiting on you", async ({ page }) => {
    await signIn(page, "/prospects");
    await page.getByLabel("Select Northbridge Protocol").check();

    const bar = page.getByTestId("bulk-decide");
    await expect(bar).toContainText("1 SELECTED");
    await bar.getByRole("button", { name: "RELEASE 1" }).click();

    await expect(page.locator("[data-sonner-toast]").first()).toContainText("released for outreach");
    expect(await query("select count(*)::int as n from prospects where released_at is not null")).toEqual([{ n: 1 }]);
    await expect(page.getByRole("button", { name: /NEEDS YOU 0/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /RELEASED 1/ })).toBeVisible();
  });

  test("will not reject without a reason, because that is what the agent learns from", async ({ page }) => {
    await signIn(page, "/prospects");
    await page.getByLabel("Select Northbridge Protocol").check();
    const bar = page.getByTestId("bulk-decide");
    await bar.getByRole("button", { name: "REJECT" }).first().click();
    await expect(bar.getByRole("button", { name: "REJECT 1" })).toBeDisabled();

    await bar.getByLabel("Why these are being rejected").fill("Audited last quarter");
    await bar.getByRole("button", { name: "REJECT 1" }).click();

    await expect(page.locator("[data-sonner-toast]").first()).toContainText("1 rejected");
    expect(await query("select review_status, rejection_reason from prospects")).toEqual([
      { review_status: "rejected", rejection_reason: "Audited last quarter" },
    ]);
  });

  test("dequeue says plainly that it records no judgement, and records none", async ({ page }) => {
    await signIn(page, "/prospects");
    await page.getByLabel("Select Northbridge Protocol").check();
    const bar = page.getByTestId("bulk-decide");
    await bar.getByRole("button", { name: "DEQUEUE" }).first().click();
    await expect(page.getByTestId("bulk-help")).toContainText("no judgement recorded");

    await bar.getByRole("button", { name: "DEQUEUE 1" }).click();
    await expect(page.locator("[data-sonner-toast]").first()).toContainText("1 dequeued");
    expect(await query("select rejection_reason from prospects")).toEqual([{ rejection_reason: null }]);
  });
});
