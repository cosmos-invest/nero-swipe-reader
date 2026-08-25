#!/usr/bin/env bash
set -euo pipefail
node scripts/build-extension.mjs
mkdir -p dist
out="dist/NERO_Favorite_Reader_Bridge_0.1.32.zip"
rm -f "$out"
(
  cd dist/bridge
  zip -qr "../$(basename "$out")" .
)
echo "Created $out"
