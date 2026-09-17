import { expect, test } from "@playwright/test";
import { dbScript, query } from "./db";
import { signIn } from "./env";

test.describe("inbox", () => {
  test.beforeEach(async () => {
    dbScript("purge-fixtures");
    dbScript("seed-fixtures");
    await query(
      `insert into messages (id, thread_id, endeavour_id, prospect_id, direction, message_class, subject, body, send_state)
       values ('msg_e2e_draft', 'thr_fixture_bridge', 'end_fixture_solidity', 'pro_fixture_northbridge', 'outbound',
               'follow_up', 'Following up', 'Checking whether Friday still suits.', 'pending_approval')`,
    );
    await query(
      `insert into approvals (id, endeavour_id, kind, subject_type, subject_id)
       values ('apr_e2e_draft', 'end_fixture_solidity', 'outreach_draft', 'message', 'msg_e2e_draft')`,
    );
  });
  test.afterAll(() => dbScript("purge-fixtures"));

  test("approves a follow-up draft in the conversation", async ({ page }) => {
    await signIn(page, "/inbox");
    const draft = page.locator("article").filter({ hasText: "Checking whether Friday still suits." });
    await expect(draft.getByText("AGENT DRAFT")).toBeVisible();
    await draft.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("Approved", { exact: true })).toBeVisible();
    await expect(draft.getByText("APPROVED, WAITING TO SEND")).toBeVisible();
    expect(await query("select send_state from messages where id = 'msg_e2e_draft'")).toEqual([{ send_state: "approved" }]);
  });

  test("approves the suggested reply from the intelligence rail", async ({ page }) => {
    await signIn(page, "/inbox");
    await page.getByTestId("reply-approval").getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("Approved", { exact: true })).toBeVisible();
    await expect(page.getByTestId("reply-approval")).toHaveCount(0);
    expect(await query("select send_state from messages where message_class = 'reply'")).toEqual([{ send_state: "approved" }]);
  });

  test("opening an unread thread marks it read", async ({ page }) => {
    await signIn(page, "/inbox");
    await page.getByRole("button", { name: /Northbridge Protocol/ }).click();
    await expect.poll(async () => (await query<{ unread: boolean }>("select unread from threads"))[0]?.unread).toBe(false);
  });
});
