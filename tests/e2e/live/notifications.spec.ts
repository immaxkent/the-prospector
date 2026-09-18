import { expect, test } from "@playwright/test";
import { resetDatabase } from "./db";
import { signIn } from "./env";

test.describe("notifications", () => {
  test.beforeEach(() => resetDatabase());
  test.afterAll(() => resetDatabase());

  /** No channel is configured for e2e, and the screen has to say so rather than imply delivery. */
  test("admits that notifications only wait in the app until a channel is set", async ({ page }) => {
    await signIn(page, "/settings");
    const panel = page.getByTestId("notification-channel");
    await expect(panel).toContainText("IN APP ONLY");
    await expect(panel).toContainText("NOTIFY_SLACK_WEBHOOK_URL");
    await expect(panel.getByRole("button", { name: /test notification/i })).toBeDisabled();
  });
});
