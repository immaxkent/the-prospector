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
  page.locator("tbody tr td:nth-child(4)");

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

/**
 * What the bulk bar does with a selection of more than one. The demo fixtures carry three
 * endeavours, which is the only place a selection can span two of them.
 */
test.describe("deciding on several rows at once", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/prospects");
    await expect(page.getByRole("heading", { level: 1, name: /prospects/i })).toBeVisible();
  });

  test("refuses a selection spanning two endeavours instead of recording half of it", async ({ page }) => {
    await page.getByLabel("Select Northbridge Protocol").check();
    await page.getByLabel("Select Kestrel Trading").check();

    await expect(page.getByTestId("bulk-help")).toContainText("one endeavour");
    await expect(page.getByTestId("bulk-decide").getByRole("button", { name: /RELEASE 2/ })).toBeDisabled();
  });

  test("a tick survives changing which bucket you are looking at", async ({ page }) => {
    await page.getByLabel("Select Northbridge Protocol").check();
    await page.getByRole("button", { name: /NOT JUDGED/ }).click();
    await expect(page.getByTestId("bulk-decide")).toContainText("1 SELECTED");
  });

  test("selecting everything shown picks up the rows in that bucket only", async ({ page }) => {
    // Narrowed to one endeavour first — select-all across the whole list spans two, which
    // the bar refuses, and that is the test above.
    await page.locator("select").first().selectOption({ label: "£3K Solidity Sprint" });
    await page.getByLabel("Select all shown").check();
    await expect(page.getByTestId("bulk-decide")).toContainText("3 SELECTED");
    await expect(page.getByTestId("bulk-help")).toContainText("Cleared for outreach");
  });

  test("will not offer to release rows that are not waiting on a decision", async ({ page }) => {
    await page.getByRole("button", { name: /REJECTED/ }).click();
    await page.getByLabel("Select all shown").check();
    await expect(page.getByTestId("bulk-help")).toContainText("nothing to release");
  });
});

/**
 * T4: a prospect that cannot be contacted says so before it is opened. A row with no route
 * to the company looked exactly like one with a named CTO's address, so the highest-scoring
 * rows on the list were sometimes the ones there was nothing to be done about.
 */
test.describe("whether there is anyone to send to", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/prospects");
    await expect(page.getByRole("heading", { level: 1, name: /prospects/i })).toBeVisible();
  });

  const row = (page: import("@playwright/test").Page, company: string) =>
    page.locator("tbody tr").filter({ hasText: company });

  test("says on the row which kind of route there is, or that there is none", async ({ page }) => {
    await expect(row(page, "Northbridge Protocol").getByTestId("reach-tag")).toHaveAttribute("data-reach", "named");
    // A generic inbox is usable, and a different thing from a named person.
    await expect(row(page, "Meridian Settlements").getByTestId("reach-tag")).toHaveAttribute("data-reach", "inbox");
    await expect(row(page, "Kestrel Trading").getByTestId("reach-tag")).toHaveText("NO ROUTE");
  });

  test("does not imply the agent will open a channel it cannot send on", async ({ page }) => {
    await expect(row(page, "Meridian Settlements").getByTestId("reach-tag")).toBeVisible();
    await page.getByRole("button", { name: /^ALL/ }).click();
    const tag = row(page, "Kestrel Trading").getByTestId("reach-tag");
    await expect(tag).toHaveAttribute("title", /Nothing can be sent/);
  });

  test("the inspector says it too, so it is not lost on opening the row", async ({ page }) => {
    await row(page, "Kestrel Trading").getByRole("cell", { name: "Kestrel Trading", exact: true }).click();
    const inspector = page.getByTestId("inspector");
    await expect(inspector.getByTestId("reach-tag")).toHaveText("NO ROUTE");
  });
});
