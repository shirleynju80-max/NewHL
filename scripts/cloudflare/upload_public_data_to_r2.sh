#!/usr/bin/env bash
# Upload local public/data/*.csv to R2 bucket newhl-data (see docs/cloudflare-deploy.md).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DATA_DIR="${ROOT}/public/data"
BUCKET="${R2_BUCKET:-newhl-data}"
WRANGLER="${WRANGLER_BIN:-npx wrangler@4.95.0}"
REMOTE_FLAG="${R2_REMOTE_FLAG:---remote}"

if [[ ! -d "${DATA_DIR}" ]]; then
  echo "Missing ${DATA_DIR}"
  exit 1
fi

shopt -s nullglob
files=("${DATA_DIR}"/*.csv)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "No CSV files in ${DATA_DIR}"
  exit 1
fi

for f in "${files[@]}"; do
  base="$(basename "${f}")"
  echo "→ ${BUCKET}/${base} (${REMOTE_FLAG:---local})"
  ${WRANGLER} r2 object put "${BUCKET}/${base}" --file "${f}" ${REMOTE_FLAG}
done

echo "Done. ${#files[@]} file(s) uploaded to R2 bucket ${BUCKET}."
