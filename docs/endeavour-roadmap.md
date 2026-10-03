# The endeavour roadmap

One vertical at a time, in the order the work actually happens: find them, decide on them,
know who they are, write to them, talk to them, close them. Each one finished before the
next is started.

The product is currently wide and shallow — every stage exists a bit, none of them well —
which is why the endeavour page reads as a wall of panels and why a live run can produce
eighteen prospects and nothing you can act on.

## What the first live run showed

Numbers from the Solidity sprint, 1 October, because the scope starts where it failed.

| | |
|---|---|
| Researched | 18, all from segment 1 |
| Qualified | **0** |
| Segments 2 and 3 | 0 proposed, across four paid attempts |
| Spent | $0.68 against a daily allowance of ~$0.61 |
| Inbound matched | 0 of 25 |

**Research spent the whole day's money before qualification ran.** A £15 month is 48p a
day; research used all of it, so all eighteen prospects hit *"today's share of the model
budget is spent"*. The zeros on screen were not a scoring result — nothing was scored.

Three further things the log says plainly:

- **Segments 2 and 3 returned nothing at all**, twice each, after escalation. Paid searches
  bought zero candidates. Either the definitions do not match anything findable, or the
  search strategy cannot find what they describe.
- **Twenty-five replies arrived and none matched a prospect.** Reply matching does not work.
- **The setpoints did work.** `0/50 pending · room for 50 across 3 segment(s)` — every
  segment was asked, which is the thing WP-20 set out to fix.

## Table of contents

- **WP-21 — A day's money is shared between phases.** Research cannot spend what
  qualification needs. The urgent one: without it nothing qualifies, and every work package
  below is unverifiable.
- **WP-22 — The endeavour page follows the work.** Sections in the order the work happens,
  with everything not yet built marked as not yet built rather than shown half-finished.
- **WP-23 — Research, finished.** Why two segments find nothing, what a candidate must
  carry before it counts, and a research screen on the endeavour itself.
- **WP-24 — Prospects, finished.** The list, the decision, and what has to be true before a
  prospect is worth a person's attention.
- **WP-25 — The prospect itself.** One screen per prospect: contacts, mailbox, LinkedIn,
  socials, status, and everything that has happened.
- **WP-26 — Outreach, finished.** Drafting, approving, sending, and what the operator sees
  before it goes.
- **WP-27 — Conversations.** Attributing a reply to the outreach that caused it, and
  everything that follows from getting that right. Absorbs WP-19.
- **WP-28 — Deals.** The pipeline as something that changes rather than something counted.
- **WP-29 — The living view.** The node graph, designed with you rather than by me.
  Supersedes WP-18.

After the roadmap, not in it: concurrent endeavours (COMMAND across all of them) and
intelligence (what is working, across time). Neither is worth building until one endeavour
works end to end.

---

## WP-21 — A day's money is shared between phases

### Why

A run is five phases that all cost money, and nothing stops the first one spending all of
it. On 1 October research used $0.68 of a ~$0.61 day and qualification got nothing. The run
then reported `stopping at 0 of 20 qualified`, which is accurate and useless: the money was
gone before the sentence was written.

This is not a budget-too-small problem. At any budget, an unsplit day lets discovery starve
judgement — and discovery is the phase whose output is worthless without judgement.

### The shape

Each phase gets a share of the day, and spends only its own. Research is capped at a
fraction of the allowance; qualification's share is reserved before research starts, because
eighteen unqualified prospects are worth less than six qualified ones.

A phase that hits its share says so against its own name, not against the day's.

### Tasks

| # | Task | Deliverable |
|---|---|---|
| T1 | Phase shares as a pure function: allowance → `{ research, qualify, draft, reply }`. Reserved, not first-come. | module + unit tests |
| T2 | The run reads its phase's share and stops against that, naming the phase. | daily-run + integration test |
| T3 | The brief and the digest report which phase ran out, not just that the day did. | wiring + test |
| T4 | A test that reproduces 1 October: a day's allowance, research that would take all of it, and qualification still running. | integration test |

### Done when

A run on a 48p day qualifies something.

---

## WP-22 — The endeavour page follows the work

### Why

The endeavour page is nine sections in an order that reflects the data model, not the work:
overview, review, prospects, pipeline, outreach, strategy, configuration, intelligence, runs.
Overview alone carries seven panels. There is no research section at all, so the stage that
produced everything else is the one stage you cannot see.

And most of what is on the page is half-built. Showing a half-built thing with no label is
worse than not showing it: the reader cannot tell a broken feature from an empty one.

### The shape

Sections in the order the work happens:

```
RESEARCH → PROSPECTS → PROSPECT → OUTREACH → CONVERSATIONS → DEALS
                                                    then: STRATEGY · CONFIGURATION · RUNS
```

Everything downstream of the vertical currently being built is **greyed and labelled** —
visible, so the shape of the whole is legible, and plainly marked as not yet finished. The
section rail reflects the same order and shows the same state.

Overview stops being a dashboard of everything and answers three questions: is it alive,
what needs me, am I on track.

### Tasks

| # | Task | Deliverable |
|---|---|---|
| T1 | Reorder the sections and the rail; one source for the order. | route + e2e |
| T2 | A `not-finished` treatment: dimmed, labelled, not interactive, with one line saying what it will do. | component + e2e |
| T3 | Cut overview to the three questions; move the rest into the stage it belongs to. | route + e2e |
| T4 | A RESEARCH section on the endeavour, which does not exist today. | route + e2e |

### Done when

You can read the endeavour page top to bottom and know what has happened, what is next, and
what is not built yet.

---

## WP-23 — Research, finished

### Why

This is the vertical to get completely right first, because everything downstream inherits
its output. Right now:

- Two of three segments return nothing, repeatedly, and still cost money.
- A candidate can be stored with no contact and no company, which makes it unactionable
  before anyone looks at it.
- The run log is on a different page from the endeavour that produced it.

### The shape

Research answers one question per candidate: **is there a specific, dated, checkable reason
to write to this company now.** A candidate without one is not a thin candidate, it is not a
candidate.

The dry-segment problem is diagnosed before it is fixed. Two possibilities and they need
different answers: the definition describes something the web cannot show, or the search
strategy is not looking where the evidence lives.

### Tasks

| # | Task | Deliverable |
|---|---|---|
| T1 | Instrument a dry segment: record the queries issued and what came back, so "0 proposed" becomes answerable. | wiring + integration test |
| T2 | Diagnose segments 2 and 3 against real searches, and write up which of the two causes it is. | a finding, in this doc |
| T3 | A candidate floor: no candidate is stored without a dated trigger and a source that can be opened. | command + tests |
| T4 | Stop paying twice for nothing: a segment that returns zero twice is reported and rested, not escalated again. | daily-run + test |
| T5 | The RESEARCH section on the endeavour — what ran, what it searched, what it found, what it cost. | route + e2e |
| T6 | The discovery queue readable at a glance: trigger, evidence, and what is missing before it can be judged. | component + e2e |

### Done when

Every segment returns candidates or says precisely why it cannot, and every stored candidate
carries something a person could act on.

---

## WP-24 — Prospects, finished

### Why

The prospects list is where a person decides, and deciding needs less than the list
currently shows and more than it currently says. A score with no explanation, a company with
no contact, and a row that cannot be acted on all look the same.

### The shape

Three states, visibly different: **not yet judged**, **judged and waiting on you**, **judged
and not worth it**. The list sorts by what needs you, not by score.

### Tasks

| # | Task | Deliverable |
|---|---|---|
| T1 | The three states as one derivation, used by every screen that shows a prospect. | module + unit tests |
| T2 | The list ordered by what needs a decision, with the reason beside each row. | route + e2e |
| T3 | Release, reject and dequeue reachable from the list in bulk — already built in WP-20, now surfaced here. | route + e2e |
| T4 | A prospect that cannot be contacted says so before you open it. | component + e2e |

### Done when

You can clear a day's prospects without opening one you did not need to.

---

## WP-25 — The prospect itself

### Why

Everything known about a company is currently spread across the prospects inspector, the
mailbox, the interaction log and the evidence table. Deciding whether to write to someone
means holding four screens in your head.

### The shape

One screen per prospect. Who they are, how they can be reached — email, LinkedIn, Discord,
X, the company site — what has happened with them, and what the agent believes and why.

Contacts are first-class: the operator adds them, the agent finds them, and both are shown
with where they came from.

### Tasks

| # | Task | Deliverable |
|---|---|---|
| T1 | The prospect read model: identity, contacts with provenance, evidence, history, status. | module + unit tests |
| T2 | The screen itself, reachable from the list and from the review. | route + e2e |
| T3 | Contacts you can add, edit and mark preferred, with the channel shown. | command + e2e |
| T4 | The full history on one timeline: research, qualification, outreach, replies, interactions logged by hand. | component + e2e |

### Done when

You can decide about a prospect without leaving its page.

---

## WP-26 — Outreach, finished

### Why

Drafting works and sending works, but the operator's view of what is about to go out is
thin, and nothing is drafted until a prospect is released — which makes release the real
decision and the draft an afterthought. It should be the other way round.

### Tasks

| # | Task | Deliverable |
|---|---|---|
| T1 | The draft shown beside the evidence it was written from. | component + e2e |
| T2 | Edit before approving, not only approve or reject. | command + e2e |
| T3 | What is queued, when it will go, and from which address — on the endeavour. | route + e2e |
| T4 | A send that failed says so where the prospect is, not only in the digest. | wiring + test |

### Done when

You can read, change and approve a day's outreach in one pass.

---

## WP-27 — Conversations

### Why

Twenty-five replies arrived and none was attributed to a prospect. Until that works, every
reply is manual, the conversion rates are wrong, and follow-ups cannot know whether to stop.

Absorbs WP-19, which specified the matching and was never built.

### Tasks

| # | Task | Deliverable |
|---|---|---|
| T1 | Attribute by mailbox, then by thread, then by address, and record which it was. | module + integration tests |
| T2 | What cannot be attributed is shown as such rather than silently dropped. | route + e2e |
| T3 | A reply stops the follow-up sequence for that prospect. | command + test |
| T4 | The conversation on the prospect's own page, in order, whichever channel it came through. | component + e2e |

### Done when

A reply lands against the right prospect without anyone touching it.

---

## WP-28 — Deals

### Why

The pipeline is currently a count. A deal has a value, a probability, a next action and a
date, and those change — the screen should be where they change, not where they are
displayed.

### Tasks

| # | Task | Deliverable |
|---|---|---|
| T1 | Stage moves, value and probability edited where the deal is. | command + e2e |
| T2 | Won and lost with a reason, feeding the deal value the objective arithmetic uses. | command + test |
| T3 | The objective read against real deals rather than assumed rates, once there are any. | wiring + test |

### Done when

Closing a deal takes one action and the objective moves.

---

## WP-29 — The living view

### Why

Deliberately last, and deliberately unspecified.

I drew a version of this — six stage columns, a dot per prospect, movement animated along
the edges — and you have said that is not what you have in mind. Rather than build mine and
have it be wrong twice, this work package starts with your description.

**Supersedes WP-18**, whose only built part is `src/data/pipeline-field.ts` — a pure
derivation from the dataset to stages and nodes. That is reusable whatever the view turns
out to be; everything else in WP-18 should be read as a proposal that was not taken up.

### What I need before this can be scoped

- What the thing is showing: the agent working, the prospects moving, or the money.
- Whether it is a live view you watch, or a picture of the current state you glance at.
- What you want to be able to tell at a glance that you cannot tell today.
- Whether anything in it is clickable, and what happens when it is.

### Done when

It is scoped. The tasks cannot be written before the shape is agreed.

---

## Not in this roadmap

- **Concurrent endeavours.** COMMAND as a view across all of them. Nothing to compare until
  one works.
- **Intelligence.** What is working, by segment, offer and message, over time. Needs volume
  this does not have, and would currently be a screen of noise with a sample size of one.
- **Automatic segment reallocation.** Built and off by default; its preconditions are in
  `docs/prospecting-setpoints.md`.
