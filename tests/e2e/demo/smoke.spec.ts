import { expect, test } from "@playwright/test";

const SCREENS = [
  { path: "/command", heading: /command/i },
  { path: "/endeavours", heading: /endeavours/i },
  { path: "/prospects", heading: /prospects/i },
  { path: "/pipeline", heading: /pipeline/i },
  { path: "/mailbox", heading: /mailbox/i },
  { path: "/research", heading: /research/i },
  { path: "/intelligence", heading: /intelligence/i },
  { path: "/settings", heading: /settings/i },
  { path: "/walkthroughs", heading: /walkthroughs/i },
];

for (const screen of SCREENS) {
  test(`${screen.path} renders without page errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto(screen.path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: screen.heading })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("the home screen is the wordmark on a grid, with no 3D scene behind it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  // The backdrop is CSS, so it is there on the first paint with nothing to mount.
  await expect(page.locator(".world-grid")).toBeVisible();
  // reducedMotion is "reduce" for these runs, which is exactly when the old WebGL
  // backdrop rendered nothing at all — a canvas here would mean it came back.
  await expect(page.locator("canvas")).toHaveCount(0);

  const title = page.locator(".prospector-title");
  await expect(title).toHaveText("PROSPECTOR");
  // The split copies are drawn from the attribute, not from a second element.
  await expect(title).toHaveAttribute("data-text", "PROSPECTOR");
  expect(errors).toEqual([]);
});

test("an endeavour leads with the chosen headline numbers", async ({ page }) => {
  await page.goto("/endeavours/end_solidity");
  const row = page.getByTestId("stat-tiles");
  await expect(row).toBeVisible();

  // The fixtures choose a deliberately non-default row, and order is part of the choice.
  await expect(row.locator("[data-testid^=stat-tile-]")).toHaveCount(4);
  await expect(row.locator("[data-testid^=stat-tile-] p:first-child")).toHaveText([
    "REVENUE WON",
    "REPLIES IN",
    "AWAITING REVIEW",
    "REPLY RATE",
  ]);

  // A number that cannot honestly be computed yet says so instead of showing a zero.
  await expect(page.getByTestId("stat-tile-reply_rate")).toContainText("too few to rate");
});

test("the headline numbers can be swapped, and the row refuses a fifth", async ({ page }) => {
  await page.goto("/settings");
  const picker = page.getByTestId("stat-tile-picker");
  await expect(picker).toContainText("4 OF 4 CHOSEN");

  // The row is full, so adding without removing is refused rather than silently
  // dropping whichever was chosen first.
  await picker.getByRole("button", { name: /^Objective progress/ }).click();
  await expect(page.locator("[data-sonner-toast]")).toContainText("Take one off first");

  await picker.getByRole("button", { name: "1 · REVENUE WON ✕" }).click();
  await expect(picker).toContainText("3 OF 4 CHOSEN");
  // Removing the first renumbers the rest rather than leaving a gap at 1.
  await expect(picker.getByRole("button", { name: /^1 · REPLIES IN/ })).toBeVisible();

  await picker.getByRole("button", { name: /^Objective progress/ }).click();
  await expect(picker.getByRole("button", { name: /^4 · OBJECTIVE PROGRESS/ })).toBeVisible();
});

test("the endeavour is one page, with a rail saying where in it you are", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/endeavours/end_solidity");

  // Every section is on the page at once — nothing is a click away behind a tab.
  for (const id of ["overview", "prospects", "pipeline", "outreach", "strategy", "runs"]) {
    await expect(page.locator(`#${id}`)).toBeAttached();
  }

  const rail = page.getByTestId("section-rail");
  await expect(rail).toBeVisible();
  await expect(rail.locator("[aria-current=true]")).toHaveText("OVERVIEW");

  // The rail navigates as well as reports: following it puts the section under the header,
  // which is also what makes it the current one.
  await rail.getByRole("link", { name: "RUNS" }).click();
  await expect(rail.locator("[aria-current=true]")).toHaveText("RUNS");
  await expect(page.locator("#runs")).toBeInViewport();
});

test("the overview charts say what happened, and what is left of it", async ({ page }) => {
  await page.goto("/endeavours/end_solidity");

  // The funnel reports each stage's count and what share of the previous one survived,
  // rather than leaving the reader to divide two bars by eye.
  const funnel = page.getByTestId("funnel-chart");
  await expect(funnel).toBeVisible();
  await expect(funnel).toContainText("% KEPT");
  // The first stage has nothing before it, so it has no conversion to report.
  await expect(funnel.locator("div.group").first()).toContainText("—");

  const activity = page.getByTestId("activity-chart");
  await expect(activity).toBeVisible();
  // Two series, both named — identity never rests on colour alone.
  await expect(activity).toContainText("SENT");
  await expect(activity).toContainText("REPLIES");
});

test("the mailbox separates what is waiting, what went out and what came back", async ({ page }) => {
  await page.goto("/mailbox");
  const views = page.getByTestId("mailbox-views");
  await expect(views).toBeVisible();
  await expect(views.getByRole("button")).toHaveText([/^ALL/, /^DRAFTS/, /^SENT/, /^REPLIES/]);

  // It opens on whatever is waiting on the operator rather than on everything.
  await expect(views.locator("[aria-pressed=true]")).toHaveText(/^DRAFTS|^REPLIES/);

  await views.getByRole("button", { name: /^SENT/ }).click();
  await expect(views.locator("[aria-pressed=true]")).toHaveText(/^SENT/);
});

test("prospects wait for release, and the decisions are made together", async ({ page }) => {
  await page.goto("/endeavours/end_solidity");
  const list = page.getByTestId("review-list");
  await expect(list).toBeVisible();
  await expect(list).toContainText("WAITING ON YOU");

  // Each row carries enough to judge without opening it: who, the score, and why.
  const rows = page.getByTestId("review-row");
  await expect(rows.first()).toContainText("92/100");
  await expect(rows.first()).toContainText("Named CTO");

  // No action until something is ticked — the bar is the decision, not the rows.
  await expect(page.getByRole("button", { name: /Release \d+ for outreach/ })).toHaveCount(0);

  await rows.nth(0).getByRole("checkbox").check();
  await rows.nth(2).getByRole("checkbox").check();
  const commit = page.getByRole("button", { name: "Release 2 for outreach" });
  await expect(commit).toBeVisible();
  // It says what happens next, because releasing is not sending.
  await expect(list).toContainText("NOTHING IS SENT");

  await page.getByRole("button", { name: "CLEAR", exact: true }).click();
  await expect(page.getByRole("button", { name: /Release \d+ for outreach/ })).toHaveCount(0);
});

test("a prospect with no contact offers somewhere to put one", async ({ page }) => {
  await page.goto("/endeavours/end_solidity");
  const row = page.getByTestId("review-row").filter({ hasText: "NO CONTACT" }).first();
  await row.getByRole("button", { name: "ADD A CONTACT" }).click();

  // Expanding shows the working, and a place to close the gap the agent could not.
  await expect(row).toContainText("WHY IT SCORED");
  await expect(row.getByRole("combobox")).toBeVisible();
  await expect(row.getByRole("button", { name: "Add" })).toBeVisible();
});

test("deleting an endeavour asks for its name, not just a second click", async ({ page }) => {
  await page.goto("/endeavours/end_solidity");
  await page.getByRole("button", { name: "Delete this endeavour" }).click();

  const panel = page.getByTestId("delete-endeavour");
  await expect(panel).toContainText("There is no backup");

  // The fixture endeavour is active, so it says to pause first rather than offering the box.
  await expect(panel).toContainText("Pause or archive it first");
  await expect(panel.getByRole("button", { name: "Delete for good" })).toHaveCount(0);

  await panel.getByRole("button", { name: "CANCEL" }).click();
  await expect(page.getByRole("button", { name: "Delete this endeavour" })).toBeVisible();
});

test("the rail does not carry a screen that is all zeroes", async ({ page }) => {
  await page.goto("/command");
  const rail = page.getByRole("navigation").first();
  await expect(rail.getByRole("link", { name: "Interfaces" })).toHaveCount(0);

  // The route still answers — it is unlisted, not removed, and the palette still finds it.
  const response = await page.goto("/interfaces");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: /interfaces/i })).toBeVisible();
});

test("unknown routes show the 404 surface", async ({ page }) => {
  await page.goto("/does-not-exist");
  await expect(page.getByText("404 / NO ROUTE")).toBeVisible();
});

test("the health endpoint reports the app and its mode", async ({ request }) => {
  const res = await request.get("/healthz");
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok", mode: "demo" });
});

test("intelligence shows performance cut every way the read model cuts it", async ({ page }) => {
  await page.goto("/intelligence");
  for (const title of [
    "PERFORMANCE BY SEGMENT",
    "PERFORMANCE BY OFFER",
    "PERFORMANCE BY MESSAGE VERSION",
    "PERFORMANCE BY TRIGGER",
    "PERFORMANCE BY SOURCE",
  ]) {
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  }
  // The offer table reads by offer name, with its own sends and replies.
  const offers = page.locator("section", { hasText: "PERFORMANCE BY OFFER" });
  await expect(offers.getByRole("row", { name: /Pre-audit review/ })).toContainText("63");
});

test("an empty command screen points at endeavours rather than repeating its pitch", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "CLEAN / EMPTY" }).click();

  await page.goto("/command");
  await expect(page.getByText("NOTHING RUNNING YET")).toBeVisible();
  await expect(page.getByRole("link", { name: /go to endeavours/i })).toBeVisible();
  await expect(page.getByText("NO ACTIVE ENDEAVOURS")).toHaveCount(0);

  // Endeavours keeps the invitation to create one, and the button that does it.
  await page.goto("/endeavours");
  await expect(page.getByText("NO ACTIVE ENDEAVOURS")).toBeVisible();
  await expect(page.getByRole("link", { name: /create first endeavour/i })).toBeVisible();
});

test("the app announces which deploy it is in the console", async ({ page }) => {
  const logs: string[] = [];
  page.on("console", (m) => logs.push(m.text()));
  await page.goto("/command");
  await expect.poll(() => logs.find((l) => l.includes("THE PROSPECTOR"))).toBeTruthy();

  // Version and commit are always present; a build time only on a release build.
  const line = logs.find((l) => l.includes("THE PROSPECTOR"))!;
  expect(line).toMatch(/^THE PROSPECTOR \S+ · \S+/);
});

test("a walkthrough can be linked to directly and read on its own", async ({ page }) => {
  await page.goto("/walkthroughs?open=gmail-send-as");
  const steps = page.getByTestId("walkthrough-gmail-send-as");
  await expect(steps).toBeVisible();
  await expect(steps).toContainText("Send mail as");
  // Only the one asked for, so arriving from a failure lands on the answer.
  await expect(page.getByTestId("walkthrough-connect-slack")).toHaveCount(0);
  await expect(page.getByText("YOU ARE DONE WHEN").first()).toBeVisible();

  await page.getByRole("button", { name: /all walkthroughs/i }).click();
  await expect(page.getByTestId("walkthrough-connect-slack")).toBeVisible();
});
