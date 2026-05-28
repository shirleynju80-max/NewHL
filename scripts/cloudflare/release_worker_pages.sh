#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "${ROOT}"

WORKER_URL="${WORKER_URL:-https://newhl-data-api.shirleynju80.workers.dev}"
PROJECT_NAME="${PAGES_PROJECT_NAME:-newhl-dashboard}"
BRANCH="${PAGES_BRANCH:-main}"
WRANGLER="${WRANGLER_BIN:-npx wrangler@4.95.0}"

echo "==> Upload CSV to R2 (remote)"
R2_REMOTE_FLAG="--remote" bash scripts/cloudflare/upload_public_data_to_r2.sh

echo "==> Deploy Worker (R2 /api/bundle)"
${WRANGLER} deploy --config workers/data-api/wrangler.toml

echo "==> Build frontend with Worker API URL"
VITE_DATA_API_BASE_URL="${WORKER_URL}" npm run build

echo "==> Deploy Pages"
${WRANGLER} pages deploy dist --project-name="${PROJECT_NAME}" --branch="${BRANCH}" --commit-dirty=true

echo "==> Done"
echo "Worker URL: ${WORKER_URL}"
echo "Pages URL: https://${PROJECT_NAME}.pages.dev/"
