import { expect, test } from "@playwright/test";

/**
 * The prospects list used to sort by score and filter by stage, which asked the operator to
 * work out for themselves which rows were waiting on them. It now opens on the ones that
 * are, in the order they should be met, and each row says why it is there.
 *
 * These run against the demo fixtures, where the states are fixed, so the order is a real
 * assertion rather than whatever the database happened to return.
 */
const nameCells = (page: import("@playwright/test").Page) =>
  page.locator("tbody tr td:nth-child(3)");

test.describe("the prospects list, ordered by what needs a decision", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/prospects");
    await expect(page.getByRole("heading", { level: 1, name: /prospects/i })).toBeVisible();
  });

  test("opens on what is waiting on you, flagged first, then by whether they can be reached", async ({ page }) => {
    await expect(page.getByRole("button", { name: /NEEDS YOU 4/ })).toBeVisible();

    // Meridian is flagged for review, which is the most explicit ask there is. Northbridge
    // has a named address; Kestrel and Havsledd have no route at all, so they come last
    // even though Kestrel outscores Northbridge's neighbours.
    await expect(nameCells(page)).toHaveText([
      "Meridian Settlements",
      "Northbridge Protocol",
      "Kestrel Trading",
      "Havsledd Labs",
    ]);
  });

  test("says why each row is there, beside the row", async ({ page }) => {
    const rows = page.locator("tbody tr");
    await expect(rows.filter({ hasText: "Meridian Settlements" })).toContainText("flagged for review");
    await expect(rows.filter({ hasText: "Northbridge Protocol" })).toContainText("scored 92, waiting on you");
    // Not a hidden fact: a high score with nobody to send to is said on the row.
    await expect(rows.filter({ hasText: "Kestrel Trading" })).toContainText("no route to reach them");
  });

  test("the counts come from the whole list, not from what is on screen", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1, name: /prospects/i }).locator("..")).toContainText(
      "4 waiting on you",
    );
    await expect(page.getByRole("button", { name: /NOT JUDGED 2/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /REJECTED 1/ })).toBeVisible();
  });

  test("not judged yet is a separate bucket, and does not pretend to be scored", async ({ page }) => {
    await page.getByRole("button", { name: /NOT JUDGED/ }).click();
    await expect(nameCells(page)).toHaveText(["Halden Rollup", "Ledgerline Financial"]);
    await expect(page.locator("tbody tr").first()).toContainText("being researched");
  });

  test("an empty bucket says so rather than looking broken", async ({ page }) => {
    await page.getByRole("button", { name: /RELEASED/ }).click();
    await expect(page.getByTestId("bucket-empty")).toBeVisible();
    // And it still says where everything else went.
    await expect(page.getByTestId("bucket-empty").locator("..")).toContainText("4 WAITING");
  });

  test("the search narrows the list without losing the order", async ({ page }) => {
    await page.getByPlaceholder("Filter person, company, trigger…").fill("kestrel");
    await expect(nameCells(page)).toHaveText(["Kestrel Trading"]);
    await expect(page.getByRole("button", { name: /NEEDS YOU 1/ })).toBeVisible();
  });
});
