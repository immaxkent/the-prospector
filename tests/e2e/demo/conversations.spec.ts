import { expect, test } from "@playwright/test";

/**
 * WP-27 T2. These were dropped from the read model: the thread exists, the mail is stored,
 * an approval is raised — and the inbox showed nothing, so "nothing came in today" and
 * "two arrived that we could not place" looked identical.
 */
test.describe("replies that could not be placed", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/mailbox");
    await expect(page.getByRole("heading", { level: 1, name: /mailbox/i })).toBeVisible();
  });

  test("are on the mailbox, counted, rather than silently absent", async ({ page }) => {
    await expect(page.getByText("COULD NOT BE PLACED")).toBeVisible();
    await expect(page.getByText("2 WAITING TO BE ATTRIBUTED")).toBeVisible();
    await expect(page.getByTestId("unplaced-reply")).toHaveCount(2);
  });

  test("say what was guessed and what had nothing to go on", async ({ page }) => {
    const guessed = page.getByTestId("unplaced-reply").filter({ hasText: "tomas@northbridge.example" });
    await expect(guessed).toContainText("GUESSED BY DOMAIN");
    const stranger = page.getByTestId("unplaced-reply").filter({ hasText: "hello@unknown.example" });
    await expect(stranger).toContainText("NOTHING TO GO ON");
  });

  test("a guess links to the prospect it guessed, because that is the fastest way to check it", async ({ page }) => {
    const guessed = page.getByTestId("unplaced-reply").filter({ hasText: "tomas@northbridge.example" });
    await guessed.getByRole("link", { name: /CHECK THE PROSPECT/ }).click();
    await expect(page).toHaveURL(/\/prospects\/pro_001$/);
  });

  test("say plainly that nothing is lost while they sit there", async ({ page }) => {
    await expect(page.getByText(/nothing is lost while they sit here/)).toBeVisible();
  });
});
