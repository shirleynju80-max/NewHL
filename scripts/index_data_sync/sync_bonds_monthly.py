#!/usr/bin/env python3
"""
将中债 10Y、美债 10Y 月末收益率写入 public/data/bonds.csv。

数据源（官网）：
  - 中国：中债国债收益率曲线 10 年
    https://yield.chinabond.com.cn/cbweb-pbc-web/pbc/historyQuery
  - 美国：Daily Treasury Par Yield Curve — 10 Yr
    https://home.treasury.gov/resource-center/data-chart-center/interest-rates/

口径：每月取该月**最后一个有数据的交易日**观测，日期键为**自然月末**（YYYY-MM-DD）。
与现有 bonds.csv 手工导出序列一致（如 2025-05-31 取 5/30 收盘收益率）。

默认增量：保留已有行，仅补齐缺失月份或刷新 `--months` 指定区间。
"""
from __future__ import annotations

import argparse
import csv
import sys
import time
from calendar import monthrange
from datetime import date, timedelta
from io import StringIO
from pathlib import Path
from typing import Iterable

import requests

ROOT = Path(__file__).resolve().parents[2]
BONDS_CSV = ROOT / "public" / "data" / "bonds.csv"

CN_CURVE = "中债国债收益率曲线"
CN_API = "https://yield.chinabond.com.cn/cbweb-pbc-web/pbc/historyQuery"
US_CSV_TMPL = (
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
    "daily-treasury-rates.csv/{year}/all"
    "?type=daily_treasury_yield_curve&field_tdr_date_value=all&page&_format=csv"
)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; NewHL-bonds-sync/1.0)",
    "Accept": "text/html,application/json,text/csv,*/*",
}

OUTPUT_FIELDS = ["日期", "中国10年期国债收益率(%)", "美国10年期国债收益率(%)"]
DEFAULT_START = date(2000, 1, 1)


def month_end(y: int, m: int) -> date:
    return date(y, m, monthrange(y, m)[1])


def parse_iso(d: str) -> date:
    return date.fromisoformat(d.strip()[:10])


def fmt_num(v: float | None) -> str:
    if v is None:
        return ""
    return f"{v:.4f}"


def read_bonds(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def write_bonds(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=OUTPUT_FIELDS)
        w.writeheader()
        w.writerows(rows)


def month_key(d: date) -> tuple[int, int]:
    return d.year, d.month


def monthly_last_from_daily(daily: dict[date, float]) -> dict[date, float]:
    """按自然月分组，取每月最后观测，键为自然月末。"""
    buckets: dict[tuple[int, int], tuple[date, float]] = {}
    for obs_date, val in daily.items():
        if val != val:  # NaN guard
            continue
        mk = month_key(obs_date)
        prev = buckets.get(mk)
        if prev is None or obs_date >= prev[0]:
            buckets[mk] = (obs_date, val)
    out: dict[date, float] = {}
    for y, m in buckets:
        out[month_end(y, m)] = buckets[(y, m)][1]
    return out


def iter_year_chunks(start: date, end: date) -> Iterable[tuple[date, date]]:
    """中债 historyQuery 单次查询跨度建议 ≤1 年。"""
    cur = start
    while cur <= end:
        chunk_end = min(end, cur + timedelta(days=364))
        yield cur, chunk_end
        cur = chunk_end + timedelta(days=1)


def fetch_cn_daily(start: date, end: date, sleep_s: float = 0.4) -> dict[date, float]:
    try:
        import pandas as pd
    except ImportError as e:
        raise SystemExit(
            "需要 pandas + lxml/html5lib 解析中债页面：pip install pandas lxml"
        ) from e

    daily: dict[date, float] = {}
    for chunk_start, chunk_end in iter_year_chunks(start, end):
        params = {
            "startDate": chunk_start.isoformat(),
            "endDate": chunk_end.isoformat(),
            "gjqx": "0",
            "qxId": "ycqx",
            "locale": "cn_ZH",
        }
        r = requests.get(CN_API, params=params, headers=HEADERS, timeout=60)
        r.raise_for_status()
        text = r.text.replace("&nbsp", "")
        tables = pd.read_html(StringIO(text), header=0)
        if len(tables) < 2:
            raise RuntimeError(f"中债返回无数据表：{chunk_start}..{chunk_end}")
        df = tables[1]
        if "曲线名称" not in df.columns or "10年" not in df.columns:
            raise RuntimeError(f"中债表结构异常：{list(df.columns)}")
        sub = df[df["曲线名称"] == CN_CURVE].copy()
        sub["日期"] = pd.to_datetime(sub["日期"], errors="coerce").dt.date
        sub["10年"] = pd.to_numeric(sub["10年"], errors="coerce")
        for _, row in sub.iterrows():
            obs = row["日期"]
            val = row["10年"]
            if obs is None or val != val:
                continue
            daily[obs] = float(val)
        time.sleep(sleep_s)
    return daily


def fetch_us_daily(start: date, end: date, sleep_s: float = 0.25) -> dict[date, float]:
    daily: dict[date, float] = {}
    for year in range(start.year, end.year + 1):
        url = US_CSV_TMPL.format(year=year)
        r = requests.get(url, headers=HEADERS, timeout=60)
        r.raise_for_status()
        lines = r.text.splitlines()
        if len(lines) < 2:
            continue
        header = next(csv.reader([lines[0]]))
        try:
            col_date = header.index("Date")
            col_10y = header.index("10 Yr")
        except ValueError as e:
            raise RuntimeError(f"美债 CSV 表头异常 {year}: {header}") from e
        for line in lines[1:]:
            if not line.strip():
                continue
            row = next(csv.reader([line]))
            if len(row) <= max(col_date, col_10y):
                continue
            raw_date = row[col_date].strip()
            raw_10y = row[col_10y].strip()
            if not raw_date or not raw_10y:
                continue
            try:
                m, d, y = raw_date.split("/")
                obs = date(int(y), int(m), int(d))
            except ValueError:
                continue
            if obs < start or obs > end:
                continue
            try:
                daily[obs] = float(raw_10y)
            except ValueError:
                continue
        time.sleep(sleep_s)
    return daily


def parse_month_arg(s: str) -> tuple[int, int]:
    s = s.strip()
    if len(s) == 7 and s[4] == "-":
        y, m = int(s[:4]), int(s[5:7])
    elif len(s) == 6 and s.isdigit():
        y, m = int(s[:4]), int(s[4:6])
    else:
        raise argparse.ArgumentTypeError(f"无效月份 {s!r}，用 YYYY-MM")
    if not 1 <= m <= 12:
        raise argparse.ArgumentTypeError(f"无效月份 {s!r}")
    return y, m


def month_range(start: date, end: date) -> list[date]:
    keys: list[date] = []
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        keys.append(month_end(y, m))
        m += 1
        if m > 12:
            y += 1
            m = 1
    return keys


def merge_output(
    existing_rows: list[dict[str, str]],
    months: list[date],
    cn_monthly: dict[date, float],
    us_monthly: dict[date, float],
) -> list[dict[str, str]]:
    existing = {parse_iso(r["日期"]): r for r in existing_rows}
    out: list[dict[str, str]] = [
        r for r in existing_rows if parse_iso(r["日期"]) < months[0]
    ]
    last_cn = ""
    last_us = ""
    for r in out:
        last_cn = r.get("中国10年期国债收益率(%)") or last_cn
        last_us = r.get("美国10年期国债收益率(%)") or last_us

    for me in months:
        prev = existing.get(me, {})
        cn_s = (
            fmt_num(cn_monthly[me])
            if me in cn_monthly
            else (prev.get("中国10年期国债收益率(%)") or last_cn)
        )
        us_s = (
            fmt_num(us_monthly[me])
            if me in us_monthly
            else (prev.get("美国10年期国债收益率(%)") or last_us)
        )
        if cn_s:
            last_cn = cn_s
        if us_s:
            last_us = us_s
        out.append(
            {
                "日期": me.isoformat(),
                "中国10年期国债收益率(%)": cn_s,
                "美国10年期国债收益率(%)": us_s,
            }
        )
    tail = [r for r in existing_rows if parse_iso(r["日期"]) > months[-1]]
    return out + tail


def last_completed_month_end(today: date) -> date:
    """月末更新：默认只写到上一个已完结自然月（当月未结束则不写当月）。"""
    me = month_end(today.year, today.month)
    if today >= me:
        return me
    y, m = today.year, today.month - 1
    if m < 1:
        y -= 1
        m = 12
    return month_end(y, m)


def resolve_fetch_window(
    existing: list[dict[str, str]],
    start_month: tuple[int, int] | None,
    end_month: tuple[int, int] | None,
    refresh_months: int,
    include_current_month: bool,
) -> tuple[date, date, list[date]]:
    today = date.today()
    if end_month:
        end = month_end(*end_month)
    elif include_current_month:
        end = month_end(today.year, today.month)
    else:
        end = last_completed_month_end(today)

    if start_month:
        start = month_end(*start_month)
    elif existing:
        last_row_date = max(parse_iso(r["日期"]) for r in existing)
        # 回溯 refresh_months 个月，确保可修正上月
        y, m = last_row_date.year, last_row_date.month
        m -= max(refresh_months - 1, 0)
        while m < 1:
            y -= 1
            m += 12
        start = month_end(y, m)
    else:
        start = DEFAULT_START

    if start > end:
        start = end
    months = month_range(start, end)
    fetch_start = date(start.year, start.month, 1)
    fetch_end = end
    return fetch_start, fetch_end, months


def main() -> int:
    ap = argparse.ArgumentParser(description="Sync month-end CN/US 10Y yields to bonds.csv")
    ap.add_argument("--start-month", type=parse_month_arg, help="起始月 YYYY-MM（默认：增量或 2000-01）")
    ap.add_argument("--end-month", type=parse_month_arg, help="结束月 YYYY-MM（默认：当月）")
    ap.add_argument(
        "--refresh-months",
        type=int,
        default=2,
        help="增量模式下自最新月起回溯刷新的月数（默认 2，覆盖跨月修正）",
    )
    ap.add_argument(
        "--include-current-month",
        action="store_true",
        help="包含未完结的当月（默认只写到上一个已完结自然月）",
    )
    ap.add_argument("--dry-run", action="store_true", help="只打印统计，不写文件")
    ap.add_argument("--sleep", type=float, default=0.35, help="请求间隔秒")
    args = ap.parse_args()

    existing_rows = read_bonds(BONDS_CSV)

    fetch_start, fetch_end, months = resolve_fetch_window(
        existing_rows,
        args.start_month,
        args.end_month,
        args.refresh_months,
        args.include_current_month,
    )
    if not months:
        print("无需更新")
        return 0

    print(f"拉取区间：{fetch_start} .. {fetch_end}（输出 {len(months)} 个月末点）")
    cn_daily = fetch_cn_daily(fetch_start, fetch_end, sleep_s=args.sleep)
    us_daily = fetch_us_daily(fetch_start, fetch_end, sleep_s=args.sleep)
    cn_monthly = monthly_last_from_daily(cn_daily)
    us_monthly = monthly_last_from_daily(us_daily)

    out_rows = merge_output(existing_rows, months, cn_monthly, us_monthly)

    added_cn = sum(1 for me in months if me in cn_monthly)
    added_us = sum(1 for me in months if me in us_monthly)
    print(f"中债覆盖 {added_cn}/{len(months)} 月，美债覆盖 {added_us}/{len(months)} 月")
    if out_rows:
        print(f"输出范围 {out_rows[0]['日期']} .. {out_rows[-1]['日期']}，共 {len(out_rows)} 行")
        tail = out_rows[-3:]
        for r in tail:
            print(f"  {r['日期']}  CN={r['中国10年期国债收益率(%)']}  US={r['美国10年期国债收益率(%)']}")

    if args.dry_run:
        return 0

    write_bonds(BONDS_CSV, out_rows)
    print(f"已写入 {BONDS_CSV}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
