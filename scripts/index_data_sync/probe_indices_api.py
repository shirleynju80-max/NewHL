#!/usr/bin/env python3
"""
探测 indices-api.com（pypi-indices-api）能否覆盖本项目待补的标普 / 富时指数。

环境变量：
  INDICES_API_KEY 或 INDICES_API_ACCESS_KEY — 在 https://indices-api.com/register 注册

安装 SDK（已 vendored 时可跳过）：
  python3 -m pip install pypi-indices-api --target scripts/.vendor_indices_api

用法：
  python3 scripts/index_data_sync/probe_indices_api.py
  INDICES_API_KEY=xxx python3 scripts/index_data_sync/probe_indices_api.py --timeseries
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
VENDOR = ROOT / "scripts" / ".vendor_indices_api"
if VENDOR.is_dir():
    sys.path.insert(0, str(VENDOR))

SESSION = requests.Session()
SESSION.trust_env = False
API_BASE = "https://indices-api.com/api"

# 本项目 index_code → 官方 ticker / 说明 → 在 Indices-API 上可尝试的 symbol
PROJECT_TARGETS = [
    {
        "index_code": "SPCLLHCP.SPI",
        "name": "标普中国A股大盘红利低波50",
        "official_tickers": ["SPCLLHCP", "SPCLLHCT", "^SPCNLOVHD5"],
        "api_symbol_guesses": ["SPCLLHCP", "SPCLLHCT", "SPCNLOVHD5", "GSPC"],
    },
    {
        "index_code": "SPAHLVCP.SPI",
        "name": "标普港股通低波红利",
        "official_tickers": ["SPAHLVCP"],
        "api_symbol_guesses": ["SPAHLVCP", "HSI", "HS", "HSTECH"],
    },
    {
        "index_code": "FCFQCD",
        "name": "富时中国A股自由现金流聚焦",
        "official_tickers": ["FCFQCD"],
        "api_symbol_guesses": ["FCFQCD", "FTSE", "AW01", "SHAI"],
    },
]

# Indices-API 公开页列出的常见代码（无 key 时用于静态对照）
KNOWN_MAJOR_SYMBOLS = frozenset(
    {
        "GSPC",
        "DJI",
        "NYA",
        "IXIC",
        "FTSE",
        "FTSEEM",
        "HSI",
        "HS",
        "HSTECH",
        "SHAI",
        "BSESN",
        "N225",
        "AXJO",
        "RUT",
        "RUI",
        "RUA",
        "AW01",
    }
)


def load_client(access_key: str):
    from indices_api import IndicesApiClient

    return IndicesApiClient(access_key=access_key)


def fetch_symbols(access_key: str) -> dict[str, str]:
    r = SESSION.get(f"{API_BASE}/symbols", params={"access_key": access_key}, timeout=60)
    r.raise_for_status()
    data = r.json()
    if not data.get("success", True) and data.get("error"):
        raise RuntimeError(data["error"])
    symbols = data.get("symbols") or (data.get("data") or {}).get("symbols") or {}
    if not isinstance(symbols, dict):
        raise RuntimeError(f"unexpected symbols payload: {json.dumps(data)[:300]}")
    return symbols


def symbol_hit(symbols: dict[str, str], code: str) -> str | None:
    code_u = code.upper()
    for sym, name in symbols.items():
        if sym.upper() == code_u:
            return name
        if code_u in (name or "").upper():
            return name
    return None


def probe_latest(client, symbols: list[str]) -> dict:
    try:
        return client.get_latest("USD", symbols)
    except Exception as e:
        return {"error": str(e)}


def probe_timeseries(client, symbol: str, start: str, end: str) -> dict:
    try:
        return client.get_time_series(start, end, "USD", [symbol])
    except Exception as e:
        return {"error": str(e)}


def summarize_timeseries(payload: dict) -> str:
    if payload.get("error"):
        return f"ERR {payload['error']}"
    data = payload.get("data") or payload
    if data.get("success") is False:
        err = data.get("error") or data
        return f"API_FAIL {err}"
    rates = data.get("rates")
    if not rates:
        return f"no rates keys={list(data.keys())[:8]}"
    if isinstance(rates, dict):
        # 单日 dict 或 按日期嵌套
        sample_key = next(iter(rates))
        sample_val = rates[sample_key]
        if isinstance(sample_val, dict):
            days = len(sample_val)
            return f"OK nested days≈{days} sample_date={sample_key}"
        return f"OK flat rates keys={list(rates.keys())[:6]}"
    return f"rates type={type(rates)}"


def static_coverage_report() -> None:
    print("\n[静态] 无 API Key：对照 Indices-API 公开 symbol 列表（主流指数）\n")
    for t in PROJECT_TARGETS:
        hits = [g for g in t["api_symbol_guesses"] if g in KNOWN_MAJOR_SYMBOLS]
        official = ", ".join(t["official_tickers"])
        print(f"  {t['index_code']} ({t['name']})")
        print(f"    官方 ticker: {official}")
        if hits:
            print(f"    仅命中「替代」主流代码: {', '.join(hits)}（非同一指数，不可写入 index_bars）")
        else:
            print("    公开列表中无 SPCLLHCP / SPAHLVCP / FCFQCD 等专用代码")
    print(
        "\n  结论：Indices-API 面向 NYA、GSPC、FTSE、HSI 等全球主流指数；"
        "不包含 S&P DJI / FTSE Russell 编制的 A 股策略指数专用 ticker。"
    )


def live_probe(access_key: str, run_timeseries: bool) -> int:
    client = load_client(access_key)
    print("\n[在线] 拉取 /api/symbols …")
    try:
        all_symbols = fetch_symbols(access_key)
    except Exception as e:
        print(f"  FAIL symbols: {e}")
        return 1
    print(f"  OK symbols count={len(all_symbols)}")

    keywords = ("SPCL", "SPAHL", "FCFQ", "LOW VOL", "DIVIDEND", "CASH FLOW", "CHINA A", "HONG KONG")
    fuzzy = [
        (sym, name)
        for sym, name in all_symbols.items()
        if any(k in f"{sym} {name}".upper() for k in keywords)
    ]
    print(f"\n[在线] 关键词检索 ({', '.join(keywords)}):")
    if fuzzy:
        for sym, name in sorted(fuzzy)[:30]:
            print(f"    {sym}: {name[:80]}")
        if len(fuzzy) > 30:
            print(f"    … 共 {len(fuzzy)} 条")
    else:
        print("    （无匹配）")

    print("\n[在线] 逐项目标 + 猜测 symbol → latest")
    all_guesses: list[str] = []
    for t in PROJECT_TARGETS:
        print(f"\n  {t['index_code']}")
        for g in t["official_tickers"] + t["api_symbol_guesses"]:
            hit = symbol_hit(all_symbols, g)
            status = f"IN_CATALOG name={hit[:60]}" if hit else "NOT_IN_CATALOG"
            print(f"    {g:16} {status}")
        guesses = list(dict.fromkeys(t["api_symbol_guesses"]))
        all_guesses.extend(guesses)
        resp = probe_latest(client, guesses)
        data = resp.get("data") or resp
        if data.get("success") is False:
            print(f"    latest batch: FAIL {data.get('error')}")
            continue
        rates = data.get("rates") or {}
        for g in guesses:
            level_key = f"USD{g}"
            if g in rates or level_key in rates:
                val = rates.get(level_key) or rates.get(g)
                print(f"    latest {g}: {val}")
            else:
                print(f"    latest {g}: (无返回)")

    if run_timeseries:
        print("\n[在线] timeseries 抽样（2024-06-01 ~ 2024-06-30，单 symbol）")
        for sym in ["GSPC", "FTSE", "HSI"]:
            if sym not in all_symbols:
                continue
            ts = probe_timeseries(client, sym, "2024-06-01", "2024-06-30")
            print(f"    {sym}: {summarize_timeseries(ts)}")

    print("\n" + "=" * 60)
    print(
        "接入建议：\n"
        "  1. 若 SPCLLHCP / SPAHLVCP / FCFQCD 均 NOT_IN_CATALOG → 本 API 无法替代 S&P DJI / LSEG 授权数据。\n"
        "  2. 可用 GSPC/FTSE/HSI 仅作宏观对照，勿映射到本项目 index_code。\n"
        "  3. 有授权 CSV 时继续用 import_sp_dividend_low_vol_csv.py；勿用 latest 单日拼历史。\n"
        "  4. 注册 Key: https://indices-api.com/register → export INDICES_API_KEY=…"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="探测 pypi-indices-api / indices-api.com 覆盖度")
    parser.add_argument(
        "--timeseries",
        action="store_true",
        help="有 Key 时额外请求 timeseries（消耗额度）",
    )
    args = parser.parse_args()

    key = os.environ.get("INDICES_API_KEY") or os.environ.get("INDICES_API_ACCESS_KEY")
    print("Indices-API probe (pypi-indices-api)")
    print("=" * 60)
    if not key:
        print("API Key: 未设置（INDICES_API_KEY）")
        static_coverage_report()
        print("\n设置 Key 后重新运行可验证在线 symbol 目录与 latest/timeseries。")
        return 0

    print(f"API Key: 已设置 ({key[:4]}…{key[-4:]})")
    return live_probe(key, args.timeseries)


if __name__ == "__main__":
    raise SystemExit(main())
