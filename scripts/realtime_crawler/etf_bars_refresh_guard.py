#!/usr/bin/env python3
"""ETF 前复权 bars 大幅更新前的数据量 / 全段收益率漂移校验（本地与线上共用口径）。"""
from __future__ import annotations

from datetime import datetime
from typing import Protocol, Sequence

# 与 sync_etf_adjusted_bars.MATURITY_FIRST_BAR_SLACK_DAYS 一致
FIRST_BAR_SLACK_DAYS = 45
DEFAULT_MAX_RETURN_DRIFT_PP = 5.0


class BarLike(Protocol):
    date: str
    close: str


def history_span_calendar_days(beg: str, end: str) -> int:
    bd = datetime.strptime(beg[:8], "%Y%m%d").date()
    ed = datetime.strptime(end[:8], "%Y%m%d").date()
    return max(0, (ed - bd).days)


def min_expected_trading_bars(beg: str, end: str) -> int:
    days = history_span_calendar_days(beg, end)
    return max(40, int(days * 240 / 365))


def history_covers_range(rows: Sequence[BarLike], beg: str, end: str) -> bool:
    if not rows:
        return False
    min_bars = min_expected_trading_bars(beg, end)
    if len(rows) < min_bars:
        return False
    first = rows[0].date.replace("-", "")
    last = rows[-1].date.replace("-", "")
    beg8 = beg[:8]
    end8 = end[:8]
    first_d = datetime.strptime(first, "%Y%m%d").date()
    beg_d = datetime.strptime(beg8, "%Y%m%d").date()
    last_d = datetime.strptime(last, "%Y%m%d").date()
    end_d = datetime.strptime(end8, "%Y%m%d").date()
    if (first_d - beg_d).days > FIRST_BAR_SLACK_DAYS:
        return False
    if (end_d - last_d).days > 12:
        return False
    return True


def history_covers_range_for_verify(
    rows: Sequence[BarLike],
    beg: str,
    end: str,
    *,
    min_bar_ratio: float = 0.88,
    end_slack_days: int = 5,
) -> bool:
    """CI 验收略宽于写入 gate：允许估算根数略低、末根 T-1。"""
    if not rows:
        return False
    min_bars = max(40, int(min_expected_trading_bars(beg, end) * min_bar_ratio))
    if len(rows) < min_bars:
        return False
    first = rows[0].date.replace("-", "")
    last = rows[-1].date.replace("-", "")
    first_d = datetime.strptime(first, "%Y%m%d").date()
    beg_d = datetime.strptime(beg[:8], "%Y%m%d").date()
    last_d = datetime.strptime(last, "%Y%m%d").date()
    end_d = datetime.strptime(end[:8], "%Y%m%d").date()
    if (first_d - beg_d).days > FIRST_BAR_SLACK_DAYS:
        return False
    if (end_d - last_d).days > end_slack_days:
        return False
    return True


def total_return_pct(rows: Sequence[BarLike]) -> float | None:
    if len(rows) < 2:
        return None
    sorted_rows = sorted(rows, key=lambda b: b.date)
    try:
        c0 = float(sorted_rows[0].close)
        c1 = float(sorted_rows[-1].close)
    except (TypeError, ValueError):
        return None
    if c0 <= 0:
        return None
    return (c1 / c0 - 1.0) * 100.0


def overlap_total_return_drift_pp(
    old_by_date: dict[str, BarLike],
    new_by_date: dict[str, BarLike],
    *,
    min_overlap_days: int = 60,
) -> float | None:
    overlap_dates = sorted(set(old_by_date) & set(new_by_date))
    if len(overlap_dates) < min_overlap_days:
        return None
    old_rows = [old_by_date[d] for d in overlap_dates]
    new_rows = [new_by_date[d] for d in overlap_dates]
    old_tr = total_return_pct(old_rows)
    new_tr = total_return_pct(new_rows)
    if old_tr is None or new_tr is None:
        return None
    return abs(new_tr - old_tr)


def old_history_trusted(
    old_rows: Sequence[BarLike],
    beg: str,
    end: str,
    *,
    min_ratio: float = 0.85,
) -> bool:
    min_bars = min_expected_trading_bars(beg, end)
    if len(old_rows) < min_bars * min_ratio:
        return False
    return history_covers_range(old_rows, beg, end)


def assess_refresh_guard(
    old_by_date: dict[str, BarLike],
    new_rows: Sequence[BarLike],
    beg: str,
    end: str,
    *,
    max_return_drift_pp: float = DEFAULT_MAX_RETURN_DRIFT_PP,
) -> tuple[bool, str]:
    """
    大幅更新写入前校验：
    1) 新序列根数与首尾日期覆盖上市至今；
    2) 若旧序列已可信，新根数不应大幅缩水；
    3) 若旧序列已可信，全段/重合段收益率漂移不超过 max_return_drift_pp（默认 5pp）。
    """
    if not new_rows:
        return False, "empty new rows"
    new_sorted = sorted(new_rows, key=lambda b: b.date)
    if not history_covers_range(new_sorted, beg, end):
        min_bars = min_expected_trading_bars(beg, end)
        return (
            False,
            f"incomplete history ({len(new_sorted)} bars "
            f"{new_sorted[0].date}..{new_sorted[-1].date}, need >={min_bars})",
        )

    old_sorted = [old_by_date[d] for d in sorted(old_by_date)]
    if not old_history_trusted(old_sorted, beg, end):
        return True, "ok (no trusted baseline, skip return drift check)"

    new_by = {b.date: b for b in new_sorted}
    min_bars = min_expected_trading_bars(beg, end)
    if len(new_by) < len(old_by_date) * 0.85:
        return False, f"bar count shrank {len(old_by_date)} -> {len(new_by)}"

    old_tr = total_return_pct(old_sorted)
    new_tr = total_return_pct(new_sorted)
    if old_tr is not None and new_tr is not None:
        drift = abs(new_tr - old_tr)
        if drift > max_return_drift_pp:
            return (
                False,
                f"total return drift {drift:.2f}pp exceeds {max_return_drift_pp}pp "
                f"(old {old_tr:.2f}% new {new_tr:.2f}%)",
            )

    overlap_drift = overlap_total_return_drift_pp(old_by_date, new_by)
    if overlap_drift is not None and overlap_drift > max_return_drift_pp:
        return (
            False,
            f"overlap return drift {overlap_drift:.2f}pp exceeds {max_return_drift_pp}pp",
        )

    return True, "ok"
