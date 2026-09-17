import { expect, test } from "@playwright/test";
import { dbScript, query, resetDatabase } from "./db";
import { signIn } from "./env";

test.describe("import", () => {
  test.beforeEach(async () => {
    await resetDatabase();
    dbScript("seed-fixtures");
  });
  test.afterAll(() => resetDatabase());

  test("imports a CSV into the endeavour and reports what happened", async ({ page }) => {
    await signIn(page, "/settings");
    const panel = page.getByTestId("import-panel");
    await panel.getByLabel("CSV file").setInputFiles({
      name: "prospects.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        'company,person,email,note\nHavsledd Labs,Tomas Lindqvist,tomas@havsledd.example,"Met in June"\nNorthbridge Protocol,Ilse Vermeer,ilse@northbridge.example,Already known\n',
      ),
    });
    await panel.getByRole("button", { name: "Import records" }).click();

    await expect(page.getByText(/Imported 1/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/1 already known/)).toBeVisible();

    const imported = await query<{ source: string }>("select source from prospects where source = 'import'");
    expect(imported).toHaveLength(1);
  });

  test("a file with no usable rows is refused with the reason", async ({ page }) => {
    await signIn(page, "/settings");
    const panel = page.getByTestId("import-panel");
    await panel.getByLabel("CSV file").setInputFiles({
      name: "empty.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("company\n\n"),
    });
    await panel.getByRole("button", { name: "Import records" }).click();
    await expect(page.locator("[data-sonner-toast]")).toContainText(/no rows|company/i, { timeout: 20_000 });
  });
});
