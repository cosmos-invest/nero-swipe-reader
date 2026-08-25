#!/usr/bin/env bash
set -euo pipefail
node scripts/build-extension.mjs
mkdir -p dist
version="$(node -e "console.log(JSON.parse(require('fs').readFileSync('dist/bridge/manifest.json','utf8')).version)")"
out="dist/NERO_Favorite_Reader_Bridge_${version}.zip"
rm -f "$out"
(
  cd dist/bridge
  zip -qr "../$(basename "$out")" .
)
echo "Created $out"
