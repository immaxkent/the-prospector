import { describe, expect, it } from "vitest";
import type { Thread } from "./types";
import { MAILBOX_VIEWS, filterThreads, mailboxCounts, matchesFilter, openingFilter } from "./mailbox-filters";

const thread = (id: string, messages: Partial<Thread["messages"][number]>[]): Thread =>
  ({ id, prospectId: `p_${id}`, endeavourId: "e1", unread: false, messages }) as Thread;

const draft = { author: "AGENT", draft: true, sendState: "pending_approval" } as const;
const approved = { author: "AGENT", draft: true, sendState: "approved" } as const;
const sent = { author: "AGENT", draft: false, sendState: "sent" } as const;
const reply = { author: "PROSPECT", draft: false, sendState: null } as const;

describe("the views", () => {
  it("names each view and says what an empty one means", () => {
    for (const view of MAILBOX_VIEWS) {
      expect(view.label).toBe(view.label.toUpperCase());
      expect(view.empty.length).toBeGreaterThan(10);
    }
  });

  it("opens with everything and ends with nothing hidden", () => {
    expect(MAILBOX_VIEWS[0]!.id).toBe("all");
    expect(MAILBOX_VIEWS.map((v) => v.id)).toEqual(["all", "drafts", "sent", "replies"]);
  });
});

describe("matchesFilter", () => {
  it("keeps everything under all", () => {
    expect(matchesFilter(thread("t", []), "all")).toBe(true);
  });

  it("counts a thread as a draft while one is still waiting", () => {
    expect(matchesFilter(thread("t", [draft]), "drafts")).toBe(true);
    expect(matchesFilter(thread("t", [approved]), "drafts")).toBe(true);
  });

  it("stops counting a draft once it has actually gone", () => {
    // Sending leaves the draft flag on the message; what changed is that it was sent.
    expect(matchesFilter(thread("t", [{ ...draft, sendState: "sent" }]), "drafts")).toBe(false);
  });

  it("counts a thread as sent once anything in it has been", () => {
    expect(matchesFilter(thread("t", [sent]), "sent")).toBe(true);
    expect(matchesFilter(thread("t", [draft]), "sent")).toBe(false);
  });

  it("counts a reply only from the prospect", () => {
    expect(matchesFilter(thread("t", [reply]), "replies")).toBe(true);
    expect(matchesFilter(thread("t", [sent]), "replies")).toBe(false);
  });
});

describe("mailboxCounts", () => {
  const threads = [
    thread("a", [sent, reply]),
    thread("b", [sent, reply, draft]),
    thread("c", [draft]),
    thread("d", []),
  ];

  it("counts each view over the same threads", () => {
    expect(mailboxCounts(threads)).toEqual({ all: 4, drafts: 2, sent: 2, replies: 2 });
  });

  it("lets a thread appear in several views at once", () => {
    // Thread b has been sent, has a reply, and has a draft waiting — it is all three.
    const b = [thread("b", [sent, reply, draft])];
    expect(mailboxCounts(b)).toEqual({ all: 1, drafts: 1, sent: 1, replies: 1 });
  });

  it("counts nothing for an empty mailbox", () => {
    expect(mailboxCounts([])).toEqual({ all: 0, drafts: 0, sent: 0, replies: 0 });
  });
});

describe("filterThreads", () => {
  const threads = [thread("a", [sent]), thread("b", [draft]), thread("c", [reply])];

  it("returns only what the view holds", () => {
    expect(filterThreads(threads, "drafts").map((t) => t.id)).toEqual(["b"]);
    expect(filterThreads(threads, "replies").map((t) => t.id)).toEqual(["c"]);
    expect(filterThreads(threads, "all")).toHaveLength(3);
  });

  it("keeps the order it was given", () => {
    expect(filterThreads(threads, "all").map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});

describe("openingFilter", () => {
  it("opens on what is waiting on you, when anything is", () => {
    expect(openingFilter([thread("a", [sent, reply]), thread("b", [draft])])).toBe("drafts");
  });

  it("opens on replies when nothing is waiting but something came back", () => {
    expect(openingFilter([thread("a", [sent, reply])])).toBe("replies");
  });

  it("opens on everything when the mailbox is quiet", () => {
    expect(openingFilter([thread("a", [sent])])).toBe("all");
    expect(openingFilter([])).toBe("all");
  });
});
