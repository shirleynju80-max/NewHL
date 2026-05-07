#!/usr/bin/env python3
"""
本地验证 TickFlow API Key（勿把 Key 写进本文件或提交到 git）。

安装依赖（二选一）:
  pip install "tickflow[all]>=0.1.17"
  uv pip install "tickflow[all]>=0.1.17"

运行（不要把 Key 贴在聊天里）:
  export TICKFLOW_API_KEY='你的key'
  python3 scripts/test_tickflow.py

文档参考: https://clawhub.ai/tickflow-dev/tickflow
"""
from __future__ import annotations

import os
import sys


def main() -> None:
    if not os.environ.get("TICKFLOW_API_KEY"):
        print("错误: 未设置环境变量 TICKFLOW_API_KEY", file=sys.stderr)
        print("  export TICKFLOW_API_KEY='……'", file=sys.stderr)
        print("  python3 scripts/test_tickflow.py", file=sys.stderr)
        sys.exit(1)

    try:
        from tickflow import TickFlow
    except ImportError:
        print("错误: 未安装 tickflow。请执行:", file=sys.stderr)
        print('  pip install "tickflow[all]>=0.1.17"', file=sys.stderr)
        sys.exit(1)

    tf = TickFlow()
    symbols = ["510300.SH", "000001.SZ"]
    quotes = tf.quotes.get(symbols=symbols)
    print("TickFlow 鉴权成功。示例实时行情:")
    for q in quotes:
        ext = q.get("ext") or {}
        name = ext.get("name", "?")
        sym = q.get("symbol", "?")
        price = q.get("last_price", "?")
        ch = ext.get("change_pct")
        chs = f"{float(ch) * 100:+.2f}%" if ch is not None else "?"
        print(f"  {sym} {name}: {price} ({chs})")

    print("\n对比: 免费档最近 5 根日 K（不读 TICKFLOW_API_KEY）")
    tf_free = TickFlow.free()
    df = tf_free.klines.get("510300.SH", period="1d", count=5, as_dataframe=True)
    print(df.tail())


if __name__ == "__main__":
    main()
