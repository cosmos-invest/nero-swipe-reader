#!/usr/bin/env bash
set -euo pipefail
name="${1:-}"
case "$name" in
  NOTE_SESSION_COOKIE|STATE_ENCRYPTION_KEY|NERO_URLNAME|ADMIN_TOKEN) ;;
  *) echo "allowed: NOTE_SESSION_COOKIE STATE_ENCRYPTION_KEY NERO_URLNAME ADMIN_TOKEN" >&2; exit 2 ;;
esac
node scripts/render-automation-config.mjs
npx wrangler secret put "$name" --config .wrangler.automation.generated.jsonc
