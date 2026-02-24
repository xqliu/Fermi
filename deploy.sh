#!/bin/bash
set -euo pipefail

# Fermi deploy script — ensures correct build order and consistency
# Usage: ./deploy.sh "commit message"

cd "$(dirname "$0")"

MSG="${1:?Usage: ./deploy.sh \"commit message\"}"

echo "=== 1. Git commit ==="
git add -A
if git diff --cached --quiet; then
    echo "No changes to commit."
    exit 0
fi
git commit -m "$MSG"

echo ""
echo "=== 2. Build (injects HEAD hash into getupdates + service.js) ==="
node buildnode.js
node build.js

# Copy static files that build.js doesn't handle
cp -f src/webpage/reset.html dist/webpage/reset.html 2>/dev/null || true

echo ""
echo "=== 3. Verify consistency ==="
GETUPDATES=$(cat dist/webpage/getupdates)
SW_VERSION=$(grep -o 'BUILD_VERSION="[^"]*"' dist/webpage/service.js | cut -d'"' -f2)
if [ "$GETUPDATES" != "$SW_VERSION" ]; then
    echo "FATAL: getupdates ($GETUPDATES) != service.js BUILD_VERSION ($SW_VERSION)"
    exit 1
fi
echo "OK: both = ${GETUPDATES:0:8}"

echo ""
echo "=== 4. Deploy ==="
sudo rsync -a --delete dist/webpage/ /var/www/fermi/

echo ""
echo "=== 5. Verify deployed files ==="
DEPLOYED_GU=$(cat /var/www/fermi/getupdates)
DEPLOYED_SW=$(grep -o 'BUILD_VERSION="[^"]*"' /var/www/fermi/service.js | cut -d'"' -f2)
if [ "$DEPLOYED_GU" != "$DEPLOYED_SW" ]; then
    echo "FATAL: deployed files inconsistent!"
    exit 1
fi
echo "OK: deployed version = ${DEPLOYED_GU:0:8}"
echo ""
echo "✅ Done. Users will see the update automatically."
