import { expect, test } from "@playwright/test";

const SCREENS = [
  { path: "/command", heading: /command/i },
  { path: "/endeavours", heading: /endeavours/i },
  { path: "/prospects", heading: /prospects/i },
  { path: "/pipeline", heading: /pipeline/i },
  { path: "/inbox", heading: /inbox/i },
  { path: "/research", heading: /research/i },
  { path: "/intelligence", heading: /intelligence/i },
  { path: "/interfaces", heading: /interfaces/i },
  { path: "/settings", heading: /settings/i },
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
