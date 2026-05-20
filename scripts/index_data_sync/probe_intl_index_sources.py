#!/usr/bin/env python3
"""
探测 S&P / 富时等境外指数历史行情是否可从公开源批量获取。
仅打印结论，不写 index_bars.csv。

用法：
  python3 scripts/index_data_sync/probe_intl_index_sources.py
"""
from __future__ import annotations

import json
import sys
from urllib.parse import quote

import requests

SESSION = requests.Session()
SESSION.trust_env = False
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; NewHL-probe/1.0)"}

# (label, url, expect_json_chart)
TARGETS = [
    ("S&P Yahoo ^SPCNLOVHD5 (price)", f"https://query1.finance.yahoo.com/v8/finance/chart/{quote('^SPCNLOVHD5')}?interval=1d&range=max", True),
    ("S&P Yahoo SPCLLHCT (TR)", "https://query1.finance.yahoo.com/v8/finance/chart/SPCLLHCT?interval=1d&range=5y", True),
    ("S&P Yahoo SPCLLHCP", "https://query1.finance.yahoo.com/v8/finance/chart/SPCLLHCP?interval=1d&range=5y", True),
    ("HK S&P Yahoo SPAHLVCP", "https://query1.finance.yahoo.com/v8/finance/chart/SPAHLVCP?interval=1d&range=5y", True),
    ("FTSE Yahoo FCFQCD", "https://query1.finance.yahoo.com/v8/finance/chart/FCFQCD?interval=1d&range=5y", True),
    ("S&P official factsheet", "https://www.spglobal.com/spdji/en/indices/dividends-factors/sp-china-a-share-largecap-low-volatility-high-dividend-50-index/", False),
    ("FTSE ground rules PDF", "https://www.lseg.com.cn/content/dam/ftse-russell/en_us/documents/ground-rules/ftse-china-a-free-cash-flow-focus-index-ground-rules-chinese.pdf", False),
]


def probe_yahoo_chart(name: str, url: str) -> str:
    try:
        r = SESSION.get(url, headers=HEADERS, timeout=20)
    except Exception as e:
        return f"FAIL network: {e}"
    if r.status_code != 200:
        return f"FAIL HTTP {r.status_code}"
    try:
        j = r.json()
        result = j.get("chart", {}).get("result")
        if not result:
            err = j.get("chart", {}).get("error") or j
            return f"FAIL no chart result: {str(err)[:120]}"
        ts = result[0].get("timestamp") or []
        return f"OK bars={len(ts)} first={ts[0] if ts else '—'} last={ts[-1] if ts else '—'}"
    except json.JSONDecodeError:
        return f"FAIL not JSON ({len(r.content)} bytes)"


def probe_http(name: str, url: str) -> str:
    try:
        r = SESSION.get(url, headers=HEADERS, timeout=20, allow_redirects=True)
    except Exception as e:
        return f"FAIL network: {e}"
    ctype = (r.headers.get("content-type") or "").split(";")[0]
    blocked = "security" in r.url.lower() or r.status_code in (403, 451)
    if blocked:
        return f"BLOCKED HTTP {r.status_code} url={r.url[:80]}"
    if "pdf" in ctype or url.endswith(".pdf"):
        return f"OK PDF/binary len={len(r.content)} (需人工或授权下载，非日频 API)"
    text = r.text[:500].lower()
    if "captcha" in text or "access denied" in text:
        return "BLOCKED captcha/denied"
    return f"OK HTTP {r.status_code} ctype={ctype} len={len(r.content)}"


def main() -> int:
    print("International index source probe\n" + "=" * 60)
    for name, url, is_yahoo in TARGETS:
        detail = probe_yahoo_chart(name, url) if is_yahoo else probe_http(name, url)
        print(f"\n{name}\n  {detail}")
    print("\n" + "=" * 60)
    print(
        "结论摘要：\n"
        "  - S&P / FTSE 官方站：编制说明可访问，历史日频通常需 S&P DJI / LSEG 授权或人工导出 CSV。\n"
        "  - Yahoo：若 chart API 返回 OK，可短期作旁路；需与 factsheet 交叉验证，且 ticker 可能 404。\n"
        "  - 推荐路径：授权 CSV → import_sp_dividend_low_vol_csv.py；勿用单日行情拼历史。\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
