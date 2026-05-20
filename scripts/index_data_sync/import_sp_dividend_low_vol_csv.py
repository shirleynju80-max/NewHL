from __future__ import annotations

import argparse
import csv
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INDEX_BARS = ROOT / "public" / "data" / "index_bars.csv"

DATE_COLUMNS = ["date", "tradeDate", "trade_date", "Date", "日期"]
PRICE_COLUMNS = ["price_close", "close", "Close", "Level", "Price Return", "SPCLLHCP", "价格指数"]
TRI_COLUMNS = ["tri_close", "total_return", "Total Return", "SPCLLHCT", "全收益"]
DIV_COLUMNS = ["div_yield_nominal_pct", "dividend_yield_pct", "Dividend Yield", "股息率"]


def normalize_date(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%Y%m%d"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    raise ValueError(f"无法识别日期: {raw}")


def find_column(fieldnames: list[str], candidates: list[str], explicit: str | None = None) -> str | None:
    if explicit:
        if explicit not in fieldnames:
            raise ValueError(f"指定列不存在: {explicit}")
        return explicit
    normalized = {name.strip().lower(): name for name in fieldnames}
    for candidate in candidates:
        hit = normalized.get(candidate.strip().lower())
        if hit:
            return hit
    return None


def parse_number(raw: str | None) -> str:
    s = (raw or "").strip().replace(",", "").replace("%", "")
    if not s or s in {"-", "--", "—"}:
        return ""
    return f"{float(s):.4f}"


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return reader.fieldnames or [], list(reader)


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="导入 S&P 红利低波 50 指数历史 CSV 到 public/data/index_bars.csv")
    parser.add_argument("csv_path", type=Path)
    parser.add_argument("--index-code", default="SPCLLHCP.SPI")
    parser.add_argument("--date-column")
    parser.add_argument("--price-column")
    parser.add_argument("--tri-column")
    parser.add_argument("--div-column")
    args = parser.parse_args()

    source_fields, source_rows = read_csv(args.csv_path)
    date_col = find_column(source_fields, DATE_COLUMNS, args.date_column)
    price_col = find_column(source_fields, PRICE_COLUMNS, args.price_column)
    tri_col = find_column(source_fields, TRI_COLUMNS, args.tri_column)
    div_col = find_column(source_fields, DIV_COLUMNS, args.div_column)

    if not date_col:
        raise SystemExit(f"未找到日期列，可用 --date-column 指定；当前列: {source_fields}")
    if not price_col and not tri_col:
        raise SystemExit(f"至少需要价格指数或全收益列，可用 --price-column / --tri-column 指定；当前列: {source_fields}")

    fields, rows = read_csv(INDEX_BARS)
    required = ["index_code", "date", "tri_close", "price_close", "div_yield_nominal_pct"]
    fieldnames = required + [x for x in fields if x not in required]
    kept = [row for row in rows if row.get("index_code") != args.index_code]

    imported: list[dict[str, str]] = []
    for row in source_rows:
        date = normalize_date(row.get(date_col, ""))
        if not date:
            continue
        price = parse_number(row.get(price_col)) if price_col else ""
        tri = parse_number(row.get(tri_col)) if tri_col else ""
        div = parse_number(row.get(div_col)) if div_col else ""
        if not price and not tri:
            continue
        imported.append(
            {
                "index_code": args.index_code,
                "date": date,
                "tri_close": tri,
                "price_close": price,
                "div_yield_nominal_pct": div,
            }
        )

    imported.sort(key=lambda x: x["date"])
    write_csv(INDEX_BARS, fieldnames, imported + kept)
    print(
        f"imported {len(imported)} rows for {args.index_code}; "
        f"date={date_col}, price={price_col or '-'}, tri={tri_col or '-'}, div={div_col or '-'}"
    )


if __name__ == "__main__":
    main()
