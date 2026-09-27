import { describe, expect, it } from "vitest";
import type { Approval, Endeavour, Opportunity, Thread } from "./types";
import {
  DEFAULT_STAT_TILES,
  STAT_TILES,
  STAT_TILE_COUNT,
  compact,
  findStatTile,
  money,
  resolveStatTiles,
  type StatContext,
} from "./stat-tiles";

const endeavour = {
  id: "end_1",
  name: "£3K Solidity Sprint",
  unit: "GBP",
  targetValue: 3000,
  actualValue: 750,
  pipelineValue: 2000,
  deadline: "2026-11-16",
  period: null,
  quota: { newProspects: 10, outreach: 8, followups: 4 },
  quotaDone: { newProspects: 10, outreach: 1, followups: 0 },
  funnel: { researched: 9, qualified: 6, contacted: 4, replied: 2, meeting: 1, proposal: 1, won: 1 },
} as unknown as Endeavour;

const thread = (id: string, prospectId: string, over: Partial<Thread> = {}): Thread =>
  ({ id, prospectId, endeavourId: "end_1", unread: false, messages: [], ...over }) as Thread;

const sent = { author: "AGENT", sendState: "sent", draft: false } as const;
const reply = { author: "PROSPECT", sendState: null, draft: false } as const;

const ctx = (over: Partial<StatContext> = {}): StatContext => ({
  endeavour,
  prospects: [],
  threads: [],
  approvals: [],
  opportunities: [],
  budget: {
    model: "claude-haiku-4-5",
    monthlyBudgetPence: 1500,
    dailyAllowancePence: 50,
    spentTodayPence: 5,
    spentMonthPence: 300,
    remainingTodayPence: 45,
    allowed: true,
    reason: "ok",
    usdPerGbp: 1.27,
  },
  now: new Date("2026-09-27T12:00:00Z"),
  ...over,
});

const run = (id: string, over: Partial<StatContext> = {}) => findStatTile(id)!.compute(ctx(over));

describe("the catalogue", () => {
  it("gives every tile a unique id", () => {
    expect(new Set(STAT_TILES.map((t) => t.id)).size).toBe(STAT_TILES.length);
  });

  it("explains every tile, so a choice in settings is not a guess", () => {
    for (const tile of STAT_TILES) {
      expect(tile.hint.length).toBeGreaterThan(20);
      expect(tile.label.split(" ").length).toBeLessThanOrEqual(3);
    }
  });

  it("computes every tile without throwing on an endeavour that has done nothing", () => {
    for (const tile of STAT_TILES) expect(() => tile.compute(ctx())).not.toThrow();
  });

  it("offers the four defaults", () => {
    for (const id of DEFAULT_STAT_TILES) expect(findStatTile(id)).toBeDefined();
  });
});

describe("outcome tiles", () => {
  const opportunities = [
    { id: "o1", stage: "won", value: 750 },
    { id: "o2", stage: "proposal", value: 1200 },
  ] as Opportunity[];

  it("counts only won opportunities as revenue", () => {
    expect(run("revenue", { opportunities })).toMatchObject({ display: "£750", sub: "of £3k target" });
  });

  it("marks revenue good once the target is met", () => {
    const met = [{ id: "o1", stage: "won", value: 3000 }] as Opportunity[];
    expect(run("revenue", { opportunities: met }).tone).toBe("good");
    expect(run("revenue", { opportunities }).tone).toBe("plain");
  });

  it("counts everything not won as open pipeline", () => {
    expect(run("pipeline", { opportunities })).toMatchObject({ display: "£1.2k", sub: "1 open" });
  });

  it("reports objective progress against the target", () => {
    expect(run("objective")).toMatchObject({ display: "25%", sub: "750 of 3k" });
  });

  it("says there is no target rather than dividing by zero", () => {
    const no = { ...endeavour, targetValue: 0 } as Endeavour;
    expect(run("objective", { endeavour: no })).toEqual({ display: null, sub: "no target set" });
  });

  it("counts a meeting and everything past it as a meeting booked", () => {
    expect(run("meetings").display).toBe("3");
  });
});

describe("activity tiles", () => {
  const threads = [
    thread("t1", "p1", { messages: [sent, reply] as Thread["messages"] }),
    thread("t2", "p2", { messages: [sent] as Thread["messages"], unread: true }),
  ];

  it("counts sent messages, not drafts", () => {
    const withDraft = [thread("t1", "p1", { messages: [sent, { ...sent, sendState: "queued" }] as Thread["messages"] })];
    expect(run("sent", { threads: withDraft }).display).toBe("1");
  });

  it("counts replies and flags what is unread", () => {
    expect(run("replies", { threads })).toMatchObject({ display: "1", sub: "1 unread" });
  });

  it("treats anything awaiting review as your move, and nothing as good", () => {
    expect(run("awaiting", { approvals: [{ id: "a1" }] as Approval[] })).toMatchObject({ display: "1", tone: "warn" });
    expect(run("awaiting")).toMatchObject({ display: "0", sub: "nothing waiting", tone: "good" });
  });

  it("counts threads with no prospect reply as gone quiet", () => {
    expect(run("quiet", { threads }).display).toBe("1");
  });

  it("reports quota against what was planned", () => {
    expect(run("quota")).toMatchObject({ display: "50%", sub: "11 of 22" });
  });

  it("says nothing is planned rather than showing 0%", () => {
    const idle = { ...endeavour, quota: { newProspects: 0, outreach: 0, followups: 0 } } as Endeavour;
    expect(run("quota", { endeavour: idle })).toEqual({ display: null, sub: "nothing planned today" });
  });
});

describe("efficiency tiles", () => {
  const many = Array.from({ length: 10 }, (_, i) =>
    thread(`t${i}`, `p${i}`, { messages: (i < 2 ? [sent, reply] : [sent]) as Thread["messages"] }),
  );

  it("refuses to rate replies off too few sends", () => {
    const few = [thread("t1", "p1", { messages: [sent, reply] as Thread["messages"] })];
    expect(run("reply_rate", { threads: few })).toEqual({ display: null, sub: "1 sent — too few to rate" });
  });

  it("rates replies once there is enough to rate", () => {
    expect(run("reply_rate", { threads: many })).toMatchObject({ display: "20%", sub: "2 of 10 sent" });
  });

  it("shows the month's spend against the cap", () => {
    expect(run("spend_month")).toMatchObject({ display: "£3.00", sub: "of £15.00 cap" });
  });

  it("warns once the cap is reached", () => {
    const spent = { ...ctx().budget, spentMonthPence: 1500 };
    expect(run("spend_month", { budget: spent }).tone).toBe("warn");
  });

  it("divides spend by replies, and says so when there are none", () => {
    expect(run("cost_per_reply", { threads: many })).toMatchObject({ display: "£1.50", sub: "over 2 replies" });
    expect(run("cost_per_reply")).toEqual({ display: null, sub: "no replies yet" });
  });

  it("reads runway off today's burn, and warns when it is short", () => {
    expect(run("runway")).toMatchObject({ display: "240d", sub: "at £0.05/day" });
    const burning = { ...ctx().budget, spentTodayPence: 400 };
    expect(run("runway", { budget: burning })).toMatchObject({ display: "3d", tone: "warn" });
  });

  it("will not guess a runway from a day with no spend", () => {
    const quiet = { ...ctx().budget, spentTodayPence: 0 };
    expect(run("runway", { budget: quiet })).toEqual({ display: null, sub: "nothing spent today" });
  });
});

describe("clock tiles", () => {
  it("counts days to the deadline and warns in the last week", () => {
    expect(run("days_left")).toMatchObject({ display: "51d", sub: "to 2026-11-16", tone: "plain" });
    const soon = { ...endeavour, deadline: "2026-10-01" } as Endeavour;
    expect(run("days_left", { endeavour: soon })).toMatchObject({ display: "5d", tone: "warn" });
  });

  it("names the period for an ongoing endeavour", () => {
    const ongoing = { ...endeavour, period: "month" } as Endeavour;
    expect(run("days_left", { endeavour: ongoing }).sub).toBe("to end of month");
  });

  it("never counts below zero once the deadline has passed", () => {
    const past = { ...endeavour, deadline: "2026-01-01" } as Endeavour;
    expect(run("days_left", { endeavour: past }).display).toBe("0d");
  });

  it("spreads the remaining gap over the days left", () => {
    // £2,250 short over the 51 days that remain, today included.
    expect(run("needed_per_day")).toMatchObject({ display: "£44", sub: "over 51 days" });
  });

  it("says the target is met rather than asking for a negative amount", () => {
    const done = { ...endeavour, actualValue: 3000 } as Endeavour;
    expect(run("needed_per_day", { endeavour: done })).toEqual({ display: "0", sub: "target met", tone: "good" });
  });

  it("counts whole units for an endeavour that is not counted in money", () => {
    const partners = { ...endeavour, unit: "COUNT", targetValue: 10, actualValue: 3 } as Endeavour;
    // 7 short over 51 days rounds up: a fraction of a partner is not a plan.
    expect(run("needed_per_day", { endeavour: partners }).display).toBe("1");
  });
});

describe("formatting", () => {
  it("shortens big numbers rather than punctuating them", () => {
    expect([999, 1500, 12_000, 1_200_000, 12_000_000].map((n) => compact(n))).toEqual([
      "999",
      "1.5k",
      "12k",
      "1.2M",
      "12M",
    ]);
  });

  it("carries the currency symbol, and drops it when there is no currency", () => {
    expect(money(750, "GBP")).toBe("£750");
    expect(money(750, "")).toBe("750");
  });
});

describe("resolveStatTiles", () => {
  it("returns the defaults when nothing has been chosen", () => {
    expect(resolveStatTiles(null).map((t) => t.id)).toEqual([...DEFAULT_STAT_TILES]);
    expect(resolveStatTiles([]).map((t) => t.id)).toEqual([...DEFAULT_STAT_TILES]);
  });

  it("returns what was chosen, in the order it was chosen", () => {
    const picked = ["runway", "revenue", "days_left", "reply_rate"];
    expect(resolveStatTiles(picked).map((t) => t.id)).toEqual(picked);
  });

  it("backfills from the defaults so the row is never half empty", () => {
    const tiles = resolveStatTiles(["revenue"]);
    expect(tiles).toHaveLength(STAT_TILE_COUNT);
    expect(tiles[0]!.id).toBe("revenue");
  });

  it("drops an id that no longer exists rather than leaving a gap", () => {
    const tiles = resolveStatTiles(["revenue", "a_tile_we_removed", "runway"]);
    expect(tiles.map((t) => t.id)).not.toContain("a_tile_we_removed");
    expect(tiles).toHaveLength(STAT_TILE_COUNT);
  });

  it("drops a duplicate rather than showing the same number twice", () => {
    const tiles = resolveStatTiles(["revenue", "revenue", "runway", "sent"]);
    expect(tiles.filter((t) => t.id === "revenue")).toHaveLength(1);
    expect(tiles).toHaveLength(STAT_TILE_COUNT);
  });

  it("never returns more than the row holds", () => {
    expect(resolveStatTiles(STAT_TILES.map((t) => t.id))).toHaveLength(STAT_TILE_COUNT);
  });
});
