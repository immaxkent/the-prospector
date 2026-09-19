import { expect, test } from "@playwright/test";
import { dbScript, query, resetDatabase } from "./db";
import { signIn } from "./env";

test.describe("sending addresses", () => {
  test.beforeEach(async () => {
    await resetDatabase();
    dbScript("seed-fixtures");
  });
  test.afterAll(() => resetDatabase());

  /** Creating an address needs consent this connection was never granted; the UI must say so. */
  test("offers to ask for consent rather than a button that would fail", async ({ page }) => {
    await signIn(page, "/settings");
    const row = page.getByTestId("mailbox-row").first();
    await expect(row.getByRole("button", { name: "Add an address" })).toHaveCount(0);
    await expect(row.getByRole("link", { name: "Allow new addresses" })).toHaveAttribute(
      "href",
      "/mailboxes/google/connect?alias=1",
    );
  });

  test("an endeavour can be switched to an alias the mailbox holds", async ({ page }) => {
    await query(
      `update mailboxes set aliases = '[{"address":"hello@consulting.example","displayName":"Max at Consulting","createdAt":"2026-09-18T00:00:00.000Z"}]'::jsonb`,
    );
    await signIn(page, "/endeavours/end_fixture_solidity");

    const control = page.getByTestId("endeavour-mailbox").first();
    await expect(control).toContainText("AS");
    await control.getByLabel("Sending address").selectOption("hello@consulting.example");
    await expect(page.locator("[data-sonner-toast]")).toContainText("Sending as hello@consulting.example");

    const [stored] = await query<{ from_alias: string | null }>("select from_alias from endeavours limit 1");
    expect(stored?.from_alias).toBe("hello@consulting.example");

    await control.getByLabel("Sending address").selectOption("");
    // The newest toast is the front one; the earlier one is still on screen.
    await expect(page.locator("[data-sonner-toast]").first()).toContainText("mailbox's own address");
    expect((await query<{ from_alias: string | null }>("select from_alias from endeavours limit 1"))[0]?.from_alias).toBeNull();
  });
});
