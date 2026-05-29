#!/usr/bin/env python3
"""
ETF 分红事件与前复权历史全量刷新。

用途：
- 抓取东方财富基金 F10「分红送配」表，写入 public/data/etf_dividends.csv。
- 当分红/拆分事件签名变化，或传入 --force 时，用东方财富日 K fqt=1
  全量刷新该 ETF 的前复权历史行情到 public/data/barsmore.csv。

为什么独立于 sync_etf_realtime.py：
- 实时爬虫适合 11:00 / 14:00 写入当日临时价。
- 分红除权后，前复权历史序列会整体变化，只补 T-1 会留下旧口径历史。
  本脚本负责低频运行的历史全量覆盖。
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import requests

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "public" / "data"
ETFS = DATA_DIR / "etfs.csv"
ETF_MORE = DATA_DIR / "etfsmore.csv"
ETF_PRODUCTS = DATA_DIR / "etf_products.csv"
TRACKING = DATA_DIR / "index_tracking_etfs.csv"
BARS = DATA_DIR / "bars.csv"
BARS_MORE = DATA_DIR / "barsmore.csv"
DIVIDENDS = DATA_DIR / "etf_dividends.csv"
META = DATA_DIR / "etf_adjusted_bars_meta.json"

HIS_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
F10_DIV_URL = "https://fundf10.eastmoney.com/fhsp_{code}.html"
HEADERS = [
    "-H",
    "User-Agent: Mozilla/5.0",
    "-H",
    "Referer: https://fund.eastmoney.com/",
]

BAR_FIELDS = ["etf_code", "date", "open", "high", "low", "close"]
DIV_FIELDS = [
    "etf_code",
    "year",
    "record_date",
    "ex_dividend_date",
    "cash_per_unit",
    "payment_date",
    "source_url",
    "updated_at",
]
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


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def infer_secid(code: str) -> str | None:
    c = code.strip()
    if len(c) != 6 or not c.isdigit():
        return None
    if c.startswith(("50", "51", "52", "53", "56", "58")):
        return f"1.{c}"
    if c.startswith(("15", "16", "18")):
        return f"0.{c}"
    return None


def load_target_codes(include_tracking: bool = True) -> list[str]:
    out: dict[str, None] = {}
    for path in [ETFS, ETF_MORE, ETF_PRODUCTS]:
        _, rows = read_csv(path)
        for row in rows:
            code = (row.get("code") or row.get("etf_code") or "").strip()
            if code and infer_secid(code):
                out.setdefault(code, None)
    if include_tracking:
        _, rows = read_csv(TRACKING)
        for row in rows:
            code = (row.get("etf_code") or "").strip()
            if code and infer_secid(code):
                out.setdefault(code, None)
    return sorted(out)


def run_curl(url: str, *, accept_json: bool = False) -> str:
    request_headers = {"User-Agent": "Mozilla/5.0"}
    if not accept_json:
        request_headers["Referer"] = "https://fund.eastmoney.com/"
    else:
        request_headers["Referer"] = "https://quote.eastmoney.com/"
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            resp = SESSION.get(url, headers=request_headers, timeout=30)
            resp.raise_for_status()
            if resp.text:
                return resp.text
            raise RuntimeError("empty response")
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))

    for attempt in range(3):
        try:
            req = Request(url, headers=request_headers)
            with urlopen(req, timeout=20) as resp:
                text = resp.read().decode("utf-8")
            if text:
                return text
            raise RuntimeError("empty response")
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))

    headers = []
    for key, value in request_headers.items():
        headers.extend(["-H", f"{key}: {value}"])
    for attempt in range(3):
        try:
            cp = subprocess.run(
                ["curl", "-L", "-s", url, *headers, "--max-time", "20"],
                check=True,
                capture_output=True,
                text=True,
            )
            if cp.stdout:
                return cp.stdout
            raise subprocess.CalledProcessError(cp.returncode, cp.args, output=cp.stdout, stderr="empty response")
        except subprocess.CalledProcessError as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
    assert last_error is not None
    raise last_error


def fmt_price(raw: Any) -> str:
    v = float(raw)
    return f"{v:.6f}".rstrip("0").rstrip(".")


def fetch_adjusted_history(code: str, beg: str = "19900101", end: str | None = None) -> list[Bar]:
    secid = infer_secid(code)
    if not secid:
        return []
    params = {
        "secid": secid,
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58",
        "klt": "101",
        "fqt": "1",
        "beg": beg.replace("-", ""),
        "end": (end or date.today().isoformat()).replace("-", ""),
    }
    text = run_curl(f"{HIS_URL}?{urlencode(params, safe=',')}", accept_json=True)
    payload = json.loads(text)
    klines = (payload.get("data") or {}).get("klines") or []
    out: list[Bar] = []
    for item in klines:
        parts = str(item).split(",")
        if len(parts) < 5:
            continue
        # f51 date, f52 open, f53 close, f54 high, f55 low
        out.append(
            Bar(
                parts[0],
                fmt_price(parts[1]),
                fmt_price(parts[3]),
                fmt_price(parts[4]),
                fmt_price(parts[2]),
            )
        )
    return out


def parse_cash_per_unit(text: str) -> str:
    m = re.search(r"([\d.]+)\s*元", text or "")
    return f"{float(m.group(1)):.4f}" if m else ""


def strip_tags(raw: str) -> str:
    raw = re.sub(r"<[^>]+>", "", raw)
    return html.unescape(raw).strip()


def parse_table_rows(table_html: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", table_html, flags=re.I | re.S):
        cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, flags=re.I | re.S)
        values = [strip_tags(c) for c in cells]
        if values:
            rows.append(values)
    return rows


def fetch_dividend_events(code: str) -> list[dict[str, str]]:
    url = F10_DIV_URL.format(code=code)
    text = run_curl(url)
    m = re.search(r"<table[^>]*class=['\"][^'\"]*cfxq[^'\"]*['\"][^>]*>(.*?)</table>", text, re.I | re.S)
    if not m:
        return []
    out: list[dict[str, str]] = []
    for cells in parse_table_rows(m.group(1)):
        if len(cells) < 5 or "暂无" in "".join(cells):
            continue
        year, record_date, ex_date, cash_text, payment_date = cells[:5]
        cash = parse_cash_per_unit(cash_text)
        if not ex_date or not cash:
            continue
        out.append(
            {
                "etf_code": code,
                "year": year.replace("年", ""),
                "record_date": record_date,
                "ex_dividend_date": ex_date,
                "cash_per_unit": cash,
                "payment_date": payment_date,
                "source_url": url,
                "updated_at": date.today().isoformat(),
            }
        )
    out.sort(key=lambda r: (r["ex_dividend_date"], r["cash_per_unit"]))
    return out


def dividend_signature(events: list[dict[str, str]]) -> str:
    payload = [
        {
            "record_date": r["record_date"],
            "ex_dividend_date": r["ex_dividend_date"],
            "cash_per_unit": r["cash_per_unit"],
            "payment_date": r["payment_date"],
        }
        for r in events
    ]
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def load_bars(path: Path) -> dict[str, dict[str, Bar]]:
    _, rows = read_csv(path)
    out: dict[str, dict[str, Bar]] = {}
    for row in rows:
        code = (row.get("etf_code") or "").strip()
        d = (row.get("date") or "").strip()
        if not code or not d:
            continue
        out.setdefault(code, {})[d] = Bar(
            d,
            (row.get("open") or "").strip(),
            (row.get("high") or "").strip(),
            (row.get("low") or "").strip(),
            (row.get("close") or "").strip(),
        )
    return out


def write_bars(path: Path, bars: dict[str, dict[str, Bar]]) -> None:
    rows: list[dict[str, str]] = []
    for code in sorted(bars):
        for d in sorted(bars[code]):
            b = bars[code][d]
            rows.append(
                {
                    "etf_code": code,
                    "date": b.date,
                    "open": b.open,
                    "high": b.high,
                    "low": b.low,
                    "close": b.close,
                }
            )
    write_csv(path, BAR_FIELDS, rows)


def load_meta() -> dict[str, Any]:
    if not META.exists():
        return {}
    return json.loads(META.read_text(encoding="utf-8"))


def write_meta(meta: dict[str, Any]) -> None:
    META.write_text(json.dumps(meta, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def bar_mismatch_count(code: str, full: list[Bar], existing: dict[str, dict[str, Bar]], tolerance: float) -> int:
    count = 0
    existing_for_code = existing.get(code, {})
    for b in full:
        old = existing_for_code.get(b.date)
        if not old:
            continue
        for field in ["open", "high", "low", "close"]:
            if not getattr(old, field):
                continue
            if abs(float(getattr(old, field)) - float(getattr(b, field))) > tolerance:
                count += 1
                break
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description="ETF 分红事件 + 前复权历史全量刷新")
    parser.add_argument("--codes", help="逗号分隔 ETF 代码；默认扫描 etfs/etfsmore/etf_products/tracking")
    parser.add_argument("--force", action="store_true", help="不管分红签名是否变化，强制全量刷新行情")
    parser.add_argument("--dry-run", action="store_true", help="只打印，不写 CSV/JSON")
    parser.add_argument("--no-index-tracking", action="store_true", help="不读取 index_tracking_etfs.csv")
    parser.add_argument("--tolerance", type=float, default=0.002, help="历史重合价格差异触发刷新阈值")
    parser.add_argument("--sleep", type=float, default=0.25, help="每个 ETF 间隔秒数")
    args = parser.parse_args()

    codes = [c.strip() for c in (args.codes or "").split(",") if c.strip()]
    if not codes:
        codes = load_target_codes(include_tracking=not args.no_index_tracking)
    codes = [c for c in codes if infer_secid(c)]
    if not codes:
        raise SystemExit("无可同步场内 ETF 代码")

    meta = load_meta()
    by_code_meta = meta.get("etfs") or {}
    barsmore = load_bars(BARS_MORE)
    existing = load_bars(BARS)
    for code, rows in barsmore.items():
        existing.setdefault(code, {}).update(rows)

    _, old_div_rows = read_csv(DIVIDENDS)
    div_rows_kept = [r for r in old_div_rows if (r.get("etf_code") or "").strip() not in set(codes)]
    refreshed: list[str] = []
    unchanged: list[str] = []
    errors: list[str] = []

    for i, code in enumerate(codes, 1):
        try:
            events = fetch_dividend_events(code)
            sig = dividend_signature(events)
            old_sig = (by_code_meta.get(code) or {}).get("dividend_signature")
            needs_refresh = args.force or sig != old_sig
            mismatch_count = 0
            full_rows: list[Bar] = []
            kline_error: str | None = None
            try:
                full_rows = fetch_adjusted_history(code)
                if not needs_refresh:
                    mismatch_count = bar_mismatch_count(code, full_rows, existing, args.tolerance)
                    needs_refresh = mismatch_count > 0
            except Exception as exc:
                kline_error = str(exc)
                full_rows = []

            div_rows_kept.extend(events)
            latest_ex = events[-1]["ex_dividend_date"] if events else ""
            prev_meta = by_code_meta.get(code) or {}
            if needs_refresh:
                if full_rows:
                    barsmore[code] = {b.date: b for b in full_rows}
                    refreshed.append(code)
                else:
                    errors.append(
                        f"{code}: kline refresh failed"
                        + (f" ({kline_error})" if kline_error else "")
                    )
            else:
                unchanged.append(code)

            by_code_meta[code] = {
                "dividend_signature": sig,
                "dividend_events": len(events),
                "latest_ex_dividend_date": latest_ex,
                "last_checked_at": date.today().isoformat(),
                "last_refreshed_at": date.today().isoformat()
                if needs_refresh and full_rows
                else prev_meta.get("last_refreshed_at", ""),
                "bars_rows": len(full_rows),
                "overlap_mismatches": mismatch_count,
            }
            print(
                f"[{i}/{len(codes)}] {code}: dividends={len(events)} latest_ex={latest_ex or '-'} "
                f"sig_changed={sig != old_sig} mismatches={mismatch_count} "
                f"{'REFRESH' if needs_refresh and full_rows else 'kline_skip' if kline_error else 'ok'}"
            )
        except Exception as exc:
            errors.append(f"{code}: {exc}")
            print(f"[{i}/{len(codes)}] {code}: ERROR {exc}")
        time.sleep(args.sleep)

    div_rows_kept.sort(key=lambda r: ((r.get("etf_code") or ""), (r.get("ex_dividend_date") or "")))
    meta["updated_at"] = date.today().isoformat()
    meta["etfs"] = by_code_meta

    print(f"refreshed={len(refreshed)} unchanged={len(unchanged)} errors={len(errors)}")
    if refreshed:
        print("refreshed_codes=" + ",".join(refreshed))
    if errors:
        print("errors:")
        for item in errors:
            print("  " + item)

    if args.dry_run:
        print("--dry-run: no file written")
        return

    write_csv(DIVIDENDS, DIV_FIELDS, div_rows_kept)
    write_bars(BARS_MORE, barsmore)
    write_meta(meta)
    print(f"written {DIVIDENDS}")
    print(f"written {BARS_MORE}")
    print(f"written {META}")
    if errors:
        fatal = [e for e in errors if "kline refresh failed" not in e]
        if fatal:
            sys.exit(1)
        print("warnings (kline refresh skipped, dividend meta kept):")
        for item in errors:
            print("  " + item)


if __name__ == "__main__":
    main()
