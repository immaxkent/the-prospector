import { expect, test } from "@playwright/test";
import { query, resetDatabase } from "./db";
import { signIn } from "./env";

test.describe("notifications", () => {
  test.beforeEach(() => resetDatabase());
  test.afterAll(() => resetDatabase());

  /** Nothing is connected in e2e, and the screen has to say so rather than imply delivery. */
  test("admits that notifications only wait in the app until a channel is connected", async ({ page }) => {
    await signIn(page, "/settings");
    const panel = page.getByTestId("notification-channel");
    await expect(panel).toContainText("Nothing is connected");
    await expect(panel.getByRole("button", { name: "Connect Slack" })).toBeVisible();
  });
});

test("connecting a channel is a form, and nothing is stored unless a test arrives", async ({ page }) => {
  await signIn(page, "/settings");
  const panel = page.getByTestId("notification-channel");
  await expect(panel).toContainText("Nothing is connected");

  // Every provider is offered by name, with its mark.
  for (const name of ["Connect Slack", "Connect Telegram", "Connect ntfy", "Connect Webhook"]) {
    await expect(panel.getByRole("button", { name })).toBeVisible();
  }

  await panel.getByRole("button", { name: "Connect Slack" }).click();
  const form = panel.getByTestId("connect-form");
  await expect(form).toContainText("Incoming Webhooks");
  await expect(form.getByRole("link", { name: /full walkthrough/i })).toBeVisible();

  // The shape is checked before anything is sent anywhere.
  await form.getByLabel("Webhook URL").fill("https://example.com/not-slack");
  await form.getByRole("button", { name: /connect and send a test/i }).click();
  await expect(page.locator("[data-sonner-toast]").first()).toContainText("not a Slack webhook");

  // And a credential that cannot deliver is never stored.
  await expect(panel).toContainText("Nothing is connected");
  expect(await query("select count(*)::int as n from notification_channels")).toEqual([{ n: 0 }]);
});

test("the connect form can be abandoned without leaving anything behind", async ({ page }) => {
  await signIn(page, "/settings");
  const panel = page.getByTestId("notification-channel");
  await panel.getByRole("button", { name: "Connect Telegram" }).click();
  await expect(panel.getByLabel("Bot token")).toBeVisible();
  await expect(panel.getByLabel("Chat id")).toBeVisible();
  await panel.getByRole("button", { name: "Cancel" }).click();
  await expect(panel.getByTestId("connect-form")).toHaveCount(0);
});
