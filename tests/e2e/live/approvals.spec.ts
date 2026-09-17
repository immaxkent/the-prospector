import { expect, test } from "@playwright/test";
import { dbScript, query } from "./db";
import { signIn } from "./env";

test.describe.configure({ mode: "serial" });

test.describe("approval queue", () => {
  test.beforeEach(() => {
    dbScript("purge-fixtures");
    dbScript("seed-fixtures");
  });
  test.afterAll(() => dbScript("purge-fixtures"));

  test("editing and approving a reply saves an approved, unsent reply", async ({ page }) => {
    await signIn(page, "/command");
    const ticket = page.locator("article").filter({ hasText: "REPLY APPROVAL" });
    await expect(ticket).toBeVisible();

    await ticket.getByRole("button", { name: "Edit" }).click();
    await ticket.getByLabel("Draft copy").fill("Friday works. Fixed scope, £750, five working days.");
    await ticket.getByRole("button", { name: "Approve edited" }).click();

    await expect(page.getByText("Approved with your edits")).toBeVisible();
    await expect(page.getByText("QUEUE CLEAR")).toBeVisible();

    const rows = await query<{ body: string; send_state: string }>(
      "select body, send_state from messages where message_class = 'reply'",
    );
    expect(rows).toEqual([{ body: "Friday works. Fixed scope, £750, five working days.", send_state: "approved" }]);
  });

  test("rejecting records the reason and sends nothing", async ({ page }) => {
    await signIn(page, "/command");
    const ticket = page.locator("article").filter({ hasText: "REPLY APPROVAL" });
    await ticket.getByRole("button", { name: "Reject" }).click();
    await ticket.getByLabel("Reason for rejecting").fill("Wrong price");
    await ticket.getByRole("button", { name: "Confirm reject" }).click();

    await expect(page.getByText("Rejected", { exact: true })).toBeVisible();
    const [approval] = await query<{ status: string; decision_note: string }>("select status, decision_note from approvals");
    expect(approval).toEqual({ status: "rejected", decision_note: "Wrong price" });
    expect(await query("select id from messages where message_class = 'reply'")).toEqual([]);
  });
});
