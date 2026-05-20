from __future__ import annotations

import csv
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "public" / "data"
INDEX_BARS = DATA_DIR / "index_bars.csv"
INDICES = DATA_DIR / "indices.csv"
TRACKING = DATA_DIR / "index_tracking_etfs.csv"

CSI_BASE = "https://www.csindex.com.cn/csindex-home"
HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.csindex.com.cn/",
}


@dataclass(frozen=True)
class CsiTarget:
    code: str
    tri_code: str
    tracking_etf: str
    market: str = "A"
    category: str = "A股红利"


CSI_TARGETS = [
    CsiTarget("H30269", "H20269", "512890"),
    CsiTarget("930955", "H20955", "515100"),
    CsiTarget("000922", "H00922", "515080"),
    CsiTarget("000015", "H00015", "510880"),
    CsiTarget("931468", "921468", "159758"),
    CsiTarget("000825", "H00825", "561580"),
    # 931157 场外基金 007751 见 index_tracking_etfs.csv（product_type=otc_fund），不进 ETF 行情同步。
    CsiTarget("931157", "H21157", ""),
    CsiTarget("930914", "H20914", "513530", market="H", category="港股红利"),
    CsiTarget("931233", "931233HKD210", "513910", market="H", category="港股红利"),
    CsiTarget("932365", "932365CNY010", "159232", category="现金流"),
    # 详情页对比基准。
    CsiTarget("000300", "H00300", "", category="宽基"),
]


@dataclass(frozen=True)
class CnIndexTarget:
    code: str
    source_code: str
    tracking_etf: str
    category: str = "现金流"


CNINDEX_TARGETS = [
    CnIndexTarget("980092", "980092", "159201"),
    CnIndexTarget("CIS51002", "987016", "159569", category="港股红利"),
]

# S&P 指数不在中证接口内；当前只记录元数据与待接入状态，不写单日行情冒充历史。
SP_TARGET = {
    "index_code": "SPCLLHCP.SPI",
    "name": "标普中国A股大盘红利低波50指数",
    "market": "A",
    "category": "A股红利",
    "methodology_summary": "S&P China A-Share LargeCap Low Volatility High Dividend 50 Index，Price Return ticker 为 SPCLLHCP，Total Return ticker 为 SPCLLHCT；跟踪产品：南方红利低波50ETF（515450）。S&P 指数行情需接入 S&P DJI 授权下载或可验证第三方历史数据源；当前脚本不使用单日行情填充历史。",
    "methodology_url": "https://www.spglobal.com/spdji/en/indices/dividends-factors/sp-china-a-share-largecap-low-volatility-high-dividend-50-index/",
    "fallback_div_yield_pct": "",
    "inception_date": "2015-08-25",
    "base_date": "2009-01-23",
    "base_value": "",
    "launch_date": "2019-04-01",
    "weighting_method": "股息率驱动的低波动高股息策略权重",
    "rebalancing_frequency": "每半年（1 月、7 月）",
}


def normalize_date(raw: Any) -> str:
    s = str(raw or "").strip()
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    return s


def get_json(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    url = f"{CSI_BASE}{path}"
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=45)
            r.raise_for_status()
            data = r.json()
            if data.get("code") != "200":
                raise RuntimeError(f"CSI API failed {path}: {data.get('code')} {data.get('msg')}")
            return data
        except Exception as exc:
            last_error = exc
            if attempt == 3:
                break
            time.sleep(0.8 * (attempt + 1))
    if last_error:
        raise last_error
    raise RuntimeError(f"CSI API failed {path}")


def fetch_close_series(code: str, start_date: str) -> dict[str, float]:
    start = start_date.replace("-", "") or "20000101"
    data = get_json(
        "/perf/index-perf",
        {"indexCode": code, "startDate": start, "endDate": "20991231"},
    )
    out: dict[str, float] = {}
    for row in data.get("data") or []:
        date = normalize_date(row.get("tradeDate"))
        close = row.get("close")
        if date and close is not None:
            out[date] = float(close)
    if not out:
        raise RuntimeError(f"{code} returned no close series")
    return out


def fetch_cnindex_close_series(source_code: str, start_date: str) -> dict[str, float]:
    # 国证官网公开行情接口只返回价格指数日收盘序列；未找到独立全收益代码。
    r = requests.get(
        "https://hq.cnindex.com.cn/market/market/getIndexDailyDataWithDataFormat",
        params={"indexCode": source_code, "startDate": start_date, "endDate": "2099-12-31"},
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json, text/plain, */*",
            "Referer": f"https://www.cnindex.com.cn/module/index-detail.html?act_menu=1&indexCode={source_code}",
        },
        timeout=45,
    )
    r.raise_for_status()
    data = r.json()
    if data.get("code") != 200:
        raise RuntimeError(f"CNIndex API failed for {source_code}: {data!r}")
    out: dict[str, float] = {}
    for row in ((data.get("data") or {}).get("data") or []):
        date = str(row[0] or "").strip()
        close = row[5] if len(row) > 5 else None
        if date and close is not None:
            out[date] = float(close)
    if not out:
        raise RuntimeError(f"{source_code} returned no CNIndex close series")
    return out


def fetch_dividend_yield(code: str) -> dict[str, float]:
    # 已核对：/perf/indexCsiDsPe 的 peg 字段与 factsheet 股息率不一致，
    # 且 000300 最新值约 14.6，更接近滚动市盈率而非 DP。未找到可靠历史 DP
    # 接口前，股息率列保持为空，避免用估值字段冒充股息率。
    return {}


def fetch_basic_info(code: str) -> dict[str, Any]:
    data = get_json(f"/indexInfo/index-basic-info/{quote(code)}")
    info = data.get("data") or {}
    if not info.get("indexCode"):
        return {}
    return info


def row_for_target(target: CsiTarget, basic: dict[str, Any]) -> dict[str, str]:
    name = basic.get("indexFullNameCn") or basic.get("indexShortNameCn") or target.code
    desc = basic.get("indexCnDesc") or ""
    weighting = basic.get("weightingType") or ""
    if not weighting:
        # 中证接口常给空；从简介里保留可读口径。
        weighting = "见指数简介/编制方案"
    return {
        "index_code": target.code,
        "name": name,
        "market": target.market,
        "category": target.category,
        "methodology_summary": desc,
        "methodology_url": "",
        "fallback_div_yield_pct": "",
        "inception_date": normalize_date(basic.get("publishDate")) or "",
        "base_date": normalize_date(basic.get("basicDate")) or "",
        "base_value": "" if basic.get("basicIndex") is None else str(basic.get("basicIndex")),
        "launch_date": normalize_date(basic.get("publishDate")) or "",
        "weighting_method": weighting,
        "rebalancing_frequency": basic.get("adjFreqCn") or "",
    }


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    if not path.exists():
        return [], []
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return reader.fieldnames or [], list(reader)


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def sync_index_bars() -> dict[str, dict[str, Any]]:
    fields, rows = read_csv(INDEX_BARS)
    required = ["index_code", "date", "tri_close", "price_close", "div_yield_nominal_pct"]
    fieldnames = required + [x for x in fields if x not in required]
    replace_codes = {t.code for t in CSI_TARGETS} | {t.code for t in CNINDEX_TARGETS}
    kept = [row for row in rows if row.get("index_code") not in replace_codes]

    summary: dict[str, dict[str, Any]] = {}
    new_rows: list[dict[str, str]] = []
    for target in CSI_TARGETS:
        basic = fetch_basic_info(target.code)
        start_date = normalize_date(basic.get("basicDate")) or normalize_date(basic.get("publishDate")) or "2000-01-01"
        price = fetch_close_series(target.code, start_date)
        tri = fetch_close_series(target.tri_code, start_date)
        div = fetch_dividend_yield(target.code)
        dates = sorted(set(price) & set(tri))
        count_div = 0
        for date in dates:
            div_value = div.get(date)
            if div_value is not None:
                count_div += 1
            new_rows.append(
                {
                    "index_code": target.code,
                    "date": date,
                    "tri_close": f"{tri[date]:.4f}",
                    "price_close": f"{price[date]:.4f}",
                    "div_yield_nominal_pct": "" if div_value is None else f"{div_value:.4f}",
                }
            )
        summary[target.code] = {
            "rows": len(dates),
            "div_rows": count_div,
            "range": [dates[0], dates[-1]] if dates else None,
        }
    for target in CNINDEX_TARGETS:
        meta_by_code = {row.get("index_code"): row for row in read_csv(INDICES)[1]}
        start_date = meta_by_code.get(target.code, {}).get("base_date") or "2000-01-01"
        price = fetch_cnindex_close_series(target.source_code, start_date)
        dates = sorted(price)
        for date in dates:
            new_rows.append(
                {
                    "index_code": target.code,
                    "date": date,
                    # 国证公开接口未返回独立全收益序列；用价格序列占位以便详情页展示，
                    # 口径在脚本文档中说明。
                    "tri_close": f"{price[date]:.4f}",
                    "price_close": f"{price[date]:.4f}",
                    "div_yield_nominal_pct": "",
                }
            )
        summary[target.code] = {
            "rows": len(dates),
            "div_rows": 0,
            "range": [dates[0], dates[-1]] if dates else None,
            "source": "cnindex-price-only",
        }
    write_csv(INDEX_BARS, fieldnames, new_rows + kept)
    return summary


def sync_indices_meta() -> None:
    fields, rows = read_csv(INDICES)
    required = [
        "index_code",
        "name",
        "market",
        "category",
        "methodology_summary",
        "methodology_url",
        "fallback_div_yield_pct",
        "inception_date",
        "base_date",
        "base_value",
        "launch_date",
        "weighting_method",
        "rebalancing_frequency",
    ]
    fieldnames = required + [x for x in fields if x not in required]
    # 删除旧错码与本次目标旧行，保留其他指数。
    replace_codes = {t.code for t in CSI_TARGETS} | {"000926", "931374", "SPCLLHCP.SPI"}
    kept = [row for row in rows if row.get("index_code") not in replace_codes]
    new_rows = [row_for_target(t, fetch_basic_info(t.code)) for t in CSI_TARGETS]
    new_rows.insert(3, SP_TARGET)
    write_csv(INDICES, fieldnames, new_rows + kept)


def sync_tracking() -> None:
    fields, rows = read_csv(TRACKING)
    fieldnames = ["index_code", "etf_code", "note", "fee_pct"] + [
        x for x in fields if x not in {"index_code", "etf_code", "note", "fee_pct"}
    ]
    replace_codes = {t.code for t in CSI_TARGETS} | {"000926", "931374", "SPCLLHCP.SPI"}
    kept = [row for row in rows if row.get("index_code") not in replace_codes]
    new_rows = [
        {"index_code": t.code, "etf_code": t.tracking_etf, "note": "", "fee_pct": ""}
        for t in CSI_TARGETS
        if t.tracking_etf
    ]
    new_rows.insert(3, {"index_code": "SPCLLHCP.SPI", "etf_code": "515450", "note": "待接入 S&P 历史行情", "fee_pct": ""})
    write_csv(TRACKING, fieldnames, new_rows + kept)


def main() -> None:
    summary = sync_index_bars()
    sync_indices_meta()
    sync_tracking()
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
