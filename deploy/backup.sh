#!/usr/bin/env sh
# Nightly database backup (deploy/README.md, step 8): a compressed dump in ~/asl/backups (the last 14 kept),
# copied to S3 when BACKUP_BUCKET is set in .env. Restore: see the README.
set -eu
cd "$(dirname "$0")"
. ./.env
mkdir -p backups
file="backups/aslwizard-$(date -u +%Y%m%d-%H%M).sql.gz"
docker compose exec -T db pg_dump -U aslwizard --no-owner aslwizard | gzip > "$file"
ls -1t backups/aslwizard-*.sql.gz | tail -n +15 | xargs -r rm --
if [ -n "${BACKUP_BUCKET:-}" ]; then
  aws s3 cp "$file" "s3://$BACKUP_BUCKET/db/" --only-show-errors
fi
echo "backup ok: $file"
