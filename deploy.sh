#!/bin/bash
set -e

cd /home/xqianliu/Fermi
ASSETS_DIR="/home/xqianliu/backup/config"
DEPLOY_DIR="/var/www/fermi"

if ! git diff --quiet -- src/; then
  echo "Refusing to deploy: src/ has uncommitted changes."
  echo "Commit the changes first so getupdates/version.json match the deployed code."
  exit 1
fi

if ! git diff --cached --quiet -- src/; then
  echo "Refusing to deploy: src/ has staged but uncommitted changes."
  echo "Commit the changes first so getupdates/version.json match the deployed code."
  exit 1
fi

echo "Building..."
npm run build 2>&1 | tail -3

echo "Deploying..."
sudo rsync -a --delete dist/webpage/ "$DEPLOY_DIR"/

FULL_HASH=$(git rev-parse HEAD)
SHORT_HASH=$(git rev-parse --short=8 HEAD)
COMMIT_UNIX=$(git show -s --format=%ct HEAD)
COMMIT_MSG=$(git show -s --format=%s HEAD)
COMMIT_ISO=$(date -u -d "@$COMMIT_UNIX" +"%Y-%m-%dT%H:%M:%SZ")

python3 -c "
import json, subprocess, sys
h='${FULL_HASH}'
s='${SHORT_HASH}'
t='${COMMIT_ISO}'
m=subprocess.check_output(['git','show','-s','--format=%s','HEAD']).decode().strip()
print(json.dumps({'hash':h,'short':s,'committedAt':t,'message':m},ensure_ascii=False))
" | sudo tee "$DEPLOY_DIR"/version.json >/dev/null

copy_asset() {
  local backup_name="$1"
  local dist_name="$2"
  local dest_name="${3:-$dist_name}"
  if [[ -f "$ASSETS_DIR/$backup_name" ]]; then
    sudo cp "$ASSETS_DIR/$backup_name" "$DEPLOY_DIR/$dest_name"
  elif [[ -f "dist/webpage/$dist_name" ]]; then
    sudo cp "dist/webpage/$dist_name" "$DEPLOY_DIR/$dest_name"
  else
    echo "WARNING: missing asset $backup_name / $dist_name"
  fi
}

copy_asset "logo.webp" "logo.webp"
copy_asset "favicon.ico" "favicon.ico"
if [[ -f "$ASSETS_DIR/logo-192.webp" ]]; then
  sudo cp "$ASSETS_DIR/logo-192.webp" "$DEPLOY_DIR/logo-192.webp"
elif [[ -f "dist/webpage/logo-192.webp" ]]; then
  sudo cp "dist/webpage/logo-192.webp" "$DEPLOY_DIR/logo-192.webp"
elif [[ -f "$DEPLOY_DIR/logo.webp" ]]; then
  sudo cp "$DEPLOY_DIR/logo.webp" "$DEPLOY_DIR/logo-192.webp"
else
  echo "WARNING: missing logo-192.webp fallback"
fi

sudo python3 -c "
import json
with open('$DEPLOY_DIR/manifest.json') as f:
    m = json.load(f)
m['name'] = 'Lucky 5L'
m['short_name'] = 'Lucky 5L'
m['description'] = 'Lucky 5L 专属聊天服务'
m['icons'] = [
    {'src': '/logo-192.webp', 'sizes': '192x192', 'type': 'image/webp'},
    {'src': '/logo.webp', 'sizes': '512x512', 'type': 'image/webp'}
]
with open('$DEPLOY_DIR/manifest.json', 'w') as f:
    json.dump(m, f, indent='\t', ensure_ascii=False)
"

VERSION=$(cat "$DEPLOY_DIR"/getupdates | head -c 8)
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
