# Endeavour spec: schema and activation rules

Status: draft, 2026-09-16. This extends the CBO OS handoff (§2, §7). It will be implemented as Zod schemas in `packages/core`.

An Endeavour can be a short **sprint** (the £3K Solidity challenge) or an **ongoing** programme (Decastream). The intake planner turns a plain-language brief into an `EndeavourSpec`. **The Endeavour can't be activated until every required field passes the checks below.** The server enforces this, not the model.

## Field states

Every required field is wrapped in a state:

```ts
type Field<T> =
  | { state: "stated";         value: T; quote: string }      // taken from the user's own words
  | { state: "confirmed";      value: T }                      // user set or approved it in the UI
  | { state: "not_applicable"; reason: string }                // user explicitly marked it N/A
  | { state: "suggested";      value: T; rationale: string }   // planner's proposal: BLOCKS activation
  | { state: "missing" }                                       // BLOCKS activation
```

- The planner may only output `stated`, `suggested` or `missing`. Only the user can make a field `confirmed` or `not_applicable`.
- A `stated` value must include a `quote`, and the server checks that the quote appears word for word in the brief. If it doesn't, the field drops to `suggested`.
- `quote`, `rationale` and `reason` must be non-empty strings.
- For every `suggested` or `missing` field, the planner asks the user a question. It keeps asking until nothing is left unanswered.

## EndeavourSpec

| Field | Type | Required rule |
|---|---|---|
| `name` | string | required |
| `kind` | `sprint` \| `ongoing` | required |
| `objective` | `{ metric: revenue\|customers\|users\|partners\|meetings\|custom, target, unit, currency? }` | required |
| `horizon` | sprint: `{ ends_on }` · ongoing: `{ period: week\|month\|quarter, review_every }` | required; must match `kind` |
| `offering` | `{ summary, deliverables: string[≥1] }` | required: **what you actually sell** |
| `pricing` | `{ model: day_rate\|package\|retainer\|subscription\|rev_share\|free, amount?, currency?, minimum_deal? }` | required. If the objective is `revenue`, `not_applicable` is not allowed and `amount` is required unless the model is `free` |
| `proof` | `{ kind: repo\|client\|case_study\|product\|metric\|publication, title, url?, claim }[≥1]` | required. `not_applicable` is allowed, but then drafts may make **no** claims about the sender |
| `buyers` | `{ name, definition, signals: string[≥1], pain_hypothesis, priority }[≥1]` | required: **who buys it** |
| `exclusions` | `{ rule, reason }[]` | required. An empty list only passes as `confirmed`, meaning the user explicitly said "no exclusions" |
| `mailbox_id` | ref → `mailboxes` | required; must be a connected mailbox |
| `channels` | `["email"]` | fixed for v1 |
| `cadence` | `{ daily_new_target, daily_followup_target }` | required |
| `autonomy_level` | `0 \| 1` (2 and 3 exist but are disabled in v1) | default `1` |

## Rules that apply everywhere

- **No invented claims.** Anything a draft says about the prospect must cite research evidence. Anything it says about the sender must cite a `proof` item.
- **Sprints and ongoing Endeavours behave differently:**
  - A sprint reports progress against its deadline and produces a close-out report when it ends.
  - An ongoing Endeavour reports over rolling windows (`period`). At each `review_every`, the planner proposes a new strategy version for the user to approve. Past versions are never overwritten.
- **Mailboxes are shared resources.** Several Endeavours can use one mailbox, but send caps and warm-up limits apply per mailbox, across all Endeavours using it.
