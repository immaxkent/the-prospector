#!/usr/bin/env bash
# Ships the app to the box: build here, copy the image over, migrate, restart.
# The box is small, so nothing is ever built on it.
#
#   PROSPECTOR_HOST=user@host ./scripts/deploy.sh
#
# The image is built for the box's architecture, not this machine's. Hetzner's CX and CPX
# lines are x86 (linux/amd64, the default); its CAX line is Arm (linux/arm64), which also
# builds natively and faster on an Apple Silicon Mac.
#
set -euo pipefail

HOST="${PROSPECTOR_HOST:?set PROSPECTOR_HOST, for example ubuntu@1.2.3.4}"
REMOTE_DIR="${PROSPECTOR_DIR:-/opt/prospector}"
IMAGE="prospector:latest"
PLATFORM="${PROSPECTOR_PLATFORM:-linux/amd64}"

echo "==> checking the tree is clean"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "refusing to deploy with uncommitted changes" >&2
  exit 1
fi
REVISION="$(git rev-parse --short HEAD)"
# Incremental and automatic: the third part counts commits, so every deploy is higher
# than the last without anyone remembering to bump a file.
VERSION="0.1.$(git rev-list --count HEAD)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "==> running the checks"
npm run check

echo "==> building the image $VERSION ($REVISION) for $PLATFORM"
docker build --platform "$PLATFORM" \
  --build-arg "APP_VERSION=$VERSION" \
  --build-arg "APP_COMMIT=$REVISION" \
  --build-arg "APP_BUILT_AT=$BUILT_AT" \
  -t "$IMAGE" .

# The tag is fixed, so loading the new image would otherwise leave nothing to go back to.
echo "==> keeping the running image, so a bad deploy can be undone"
ssh "$HOST" "docker image inspect $IMAGE >/dev/null 2>&1 && docker tag $IMAGE prospector:previous || true"

echo "==> copying the image to $HOST"
docker save "$IMAGE" | gzip | ssh "$HOST" "gunzip | docker load"

echo "==> copying deployment files"
ssh "$HOST" "mkdir -p $REMOTE_DIR/backups"
scp docker-compose.prod.yml Caddyfile "$HOST:$REMOTE_DIR/"

echo "==> applying migrations"
ssh "$HOST" "cd $REMOTE_DIR && docker compose --env-file .env.production -f docker-compose.prod.yml run --rm web npx tsx scripts/db.ts migrate"

echo "==> restarting"
ssh "$HOST" "cd $REMOTE_DIR && docker compose --env-file .env.production -f docker-compose.prod.yml up -d"

echo "==> health"
# A deploy that does not come up healthy is put back, rather than left broken while someone
# reads the logs. The previous image is still on the box for exactly this moment.
#
# Only the image is rolled back. Migrations have already run and are not undone, which is
# why they are written to be safe against the previous version still serving traffic.
HEALTH="cd $REMOTE_DIR && docker compose --env-file .env.production -f docker-compose.prod.yml exec -T web node -e \"fetch('http://localhost:3000/healthz').then(r=>r.json()).then(b=>{console.log(b);process.exit(b.status==='ok'?0:1)}).catch(e=>{console.error(String(e));process.exit(1)})\""

healthy=""
# A cold start is slower than a restart, and a rollback we did not need is worse than
# waiting: give it several tries before deciding the deploy is bad.
for attempt in 1 2 3 4 5 6; do
  if ssh "$HOST" "$HEALTH"; then healthy="yes"; break; fi
  echo "==> not healthy yet (attempt $attempt), waiting" >&2
  sleep 5
done

if [[ -z "$healthy" ]]; then
  echo "==> unhealthy: rolling back to the previous image" >&2
  ssh "$HOST" "docker image inspect prospector:previous >/dev/null 2>&1 && docker tag prospector:previous $IMAGE && cd $REMOTE_DIR && docker compose --env-file .env.production -f docker-compose.prod.yml up -d"
  echo "==> rolled back (the schema was not rolled back)" >&2
  exit 1
fi

echo "==> deployed $VERSION ($REVISION) at $BUILT_AT"
