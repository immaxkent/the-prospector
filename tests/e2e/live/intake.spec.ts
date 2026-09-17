import { expect, test } from "@playwright/test";
import { dbScript, query, resetDatabase } from "./db";
import { signIn } from "./env";

const BRIEF = `I want to make £3,000 from Solidity consulting in the next 60 days.
I sell pre-audit security reviews of smart contracts.
Target launch-stage protocol teams that are close to mainnet.
I can do 10 new prospects and 8 follow-ups a day, by email.`;

test.describe("intake", () => {
  test.beforeEach(async () => {
    await resetDatabase();
    dbScript("seed-fixtures");
  });
  test.afterAll(() => resetDatabase());

  test("a short brief cannot be planned", async ({ page }) => {
    await signIn(page, "/endeavours/new");
    await page.getByLabel("Brief").fill("sell stuff");
    await expect(page.getByRole("button", { name: "Plan this endeavour" })).toBeDisabled();
  });

  test("plan, resolve every field, then activate", async ({ page }) => {
    await signIn(page, "/endeavours/new");
    await page.getByLabel("Brief").fill(BRIEF);
    await page.getByRole("button", { name: "Plan this endeavour" }).click();

    // The planner quoted the operator for these.
    const objective = page.getByTestId("intake-field-objective");
    await expect(objective).toContainText("STATED");
    await expect(objective).toContainText("target: 3000");
    await expect(objective).toContainText("QUOTED:");

    // Proof was not in the brief, so it must not be invented.
    const proof = page.getByTestId("intake-field-proof");
    await expect(proof).toContainText("MISSING");
    await expect(proof).toContainText("What can outreach point to");

    await expect(page.getByRole("button", { name: "Activate endeavour" })).toBeDisabled();
    await expect(page.getByTestId("activation-blockers")).toContainText("Sending mailbox");

    // Pricing: replace the suggestion with a real price.
    const pricing = page.getByTestId("intake-field-pricing");
    await pricing.getByRole("button", { name: "Edit" }).click();
    await pricing.getByLabel("Value for Pricing").fill('{"model":"package","amount":750,"currency":"GBP"}');
    await pricing.getByRole("button", { name: "Save value" }).click();
    await expect(pricing).toContainText("CONFIRMED");
    await expect(pricing).toContainText("amount: 750");

    // Proof: nothing to show yet.
    await proof.getByRole("button", { name: "Not applicable" }).click();
    await proof.getByLabel("Reason Proof does not apply").fill("New practice, no public work yet");
    await proof.getByRole("button", { name: "Confirm not applicable" }).click();
    await expect(proof).toContainText("NOT APPLICABLE");

    // Exclusions: explicitly none.
    const exclusions = page.getByTestId("intake-field-exclusions");
    await exclusions.getByRole("button", { name: "Enter value" }).click();
    await exclusions.getByLabel("Value for Who you will not work with").fill("[]");
    await exclusions.getByRole("button", { name: "Save value" }).click();
    await expect(exclusions).toContainText("CONFIRMED");

    await page.getByLabel("Sending mailbox").selectOption({ label: "max@consulting.example" });
    await expect(page.getByTestId("activation-blockers")).toHaveCount(0);

    await page.getByRole("button", { name: "Activate endeavour" }).click();
    await expect(page.getByText("Endeavour activated")).toBeVisible();
    await expect(page).toHaveURL(/\/endeavours\/end_/);

    const [endeavour] = await query<{ status: string; spec_version: number }>(
      "select status, spec_version from endeavours where is_fixture = false",
    );
    expect(endeavour).toEqual({ status: "active", spec_version: 1 });
    expect(await query("select count(*)::int as n from endeavour_spec_versions")).toEqual([{ n: 1 }]);
  });

  test("an invalid value is refused with the reason", async ({ page }) => {
    await signIn(page, "/endeavours/new");
    await page.getByLabel("Brief").fill(BRIEF);
    await page.getByRole("button", { name: "Plan this endeavour" }).click();
    const cadence = page.getByTestId("intake-field-cadence");
    await cadence.getByRole("button", { name: "Edit" }).click();
    await cadence.getByLabel("Value for Daily cadence").fill('{"dailyNewTarget":-4,"dailyFollowupTarget":8}');
    await cadence.getByRole("button", { name: "Save value" }).click();
    // The first server call in CI loads modules lazily, so the toast can take a while to appear.
    await expect(page.getByText(/dailyNewTarget/)).toBeVisible({ timeout: 20_000 });
    await expect(cadence).toContainText("STATED");
  });
});
