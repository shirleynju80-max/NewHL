#!/usr/bin/env python3
"""Validate index_bars.csv structure and preserved-history consistency."""

from __future__ import annotations

import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INDEX_BARS = ROOT / "public" / "data" / "index_bars.csv"

sys.path.insert(0, str(Path(__file__).resolve().parent))

from index_bars_incremental import (  # noqa: E402
    group_rows_by_code,
    incremental_preserve_before,
    rows_to_close_map,
    verify_index_bars_consistency,
)
from sync_a_share_dividend_indices import CNINDEX_TARGETS, CSI_TARGETS  # noqa: E402


def read_index_bars() -> list[dict[str, str]]:
    if not INDEX_BARS.exists():
        raise SystemExit(f"missing {INDEX_BARS}")
    with INDEX_BARS.open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def main() -> None:
    rows = read_index_bars()
    replace_codes = {t.code for t in CSI_TARGETS} | {t.code for t in CNINDEX_TARGETS}
    by_code = group_rows_by_code(rows)

    # Self-check: preserved prefix equals itself (catches corrupt file on disk).
    verify_index_bars_consistency(by_code, by_code, replace_codes=replace_codes)

    for code in sorted(replace_codes):
        code_rows = by_code.get(code, [])
        if not code_rows:
            print(f"::warning::index_bars verify: {code} has no rows")
            continue
        dates = sorted(r["date"] for r in code_rows if r.get("date"))
        if dates[0] > dates[-1]:
            raise SystemExit(f"{code}: unsorted dates")
        price = rows_to_close_map(code_rows)
        if price:
            print(f"  {code}: {len(code_rows)} rows {dates[0]} .. {dates[-1]} preserve_before={incremental_preserve_before(price)}")


if __name__ == "__main__":
    main()
