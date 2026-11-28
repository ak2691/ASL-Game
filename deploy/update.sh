#!/usr/bin/env sh
# Runs on the server (the deploy workflow calls it over SSH; you can too): refreshes .env from AWS Secrets Manager
# (fetch-secrets.sh), waits until no match is being played (a restart ends matches in progress), up to WAIT_MAX
# seconds, then pulls the image and restarts what changed.
# Usage: ./update.sh <image tag>     (no tag: latest)
set -eu
cd "$(dirname "$0")"
TAG="${1:-latest}"
WAIT_MAX="${WAIT_MAX:-600}"

# Settings first: if they can't be read, stop here and leave the running game alone.
./fetch-secrets.sh

waited=0
while :; do
  busy=$(docker compose exec -T app wget -qO- http://localhost:8787/healthz 2>/dev/null | sed -n 's/.*"busy":\([0-9]*\).*/\1/p')
  if [ -z "$busy" ] || [ "$busy" = "0" ]; then break; fi
  if [ "$waited" -ge "$WAIT_MAX" ]; then
    echo "still $busy matches after ${WAIT_MAX}s: deploying anyway"
    break
  fi
  echo "$busy matches running, waiting..."
  sleep 15
  waited=$((waited + 15))
done

export IMAGE_TAG="$TAG"
docker compose pull app
docker compose up -d --remove-orphans
docker image prune -f > /dev/null

# Healthy within a minute, or say so (the workflow fails, and the old image tag is in the log to roll back to).
for _ in $(seq 1 12); do
  if docker compose exec -T app wget -qO- http://localhost:8787/healthz > /dev/null 2>&1; then
    echo "deployed $TAG"
    exit 0
  fi
  sleep 5
done
echo "the game didn't come up healthy: docker compose logs app"
exit 1
