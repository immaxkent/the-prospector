#!/usr/bin/env bash
# Nightly backup on the box: a compressed dump plus a JSON export, keeping 14 days.
set -euo pipefail

DIR="${PROSPECTOR_DIR:-/opt/prospector}"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
cd "$DIR"

docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db pg_dump -U prospector prospector | gzip > "backups/prospector-$STAMP.sql.gz"
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T web node -e "
  fetch('http://localhost:3000/api/v1/export', { headers: { 'x-api-key': process.env.BACKUP_API_KEY } })
    .then(r => r.text())
    .then(t => process.stdout.write(t))
" > "backups/prospector-$STAMP.json" || echo "JSON export skipped (set BACKUP_API_KEY to include it)"

find backups -type f -mtime +14 -delete
echo "backup written: backups/prospector-$STAMP.sql.gz"
