# Running The Prospector on a server

The app is built on your machine and shipped to the box as an image. Nothing compiles on the
server: a small instance will run out of memory trying.

## What runs there

| Container | What it does |
|---|---|
| `web` | The app and the API, on port 3000 behind Caddy |
| `worker` | The daily loop: scheduling, research, drafting, sending, reading replies |
| `db` | Postgres, with a volume and nightly dumps |
| `caddy` | HTTPS on your domain, certificate obtained and renewed automatically |

## Before the first deploy

1. **A box.** Two CPUs and 2 GB of memory is enough. Install Docker and Docker Compose. Open
   ports 80 and 443; restrict SSH to your own address.
2. **DNS.** Point your domain's A record at the box's address.
3. **Google.** In the Cloud project: enable the Gmail API, and register both redirect URIs on
   the OAuth client:
   - `https://<your domain>/auth/google/callback` (sign in)
   - `https://<your domain>/mailboxes/google/callback` (connecting a mailbox)

   To create addresses on your domain from the app (Settings → a mailbox → **Add an address**),
   also enable the **Admin SDK API**, and add these two scopes to the OAuth consent screen:
   `.../auth/admin.directory.user.alias` and `.../auth/gmail.settings.sharing`. Only a Workspace
   administrator can grant them, and only for a domain you own — a personal gmail.com account
   cannot hold aliases. Connecting an existing address needs none of this.
4. **Secrets.** Create `/opt/prospector/.env.production` on the box:

```bash
APP_ENV=production
APP_URL=https://your.domain
APP_DOMAIN=your.domain
DATABASE_URL=postgres://prospector:CHANGEME@db:5432/prospector
POSTGRES_PASSWORD=CHANGEME
AUTH_ALLOWED_EMAILS=you@yourdomain.com
AUTH_SECRET=            # openssl rand -base64 32
TOKEN_ENCRYPTION_KEY=   # openssl rand -base64 32
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-haiku-4-5   # only the first-run default; Settings decides thereafter
USD_PER_GBP=1.27                   # for showing dollar prices against a budget set in pounds
NOTIFY_SLACK_WEBHOOK_URL= # optional; see docs/notifications.md
API_KEYS=               # optional; comma-separated, at least 16 characters each
DAILY_RUN_HOUR=7
```

`APP_ENV=production` refuses to start if any of the required values are missing, if the URL is
not https, or if a development-only switch (the fixture planner, the e2e login, the inline
worker) is set. That refusal is deliberate: it is better than a half-configured system sending
email.

## Deploying

```bash
PROSPECTOR_HOST=user@your.box ./scripts/deploy.sh
```

It refuses to run with uncommitted changes, runs the checks, builds the image, copies it over,
applies migrations, restarts the containers and asks the app whether it is healthy.

## Backups

Add a nightly line to the box's crontab:

```bash
0 3 * * * cd /opt/prospector && ./scripts/backup.sh >> backups/backup.log 2>&1
```

It writes a compressed dump and a JSON export to `/opt/prospector/backups`, keeping 14 days.
Copy that directory somewhere off the box; a backup that only exists on the machine it protects
is not a backup.

## Checking on it

```bash
curl https://your.domain/healthz                      # app and database
docker compose -f docker-compose.prod.yml logs -f worker   # what the loop is doing
docker compose -f docker-compose.prod.yml ps               # what is running
```

`/healthz` returns 503 when the database is unreachable, so an uptime monitor can watch it.

## After the first deploy

1. Sign in at `https://your domain` with an allowlisted Google account.
2. Connect a mailbox in Settings, and set its caps and quiet hours. A new address should be
   warmed up: start at about five a day and build up.
3. Create your first Endeavour from a brief, resolve every field, and activate it.
4. Leave autonomy at DRAFT so nothing is sent without you approving it.
5. Set the model and the month's budget in Settings. The month is spread evenly over its days,
   and the loop stops for the day when the day's share is gone rather than emptying the month.
6. Send a test notification from Settings, so you know the channel works before a run
   depends on it.
7. Watch the first daily run's log before trusting it unattended.
