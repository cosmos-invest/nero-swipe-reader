#!/usr/bin/env bash
set -euo pipefail
npm run materialize
node scripts/render-automation-config.mjs
npx wrangler deploy --config .wrangler.automation.generated.jsonc
