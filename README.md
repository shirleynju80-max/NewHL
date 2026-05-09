# 红利 ETF 看板

Vite + React + TypeScript + Tailwind + Recharts。UI 取向：浅灰底、留白、Indigo 强调、DM Sans + Noto Sans SC。

## 功能（对照计划）

- **参数注册**：MA / RSI / 布林带多 `variant_id`，策略引用展示。
- **单标的页**：**回测与买卖点**（价格+利差双轴与策略指标分图、Brush 时间窗、多组参数切换）；**策略汇总**与**明细**；**今日盘中信号**（可选策略、模拟价、指标**历史分位**，买入提示分位 ≤20%、卖出 ≥80%）；顶栏**临近买卖区间提示**（全日收盘口径分位）；**信号台账**（含当日指标值）；红利**股息率/国债/利差**与**利差–价格**图、港股税后侧栏、编制说明折叠区。
- **现金流类标的**：红利利差与港股模块隐藏，占位说明。
- **总览页 · 标的对比**：勾选 2 个及以上标的（或指数，只要在 `bars.csv` 中有列），在**重合交易日**上对比买入持有的**年化收益**、**最大回撤**、**年化波动**、**收益/回撤比（类 Calmar）**，以及日收益的 **Pearson 相关性矩阵**。

数据为 `src/data/mock.ts` 生成的示例序列，可替换为真实行情与参数表。

### 每日更新与「历史 + 当日实时」如何联动（你需要提供什么）

本仓库当前是 **纯前端 + CSV/静态文件**，没有内置行情库。要做到**每天更新**并把**历史 K 线**与**当日未收盘的价量**串起来，推荐由你方提供 **HTTPS API** 或 **定时落盘的 CSV**（与现有表头兼容），并约定以下字段与节奏：

| 你需要提供 | 用途 |
|------------|------|
| **历史 OHLC**（按标的、按交易日，与现 `bars.csv` 同口径） | 回测、分位、对比、利差对齐；可每日增量追加。 |
| **当日「最新价」或 13:45 / 任意盘中快照**（时间戳 + 标的 + 价） | 与 T-1 全日 K 拼接后重算盘中信号（与现 `mergeIntraday1345` 逻辑一致）；正式环境建议**服务端定时写入**，前端只读。 |
| **交易日是否开市**（或后端直接返回「是否交易日」） | 避免非交易日误拉快照、对齐国债与股息字段。 |
| **国债收益率序列**（与现 `bonds.csv` 一致） | 利差与对比模块的锚；可日更。 |
| **参数表 / 标的表**（`etf_params` / `etfs`） | 策略版本与多组参数；变更频率通常低于行情。 |
| **鉴权**（Cookie / JWT / API Key，仅后端持有密钥时更安全） | 浏览器直连第三方行情往往受 CORS/合规限制，**推荐统一经你的网关聚合**后给前端一个域名。 |

**联动原则（简短）**：历史以 **收盘库** 为准；实时以 **带时间戳的快照** 覆盖「当日最后一根 K」的收盘（或单独字段由后端下发「partial bar」），前端用同一套 `computeSignals` / 分位逻辑重算即可。若你愿意提供 **OpenAPI 文档或示例 JSON**，可在后续迭代中增加 `src/api/` 拉数层，替换 `mock`/`CSV` 入口。

### TickFlow 定时同步 `bars.csv`（可选）

- **GitHub Actions**：工作流 [.github/workflows/tickflow-sync.yml](.github/workflows/tickflow-sync.yml) 在工作日约北京时间 16:40 拉取日 K，合并写入 `public/data/bars.csv`；有变更时自动 `git push`。请在仓库 **Settings → Secrets and variables → Actions** 中配置 `TICKFLOW_API_KEY`（勿提交到代码或聊天）。
- **标的列表**：若 CI 检出环境里没有 `public/data/etfs.csv`（例如该文件仍被 gitignore），脚本会改用已入库的 [scripts/tickflow_sync/sync_etfs.csv](scripts/tickflow_sync/sync_etfs.csv)；也可通过环境变量 `TICKFLOW_ETFS_CSV` 指向任意含 `code` 列的 CSV。可选列 `tickflow_symbol` 可写死如 `510300.SH`，否则按 6 位代码推断 `.SH` / `.SZ`。
- **本地执行**：`pip install -r scripts/tickflow_sync/requirements.txt`，再 `export TICKFLOW_API_KEY='…'` 后运行 `python3 scripts/tickflow_sync/sync_bars.py`。无 Key 时可用 `python3 scripts/tickflow_sync/sync_bars.py --free`（仅 TickFlow 免费档历史日 K）。环境变量 `TICKFLOW_KLINE_COUNT` 控制每只标的拉取根数（默认 3000；**增量**时通常 120～400 足够）。`TICKFLOW_ADJUST` 默认 `forward`（前复权）。
- **增量默认**：脚本**只追加**各标的在 `bars.csv` 中已有 **最大 `date` 之后** 的 TickFlow 日 K，**不覆盖**历史行（与东方财富主数据一致）。若需用 TickFlow 覆盖重叠历史，显式传 `--full-refresh`（慎用）。
- **复权口径**：TickFlow 侧由 `TICKFLOW_ADJUST` 控制；默认前复权。若回测必须与东财某一口径严格一致，仍以 CSV 主数据为准，仅用增量补新交易日。

## 对外访问（Web 部署）

本仓库为 **纯前端 SPA**，构建产物是静态文件，可挂在任意静态服务器或容器后由域名/HTTPS 对外提供。

### 方式 A：Docker（推荐一键对外）

```bash
docker build -t dividend-dashboard .
docker run -p 8080:80 dividend-dashboard
```

浏览器访问 `http://<服务器IP>:8080`。生产环境建议在容器前加 **HTTPS 反向代理**（如 Caddy / Traefik / 云负载均衡）并绑定域名。

### 方式 B：静态托管（Vercel / Netlify / OSS + CDN）

```bash
npm run build
# 将 dist/ 目录上传到托管方指定根路径
```

若站点不在域名根路径，构建前设置 `VITE_BASE_PATH=/你的子路径/` 再执行 `npm run build`。

### 方式 C：临时对外演示

```bash
npm run build
npx vite preview --host 0.0.0.0 --port 4173
```

将本机防火墙/安全组放行对应端口（注意安全风险，仅适合内测）。

### 环境变量（可选）

复制 `.env.example` 为 `.env`，配置 `VITE_API_BASE_URL` 等（接入后端后再用）。前端已预留 `src/config/env.ts` 读取。

---

## 数据与权限：你需要提供什么

当前看板用 **本地 mock**。接真实数据时，建议按下表准备（**不必一次齐全**，可按里程碑分批）。

| 类别 | 用途 | 你需要提供的内容 |
|------|------|------------------|
| **ETF / 指数行情** | K 线、13:45 快照、回测重放 | 数据源选型：**券商 / 交易所 / 第三方行情 API**；**API Key 或内网白名单**；标的列表（代码、名称、交易所）；**复权口径**（前复权/后复权/不复权，需与策略一致）；历史 OHLC 拉取频率与 **是否允许公网直连**（若不允许，需你方 **后端聚合 + HTTPS**，前端只调你的域名）。 |
| **统一交易日历** | 13:45 定时、日 K 对齐 | 与计划一致：**一套全局交易日**定义（或由你的后端在「是否交易日」上统一返回）；**非交易日、停牌** 的约定字段。 |
| **国债收益率** | 红利利差锚（CN 10Y / US 10Y） | **时间序列来源**（Wind / 中债 / FRED 等）；更新频率（日频即可）；是否由你的后端对齐到 **ETF 交易日** 后下发。 |
| **股息率** | 名义股息率、`div_yield_source` | **基金披露**（定期报告字段）或 **指数公司发布** 的股息率口径说明；若用估算，需提供 **计算公式与更新频率**。港股 **税后估算** 需约定 **投资者通道**（港股通/QDII 等）与 **税率假设**（合规文案由你方法务/投教审核）。 |
| **指数编制 / 调样** | 解释层文案与日历 | 可选用公开编制说明链接 + **调样日期表**（若要做日历模块）；非必须接入实时行情。 |
| **策略参数注册表** | MA/RSI/布林带多组、版本 | **JSON/表结构** 或管理后台；`param_version`、生效区间；**无需**把行情商权限交给策略参数本身。 |
| **合规与授权** | 对外公网访问 | 行情与指数数据是否 **允许二次展示/转售**；是否需 **登录**（OAuth、Cookie）；若面向境外用户，数据跨境与展示范围需自行合规评估。 |

**权限与架构建议（总结）**

1. **最省事**：你方提供 **一个 HTTPS API**（鉴权用 Cookie / JWT / API Key），返回已对齐的 JSON（行情、国债、股息率、参数表）；前端不直连多个行情商，**密钥不暴露到浏览器**。  
2. **若必须浏览器直连第三方**：仅限对方提供 **前端可用** 的公开/匿名接口，且需处理 **CORS**；敏感 Key 仍应走后端。  
3. **13:45 任务**：可由 **浏览器定时**（仅当用户开着页）或 **服务器 Cron**（可靠）；对外正式服务建议 **服务端定时拉数 + 推送/轮询 API** 给前端展示。

你方只要先定：**行情 + 国债 + 股息率** 三类数据由谁提供、是否走统一后端，我可以按接口契约接一层 `src/api/` 替换 `mock.ts`。

---

## 用 CSV 先跑通（不接聚合后端）

把 CSV 放在可被前端读取的位置（例如构建后放到 `dist/` 同级的 `data/`，或后续用 `public/data/` 静态文件），**UTF-8** 编码，日期统一 **`YYYY-MM-DD`**，表头与下列列名一致（多文件拆分，便于维护）。

### 1）`etfs.csv` — 标的静态信息（一行一个 ETF）

| 列名 | 必填 | 说明 |
|------|------|------|
| `code` | 是 | 标的代码，如 `515080` |
| `name` | 是 | 展示名称 |
| `strategy_id` | 是 | 策略标识，用于展示/追溯 |
| `param_version` | 是 | 参数版本号，如 `2025-04-01` |
| `product_kind` | 是 | `红利_含股息分红` 或 `现金流类`；简写 **`ETF`** 会视为红利（须配合 `dividend_market_scope`） |
| `dividend_market_scope` | 红利必填 | `A股红利` 或 `港股红利`；现金流类可留空 |
| `div_yield_nominal_pct` | 红利必填 | 名义股息率，**数字**，如 `5.42`（表示 5.42%） |
| `div_yield_source` | 红利必填 | `基金披露` / `指数发布` / `估算` |
| `investor_channel` | 否 | 港股用：`港股通` / `QDII` / `其他` |
| `div_yield_after_tax_est_pct` | 否 | 税后股息率估算，数字 |
| `tax_assumption_note` | 否 | 短文案，说明税率假设 |
| `fx_ccy` | 否 | 如 `HKD` |

### 2）`bars.csv` — 日 K 行情（一行一天、一标的多行）

| 列名 | 必填 | 说明 |
|------|------|------|
| `etf_code` | 是 | 对应 `etfs.csv` 的 `code` |
| `date` | 是 | 交易日 |
| `open` | 是 | 开盘价 |
| `high` | 是 | 最高价 |
| `low` | 是 | 最低价 |
| `close` | 是 | 收盘价（与策略/回测口径一致，**前复权建议写进脚注**） |

同一 `etf_code` 按 `date` **升序**排列；缺日则该段图表会断档，建议与 `bonds.csv` 日期对齐。

### 3）`bonds.csv` — 国债收益率（一行一天，全局一份即可）

| 列名 | 必填 | 说明 |
|------|------|------|
| `date` | 是 | 交易日 |
| `cn10y_pct` | 是* | 中国 10 年期收益率（**百分数数字**）。*可为空：空则沿用上一行该列有效值（文件内填充）。 |
| `us10y_pct` | 是* | 美国 10 年期收益率；*可为空，规则同上。 |

**与 K 线日期对齐**：程序会用「每个 bar 日期之前最近一条」国债观测对齐到 `bars` 的每个交易日，不要求 bonds 与 bars 日期一一相同。

红利利差：`div_yield_nominal_pct - 对应锚国债`（A 股红利用 `cn10y_pct`，港股红利用 `us10y_pct`），与当前前端逻辑一致。

### 4）`etf_params.csv` — 策略用到的指标参数（扁平列；**同一 `etf_code` 可多行**）

同一标的在 `etf_params.csv` 中可占 **多行**：回测页会生成 **参数下拉**，每行一组数值。`etfs.csv` 中该标的的 `param_version`（及 `strategy_id`）须与 **其中一行** 完全一致，该行作为 **默认展示参数**；其余行可用于对比（可选 `note` 作为下拉标签）。

当前示例策略只用到 **一组 MA 快慢周期**（金叉/死叉）或 **RSI 阈值**（由 `strategy_id` 是否含 `rsi` 决定）。你可先只提供下列列；多组 MA/RSI/布林带可后续扩展为多条或 JSON 列。

| 列名 | 必填 | 说明 |
|------|------|------|
| `etf_code` | 是 | 与 `etfs.code` 一致 |
| `strategy_id` | 建议 | 与 `etfs.csv` 默认行一致时可省略；多策略对比行可写不同 `strategy_id`（程序按行重算） |
| `param_version` | 建议 | 默认行应与 `etfs.csv` 一致；对比行可用不同版本号 |
| `note` | 否 | 下拉展示名；缺省用 `param_version` |
| `ma_fast` | 否 | 默认 `5`（空则走默认） |
| `ma_slow` | 否 | 默认 `20` |
| `rsi_period` | 否 | 默认 `14`；可与列名 **`rsi_window`** 互换（二选一） |
| `rsi_overbought` | 否 | 默认 `70` |
| `rsi_oversold` | 否 | 默认 `30` |
| `bb_period` | 否 | 默认 `20`；可与 **`boll_window`** 互换 |
| `bb_std` | 否 | 默认 `2`；可与 **`boll_std`** 互换 |

**`strategy_id` 与回测信号**：若 `strategy_id` 含 **`rsi`**（且不含 `boll`），使用 RSI 均值回归规则（穿越超卖/超买）；否则使用 MA 金叉/死叉。含 `boll` 的策略当前仍走 MA 分支（占位，可后续接布林带信号）。

程序侧会把 `(ma_fast, ma_slow)` 映射为 `variant_id=ma_csv` 的一组参数，与现有 `computeSignals` 对齐。

### `strategy_id`、`param_version` 与 `etf_params.csv` 的映射关系

三者分工不同，一起构成「**用哪套逻辑 + 哪一版数字 + 数字具体是多少**」：

| 字段 | 所在文件 | 含义 |
|------|------------|------|
| **`strategy_id`** | `etfs.csv`（建议 `etf_params.csv` 也各写一列） | **策略族 / 逻辑模板**：决定程序走哪条信号管线（例如 `str_ma_cross` 只用到 MA 快慢线；以后可有 `str_bb_rsi`）。同一 `strategy_id` 的代码分支固定，**不等同于参数值**。 |
| **`param_version`** | `etfs.csv`（建议 `etf_params.csv` 也各写一列） | **参数快照版本**：人为或流程生成的版本号（如 `2025-04-01`），用于审计、回测复现、与历史报告对齐。**不直接参与公式计算**，但用于校验「当前展示是否对应该版参数」。 |
| **`etf_params.csv` 各列** | 仅 `etf_params.csv` | **该版下的具体数值**（如 `ma_fast=5`, `ma_slow=20`）。同一标的换参数时，应 **更新 `param_version` 并新增或覆盖一行参数**（见下）。 |

**怎么连起来（推荐约定）**

1. **主键**：同一 `etf_code` 下建议 **`param_version`（加可选 `strategy_id`）** 在文件内可区分多行；与 `etfs.csv` **对齐的那一行**必须与 `etfs` 的 `strategy_id`、`param_version` 一致（加载时校验），其余对比行可不同。  
2. **一致性**：`etfs.csv` 指向的 **默认参数行** 与元数据一致；多行时仅默认行参与上述严格校验。  
3. **`strategy_id` 与列的约束**：程序根据 `strategy_id` 决定读取 `etf_params` 的哪些列（例如 MA 策略读 `ma_fast`/`ma_slow`；未来别的策略读别的列）。**CSV 里多出来的列可留空**，但若 `strategy_id` 声明是 MA 策略却缺少 `ma_fast`/`ma_slow`，应视为数据错误。  
4. **仅填 `etfs.csv`、不写 `etf_params` 行不行**：不行——没有数值行，引擎不知道快慢线周期。**仅填 `etf_params`、不写 `etfs` 行不行**：也不行——缺少展示名、品类、股息锚、`strategy_id` 等元数据。

**一行示例（逻辑上对应同一条标的）**

- `etfs.csv`：`code=515080`, `strategy_id=str_ma_cross`, `param_version=2025-04-01`, …  
- `etf_params.csv`：`etf_code=515080`, `strategy_id=str_ma_cross`, `param_version=2025-04-01`, `ma_fast=5`, `ma_slow=20`, …  

简记：**`strategy_id` 选配方，`param_version` 选第几版快照，`etf_params` 填这一版里的具体数字。**

### 最少能跑起来的组合

- **必须有**：`etfs.csv` + `bars.csv` + `bonds.csv` + `etf_params.csv`  
- **红利类**：`dividend_market_scope`、`div_yield_nominal_pct`、`div_yield_source` 必填，否则利差模块按产品规则应隐藏或报「待补全」。  
- **港股税后**：有则填 `investor_channel` 与 `div_yield_after_tax_est_pct`；没有可先空，侧栏可弱化展示。

准备好这四份文件后：

1. **从「下载」等本机目录载入（推荐）**  
   运行 `npm run dev`，打开总览页，点击 **「从本机选择四个 CSV」**，在系统文件框中到 **下载** 文件夹，**一次多选**四个文件（浏览器无法直接访问 `/下载` 路径，必须通过文件选择器授权）。

2. **自动从 `public/data/` 载入**  
   把四个 CSV 复制到 `public/data/`（与 `README.txt` 同级），文件名与表头符合下文章节；启动 dev 或访问构建后的站点时，若四份文件均存在且解析成功，会自动替换内置示例（若你已在页面手动选过 CSV，则不会覆盖）。

实现代码：`src/lib/csv.ts`、`src/data/csvLoader.ts`、`src/context/DataSourceContext.tsx`。

## 本地运行

若使用 **nvm**，先在终端执行 `nvm use`（或 `nvm use 24`）确保 `node` / `npm` 在 `PATH` 中。

```bash
cd /Users/shuke-xl/Documents/NewHL
npm install
npm run dev
```

浏览器打开终端提示的本地地址（一般为 `http://localhost:5173`）。

```bash
npm run build   # 生产构建
npm run preview # 预览构建结果
```

## 目录结构

- `src/data/` — 示例标的、行情、国债序列
- `src/lib/` — 指标、策略、回测、利差计算（与 UI 解耦）
- `src/pages/` — 页面
- `src/components/Layout.tsx` — 顶栏与布局
