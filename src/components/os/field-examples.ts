/**
 * The shape each spec field expects, as a worked example.
 *
 * The editor takes raw JSON, which is fine for reading a value back but hopeless for writing
 * one from scratch — particularly the horizon, whose shape changes with the endeavour's kind.
 * Showing the shape is the difference between "invalid" and "here is what to type".
 */
export const FIELD_EXAMPLES: Record<string, string> = {
  objective: `{
  "metric": "revenue",
  "target": 6000,
  "unit": "GBP",
  "currency": "GBP"
}`,
  horizon: `{
  "kind": "ongoing",
  "period": "month",
  "reviewEvery": 1
}

// a sprint instead:
// { "kind": "sprint", "endsOn": "2026-10-31" }`,
  offering: `{
  "summary": "What you sell, in one line",
  "deliverables": ["What the buyer receives", "And the rest"]
}`,
  pricing: `{
  "model": "package",
  "currency": "GBP",
  "minimumDeal": 95,
  "expectedDeal": 2400
}

// model: day_rate | package | retainer | subscription | rev_share | free
// minimumDeal  — the least you will accept. A floor, not a forecast.
// expectedDeal — what a typical engagement is worth. THIS is the number the
//                daily plan forecasts from, and what it replaces once real
//                deals are won.
// amount       — only for work with one fixed price. Leave it out otherwise.`,
  proof: `[
  {
    "kind": "repo",
    "title": "Arcaidia",
    "url": "https://github.com/you/arcaidia",
    "claim": "What this proves about you"
  }
]

// kind: repo | client | case_study | product | metric | publication`,
  buyers: `[
  {
    "name": "Launch-stage protocols",
    "definition": "Who they are",
    "signals": ["What shows they need it now"],
    "painHypothesis": "Why they hurt",
    "priority": 1
  }
]`,
  exclusions: `[
  {
    "rule": "Who you will not contact",
    "reason": "Why not"
  }
]`,
  cadence: `{
  "dailyNewTarget": 20,
  "dailyFollowupTarget": 5
}`,
};
