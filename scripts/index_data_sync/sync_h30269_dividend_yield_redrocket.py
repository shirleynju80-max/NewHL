from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

from redrocket_did_common import (
    REDROCKET_SECURITY_CODES,
    fetch_redrocket_did_rows,
    fmt_date,
    read_csv,
    redrocket_target_index_codes,
    write_div_yield_meta,
)

ROOT = Path(__file__).resolve().parents[2]
INDEX_BARS = ROOT / "public" / "data" / "index_bars.csv"

DIV_COLUMNS = [
    "div_yield_nominal_pct",
    "div_yield_redrocket_did_pct",
    "div_yield_redrocket_percentile_pct",
]

LEGACY_LEGULEGU_COLUMNS = [
    "div_yield_equal_pct",
    "div_yield_ttm_pct",
    "div_yield_ttm_equal_pct",
]


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def fmt(raw: Any) -> str:
    if raw is None or raw == "":
        return ""
    return f"{float(raw):.4f}"


def source_page(security_code: str) -> str:
    return f"https://hongsehuojian.com/red-rocket/indexDetail?securityCode={security_code}"


def main() -> None:
    fields, rows = read_csv(INDEX_BARS)
    required = ["index_code", "date", "tri_close", "price_close", *DIV_COLUMNS]
    fieldnames = required + [name for name in fields if name not in required]

    index_codes_with_bars = {row.get("index_code", "") for row in rows}
    target_codes = sorted(
        code
        for code in redrocket_target_index_codes()
        if code in REDROCKET_SECURITY_CODES and code in index_codes_with_bars
    )

    redrocket_rows_by_code: dict[str, dict[str, dict[str, Any]]] = {}
    per_index_latest: dict[str, str] = {}
    for code in target_codes:
        security_code = REDROCKET_SECURITY_CODES[code]
        by_date = {
            fmt_date(row["tradeDate"]): row
            for row in fetch_redrocket_did_rows(security_code)
            if row.get("tradeDate")
        }
        redrocket_rows_by_code[code] = by_date
        if by_date:
            per_index_latest[code] = max(by_date)

    updated_by_code = {code: 0 for code in target_codes}
    total_by_code = {code: 0 for code in target_codes}
    for row in rows:
        for col in [*DIV_COLUMNS, *LEGACY_LEGULEGU_COLUMNS]:
            row.setdefault(col, "")
        index_code = row.get("index_code", "")
        if index_code not in target_codes:
            continue

        total_by_code[index_code] += 1
        row["div_yield_nominal_pct"] = ""
        row["div_yield_redrocket_did_pct"] = ""
        row["div_yield_redrocket_percentile_pct"] = ""
        for col in LEGACY_LEGULEGU_COLUMNS:
            row[col] = ""

        source = redrocket_rows_by_code[index_code].get(row.get("date", ""))
        if not source:
            continue
        did = fmt(source.get("valuationValue"))
        row["div_yield_nominal_pct"] = did
        row["div_yield_redrocket_did_pct"] = did
        row["div_yield_redrocket_percentile_pct"] = fmt(
            source.get("historicalPercentile")
        )
        updated_by_code[index_code] += 1

    write_csv(INDEX_BARS, fieldnames, rows)
    meta_path = write_div_yield_meta(per_index_latest)

    print("updated RedRocket DID rows:")
    for code in target_codes:
        by_date = redrocket_rows_by_code[code]
        first = min(by_date) if by_date else "-"
        last = max(by_date) if by_date else "-"
        security_code = REDROCKET_SECURITY_CODES[code]
        print(
            f"- {code}: {updated_by_code[code]}/{total_by_code[code]}; "
            f"source range: {first} to {last}; source={source_page(security_code)}"
        )
    if per_index_latest:
        print(
            f"meta: {meta_path} · source_latest_date={max(per_index_latest.values())}"
        )


if __name__ == "__main__":
    main()
