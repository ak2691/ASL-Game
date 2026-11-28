#!/usr/bin/env sh
# Writes ~/asl/.env from AWS Secrets Manager (deploy/README.md, step 5). One secret holds every setting as
# key/value pairs (SITE_ADDRESS, POSTGRES_PASSWORD, GOOGLE_CLIENT_SECRET, ...). update.sh runs this before each
# start, so changing a value = edit it in Secrets Manager, then deploy (or run ./update.sh).
#   SECRET_ID: the secret's name (default prod/aslwizard). The region comes from `aws configure`.
# The file is written readable only by you, and swapped in only once it's complete; on any error the old .env
# stays and this exits non-zero (so a deploy stops and the running game is left alone).
set -eu
cd "$(dirname "$0")"
SECRET_ID="${SECRET_ID:-prod/aslwizard}"

umask 077
trap 'rm -f .env.new' EXIT # a failed run leaves nothing half-written
json=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --query SecretString --output text)

# JSON -> KEY='value' lines. Keys must be plain names; values can't hold a quote or a line break (neither
# docker compose nor sh could read them back safely).
printf '%s' "$json" | python3 -c '
import json, re, sys
data = json.load(sys.stdin)
if not isinstance(data, dict) or not data:
    sys.exit("the secret must be key/value pairs")
print("# Written by fetch-secrets.sh from AWS Secrets Manager. Edit the secret, not this file.")
for key in sorted(data):
    value = str(data[key])
    if not re.fullmatch(r"[A-Z_][A-Z0-9_]*", key):
        sys.exit(f"bad key name: {key}")
    if "\x27" in value or "\n" in value or "\r" in value:
        sys.exit(f"{key}: values cannot contain a single quote or a line break")
    print(f"{key}=\x27{value}\x27")
' > .env.new

for need in SITE_ADDRESS PUBLIC_URL POSTGRES_PASSWORD; do
  if ! grep -q "^$need=''*[^']" .env.new; then
    echo "the secret is missing $need" >&2
    exit 1
  fi
done
mv .env.new .env
echo "wrote .env from $SECRET_ID ($(grep -c = .env) settings)"
