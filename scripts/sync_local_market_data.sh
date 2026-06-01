#!/usr/bin/env bash
# 本地：拉齐 git/R2 底库 → 跑指数 T-1 + 007751 净值 → 写入 public/data/*.csv
# 用法：bash scripts/sync_local_market_data.sh
# 可选：CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID 时先从 R2 bootstrap
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

echo "== 1/4 git pull =="
git pull --ff-only origin main

echo "== 2/4 R2 bootstrap (optional) =="
bash scripts/cloudflare/download_public_data_from_r2.sh

echo "== 3/4 index T-1 + OTC fund =="
python3 -m pip install -q requests akshare
python3 scripts/index_data_sync/sync_a_share_dividend_indices.py
python3 scripts/index_data_sync/sync_otc_fund_bars_em.py

echo "== 4/4 数据日期摘要 =="
python3 - <<'PY'
import csv
from collections import defaultdict
from pathlib import Path

DATA = Path("public/data")

def max_date(path, code_col, date_col="date"):
    last = {}
    if not path.exists():
        return last
    for r in csv.DictReader(path.open(encoding="utf-8-sig")):
        c = (r.get(code_col) or "").strip()
        d = (r.get(date_col) or "").strip()
        if c and d and d > last.get(c, ""):
            last[c] = d
    return last

ix = max_date(DATA / "index_bars.csv", "index_code")
fb = max_date(DATA / "fund_bars.csv", "fund_code")
print(f"index_bars: {len(ix)} indices, max={max(ix.values()) if ix else '-'}")
print(f"007751 fund_bars last: {fb.get('007751', '-')}")

b, m = {}, {}
for p, acc in [(DATA / "bars.csv", b), (DATA / "barsmore.csv", m)]:
    for r in csv.DictReader(p.open(encoding="utf-8-sig")):
        c, d = r["etf_code"], r["date"]
        if d > acc.get(c, ""):
            acc[c] = d
merged = {**b, **m}
for c in sorted(m, key=lambda x: m[x])[-3:]:
    pass
primary = []
for r in csv.DictReader((DATA / "etf_products.csv").open(encoding="utf-8-sig")):
    if (r.get("is_primary") or "").lower() == "true":
        primary.append(r["code"].strip())
stale = [c for c in primary if merged.get(c, "") < max(merged.values(), default="")]
print(f"ETF merged: {len(merged)} codes, max={max(merged.values()) if merged else '-'}")
if stale:
    print(f"  primary before max: {', '.join(sorted(stale)[:8])}")
PY

echo ""
echo "完成。下一步：git add public/data && git commit && git push && npm run r2:upload"
