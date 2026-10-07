import { expect, test } from "@playwright/test";
import { dbScript, query, resetDatabase } from "./db";
import { signIn } from "./env";

/**
 * WP-25 against the database: the routes shown are the stored ones, a contact the operator
 * adds is recorded as theirs, and the timeline is assembled from the tables that hold it.
 */
test.describe("one prospect, one screen", () => {
  test.beforeEach(async () => {
    await resetDatabase();
    dbScript("seed-fixtures");
  });
  test.afterAll(() => resetDatabase());

  const open = async (page: import("@playwright/test").Page) => {
    await signIn(page, "/prospects");
    await page.getByRole("cell", { name: "Northbridge Protocol", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ilse Vermeer");
  };

  test("shows the named address as the one that would be used", async ({ page }) => {
    await open(page);
    const route = page.getByTestId("contact-route").filter({ hasText: "ilse@northbridge.example" });
    await expect(route).toContainText("WOULD BE USED");
    await expect(route).not.toContainText("GENERIC INBOX");
  });

  test("a contact the operator adds is stored, and says it was theirs", async ({ page }) => {
    await open(page);
    const panel = page.getByTestId("contact-routes");
    await panel.getByLabel("Contact channel for Northbridge Protocol").selectOption("discord");
    await panel.getByLabel("New contact for Northbridge Protocol").fill("discord.gg/northbridge");
    await panel.getByLabel("Where you found the contact for Northbridge Protocol").fill("their docs footer");
    await panel.getByRole("button", { name: "Add" }).click();

    await expect(page.locator("[data-sonner-toast]").first()).toContainText("discord.gg/northbridge");
    const added = page.getByTestId("contact-route").filter({ hasText: "discord.gg/northbridge" });
    await expect(added).toContainText("YOU ADDED THIS");
    // And it does not pretend the agent can send to it.
    await expect(added).toContainText("YOU OPEN THIS");
    expect(await query("select contacts from companies where name = 'Northbridge Protocol'")).toEqual([
      { contacts: [{ channel: "discord", value: "discord.gg/northbridge", sourceRef: "their docs footer", addedBy: "operator" }] },
    ]);
  });

  test("refuses something that is not an address when the channel says email", async ({ page }) => {
    await open(page);
    const panel = page.getByTestId("contact-routes");
    await panel.getByLabel("New contact for Northbridge Protocol").fill("not an address");
    await panel.getByRole("button", { name: "Add" }).click();
    await expect(page.locator("[data-sonner-toast]").first()).toContainText("does not look like an email");
  });

  test("the timeline carries the research, the score and what was sent and received", async ({ page }) => {
    await open(page);
    const tape = page.getByTestId("timeline");
    await expect(tape.locator('[data-kind="research"]').first()).toBeVisible();
    await expect(tape.locator('[data-kind="qualified"]').first()).toContainText("Scored 92");
    await expect(tape.locator('[data-kind="sent"]').first()).toBeVisible();
    await expect(tape.locator('[data-kind="received"]').first()).toBeVisible();
  });

  test("a decision taken here lands on the tape, read back from the event log", async ({ page }) => {
    await open(page);
    const actions = page.getByTestId("prospect-actions");
    await actions.getByRole("button", { name: "Reject" }).last().click();
    await actions.getByLabel("Reason for rejecting the prospect").fill("Already audited");
    await actions.getByRole("button", { name: "Confirm reject" }).click();

    await expect(page.getByTestId("timeline").locator('[data-kind="decision"]').first()).toContainText("Rejected");
    await expect(page.getByTestId("timeline")).toContainText("Already audited");
  });

  test("contact that happened elsewhere is recorded and appears on the tape", async ({ page }) => {
    await open(page);
    await page.getByTestId("log-contact").click();
    const form = page.getByTestId("log-interaction");
    await form.getByLabel("Channel").selectOption("discord");
    await form.getByLabel("Direction").selectOption("inbound");
    await form.getByLabel("Note").fill("Answered in their server");
    await form.getByRole("button", { name: "Record it" }).click();

    const entry = page.getByTestId("timeline").locator('[data-kind="elsewhere"]').first();
    await expect(entry).toContainText("They answered on discord");
    await expect(entry).toContainText("Answered in their server");
  });
});
