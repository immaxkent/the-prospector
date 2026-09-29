import { expect, test } from "@playwright/test";

/**
 * Clicking a link used to flash: the page you were leaving sat there for about a tenth of
 * a second before the one you asked for appeared. The cause was the root route awaiting
 * the session on every navigation, which put a server round-trip in front of each click.
 *
 * The session is now read through the query cache, so a navigation inside the app talks to
 * the server only when something it does not already hold is needed.
 */
test("moving between screens does not go back to the server to ask who you are", async ({ page }) => {
  await page.goto("/pipeline");
  await expect(page.getByRole("heading", { level: 1, name: /pipeline/i })).toBeVisible();

  // Counted from after the first screen has settled: the first load legitimately fetches
  // the session, and it is every click after it that used to pay for it again.
  const calls: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/_serverFn/")) calls.push(req.url());
  });

  await page.locator('a[href="/prospects"]').first().click();
  await expect(page.getByRole("heading", { level: 1, name: /prospects/i })).toBeVisible();
  await page.locator('a[href="/mailbox"]').first().click();
  await expect(page.getByRole("heading", { level: 1, name: /mailbox/i })).toBeVisible();

  expect(calls).toEqual([]);
});

/**
 * Scroll restoration is on, which is what makes this true. It is also the reason the app
 * does not place the page itself: the router does it on the frame the new route renders,
 * and an effect on a location change runs three frames earlier — on the page you are
 * leaving, which is exactly the jump that looked like a flash.
 */
test("going back returns you to where you were, and forward starts at the top", async ({ page }) => {
  await page.goto("/endeavours/end_solidity");
  await expect(page.getByTestId("stat-tiles")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(400);

  await page.locator('a[href="/prospects"]').first().click();
  await expect(page.getByRole("heading", { level: 1, name: /prospects/i })).toBeVisible();
  expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(0);

  await page.goBack();
  await expect(page.getByTestId("stat-tiles")).toBeVisible();
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(400);
});
