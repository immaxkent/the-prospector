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
