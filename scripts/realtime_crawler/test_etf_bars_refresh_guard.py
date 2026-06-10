#!/usr/bin/env python3
"""Quick checks for etf_bars_refresh_guard."""
from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from datetime import date

from etf_bars_refresh_guard import (
    aligned_return_drift_pp,
    assess_refresh_guard,
    history_start_for_product_row,
)


@dataclass
class B:
    date: str
    close: str


def test_truncated_new_rejected() -> None:
    beg, end = "20200101", "20260610"
    old = [B(f"2022-01-{d:02d}", f"{1.0 + d * 0.001}") for d in range(1, 25)]
    new = old
    ok, _ = assess_refresh_guard({b.date: b for b in old}, new, beg, end)
    assert not ok


def test_return_drift_rejected() -> None:
    beg, end = "20240101", "20240630"
    old = [B(f"2024-02-{d:02d}", "1.0") for d in range(1, 29)]
    old += [B(f"2024-03-{d:02d}", "1.0") for d in range(1, 29)]
    new = [B(b.date, "1.2") for b in old]
    ok, note = assess_refresh_guard({b.date: b for b in old}, new, beg, end)
    assert not ok, note


def test_extra_tail_ignored() -> None:
    """新序列多出的尾段不参与收益对比：终点取 min(旧末, 新末)。"""
    beg = "20191201"
    old = {
        "2019-12-01": B("2019-12-01", "1.0"),
        "2026-05-30": B("2026-05-30", "2.0"),
    }
    new = {
        **old,
        "2026-06-08": B("2026-06-08", "9.0"),  # 多出的尾 K 不应拉高 drift
    }
    drift, window, old_tr, new_tr = aligned_return_drift_pp(old, new, beg, min_span_days=2)
    assert drift == 0.0, (drift, window, old_tr, new_tr)
    assert window == "2019-12-01..2026-05-30"


def test_history_start_corrupt_recent_first_trade() -> None:
    as_of = date(2026, 6, 5)
    row = {
        "listed_date": "2019-11-26",
        "first_trade_date": "2026-05-28",
    }
    assert history_start_for_product_row(row, as_of=as_of) == "2019-11-26"


def test_history_start_first_trade_after_listed_ok() -> None:
    as_of = date(2026, 6, 5)
    row = {
        "listed_date": "2006-11-17",
        "first_trade_date": "2007-01-18",
    }
    assert history_start_for_product_row(row, as_of=as_of) == "2007-01-18"


if __name__ == "__main__":
    test_truncated_new_rejected()
    test_return_drift_rejected()
    test_extra_tail_ignored()
    test_history_start_corrupt_recent_first_trade()
    test_history_start_first_trade_after_listed_ok()
    print("etf_bars_refresh_guard: ok")
