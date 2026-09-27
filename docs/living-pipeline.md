# WP-18 — The living pipeline

A per-endeavour view of the agent actually working: every prospect a node, every stage a
cluster, movement between them as the daily run happens.

## Why

The endeavour page says what happened (counts, a funnel, a fortnight of activity). It does
not say what is happening. With an agent that runs unattended, "is it doing anything, and
is it stuck on me?" is the question asked most often and answered worst — today it is
answered by reading four panels and inferring.

It is also the honest answer to a failure this project has already had: the worker
crashlooped for days while every screen looked fine. A view whose whole job is to show the
work moving makes a stopped agent obvious.

## The shape

One **stage node** per pipeline stage, laid left to right in the order work flows. Inside
each, a **cluster of subnodes** — one per prospect or outreach currently at that stage.
Edges between stage nodes carry what has moved.

```
RESEARCHING → QUALIFIED → DRAFTING → AWAITING YOU → SENT → REPLIED
   ●●●           ●●          ●●●         ●●          ●●●●●    ●●
```

Rules that make it a view rather than a decoration:

- **A subnode is one prospect**, not one message. A prospect with three follow-ups is one
  node that has moved, not three.
- **Clusters do not scroll.** Past a cap the cluster shows the cap and a count ("+34"),
  because a wall of identical dots stops being information.
- **Movement is the point.** A subnode that changed stage since the last poll animates
  along its edge. Nothing else moves.
- **AWAITING YOU is the only state given an attention colour.** Everything else is
  temperature, not alarm. If everything is urgent, nothing is.
- **A stalled agent reads as stalled.** When the last run is older than the endeavour's
  cadence, the whole field desaturates and says so, rather than showing a tidy still frame
  that looks like success.

### The research node is different

Research is the only stage that is not a queue of prospects waiting their turn — it also
holds what the agent has *digested* and is ready to feed back in: replies it has read, old
prospects it has re-scored, learning from what worked. So the research node carries a
second, smaller cluster for **ready to feed in**, distinct from **being researched**.

## Data

Everything below already exists; none of it needs new writes.

| Stage | Source |
|---|---|
| Researching | `prospects.status in (DISCOVERED, RESEARCHING)` |
| Qualified | `prospects.status = QUALIFIED` with no outreach yet |
| Drafting | a `messages` row with `draft` and no approval yet |
| Awaiting you | an `approvals` row whose subject is that message |
| Sent | `messages.send_state = 'sent'` |
| Replied | a message on the thread with `author = 'PROSPECT'` |
| Ready to feed in | run log entries since the last run's `learn` phase |
| Agent state | `daily_runs.phase`, `started_at` |

## Tasks

Each is one commit with its tests, in order. Nothing after T2 blocks on anything but the
task before it.

| # | Task | Deliverable |
|---|---|---|
| **T1** | **Derive the field.** `src/data/pipeline-field.ts` — a pure function from the dataset to `{ stages: [{ id, label, nodes: [{ id, label, since }], overflow }], edges, agent: { phase, lastRunAt, stalled } }`. One prospect appears once, at its furthest stage. | module + unit tests |
| **T2** | **Movement.** Diff two fields to get `{ id, from, to }` per moved node, so the view can animate rather than re-lay-out. Pure, so it is testable without a DOM. | module + unit tests |
| **T3** | **The field component.** `PipelineField.tsx` — SVG, stage clusters, overflow counts, the key. Static first: correct at rest before anything moves. | component + demo e2e |
| **T4** | **Colour.** Assign the six states from the ramps and **run `validate_palette.js`** over the set against the panel surface. Six categorical hues is at the edge of what separates under CVD — expect to fold terminal states together rather than force a seventh. | palette + the validator output recorded in the commit |
| **T5** | **Motion.** Animate moved nodes along their edge; desaturate on stalled; respect `prefers-reduced-motion` by showing the end state without the journey. | component + test |
| **T6** | **Live.** Poll while a run is in progress (the dataset query already does this for runs), idle otherwise. No websocket. | wiring + test |
| **T7** | **Place it.** Top of the endeavour page, above the tiles, with RUN NOW and the run orb beside it. | route + e2e |
| **T8** | **The orb.** Last execution, next scheduled, current phase. Lives beside RUN NOW; is the thing that says the agent is alive. | component + test |

## Not in this work package

- The COMMAND dashboard across endeavours (WP-19) — same design language, different scope.
- Hiding Interfaces, removing the CONTEXT chip (WP-19, small).
- Any change to what the worker actually does. This view reports; it does not drive.
