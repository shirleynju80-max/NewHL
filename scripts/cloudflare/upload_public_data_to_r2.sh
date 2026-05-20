#!/usr/bin/env bash
# Upload local public/data/*.csv to R2 bucket newhl-data (see docs/cloudflare-deploy.md).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DATA_DIR="${ROOT}/public/data"
BUCKET="${R2_BUCKET:-newhl-data}"

if ! command -v wrangler >/dev/null 2>&1; then
  echo "wrangler not found. Run: npm install -g wrangler && wrangler login"
  exit 1
fi

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
  echo "→ ${BUCKET}/${base}"
  wrangler r2 object put "${BUCKET}/${base}" --file "${f}"
done

echo "Done. ${#files[@]} file(s) uploaded to R2 bucket ${BUCKET}."
