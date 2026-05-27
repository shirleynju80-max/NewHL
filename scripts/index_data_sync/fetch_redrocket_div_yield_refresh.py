#!/usr/bin/env python3
"""查询红色火箭股息率(DID)序列，写入 public/data/redrocket_div_yield_meta.json。

用法:
  python3 scripts/index_data_sync/fetch_redrocket_div_yield_refresh.py

说明:
  - source_latest_date = 各指数 API 最近 tradeDate 的全局最大值（即红色火箭侧数据更新至哪一天）
  - 与 index_bars 落库日可能相同；落库请仍运行 sync_h30269_dividend_yield_redrocket.py
"""
from __future__ import annotations

from redrocket_did_common import (
    latest_dates_from_api,
    redrocket_target_index_codes,
    write_div_yield_meta,
)


def main() -> None:
    targets = sorted(redrocket_target_index_codes())
    per_index = latest_dates_from_api(targets)
    path = write_div_yield_meta(per_index)
    latest = max(per_index.values()) if per_index else "—"
    print(f"wrote {path}")
    print(f"source_latest_date (红色火箭): {latest}")
    print(f"indices queried: {len(per_index)}/{len(targets)}")
    for code in sorted(per_index):
        print(f"  {code}: {per_index[code]}")


if __name__ == "__main__":
    main()
