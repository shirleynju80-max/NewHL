#!/usr/bin/env bash
# Upload local public/data CSV + ETF meta JSON to R2 bucket newhl-data (see docs/cloudflare-deploy.md).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DATA_DIR="${ROOT}/public/data"
BUCKET="${R2_BUCKET:-newhl-data}"
WRANGLER="${WRANGLER_BIN:-wrangler}"
REMOTE_FLAG="${R2_REMOTE_FLAG:---remote}"

EXTRA_JSON=(
  "etf_adjusted_bars_meta.json"
)

if [[ ! -d "${DATA_DIR}" ]]; then
  echo "Missing ${DATA_DIR}"
  exit 1
fi

shopt -s nullglob
csv_files=("${DATA_DIR}"/*.csv)
json_files=()
for name in "${EXTRA_JSON[@]}"; do
  if [[ -f "${DATA_DIR}/${name}" ]]; then
    json_files+=("${DATA_DIR}/${name}")
  fi
done

if [[ ${#csv_files[@]} -eq 0 && ${#json_files[@]} -eq 0 ]]; then
  echo "No CSV or meta JSON files in ${DATA_DIR}"
  exit 1
fi

upload_count=0
for f in "${csv_files[@]}" "${json_files[@]}"; do
  base="$(basename "${f}")"
  echo "→ ${BUCKET}/${base} (${REMOTE_FLAG:---local})"
  ${WRANGLER} r2 object put "${BUCKET}/${base}" --file "${f}" ${REMOTE_FLAG}
  upload_count=$((upload_count + 1))
done

echo "Done. ${upload_count} file(s) uploaded to R2 bucket ${BUCKET}."
