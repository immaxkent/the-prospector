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

  test("the header and the rows have the same number of columns", async ({ page }) => {
    // They went out of step once: a cell was added without its heading, and every column
    // after it was labelled with the name of the one before.
    const headers = await page.locator("thead th").count();
    const cells = await page.locator("tbody tr").first().locator("td").count();
    expect(cells).toBe(headers);
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

  test("the prospect's own page says it too, so it is not lost on opening the row", async ({ page }) => {
    await row(page, "Kestrel Trading").getByRole("cell", { name: "Kestrel Trading", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Marcus Reiter");
    await expect(page.getByTestId("reach-tag")).toHaveText("NO ROUTE");
  });
});

/**
 * WP-25: one screen per prospect. What was known about a company was spread across the
 * inspector, the mailbox, the interaction log and the evidence table, so in practice the
 * decision was made on the score alone.
 */
test.describe("the prospect's own page", () => {
  const open = async (page: import("@playwright/test").Page, company: string) => {
    await page.goto("/prospects");
    await page.getByRole("button", { name: /^ALL/ }).click();
    await page.getByRole("cell", { name: company, exact: true }).click();
  };

  test("is reached from the list, and says who, where and what state they are in", async ({ page }) => {
    await open(page, "Northbridge Protocol");
    await expect(page).toHaveURL(/\/prospects\/pro_001$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ilse Vermeer");
    await expect(page.getByText("Technical Co-founder · Northbridge Protocol")).toBeVisible();
    await expect(page.getByText("scored 92, waiting on you")).toBeVisible();
  });

  test("lists every route, and marks the one an email would actually go to", async ({ page }) => {
    await open(page, "Meridian Settlements");
    const routes = page.getByTestId("contact-route");
    await expect(routes).toHaveCount(2);
    // The generic inbox is what would be used; Discord is a route a person opens.
    await expect(routes.filter({ hasText: "hello@meridian.example" })).toContainText("WOULD BE USED");
    await expect(routes.filter({ hasText: "hello@meridian.example" })).toContainText("GENERIC INBOX");
    await expect(routes.filter({ hasText: "discord.gg/meridian" })).toContainText("YOU OPEN THIS");
  });

  test("says plainly when there is no route at all, and what would count as one", async ({ page }) => {
    await open(page, "Kestrel Trading");
    await expect(page.getByTestId("no-routes")).toContainText("Nothing can be sent until one is added");
  });

  test("puts research, the trigger, the score and the conversation on one tape", async ({ page }) => {
    await open(page, "Northbridge Protocol");
    const tape = page.getByTestId("timeline");
    await expect(tape.getByTestId("timeline-entry").first()).toBeVisible();
    for (const kind of ["research", "trigger", "qualified", "sent", "received"]) {
      await expect(tape.locator(`[data-kind="${kind}"]`).first()).toBeVisible();
    }
  });

  test("the tape is newest first", async ({ page }) => {
    await open(page, "Northbridge Protocol");
    const stamps = await page.getByTestId("timeline-entry").locator(".machine").allInnerTexts();
    const dates = stamps.map((t) => t.split("·").pop()!.trim());
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  test("decides without leaving the page: the actions and the contact log are both here", async ({ page }) => {
    await open(page, "Northbridge Protocol");
    await expect(page.getByTestId("prospect-actions")).toBeVisible();
    await expect(page.getByTestId("log-contact")).toBeVisible();
  });

  test("a link from nowhere says so instead of rendering an empty prospect", async ({ page }) => {
    await page.goto("/prospects/pro_does_not_exist");
    await expect(page.getByText("NO SUCH PROSPECT")).toBeVisible();
  });
});
