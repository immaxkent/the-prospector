import { expect, test } from "@playwright/test";
import { dbScript, query, resetDatabase } from "./db";
import { signIn } from "./env";

test.describe("endeavour configuration", () => {
  test.beforeEach(async () => {
    await resetDatabase();
    dbScript("seed-fixtures");
  });
  test.afterAll(() => resetDatabase());

  const open = async (page: import("@playwright/test").Page) => {
    await signIn(page, "/endeavours/end_fixture_solidity");
    await page.getByRole("button", { name: "CONFIGURATION" }).click();
    return page.getByTestId("endeavour-config");
  };

  test("starts from sensible defaults and explains what they mean", async ({ page }) => {
    const config = await open(page);
    await expect(config.getByLabel("Window opens")).toHaveValue("8");
    await expect(config.getByLabel("Window closes")).toHaveValue("17");
    await expect(config.getByLabel("Follow-up days")).toHaveValue("3, 7, 14");
    await expect(config).toContainText("at uneven intervals");
  });

  test("saves a change and stores it against the endeavour", async ({ page }) => {
    const config = await open(page);
    await config.getByLabel("Window opens").selectOption("9");
    await config.getByLabel("Shortest gap").fill("15");
    await config.getByLabel("Longest gap").fill("45");
    await config.getByLabel("Follow-up days").fill("4, 10");
    await config.getByRole("button", { name: "Save configuration" }).click();

    await expect(page.locator("[data-sonner-toast]").first()).toContainText("Configuration saved");
    const [stored] = await query<{ settings: { pacing: { window: { startHour: number } }; followUpDays: number[] } }>(
      "select settings from endeavours where id = 'end_fixture_solidity'",
    );
    expect(stored?.settings.pacing).toMatchObject({ window: { startHour: 9, endHour: 17 }, minGapMinutes: 15, maxGapMinutes: 45 });
    expect(stored?.settings.followUpDays).toEqual([4, 10]);
  });

  test("refuses a window that never opens, without saving", async ({ page }) => {
    const config = await open(page);
    await config.getByLabel("Window opens").selectOption("18");
    await config.getByLabel("Window closes").selectOption("9");
    await expect(config).toContainText("close after it opens");
    await expect(config.getByRole("button", { name: "Save configuration" })).toBeDisabled();
  });

  test("refuses a longest gap shorter than the shortest", async ({ page }) => {
    const config = await open(page);
    await config.getByLabel("Shortest gap").fill("30");
    await config.getByLabel("Longest gap").fill("5");
    await expect(config).toContainText("cannot be shorter");
    await expect(config.getByRole("button", { name: "Save configuration" })).toBeDisabled();
  });
});
