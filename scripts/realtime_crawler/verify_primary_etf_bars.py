#!/usr/bin/env python3
"""
校验主跟踪 ETF 日线数据完整性（CI / 部署前 gate）。

- 根数与 meta.bars_rows 一致
- 覆盖上市至今（history_covers_range）
- 默认要求 refresh_source=eastmoney_fqt1（拒绝腾讯应急写入残留）
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from etf_bars_refresh_guard import (
    history_covers_range_for_verify,
    history_start_for_product_row,
    min_expected_trading_bars,
)

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "public" / "data"
PRODUCTS = DATA / "etf_products.csv"
BARS = DATA / "bars.csv"
BARS_MORE = DATA / "barsmore.csv"
META = DATA / "etf_adjusted_bars_meta.json"
FUND_BARS = DATA / "fund_bars.csv"

ALLOWED_REFRESH_SOURCES = frozenset({"eastmoney_fqt1", ""})


@dataclass(frozen=True)
class CsvBar:
    date: str
    close: str


def read_primary_on_exchange() -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    with PRODUCTS.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            if (row.get("is_primary") or "").strip().lower() != "true":
                continue
            code = (row.get("code") or "").strip()
            if not code or not code.isdigit() or len(code) != 6:
                continue
            if code.startswith("00"):
                continue
            ref = history_start_for_product_row(row)
            out.append((code, ref))
    return out


def load_merged_bars(codes: set[str]) -> dict[str, dict[str, CsvBar]]:
    merged: dict[str, dict[str, CsvBar]] = {c: {} for c in codes}
    for path in (BARS, BARS_MORE):
        if not path.exists():
            continue
        with path.open(newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                code = (row.get("etf_code") or "").strip()
                d = (row.get("date") or "").strip()
                close = (row.get("close") or "").strip()
                if code not in merged or not d or not close:
                    continue
                merged[code][d] = CsvBar(d, close)
    return merged


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify primary ETF bar datasets")
    parser.add_argument(
        "--allow-tencent",
        action="store_true",
        help="Allow refresh_source=tencent_qfq (default: fail)",
    )
    parser.add_argument(
        "--site",
        help="Optional production site URL to spot-check barsmore row count (e.g. https://newhl-dashboard.pages.dev)",
    )
    args = parser.parse_args()

    meta = json.loads(META.read_text(encoding="utf-8")) if META.exists() else {}
    by_meta = meta.get("etfs") or {}
    end_s = date.today().isoformat().replace("-", "")
    errors: list[str] = []

    for code, listed in read_primary_on_exchange():
        if not listed:
            errors.append(f"{code}: missing listed_date in etf_products.csv")
            continue
        beg = listed.replace("-", "")
        bars_map = load_merged_bars({code})[code]
        rows = [bars_map[d] for d in sorted(bars_map)]
        m = by_meta.get(code) or {}
        meta_rows = int(m.get("bars_rows") or 0)
        src = (m.get("refresh_source") or "").strip()

        if len(rows) != meta_rows and meta_rows > 0:
            errors.append(f"{code}: meta bars_rows={meta_rows} but merged={len(rows)}")
        if not history_covers_range_for_verify(rows, beg, end_s):
            need = min_expected_trading_bars(beg, end_s)
            first = rows[0].date if rows else "—"
            last = rows[-1].date if rows else "—"
            errors.append(
                f"{code}: incomplete bars ({len(rows)} {first}..{last}, need >={need})"
            )
        if not args.allow_tencent and src == "tencent_qfq":
            errors.append(
                f"{code}: refresh_source=tencent_qfq (use Eastmoney sync, not Tencent apply)"
            )
        elif src and src not in ALLOWED_REFRESH_SOURCES and src != "tencent_qfq":
            errors.append(f"{code}: unknown refresh_source={src}")

    # 场外主跟踪 007751
    with PRODUCTS.open(newline="", encoding="utf-8-sig") as f:
        otc = [
            (
                r["code"].strip(),
                history_start_for_product_row(r),
            )
            for r in csv.DictReader(f)
            if (r.get("is_primary") or "").lower() == "true"
            and (r.get("code") or "").strip() == "007751"
        ]
    if otc:
        code, listed = otc[0]
        rows_f: list[CsvBar] = []
        if FUND_BARS.exists():
            with FUND_BARS.open(newline="", encoding="utf-8-sig") as f:
                for row in csv.DictReader(f):
                    if (row.get("fund_code") or "").strip() != code:
                        continue
                    d = (row.get("date") or "").strip()
                    nav = (row.get("nav_unit") or row.get("close") or "").strip()
                    if d and nav:
                        rows_f.append(CsvBar(d, nav))
        n = len(rows_f)
        first = last = ""
        if rows_f:
            rows_f.sort(key=lambda b: b.date)
            first, last = rows_f[0].date, rows_f[-1].date
        if listed:
            beg = listed.replace("-", "")
            if not history_covers_range_for_verify(rows_f, beg, end_s):
                errors.append(f"{code}: fund_bars incomplete ({n} {first}..{last})")

    if args.site:
        import subprocess
        import urllib.parse

        site = args.site.rstrip("/")
        for probe in ("515450", "512890"):
            url = f"{site}/data/barsmore.csv"
            cp = subprocess.run(
                ["curl", "-fsSL", url],
                capture_output=True,
                text=True,
                timeout=120,
            )
            if cp.returncode != 0:
                errors.append(f"production: failed to fetch {url}")
                break
            count = sum(1 for line in cp.stdout.splitlines() if line.startswith(f"{probe},"))
            local = len(load_merged_bars({probe})[probe])
            if count < local * 0.95:
                errors.append(
                    f"production {probe}: barsmore rows {count} << local {local} (site stale?)"
                )

    if errors:
        print("PRIMARY ETF BAR VERIFY FAILED:")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)

    print(f"Primary ETF bar verify OK ({len(read_primary_on_exchange())} on-exchange + OTC)")


if __name__ == "__main__":
    main()
