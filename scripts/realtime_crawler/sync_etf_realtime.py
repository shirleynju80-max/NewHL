#!/usr/bin/env python3
"""
ETF 实时爬虫：用东方财富公开行情补齐 ETF 日 K，并在盘中定点写入当日临时 OHLC。

默认行为：
- 读取 public/data/etfs.csv、etfsmore.csv、index_tracking_etfs.csv 中的场内 ETF 代码。
- 用东方财富日 K 补齐缺失历史与最新交易日。
- 用东方财富实时 quote 覆盖/写入当前交易日临时 OHLC，适合 11:00、14:00 定点运行。
- 写入 public/data/barsmore.csv，前端会按 bars.csv + barsmore.csv 合并。
- 校验今年以来东方财富历史日 K 与本地已有历史重合日期是否一致，只报告不阻断。

注意：
- 仅处理交易所 ETF/LOF 代码前缀：SH 50/51/52/56/58/53，SZ 15/16/18。
- 场外基金代码（例如 007751）会跳过。
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import subprocess
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import date, datetime, timezone, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import requests

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "public" / "data"
ETFS = DATA_DIR / "etfs.csv"
ETF_MORE = DATA_DIR / "etfsmore.csv"
BARS = DATA_DIR / "bars.csv"
BARS_MORE = DATA_DIR / "barsmore.csv"
TRACKING = DATA_DIR / "index_tracking_etfs.csv"

HIS_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
QUOTE_URL = "https://push2.eastmoney.com/api/qt/stock/get"
SINA_QUOTE_URL = "https://hq.sinajs.cn/list="
HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://quote.eastmoney.com/",
}
CN_TZ = timezone(timedelta(hours=8))
SESSION = requests.Session()
SESSION.trust_env = False


@dataclass(frozen=True)
class Bar:
    date: str
    open: str
    high: str
    low: str
    close: str


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    if not path.exists():
        return [], []
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return reader.fieldnames or [], list(reader)


def write_bars(path: Path, bars: dict[str, dict[str, Bar]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["etf_code", "date", "open", "high", "low", "close"])
        for code in sorted(bars):
            for d in sorted(bars[code]):
                b = bars[code][d]
                writer.writerow([code, b.date, b.open, b.high, b.low, b.close])


def fmt_price(raw: Any) -> str:
    v = float(raw)
    return f"{v:.6f}".rstrip("0").rstrip(".")


def infer_secid(code: str) -> str | None:
    c = code.strip()
    if len(c) != 6 or not c.isdigit():
        return None
    if c.startswith(("50", "51", "52", "53", "56", "58")):
        return f"1.{c}"
    if c.startswith(("15", "16", "18")):
        return f"0.{c}"
    return None


def infer_sina_symbol(code: str) -> str | None:
    secid = infer_secid(code)
    if not secid:
        return None
    market, c = secid.split(".", 1)
    return ("sh" if market == "1" else "sz") + c


def load_target_codes(include_tracking: bool) -> list[str]:
    out: OrderedDict[str, None] = OrderedDict()
    for path in [ETFS, ETF_MORE]:
        _, rows = read_csv(path)
        for row in rows:
            code = (row.get("code") or "").strip()
            if code:
                out.setdefault(code, None)
    if include_tracking:
        _, rows = read_csv(TRACKING)
        for row in rows:
            code = (row.get("etf_code") or "").strip()
            if code:
                out.setdefault(code, None)
    return list(out.keys())


def load_bars_from(paths: list[Path]) -> dict[str, dict[str, Bar]]:
    bars: dict[str, dict[str, Bar]] = {}
    for path in paths:
        _, rows = read_csv(path)
        for row in rows:
            code = (row.get("etf_code") or "").strip()
            d = (row.get("date") or "").strip()
            if not code or not d:
                continue
            bars.setdefault(code, {})[d] = Bar(
                date=d,
                open=(row.get("open") or "").strip(),
                high=(row.get("high") or "").strip(),
                low=(row.get("low") or "").strip(),
                close=(row.get("close") or "").strip(),
            )
    return bars


def overlay_bars(base: dict[str, dict[str, Bar]], overlay: dict[str, dict[str, Bar]]) -> dict[str, dict[str, Bar]]:
    merged = {code: dict(by_date) for code, by_date in base.items()}
    for code, by_date in overlay.items():
        merged.setdefault(code, {}).update(by_date)
    return merged


def get_json(url: str, params: dict[str, Any]) -> dict[str, Any]:
    last_error: Exception | None = None
    full_url = f"{url}?{urlencode(params, safe=',')}"
    try:
        cp = subprocess.run(
            [
                "curl",
                "-L",
                full_url,
                "-H",
                f"User-Agent: {HEADERS['User-Agent']}",
                "-H",
                f"Referer: {HEADERS['Referer']}",
                "--max-time",
                "12",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        return json.loads(cp.stdout)
    except Exception as exc:
        last_error = exc

    for attempt in range(4):
        try:
            resp = SESSION.get(url, params=params, headers=HEADERS, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            last_error = exc
            if attempt < 3:
                time.sleep(0.8 * (attempt + 1))
    raise RuntimeError(str(last_error))


def fetch_history(code: str, beg: str, end: str) -> list[Bar]:
    secid = infer_secid(code)
    if not secid:
        return []
    payload = get_json(
        HIS_URL,
        {
            "secid": secid,
            "fields1": "f1,f2,f3,f4,f5,f6",
            "fields2": "f51,f52,f53,f54,f55,f56,f57,f58",
            "klt": "101",
            "fqt": "1",
            "beg": beg.replace("-", ""),
            "end": end.replace("-", ""),
        },
    )
    data = payload.get("data") or {}
    klines = data.get("klines") or []
    out: list[Bar] = []
    for item in klines:
        parts = str(item).split(",")
        if len(parts) < 5:
            continue
        # f51 date, f52 open, f53 close, f54 high, f55 low
        out.append(Bar(parts[0], fmt_price(parts[1]), fmt_price(parts[3]), fmt_price(parts[4]), fmt_price(parts[2])))
    return out


def quote_scale(raw: Any) -> str:
    if raw is None or raw == "-" or raw == "":
        return ""
    return fmt_price(float(raw) / 1000)


def fetch_quote_bar(code: str) -> Bar | None:
    secid = infer_secid(code)
    if not secid:
        return None
    payload = get_json(
        QUOTE_URL,
        {
            "secid": secid,
            "fields": "f43,f44,f45,f46,f57,f58,f60,f86",
        },
    )
    data = payload.get("data") or {}
    if not data or data.get("f43") in (None, "-", 0):
        return None
    ts = data.get("f86")
    if not ts:
        return None
    d = datetime.fromtimestamp(int(ts), CN_TZ).date().isoformat()
    close = quote_scale(data.get("f43"))
    high = quote_scale(data.get("f44")) or close
    low = quote_scale(data.get("f45")) or close
    open_ = quote_scale(data.get("f46")) or close
    if not close:
        return None
    return Bar(d, open_, high, low, close)


def fetch_sina_quote_bar(code: str) -> Bar | None:
    symbol = infer_sina_symbol(code)
    if not symbol:
        return None
    cp = subprocess.run(
        [
            "curl",
            "-L",
            f"{SINA_QUOTE_URL}{symbol}",
            "-H",
            "User-Agent: Mozilla/5.0",
            "-H",
            "Referer: https://finance.sina.com.cn/",
            "--max-time",
            "12",
        ],
        check=True,
        capture_output=True,
    )
    text = cp.stdout.decode("gb18030", errors="ignore")
    raw = text.split('="', 1)[1].rsplit('";', 1)[0] if '="' in text else ""
    parts = raw.split(",")
    if len(parts) < 32:
        return None
    open_, prev_close, close, high, low = parts[1], parts[2], parts[3], parts[4], parts[5]
    d = parts[30]
    if not d or float(close or 0) <= 0:
        return None
    # 集合竞价或停牌时 open/high/low 可能为 0；用当前价兜底。
    o = open_ if float(open_ or 0) > 0 else close
    h = high if float(high or 0) > 0 else close
    lo = low if float(low or 0) > 0 else close
    if float(h) < max(float(o), float(close), float(lo)):
        h = str(max(float(o), float(close), float(lo)))
    if float(lo) > min(float(o), float(close), float(h)):
        lo = str(min(float(o), float(close), float(h)))
    return Bar(d, fmt_price(o), fmt_price(h), fmt_price(lo), fmt_price(close))


def bar_diff(a: Bar, b: Bar, tol: float) -> list[str]:
    diffs: list[str] = []
    for key in ["open", "high", "low", "close"]:
        av = float(getattr(a, key))
        bv = float(getattr(b, key))
        if abs(av - bv) > tol:
            diffs.append(f"{key}: local={av:g}, source={bv:g}")
    return diffs


def main() -> None:
    parser = argparse.ArgumentParser(description="ETF 实时爬虫：补齐 barsmore.csv 并校验 YTD 历史一致性")
    parser.add_argument("--output", default=str(BARS_MORE), help="输出 CSV，默认 public/data/barsmore.csv")
    parser.add_argument("--dry-run", action="store_true", help="只打印结果，不写文件")
    parser.add_argument("--skip-history", action="store_true", help="跳过历史日 K，只抓实时 quote")
    parser.add_argument("--no-realtime-quote", action="store_true", help="不写入实时 quote，只补历史日 K")
    parser.add_argument("--no-index-tracking", action="store_true", help="不读取 index_tracking_etfs.csv 中的 ETF")
    parser.add_argument("--tolerance", type=float, default=0.002, help="YTD 重合历史价格一致性容忍绝对误差")
    parser.add_argument("--fail-on-mismatch", action="store_true", help="发现 YTD 不一致时退出非 0")
    args = parser.parse_args()

    today = date.today().isoformat()
    ytd_start = f"{today[:4]}-01-01"
    targets = load_target_codes(include_tracking=not args.no_index_tracking)
    base_bars = load_bars_from([BARS])
    overlay = load_bars_from([BARS_MORE])
    existing = overlay_bars(base_bars, overlay)

    total_new = 0
    total_quote = 0
    skipped: list[str] = []
    history_errors: list[str] = []
    quote_errors: list[str] = []
    mismatches: list[str] = []

    for i, code in enumerate(targets, 1):
        secid = infer_secid(code)
        if not secid:
            skipped.append(code)
            print(f"[{i}/{len(targets)}] {code}: skipped unsupported code")
            continue

        current_dates = sorted(existing.get(code, {}))
        last_date = current_dates[-1] if current_dates else ""
        beg = ytd_start if last_date else "2000-01-01"
        print(f"[{i}/{len(targets)}] {code} <- {secid}; local_last={last_date or '-'}; fetch_from={beg}")
        if not args.skip_history:
            try:
                hist = fetch_history(code, beg, today)
                for b in hist:
                    old = existing.get(code, {}).get(b.date)
                    if old and b.date >= ytd_start:
                        diffs = bar_diff(old, b, args.tolerance)
                        if diffs:
                            mismatches.append(f"{code} {b.date}: " + "; ".join(diffs))
                    if not last_date or b.date > last_date or b.date not in existing.get(code, {}):
                        overlay.setdefault(code, {})[b.date] = b
                        total_new += 1
            except Exception as exc:
                history_errors.append(f"{code}: {exc}")

        if not args.no_realtime_quote:
            try:
                q = fetch_quote_bar(code)
                if not q:
                    q = fetch_sina_quote_bar(code)
                if q:
                    overlay.setdefault(code, {})[q.date] = q
                    total_quote += 1
            except Exception as exc:
                try:
                    q = fetch_sina_quote_bar(code)
                    if q:
                        overlay.setdefault(code, {})[q.date] = q
                        total_quote += 1
                    else:
                        quote_errors.append(f"{code}: {exc}")
                except Exception as fallback_exc:
                    quote_errors.append(f"{code}: {exc}; sina fallback failed: {fallback_exc}")
        time.sleep(0.25)

    print(
        f"targets={len(targets)} skipped={len(skipped)} "
        f"history_new_rows={total_new} realtime_quote_rows={total_quote} "
        f"history_errors={len(history_errors)} quote_errors={len(quote_errors)}"
    )
    if skipped:
        print("skipped_codes=" + ",".join(skipped))
    if history_errors:
        print("history_errors:")
        for item in history_errors[:30]:
            print("  " + item)
    if quote_errors:
        print("quote_errors:")
        for item in quote_errors[:30]:
            print("  " + item)
    if mismatches:
        print(f"YTD consistency mismatches: {len(mismatches)}")
        for item in mismatches[:50]:
            print("  " + item)
        if len(mismatches) > 50:
            print(f"  ... {len(mismatches) - 50} more")
        if args.fail_on_mismatch:
            sys.exit(2)
    else:
        print("YTD consistency: OK")

    if args.dry_run:
        print("--dry-run: no file written")
        return

    write_bars(Path(args.output), overlay)
    print(f"written {args.output}")


if __name__ == "__main__":
    main()
