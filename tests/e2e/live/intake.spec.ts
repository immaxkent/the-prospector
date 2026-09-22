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

  test("an invalid value is refused and never saved", async ({ page }) => {
    await signIn(page, "/endeavours/new");
    await page.getByLabel("Brief").fill(BRIEF);
    await page.getByRole("button", { name: "Plan this endeavour" }).click();
    const cadence = page.getByTestId("intake-field-cadence");
    await expect(cadence).toContainText("STATED");

    await cadence.getByRole("button", { name: "Edit" }).click();
    await cadence.getByLabel("Value for Daily cadence").fill('{"dailyNewTarget":-4,"dailyFollowupTarget":8}');
    await cadence.getByRole("button", { name: "Save value" }).click();

    // The draft must keep the planner's value: a rejected edit is never stored.
    await expect
      .poll(async () => {
        const [row] = await query<{ cadence: { state: string; value: { dailyNewTarget: number } } }>(
          "select draft_spec -> 'cadence' as cadence from intake_sessions order by created_at desc limit 1",
        );
        return row?.cadence;
      }, { timeout: 20_000 })
      .toMatchObject({ state: "stated", value: { dailyNewTarget: 10 } });
    await expect(cadence).toContainText("STATED");
    // Scoped to the toast: the field summary also mentions the field name.
    await expect(page.locator("[data-sonner-toast]").getByText(/dailyNewTarget/)).toBeVisible({ timeout: 20_000 });
  });
});

test("the brief box grows with the brief instead of scrolling in ten rows", async ({ page }) => {
  await signIn(page, "/endeavours/new");
  const box = page.getByLabel("Brief");
  const before = await box.evaluate((el) => el.clientHeight);

  await box.fill(Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of a long brief.`).join("\n"));
  const after = await box.evaluate((el) => el.clientHeight);
  expect(after).toBeGreaterThan(before);

  // It stops growing before it swallows the window, so the button stays reachable.
  const viewport = page.viewportSize()!.height;
  expect(after).toBeLessThanOrEqual(viewport * 0.72);
  await expect(page.getByRole("button", { name: /plan this endeavour/i })).toBeVisible();
});

test("a blocker sends you to the field it is about, and the field shows the shape it wants", async ({ page }) => {
  await signIn(page, "/endeavours/new");
  await page.getByLabel("Brief").fill(BRIEF);
  await page.getByRole("button", { name: /plan this endeavour/i }).click();
  await expect(page.getByTestId("activation-blockers")).toBeVisible({ timeout: 30_000 });

  // Switching to an ongoing endeavour leaves the sprint horizon behind, which blocks activation.
  await page.getByLabel("Endeavour kind").selectOption("ongoing");
  const blocker = page.getByTestId("activation-blockers").getByRole("button", { name: /Horizon/ });
  await expect(blocker).toBeVisible();
  // The message says what to do, not merely that something is wrong.
  await expect(blocker).toContainText("period");

  await blocker.click();
  const row = page.getByTestId("intake-field-horizon");
  await expect(row).toBeInViewport();
  await expect(row).toHaveClass(/surge/);

  // The editor offers the shape rather than leaving the operator to guess at the JSON.
  await row.getByRole("button", { name: "Edit" }).click();
  await expect(row.getByText("SHAPE THIS FIELD EXPECTS")).toBeVisible();
  await row.getByRole("button", { name: "USE THIS SHAPE" }).click();
  await expect(row.getByLabel(/Value for/)).toHaveValue(/"kind": "ongoing"/);
});
