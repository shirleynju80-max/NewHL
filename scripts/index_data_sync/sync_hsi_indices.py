from __future__ import annotations

import csv
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests

ROOT = Path(__file__).resolve().parents[2]
INDEX_BARS = ROOT / "public" / "data" / "index_bars.csv"

API_URL = "https://www.hsi.com.hk/api/wsit-hsil-hiip-ea-productdata-proxy/v1/productData/e/indexes/v1"
LOGIN_URL = "https://www.hsi.com.hk/api/wsit-hsil-hiip-ea-public-proxy/v1/customers/e/login/v1"


@dataclass(frozen=True)
class HsiTarget:
    code: str
    price_code: str
    tri_code: str
    start_date: str


HSI_TARGETS = [
    HsiTarget("HSI114", "02033.00", "12033.00", "2017-05-08"),
    HsiTarget("HSSCSOY.HI", "02200.00", "12200.00", "2023-06-12"),
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


def login_access_token(username: str, password: str, lang: str = "chi") -> str:
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.hsi.com.hk/index360/chi/login",
    }
    resp = requests.post(
        LOGIN_URL,
        headers=headers,
        json={"lang": lang, "username": username, "password": password},
        timeout=45,
    )
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("code") != 200:
        raise RuntimeError(f"HSI login failed: {payload!r}")
    login_data = (payload.get("data") or {}).get("loginData") or {}
    token = str(login_data.get("accessToken") or "").strip()
    if not token:
        raise RuntimeError(f"HSI login returned no accessToken: {payload!r}")
    return token


def resolve_access_token() -> str:
    static = os.environ.get("HSI_ACCESS_TOKEN", "").strip()
    if static:
        return static

    username = os.environ.get("HSI_LOGIN_USERNAME", "").strip()
    password = os.environ.get("HSI_LOGIN_PASSWORD", "").strip()
    if not username or not password:
        raise SystemExit(
            "HSI credentials required: set HSI_LOGIN_USERNAME + HSI_LOGIN_PASSWORD "
            "(preferred), or legacy HSI_ACCESS_TOKEN."
        )

    lang = os.environ.get("HSI_LOGIN_LANG", "chi").strip() or "chi"
    token = login_access_token(username, password, lang)
    print("HSI login succeeded; access token acquired (not logged).")
    return token


def fetch_daily_close(index_code: str, start_date: str, token: str) -> dict[str, float]:
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json, text/plain, */*",
        "ACCESS_TOKEN": token,
        "Referer": "https://www.hsi.com.hk/index360/chi/indexes",
    }
    resp = requests.get(
        API_URL,
        headers=headers,
        params={
            "data": "dailyClose",
            "language": "chi",
            "indexCode": index_code,
            "interval": "daily",
            "startDate": start_date,
            "endDate": "2099-12-31",
        },
        timeout=45,
    )
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("code") != 200:
        raise RuntimeError(f"HSI API failed for {index_code}: {payload!r}")
    outer = payload.get("data") or []
    if not outer:
        raise RuntimeError(f"HSI API returned no dailyClose wrapper for {index_code}")
    rows = outer[0].get("valueHistory") or []
    out: dict[str, float] = {}
    for row in rows:
        date = str(row.get("date") or "").strip()
        close = row.get("close")
        if date and close is not None:
            out[date] = float(close)
    if not out:
        raise RuntimeError(f"HSI API returned no daily closes for {index_code}")
    return out


def main() -> None:
    token = resolve_access_token()

    fields, rows = read_csv(INDEX_BARS)
    required = [
        "index_code",
        "date",
        "tri_close",
        "price_close",
        "div_yield_nominal_pct",
        "div_yield_redrocket_did_pct",
        "div_yield_redrocket_percentile_pct",
    ]
    fieldnames = required + [name for name in fields if name not in required]
    replace_codes = {target.code for target in HSI_TARGETS}
    kept = [row for row in rows if row.get("index_code") not in replace_codes]

    summary: dict[str, Any] = {}
    new_rows: list[dict[str, str]] = []
    for target in HSI_TARGETS:
        price = fetch_daily_close(target.price_code, target.start_date, token)
        tri = fetch_daily_close(target.tri_code, target.start_date, token)
        dates = sorted(set(price) & set(tri))
        for date in dates:
            new_rows.append(
                {
                    "index_code": target.code,
                    "date": date,
                    "tri_close": f"{tri[date]:.4f}",
                    "price_close": f"{price[date]:.4f}",
                    "div_yield_nominal_pct": "",
                    "div_yield_redrocket_did_pct": "",
                    "div_yield_redrocket_percentile_pct": "",
                }
            )
        summary[target.code] = {
            "rows": len(dates),
            "range": [dates[0], dates[-1]] if dates else None,
            "price_code": target.price_code,
            "tri_code": target.tri_code,
        }

    write_csv(INDEX_BARS, fieldnames, new_rows + kept)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
