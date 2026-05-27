# ETF 产品字段数据源

## 固定主源：东方财富基金 F10

观察池内**场内 ETF** 的规模、管理/托管/综合费率，统一由：

```bash
node scripts/sync_etf_products_monthly.mjs
```

从 `https://fundf10.eastmoney.com/jbgk_{code}.html` 解析：

| 字段 | F10 表头 |
|------|----------|
| `aum_cny` | 净资产规模 |
| `management_fee_pct` | 管理费率 |
| `custody_fee_pct` | 托管费率 |
| `total_fee_pct` | 管理 + 托管（或由 `index_tracking_etfs.csv` 的 `fee_pct` 兜底） |
| `listed_date` | 成立日期/规模 |
| `issuer` | 基金管理人 |

**覆盖情况（2026-05-25）**：46 只观察池产品中 45 只有规模+费率；仅场外 `007751` 暂不抓 F10（脚本显式跳过）。

未自动覆盖、保持手填或留空：

- `avg_daily_turnover_cny`、`latest_premium_discount_pct`、`tracking_error_pct`（待接行情/季报或另一接口）

### 为何不混用多源

| 来源 | 适用 | 不选作主源的原因 |
|------|------|------------------|
| 东方财富 F10 | 全市场 ETF/LOF 基金档案 | **已覆盖最广**，与 `select_index_tracking_etfs.mjs`、实时爬虫同源 |
| 中证/国证指数公司 | 指数元数据 | 无基金规模、费率 |
| 腾讯/iFinD xlsx | 前复权日 K | 无产品表字段 |
| indices-api 等 | 全球大盘指数 | 不含 A 股 ETF 档案 |

## 日 K 行情

| 场景 | 脚本 | 输出 |
|------|------|------|
| 日常/盘中 | `scripts/realtime_crawler/sync_etf_realtime.py` | `barsmore.csv`（东财日 K + 定点 quote） |
| 批量前复权 xlsx | `scripts/import_etf_bars_ifind_xlsx.py` | 合并进 `barsmore.csv` |

合并规则：`bars.csv` + `barsmore.csv`，同 `etf_code` + `date` 以 **barsmore** 为准。

## 相关指数未入池

**`932369`** — 中证1000自由现金流指数：中证官网可查，本轮未核验到明确跟踪 ETF，故不在 `indices.csv` / 产品选择观察池内（见 `scripts/index_data_sync/README.md`）。
