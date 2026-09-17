import type { Page } from "@playwright/test";

export const E2E_LOGIN_SECRET = "e2e-login-secret";
export const E2E_OPERATOR = "operator@prospector.test";

/** Signs in through the guarded test login, which only exists outside production. */
export async function signIn(page: Page, returnTo = "/command") {
  const query = new URLSearchParams({ secret: E2E_LOGIN_SECRET, email: E2E_OPERATOR, returnTo });
  await page.goto(`/auth/test-login?${query}`);
}
