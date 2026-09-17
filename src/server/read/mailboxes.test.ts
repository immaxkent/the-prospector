import { describe, expect, it } from "vitest";
import { DEFAULT_MAILBOX_LIMITS } from "../domain/mailbox";
import { buildMailbox } from "./mailboxes";
import { endeavourRow, mailboxRow, messageRow, threadRow } from "./testing";

describe("buildMailbox", () => {
  const now = new Date("2026-09-17T15:00:00Z");
  const threads = new Map([
    ["thr_1", threadRow()],
    ["thr_2", threadRow({ id: "thr_2", mailboxId: "mbx_other" })],
  ]);

  it("counts sends across every endeavour on the mailbox, today only", () => {
    const messages = [
      messageRow({ id: "1", endeavourId: "end_1", sentAt: new Date("2026-09-17T09:00:00Z") }),
      messageRow({ id: "2", endeavourId: "end_2", sentAt: new Date("2026-09-17T10:00:00Z") }),
      messageRow({ id: "3", sentAt: new Date("2026-09-16T10:00:00Z") }),
      messageRow({ id: "4", threadId: "thr_2", sentAt: now }),
      messageRow({ id: "5", sendState: "failed", sentAt: now }),
    ];
    const endeavours = [endeavourRow(), endeavourRow({ id: "end_2" }), endeavourRow({ id: "end_3", status: "archived" })];
    expect(buildMailbox(mailboxRow(), endeavours, threads, messages, now)).toMatchObject({
      sentToday: 2,
      capToday: 30,
      warmingUp: false,
      quietHours: "20:00 – 07:00",
      endeavourIds: ["end_1", "end_2"],
    });
  });

  it("reports warm-up when today's cap is below the configured cap", () => {
    const limits = { ...DEFAULT_MAILBOX_LIMITS, warmup: { startedOn: "2026-09-15", startCap: 5, incrementPerDay: 3 } };
    expect(buildMailbox(mailboxRow({ limits }), [], threads, [], now)).toMatchObject({ capToday: 11, warmingUp: true });
  });
});
