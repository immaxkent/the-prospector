import { expect, test } from "@playwright/test";
import { dbScript, resetDatabase } from "./db";
import { signIn } from "./env";

// These specs change shared database state, so they run in order.
test.describe.configure({ mode: "serial" });

test.describe("live data", () => {
  test.beforeAll(() => resetDatabase());
  test.afterAll(() => resetDatabase());

  test("a clean install shows empty states, never design fixtures", async ({ page }) => {
    await signIn(page, "/command");
    // Command reports on running work and sends you to Endeavours to create some.
    await expect(page.getByText("NOTHING RUNNING YET")).toBeVisible();
    await expect(page.getByText("£3K Solidity Sprint")).toHaveCount(0);

    await page.goto("/endeavours");
    await expect(page.getByText("NO ACTIVE ENDEAVOURS")).toBeVisible();

    await page.goto("/prospects");
    await expect(page.getByText("NO PROSPECTS DISCOVERED")).toBeVisible();

    await page.goto("/settings");
    await expect(page.getByText("No mailbox connected.")).toBeVisible();
  });

  test("screens render records from the database", async ({ page }) => {
    dbScript("seed-fixtures");
    await signIn(page, "/endeavours");
    await expect(page.getByRole("link", { name: "£3K Solidity Sprint" })).toBeVisible();

    await page.goto("/prospects");
    await expect(page.getByText("Northbridge Protocol").first()).toBeVisible();

    await page.goto("/inbox");
    await expect(page.getByText("Bridge contract review before mainnet").first()).toBeVisible();

    await page.goto("/settings");
    await expect(page.getByTestId("mailbox-row")).toHaveCount(1);
    await expect(page.getByTestId("mailbox-row")).toContainText("max@consulting.example");
  });

  test("the first paint already has data (server-rendered)", async ({ page, request }) => {
    await signIn(page, "/endeavours");
    const cookies = await page.context().cookies();
    const res = await request.get("/endeavours", {
      headers: { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") },
    });
    expect(await res.text()).toContain("£3K Solidity Sprint");
  });
});
