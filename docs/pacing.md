# How outreach is paced

Two things give away an automated sender: a batch of messages timestamped seconds apart, and
mail that arrives in the middle of the recipient's night. Both are avoided here, and both are
configurable per endeavour under **Configuration**.

## When a message goes

Approving a draft decides *that* it goes. Pacing decides *when*, and the slot is assigned there
and then, so the queue is visible before anything leaves.

| Setting | Default | What it does |
|---|---|---|
| Sends from / until | 08:00–17:00 | No message leaves outside this window |
| Shortest / longest gap | 4–25 minutes | Gap between consecutive sends from one mailbox, drawn fresh each time |
| Send in the recipient's morning | on | Uses the recipient's timezone when research established it, the mailbox's otherwise |
| Wait before replying | 90 minutes | A reply is never sent sooner than this after theirs arrived |
| Follow up after | 3, 7, 14 days | Days after the last outbound, sorted and de-duplicated. Empty means never |

Spacing is per **mailbox**, not per endeavour, because the mailbox is what the provider sees.
Several endeavours sharing an address share its rhythm, and its caps.

## What runs when

- Every **5 minutes** the worker releases whatever slots have come due
- Every **20 minutes** it reads new replies, classifies them and notifies you about the ones
  worth interrupting for
- Once a day at `DAILY_RUN_HOUR` it does the full loop: research, qualification, follow-ups,
  drafting, learning and the brief

## Timezones

A company's timezone is only stored when research actually established it from a source, and
only when it is a name this runtime resolves. A timezone it cannot resolve is dropped rather
than stored: a send aimed at the wrong clock is worse than one aimed at no clock, which simply
falls back to the mailbox's own working hours.
