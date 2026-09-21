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

echo "==> running the checks"
npm run check

echo "==> building the image ($REVISION) for $PLATFORM"
docker build --platform "$PLATFORM" -t "$IMAGE" .

echo "==> copying the image to $HOST"
docker save "$IMAGE" | gzip | ssh "$HOST" "gunzip | docker load"

echo "==> copying deployment files"
ssh "$HOST" "mkdir -p $REMOTE_DIR/backups"
scp docker-compose.prod.yml Caddyfile "$HOST:$REMOTE_DIR/"

echo "==> applying migrations"
ssh "$HOST" "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml run --rm web npx tsx scripts/db.ts migrate"

echo "==> restarting"
ssh "$HOST" "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml up -d"

echo "==> health"
ssh "$HOST" "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml exec -T web node -e \"fetch('http://localhost:3000/healthz').then(r=>r.json()).then(b=>{console.log(b);process.exit(b.status==='ok'?0:1)})\""

echo "==> deployed $REVISION"
