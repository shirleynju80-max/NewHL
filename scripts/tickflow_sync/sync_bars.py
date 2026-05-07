#!/usr/bin/env python3
"""
将 TickFlow 日 K 合并进 public/data/bars.csv（表头：etf_code,date,open,high,low,close）。

标的列表来自 public/data/etfs.csv 的 code 列；可选列 tickflow_symbol 可覆盖自动推断的
510300.SH / 159915.SZ 形式。

环境变量：
  TICKFLOW_API_KEY   完整服务（推荐 CI）；未设置且传 --free 时用 TickFlow.free() 仅历史日 K。
  TICKFLOW_KLINE_COUNT  每只标的拉取的 K 根数，默认 3000。

用法：
  export TICKFLOW_API_KEY='…'
  python3 scripts/tickflow_sync/sync_bars.py
  python3 scripts/tickflow_sync/sync_bars.py --dry-run
  python3 scripts/tickflow_sync/sync_bars.py --free   # 无 Key，仅免费档历史日 K
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any, DefaultDict, Dict, List, Optional, Tuple


REPO_ROOT = Path(__file__).resolve().parents[2]
BARS_CSV = REPO_ROOT / "public" / "data" / "bars.csv"
ETFS_CSV = REPO_ROOT / "public" / "data" / "etfs.csv"
FALLBACK_ETFS_CSV = REPO_ROOT / "scripts" / "tickflow_sync" / "sync_etfs.csv"


def infer_tickflow_symbol(code: str) -> str:
    c = code.strip()
    if not c:
        raise ValueError("空 code")
    if "." in c:
        return c.upper()
    if len(c) != 6 or not c.isdigit():
        raise ValueError(f"无法推断 TickFlow 代码: {code!r}（需 6 位数字或已带 .SH/.SZ）")
    if c.startswith(("51", "50", "56", "58", "52", "53")):
        return f"{c}.SH"
    if c.startswith(("15", "16", "12", "13", "18")):
        return f"{c}.SZ"
    return f"{c}.SH"


def fmt_price(x: Any) -> str:
    v = float(x)
    s = f"{v:.8f}".rstrip("0").rstrip(".")
    return s if s else "0"


def resolve_etfs_csv_path() -> Path:
    env = (os.environ.get("TICKFLOW_ETFS_CSV") or "").strip()
    if env:
        p = Path(env)
        if not p.is_file():
            print(f"错误: TICKFLOW_ETFS_CSV 指向的文件不存在: {p}", file=sys.stderr)
            sys.exit(1)
        return p.resolve()
    if ETFS_CSV.is_file():
        return ETFS_CSV
    if FALLBACK_ETFS_CSV.is_file():
        return FALLBACK_ETFS_CSV
    print(
        f"错误: 未找到 etfs 列表。请放置 {ETFS_CSV}，"
        f"或提交 {FALLBACK_ETFS_CSV}，或设置 TICKFLOW_ETFS_CSV。",
        file=sys.stderr,
    )
    sys.exit(1)


def load_etf_rows() -> List[Tuple[str, str]]:
    """返回 (etf_code, tickflow_symbol)。"""
    etfs_path = resolve_etfs_csv_path()
    with etfs_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames or "code" not in reader.fieldnames:
            print("错误: etfs.csv 缺少表头或 code 列", file=sys.stderr)
            sys.exit(1)
        has_tf = "tickflow_symbol" in reader.fieldnames
        out: List[Tuple[str, str]] = []
        for row in reader:
            code = (row.get("code") or "").strip()
            if not code:
                continue
            if has_tf and (row.get("tickflow_symbol") or "").strip():
                sym = (row.get("tickflow_symbol") or "").strip().upper()
            else:
                sym = infer_tickflow_symbol(code)
            out.append((code, sym))
        return out


def load_existing_bars() -> DefaultDict[str, Dict[str, Tuple[str, str, str, str, str]]]:
    """code -> date -> (date, open, high, low, close) 字符串行元组。"""
    m: DefaultDict[str, Dict[str, Tuple[str, str, str, str, str]]] = defaultdict(dict)
    if not BARS_CSV.is_file():
        return m
    with BARS_CSV.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            code = (row.get("etf_code") or "").strip()
            d = (row.get("date") or "").strip()
            if not code or not d:
                continue
            m[code][d] = (
                d,
                (row.get("open") or "").strip(),
                (row.get("high") or "").strip(),
                (row.get("low") or "").strip(),
                (row.get("close") or "").strip(),
            )
    return m


def trade_date_to_str(v: Any) -> str:
    if hasattr(v, "strftime"):
        return v.strftime("%Y-%m-%d")
    s = str(v).strip()
    if " " in s:
        s = s.split()[0]
    return s[:10]


def dataframe_to_bar_rows(df) -> List[Tuple[str, str, str, str, str]]:
    rows: List[Tuple[str, str, str, str, str]] = []
    if df is None or len(df) == 0:
        return rows
    cols = {c.lower(): c for c in df.columns}
    dc = cols.get("trade_date") or cols.get("date")
    if not dc:
        raise RuntimeError("K 线 DataFrame 缺少 trade_date/date 列")
    oc, hc, lc, cc = cols.get("open"), cols.get("high"), cols.get("low"), cols.get("close")
    if not all([oc, hc, lc, cc]):
        raise RuntimeError("K 线 DataFrame 缺少 open/high/low/close")
    for _, r in df.iterrows():
        d = trade_date_to_str(r[dc])
        rows.append(
            (
                d,
                fmt_price(r[oc]),
                fmt_price(r[hc]),
                fmt_price(r[lc]),
                fmt_price(r[cc]),
            )
        )
    return rows


def fetch_klines(tf, symbol: str, count: int) -> List[Tuple[str, str, str, str, str]]:
    df = tf.klines.get(symbol, period="1d", count=count, as_dataframe=True)
    return dataframe_to_bar_rows(df)


def write_bars(
    merged: DefaultDict[str, Dict[str, Tuple[str, str, str, str, str]]],
) -> None:
    BARS_CSV.parent.mkdir(parents=True, exist_ok=True)
    codes = sorted(merged.keys())
    with BARS_CSV.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["etf_code", "date", "open", "high", "low", "close"])
        for code in codes:
            by_date = merged[code]
            for d in sorted(by_date.keys()):
                _, o, h, lo, c = by_date[d]
                w.writerow([code, d, o, h, lo, c])


def main() -> None:
    ap = argparse.ArgumentParser(description="TickFlow 日 K 合并到 public/data/bars.csv")
    ap.add_argument("--dry-run", action="store_true", help="只打印计划，不写文件")
    ap.add_argument("--free", action="store_true", help="使用 TickFlow.free()（无需 Key，仅历史日 K）")
    args = ap.parse_args()

    try:
        from tickflow import TickFlow
    except ImportError:
        print("错误: 未安装 tickflow。执行: pip install -r scripts/tickflow_sync/requirements.txt", file=sys.stderr)
        sys.exit(1)

    if args.free:
        tf = TickFlow.free()
    elif os.environ.get("TICKFLOW_API_KEY"):
        tf = TickFlow()
    else:
        print("提示: 未设置 TICKFLOW_API_KEY，改用 TickFlow.free()（仅历史日 K）", file=sys.stderr)
        tf = TickFlow.free()

    count = int(os.environ.get("TICKFLOW_KLINE_COUNT", "3000"))

    etf_rows = load_etf_rows()
    if not etf_rows:
        print("错误: etfs.csv 中无有效 code", file=sys.stderr)
        sys.exit(1)

    merged = load_existing_bars()

    for i, (etf_code, tf_sym) in enumerate(etf_rows):
        print(f"[{i + 1}/{len(etf_rows)}] {etf_code} <- {tf_sym} …")
        try:
            bars = fetch_klines(tf, tf_sym, count)
        except Exception as e:
            print(f"错误: 拉取 {tf_sym} 失败: {e}", file=sys.stderr)
            sys.exit(1)
        for d, o, h, lo, c in bars:
            merged[etf_code][d] = (d, o, h, lo, c)
        if i < len(etf_rows) - 1:
            time.sleep(0.35)

    if args.dry_run:
        n = sum(len(v) for v in merged.values())
        print(f"--dry-run: 合并后共 {len(merged)} 只标的、{n} 行（未写入）")
        return

    write_bars(merged)
    print(f"已写入 {BARS_CSV}")


if __name__ == "__main__":
    main()
