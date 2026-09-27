# WP-19 — Knowing which outreach a reply answers

Attributing an inbound message to the exact outreach that prompted it, and keeping the
mailbox free of everything that is not a reply at all.

## Where it stands

Matching today, in `ingestReplies`, is two guesses in order:

1. **Gmail's own thread id** — `threads.external_thread_id = message.threadId`
2. **The sender's address** — `people.email`, then the prospect that person belongs to

Then everything else becomes a `thread_mapping` approval for the operator to sort by hand.

It is worth being clear about what each rung can and cannot tell you, because they are not
the same question. **Routing** — which endeavour does this belong to — and **attribution** —
which outreach did this answer — fail independently:

| Rung | Identifies | Cost |
|---|---|---|
| `In-Reply-To` / `References` | the exact message | free |
| Gmail thread id | the thread | free |
| Sender address | the prospect | free |
| Mailbox serves one endeavour | the endeavour | free |
| Read the content | the endeavour, maybe | a model call, fallible |

One inbox per endeavour therefore solves routing completely and attribution not at all —
which is the right trade, because routing is what was crashing the job and attribution is
what the header work fixes.

That is thinner than it looks:

- **Gmail's thread id is Gmail's opinion.** It groups by subject and participants, so a
  reply sent from a different address, forwarded, or with the subject edited lands outside
  the thread we sent on. Two unrelated threads with the same subject can also merge.
- **Address matching is per-person, not per-outreach.** A prospect we contacted about two
  different offers replies once; we know the prospect, not which message they answered.
- **Nothing uses the identifiers built for exactly this.** `buildRawMessage` already sets
  `In-Reply-To` and `References` on what we send, and `messages.external_message_id` holds
  the id Gmail gave it — but ingest never reads either header off an inbound message.
- **Everything else in the inbox is treated as a possible reply.** The query is
  `newer_than:3d -from:me -in:chats`, so CI notifications, newsletters and receipts all
  become "could not be matched" approvals. The first mail production ever ingested was a
  GitHub Actions failure notice, and it is what crashed the job.

## What this is worth

Without it: the operator hand-sorts noise, follow-up timing is wrong because we do not know
what was answered, and per-message performance — which the `message_version` performance cut
already reports on — is attributing replies to the wrong draft. That last one quietly
corrupts the learning loop: it is scoring copy against replies it did not earn.

## Tasks

| # | Task | Deliverable |
|---|---|---|
| **T0** | **Attribute by mailbox where it is unambiguous.** When a mailbox serves exactly one active endeavour, anything arriving there belongs to that endeavour. Deterministic, free, no model call — and it is the intended setup, so it catches the whole residue of T1–T3 rather than a slice of it. Does *not* identify which outreach was answered; that is still T1's job. | matcher + unit tests |
| **T1** | **Read the headers we already send.** Parse `In-Reply-To` and `References` from inbound mail; resolve them against `messages.external_message_id`. This is exact attribution — RFC 5322 identifiers, not a guess — and it names the *message*, not just the prospect. | matcher + unit tests |
| **T2** | **Rank the strategies, and record which one won.** Ordered: reply-header → Gmail thread id → sender address → nothing. Store the winner and a confidence on the message, so a wrong match is later explainable rather than mysterious. | schema + migration + tests |
| **T3** | **Attribute to the outreach, not only the prospect.** Set `messages.in_reply_to_message_id` so a reply points at the draft it answers. This is what makes per-message performance honest. | column + wiring + tests |
| **T4** | **Recognise what is not a reply at all.** A classifier over sender and headers — `List-Unsubscribe`, `Auto-Submitted`, `Precedence: bulk`, no-reply senders, known notification domains. Those are filed, never raised as approvals. Rules first; no model call for something a header answers. | module + unit tests |
| **T5** | **Narrow what we fetch.** The Gmail query should ask for mail plausibly related to outreach rather than everything — at minimum excluding what T4 recognises, so noise never enters the loop. | query + integration test |
| **T6** | **Say how a thread was matched.** In the mailbox, show the basis: "matched on reply headers" against "matched on sender". An operator who can see why can correct it. | UI + e2e |
| **T7** | **Make correction cheap.** The `thread_mapping` approval should offer the likely candidates — open outreach to that address, recent sends to that domain — rather than a free choice among everything. | command + UI + tests |

## Decisions I would make unless told otherwise

- **Header matching wins over Gmail's thread id**, always. A `References` chain is what the
  sending client asserted; a thread id is what Gmail inferred.
- **A machine-generated message is filed, not raised.** It stays in the mailbox and is
  visible under ALL, but it never becomes a decision. Nothing is deleted.
- **Confidence is recorded, not acted on.** No auto-rejecting low-confidence matches until
  there is enough real traffic to know what the distribution looks like.
- **The mailbox beats the model.** Reading a message body to infer its endeavour costs a
  call on every unmatched mail and can be wrong; a mailbox that serves one endeavour simply
  knows. Content classification stays a last resort for shared mailboxes, and is not built
  until one exists.

## Not in here

- Anything that changes what is sent. This is all read-side.
- Filtering the operator's own inbox in Gmail. Prospector narrows what it ingests; it does
  not touch the mailbox's own rules.
