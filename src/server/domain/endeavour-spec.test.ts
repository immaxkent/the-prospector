import { describe, expect, it } from "vitest";
import {
  downgradeUnverifiedQuotes,
  endeavourSpecSchema,
  evaluateActivation,
  plannerSpecSchema,
  quoteAppearsInBrief,
  senderClaimsAllowed,
  type EndeavourSpec,
} from "./endeavour-spec";

const BRIEF = `I want to make £3,000 from Solidity consulting in the next 60 days.
I sell pre-audit security reviews at £750 per fixed five-day package.
Target launch-stage protocol teams.`;

function readySpec(overrides: Partial<EndeavourSpec> = {}): EndeavourSpec {
  return {
    name: "£3K Solidity Sprint",
    kind: "sprint",
    objective: {
      state: "stated",
      quote: "make £3,000 from Solidity consulting",
      value: { metric: "revenue", target: 3000, unit: "GBP", currency: "GBP" },
    },
    horizon: { state: "confirmed", value: { kind: "sprint", endsOn: "2026-11-16" } },
    offering: {
      state: "stated",
      quote: "pre-audit security reviews",
      value: { summary: "Pre-audit security review", deliverables: ["Findings report"] },
    },
    pricing: {
      state: "stated",
      quote: "£750 per fixed five-day package",
      value: { model: "package", amount: 750, currency: "GBP" },
    },
    proof: {
      state: "confirmed",
      value: [{ kind: "repo", title: "Arcaidia", url: "https://github.com/immaxkent/arcaidia", claim: "Built it" }],
    },
    buyers: {
      state: "confirmed",
      value: [
        {
          name: "Launch-stage protocols",
          definition: "Teams of 2-12 engineers before their first audit",
          signals: ["Testnet deployment in the last 30 days"],
          painHypothesis: "Audit firms are booked months out",
          priority: 1,
        },
      ],
    },
    exclusions: { state: "confirmed", value: [] },
    mailboxId: { state: "confirmed", value: "mbx_1" },
    cadence: { state: "confirmed", value: { dailyNewTarget: 10, dailyFollowupTarget: 8 } },
    channels: ["email"],
    autonomyLevel: "DRAFT",
    ...overrides,
  };
}

const ctx = { brief: BRIEF, connectedMailboxIds: ["mbx_1"] };
const codes = (spec: EndeavourSpec, c = ctx) => evaluateActivation(spec, c).blockers.map((b) => b.code);

describe("schema", () => {
  it("accepts a complete spec", () => {
    expect(endeavourSpecSchema.safeParse(readySpec()).success).toBe(true);
  });

  it("rejects empty quotes, reasons and rationales", () => {
    const bad = readySpec({ proof: { state: "not_applicable", reason: "  " } });
    expect(endeavourSpecSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects channels other than email", () => {
    const bad = { ...readySpec(), channels: ["linkedin"] };
    expect(endeavourSpecSchema.safeParse(bad).success).toBe(false);
  });

  it("does not let the planner confirm or mark fields not applicable", () => {
    const { mailboxId: _m, channels: _c, autonomyLevel: _a, ...planner } = readySpec();
    expect(plannerSpecSchema.safeParse(planner).success).toBe(false); // contains confirmed fields
    const onlyStated = { ...planner, horizon: { state: "missing" }, proof: { state: "missing" }, buyers: { state: "missing" }, exclusions: { state: "missing" }, cadence: { state: "missing" } };
    expect(plannerSpecSchema.safeParse(onlyStated).success).toBe(true);
    const withNa = { ...onlyStated, proof: { state: "not_applicable", reason: "new product" } };
    expect(plannerSpecSchema.safeParse(withNa).success).toBe(false);
  });
});

describe("activation gate", () => {
  it("passes a complete spec", () => {
    expect(evaluateActivation(readySpec(), ctx)).toEqual({ ready: true, blockers: [] });
  });

  it("blocks missing and suggested fields", () => {
    const spec = readySpec({
      buyers: { state: "missing" },
      cadence: { state: "suggested", value: { dailyNewTarget: 5, dailyFollowupTarget: 5 }, rationale: "default" },
    });
    expect(codes(spec)).toEqual(["field_missing", "field_suggested"]);
  });

  it("only allows not applicable on pricing and proof", () => {
    const spec = readySpec({
      objective: { state: "confirmed", value: { metric: "users", target: 500, unit: "signups" } },
      pricing: { state: "not_applicable", reason: "free beta" },
      proof: { state: "not_applicable", reason: "brand new" },
      buyers: { state: "not_applicable", reason: "anyone" },
    });
    expect(codes(spec)).toEqual(["not_applicable_not_allowed"]);
  });

  it("blocks stated values whose quote is not in the brief", () => {
    const spec = readySpec({
      offering: {
        state: "stated",
        quote: "full audits for DAOs",
        value: { summary: "Audits", deliverables: ["Report"] },
      },
    });
    expect(codes(spec)).toEqual(["quote_not_in_brief"]);
  });

  it("requires the horizon to match the endeavour kind", () => {
    const spec = readySpec({
      kind: "ongoing",
      horizon: { state: "confirmed", value: { kind: "sprint", endsOn: "2026-11-16" } },
    });
    expect(codes(spec)).toEqual(["horizon_kind_mismatch"]);
  });

  it("requires pricing, an amount and a currency for revenue objectives", () => {
    expect(codes(readySpec({ pricing: { state: "not_applicable", reason: "tbd" } }))).toEqual([
      "pricing_required_for_revenue",
    ]);
    expect(codes(readySpec({ pricing: { state: "confirmed", value: { model: "day_rate" } } }))).toEqual([
      "pricing_amount_required",
    ]);
    expect(codes(readySpec({ pricing: { state: "confirmed", value: { model: "free" } } }))).toEqual([]);
    expect(
      codes(
        readySpec({ objective: { state: "confirmed", value: { metric: "revenue", target: 3000, unit: "GBP" } } }),
      ),
    ).toEqual(["revenue_currency_required"]);
  });

  it("only accepts empty exclusions when the user confirmed them", () => {
    expect(codes(readySpec({ exclusions: { state: "stated", value: [], quote: "Target launch-stage" } }))).toEqual([
      "exclusions_need_explicit_confirmation",
    ]);
  });

  it("requires a connected mailbox", () => {
    expect(codes(readySpec(), { ...ctx, connectedMailboxIds: [] })).toEqual(["mailbox_not_connected"]);
  });

  it("blocks autonomy levels that are disabled in v1", () => {
    expect(codes(readySpec({ autonomyLevel: "GUARDED" }))).toEqual(["autonomy_level_disabled"]);
    expect(codes(readySpec({ autonomyLevel: "OBSERVE" }))).toEqual([]);
  });
});

describe("quotes", () => {
  it("matches across whitespace and smart quotes", () => {
    expect(quoteAppearsInBrief("make   £3,000\nfrom", BRIEF)).toBe(true);
    expect(quoteAppearsInBrief("I’m", "I'm selling")).toBe(true);
    expect(quoteAppearsInBrief("", BRIEF)).toBe(false);
  });

  it("downgrades unverified stated fields to suggestions", () => {
    const spec = readySpec({
      offering: { state: "stated", quote: "invented", value: { summary: "X", deliverables: ["Y"] } },
    });
    const next = downgradeUnverifiedQuotes(spec, BRIEF);
    expect(next.offering.state).toBe("suggested");
    expect(next.objective.state).toBe("stated");
    expect(spec.offering.state).toBe("stated"); // input untouched
  });
});

describe("sender claims", () => {
  it("are only allowed with proof", () => {
    expect(senderClaimsAllowed(readySpec())).toBe(true);
    expect(senderClaimsAllowed(readySpec({ proof: { state: "not_applicable", reason: "none yet" } }))).toBe(false);
  });
});
