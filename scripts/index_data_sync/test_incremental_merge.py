#!/usr/bin/env python3
"""Lightweight checks for incremental index merge (no network)."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from index_bars_incremental import (  # noqa: E402
    incremental_preserve_before,
    merge_incremental_close_series,
    verify_index_bars_consistency,
)
from sync_a_share_dividend_indices import (  # noqa: E402
    rows_have_price_only_tri,
    tri_series_incompatible_with_price_only_history,
)


def test_merge_preserves_prefix() -> None:
    baseline = {f"2026-06-{d:02d}": 1000.0 + d for d in range(1, 21)}
    fetched = {
        "2026-06-18": 1018.5,
        "2026-06-19": 1019.5,
        "2026-06-20": 1020.5,
        "2026-06-21": 1021.5,
    }
    merged, meta = merge_incremental_close_series(
        baseline,
        fetched,
        code="TEST",
        field="price",
    )
    assert meta["sync_mode"] == "incremental"
    preserve_before = incremental_preserve_before(baseline)
    for d, v in baseline.items():
        if d < preserve_before:
            assert merged[d] == v
    assert merged["2026-06-20"] == 1020.5
    assert merged["2026-06-21"] == 1021.5
    assert max(merged) == "2026-06-21"


def test_verify_rejects_truncation() -> None:
    before = {
        "X": [
            {"index_code": "X", "date": "2026-06-01", "price_close": "1", "tri_close": "1"},
            {"index_code": "X", "date": "2026-06-02", "price_close": "2", "tri_close": "2"},
        ]
    }
    after = {
        "X": [
            {"index_code": "X", "date": "2026-06-02", "price_close": "2", "tri_close": "2"},
        ]
    }
    try:
        verify_index_bars_consistency(before, after, replace_codes={"X"})
    except SystemExit:
        return
    raise AssertionError("expected verify to fail on truncation")


def test_verify_rejects_tri_price_ratio_jump() -> None:
    rows = {
        "X": [
            {"index_code": "X", "date": "2026-06-12", "price_close": "4777.32", "tri_close": "4777.32"},
            {"index_code": "X", "date": "2026-06-15", "price_close": "4891.71", "tri_close": "7265.64"},
        ]
    }
    try:
        verify_index_bars_consistency(rows, rows, replace_codes={"X"})
    except SystemExit:
        return
    raise AssertionError("expected verify to fail on tri/price ratio jump")


def test_detects_incompatible_official_tri_tail_on_price_only_history() -> None:
    old_rows = [
        {"price_close": "3283.51", "tri_close": "3283.51"},
        {"price_close": "3218.76", "tri_close": "3218.76"},
        {"price_close": "3145.71", "tri_close": "3145.71"},
    ]
    price = {
        "2026-06-23": 3109.83,
        "2026-06-24": 3110.00,
    }
    tri = {
        "2026-06-23": 4955.46,
        "2026-06-24": 4956.00,
    }
    assert rows_have_price_only_tri(old_rows)
    assert tri_series_incompatible_with_price_only_history(price, tri)


def test_existing_official_tri_is_not_price_only_history() -> None:
    old_rows = [
        {"price_close": "3000.00", "tri_close": "4500.00"},
        {"price_close": "3100.00", "tri_close": "4650.00"},
        {"price_close": "3200.00", "tri_close": "4800.00"},
    ]
    assert not rows_have_price_only_tri(old_rows)


def main() -> None:
    test_merge_preserves_prefix()
    test_verify_rejects_truncation()
    test_verify_rejects_tri_price_ratio_jump()
    test_detects_incompatible_official_tri_tail_on_price_only_history()
    test_existing_official_tri_is_not_price_only_history()
    print("incremental merge tests ok")


if __name__ == "__main__":
    main()
