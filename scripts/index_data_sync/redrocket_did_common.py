from __future__ import annotations

import csv
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests

ROOT = Path(__file__).resolve().parents[2]
INDICES = ROOT / "public" / "data" / "indices.csv"
META_PATH = ROOT / "public" / "data" / "redrocket_div_yield_meta.json"

API_URL = "https://hongsehuojian.com/fundex-quote/index/valuation"

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
    "932366": "932366.CSI",
    "932367": "932367.CSI",
    "932368": "932368.CSI",
    "980092": "980092.CNI",
    "CIS51002": "987016.CNI",
    "HSI114": "HSHYLV.HI",
    "HSSCSOY.HI": "HSSCSOY.HI",
}

# 观察池指数在红色火箭无 DID 序列（API 200 但 items 为空）；勿静默伪造映射。
REDROCKET_UNSUPPORTED_NOTES: dict[str, str] = {
    "SPCLLHCP.SPI": "S&P 指数；红色火箭 API 无 DID。指数层暂无 index_bars，研究口径可参照主跟踪 ETF。",
    "SPAHLVCP.SPI": "S&P 指数；红色火箭 API 无 DID。指数层暂无 index_bars，研究口径可参照主跟踪 ETF。",
    "FCFQCD": "富时现金流指数；红色火箭 API 无 DID。股息率非现金流板块主口径。",
}

CST = timezone(timedelta(hours=8))


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return reader.fieldnames or [], list(reader)


def fmt_date(raw: str) -> str:
    if len(raw) != 8 or not raw.isdigit():
        raise ValueError(f"unexpected tradeDate: {raw!r}")
    return f"{raw[:4]}-{raw[4:6]}-{raw[6:]}"


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
        raise RuntimeError(
            f"RedRocket returned no DID rows for {security_code}: {payload!r}"
        )
    return items


def redrocket_target_index_codes() -> set[str]:
    _, rows = read_csv(INDICES)
    categories = {"A股红利", "港股红利", "现金流"}
    return {
        row["index_code"]
        for row in rows
        if row.get("category") in categories
    }


def latest_dates_from_api(
    index_codes: list[str] | None = None,
) -> dict[str, str]:
    """各指数在红色火箭 DID 序列中的最近观测日（tradeDate）。"""
    targets = sorted(
        code
        for code in (index_codes or sorted(redrocket_target_index_codes()))
        if code in REDROCKET_SECURITY_CODES
    )
    out: dict[str, str] = {}
    for code in targets:
        security_code = REDROCKET_SECURITY_CODES[code]
        rows = fetch_redrocket_did_rows(security_code)
        dates = [
            fmt_date(row["tradeDate"])
            for row in rows
            if row.get("tradeDate")
        ]
        if dates:
            out[code] = max(dates)
    return out


def redrocket_unsupported_indices(
    per_index_latest: dict[str, str] | None = None,
) -> list[dict[str, str]]:
    """红利/现金流观察池内、红色火箭无法提供 DID 的指数及原因。"""
    latest = per_index_latest or {}
    out: list[dict[str, str]] = []
    for code in sorted(redrocket_target_index_codes()):
        if code in REDROCKET_SECURITY_CODES and code in latest:
            continue
        reason = REDROCKET_UNSUPPORTED_NOTES.get(code)
        if not reason:
            if code not in REDROCKET_SECURITY_CODES:
                reason = "红色火箭 API 无该 index_code 的 securityCode 映射。"
            else:
                reason = "已映射 securityCode，但 API 未返回 DID 序列。"
        out.append({"index_code": code, "reason": reason})
    return out


def write_div_yield_meta(per_index_latest: dict[str, str]) -> Path:
    source_latest = max(per_index_latest.values()) if per_index_latest else ""
    unsupported = redrocket_unsupported_indices(per_index_latest)
    payload = {
        "source": "红色火箭",
        "metric": "股息率(DID)",
        "update_frequency": "周频，不定期",
        "source_latest_date": source_latest,
        "per_index_latest_date": dict(sorted(per_index_latest.items())),
        "unsupported_indices": unsupported,
        "fetched_at": datetime.now(CST).isoformat(timespec="seconds"),
    }
    META_PATH.parent.mkdir(parents=True, exist_ok=True)
    META_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return META_PATH
