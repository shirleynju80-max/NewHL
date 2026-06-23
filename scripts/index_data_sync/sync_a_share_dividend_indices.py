from __future__ import annotations

import csv
import json
import time
from dataclasses import dataclass
from datetime import date
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
EM_HIS_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": "https://www.csindex.com.cn/",
    "Origin": "https://www.csindex.com.cn",
}
EM_HEADERS = {
    "User-Agent": HEADERS["User-Agent"],
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://quote.eastmoney.com/",
}
# 东方财富指数 secid：多数中证代码为 2.<code>；少数上证体系为 1.<code>
EM_INDEX_SECID_SH = frozenset({"000300", "000015"})
SESSION = requests.Session()
SESSION.trust_env = False


@dataclass(frozen=True)
class CsiTarget:
    code: str
    tri_code: str
    tracking_etf: str
    # 是否预期存在可拉取的官方全收益序列（TRI）
    tri_expected: bool = True
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
    CsiTarget("932366", "932366CNY010", "562080", category="现金流"),
    CsiTarget("932367", "932367CNY010", "560120", category="现金流"),
    CsiTarget("932368", "932368CNY010", "563990", category="现金流"),
    # 详情页对比基准。
    CsiTarget("000300", "H00300", "", category="宽基"),
]


CASHFLOW_SUMMARY_APPENDIX = {
    "932365": "定位差异：以中证全指为宽样本空间，选取100只自由现金流率较高证券，覆盖面最广，更偏全市场现金流质量暴露。",
    "932366": "定位差异：以沪深300为样本空间，选取50只自由现金流率较高证券，更偏大盘龙头中的现金流创造能力。",
    "932367": "定位差异：以中证500为样本空间，选取50只自由现金流率较高证券，更偏中盘公司中的现金流质量与成长弹性。",
    "932368": "定位差异：以中证800为样本空间，选取50只自由现金流率较高证券，覆盖沪深300与中证500，更偏大中盘核心池的现金流筛选。",
}

TRACKING_NOTES = {
    "932365": "南方中证全指自由现金流ETF",
    "932366": "华宝沪深300自由现金流ETF",
    "932367": "华夏中证500自由现金流ETF",
    "932368": "富国中证800自由现金流ETF",
}

EXTRA_TRACKING_ROWS = [
    {
        "index_code": "931157",
        "etf_code": "007751",
        "note": "景顺长城沪港深红利成长低波A",
        "fee_pct": "",
        "product_type": "otc_fund",
    },
    {"index_code": "932366", "etf_code": "563900", "note": "摩根沪深300自由现金流ETF；产品落地参考，不作为盘中默认监控", "fee_pct": ""},
    {"index_code": "932368", "etf_code": "563580", "note": "万家中证800自由现金流ETF；产品落地参考，不作为盘中默认监控", "fee_pct": ""},
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


def warm_csi_session() -> None:
    try:
        SESSION.get("https://www.csindex.com.cn/", headers=HEADERS, timeout=30)
    except Exception:
        pass


def get_json(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    url = f"{CSI_BASE}{path}"
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            r = SESSION.get(url, params=params, headers=HEADERS, timeout=45)
            r.raise_for_status()
            data = r.json()
            if data.get("code") != "200":
                raise RuntimeError(f"CSI API failed {path}: {data.get('code')} {data.get('msg')}")
            return data
        except Exception as exc:
            last_error = exc
            if attempt == 3:
                break
            time.sleep(1.2 * (attempt + 1))
    if last_error:
        raise last_error
    raise RuntimeError(f"CSI API failed {path}")


def infer_em_index_secids(code: str) -> list[str]:
    c = code.strip().upper()
    if not c:
        return []
    if c in EM_INDEX_SECID_SH:
        return [f"1.{c}", f"2.{c}"]
    return [f"2.{c}", f"1.{c}"]


def fetch_close_series_csi(code: str, start_date: str) -> dict[str, float]:
    start = start_date.replace("-", "") or "20000101"
    data = get_json(
        "/perf/index-perf",
        {"indexCode": code, "startDate": start, "endDate": "20991231"},
    )
    out: dict[str, float] = {}
    for row in data.get("data") or []:
        d = normalize_date(row.get("tradeDate"))
        close = row.get("close")
        if d and close is not None:
            out[d] = float(close)
    if not out:
        raise RuntimeError(f"{code} returned no CSI close series")
    return out


def fetch_close_series_em(code: str, start_date: str) -> dict[str, float]:
    beg = start_date.replace("-", "") or "20000101"
    end = date.today().strftime("%Y%m%d")
    last_error: Exception | None = None
    for secid in infer_em_index_secids(code):
        try:
            r = SESSION.get(
                EM_HIS_URL,
                params={
                    "secid": secid,
                    "fields1": "f1,f2,f3,f4,f5,f6",
                    "fields2": "f51,f52,f53,f54,f55,f56,f57,f58",
                    "klt": "101",
                    "fqt": "0",
                    "beg": beg,
                    "end": end,
                    "lmt": "120000",
                },
                headers=EM_HEADERS,
                timeout=45,
            )
            r.raise_for_status()
            payload = r.json()
            klines = (payload.get("data") or {}).get("klines") or []
            out: dict[str, float] = {}
            for item in klines:
                parts = str(item).split(",")
                if len(parts) < 3:
                    continue
                d = normalize_date(parts[0])
                close = parts[2]
                if d and close:
                    out[d] = float(close)
            if out:
                return out
        except Exception as exc:
            last_error = exc
    if last_error:
        raise last_error
    raise RuntimeError(f"{code} returned no Eastmoney close series")


def merge_close_series_tail(
    baseline: dict[str, float],
    patch: dict[str, float],
) -> dict[str, float]:
    """CSI 全量失败时，用 EM 等较短序列至少补齐 baseline 之后的尾 K。"""
    if not baseline:
        return patch
    if not patch:
        return baseline
    old_last = max(baseline)
    out = dict(baseline)
    for d, close in patch.items():
        if d >= old_last:
            out[d] = close
    return out


def fetch_close_series(
    code: str,
    start_date: str,
    *,
    baseline: dict[str, float] | None = None,
) -> dict[str, float]:
    csi_error: Exception | None = None
    try:
        return fetch_close_series_csi(code, start_date)
    except Exception as exc:
        csi_error = exc
    try:
        em = fetch_close_series_em(code, start_date)
    except Exception as em_exc:
        if csi_error:
            raise csi_error from em_exc
        raise
    if baseline and len(em) < max(40, int(len(baseline) * 0.85)):
        merged = merge_close_series_tail(baseline, em)
        if merged and max(merged) > max(baseline):
            print(
                f"::warning::CSI {code} failed ({csi_error}); merged Eastmoney tail "
                f"({max(baseline)} -> {max(merged)})",
            )
            return merged
        if csi_error:
            raise csi_error
        raise RuntimeError(f"{code} Eastmoney series too short vs baseline")
    print(f"::warning::CSI {code} failed ({csi_error}); fallback to Eastmoney index kline")
    return em


def rows_to_close_map(rows: list[dict[str, str]], *, price_key: str = "price_close") -> dict[str, float]:
    out: dict[str, float] = {}
    for row in rows:
        d = (row.get("date") or "").strip()
        raw = (row.get(price_key) or "").strip()
        if not d or not raw:
            continue
        try:
            out[d] = float(raw)
        except ValueError:
            continue
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
    try:
        data = get_json(f"/indexInfo/index-basic-info/{quote(code)}")
    except requests.HTTPError as exc:
        if getattr(getattr(exc, "response", None), "status_code", None) == 403:
            print(f"::warning::CSI basic-info {code} got 403; use indices.csv fallback if any")
            return {}
        raise
    info = data.get("data") or {}
    if not info.get("indexCode"):
        return {}
    return info


def row_for_target(target: CsiTarget, basic: dict[str, Any]) -> dict[str, str]:
    name = basic.get("indexFullNameCn") or basic.get("indexShortNameCn") or target.code
    desc = basic.get("indexCnDesc") or ""
    appendix = CASHFLOW_SUMMARY_APPENDIX.get(target.code)
    if appendix:
        desc = f"{desc} {appendix}".strip()
    weighting = basic.get("weightingType") or ""
    if not weighting:
        # 中证接口常给空；现金流指数在官网简介中明确以自由现金流率排序筛选。
        weighting = "自由现金流率筛选" if target.category == "现金流" else "见指数简介/编制方案"
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


def meta_row_is_usable(row: dict[str, str]) -> bool:
    code = (row.get("index_code") or "").strip()
    name = (row.get("name") or "").strip()
    if not code or not name or name == code:
        return False
    return bool((row.get("inception_date") or "").strip() or (row.get("base_date") or "").strip())


def merge_index_meta_row(
    target: CsiTarget,
    existing: dict[str, str],
    fetched: dict[str, str],
) -> dict[str, str]:
    """CSI basic-info 403/空时保留 indices.csv 已有元数据，避免 name=code 覆盖。"""
    if meta_row_is_usable(fetched):
        out = dict(fetched)
        for key, value in existing.items():
            if key not in out and (value or "").strip():
                out[key] = value
        out["index_code"] = target.code
        out["market"] = target.market
        out["category"] = target.category
        return out
    if meta_row_is_usable(existing):
        print(f"::warning::CSI basic-info {target.code} empty/403; keep existing indices.csv meta")
        out = dict(existing)
        out["index_code"] = target.code
        out["market"] = target.market
        out["category"] = target.category
        return out
    return fetched


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
    warm_csi_session()
    fields, rows = read_csv(INDEX_BARS)
    required = ["index_code", "date", "tri_close", "price_close", "div_yield_nominal_pct"]
    fieldnames = required + [x for x in fields if x not in required]
    replace_codes = {t.code for t in CSI_TARGETS} | {t.code for t in CNINDEX_TARGETS}
    kept = [row for row in rows if row.get("index_code") not in replace_codes]
    existing_by_code: dict[str, list[dict[str, str]]] = {}
    for row in rows:
        code = (row.get("index_code") or "").strip()
        if code in replace_codes:
            existing_by_code.setdefault(code, []).append(row)
    indices_meta = {row.get("index_code"): row for row in read_csv(INDICES)[1]}

    summary: dict[str, dict[str, Any]] = {}
    new_rows: list[dict[str, str]] = []
    tri_fallback_codes: list[str] = []
    kept_on_failure: list[str] = []
    for target in CSI_TARGETS:
        basic = fetch_basic_info(target.code)
        meta = indices_meta.get(target.code) or {}
        start_date = (
            normalize_date(basic.get("basicDate"))
            or normalize_date(basic.get("publishDate"))
            or (meta.get("base_date") or "").strip()
            or "2000-01-01"
        )
        old_rows = existing_by_code.get(target.code, [])
        old_price = rows_to_close_map(old_rows) if old_rows else None
        try:
            price = fetch_close_series(target.code, start_date, baseline=old_price)
        except Exception as exc:
            if old_rows:
                kept_on_failure.append(target.code)
                print(
                    f"::warning::{target.code} price fetch failed ({exc}); "
                    f"keep {len(old_rows)} existing index_bars rows",
                )
                new_rows.extend(old_rows)
                dates = sorted((row.get("date") or "") for row in old_rows if row.get("date"))
                summary[target.code] = {
                    "rows": len(old_rows),
                    "div_rows": sum(1 for row in old_rows if (row.get("div_yield_nominal_pct") or "").strip()),
                    "range": [dates[0], dates[-1]] if dates else None,
                    "tri_expected": target.tri_expected,
                    "tri_source": "kept-on-fetch-failure",
                }
                time.sleep(0.4)
                continue
            raise
        tri_source = "not-available"
        tri = {}
        if target.tri_expected:
            tri_source = "official-tri"
            old_tri = rows_to_close_map(old_rows, price_key="tri_close") if old_rows else None
            try:
                tri = fetch_close_series(target.tri_code, start_date, baseline=old_tri)
            except requests.HTTPError as exc:
                code = getattr(getattr(exc, "response", None), "status_code", None)
                if code == 403:
                    # 仅当该指数“按口径应有 TRI”时才允许临时用价格替代，并显式告警。
                    tri = price
                    tri_source = "fallback-price-on-403"
                    tri_fallback_codes.append(target.code)
                    print(
                        f"::warning::TRI {target.tri_code} got 403; fallback to price series for {target.code}",
                    )
                else:
                    raise
            except Exception as exc:
                if old_tri:
                    tri = old_tri
                    tri_source = "kept-tri-on-fetch-failure"
                    print(f"::warning::TRI {target.tri_code} fetch failed ({exc}); reuse existing tri_close")
                else:
                    tri = price
                    tri_source = "fallback-price-on-fetch-failure"
                    tri_fallback_codes.append(target.code)
                    print(f"::warning::TRI {target.tri_code} fetch failed ({exc}); fallback to price series")
        div = fetch_dividend_yield(target.code)
        dates = sorted(set(price) & set(tri)) if tri else sorted(price)
        count_div = 0
        for date in dates:
            div_value = div.get(date)
            if div_value is not None:
                count_div += 1
            new_rows.append(
                {
                    "index_code": target.code,
                    "date": date,
                    "tri_close": f"{tri[date]:.4f}" if tri else "",
                    "price_close": f"{price[date]:.4f}",
                    "div_yield_nominal_pct": "" if div_value is None else f"{div_value:.4f}",
                }
            )
        summary[target.code] = {
            "rows": len(dates),
            "div_rows": count_div,
            "range": [dates[0], dates[-1]] if dates else None,
            "tri_expected": target.tri_expected,
            "tri_source": tri_source,
        }
        time.sleep(0.4)
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
    if tri_fallback_codes:
        print(
            f"::warning::TRI fallback used for expected-TRI indices: {', '.join(sorted(tri_fallback_codes))}",
        )
    if kept_on_failure:
        print(f"::warning::Kept existing index_bars on fetch failure: {', '.join(sorted(kept_on_failure))}")
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
    existing_by_code = {
        (row.get("index_code") or "").strip(): row
        for row in rows
        if (row.get("index_code") or "").strip()
    }
    new_rows: list[dict[str, str]] = []
    for target in CSI_TARGETS:
        fetched = row_for_target(target, fetch_basic_info(target.code))
        new_rows.append(
            merge_index_meta_row(target, existing_by_code.get(target.code) or {}, fetched)
        )
    new_rows.insert(3, SP_TARGET)
    write_csv(INDICES, fieldnames, new_rows + kept)


def sync_tracking() -> None:
    fields, rows = read_csv(TRACKING)
    fieldnames = ["index_code", "etf_code", "note", "fee_pct", "product_type"] + [
        x for x in fields if x not in {"index_code", "etf_code", "note", "fee_pct", "product_type"}
    ]
    # 仅覆盖有 CSI 场内主产品的指数；931157 等 OTC 主产品须保留/由 EXTRA 写入。
    replace_codes = {t.code for t in CSI_TARGETS if t.tracking_etf} | {
        "000926",
        "931374",
        "SPCLLHCP.SPI",
    }
    kept = [row for row in rows if row.get("index_code") not in replace_codes]
    new_rows = [
        {
            "index_code": t.code,
            "etf_code": t.tracking_etf,
            "note": TRACKING_NOTES.get(t.code, ""),
            "fee_pct": "",
            "product_type": "",
        }
        for t in CSI_TARGETS
        if t.tracking_etf
    ]
    new_rows.insert(
        3,
        {
            "index_code": "SPCLLHCP.SPI",
            "etf_code": "515450",
            "note": "待接入 S&P 历史行情",
            "fee_pct": "",
            "product_type": "",
        },
    )
    new_rows.extend(
        row for row in EXTRA_TRACKING_ROWS if row.get("product_type") != "otc_fund"
    )
    merged = new_rows + kept
    for otc in EXTRA_TRACKING_ROWS:
        if otc.get("product_type") != "otc_fund":
            continue
        if not any(r.get("index_code") == otc["index_code"] for r in merged):
            merged.append(otc)
    write_csv(TRACKING, fieldnames, merged)


def main() -> None:
    summary = sync_index_bars()
    sync_indices_meta()
    sync_tracking()
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
