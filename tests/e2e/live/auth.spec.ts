import { expect, test } from "@playwright/test";
import { E2E_LOGIN_SECRET, signIn } from "./env";

test.describe("live mode sign-in", () => {
  test("signed-out visitors are sent to login and returned after signing in", async ({ page }) => {
    await page.goto("/pipeline");
    await expect(page).toHaveURL(/\/login\?/);
    await expect(page.getByRole("link", { name: "Sign in with Google" })).toBeVisible();
    const returnTo = new URL(page.url()).searchParams.get("returnTo");
    expect(returnTo).toBe("/pipeline");

    await signIn(page, returnTo!);
    await expect(page).toHaveURL(/\/pipeline$/);
    await expect(page.getByRole("heading", { level: 1, name: /pipeline/i })).toBeVisible();
  });

  test("login errors are explained", async ({ page }) => {
    await page.goto("/login?error=not_allowed");
    await expect(page.getByRole("alert")).toHaveText("This Google account is not on the access list.");
  });

  test("addresses off the allowlist cannot use the test login", async ({ page }) => {
    await page.goto(`/auth/test-login?secret=${E2E_LOGIN_SECRET}&email=intruder@example.com`);
    await expect(page).toHaveURL(/\/login\?error=not_allowed/);
  });

  test("Google sign-in reports when it is not configured", async ({ page }) => {
    await page.goto("/auth/google");
    await expect(page.getByRole("alert")).toContainText("not configured");
  });

  test("logout revokes the session", async ({ page }) => {
    await signIn(page, "/command");
    await expect(page).toHaveURL(/\/command$/);
    const status = await page.evaluate(async () => (await fetch("/auth/logout", { method: "POST", redirect: "manual" })).type);
    expect(status).toBe("opaqueredirect");
    await page.goto("/command");
    await expect(page).toHaveURL(/\/login\?/);
  });
});
