# WP-20 — Setpoints, and a report that asks for what it needs

Prospecting becomes a closed loop with two operator-set numbers, and the system stops
deciding on its own when a prospect has gone cold.

## Why

Today the daily run computes one number for the whole endeavour and lets segments compete
for it in priority order:

```ts
const wanted = Math.max(0, workload.newProspects - found.length);
for (const segment of active.sort((a, b) => a.priority - b.priority)) {
  if (created >= wanted) break;
  ...
}
```

The first segment fills the day's target and the rest never run. On the first real run that
produced 10 prospects and 0 qualified: the highest-priority segment carries no size or
funding constraint, so it matches almost anything with a public incident, and the two
segments that *do* carry those constraints were never asked.

Raising the target is the wrong fix. Discovery decoupled from the rate the operator clears
work means paying to research leads nobody will ever act on, forever. What is wanted is a
buffer the system keeps full, not a quota it keeps hitting.

## The shape

Two numbers the operator sets, per endeavour.

**`MAXIMUM_PENDING_PROSPECTS`** (default 50) — how many prospects may be live and
unanswered at once, across all segments. The system tops up towards it and stops when it is
full. Being full means the operator has work to do, and the correct response is to say so,
not to find more strangers.

**`ACTIVE_PROSPECTS_GOAL`** (default 20) — how many live conversations are enough. Reached,
prospecting stops entirely. One falls through and it resumes.

Plus **PAUSE PROSPECTING**, which stops it regardless of either.

### The two populations

Both are computable from stages that already exist. No new columns.

| | Stages | Meaning |
|---|---|---|
| **pending** | `discovered`, `researched`, `qualified`, `contacted` | found, maybe written to, no answer yet |
| **active** | `replied`, `meeting`, `proposal` | they answered and the operator answered back |
| neither | `won`, `lost`, `nurture`, `reviewStatus = 'rejected'` | the slot is free |

An unreleased prospect **counts as pending**. It cost money and it is waiting on the
operator, which is exactly what the cap is about.

### The split across segments

Fixed cap, equal floors: `floor(MAXIMUM_PENDING / segments.length)`, and a segment below its
floor has first claim on freed slots. Adding a fourth segment lowers every floor rather than
raising the cap — the 50 is a statement about the operator's capacity, and that does not
change because they thought of another buyer type. A new segment fills as slots free, within
days rather than immediately.

The operator may **pin** a segment's share, overriding the equal split. Pinned shares are
honoured first; the remainder is divided equally among the rest.

## Nothing leaves the stack on its own

The common outcome for cold outreach is neither a reply nor a rejection. It is silence, and
nobody presses reject on silence.

The obvious mechanism is to lapse a silent prospect to `nurture` after N days and free the
slot. **That is deliberately not what this does.** Dequeuing is the operator's decision;
a system that quietly clears its own backlog is a system whose numbers cannot be trusted.

The consequence is accepted on purpose: **a full buffer stalls prospecting, and it can stall
indefinitely.** Which makes one thing non-negotiable — the stall must be visible, attributed
and quantified wherever the operator looks:

> Prospecting is paused. 50/50 pending, 38 silent for 14+ days. Dequeue or reject to resume.

Silence goes unresolved forever only in the sense that the system will not resolve it. The
weekly review asks about it every week, with a bulk action attached, until it is dealt with.

## Contact that did not go through the mailbox

An address may be missing, or the conversation may be happening on Discord, LinkedIn or a
call. None of that is visible to a system that only watches a mailbox, and without it the
counters are wrong: a prospect in talks elsewhere reads as pending forever.

So an **interaction log**: the operator records `{ prospectId, channel, direction, occurredAt, note }`
and the prospect moves stage accordingly. Contacted on Discord is `contacted`; answered on
Discord, once answered back, is `replied`.

**These must not enter the conversion arithmetic.** `planWorkload` derives the daily target
from observed reply rate over messages actually sent. Counting a Discord conversation as a
reply to an email that was never sent inflates the rate and the system concludes fewer
prospects are needed. Manual interactions are visible in the pipeline and on the prospect,
and excluded from `Observed.sent` and `Observed.replies`. Cheap now, painful to retrofit.

## The report

One elected channel. The `notification_channels` table currently allows several enabled at
once; electing a channel disables the others, and the UI says so rather than doing it
silently.

**Daily — a morning digest.** Only what should wake someone:

- a reply came in
- a released prospect did not get sent (a mailbox problem)
- prospecting has stalled, with the reason and the number
- the budget is exhausted

**Weekly — the comprehensive review.** Assembled from the data, then handed to Claude to
write the covering text against a fixed template and the app's own voice. The lists are
exact because they are queried; only the prose is generated. Every item links back into the
app.

Three sections the operator acts on:

| | |
|---|---|
| **Follow up with these** | replies waiting on an answer, oldest first |
| **Approve or reject these** | researched and qualified, waiting for release |
| **Update on these** | silent 14+ days · marked won or lost nowhere · in talks off-channel with no interaction logged since |

And one they read — **NEWS**: per-segment counts, what replies actually said, objection
clusters, and what changed. Every rate carries its sample size, and says outright when the
sample is too small to rank rather than implying a winner.

## What the objective arithmetic becomes

`planWorkload` stops driving the daily number and becomes a **warning**. If the setpoints
cannot reach the objective at observed rates, the review says so:

> 20 active conversations will not reach £6,000 by 30 October at your current rates. That
> needs roughly 35.

Otherwise the system can be perfectly healthy against its own setpoints while the deadline
goes past.

## Dynamic reallocation — deferred, and why

Weighting the split towards whichever segment performs best is right, and not at this
volume.

With a 50 cap, three segments and the code's 5% prior reply rate, working the buffer and
replacing it once inside 30 days is ~100 sends: **about five replies in total, under two per
segment.** `RATE_MIN_SAMPLE = 15` makes a per-segment rate *measurable* within a week. It
does not make two segments *distinguishable* — 0/16 against 1/16 is not evidence, and
telling a 5% segment from a 10% one takes hundreds of sends per arm. Reallocating on the
first would starve a segment on an unlucky first sixteen, and a starved segment can never
disprove it.

Revenue weighting is worse early, not better: at ~£2,400 typical against £6,000, one win
anywhere swamps every other signal, on a sample of one.

So the operator pins shares for now, and forms that view from reading the drafts and the
replies — which at this volume is better evidence than the arithmetic can offer.

When it is built, it needs all four of:

- a reserved exploration floor, so no segment reaches zero and becomes unfalsifiable
- bounded movement per cycle, so it cannot chase a fortnight of noise
- revenue-weighted once wins exist, reply-weighted before, and explicit about which
- shown with the numbers behind it, and overridable

**The confounder to remember:** a segment can look bad because its drafts are bad, not
because the buyers are wrong. Automatic reallocation routes around a fixable writing problem
without ever naming it.

## Tasks

Each is one commit with its tests, in order.

| # | Task | Deliverable |
|---|---|---|
| **T1** | **Count the populations.** `src/server/domain/prospecting.ts` — pure functions from prospect rows to `{ pending, active, perSegment }`, with the stage sets above. Unreleased counts as pending. | module + unit tests |
| **T2** | **The setpoints.** `maximumPendingProspects`, `activeProspectsGoal`, `prospectingPaused` on the endeavour; migration with the defaults; settings UI. | migration + route + e2e |
| **T3** | **Allocate.** Pure: cap, segment list, pinned shares and current per-segment pending → how many each segment may add. Equal floors, pinned honoured first, under-floor segments first on freed slots. | module + unit tests |
| **T4** | **Drive the run from it.** Replace the `break`-when-full loop: every active segment researches up to its allocation; the run stops when pending is full, the active goal is met, or prospecting is paused — and logs which of the three it was. | daily-run + integration test |
| **T5** | **Interaction log.** Table, operator action, stage transitions, and exclusion from `Observed.sent`/`Observed.replies`. A test that asserts the exclusion, naming the inflated-rate failure. | migration + command + tests |
| **T6** | **One elected channel.** Electing disables the others; the UI states it. | command + e2e |
| **T7** | **Daily digest.** The four urgent conditions, assembled, sent to the elected channel, recorded in-app first. | job + tests |
| **T8** | **Weekly review.** Queried lists, Claude-written covering text against a fixed template, links back into the app, NEWS with sample sizes. | job + prompt + tests |
| **T9** | **The objective warning.** `planWorkload` output rendered as a warning in the review when the setpoints cannot reach the objective. | wiring + test |
| **T10** | **Bulk actions from the review.** Dequeue, reject, mark won/lost — the existing toggle-and-submit list, reached from the review's links. | route + e2e |

## Not in this work package

- Automatic segment reallocation. Deferred above, with its preconditions written down.
- Narrowing the brief's first segment. That is a change to the operator's text, not to the
  system, and is the operator's to make.
- Any change to drafting, sending or reply matching (WP-19).
