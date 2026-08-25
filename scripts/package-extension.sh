#!/usr/bin/env bash
set -euo pipefail
: "${READER_ORIGIN:?Set READER_ORIGIN=https://your-new-reader.example}"
node scripts/build-extension.mjs
mkdir -p dist
rm -f dist/NERO_Favorite_Reader_Bridge_0.1.30.zip
(
  cd dist/bridge
  zip -qr ../NERO_Favorite_Reader_Bridge_0.1.30.zip .
)
echo "Created dist/NERO_Favorite_Reader_Bridge_0.1.30.zip"
