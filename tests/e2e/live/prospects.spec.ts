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

test.describe("contact that did not go through the mailbox", () => {
  test.beforeEach(async () => {
    await resetDatabase();
    dbScript("seed-fixtures");
  });
  test.afterAll(() => resetDatabase());

  test("records a conversation happening elsewhere, and says it is kept out of the rates", async ({ page }) => {
    await signIn(page, "/prospects");
    await page.getByRole("cell", { name: "Northbridge Protocol" }).click();
    await page.getByTestId("log-contact").click();

    const form = page.getByTestId("log-interaction");
    await form.getByLabel("Channel").selectOption("discord");
    await form.getByLabel("Direction").selectOption("inbound");
    await form.getByLabel("Note").fill("Answered in their server");
    // The operator has to know this does not improve their reply rate, or every number
    // after it is misread.
    await expect(form).toContainText("kept out of the reply and meeting rates");
    await form.getByRole("button", { name: "Record it" }).click();

    await expect(page.locator("[data-sonner-toast]").first()).toContainText("they answered");
    expect(await query("select channel, direction from interactions")).toEqual([
      { channel: "discord", direction: "inbound" },
    ]);
  });

  test("refuses a date that has not happened", async ({ page }) => {
    await signIn(page, "/prospects");
    await page.getByRole("cell", { name: "Northbridge Protocol" }).click();
    await page.getByTestId("log-contact").click();

    const form = page.getByTestId("log-interaction");
    await form.getByLabel("When it happened").fill("2099-01-01");
    await expect(form).toContainText("has not happened yet");
    await expect(form.getByRole("button", { name: "Record it" })).toBeDisabled();
  });
});

test.describe("clearing things out of the buffer", () => {
  test.beforeEach(async () => {
    await resetDatabase();
    dbScript("seed-fixtures");
  });
  test.afterAll(() => resetDatabase());

  test("says what each decision means, because dequeue and reject are not the same", async ({ page }) => {
    // An operator who cannot see the difference records "never replied" as a rejection
    // reason, which teaches the agent nothing.
    await signIn(page, "/endeavours/end_fixture_solidity");
    const bar = page.getByTestId("resolve-bar");
    await expect(page.getByTestId("resolve-help")).toContainText("no judgement recorded");
    await bar.getByRole("button", { name: "REJECT" }).click();
    await expect(page.getByTestId("resolve-help")).toContainText("what the agent learns from");
    // And it will not take a rejection with no reason.
    await expect(bar.getByRole("button", { name: /^REJECT/ }).last()).toBeDisabled();
  });
});
