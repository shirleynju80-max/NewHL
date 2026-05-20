本目录为开发时自动加载的 CSV 数据源（/data/*.csv）。

【主文件】以下三份须齐全且列名与项目约定一致：
  etfs.csv
  bars.csv
  etf_params.csv

【可选主文件】
  bonds.csv — 无此文件、或文件为空、或仅有表头/说明行无有效数据时，视为「无国债序列」：各交易日使用中债 2.5%、美债 4.0% 常数对齐 K 线（与代码内 DEFAULT_BOND_* 一致）。有数据时：表头可为 date,cn10y_pct,us10y_pct，或含「日期」+ 中债/美国收益率列；前几行说明可自动跳过。
  indices.csv / index_bars.csv / index_tracking_etfs.csv — 指数列表与指数详情页数据。index_bars.csv 中 div_yield_nominal_pct 为按日显式观测值；当前已确认可用的红利/现金流指数使用红色火箭 DID 序列补充，只在源接口有观测且本地有对应 bar 的日期写入，不做前向填充。

【可选合并文件】存在时会在内存中与主文件合并后再建 bundle：
  etfsmore.csv   — 与 etfs.csv 合并：同一 code 以 more 为准
  barsmore.csv   — 与 bars.csv 合并：同一 etf_code + 同一 date 以 more 为准
  bondsmore.csv  — 与 bonds.csv 合并：同一 date 以 more 为准（bonds 为空时可直接用 bondsmore 提供曲线）

合并后若某标的在 etfs / bars 中已存在，但 etf_params.csv 中无对应 etf_code，会自动补一行默认参数；若仅有 bars 有新 code 而无 etfs 行，会生成占位标的（名称中会提示补全）。

国债若为 xlsx，请导出为 CSV 后放入本目录。列说明见项目根目录 README.md「用 CSV 先跑通」一节。
