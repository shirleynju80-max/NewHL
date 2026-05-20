#!/usr/bin/env python3
"""
从东方财富（akshare / pingzhongdata）同步开放式基金净值到 public/data/fund_bars.csv；
前端与场内 ETF 相同，经 fund_bars 并入 ETF 看板（/etf/:code）。

默认同步 index_tracking_etfs.csv 中开放式基金代码（6 位数字且非场内 ETF/LOF 前缀，如 007751）。

净值：单位净值、累计净值、日增长率（来源：fund_open_fund_info_em）。
股息率（两类，缺失不填、不前向填充）：
  - div_yield_fund_ttm_pct：过去 12 个月每份现金分红之和 / 当日单位净值 × 100（基金分配口径）
  - div_yield_index_did_pct：挂钩 index_code 在 index_bars 的红色火箭 DID（指数口径，非基金披露）
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import requests

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "public" / "data"
TRACKING = DATA_DIR / "index_tracking_etfs.csv"
INDEX_BARS = DATA_DIR / "index_bars.csv"
FUND_BARS = DATA_DIR / "fund_bars.csv"

HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "*/*",
    "Referer": "https://fund.eastmoney.com/",
}

OUTPUT_FIELDS = [
    "fund_code",
    "index_code",
    "date",
    "nav_unit",
    "nav_accum",
    "daily_return_pct",
    "div_yield_fund_ttm_pct",
    "div_yield_index_did_pct",
]


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    if not path.exists():
        return [], []
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return reader.fieldnames or [], list(reader)


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def fmt_num(raw: Any, places: int = 4) -> str:
    if raw is None or raw == "":
        return ""
    s = str(raw).strip().replace(",", "").replace("%", "")
    if s in {"", "-", "--", "—"}:
        return ""
    return f"{float(s):.{places}f}"


def parse_cash_div_per_unit(text: str) -> float | None:
    m = re.search(r"([\d.]+)\s*元", text or "")
    if not m:
        return None
    return float(m.group(1))


def is_open_end_fund_code(code: str) -> bool:
    """场内 ETF/LOF 前缀见 realtime_crawler；其余 6 位数字代码按开放式基金净值同步。"""
    if len(code) != 6 or not code.isdigit():
        return False
    if code.startswith(("50", "51", "52", "56", "58", "53", "15", "16", "18")):
        return False
    return True


def load_fund_bar_targets() -> list[tuple[str, str]]:
    _, rows = read_csv(TRACKING)
    out: list[tuple[str, str]] = []
    for r in rows:
        fund = (r.get("etf_code") or "").strip()
        index_code = (r.get("index_code") or "").strip()
        if fund and index_code and is_open_end_fund_code(fund):
            out.append((fund, index_code))
    return out


def fetch_nav_akshare(fund_code: str) -> list[dict[str, str]]:
    import akshare as ak

    unit_df = ak.fund_open_fund_info_em(symbol=fund_code, indicator="单位净值走势")
    accum_df = ak.fund_open_fund_info_em(symbol=fund_code, indicator="累计净值走势")
    accum_by_date = {
        str(r["净值日期"]).strip(): float(r["累计净值"])
        for _, r in accum_df.iterrows()
        if str(r.get("净值日期", "")).strip()
    }
    bars: list[dict[str, str]] = []
    for _, r in unit_df.iterrows():
        date = str(r["净值日期"]).strip()
        if not date:
            continue
        bars.append(
            {
                "date": date,
                "nav_unit": fmt_num(r["单位净值"], 4),
                "nav_accum": fmt_num(accum_by_date.get(date), 4),
                "daily_return_pct": fmt_num(r.get("日增长率"), 4),
            }
        )
    bars.sort(key=lambda x: x["date"])
    return bars


def fetch_dividends_akshare(fund_code: str) -> list[tuple[str, float]]:
    import akshare as ak

    df = ak.fund_open_fund_info_em(symbol=fund_code, indicator="分红送配详情")
    events: list[tuple[str, float]] = []
    for _, r in df.iterrows():
        ex_date = str(r.get("除息日") or r.get("权益登记日") or "").strip()
        amt = parse_cash_div_per_unit(str(r.get("每份分红") or ""))
        if ex_date and amt is not None:
            events.append((ex_date, amt))
    events.sort(key=lambda x: x[0])
    return events


def fetch_nav_pingzhongdata(fund_code: str) -> list[dict[str, str]]:
    """akshare 不可用时的备用：东方财富 pingzhongdata.js"""
    session = requests.Session()
    session.trust_env = False
    url = f"https://fund.eastmoney.com/pingzhongdata/{fund_code}.js"
    r = session.get(url, headers=HEADERS, timeout=60)
    r.raise_for_status()
    text = r.text
    unit_m = re.search(r"var Data_netWorthTrend = (\[.*?\]);", text, re.S)
    accum_m = re.search(r"var Data_ACWorthTrend = (\[.*?\]);", text, re.S)
    if not unit_m:
        raise RuntimeError(f"pingzhongdata 缺少 Data_netWorthTrend: {fund_code}")
    unit_rows = json.loads(unit_m.group(1))
    accum_rows = json.loads(accum_m.group(1)) if accum_m else []
    accum_by_ms = {int(row[0]): float(row[1]) for row in accum_rows if len(row) >= 2}
    bars: list[dict[str, str]] = []
    for row in unit_rows:
        ms = int(row["x"])
        date = datetime.utcfromtimestamp(ms / 1000).strftime("%Y-%m-%d")
        ret = row.get("equityReturn")
        bars.append(
            {
                "date": date,
                "nav_unit": fmt_num(row.get("y"), 4),
                "nav_accum": fmt_num(accum_by_ms.get(ms), 4),
                "daily_return_pct": fmt_num(ret, 4) if ret not in (None, "") else "",
            }
        )
    bars.sort(key=lambda x: x["date"])
    return bars


def attach_fund_ttm_yield(bars: list[dict[str, str]], div_events: list[tuple[str, float]]) -> None:
    if not bars:
        return
    for bar in bars:
        d = datetime.strptime(bar["date"], "%Y-%m-%d").date()
        window_start = d - timedelta(days=365)
        ttm = 0.0
        for ex_s, amt in div_events:
            ex = datetime.strptime(ex_s, "%Y-%m-%d").date()
            if window_start < ex <= d:
                ttm += amt
        nav = bar.get("nav_unit") or ""
        if ttm > 0 and nav:
            bar["div_yield_fund_ttm_pct"] = fmt_num(ttm / float(nav) * 100, 4)
        else:
            bar["div_yield_fund_ttm_pct"] = ""


def load_index_did(index_code: str) -> dict[str, str]:
    _, rows = read_csv(INDEX_BARS)
    out: dict[str, str] = {}
    for r in rows:
        if r.get("index_code") != index_code:
            continue
        date = (r.get("date") or "").strip()
        if not date:
            continue
        raw = (r.get("div_yield_redrocket_did_pct") or r.get("div_yield_nominal_pct") or "").strip()
        if raw:
            out[date] = fmt_num(raw, 4)
    return out


def merge_fund_bars(
    fund_code: str,
    index_code: str,
    new_rows: list[dict[str, str]],
    existing: list[dict[str, str]],
) -> list[dict[str, str]]:
    kept = [r for r in existing if r.get("fund_code") != fund_code]
    merged = kept + [
        {
            "fund_code": fund_code,
            "index_code": index_code,
            **row,
        }
        for row in new_rows
    ]
    merged.sort(key=lambda r: (r["fund_code"], r["date"]))
    return merged


def sync_one(fund_code: str, index_code: str) -> dict[str, Any]:
    try:
        bars = fetch_nav_akshare(fund_code)
        div_events = fetch_dividends_akshare(fund_code)
        nav_source = "akshare:fund_open_fund_info_em"
    except Exception as exc:
        bars = fetch_nav_pingzhongdata(fund_code)
        div_events = []
        nav_source = f"pingzhongdata (akshare failed: {exc})"

    attach_fund_ttm_yield(bars, div_events)
    index_did = load_index_did(index_code)
    did_hits = 0
    ttm_hits = 0
    for bar in bars:
        did = index_did.get(bar["date"], "")
        bar["div_yield_index_did_pct"] = did
        if did:
            did_hits += 1
        if bar.get("div_yield_fund_ttm_pct"):
            ttm_hits += 1

    return {
        "fund_code": fund_code,
        "index_code": index_code,
        "bars": bars,
        "nav_source": nav_source,
        "div_events": len(div_events),
        "ttm_hits": ttm_hits,
        "index_did_hits": did_hits,
        "first_date": bars[0]["date"] if bars else None,
        "last_date": bars[-1]["date"] if bars else None,
        "row_count": len(bars),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="同步场外基金净值到 public/data/fund_bars.csv")
    parser.add_argument("--fund-code", help="仅同步指定基金代码，如 007751")
    parser.add_argument("--index-code", help="与 --fund-code 联用时指定挂钩指数，默认从 tracking 表读取")
    args = parser.parse_args()

    mappings = load_fund_bar_targets()
    if args.fund_code:
        index_code = args.index_code
        if not index_code:
            hit = next((ix for f, ix in mappings if f == args.fund_code), "")
            if not hit:
                raise SystemExit(f"未在 index_tracking_etfs.csv 找到 {args.fund_code} 映射，请传 --index-code")
            index_code = hit
        mappings = [(args.fund_code, index_code)]

    if not mappings:
        raise SystemExit("index_tracking_etfs.csv 中无开放式基金代码（如 007751）需同步净值")

    _, existing = read_csv(FUND_BARS)
    all_rows = existing
    for fund_code, index_code in mappings:
        result = sync_one(fund_code, index_code)
        all_rows = merge_fund_bars(fund_code, index_code, result["bars"], all_rows)
        print(
            f"{fund_code} -> {index_code}: {result['row_count']} 行 "
            f"({result['first_date']} .. {result['last_date']}) "
            f"nav={result['nav_source']} "
            f"分红事件={result['div_events']} "
            f"基金TTM股息率日={result['ttm_hits']} "
            f"指数DID对齐日={result['index_did_hits']}"
        )

    write_csv(FUND_BARS, OUTPUT_FIELDS, all_rows)
    print(f"已写入 {FUND_BARS}（共 {len(all_rows)} 行）")


if __name__ == "__main__":
    main()
