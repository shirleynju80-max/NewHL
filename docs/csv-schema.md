# CSV 数据表结构

UTF-8，`YYYY-MM-DD`。文件放在 `public/data/`，详见 [public/data/README.txt](../public/data/README.txt)。

## 主表（ETF 回测 / 盘中）

- **etfs.csv** — `code`, `name`, `strategy_id`, `param_version`, `product_kind`, `dividend_market_scope`, `div_yield_nominal_pct`, `div_yield_source` 等
- **bars.csv** — `etf_code`, `date`, `open`, `high`, `low`, `close`；可选按日 `div_yield_nominal_pct`
- **etf_params.csv** — `etf_code`, `ma_fast`, `ma_slow`, `rsi_*` 等；同一标的可多行参数版本
- **bonds.csv** — `date`, `cn10y_pct`, `us10y_pct`（支持中文表头，见 loader）

合并：`etfsmore.csv`、`barsmore.csv`、`bondsmore.csv` 与主表按 code/date 覆盖合并。

## 指数（可选）

- **indices.csv** — `index_code`, `name`, `market`, `category`, `base_date`, `inception_date`, …
- **index_bars.csv** — `index_code`, `date`, `tri_close`, `price_close`, `div_yield_nominal_pct`（观测日写入，不前向填充）
- **index_tracking_etfs.csv** — `index_code`, `etf_code`, `product_type`（`otc_fund` 场外）
- **etf_products.csv** — 产品落地；`is_primary=true` 为默认跟踪产品

## 场外基金

- **fund_bars.csv** — `fund_code`, `index_code`, `date`, `nav_unit`, …

完整列说明与示例见仓库历史 README 或 `src/data/csvLoader.ts` 解析逻辑。
