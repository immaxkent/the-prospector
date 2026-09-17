import { expect, test } from "@playwright/test";
import { dbScript, query, resetDatabase } from "./db";
import { signIn } from "./env";

test.describe("endeavour lifecycle", () => {
  test.beforeEach(async () => {
    await resetDatabase();
    dbScript("seed-fixtures");
  });
  test.afterAll(() => resetDatabase());

  test("pause, resume and archive from the detail screen", async ({ page }) => {
    await signIn(page, "/endeavours/end_fixture_solidity");
    const controls = page.getByTestId("endeavour-status-controls");

    await controls.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByText("Endeavour paused")).toBeVisible();
    await expect(controls.getByRole("button", { name: "Resume" })).toBeVisible();
    expect(await query("select status from endeavours")).toEqual([{ status: "paused" }]);

    await controls.getByRole("button", { name: "Resume" }).click();
    await expect(controls.getByRole("button", { name: "Pause" })).toBeVisible();

    await controls.getByRole("button", { name: "Archive" }).click();
    await controls.getByRole("button", { name: "Confirm archive" }).click();
    await expect(page.getByText("ENDEAVOUR NOT FOUND")).toBeVisible();
    expect(await query("select status from endeavours")).toEqual([{ status: "archived" }]);
  });
});
