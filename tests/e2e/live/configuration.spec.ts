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

  test("carries the setpoints, and says what they mean in the operator's terms", async ({ page }) => {
    const config = await open(page);
    await expect(config.getByLabel("Most pending prospects")).toHaveValue("50");
    await expect(config.getByLabel("Live conversations wanted")).toHaveValue("20");
    await expect(config.getByTestId("prospecting-summary")).toContainText("counting ones nobody has released yet");
    await expect(config.getByTestId("prospecting-summary")).toContainText("Nothing leaves the list on its own");
  });

  test("saves the setpoints without disturbing the pacing beside them", async ({ page }) => {
    const config = await open(page);
    await config.getByLabel("Most pending prospects").fill("30");
    await config.getByLabel("Live conversations wanted").fill("8");
    await config.getByLabel("Pause prospecting").check();
    await config.getByRole("button", { name: "Save configuration" }).click();
    await expect(page.locator("[data-sonner-toast]").first()).toContainText("Configuration saved");

    const [stored] = await query<{
      settings: { prospecting: { maximumPending: number; activeGoal: number; paused: boolean }; followUpDays: number[] };
    }>("select settings from endeavours where id = 'end_fixture_solidity'");
    expect(stored?.settings.prospecting).toEqual({ maximumPending: 30, activeGoal: 8, paused: true });
    // The pacing form and the setpoints share one blob, and one must not wipe the other.
    expect(stored?.settings.followUpDays).toEqual([3, 7, 14]);
  });

  test("says so when the pause is on, rather than leaving the numbers to imply it", async ({ page }) => {
    const config = await open(page);
    await config.getByLabel("Pause prospecting").check();
    await expect(config.getByTestId("prospecting-summary")).toContainText("Prospecting is paused");
  });

  test("refuses a cap nobody could work through, without saving", async ({ page }) => {
    const config = await open(page);
    await config.getByLabel("Most pending prospects").fill("900");
    await expect(config).toContainText("between 1 and 500");
    await expect(config.getByRole("button", { name: "Save configuration" })).toBeDisabled();
  });

  test("sets when the reports arrive, in the operator's own timezone", async ({ page }) => {
    const config = await open(page);
    await expect(config.getByTestId("reporting-summary")).toContainText("Europe/London");
    // The distinction that matters: this is where the operator is, not where recipients are.
    await expect(config.getByTestId("reporting-summary")).toContainText("not where the recipients are");

    await config.getByLabel("Digest hour").selectOption("6");
    await config.getByLabel("Review day").selectOption("5");
    await config.getByLabel("Review hour").selectOption("17");
    await config.getByLabel("Report timezone").fill("America/New_York");
    await expect(config.getByTestId("reporting-summary")).toContainText("Friday at 17:00");
    await config.getByRole("button", { name: "Save configuration" }).click();
    await expect(page.locator("[data-sonner-toast]").first()).toContainText("Configuration saved");

    const [stored] = await query<{
      settings: { reporting: { digestHour: number; reviewWeekday: number; reviewHour: number; timezone: string } };
    }>("select settings from endeavours where id = 'end_fixture_solidity'");
    expect(stored?.settings.reporting).toEqual({
      digestHour: 6,
      reviewWeekday: 5,
      reviewHour: 17,
      timezone: "America/New_York",
    });
  });

  test("refuses a timezone the server does not know, rather than failing at send time", async ({ page }) => {
    const config = await open(page);
    await config.getByLabel("Report timezone").fill("Mars/Olympus");
    await expect(config).toContainText("not a timezone this server knows");
    await expect(config.getByRole("button", { name: "Save configuration" })).toBeDisabled();
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
