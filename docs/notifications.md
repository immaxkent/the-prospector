# Notifications

Everything is recorded in the app first. A channel is how a notification *also* reaches you
somewhere you actually look. Delivery failures are written down and swallowed: a push that
does not arrive must never stop the daily run.

## What you get told, and when

| Kind | When | Priority |
|---|---|---|
| `reply_interested`, `reply_question`, `reply_referral` | The day a prospect replies with interest, a question or a referral | High |
| `approvals_waiting` | A run finished with drafts needing your decision | Normal |
| `mailbox_needs_reauth` | A mailbox cannot send until you reconnect it | High |
| `run_failed` | The daily loop stopped at a step | High |

A rejection, an unsubscribe or an out-of-office does not notify. It goes in the daily brief.
The same kind and title within six hours counts as a repeat and is not sent twice.

## Slack (free)

Slack's incoming webhooks are free on Slack's own free plan, and need no OAuth app review.

1. Go to <https://api.slack.com/apps> and **Create New App → From scratch**. Name it
   *The Prospector* and pick your workspace.
2. Open **Incoming Webhooks** and turn it on.
3. **Add New Webhook to Workspace**, then choose the channel the notifications should land in.
   A private channel with just you in it works fine.
4. Copy the URL — it looks like `https://hooks.slack.com/services/T000/B000/xxxxxxxx`. It is a
   secret: anyone holding it can post to that channel.
5. Put it in the server's `.env.production`:

```bash
NOTIFY_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T000/B000/xxxxxxxx
```

6. Restart the containers, then open **Settings → Notifications** and press **Send a test
   notification**. It should appear in Slack within a second or two. If Slack refuses, the
   error shows Slack's own reason (`no_service` means the webhook was revoked or mistyped).

The webhook URL never reaches the browser: Settings shows the channel and the host only.

## The alternatives

`NOTIFY_NTFY_URL` pushes to a phone through [ntfy](https://ntfy.sh) — also free, and useful if
you want a notification on your phone without Slack. `NOTIFY_WEBHOOK_URL` posts the raw JSON
notification to any endpoint of your own.

If more than one is set, Slack wins, then ntfy, then the plain webhook. With none set,
notifications wait in the app, and Settings says so rather than pretending.
