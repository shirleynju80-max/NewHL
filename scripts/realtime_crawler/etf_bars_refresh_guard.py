#!/usr/bin/env python3
"""ETF 前复权 bars 大幅更新前的数据量 / 对齐区间收益率漂移校验。"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Protocol, Sequence

# 与 sync_etf_adjusted_bars.MATURITY_FIRST_BAR_SLACK_DAYS 一致
FIRST_BAR_SLACK_DAYS = 45
DEFAULT_MAX_RETURN_DRIFT_PP = 5.0
DEFAULT_MIN_ALIGNED_SPAN_DAYS = 60


class BarLike(Protocol):
    date: str
    close: str


def parse_ymd(raw: str | None) -> date | None:
    s = (raw or "").strip()
    if not s or len(s) < 10:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def history_start_for_product_row(
    row: dict[str, str],
    *,
    as_of: date | None = None,
) -> str:
    """
    K 线历史起点（写入/验收共用）：
    - 正常：first_trade_date（可晚于 listed 数周/数月）
    - 异常：first_trade 被写成最近日期而上市已久 → 用 listed_date
    """
    listed_d = parse_ymd(row.get("listed_date"))
    first_d = parse_ymd(row.get("first_trade_date"))
    today = as_of or date.today()
    if not listed_d and not first_d:
        return ""
    if not first_d:
        return listed_d.isoformat() if listed_d else ""
    if not listed_d:
        return first_d.isoformat()
    if (today - first_d).days < 120 and (today - listed_d).days > 365:
        return listed_d.isoformat()
    if first_d >= listed_d:
        return first_d.isoformat()
    return listed_d.isoformat()


def beg_to_iso(beg: str) -> str:
    b = beg.replace("-", "")[:8]
    return f"{b[:4]}-{b[4:6]}-{b[6:8]}"


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


def return_pct_between(
    by_date: dict[str, BarLike],
    start_d: str,
    end_d: str,
) -> float | None:
    if start_d not in by_date or end_d not in by_date:
        return None
    try:
        c0 = float(by_date[start_d].close)
        c1 = float(by_date[end_d].close)
    except (TypeError, ValueError):
        return None
    if c0 <= 0:
        return None
    return (c1 / c0 - 1.0) * 100.0


def aligned_return_window(
    old_by_date: dict[str, BarLike],
    new_by_date: dict[str, BarLike],
    beg: str,
) -> tuple[str, str] | None:
    """
    对齐比较窗口：
    - 起点：上市日 beg（两序列共有），否则 beg 之后首个共有交易日
    - 终点：min(旧末, 新末)，避免新序列多出的尾段 K 线干扰全段收益对比
    """
    if not old_by_date or not new_by_date:
        return None
    end_d = min(max(old_by_date), max(new_by_date))
    common = sorted(d for d in set(old_by_date) & set(new_by_date) if d <= end_d)
    if len(common) < 2:
        return None
    beg_iso = beg_to_iso(beg)
    if beg_iso in common:
        start_d = beg_iso
    else:
        on_or_after = [d for d in common if d >= beg_iso]
        start_d = on_or_after[0] if on_or_after else common[0]
    if start_d > end_d:
        return None
    return start_d, end_d


def aligned_return_drift_pp(
    old_by_date: dict[str, BarLike],
    new_by_date: dict[str, BarLike],
    beg: str,
    *,
    min_span_days: int = DEFAULT_MIN_ALIGNED_SPAN_DAYS,
) -> tuple[float | None, str | None, float | None, float | None]:
    """
    同起点、同终点（min 末日期）的全段收益差（百分点）。
    返回 (drift_pp, window_label, old_tr_pct, new_tr_pct)。
    """
    window = aligned_return_window(old_by_date, new_by_date, beg)
    if not window:
        return None, None, None, None
    start_d, end_d = window
    span_days = len([d for d in set(old_by_date) & set(new_by_date) if start_d <= d <= end_d])
    if span_days < min_span_days:
        return None, f"{start_d}..{end_d}", None, None
    old_tr = return_pct_between(old_by_date, start_d, end_d)
    new_tr = return_pct_between(new_by_date, start_d, end_d)
    if old_tr is None or new_tr is None:
        return None, f"{start_d}..{end_d}", old_tr, new_tr
    return abs(new_tr - old_tr), f"{start_d}..{end_d}", old_tr, new_tr


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
    skip_return_drift: bool = False,
) -> tuple[bool, str]:
    """
    大幅更新写入前校验：
    1) 新序列根数与首尾日期覆盖上市至今；
    2) 若旧序列已可信，新根数不应大幅缩水；
    3) 若旧序列已可信，对齐区间 [beg .. min(旧末,新末)] 的全段收益漂移 ≤ 5pp。
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
    if skip_return_drift or not old_history_trusted(old_sorted, beg, end):
        reason = "ok (skip return drift)"
        if not skip_return_drift:
            reason = "ok (no trusted baseline, skip return drift check)"
        return True, reason

    new_by = {b.date: b for b in new_sorted}
    min_bars = min_expected_trading_bars(beg, end)
    if len(new_by) < len(old_by_date) * 0.85:
        return False, f"bar count shrank {len(old_by_date)} -> {len(new_by)}"

    drift, window, old_tr, new_tr = aligned_return_drift_pp(
        old_by_date, new_by, beg
    )
    if drift is None:
        if window:
            return True, f"ok (aligned window {window} too short for return check)"
        return True, "ok (no aligned window for return check)"

    if drift > max_return_drift_pp:
        return (
            False,
            f"aligned return drift {drift:.2f}pp exceeds {max_return_drift_pp}pp "
            f"on {window} (old {old_tr:.2f}% new {new_tr:.2f}%)",
        )

    return True, f"ok (aligned {window} drift {drift:.2f}pp)"
