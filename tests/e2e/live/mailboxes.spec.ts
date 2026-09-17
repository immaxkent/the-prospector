import { expect, test } from "@playwright/test";
import { dbScript, query, resetDatabase } from "./db";
import { signIn } from "./env";

test.describe("mailboxes", () => {
  test.beforeEach(async () => {
    await resetDatabase();
    dbScript("seed-fixtures");
  });
  test.afterAll(() => resetDatabase());

  test("edits shared limits, including warm-up", async ({ page }) => {
    await signIn(page, "/settings");
    const row = page.getByTestId("mailbox-row").first();
    await row.getByRole("button", { name: "Edit limits" }).click();
    await row.getByLabel("Daily cap").fill("25");
    await row.getByLabel("Weekly cap").fill("100");
    await row.getByLabel("Warm up").check();
    await row.getByLabel("Warm-up start").fill("5");
    await row.getByLabel("Warm-up increment").fill("3");
    await row.getByRole("button", { name: "Save limits" }).click();

    await expect(page.getByText("Mailbox limits saved")).toBeVisible();
    await expect(row).toContainText("WARMING UP TO 25");
    const [stored] = await query<{ limits: { dailyCap: number; weeklyCap: number; warmup: { startCap: number } } }>(
      "select limits from mailboxes",
    );
    expect(stored?.limits).toMatchObject({ dailyCap: 25, weeklyCap: 100, warmup: { startCap: 5, incrementPerDay: 3 } });
  });

  test("invalid limits are refused with the reason", async ({ page }) => {
    await signIn(page, "/settings");
    const row = page.getByTestId("mailbox-row").first();
    await row.getByRole("button", { name: "Edit limits" }).click();
    await row.getByLabel("Weekly cap").fill("5");
    await row.getByRole("button", { name: "Save limits" }).click();
    await expect(page.getByText("the weekly cap cannot be lower than the daily cap")).toBeVisible();
  });

  test("disconnecting warns about endeavours and clears tokens", async ({ page }) => {
    await signIn(page, "/settings");
    const row = page.getByTestId("mailbox-row").first();
    await row.getByRole("button", { name: "Disconnect" }).click();
    await expect(row.getByText("1 ENDEAVOUR(S) WILL STOP SENDING UNTIL RECONNECTED")).toBeVisible();
    await row.getByRole("button", { name: "Confirm disconnect" }).click();
    await expect(row).toContainText("DISCONNECTED");
    expect(await query("select status, token_ciphertext from mailboxes")).toEqual([{ status: "disconnected", token_ciphertext: null }]);
  });

  test("an endeavour switches to another connected mailbox", async ({ page }) => {
    await query(
      `insert into mailboxes (id, address, display_name, provider, status, limits)
       select 'mbx_e2e_deca', 'max@decastream.example', 'Decastream', 'google', 'connected', limits from mailboxes limit 1`,
    );
    await signIn(page, "/endeavours/end_fixture_solidity");
    await page.getByLabel("Sending mailbox").selectOption("mbx_e2e_deca");
    await expect(page.getByText("Sending mailbox changed")).toBeVisible();
    expect(await query("select mailbox_id from endeavours")).toEqual([{ mailbox_id: "mbx_e2e_deca" }]);
  });

  test("connecting explains when Google is not configured", async ({ page }) => {
    await signIn(page, "/settings");
    await page.getByRole("link", { name: "Connect Google mailbox" }).click();
    await expect(page.getByRole("alert")).toHaveText("Google OAuth is not configured on this server.");
  });
});
