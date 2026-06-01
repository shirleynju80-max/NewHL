#!/usr/bin/env python3
"""
从腾讯财经 fqkline 拉取 ETF 前复权日 K，写入独立 CSV（备用水源，非东财 push2his）。

用法：
  python3 scripts/realtime_crawler/fetch_etf_bars_tencent_qfq.py \\
    --codes 513920,513950,515080,515100,515450,561580 \\
    --output public/data/barsmore_tencent_qfq.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import time
from datetime import date
from pathlib import Path
from typing import Any

import requests

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "public" / "data"
BARS = DATA_DIR / "bars.csv"
BARS_MORE = DATA_DIR / "barsmore.csv"
ETF_PRODUCTS = DATA_DIR / "etf_products.csv"
DEFAULT_OUT = DATA_DIR / "barsmore_tencent_qfq.csv"

HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://gu.qq.com/",
}
FIELDS = ["etf_code", "date", "open", "high", "low", "close", "source"]
BARS_FIELDS = ["etf_code", "date", "open", "high", "low", "close"]
META = DATA_DIR / "etf_adjusted_bars_meta.json"
TENCENT_URL = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def tencent_symbol(code: str) -> str:
    if code.startswith(("50", "51", "52", "53", "56", "58")):
        return f"sh{code}"
    if code.startswith(("15", "16", "18")):
        return f"sz{code}"
    raise ValueError(f"unsupported ETF code prefix: {code}")


def load_listing_dates(codes: set[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for row in read_csv(ETF_PRODUCTS):
        code = (row.get("code") or "").strip()
        if code not in codes:
            continue
        listed = (row.get("listed_date") or row.get("first_trade_date") or "").strip()
        if listed:
            out[code] = listed
    return out


def year_chunks(start: str, end: str) -> list[tuple[str, str]]:
    y0 = int(start[:4])
    y1 = int(end[:4])
    chunks: list[tuple[str, str]] = []
    for y in range(y0, y1 + 1):
        beg = start if y == y0 else f"{y:04d}-01-01"
        chunk_end = end if y == y1 else f"{y:04d}-12-31"
        if beg <= chunk_end:
            chunks.append((beg, chunk_end))
    return chunks


def fetch_chunk(sym: str, beg: str, end: str) -> list[list[str]]:
    param = f"{sym},day,{beg},{end},2000,qfq"
    resp = requests.get(
        TENCENT_URL,
        params={"param": param},
        headers=HEADERS,
        timeout=45,
    )
    resp.raise_for_status()
    payload: dict[str, Any] = resp.json()
    data = (payload.get("data") or {}).get(sym) or {}
    rows = data.get("qfqday") or data.get("day") or []
    return rows


def fetch_code_qfq(code: str, listing: str | None, as_of: str) -> list[dict[str, str]]:
    sym = tencent_symbol(code)
    start = listing or "2000-01-01"
    by_date: dict[str, dict[str, str]] = {}
    for beg, end in year_chunks(start, as_of):
        for attempt in range(4):
            try:
                raw_rows = fetch_chunk(sym, beg, end)
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(0.8 * (attempt + 1))
        for parts in raw_rows:
            if len(parts) < 5:
                continue
            d, o, c, h, lo = parts[0], parts[1], parts[2], parts[3], parts[4]
            by_date[d] = {
                "etf_code": code,
                "date": d,
                "open": f"{float(o):.4f}",
                "high": f"{float(h):.4f}",
                "low": f"{float(lo):.4f}",
                "close": f"{float(c):.4f}",
                "source": "tencent_qfq",
            }
        time.sleep(0.35)
    return [by_date[d] for d in sorted(by_date)]


def load_merged_existing(codes: set[str]) -> dict[str, dict[str, dict[str, str]]]:
    merged: dict[str, dict[str, dict[str, str]]] = {c: {} for c in codes}
    for path in (BARS, BARS_MORE):
        for row in read_csv(path):
            code = (row.get("etf_code") or "").strip()
            d = (row.get("date") or "").strip()
            if code not in codes or not d:
                continue
            merged[code][d] = row
    return merged


def total_return(close_by_date: dict[str, float]) -> float | None:
    if len(close_by_date) < 2:
        return None
    dates = sorted(close_by_date)
    c0 = close_by_date[dates[0]]
    c1 = close_by_date[dates[-1]]
    if c0 <= 0:
        return None
    return (c1 / c0 - 1.0) * 100.0


def compare_code(
    code: str,
    alt: dict[str, dict[str, str]],
    existing: dict[str, dict[str, str]],
) -> dict[str, Any]:
    alt_dates = sorted(alt)
    ex_dates = sorted(existing)
    overlap = sorted(set(alt_dates) & set(ex_dates))

    alt_close = {d: float(alt[d]["close"]) for d in alt_dates}
    ex_close = {d: float(existing[d]["close"]) for d in ex_dates if existing[d].get("close")}

    close_diffs = []
    for d in overlap:
        a = alt_close[d]
        e = ex_close[d]
        if e > 0:
            close_diffs.append(abs(a - e) / e)

    alt_ret = total_return(alt_close)
    ex_ret = total_return(ex_close)
    overlap_ret_alt = total_return({d: alt_close[d] for d in overlap}) if len(overlap) >= 2 else None
    overlap_ret_ex = total_return({d: ex_close[d] for d in overlap}) if len(overlap) >= 2 else None

    return {
        "code": code,
        "alt_rows": len(alt_dates),
        "ex_rows": len(ex_dates),
        "overlap_days": len(overlap),
        "alt_first": alt_dates[0] if alt_dates else "",
        "alt_last": alt_dates[-1] if alt_dates else "",
        "ex_first": ex_dates[0] if ex_dates else "",
        "ex_last": ex_dates[-1] if ex_dates else "",
        "alt_first_close": alt_close.get(alt_dates[0]) if alt_dates else None,
        "alt_last_close": alt_close.get(alt_dates[-1]) if alt_dates else None,
        "ex_first_close": ex_close.get(ex_dates[0]) if ex_dates else None,
        "ex_last_close": ex_close.get(ex_dates[-1]) if ex_dates else None,
        "alt_total_return_pct": alt_ret,
        "ex_total_return_pct": ex_ret,
        "overlap_return_alt_pct": overlap_ret_alt,
        "overlap_return_ex_pct": overlap_ret_ex,
        "overlap_return_diff_pp": (
            (overlap_ret_alt - overlap_ret_ex) if overlap_ret_alt is not None and overlap_ret_ex is not None else None
        ),
        "overlap_close_max_rel_diff_pct": max(close_diffs) * 100 if close_diffs else None,
        "overlap_close_mean_rel_diff_pct": (sum(close_diffs) / len(close_diffs) * 100) if close_diffs else None,
    }


def scrub_codes_from_csv(path: Path, codes: set[str]) -> tuple[list[dict[str, str]], int]:
    kept: list[dict[str, str]] = []
    removed = 0
    for row in read_csv(path):
        code = (row.get("etf_code") or "").strip()
        if code in codes:
            removed += 1
            continue
        kept.append({k: row.get(k, "") for k in BARS_FIELDS})
    return kept, removed


def write_bars_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=BARS_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def apply_to_barsmore(codes: set[str], alt_rows: list[dict[str, str]], as_of: str) -> None:
    """从 bars/barsmore 移除指定代码，将腾讯前复权全量写入 barsmore。"""
    import json

    alt_by_code: dict[str, list[dict[str, str]]] = {c: [] for c in codes}
    for row in alt_rows:
        code = row["etf_code"]
        if code in alt_by_code:
            alt_by_code[code].append({k: row[k] for k in BARS_FIELDS})

    for path in (BARS, BARS_MORE):
        kept, removed = scrub_codes_from_csv(path, codes)
        write_bars_csv(path, kept)
        print(f"scrubbed {path.name}: removed {removed} rows")

    barsmore_rows = read_csv(BARS_MORE)
    for code in sorted(codes):
        barsmore_rows.extend(alt_by_code.get(code, []))
    barsmore_rows.sort(key=lambda r: (r["etf_code"], r["date"]))
    write_bars_csv(BARS_MORE, barsmore_rows)
    added = sum(len(alt_by_code[c]) for c in codes)
    print(f"updated {BARS_MORE} (+{added} tencent rows, total {len(barsmore_rows)})")

    meta: dict[str, Any] = {}
    if META.exists():
        meta = json.loads(META.read_text(encoding="utf-8"))
    etfs = meta.setdefault("etfs", {})
    for code in sorted(codes):
        rows = alt_by_code.get(code, [])
        prev = etfs.get(code) or {}
        etfs[code] = {
            **prev,
            "bars_rows": len(rows),
            "last_refreshed_at": as_of,
            "last_checked_at": as_of,
            "refresh_source": "tencent_qfq",
        }
        if rows:
            print(f"  meta {code}: bars_rows={len(rows)} {rows[0]['date']}..{rows[-1]['date']}")
    meta["updated_at"] = as_of
    META.write_text(json.dumps(meta, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"updated {META}")


def main() -> None:
    parser = argparse.ArgumentParser(description="腾讯前复权 ETF 日 K → 独立 CSV + 与本地对比")
    parser.add_argument("--codes", required=True, help="逗号分隔 ETF 代码")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--as-of", default=date.today().isoformat())
    parser.add_argument("--compare-only", action="store_true", help="不拉取，仅对比已有 alt CSV")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="拉取后将腾讯前复权写入 barsmore（并从 bars/barsmore 移除同代码旧数据）",
    )
    args = parser.parse_args()

    codes = sorted({c.strip() for c in args.codes.split(",") if c.strip()})
    listing = load_listing_dates(set(codes))

    alt_by_code: dict[str, dict[str, dict[str, str]]] = {c: {} for c in codes}
    if not args.compare_only:
        all_rows: list[dict[str, str]] = []
        for i, code in enumerate(codes, 1):
            rows = fetch_code_qfq(code, listing.get(code), args.as_of)
            for row in rows:
                alt_by_code[code][row["date"]] = row
            all_rows.extend(rows)
            print(
                f"[{i}/{len(codes)}] {code}: tencent_qfq {len(rows)} rows "
                f"({rows[0]['date']}..{rows[-1]['date']})" if rows else f"[{i}/{len(codes)}] {code}: no data"
            )
        all_rows.sort(key=lambda r: (r["etf_code"], r["date"]))
        write_csv(args.output, all_rows)
        print(f"wrote {args.output} ({len(all_rows)} rows)")
        if args.apply:
            print("\n=== apply tencent_qfq → barsmore ===")
            apply_to_barsmore(set(codes), all_rows, args.as_of)
            return
    else:
        for row in read_csv(args.output):
            code = row["etf_code"]
            if code in alt_by_code:
                alt_by_code[code][row["date"]] = row
        if args.apply:
            all_rows = [alt_by_code[c][d] for c in codes for d in sorted(alt_by_code[c])]
            print("\n=== apply tencent_qfq → barsmore (from cache) ===")
            apply_to_barsmore(set(codes), all_rows, args.as_of)
            return

    existing = load_merged_existing(set(codes))
    print("\n=== 对比：腾讯前复权 vs 本地 bars∪barsmore（barsmore 覆盖同日） ===")
    for code in codes:
        r = compare_code(code, alt_by_code[code], existing[code])
        print(f"\n{code}:")
        print(
            f"  区间  腾讯 {r['alt_first']}..{r['alt_last']} ({r['alt_rows']}d) "
            f"| 本地 {r['ex_first']}..{r['ex_last']} ({r['ex_rows']}d) "
            f"| 重合 {r['overlap_days']}d"
        )
        print(
            f"  首收  腾讯 {r['alt_first_close']} | 本地 {r['ex_first_close']}"
        )
        print(
            f"  末收  腾讯 {r['alt_last_close']} | 本地 {r['ex_last_close']}"
        )
        if r["alt_total_return_pct"] is not None or r["ex_total_return_pct"] is not None:
            print(
                f"  全段收益  腾讯 {r['alt_total_return_pct']:.2f}% | 本地 {r['ex_total_return_pct']:.2f}%"
                if r["alt_total_return_pct"] is not None and r["ex_total_return_pct"] is not None
                else f"  全段收益  腾讯 {r['alt_total_return_pct']} | 本地 {r['ex_total_return_pct']}"
            )
        if r["overlap_return_diff_pp"] is not None:
            print(
                f"  重合段收益  腾讯 {r['overlap_return_alt_pct']:.2f}% | 本地 {r['overlap_return_ex_pct']:.2f}% "
                f"| 差 {r['overlap_return_diff_pp']:+.2f}pp"
            )
        if r["overlap_close_max_rel_diff_pct"] is not None:
            print(
                f"  重合收盘价  最大相对差 {r['overlap_close_max_rel_diff_pct']:.3f}% "
                f"| 均值 {r['overlap_close_mean_rel_diff_pct']:.3f}%"
            )
        else:
            print("  重合收盘价  无重合或本地无 close")


if __name__ == "__main__":
    main()
