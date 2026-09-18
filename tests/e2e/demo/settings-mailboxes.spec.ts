import { expect, test } from "@playwright/test";

test.describe("settings: mailboxes", () => {
  test("lists each mailbox with shared cap usage", async ({ page }) => {
    await page.goto("/settings");
    const rows = page.getByTestId("mailbox-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("SENT TODAY 9/19");
    await expect(rows.first()).toContainText("WARMING UP TO 30");
    await expect(rows.first()).toContainText("2 ENDEAVOURS");
    await expect(rows.nth(1)).toContainText("NEEDS REAUTH");
  });

  test("offers only v1 autonomy levels", async ({ page }) => {
    await page.goto("/settings");
    const select = page.locator("select").filter({ has: page.locator('option[value="DRAFT"]') });
    await expect(select.locator('option[value="GUARDED"]')).toHaveJSProperty("disabled", true);
    await expect(select.locator('option[value="DELEGATED"]')).toHaveJSProperty("disabled", true);
    await expect(select.locator('option[value="OBSERVE"]')).toHaveJSProperty("disabled", false);
    await expect(select.locator("option")).toHaveCount(4);
  });

  test("says where notifications go, and does not offer to send one in demo mode", async ({ page }) => {
    await page.goto("/settings");
    const panel = page.getByTestId("notification-channel");
    await expect(panel).toContainText("SLACK");
    await expect(panel).toContainText("hooks.slack.com");
    await expect(panel.getByRole("button", { name: /test notification/i })).toBeDisabled();
    await expect(panel).toContainText("DEMO MODE: NOTHING IS ACTUALLY SENT");
  });

  test("clean install shows the connect prompt", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "CLEAN / EMPTY" }).click();
    await expect(page.getByTestId("mailbox-row")).toHaveCount(0);
    await expect(page.getByText("No mailbox connected.")).toBeVisible();
  });
});
