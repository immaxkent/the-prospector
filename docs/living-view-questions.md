# WP-29 — the living view: what I need from you before building it

Written 2026-10-08, after finishing WP-21 through WP-28.

## Why this document exists rather than the thing itself

WP-29's own roadmap entry says it is to be designed with you rather than by me, and it earned
that line: I proposed a node graph twice and you told me plainly that we had very different
ideas in mind. Building my version a third time would waste the work and the money it costs
to look at.

Everything before WP-29 is done and does not depend on it. This is the only work package
left in the roadmap, and it is blocked on five answers, not on effort.

## What already exists, so you are not asked to re-specify it

- **The run log.** Every step a run took, in order, with what it cost — on `/research`, in the
  RUN LOG panel.
- **The agent clock.** Whether a run is going, which phase it is on, when the next one is due,
  and whether the last one failed. `src/data/agent-clock.ts`.
- **The phase budget.** How a day's money is split across reply, research, qualify and draft,
  and which phase exhausted itself. `src/server/domain/phase-budget.ts`.
- **The outbound queue.** What is about to go out, when, from which address, and what failed.
  Built in WP-26.
- **Per-prospect history.** One tape of research, qualification, sends, replies and decisions.
  Built in WP-25.

A live view can read all of that today without any new recording.

## The five questions

**1. What is it for — watching, or catching?**
Two different screens. *Watching* is something you leave open while a run goes, like a
progress bar with detail: it earns its place by being interesting for ninety seconds a day.
*Catching* is a screen you open when something looks wrong, and it earns its place by showing
the fault faster than the run log does. I can build either well. Built as both it will be
mediocre at each.

**2. When does it have anything to show?**
A run takes a few minutes, once a day, at 07:00. For the other twenty-three hours a live view
has nothing live in it. Does it show the last run's shape when nothing is running, or say
plainly that nothing is happening?

**3. What is a node?**
This is where we disagreed, and I am not going to guess again. Candidates, in rising
granularity: a *phase* (four nodes, always the same four); a *segment* (as many nodes as the
endeavour has segments, each filling as prospects are found); a *prospect* (dozens of nodes,
appearing as research finds them); or a *step* (one per log line, which is the run log drawn
sideways). The right answer changes the whole screen.

**4. What does movement mean?**
If a thing moves, the movement has to be a fact, not decoration. Money spent? Prospects
passing from research to qualified? Time elapsed against the budget? If the answer is "it
just looks alive", say so and I will build it as an ornament and keep it honest about being
one — but it will not then be the place you look when something is wrong.

**5. Where does it live?**
Its own route; a panel inside the endeavour's RESEARCH section; or the thing the endeavour
page opens with. The last one makes it the first thing you see every day, which is a strong
claim for a screen that is empty most of the time.

## What I would build on one sentence from you

If the answer is "watching, phases, money, on the endeavour page" then it is four nodes, one
per phase, each filling as that phase spends its share of the day's allowance, with the
current step's text beneath — maybe a day's work, all of it on data that already exists. If
the answer is prospects appearing as they are found, that is a different screen and a bigger
one.

Answer question 3 and question 4 and I can start; the other three I can take a sensible view
on if you would rather not spend the thought.
