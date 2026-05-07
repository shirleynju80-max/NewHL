将四个 CSV 放在本目录（文件名必须一致）：

  etfs.csv
  bars.csv
  bonds.csv
  etf_params.csv

开发服务器启动后会自动请求 /data/*.csv ；若四份文件齐全且格式正确，看板会加载 CSV 数据（若你已在总览页用文件选择器载入过 CSV，则不会覆盖）。

列说明见项目根目录 README.md「用 CSV 先跑通」一节。

提示：product_kind 可写 ETF（视作红利）；bonds 中空单元格会沿用上一行；strategy_id 含 rsi 时用 RSI 穿越规则回测。
