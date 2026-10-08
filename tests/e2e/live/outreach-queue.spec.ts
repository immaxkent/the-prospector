import { expect, test } from "@playwright/test";
import { dbScript, query, resetDatabase } from "./db";
import { signIn } from "./env";

/**
 * The queue against the database, and the two things it has to say that nothing else did:
 * when something will actually go, and when a send has failed.
 */
test.describe("the outbound queue", () => {
  test.beforeEach(async () => {
    await resetDatabase();
    dbScript("seed-fixtures");
  });
  test.afterAll(() => resetDatabase());

  const queueFor = async (page: import("@playwright/test").Page) => {
    await signIn(page, "/endeavours/end_fixture_solidity");
    return page.getByTestId("queue-counts");
  };

  test("says the address everything goes from, read off the endeavour's mailbox", async ({ page }) => {
    await queueFor(page);
    await expect(page.getByText(/FROM max@consulting.example/)).toBeVisible();
  });

  test("a scheduled message says when it goes", async ({ page }) => {
    await query(
      `update messages set send_state = 'queued', scheduled_send_at = now() + interval '2 hours', sent_at = null
       where direction = 'outbound'`,
    );
    const counts = await queueFor(page);
    await expect(counts).toContainText("1 READY TO GO");
    await expect(page.getByTestId("queue-row").first()).toContainText("GOES in 2h");
  });

  test("a failed send is at the top, with the reason, and is not counted as ready", async ({ page }) => {
    await query(
      `update messages set send_state = 'failed', send_attempts = 2, last_error = 'the mailbox refused the token', sent_at = null
       where direction = 'outbound'`,
    );
    const counts = await queueFor(page);
    await expect(counts).toContainText("1 FAILED");
    await expect(counts).toContainText("0 READY TO GO");
    const row = page.getByTestId("queue-row").first();
    await expect(row).toHaveAttribute("data-state", "failed");
    await expect(row).toContainText("2 ATTEMPTS");
    await expect(page.getByTestId("queue-error")).toContainText("refused the token");
  });

  test("and the same failure is on the prospect, not only in the digest", async ({ page }) => {
    await query(
      `update messages set send_state = 'failed', send_attempts = 1, last_error = 'the mailbox refused the token', sent_at = null
       where direction = 'outbound'`,
    );
    await signIn(page, "/prospects");
    await page.getByRole("cell", { name: "Northbridge Protocol", exact: true }).click();
    const entry = page.getByTestId("timeline").locator('[data-kind="failed"]').first();
    await expect(entry).toContainText("Could not send");
    await expect(entry).toContainText("refused the token");
  });

  test("says plainly when there is nothing waiting to go", async ({ page }) => {
    await query(`update messages set send_state = 'sent' where direction = 'outbound'`);
    await queueFor(page);
    await expect(page.getByTestId("queue-empty")).toBeVisible();
  });
});
