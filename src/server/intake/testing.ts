/** A plausible planner response for the Solidity fixture brief, used by tests. Test-only. */
export function solidityPlannerOutput(overrides: Record<string, unknown> = {}) {
  return {
    spec: {
      name: "£3K Solidity Sprint",
      kind: "sprint",
      objective: {
        state: "stated",
        quote: "make £3,000 from Solidity consulting",
        value: { metric: "revenue", target: 3000, unit: "GBP", currency: "GBP" },
      },
      horizon: { state: "stated", quote: "in the next 60 days", value: { kind: "sprint", endsOn: "2026-11-16" } },
      offering: {
        state: "stated",
        quote: "pre-audit security reviews of smart contracts",
        value: { summary: "Fixed-scope pre-audit security review", deliverables: ["Written findings note"] },
      },
      pricing: {
        state: "suggested",
        rationale: "Only a minimum deal was given",
        value: { model: "package", currency: "GBP", minimumDeal: 300 },
      },
      proof: { state: "missing" },
      buyers: {
        state: "stated",
        quote: "launch-stage protocol teams that are close to mainnet",
        value: [
          {
            name: "Launch-stage protocols",
            definition: "Teams close to mainnet without an external audit",
            signals: ["Mainnet date announced"],
            painHypothesis: "Audit firms are booked out before launch",
            priority: 1,
          },
        ],
      },
      exclusions: { state: "missing" },
      cadence: {
        state: "stated",
        quote: "10 new prospects and 8 follow-ups a day",
        value: { dailyNewTarget: 10, dailyFollowupTarget: 8 },
      },
      ...overrides,
    },
    questions: [
      { field: "pricing", question: "What do you charge for a pre-audit review?" },
      { field: "proof", question: "What can outreach point to as proof of your Solidity work?" },
    ],
  };
}
