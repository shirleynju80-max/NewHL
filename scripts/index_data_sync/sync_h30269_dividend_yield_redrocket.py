from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

import requests

ROOT = Path(__file__).resolve().parents[2]
INDICES = ROOT / "public" / "data" / "indices.csv"
INDEX_BARS = ROOT / "public" / "data" / "index_bars.csv"

API_URL = "https://hongsehuojian.com/fundex-quote/index/valuation"

# RedRocket securityCode 后缀并不完全等同于本地展示代码：
# 中证系列用 .CSI，上证红利用 .SH，H30269 沿用页面上的小写 h30269.CSI。
REDROCKET_SECURITY_CODES = {
    "H30269": "h30269.CSI",
    "930955": "930955.CSI",
    "000922": "000922.CSI",
    "000015": "000015.SH",
    "931468": "931468.CSI",
    "000825": "000825.CSI",
    "931157": "931157.CSI",
    "930914": "930914.CSI",
    "931233": "931233.CSI",
    "932365": "932365.CSI",
    "980092": "980092.CNI",
    "CIS51002": "987016.CNI",
    "HSI114": "HSHYLV.HI",
    "HSSCSOY.HI": "HSSCSOY.HI",
}

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


def fmt_date(raw: str) -> str:
    if len(raw) != 8 or not raw.isdigit():
        raise ValueError(f"unexpected tradeDate: {raw!r}")
    return f"{raw[:4]}-{raw[4:6]}-{raw[6:]}"


def source_page(security_code: str) -> str:
    return f"https://hongsehuojian.com/red-rocket/indexDetail?securityCode={security_code}"


def iframe_referer(security_code: str) -> str:
    return (
        "https://hongsehuojian.com/index/h5/fundexh5bai/index.html"
        f"?targetPage=indexDetail&securityCode={security_code}&pro=RedRocket-PC"
    )


def fetch_redrocket_did_rows(security_code: str) -> list[dict[str, Any]]:
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json, text/plain, */*",
        "Referer": iframe_referer(security_code),
        "pro": "RedRocket-PC",
    }
    resp = requests.get(
        API_URL,
        params={
            "securityCode": security_code,
            "valuationType": "DID",
            "timeInterval": "since_inception",
        },
        headers=headers,
        timeout=45,
    )
    resp.raise_for_status()
    payload = resp.json()
    data = payload.get("data") or {}
    items = data.get("items") or []
    if payload.get("code") != "200" or not items:
        raise RuntimeError(f"RedRocket returned no DID rows for {security_code}: {payload!r}")
    return items


def redrocket_target_index_codes() -> set[str]:
    _, rows = read_csv(INDICES)
    categories = {"A股红利", "港股红利", "现金流"}
    return {
        row["index_code"]
        for row in rows
        if row.get("category") in categories
    }


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
    for code in target_codes:
        security_code = REDROCKET_SECURITY_CODES[code]
        redrocket_rows_by_code[code] = {
            fmt_date(row["tradeDate"]): row
            for row in fetch_redrocket_did_rows(security_code)
            if row.get("tradeDate")
        }

    updated_by_code = {code: 0 for code in target_codes}
    total_by_code = {code: 0 for code in target_codes}
    for row in rows:
        for col in [*DIV_COLUMNS, *LEGACY_LEGULEGU_COLUMNS]:
            row.setdefault(col, "")
        index_code = row.get("index_code", "")
        if index_code not in target_codes:
            continue

        total_by_code[index_code] += 1
        # 红色火箭 DID 为周频/不定期观测；缺失交易日保持为空，不做填充。
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
        row["div_yield_redrocket_percentile_pct"] = fmt(source.get("historicalPercentile"))
        updated_by_code[index_code] += 1

    write_csv(INDEX_BARS, fieldnames, rows)
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


if __name__ == "__main__":
    main()
