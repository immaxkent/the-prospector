import { expect, test } from "@playwright/test";
import { dbScript, query, resetDatabase } from "./db";
import { signIn } from "./env";

test.describe("prospect inspector", () => {
  test.beforeEach(async () => {
    // Suppressions are real operator data, not fixtures, so they are cleared here.
    await resetDatabase();
    dbScript("seed-fixtures");
  });
  test.afterAll(() => resetDatabase());

  async function openNorthbridge(page: import("@playwright/test").Page) {
    await signIn(page, "/prospects");
    await page.getByRole("cell", { name: "Northbridge Protocol" }).click();
    return page.getByTestId("prospect-actions");
  }

  test("moves a prospect between stages", async ({ page }) => {
    const actions = await openNorthbridge(page);
    await actions.getByLabel("Move stage").selectOption("meeting");
    await expect(page.getByText("Moved to meeting")).toBeVisible();
    expect(await query("select stage from prospects")).toEqual([{ stage: "meeting" }]);
  });

  test("rejecting needs a reason, then withdraws the pending reply and can be restored", async ({ page }) => {
    const actions = await openNorthbridge(page);
    await expect(actions.getByText("PENDING REPLY APPROVAL")).toBeVisible();
    await actions.getByRole("button", { name: "Reject" }).last().click();
    await expect(actions.getByRole("button", { name: "Confirm reject" })).toBeDisabled();
    await actions.getByLabel("Reason for rejecting the prospect").fill("Already audited");
    await actions.getByRole("button", { name: "Confirm reject" }).click();

    await expect(actions.getByText("REJECTED — NOTHING WILL BE SENT")).toBeVisible();
    expect(await query("select review_status, rejection_reason from prospects")).toEqual([
      { review_status: "rejected", rejection_reason: "Already audited" },
    ]);

    await actions.getByRole("button", { name: "Restore for review" }).click();
    await expect(page.getByText("Prospect restored for review")).toBeVisible();
  });

  test("suppressing a whole domain adds it to the do-not-contact list", async ({ page }) => {
    const actions = await openNorthbridge(page);
    await actions.getByRole("button", { name: "Suppress" }).click();
    await actions.getByLabel("Suppression scope").selectOption("domain");
    await actions.getByLabel("Reason for suppressing").fill("Asked us to stop");
    await actions.getByRole("button", { name: "Confirm suppress" }).click();

    await expect(page.getByText("Suppressed domain northbridge.example")).toBeVisible();
    expect(await query("select kind, value from suppressions")).toEqual([{ kind: "domain", value: "northbridge.example" }]);
  });
});
