# 指数数据补数方案

本目录记录 `public/data/index_bars.csv` 与 `public/data/indices.csv` 的指数补数口径，便于后续扩展更多指数。

## 当前脚本

```bash
python3 scripts/index_data_sync/sync_a_share_dividend_indices.py
```

脚本会写入：

- `public/data/index_bars.csv`
- `public/data/indices.csv`
- `public/data/index_tracking_etfs.csv`

## 中证/上证系列口径

数据源为中证官网公开接口：

- 价格指数：`/perf/index-perf?indexCode=<价格指数代码>`
- 全收益指数：先用 `/perf/get-derivative-index?indexCode=<价格指数代码>` 确认，再用 `/perf/index-perf?indexCode=<全收益代码>`
- 股息率：中证接口暂不写入。已核对 `/perf/indexCsiDsPe?indexCode=<价格指数代码>` 返回字段 `peg` 与 factsheet 的股息率不一致；例如 `000300` 最新约 14.6，更接近滚动市盈率，不可作为 DP/股息率。已确认红色火箭 DID 的指数，统一由红色火箭脚本补入。
- 基本信息：`/indexInfo/index-basic-info/<价格指数代码>`

写入规则：

- `tri_close` 写全收益指数 close。
- `price_close` 写价格指数 close。
- `div_yield_nominal_pct` 在未确认可靠历史 DP 接口前保持为空；没有数据就留空，不做前向填充、不做 fallback。
- 价格和全收益从官方 `basicDate` 起拉取，避免用任意早期 `startDate` 触发接口伪造起点行。

## 国证系列口径

`980092` 国证自由现金流指数、`CIS51002` 国证港股通红利低波动率指数使用国证官网公开行情接口：

- 价格指数：`https://hq.cnindex.com.cn/market/market/getIndexDailyDataWithDataFormat?indexCode=980092`
- `CIS51002` 本地展示代码对应国证官网行情代码 `987016`。
- 基本信息：仍使用 `indices.csv` 中人工核对后的元数据。
- 全收益指数：暂未找到独立全收益代码或官方全收益下载接口；当前 `tri_close` 与 `price_close` 同取国证日收盘价，仅用于让详情页展示官方价格序列，不能解读为全收益。
- 股息率：红色火箭 DID 可返回 `980092.CNI`、`987016.CNI`，按同一规则写入显式观测日期。

## 恒生系列口径

`HSI114`、`HSSCSOY.HI` 使用恒生 Index360 登录态接口：

```bash
HSI_ACCESS_TOKEN=<从已登录 Index360 localStorage.token 读取> \
  python3 scripts/index_data_sync/sync_hsi_indices.py
```

来源与字段：

- 接口：`https://www.hsi.com.hk/api/wsit-hsil-hiip-ea-productdata-proxy/v1/productData/e/indexes/v1`
- 鉴权：请求头 `ACCESS_TOKEN`，只从环境变量读取，不写入脚本或仓库。
- `HSI114`：价格指数 `02033.00`，全收益指数 `12033.00`。
- `HSSCSOY.HI`：价格指数 `02200.00`，全收益指数 `12200.00`。
- `tri_close` 写恒生 `TRI_Grs` 全收益日收盘，`price_close` 写 PI 日收盘。
- 股息率：红色火箭 DID 可返回 `HSHYLV.HI`、`HSSCSOY.HI`，按同一规则写入显式观测日期。

## 红色火箭股息率补充口径

中证官网公开接口暂未找到可直接下载的历史 DP 序列；`/perf/indexCsiDsPe` 的 `peg` 字段已确认不是股息率。当前已确认可用的红利/现金流指数主股息率使用红色火箭指数详情页的 `股息率(DID)` 序列：

```bash
python3 scripts/index_data_sync/sync_h30269_dividend_yield_redrocket.py
```

来源与字段：

- 页面：`https://hongsehuojian.com/red-rocket/indexDetail?securityCode=<securityCode>`
- 接口：`/fundex-quote/index/valuation?securityCode=<securityCode>&valuationType=DID&timeInterval=since_inception`
- 当前批量范围：`indices.csv` 中 `category` 为 `A股红利`、`港股红利` 或 `现金流`，同时 `index_bars.csv` 已有行情行且已确认红色火箭 `securityCode` 的指数。
- 序列为周频/不定期观测，非每日序列。
- `div_yield_nominal_pct`：使用 `valuationValue`，对应页面「基本面 / 估值分析 / 股息率(DID)」主值。
- `div_yield_redrocket_did_pct`：同 `valuationValue`，用于保留来源口径。
- `div_yield_redrocket_percentile_pct`：接口 `historicalPercentile`，用于核对页面分位。
- 写入规则：先清空目标指数既有股息率主列，再仅在接口存在观测值且本地已有 bar 的交易日写入；缺失日期保持为空，不做前向填充、不做 fallback。

已确认 `securityCode` 映射：

| 本地展示代码 | 红色火箭 securityCode | 当前落表区间 |
|--------------|-----------------------|--------------|
| `H30269` | `h30269.CSI` | `2013-12-19` 至 `2026-05-19` |
| `930955` | `930955.CSI` | `2017-05-26` 至 `2026-05-19` |
| `000922` | `000922.CSI` | `2008-05-26` 至 `2026-05-19` |
| `000015` | `000015.SH` | `2005-01-04` 至 `2026-05-19` |
| `931468` | `931468.CSI` | `2020-05-21` 至 `2026-05-19` |
| `000825` | `000825.CSI` | `2012-07-20` 至 `2026-05-19` |
| `931157` | `931157.CSI` | `2019-04-25` 至 `2026-05-19` |
| `930914` | `930914.CSI` | `2016-11-25` 至 `2026-05-19` |
| `931233` | `931233.CSI` | `2017-06-28` 至 `2026-05-19` |
| `932365` | `932365.CSI` | `2024-12-11` 至 `2026-05-19` |
| `980092` | `980092.CNI` | `2024-08-19` 至 `2026-05-19` |
| `CIS51002` | `987016.CNI` | `2021-11-18` 至 `2026-05-19` |
| `HSI114` | `HSHYLV.HI` | `2017-05-08` 至 `2026-05-19` |
| `HSSCSOY.HI` | `HSSCSOY.HI` | `2023-06-13` 至 `2026-05-19` |

红色火箭页面说明估值/ROE等数据来源为 Wind；该 DID 序列不是中证官网历史下载源。若后续拿到中证官方 DP 历史序列，应以官方序列替换。

乐咕乐股曾作为备选核对源，脚本保留但不再作为主口径：

```bash
python3 scripts/index_data_sync/sync_h30269_dividend_yield_legulegu.py
```

来源与字段：

- 页面：`https://legulegu.com/stockdata/index-basic?indexCode=h30269.CSI`
- 接口：`/api/stockdata/index-basic?indexCode=h30269.CSI&token=<当天日期MD5>`，需先访问页面获取 Cookie / CSRF。
- 当前免登录返回区间：`2021-05-20` 至 `2026-05-18`；更早历史未返回，保持为空。
- `div_yield_nominal_pct`：使用 `addDvRatio`，即乐咕图例“静态股息率”（加权口径），作为页面利差图主口径。
- `div_yield_equal_pct`：`dvRatio`，等权股息率。
- `div_yield_ttm_pct`：`addDvTtm`，股息率 TTM（加权口径）。
- `div_yield_ttm_equal_pct`：`dvTtm`，等权股息率 TTM。

## 当前映射

| 展示代码 | 价格指数 | 全收益指数 | 备注 |
|----------|----------|------------|------|
| `H30269` | `H30269` | `H20269` | 中证红利低波动指数 |
| `930955` | `930955` | `H20955` | 中证红利低波动100指数 |
| `000922` | `000922` | `H00922` | 中证红利指数 |
| `000015` | `000015` | `H00015` | 上证红利指数 |
| `931468` | `931468` | `921468` | 中证红利质量指数 |
| `000825` | `000825` | `H00825` | 中证央企红利指数；旧表/原需求里的 `000926` 是“中证中央企业综合指数”，不是央企红利 |
| `931157` | `931157` | `H21157` | 中证沪港深红利成长低波动指数；旧表/原需求里的 `931374` 官网无匹配 |
| `930914` | `930914` | `H20914` | 中证港股通高股息投资指数 |
| `931233` | `931233` | `931233HKD210` | 中证港股通央企红利指数 |
| `932365` | `932365` | `932365CNY010` | 中证全指自由现金流指数 |
| `980092` | `980092` | 暂无 | 国证自由现金流指数；国证接口只返回价格序列，当前 `tri_close=price_close` |
| `CIS51002` | `987016` | 暂无 | 国证港股通红利低波动率指数；本地展示代码保留 `CIS51002`，国证接口只返回价格序列，当前 `tri_close=price_close` |
| `HSI114` | `02033.00` | `12033.00` | 恒生港股通高股息低波动指数 |
| `HSSCSOY.HI` | `02200.00` | `12200.00` | 恒生港股通中国央企红利指数 |
| `000300` | `000300` | `H00300` | 沪深300，用作详情页基准 |

## 跟踪产品映射（含开放式基金 007751）

`index_tracking_etfs.csv` 列：`index_code`, `etf_code`, `product_type`, `note`, `fee_pct`。

- 场内 ETF/LOF：行情来自 `bars.csv` / `barsmore.csv` + 实时爬虫。
- 开放式基金（如 `007751`）：净值写入 `fund_bars.csv`，加载时并入 ETF 看板；**同样走 `/etf/007751`**，不再外链天天基金。

```bash
python3 scripts/index_data_sync/sync_otc_fund_bars_em.py
```

`007751`（931157 主跟踪）需在 `etfsmore.csv` 有元数据行；`DataSourceContext` 会自动 fetch `fund_bars.csv`。

| 列 | 说明 |
|----|------|
| `fund_code`, `index_code`, `date` | 基金代码、挂钩指数、净值日 |
| `nav_unit`, `nav_accum`, `daily_return_pct` | 单位净值、累计净值、日增长率（东方财富 / akshare） |
| `div_yield_fund_ttm_pct` | 过去 12 个月每份现金分红 / 当日单位净值 × 100（基金分配口径；有分红记录才填） |
| `div_yield_index_did_pct` | 同日 `index_bars` 中挂钩指数的红色火箭 DID（指数口径；缺失不填） |

007751 当前约 1586 个净值日（2019-09-06 起）；指数 DID 为周频/不定期观测，与净值日不完全重合属正常。

## 待接入（S&P / 富时历史行情）

`SPCLLHCP.SPI`、`SPAHLVCP.SPI`、`FCFQCD` 暂无 `index_bars` 序列。探测脚本：

```bash
python3 scripts/index_data_sync/probe_intl_index_sources.py
```

`SPCLLHCP.SPI` 属于 S&P DJI 指数，不在中证接口内。当前只在 `indices.csv` 和 `index_tracking_etfs.csv` 保留元信息与产品映射，不用 Yahoo 单日行情填充历史。

已核对到的官方页面元数据：

- 官方指数页：`https://www.spglobal.com/spdji/en/indices/dividends-factors/sp-china-a-share-largecap-low-volatility-high-dividend-50-index/`
- Price Return ticker：`SPCLLHCP`
- Total Return ticker：`SPCLLHCT`
- First Value Date：`2015-08-25`
- Launch Date：`2019-04-01`
- Base Date：`2009-01-23`
- Rebalancing Frequency：每半年（1 月、7 月）

直接请求官方指数页会触发 S&P Global Security Controls；后续可继续接入 S&P DJI 授权下载、可靠第三方历史行情，或用户提供 CSV。

已尝试但暂不可用的旁路（2026-05-20 本机探测）：

- YCharts 可检索到 `^SPCNLOVHD5` 的页面与最新值，但 Historical Data 需要订阅。
- Yahoo Finance chart API：本环境对 `^SPCNLOVHD5`、`SPCLLHCT`、`SPCLLHCP`、`SPAHLVCP`、`FCFQCD` 均 **HTTP 403**（可能限流/地区策略）；不可作为稳定自动化源。
- S&P 官方指数页：本环境 **HTTP 403**（Security Controls）；编制说明需浏览器或授权渠道。
- 富时 ground rules PDF：可下载（约 400KB），为编制文档而非日频 OHLC；历史仍需 LSEG/授权数据或人工 CSV。

如果后续拿到 S&P DJI、Wind、Choice、Bloomberg 或其他可验证来源导出的 CSV，可用导入脚本写入：

```bash
python3 scripts/index_data_sync/import_sp_dividend_low_vol_csv.py /path/to/spcllhcp.csv
```

脚本会自动识别常见列名；如果列名特殊，可显式指定：

```bash
python3 scripts/index_data_sync/import_sp_dividend_low_vol_csv.py /path/to/spcllhcp.csv \
  --date-column Date --price-column SPCLLHCP --tri-column SPCLLHCT --div-column "Dividend Yield"
```

## indices.csv 元数据补数口径

`indices.csv` 当前字段按前端 `IndexMeta` 类型保留：

- `index_code`、`name`、`market`、`category`
- `methodology_summary`、`methodology_url`
- `fallback_div_yield_pct`（没有可靠按日股息率或回退口径时留空）
- `inception_date`、`base_date`、`base_value`、`launch_date`
- `weighting_method`、`rebalancing_frequency`

补数优先级为：指数公司官网/官方编制方案或 factsheet、交易所披露基金文件、基金招募说明书/产品资料。无法用可访问的官方或可靠来源核实的字段保持为空，或在展示性字段中标注 `待补`，不猜测。

已保留范围：

- 港股红利：`HSI114`、`CIS51002`、`SPAHLVCP.SPI`、`930914`、`HSSCSOY.HI`、`931233`
- 现金流：`980092`、`FCFQCD`、`932365`

已按 2026-05-19 需求删除：

- 现金流板块除 `980092`、`FCFQCD`、`932365` 外的其他条目。
- 价值板块全部条目。

删除同步范围包括 `indices.csv`、`index_tracking_etfs.csv` 和 `价值底仓类指数_精简版.csv`；指数列表页也不再展示“价值”筛选项。`index_bars.csv` 当前没有这些被删指数的行情行，无需清理。
