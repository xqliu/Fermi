#!/bin/bash
set -e

cd /home/xqianliu/Fermi

echo "Building..."
npm run build 2>&1 | tail -3

echo "Deploying..."
rsync -a dist/webpage/ /var/www/fermi/

FULL_HASH=$(git rev-parse HEAD)
SHORT_HASH=$(git rev-parse --short=8 HEAD)
COMMIT_UNIX=$(git show -s --format=%ct HEAD)
COMMIT_MSG=$(git show -s --format=%s HEAD)
COMMIT_ISO=$(date -u -d "@$COMMIT_UNIX" +"%Y-%m-%dT%H:%M:%SZ")

python3 - <<PY > /var/www/fermi/version.json
import json
print(json.dumps({
  "hash": "${FULL_HASH}",
  "short": "${SHORT_HASH}",
  "committedAt": "${COMMIT_ISO}",
  "message": """${COMMIT_MSG}"""
}, ensure_ascii=False))
PY

VERSION=$(cat /var/www/fermi/getupdates | head -c 8)
echo "Deployed: $VERSION"

echo "Purging Cloudflare cache..."
source ~/.cloudflare.env
ZONE_ID="1ff3bd6de000800c0e241afcecd52d1f"
RESULT=$(curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}')

if echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('success') else 1)" 2>/dev/null; then
  echo "CF cache purged ✅"
else
  echo "CF cache purge FAILED ❌"
  echo "$RESULT"
  exit 1
fi

echo "Done! Version: $VERSION"
