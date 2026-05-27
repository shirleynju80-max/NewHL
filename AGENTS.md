# Agent notes

**价值底仓配置台** — Vite + React，数据来自 `public/data/*.csv`（可选 Worker `/api/bundle`）。

## 必读

- [docs/project-status.md](docs/project-status.md) — 状态、口径、命令
- [docs/current-handoff.md](docs/current-handoff.md) — 当前交接与未完成项
- [docs/csv-schema.md](docs/csv-schema.md) — CSV 字段口径
- [scripts/index_data_sync/README.md](scripts/index_data_sync/README.md) — 指数数据同步
- [docs/cloudflare-deploy.md](docs/cloudflare-deploy.md) — 部署

## 约定

- 指数层：研究、全收益绩效、股息率/利差；ETF 层：产品落地与盘中执行
- 缺数据留空，禁止对 `div_yield_nominal_pct` 前向填充
- 勿向本仓库添加与看板无关的 openskills / 通用 agent 技能包

## 接手流程

1. 先跑 `git status --short`，确认工作区里哪些是已有改动；不要回滚未确认的用户/Cursor 改动。
2. 读 `docs/current-handoff.md` 和本文件，再定位相关源码；不要靠聊天记忆直接改。
3. 修改前先用 `rg` 找到唯一来源；同一文案/逻辑可能同时存在于页面、组件、数据 helper。
4. 每次只收敛当前明确需求；UI 大改、数据爬虫、部署不要混在一个小修里。
5. 改完至少跑 `npm run build`；涉及浏览器可见 UI 时，用本地页面复查目标元素是否消失/生效。

## 分层边界

- `Layout.tsx`：全站标题与导航。不要在顶栏放实时数据统计、重载按钮或长状态文案。
- `Home.tsx` / `ConfigDeskOverview.tsx`：只回答“长期底仓怎么配”。不要写短线择时、交易信号或策略推荐。
- `IndicesListPage.tsx` / `IndexDetailPage.tsx`：指数研究层。展示指数表现、股息率、利差、主跟踪 ETF。
- `ProductsPage.tsx` / ETF 详情：产品落地层。关注规模、费率、跟踪指数、历史行情、分红/复权。
- `Monitor.tsx` / `Registry.tsx` / `FeaturedTrackingPage.tsx`：策略与执行层。策略结果必须明确是回测/监控，不构成投资建议。

## 数据口径

- 标普港股通红利低波指数、标普中国 A 股大盘红利低波 50 指数如无指数行情，可用主跟踪 ETF 行情做代理展示，但页面必须显式注释。
- `index_bars.csv` 为指数层主数据；`barsmore.csv`/ETF bars 为产品层数据。不要静默把 ETF 数据写成指数原始数据。
- 股息率只使用显式观测值；非观测日保持空。
- ETF 前复权历史行情会因分红除权变化，补数脚本应支持全量刷新，不只拼接 T-1。

## UI 收敛规则

- 深色专业金融界面优先：少色块、少框、弱边线、清晰层级。
- 表格首列名称不能截断到不可辨认；长名称用两行或 tooltip。
- 状态标签必须有足够对比度；黄色标签不要放在浅色文字上。
- 首页尽量短，只保留核心判断和入口；解释性长文移到对应研究页。
- 图表阈值色块必须说明用途；如果解释成本高，优先删除色块或改成简短图例。
