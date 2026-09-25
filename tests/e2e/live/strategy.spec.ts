import { expect, test } from "@playwright/test";
import { dbScript, query, resetDatabase } from "./db";
import { signIn } from "./env";

test.describe("strategy", () => {
  test.beforeEach(async () => {
    await resetDatabase();
    dbScript("seed-fixtures");
  });
  test.afterAll(() => resetDatabase());

  test("edits the strategy and saves it as a new version with a reason", async ({ page }) => {
    await signIn(page, "/endeavours/end_fixture_solidity");
    await page.getByRole("button", { name: "STRATEGY" }).click();
    const editor = page.getByTestId("strategy-editor");
    await expect(editor).toContainText("VERSION 1");

    const cadence = editor.getByTestId("intake-field-cadence");
    await cadence.getByRole("button", { name: "Edit" }).click();
    await cadence.getByLabel("New contacts a day").fill("6");
    await cadence.getByLabel("Follow-ups a day").fill("4");
    await cadence.getByRole("button", { name: "Save value" }).click();

    await expect(editor).toContainText("1 UNSAVED");
    // A revision without a reason cannot be saved.
    await expect(editor.getByRole("button", { name: "Save revision" })).toBeDisabled();

    await editor.getByLabel("Reason for the revision").fill("Cutting volume while the offer is tested");
    await editor.getByRole("button", { name: "Save revision" }).click();

    await expect(page.getByText("Saved as version 2")).toBeVisible({ timeout: 20_000 });
    await expect(editor).toContainText("VERSION 2");
    await expect(page.getByTestId("strategy-history")).toContainText("Cutting volume while the offer is tested");

    const [endeavour] = await query<{ spec_version: number }>("select spec_version from endeavours where is_fixture = true");
    expect(endeavour).toEqual({ spec_version: 2 });
    expect(await query("select count(*)::int as n from endeavour_spec_versions")).toEqual([{ n: 1 }]);
  });

  test("changes can be discarded without saving", async ({ page }) => {
    await signIn(page, "/endeavours/end_fixture_solidity");
    await page.getByRole("button", { name: "STRATEGY" }).click();
    const editor = page.getByTestId("strategy-editor");
    const pricing = editor.getByTestId("intake-field-pricing");

    await pricing.getByRole("button", { name: "Edit" }).click();
    await pricing.getByLabel("Model").selectOption("day_rate");
    await pricing.getByLabel("Fixed price").fill("900");
    await pricing.getByRole("button", { name: "Save value" }).click();
    await expect(editor).toContainText("1 UNSAVED");

    await editor.getByRole("button", { name: "Discard changes" }).click();
    await expect(editor).toContainText("NO CHANGES");
    await expect(pricing).toContainText("amount: 750");
  });
});
