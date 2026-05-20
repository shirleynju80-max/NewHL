from __future__ import annotations

import csv
import hashlib
import re
from datetime import date
from pathlib import Path
from typing import Any

import requests

ROOT = Path(__file__).resolve().parents[2]
INDEX_BARS = ROOT / "public" / "data" / "index_bars.csv"

PAGE_URL = "https://legulegu.com/stockdata/index-basic?indexCode=h30269.CSI"
API_URL = "https://legulegu.com/api/stockdata/index-basic"

DIV_COLUMNS = [
    "div_yield_nominal_pct",
    "div_yield_equal_pct",
    "div_yield_ttm_pct",
    "div_yield_ttm_equal_pct",
]


def today_token() -> str:
    return hashlib.md5(date.today().isoformat().encode()).hexdigest()


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return reader.fieldnames or [], list(reader)


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def fmt(raw: Any) -> str:
    if raw is None or raw == "":
        return ""
    return f"{float(raw):.4f}"


def fetch_legulegu_rows() -> list[dict[str, Any]]:
    session = requests.Session()
    page = session.get(
        PAGE_URL,
        headers={"User-Agent": "Mozilla/5.0", "Accept": "text/html,*/*"},
        timeout=30,
    )
    page.raise_for_status()
    csrf = re.search(r'name="_csrf"\s+content="([^"]+)"', page.text)
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json, text/plain, */*",
        "Referer": page.url,
        "X-Requested-With": "XMLHttpRequest",
    }
    if csrf:
        headers["X-CSRF-Token"] = csrf.group(1)
    resp = session.get(
        API_URL,
        params={"indexCode": "h30269.CSI", "token": today_token()},
        headers=headers,
        timeout=45,
    )
    resp.raise_for_status()
    data = resp.json()
    rows = data.get("data") or []
    if not rows:
        raise RuntimeError("Legulegu returned no H30269 valuation rows")
    return rows


def main() -> None:
    fields, rows = read_csv(INDEX_BARS)
    required = ["index_code", "date", "tri_close", "price_close", *DIV_COLUMNS]
    fieldnames = required + [name for name in fields if name not in required]

    by_date = {
        row["date"]: row
        for row in fetch_legulegu_rows()
        if row.get("date")
    }
    updated = 0
    for row in rows:
        if row.get("index_code") != "H30269":
            for col in DIV_COLUMNS:
                row.setdefault(col, "")
            continue
        source = by_date.get(row.get("date", ""))
        for col in DIV_COLUMNS:
            row.setdefault(col, "")
        if not source:
            continue
        # 主口径：静态股息率（加权口径），对应乐咕图例“静态股息率”。
        row["div_yield_nominal_pct"] = fmt(source.get("addDvRatio"))
        # 扩展口径保留，便于后续核对/切换。
        row["div_yield_equal_pct"] = fmt(source.get("dvRatio"))
        row["div_yield_ttm_pct"] = fmt(source.get("addDvTtm"))
        row["div_yield_ttm_equal_pct"] = fmt(source.get("dvTtm"))
        updated += 1

    write_csv(INDEX_BARS, fieldnames, rows)
    first = min(by_date) if by_date else "-"
    last = max(by_date) if by_date else "-"
    print(f"updated H30269 dividend rows: {updated}; source range: {first} to {last}; primary=addDvRatio")


if __name__ == "__main__":
    main()
