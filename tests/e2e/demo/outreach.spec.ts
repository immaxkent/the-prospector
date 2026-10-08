import { expect, test } from "@playwright/test";

/**
 * WP-26. Approving a draft was the last the operator saw of it: between approval and arrival
 * a message passes through a pacing queue, a quiet-hours window and a daily cap, none of
 * which were on a screen.
 */
test.describe("the draft, and what it was written from", () => {
  test("the claims are readable beside the draft, not hidden in a tooltip", async ({ page }) => {
    await page.goto("/command");
    const draft = page.getByTestId("draft-copy").first();
    await expect(draft).toBeVisible();
    const evidence = page.getByTestId("draft-evidence").first();
    await expect(evidence).toContainText("WRITTEN FROM");
    // The claim itself, in the page rather than in a title attribute.
    await expect(evidence).not.toHaveText("WRITTEN FROM");
  });
});

test.describe("what is about to go out", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/endeavours/end_solidity");
  });

  test("says what waits on you, what waits on the clock, and what is broken", async ({ page }) => {
    const counts = page.getByTestId("queue-counts");
    await expect(counts).toContainText("WAITING ON YOU");
    await expect(counts).toContainText("READY TO GO");
    await expect(counts).toContainText("FAILED");
  });

  test("says which address everything goes from", async ({ page }) => {
    await expect(page.getByText(/FROM max@consulting.example/)).toBeVisible();
  });

  test("a queued row links to the prospect it is for", async ({ page }) => {
    const row = page.getByTestId("queue-row").first();
    await expect(row).toBeVisible();
    await row.getByRole("link", { name: /·/ }).click();
    await expect(page).toHaveURL(/\/prospects\/pro_/);
  });

  test("a row waiting on a person says it has no slot rather than inventing a time", async ({ page }) => {
    const waiting = page.getByTestId("queue-row").filter({ hasText: "WAITING ON YOU" }).first();
    await expect(waiting).toContainText("NO SLOT YET");
  });

  test("and points at the one place it can be approved, rather than being a second one", async ({ page }) => {
    const waiting = page.getByTestId("queue-row").filter({ hasText: "WAITING ON YOU" }).first();
    await expect(waiting.getByRole("link", { name: "REVIEW IT" })).toHaveAttribute("href", "#overview");
    // The tickets themselves stay in one panel; two places to approve the same draft is worse
    // than one place to walk to.
    await expect(page.locator("#outreach").getByTestId("draft-copy")).toHaveCount(0);
    await expect(page.locator("#overview").getByTestId("draft-copy").first()).toBeVisible();
  });
});
