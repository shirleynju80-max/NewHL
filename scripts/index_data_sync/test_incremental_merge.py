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


def main() -> None:
    test_merge_preserves_prefix()
    test_verify_rejects_truncation()
    print("incremental merge tests ok")


if __name__ == "__main__":
    main()
