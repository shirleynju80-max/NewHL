#!/usr/bin/env python3
"""
ETF 分红事件与前复权历史全量刷新。

用途：
- 抓取东方财富基金 F10「分红送配」表，写入 public/data/etf_dividends.csv。
- 当分红/拆分事件签名变化，或传入 --force 时，用东方财富日 K fqt=1
  全量刷新该 ETF 的前复权历史行情到 public/data/barsmore.csv。
- 现金流主跟踪 562080 / 560120 / 563990：etf_products 成立满 2 年后，
  若本地前复权历史仍明显不足，自动触发一次全量前复权拉取（同上 fqt=1）。

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
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

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

# 932366/932367/932368 主跟踪；成立满 MATURITY_FULL_HISTORY_YEARS 年后拉全量前复权
MATURITY_WATCH_CODES = frozenset({"562080", "560120", "563990"})
MATURITY_FULL_HISTORY_YEARS = 2.0
MATURITY_MIN_TRADING_BARS = 400
MATURITY_FIRST_BAR_SLACK_DAYS = 45

HIS_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
F10_DIV_URL = "https://fundf10.eastmoney.com/fhsp_{code}.html"
EM_UT = "fa5fd1943c7b386f172d689130dbedb1"
KLINE_LMT = 120000
KLINE_CHUNK_YEARS = 2
JSON_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://quote.eastmoney.com/",
}
FUND_HTML_HEADERS = {
    "User-Agent": JSON_HEADERS["User-Agent"],
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": "https://fund.eastmoney.com/",
}

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


def load_primary_tracking_codes() -> list[str]:
    """etf_products is_primary=true 且可推断 secid 的主跟踪场内 ETF。"""
    _, rows = read_csv(ETF_PRODUCTS)
    out: dict[str, None] = {}
    for row in rows:
        if (row.get("is_primary") or "").strip().lower() != "true":
            continue
        code = (row.get("code") or "").strip()
        if code and infer_secid(code):
            out.setdefault(code, None)
    return sorted(out)


def load_all_product_codes(include_tracking: bool = True) -> list[str]:
    """历史宽扫：etfs / etfsmore / etf_products / tracking 并集（含产品落地参考）。"""
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


def parse_ymd(raw: str | None) -> date | None:
    s = (raw or "").strip()
    if not s or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return None
    return datetime.strptime(s, "%Y-%m-%d").date()


def years_between(earlier: date, later: date) -> float:
    return max(0.0, (later - earlier).days / 365.25)


def load_product_listing_dates() -> dict[str, str]:
    """etf_products：优先 listed_date，否则 first_trade_date。"""
    _, rows = read_csv(ETF_PRODUCTS)
    out: dict[str, str] = {}
    for row in rows:
        code = (row.get("code") or "").strip()
        if not code:
            continue
        listed = (row.get("listed_date") or row.get("first_trade_date") or "").strip()
        if listed:
            out[code] = listed
    return out


def local_bar_summary(code: str, existing: dict[str, dict[str, Bar]]) -> tuple[int, str | None, str | None]:
    rows = existing.get(code) or {}
    if not rows:
        return 0, None, None
    dates = sorted(rows)
    return len(dates), dates[0], dates[-1]


def maturity_watch_codes(raw: str | None) -> list[str]:
    if raw:
        return sorted({c.strip() for c in raw.split(",") if c.strip()} & MATURITY_WATCH_CODES)
    return sorted(MATURITY_WATCH_CODES)


def assess_maturity_full_refresh(
    code: str,
    existing: dict[str, dict[str, Bar]],
    prev_meta: dict[str, Any],
    listing_dates: dict[str, str],
    *,
    as_of: date,
    min_years: float,
) -> tuple[bool, str, str | None]:
    """
    成立满 min_years 且本地前复权 K 线明显不足 → 需要全量前复权刷新。
    返回 (should_refresh, status_note, listing_date)。
    """
    if code not in MATURITY_WATCH_CODES:
        return False, "", None

    listing = listing_dates.get(code) or prev_meta.get("maturity_listing_date")
    listing_d = parse_ymd(listing)
    if not listing_d:
        return False, "maturity: no listing_date in etf_products", listing

    age_years = years_between(listing_d, as_of)
    if age_years + 1e-9 < min_years:
        return (
            False,
            f"maturity: pending ({age_years:.2f}y / {min_years:.0f}y, listed {listing})",
            listing,
        )

    bar_count, first_bar, last_bar = local_bar_summary(code, existing)
    prev_refresh = (prev_meta.get("maturity_full_refresh_at") or "").strip()
    first_slack_ok = True
    if first_bar and listing_d:
        first_d = parse_ymd(first_bar)
        if first_d and (first_d - listing_d).days > MATURITY_FIRST_BAR_SLACK_DAYS:
            first_slack_ok = False

    history_ok = (
        bar_count >= MATURITY_MIN_TRADING_BARS
        and first_slack_ok
        and bool(prev_refresh)
    )
    if history_ok:
        return (
            False,
            f"maturity: ok ({bar_count} bars {first_bar}..{last_bar}, refreshed {prev_refresh})",
            listing,
        )

    reason_parts = []
    if bar_count < MATURITY_MIN_TRADING_BARS:
        reason_parts.append(f"bars={bar_count}<{MATURITY_MIN_TRADING_BARS}")
    if not first_slack_ok:
        reason_parts.append(f"first_bar={first_bar} late vs listed {listing}")
    if not prev_refresh:
        reason_parts.append("no maturity_full_refresh yet")
    note = f"maturity: FULL fqt=1 ({', '.join(reason_parts)})"
    return True, note, listing


def fetch_json(url: str, params: dict[str, Any]) -> dict[str, Any]:
    """curl 优先（与 sync_etf_realtime 一致），requests 退避重试。"""
    last_error: Exception | None = None
    full_url = f"{url}?{urlencode(params, safe=',')}"
    try:
        cp = subprocess.run(
            [
                "curl",
                "-sS",
                "-L",
                full_url,
                "-H",
                f"User-Agent: {JSON_HEADERS['User-Agent']}",
                "-H",
                f"Referer: {JSON_HEADERS['Referer']}",
                "-H",
                "Accept: application/json, text/plain, */*",
                "--max-time",
                "45",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        text = cp.stdout.strip()
        if not text:
            raise RuntimeError("empty response")
        return json.loads(text)
    except Exception as exc:
        last_error = exc

    for attempt in range(5):
        try:
            resp = SESSION.get(url, params=params, headers=JSON_HEADERS, timeout=45)
            resp.raise_for_status()
            text = resp.text.strip()
            if not text:
                raise RuntimeError("empty response")
            return json.loads(text)
        except Exception as exc:
            last_error = exc
            if attempt < 4:
                time.sleep(1.2 * (attempt + 1))
    assert last_error is not None
    raise last_error


def fetch_text(url: str, *, headers: dict[str, str]) -> str:
    last_error: Exception | None = None
    for attempt in range(5):
        try:
            resp = SESSION.get(url, headers=headers, timeout=45)
            resp.raise_for_status()
            text = resp.text.strip()
            if not text:
                raise RuntimeError("empty response")
            return text
        except Exception as exc:
            last_error = exc
            if attempt < 4:
                time.sleep(1.2 * (attempt + 1))
    assert last_error is not None
    raise last_error


def fmt_price(raw: Any) -> str:
    v = float(raw)
    return f"{v:.6f}".rstrip("0").rstrip(".")


def kline_params(secid: str, beg: str, end: str) -> dict[str, str]:
    return {
        "secid": secid,
        "ut": EM_UT,
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58",
        "klt": "101",
        "fqt": "1",
        "beg": beg.replace("-", ""),
        "end": end.replace("-", ""),
        "lmt": str(KLINE_LMT),
    }


def parse_klines(klines: list[Any]) -> list[Bar]:
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


def history_beg_for_code(
    code: str,
    listing_dates: dict[str, str],
    existing: dict[str, dict[str, Bar]],
) -> str:
    listing = listing_dates.get(code)
    if listing:
        return listing.replace("-", "")
    _, first_bar, _ = local_bar_summary(code, existing)
    if first_bar:
        return first_bar.replace("-", "")
    return "20000101"


def fetch_kline_range(secid: str, beg: str, end: str) -> list[Bar]:
    payload = fetch_json(HIS_URL, kline_params(secid, beg, end))
    klines = (payload.get("data") or {}).get("klines") or []
    return parse_klines(klines)


def fetch_adjusted_history(
    code: str,
    *,
    listing_dates: dict[str, str],
    existing: dict[str, dict[str, Bar]],
    end: str | None = None,
) -> list[Bar]:
    secid = infer_secid(code)
    if not secid:
        return []
    beg = history_beg_for_code(code, listing_dates, existing)
    end_s = (end or date.today().isoformat()).replace("-", "")

    try:
        rows = fetch_kline_range(secid, beg, end_s)
        if rows:
            return rows
    except Exception:
        pass

    by_date: dict[str, Bar] = {}
    start_year = int(beg[:4])
    end_year = int(end_s[:4])
    chunk_errors = 0
    for y in range(start_year, end_year + 1, KLINE_CHUNK_YEARS):
        chunk_beg = f"{y:04d}0101"
        if chunk_beg < beg:
            chunk_beg = beg
        chunk_end_year = min(y + KLINE_CHUNK_YEARS - 1, end_year)
        chunk_end = f"{chunk_end_year:04d}1231"
        if chunk_end > end_s:
            chunk_end = end_s
        if chunk_beg > chunk_end:
            continue
        try:
            for bar in fetch_kline_range(secid, chunk_beg, chunk_end):
                by_date[bar.date] = bar
        except Exception:
            chunk_errors += 1
        time.sleep(0.35)

    if not by_date:
        if chunk_errors:
            raise RuntimeError(f"kline chunks failed ({chunk_errors} errors)")
        return []
    return [by_date[d] for d in sorted(by_date)]


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
    text = fetch_text(url, headers=FUND_HTML_HEADERS)
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
    parser.add_argument(
        "--codes",
        help="逗号分隔 ETF 代码；默认仅 etf_products 主跟踪 is_primary=true",
    )
    parser.add_argument("--force", action="store_true", help="不管分红签名是否变化，强制全量刷新行情")
    parser.add_argument("--dry-run", action="store_true", help="只打印，不写 CSV/JSON")
    parser.add_argument(
        "--all-products",
        action="store_true",
        help="宽扫 etfs/etfsmore/etf_products/tracking（含产品落地参考，约 27 只）",
    )
    parser.add_argument(
        "--no-index-tracking",
        action="store_true",
        help="与 --all-products 联用：不并入 index_tracking_etfs.csv",
    )
    parser.add_argument("--tolerance", type=float, default=0.002, help="历史重合价格差异触发刷新阈值")
    parser.add_argument("--sleep", type=float, default=0.25, help="每个 ETF 间隔秒数")
    parser.add_argument(
        "--check-overlap",
        action="store_true",
        help="分红签名未变时也拉全量 K 线做重合价校验（默认跳过，减轻限流）",
    )
    parser.add_argument(
        "--maturity-years",
        type=float,
        default=MATURITY_FULL_HISTORY_YEARS,
        help="成立满该年限后触发 562080/560120/563990 全量前复权拉取",
    )
    parser.add_argument(
        "--maturity-codes",
        default=",".join(sorted(MATURITY_WATCH_CODES)),
        help="成立 maturity-years 后自动全量前复权的产品代码",
    )
    parser.add_argument(
        "--as-of",
        help="覆盖「今日」用于成立年限判断（YYYY-MM-DD，便于 dry-run）",
    )
    args = parser.parse_args()

    as_of = parse_ymd(args.as_of) or date.today()
    listing_dates = load_product_listing_dates()
    maturity_codes = maturity_watch_codes(args.maturity_codes)

    codes = [c.strip() for c in (args.codes or "").split(",") if c.strip()]
    if not codes:
        if args.all_products:
            codes = load_all_product_codes(include_tracking=not args.no_index_tracking)
        else:
            codes = load_primary_tracking_codes()
    codes = sorted({c for c in codes if infer_secid(c)} | set(maturity_codes))
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
            prev_meta = by_code_meta.get(code) or {}
            maturity_refresh, maturity_note, maturity_listing = assess_maturity_full_refresh(
                code,
                existing,
                prev_meta,
                listing_dates,
                as_of=as_of,
                min_years=args.maturity_years,
            )
            listing_d = parse_ymd(maturity_listing or listing_dates.get(code))
            age_years = years_between(listing_d, as_of) if listing_d else 0.0
            under_maturity_threshold = (
                code in MATURITY_WATCH_CODES
                and age_years + 1e-9 < args.maturity_years
            )

            events = fetch_dividend_events(code)
            sig = dividend_signature(events)
            old_sig = prev_meta.get("dividend_signature")
            latest_ex = events[-1]["ex_dividend_date"] if events else ""
            prev_latest_ex = (prev_meta.get("latest_ex_dividend_date") or "").strip()
            prev_refreshed = (prev_meta.get("last_refreshed_at") or "").strip()
            pending_kline = bool(events) and not prev_refreshed
            if under_maturity_threshold:
                needs_refresh = args.force
            else:
                needs_refresh = (
                    args.force
                    or sig != old_sig
                    or maturity_refresh
                    or pending_kline
                    or (bool(latest_ex) and latest_ex != prev_latest_ex)
                )
            mismatch_count = 0
            full_rows: list[Bar] = []
            kline_error: str | None = None
            needs_kline = (
                not (under_maturity_threshold and not args.force)
                and (needs_refresh or args.check_overlap)
            )
            if needs_kline:
                try:
                    full_rows = fetch_adjusted_history(
                        code,
                        listing_dates=listing_dates,
                        existing=existing,
                    )
                    if not needs_refresh and args.check_overlap:
                        mismatch_count = bar_mismatch_count(
                            code, full_rows, existing, args.tolerance
                        )
                        needs_refresh = mismatch_count > 0
                except Exception as exc:
                    kline_error = str(exc)
                    full_rows = []

            div_rows_kept.extend(events)
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

            maturity_done = maturity_refresh and needs_refresh and bool(full_rows)
            stored_sig = sig if (not needs_refresh or full_rows) else (old_sig or sig)
            by_code_meta[code] = {
                "dividend_signature": stored_sig,
                "dividend_events": len(events),
                "latest_ex_dividend_date": latest_ex,
                "last_checked_at": date.today().isoformat(),
                "last_refreshed_at": date.today().isoformat()
                if needs_refresh and full_rows
                else prev_meta.get("last_refreshed_at", ""),
                "bars_rows": len(full_rows),
                "overlap_mismatches": mismatch_count,
                "maturity_listing_date": maturity_listing or prev_meta.get("maturity_listing_date", ""),
                "maturity_status": maturity_note or prev_meta.get("maturity_status", ""),
                "maturity_full_refresh_at": date.today().isoformat()
                if maturity_done
                else prev_meta.get("maturity_full_refresh_at", ""),
            }
            print(
                f"[{i}/{len(codes)}] {code}: dividends={len(events)} latest_ex={latest_ex or '-'} "
                f"sig_changed={sig != old_sig} mismatches={mismatch_count} "
                f"maturity={'YES' if maturity_refresh else 'no'}"
                + (f" ({maturity_note})" if maturity_note else "")
                + (
                    " skip_kline_until_2y"
                    if under_maturity_threshold and not args.force
                    else (
                        " skip_kline_unchanged"
                        if not needs_kline and not needs_refresh
                        else f" {'REFRESH' if needs_refresh and full_rows else 'kline_skip' if kline_error else 'ok'}"
                    )
                )
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
