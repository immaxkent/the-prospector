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

## What can and cannot be automated

This constrains everything from WP-26 onwards, so it is settled here rather than discovered
later.

| Channel | Cold outreach | Replying |
|---|---|---|
| **Email** | yes | yes |
| **LinkedIn** | no API permits it; anything that does drives the web UI against their terms | manual |
| **Discord** | bots may only DM users who share a server; unsolicited DMs are spam under their terms | yes, where they joined |
| **Telegram** | the Bot API can only message someone who messaged the bot first | yes, once they have |
| **Slack** | an app posts only where it is installed; Connect DMs need accepting | yes, in a shared workspace |

The pattern is the same on all four: **they permit replying and none permit initiating.**
Email is the only channel where cold outreach is both legitimate and deliverable.

So the system writes the message, sends it where it legitimately can, and **hands it over
ready to paste where it cannot** — which is what the interaction log already closes the loop
on. That is a deliberate product decision, not a limitation to work around: automating the
other three risks the accounts and the reputation they are worth having.

Platform policies move. Re-check before building against any of them.

## Table of contents

Each is shippable on its own and each is finished before the next is started.

- **WP-21 — A day's money is shared between phases.** *Done, merged.* Research can no longer
  spend what qualification needs.
- **WP-22 — The shell.** The endeavour page in the order the work happens, with everything
  not yet built greyed and labelled. Small, and the prerequisite for the rest being legible.
- **WP-23 — Research.** Find them. Why two segments return nothing, what a candidate must
  carry before it counts, and a research screen on the endeavour itself.
- **WP-24 — Identify.** Decide which of them is a lead. Qualification you can read, and the
  three states a prospect can be in.
- **WP-25 — Reach.** Find the human and the way to them, per channel, with where it came
  from. One page per prospect.
- **WP-26 — Draft and cache.** Write the outreach. Email is sent; LinkedIn, Discord,
  Telegram and Slack are prepared and handed over.
- **WP-27 — Send and track.** The email half, automated: queue, pace, send, and know it
  landed. The off-channel half: mark it sent when you have sent it.
- **WP-28 — Conversations.** Attribute a reply to the outreach that caused it. Absorbs
  WP-19.
- **WP-29 — Deals.** The pipeline as something that changes rather than something counted.
- **WP-30 — The living view.** The node graph, designed with you rather than by me.
  Supersedes WP-18.

After the roadmap, not in it: concurrent endeavours (COMMAND across all of them) and
intelligence (what works, over time). Neither is worth building until one endeavour works
end to end.

---

## WP-22 — The shell

### Why

The endeavour page is nine sections in an order that reflects the data model, not the work.
Overview alone carries seven panels. There is no research section at all, so the stage that
produced everything else is the one stage you cannot see.

Most of what is on the page is half-built, and showing a half-built thing unlabelled is
worse than not showing it: you cannot tell a broken feature from an empty one.

### The shape

```
RESEARCH → IDENTIFY → REACH → OUTREACH → CONVERSATIONS → DEALS
                                    then: STRATEGY · CONFIGURATION · RUNS
```

Everything downstream of the vertical being built is **greyed and labelled** — visible, so
the shape of the whole is legible, and plainly marked as not finished. The section rail
shows the same order and the same state.

Overview stops being a dashboard of everything and answers three questions: is it alive,
what needs me, am I on track.

### Tasks

| # | Task | Deliverable |
|---|---|---|
| T1 | Reorder the sections and the rail from one source. | route + e2e |
| T2 | A `not-finished` treatment: dimmed, labelled, not interactive, one line on what it will do. | component + e2e |
| T3 | Cut overview to the three questions; move the rest into the stage it belongs to. | route + e2e |
| T4 | A RESEARCH section, which does not exist today. | route + e2e |

### Done when

You can read the page top to bottom and know what has happened, what is next, and what is
not built.

---

## WP-23 — Research

### Why

Everything downstream inherits this. Right now two of three segments return nothing,
repeatedly, and still cost money; a candidate can be stored with no contact and no company;
and the run log is on a different page from the endeavour that produced it.

### The shape

Research answers one question per candidate: **is there a specific, dated, checkable reason
to write to this company now.** A candidate without one is not a thin candidate, it is not a
candidate.

The dry-segment problem is diagnosed before it is fixed. Two causes need different answers:
the definition describes something the web cannot show, or the search is not looking where
the evidence lives.

### Tasks

| # | Task | Deliverable |
|---|---|---|
| T1 | Instrument a dry segment: record the queries issued and what came back, so "0 proposed" becomes answerable. | wiring + integration test |
| T2 | Diagnose segments 2 and 3 against real searches; write up which cause it is. | a finding, in this doc |
| T3 | A candidate floor: nothing stored without a dated trigger and a source that opens. | command + tests |
| T4 | A segment returning zero twice is rested and reported, not escalated again. | daily-run + test |
| T5 | The RESEARCH section: what ran, what it searched, what it found, what it cost. | route + e2e |
| T6 | The discovery queue readable at a glance, including what is missing before it can be judged. | component + e2e |

### Done when

Every segment returns candidates or says precisely why it cannot, and every stored candidate
carries something a person could act on.

---

## WP-24 — Identify

### Why

Qualification is the step that turns a candidate into a lead, and at the moment you cannot
see it work: a score with no explanation, a company with no contact, and a row that cannot
be acted on all look alike.

### The shape

Three states, visibly different: **not yet judged**, **judged and waiting on you**, **judged
and not worth it**. The list sorts by what needs you, not by score. Every score shows what it
was made of.

### Tasks

| # | Task | Deliverable |
|---|---|---|
| T1 | The three states as one derivation, used by every screen showing a prospect. | module + unit tests |
| T2 | The list ordered by what needs a decision, with the reason beside each row. | route + e2e |
| T3 | The score opened up: the factors, their weights, and the evidence each rests on. | component + e2e |
| T4 | Release, reject and dequeue in bulk from the list — built in WP-20, surfaced here. | route + e2e |

### Done when

You can clear a day's leads without opening one you did not need to.

---

## WP-25 — Reach

### Why

A lead you cannot contact is not a lead. Contacts are currently spread across the inspector,
the mailbox and the interaction log, and a prospect with no address looks the same as one
with three.

### The shape

One page per prospect. Who they are, every way to reach them — email, LinkedIn, Discord, X,
Slack, the company site — **and where each came from**: found by research, added by you,
seen in a reply. Provenance matters because an address the agent guessed is not the same as
one you confirmed.

Reachability is a first-class state, visible before you open the prospect.

### Tasks

| # | Task | Deliverable |
|---|---|---|
| T1 | The prospect read model: identity, contacts with provenance and channel, evidence, history. | module + unit tests |
| T2 | The page itself, reachable from the list and from the review. | route + e2e |
| T3 | Contacts you can add, edit and mark preferred, with the channel and source shown. | command + e2e |
| T4 | The full history on one timeline: research, qualification, outreach, replies, interactions logged by hand. | component + e2e |
| T5 | Reachability shown on the list, so an unreachable lead is obvious before you open it. | component + e2e |

### Done when

You can decide about a lead, and know how to reach it, without leaving its page.

---

## WP-26 — Draft and cache

### Why

Email can be sent. The other four channels cannot, and pretending otherwise would either
break their terms or quietly do nothing. So the system's job on those channels is to make
the message ready and get out of the way.

### The shape

Every outreach is drafted the same way, from the same evidence, whatever channel it is for —
and then **either queued for sending or cached for you to paste**, depending on what the
channel allows.

A cached message is not a lesser thing. It carries the channel, the handle, the message, and
a one-press copy; marking it sent is one action, and that writes the interaction log entry
that keeps the counters honest.

Length and register follow the channel: a LinkedIn note is not an email, and a Discord
message is neither.

### Tasks

| # | Task | Deliverable |
|---|---|---|
| T1 | The draft carries its channel, and the prompt writes for that channel. | prompt + tests |
| T2 | Drafts shown beside the evidence they were written from. | component + e2e |
| T3 | Edit before approving, not only approve or reject. | command + e2e |
| T4 | Cached outreach: channel, handle, message, copy, and one press to say it was sent. | route + e2e |
| T5 | Marking a cached message sent writes the interaction log entry, so the counters stay right. | command + integration test |

### Done when

Every lead has a message ready, and sending it is one action whichever channel it is on.

---

## WP-27 — Send and track

### Why

The email half already mostly works and is under-reported: a send that failed appears in the
digest and nowhere near the prospect it failed for.

### Tasks

| # | Task | Deliverable |
|---|---|---|
| T1 | What is queued, when it will go, and from which address — on the endeavour. | route + e2e |
| T2 | A failed send shown on the prospect, not only in the digest. | wiring + test |
| T3 | Follow-ups visible as a sequence with its next date, and stoppable. | component + e2e |
| T4 | Off-channel sends counted alongside email, and kept out of the email rates. | read model + tests |

### Done when

You can see everything that has gone out and everything about to.

---

## WP-28 — Conversations

### Why

Twenty-five replies arrived on 1 October and none was attributed to a prospect. Until that
works every reply is manual, the conversion rates are wrong, and follow-ups cannot know to
stop. Absorbs WP-19, which specified this and was never built.

### Tasks

| # | Task | Deliverable |
|---|---|---|
| T1 | Attribute by mailbox, then thread, then address, recording which it was. | module + integration tests |
| T2 | What cannot be attributed is shown as such rather than silently dropped. | route + e2e |
| T3 | A reply stops the follow-up sequence for that prospect. | command + test |
| T4 | The conversation on the prospect's page, in order, whichever channel it came through. | component + e2e |

### Done when

A reply lands against the right prospect without anyone touching it.

---

## WP-29 — Deals

### Why

The pipeline is a count. A deal has a value, a probability, a next action and a date, and
those change — the screen should be where they change.

### Tasks

| # | Task | Deliverable |
|---|---|---|
| T1 | Stage, value and probability edited where the deal is. | command + e2e |
| T2 | Won and lost with a reason, feeding the deal value the objective uses. | command + test |
| T3 | The objective read against real deals rather than assumed rates, once there are any. | wiring + test |

### Done when

Closing a deal takes one action and the objective moves.

---

## WP-30 — The living view

### Why

Deliberately last, and deliberately unspecified.

I drew a version — six stage columns, a dot per prospect, movement animated along the edges
— and you have said that is not what you have in mind. Rather than build mine and have it be
wrong twice, this starts with your description.

**Supersedes WP-18**, whose only built part is `src/data/pipeline-field.ts`: a pure
derivation from the dataset to stages and nodes. That is reusable whatever the view turns out
to be; the rest of WP-18 was a proposal that was not taken up.

### What I need before this can be scoped

- What it is showing: the agent working, the leads moving, or the money.
- Whether you watch it live, or glance at a picture of the current state.
- What you want to tell at a glance that you cannot tell today.
- Whether anything in it is clickable, and what happens when it is.

### Done when

It is scoped. The tasks cannot be written before the shape is agreed.

---

## Not in this roadmap

- **Concurrent endeavours.** COMMAND across all of them. Nothing to compare until one works.
- **Intelligence.** What works, by segment, offer and message, over time. Needs volume this
  does not have; today it would be a screen of noise with a sample size of one.
- **Automatic segment reallocation.** Built and off by default; preconditions in
  `docs/prospecting-setpoints.md`.
- **Automating cold outreach on LinkedIn, Discord, Telegram or Slack.** Not a sequencing
  decision — see the table above.
