#!/usr/bin/env python3
"""Quick checks for etf_bars_refresh_guard."""
from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from etf_bars_refresh_guard import assess_refresh_guard, history_covers_range


@dataclass
class B:
    date: str
    close: str


def test_truncated_new_rejected() -> None:
    beg, end = "20200101", "20260610"
    old = [B(f"2022-01-{d:02d}", f"{1.0 + d * 0.001}") for d in range(1, 25)]
    new = old  # same tiny set
    ok, _ = assess_refresh_guard({b.date: b for b in old}, new, beg, end)
    assert not ok


def test_return_drift_rejected() -> None:
    beg, end = "20240101", "20240630"
    old = [B(f"2024-02-{d:02d}", "1.0") for d in range(1, 29)]
    old += [B(f"2024-03-{d:02d}", "1.0") for d in range(1, 29)]
    new = [B(b.date, "1.2") for b in old]
    ok, note = assess_refresh_guard({b.date: b for b in old}, new, beg, end)
    assert not ok, note


if __name__ == "__main__":
    test_truncated_new_rejected()
    test_return_drift_rejected()
    print("etf_bars_refresh_guard: ok")
