#!/usr/bin/env bash
# Download selected public/data artifacts from R2 for CI jobs (see docs/cloudflare-deploy.md).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DATA_DIR="${ROOT}/public/data"
BUCKET="${R2_BUCKET:-newhl-data}"
WRANGLER="${WRANGLER_BIN:-wrangler}"
REMOTE_FLAG="${R2_REMOTE_FLAG:---remote}"

OPTIONAL_OBJECTS=(
  bars.csv
  barsmore.csv
  index_bars.csv
  indices.csv
  index_tracking_etfs.csv
  fund_bars.csv
  etfs.csv
  etf_products.csv
  etf_dividends.csv
  etf_adjusted_bars_meta.json
  redrocket_div_yield_meta.json
)

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN not set; skip R2 download."
  exit 0
fi

mkdir -p "${DATA_DIR}"
downloaded=0
for obj in "${OPTIONAL_OBJECTS[@]}"; do
  dest="${DATA_DIR}/${obj}"
  if ${WRANGLER} r2 object get "${BUCKET}/${obj}" --file "${dest}" ${REMOTE_FLAG} 2>/dev/null; then
    echo "← ${BUCKET}/${obj}"
    downloaded=$((downloaded + 1))
  else
    echo "skip ${BUCKET}/${obj} (not in R2)"
  fi
done

echo "Done. ${downloaded} object(s) downloaded into ${DATA_DIR}."
